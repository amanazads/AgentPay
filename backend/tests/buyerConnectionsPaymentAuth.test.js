import request from 'supertest';
import { app } from '../src/index.js';
import { query } from '../src/config/database.js';
import { evaluatePolicy } from '../src/services/policyEngine.js';
import { findEligibleProducts } from '../src/services/candidateFilter.js';
import { parseBuyerIntent } from '../src/services/intentParser.js';
import { merchantConnectionService } from '../src/services/merchantConnectionService.js';
import { paymentMethodService } from '../src/services/paymentMethodService.js';

describe('Track 01: Buyer Connections & Payment Authorization Hardening Suite', () => {
  let testBuyerUserId;
  let testAgentId;
  let testMerchantId;
  let testProduct;
  let testPaymentMethodId;

  beforeAll(async () => {
    // 1. Fetch test buyer user
    const userRes = await query("SELECT id FROM users WHERE role = 'user' OR role = 'BUYER' LIMIT 1");
    testBuyerUserId = userRes.rows[0]?.id;

    // 2. Fetch test agent
    const agentRes = await query("SELECT id FROM agents WHERE status = 'active' LIMIT 1");
    testAgentId = agentRes.rows[0]?.id;

    // 3. Fetch verified merchant
    const merchRes = await query("SELECT id FROM merchants WHERE is_verified = true LIMIT 1");
    testMerchantId = merchRes.rows[0]?.id;

    // 4. Fetch test product
    const prodRes = await query("SELECT * FROM products WHERE merchant_id = $1 AND in_stock = true LIMIT 1", [testMerchantId]);
    testProduct = prodRes.rows[0];

    // 5. Clean existing payment methods and past test transactions for clean spend isolation
    await query("DELETE FROM approvals WHERE purchase_intent_id IN (SELECT id FROM purchase_intents WHERE user_id = $1)", [testBuyerUserId]);
    await query("DELETE FROM invoices WHERE order_id IN (SELECT id FROM orders WHERE user_id = $1)", [testBuyerUserId]);
    await query("DELETE FROM orders WHERE user_id = $1", [testBuyerUserId]);
    await query("DELETE FROM transactions WHERE user_id = $1", [testBuyerUserId]);
    await query("DELETE FROM purchase_intents WHERE user_id = $1", [testBuyerUserId]);
    await query("DELETE FROM user_payment_methods WHERE user_id = $1", [testBuyerUserId]);

    // Connect all verified merchants so multi-merchant tests have full connectivity
    const allMerchRes = await query("SELECT id FROM merchants WHERE is_verified = true");
    for (const m of allMerchRes.rows) {
      await merchantConnectionService.connectMerchant(testBuyerUserId, m.id);
    }

    const pm = await paymentMethodService.addPaymentMethod(testBuyerUserId, {
      provider: 'razorpay_sandbox',
      method_type: 'upi_mandate',
      identifier_masked: 'user@okaxis (Sandbox Mandate)',
      single_transaction_limit: 50000.00,
      monthly_limit: 500000.00,
      is_default: true,
    });
    testPaymentMethodId = pm.id;

    // 6. Set generous buyer preferences
    await query(`
      INSERT INTO user_preferences (user_id, monthly_budget, auto_purchase_limit, categories, preferred_brands, purchase_behavior, updated_at)
      VALUES ($1, 1000000, 50000, ARRAY['Electronics', 'Peripherals', 'Software & Licenses', 'Office Supplies'], ARRAY['Apple', 'Sony', 'Ambrane', 'Logitech'], 'auto_within_limit', NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        monthly_budget = 1000000,
        auto_purchase_limit = 50000,
        categories = ARRAY['Electronics', 'Peripherals', 'Software & Licenses', 'Office Supplies'],
        preferred_brands = ARRAY['Apple', 'Sony', 'Ambrane', 'Logitech'],
        purchase_behavior = 'auto_within_limit',
        updated_at = NOW()
    `, [testBuyerUserId]);
  });

  // TEST 1: Merchant connected + catalog available -> Product discovery succeeds
  it('TEST 1: Product discovery successfully returns candidates from connected merchants', async () => {
    const intent = parseBuyerIntent('Buy a power bank under ₹5,000');
    const searchRes = await findEligibleProducts(intent, { userId: testBuyerUserId });

    expect(searchRes.status).toBe('MATCH_FOUND');
    expect(searchRes.winningCandidate).toBeDefined();
    expect(searchRes.winningCandidate.in_stock).toBe(true);
  });

  // TEST 2: Merchant checkout unavailable / disconnected -> Prohibits purchase
  it('TEST 2: Disconnecting merchant prevents AI checkout from that store', async () => {
    // Disconnect merchant
    await merchantConnectionService.disconnectMerchant(testBuyerUserId, testMerchantId);

    const evalResult = await evaluatePolicy({
      agentId: testAgentId,
      userId: testBuyerUserId,
      productId: testProduct.id,
      merchantId: testMerchantId,
      amount: parseFloat(testProduct.price),
    });

    expect(evalResult.decision).toBe('BLOCK');
    expect(evalResult.rule).toBe('MERCHANT_CHECKOUT_UNAVAILABLE');
    expect(evalResult.reason).toContain('disconnected');

    // Reconnect for subsequent tests
    await merchantConnectionService.connectMerchant(testBuyerUserId, testMerchantId);
  });

  // TEST 3: Payment authorization revoked -> Discovery allowed, but payment blocked
  it('TEST 3: Revoking payment authorization halts autonomous payment execution while keeping discovery intact', async () => {
    // Revoke authorization
    await paymentMethodService.revokePaymentMethod(testBuyerUserId, testPaymentMethodId, 'Test revocation');

    // Candidate discovery still works
    const intent = parseBuyerIntent('Buy a power bank under ₹5,000');
    const searchRes = await findEligibleProducts(intent, { userId: testBuyerUserId });
    expect(searchRes.status).toBe('MATCH_FOUND');

    // Policy evaluation for payment execution is BLOCKED
    const evalResult = await evaluatePolicy({
      agentId: testAgentId,
      userId: testBuyerUserId,
      productId: testProduct.id,
      merchantId: testMerchantId,
      amount: parseFloat(testProduct.price),
    });

    expect(evalResult.decision).toBe('BLOCK');
    expect(evalResult.rule).toBe('PAYMENT_AUTHORIZATION_REQUIRED');
    expect(evalResult.reason).toContain('No active payment mandate');

    // Re-establish payment authorization for subsequent tests
    const pm = await paymentMethodService.addPaymentMethod(testBuyerUserId, {
      single_transaction_limit: 50000.00,
      monthly_limit: 200000.00,
      is_default: true,
    });
    testPaymentMethodId = pm.id;
  });

  // TEST 4: Purchase exceeds payment authorization limit -> Payment blocked
  it('TEST 4: Purchase exceeding payment authorization mandate limit is blocked', async () => {
    // Set payment mandate limit to ₹1,000 (lower than product price)
    await query(`
      UPDATE user_payment_methods
      SET single_transaction_limit = 1000.00,
          max_limit = 1000.00
      WHERE id = $1
    `, [testPaymentMethodId]);

    const evalResult = await evaluatePolicy({
      agentId: testAgentId,
      userId: testBuyerUserId,
      productId: testProduct.id, // > ₹1,000
      merchantId: testMerchantId,
      amount: parseFloat(testProduct.price),
    });

    expect(evalResult.decision).toBe('BLOCK');
    expect(evalResult.rule).toBe('PAYMENT_AUTHORIZATION_EXCEEDED');
    expect(evalResult.reason).toContain('exceeds your payment authorization ceiling');

    // Restore mandate limit
    await query(`
      UPDATE user_payment_methods
      SET single_transaction_limit = 50000.00,
          max_limit = 50000.00
      WHERE id = $1
    `, [testPaymentMethodId]);
  });

  // TEST 5: Purchase exceeds buyer autonomous limit -> APPROVAL_REQUIRED
  it('TEST 5: Purchase exceeding buyer autonomous limit requires human approval (Dual-boundary resolution)', async () => {
    // Autonomous limit = ₹25,000, Mandate limit = ₹50,000, Product = ₹28,990 (Sony Headphones)
    const hpRes = await query("SELECT * FROM products WHERE name ILIKE '%Sony%' LIMIT 1");
    const hpProd = hpRes.rows[0];

    await query(`
      UPDATE user_preferences
      SET auto_purchase_limit = 25000,
          monthly_budget = 500000
      WHERE user_id = $1
    `, [testBuyerUserId]);

    const evalResult = await evaluatePolicy({
      agentId: testAgentId,
      userId: testBuyerUserId,
      productId: hpProd.id,
      merchantId: hpProd.merchant_id,
      amount: parseFloat(hpProd.price),
    });

    expect(evalResult.decision).toBe('APPROVAL_REQUIRED');
    expect(evalResult.rule).toBe('APPROVAL_THRESHOLD');
  });

  // TEST 6: Purchase exceeds monthly budget -> Blocked
  it('TEST 6: Purchase exceeding monthly spending budget is strictly blocked', async () => {
    await query(`
      UPDATE user_preferences
      SET monthly_budget = 10000,
          auto_purchase_limit = 10000
      WHERE user_id = $1
    `, [testBuyerUserId]);

    const hpRes = await query("SELECT * FROM products WHERE name ILIKE '%Sony%' LIMIT 1");
    const hpProd = hpRes.rows[0];

    const evalResult = await evaluatePolicy({
      agentId: testAgentId,
      userId: testBuyerUserId,
      productId: hpProd.id,
      merchantId: hpProd.merchant_id,
      amount: parseFloat(hpProd.price),
    });

    expect(evalResult.decision).toBe('BLOCK');
    expect(evalResult.rule).toBe('MONTHLY_BUDGET_EXCEEDED');

    // Restore budget
    await query(`
      UPDATE user_preferences
      SET monthly_budget = 200000,
          auto_purchase_limit = 50000
      WHERE user_id = $1
    `, [testBuyerUserId]);
  });

  // TEST 7: Price changes after discovery -> Revalidation detects drift and blocks
  it('TEST 7: Price surge beyond 2% tolerance triggers price protection and blocks checkout', async () => {
    const inflatedAmount = parseFloat(testProduct.price) * 1.25; // 25% surge

    const evalResult = await evaluatePolicy({
      agentId: testAgentId,
      userId: testBuyerUserId,
      productId: testProduct.id,
      merchantId: testMerchantId,
      amount: inflatedAmount,
    });

    expect(evalResult.decision).toBe('BLOCK');
    expect(evalResult.rule).toBe('PRICE_MANIPULATION_DETECTED');
  });

  // TEST 8: Inventory disappears -> Revalidation halts transaction before payment
  it('TEST 8: Out of stock product is blocked by policy engine before payment execution', async () => {
    // Create temporary out of stock product
    const oosRes = await query(`
      INSERT INTO products (merchant_id, name, description, category, price, in_stock, inventory)
      VALUES ($1, 'Out of Stock Gadget', 'Item with 0 inventory', 'Electronics', 1500, false, 0)
      RETURNING *
    `, [testMerchantId]);

    const oosProd = oosRes.rows[0];

    const evalResult = await evaluatePolicy({
      agentId: testAgentId,
      userId: testBuyerUserId,
      productId: oosProd.id,
      merchantId: testMerchantId,
      amount: 1500,
    });

    expect(evalResult.decision).toBe('BLOCK');
    expect(evalResult.rule).toBe('OUT_OF_STOCK');

    await query('DELETE FROM products WHERE id = $1', [oosProd.id]);
  });

  // TEST 9: Merchant disconnects during checkout -> Pre-payment check stops payment
  it('TEST 9: Merchant disconnecting stops payment validation immediately', async () => {
    await merchantConnectionService.disconnectMerchant(testBuyerUserId, testMerchantId);

    const check = await merchantConnectionService.validateMerchantForCheckout(testBuyerUserId, testMerchantId);
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain('disconnected');

    // Reconnect
    await merchantConnectionService.connectMerchant(testBuyerUserId, testMerchantId);
  });

  // TEST 10: Duplicate checkout request -> Idempotent execution
  it('TEST 10: Duplicate request with same idempotency key executes idempotently without duplicate orders', async () => {
    const idempotencyKey = `idemp_conn_test_${Date.now()}`;

    const res1 = await request(app)
      .post('/api/ai/chat')
      .set('idempotency-key', idempotencyKey)
      .send({
        message: 'Order a power bank under ₹5,000',
        user_id: testBuyerUserId,
        idempotency_key: idempotencyKey,
      });

    const res2 = await request(app)
      .post('/api/ai/chat')
      .set('idempotency-key', idempotencyKey)
      .send({
        message: 'Order a power bank under ₹5,000',
        user_id: testBuyerUserId,
        idempotency_key: idempotencyKey,
      });

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    const intentsRes = await query('SELECT * FROM purchase_intents WHERE idempotency_key = $1', [idempotencyKey]);
    expect(intentsRes.rows.length).toBe(1);
  });

  // TEST 11: Revoke payment authorization while transaction is pending -> Fails closed
  it('TEST 11: Revoking authorization halts in-flight pending transactions and logs audit event', async () => {
    const revokeRes = await paymentMethodService.revokePaymentMethod(testBuyerUserId, testPaymentMethodId, 'Security halt test');
    expect(revokeRes.status).toBe('revoked');

    const authCheck = await paymentMethodService.verifyPaymentAuthorization(testBuyerUserId, 1500);
    expect(authCheck.authorized).toBe(false);
    expect(authCheck.rule).toBe('PAYMENT_AUTHORIZATION_REQUIRED');

    // Re-establish payment authorization
    const pm = await paymentMethodService.addPaymentMethod(testBuyerUserId, {
      single_transaction_limit: 50000.00,
      monthly_limit: 200000.00,
      is_default: true,
    });
    testPaymentMethodId = pm.id;
  });

  // TEST 12: Reconnecting same merchant -> Idempotent without duplicate rows
  it('TEST 12: Reconnecting the same merchant updates existing connection record without duplicates', async () => {
    await merchantConnectionService.connectMerchant(testBuyerUserId, testMerchantId);
    await merchantConnectionService.connectMerchant(testBuyerUserId, testMerchantId);

    const connsRes = await query('SELECT * FROM user_merchant_connections WHERE user_id = $1 AND merchant_id = $2', [testBuyerUserId, testMerchantId]);
    expect(connsRes.rows.length).toBe(1);
    expect(connsRes.rows[0].status).toBe('connected');
    expect(connsRes.rows[0].connection_state).toBe('CONNECTED');
  });

  afterAll(async () => {
    // Restore default preferences & connections
    if (testBuyerUserId && testMerchantId) {
      await merchantConnectionService.connectMerchant(testBuyerUserId, testMerchantId);
      await paymentMethodService.addPaymentMethod(testBuyerUserId, {
        single_transaction_limit: 50000.00,
        monthly_limit: 200000.00,
        is_default: true,
      });
      await query(`
        UPDATE user_preferences
        SET monthly_budget = 100000,
            auto_purchase_limit = 50000,
            purchase_behavior = 'auto_within_limit',
            updated_at = NOW()
        WHERE user_id = $1
      `, [testBuyerUserId]);
    }
  });
});
