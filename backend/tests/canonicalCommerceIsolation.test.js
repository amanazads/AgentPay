import request from 'supertest';
import crypto from 'crypto';
import { app } from '../src/index.js';
import { query } from '../src/config/database.js';
import env from '../src/config/env.js';
import { generateAccessToken } from '../src/utils/authUtils.js';

describe('Canonical Production Commerce Isolation & Demo Decoupling Suite', () => {
  let buyerToken;
  let buyerUser;
  let verifiedMerchant;
  let standardProduct;
  let activeAgent;
  let activePolicy;

  beforeAll(async () => {
    // 1. Create or fetch dedicated clean test buyer user
    const uRes = await query(`
      INSERT INTO users (email, name, role)
      VALUES ('canonical_buyer@agentpay.test', 'Canonical Test Buyer', 'BUYER')
      ON CONFLICT (email) DO UPDATE SET role = 'BUYER'
      RETURNING id, email, name, role
    `);
    buyerUser = uRes.rows[0];
    buyerToken = generateAccessToken({ ...buyerUser, role: 'BUYER' });

    // 2. Fetch clean verified merchant
    const mRes = await query("SELECT * FROM merchants WHERE is_verified = true AND (is_test_lab = false OR is_test_lab IS NULL) ORDER BY created_at ASC LIMIT 1");
    verifiedMerchant = mRes.rows[0];

    // 3. Fetch in-stock product from verified merchant
    const pRes = await query(`
      SELECT * FROM products 
      WHERE merchant_id = $1 AND in_stock = true AND inventory > 0 AND (is_test_lab = false OR is_test_lab IS NULL)
      ORDER BY price ASC LIMIT 1
    `, [verifiedMerchant.id]);
    standardProduct = pRes.rows[0];

    // 4. Fetch active agent & policy with clean budget
    const aRes = await query("SELECT id, policy_id FROM agents WHERE status = 'active' LIMIT 1");
    activeAgent = aRes.rows[0];

    if (activeAgent?.policy_id) {
      await query(`
        UPDATE policies
        SET max_transaction = 200000,
            daily_budget = 500000,
            approval_threshold = 100000,
            allowed_categories = ARRAY[$1, 'Electronics', 'Peripherals', 'Hardware', 'Software & Licenses', 'Furniture', 'Power Banks', 'Audio', 'Wearables', 'Laptops']
        WHERE id = $2
      `, [standardProduct.category, activeAgent.policy_id]);
    }

    // 5. Ensure buyer has active preferences and payment mandate
    await query(`
      INSERT INTO user_preferences (user_id, monthly_budget, auto_purchase_limit, categories, preferred_brands, purchase_behavior, updated_at)
      VALUES ($1, 200000, 100000, ARRAY[$2, 'Electronics', 'Peripherals', 'Hardware', 'Power Banks', 'Audio', 'Wearables', 'Laptops'], ARRAY['Logitech', 'Sony', 'Apple', 'Ambrane'], 'auto_within_limit', NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        monthly_budget = 200000,
        auto_purchase_limit = 100000,
        categories = ARRAY[$2, 'Electronics', 'Peripherals', 'Hardware', 'Power Banks', 'Audio', 'Wearables', 'Laptops'],
        purchase_behavior = 'auto_within_limit'
    `, [buyerUser.id, standardProduct.category]);

    await query(`
      INSERT INTO user_merchant_connections (user_id, merchant_id, connection_state, catalog_status, inventory_status, checkout_status, payment_provider_status, status)
      VALUES ($1, $2, 'CONNECTED', 'HEALTHY', 'FRESH', 'AVAILABLE', 'AVAILABLE', 'connected')
      ON CONFLICT DO NOTHING
    `, [buyerUser.id, verifiedMerchant.id]);

    await query(`
      INSERT INTO user_payment_methods (user_id, provider, method_type, identifier_masked, single_transaction_limit, max_limit, daily_limit, is_default, status)
      VALUES ($1, 'razorpay', 'upi_mandate', 'buyer@oksbi', 500000.00, 500000.00, 1000000.00, true, 'active')
      ON CONFLICT DO NOTHING
    `, [buyerUser.id]);

    await query(`
      UPDATE user_payment_methods
      SET single_transaction_limit = 500000.00,
          max_limit = 500000.00,
          status = 'active',
          revoked_at = NULL
      WHERE user_id = $1
    `, [buyerUser.id]);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 1: Canonical Flow: Natural Language Discovery
  // ──────────────────────────────────────────────────────────────────────────
  test('CANONICAL 1: POST /api/buyer/search performs authoritative discovery on verified catalog', async () => {
    const res = await request(app)
      .post('/api/buyer/search')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        query: standardProduct.name.split(' ')[0],
        category: standardProduct.category,
      });

    expect(res.status).toBe(200);
    expect(res.body.products).toBeDefined();
    expect(Array.isArray(res.body.products)).toBe(true);
    expect(res.body.products.length).toBeGreaterThan(0);
    expect(res.body.products[0].id).toBeDefined();
    expect(res.body.products[0].name).toBeDefined();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 2: Canonical Flow: Cryptographic Price-Lock Quote Protocol
  // ──────────────────────────────────────────────────────────────────────────
  let canonicalQuote;
  test('CANONICAL 2: POST /api/ai/quote issues authoritative 15-minute price lock quote', async () => {
    const res = await request(app)
      .post('/api/ai/quote')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        productId: standardProduct.id,
        quantity: 1,
        deliveryMethod: 'STANDARD',
        userId: buyerUser.id,
        agentId: activeAgent.id,
        durationMinutes: 15,
      });

    expect(res.status).toBe(200);
    expect(res.body.quoteId).toBeDefined();
    expect(res.body.productId).toBe(standardProduct.id);
    expect(res.body.unitPrice).toBe(parseFloat(standardProduct.price));
    expect(res.body.totalAmount).toBeGreaterThanOrEqual(parseFloat(standardProduct.price));
    expect(res.body.signature).toBeDefined();
    expect(res.body.expiresAt).toBeDefined();
    expect(res.body.status).toBe('ACTIVE');

    canonicalQuote = res.body;
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 3: Canonical Flow: Verified Checkout Session Creation
  // ──────────────────────────────────────────────────────────────────────────
  let canonicalCheckout;
  test('CANONICAL 3: POST /api/ai/checkout establishes cryptographic checkout session', async () => {
    const res = await request(app)
      .post('/api/ai/checkout')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        quoteId: canonicalQuote.quoteId,
        productId: standardProduct.id,
        quantity: 1,
        deliveryMethod: 'STANDARD',
        agentId: activeAgent.id,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe('READY_FOR_PAYMENT');
    expect(res.body.checkoutId).toBeDefined();
    expect(res.body.quoteId).toBe(canonicalQuote.quoteId);
    expect(res.body.pricing.totalAmount).toBe(canonicalQuote.totalAmount);
    expect(res.body.signature).toBe(canonicalQuote.signature);

    canonicalCheckout = res.body;
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 4: Canonical Flow: Purchase Intent Creation & Deterministic Policy Gate
  // ──────────────────────────────────────────────────────────────────────────
  let canonicalIntent;
  test('CANONICAL 4: POST /api/purchase-intents executes deterministic policy & risk evaluation', async () => {
    const res = await request(app)
      .post('/api/purchase-intents')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        agent_id: activeAgent.id,
        product_id: standardProduct.id,
        merchant_id: verifiedMerchant.id,
        amount: canonicalQuote.totalAmount,
        quantity: 1,
        ai_reasoning: 'Autonomous purchase authorized under procurement policy',
        auto_evaluate: true,
      });

    expect(res.status).toBe(201);
    expect(res.body.purchaseIntent).toBeDefined();
    expect(res.body.purchaseIntent.id).toBeDefined();
    expect(res.body.evaluation).toBeDefined();
    expect(res.body.evaluation.decision).toBe('ALLOW');

    canonicalIntent = res.body.purchaseIntent;
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 5: Canonical Flow: Server-Authoritative Razorpay Order Creation
  // ──────────────────────────────────────────────────────────────────────────
  let canonicalPaymentOrder;
  test('CANONICAL 5: POST /api/payments/create-order creates Razorpay test order server-side', async () => {
    const res = await request(app)
      .post('/api/payments/create-order')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        purchaseIntentId: canonicalIntent.id,
        mode: 'test',
      });

    expect(res.status).toBe(201);
    expect(res.body.orderId).toBeDefined();
    expect(res.body.transactionId).toBeDefined();
    expect(res.body.currency).toBe('INR');
    expect(parseFloat(res.body.amount)).toBe(canonicalQuote.totalAmount);

    canonicalPaymentOrder = res.body;
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 6: Canonical Flow: Payment Verification & HMAC Settlement
  // ──────────────────────────────────────────────────────────────────────────
  let paymentId;
  test('CANONICAL 6: POST /api/payments/:orderId/verify settles payment via HMAC verification', async () => {
    paymentId = `pay_canonical_${Date.now()}`;
    const validSignature = crypto
      .createHmac('sha256', env.RAZORPAY_TEST_KEY_SECRET)
      .update(`${canonicalPaymentOrder.orderId}|${paymentId}`)
      .digest('hex');

    const res = await request(app)
      .post(`/api/payments/${canonicalPaymentOrder.orderId}/verify`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        transactionId: canonicalPaymentOrder.transactionId,
        razorpayPaymentId: paymentId,
        razorpaySignature: validSignature,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.verified).toBe(true);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 7: Canonical Flow: Order Inspection via Authoritative Buyer API
  // ──────────────────────────────────────────────────────────────────────────
  let canonicalOrder;
  test('CANONICAL 7: GET /api/buyer/orders returns confirmed canonical order record', async () => {
    const res = await request(app)
      .get('/api/buyer/orders')
      .set('Authorization', `Bearer ${buyerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.orders).toBeDefined();
    expect(res.body.orders.length).toBeGreaterThan(0);

    const matching = res.body.orders.find((o) => o.transaction_id === canonicalPaymentOrder.transactionId);
    expect(matching).toBeDefined();
    expect(matching.order_number).toMatch(/^AGP-ORD-/);
    expect(matching.payment_status).toBe('VERIFIED');
    expect(parseFloat(matching.total_amount)).toBe(canonicalQuote.totalAmount);

    canonicalOrder = matching;
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 8: Canonical Flow: GST Tax Invoice Inspection
  // ──────────────────────────────────────────────────────────────────────────
  test('CANONICAL 8: GET /api/buyer/invoices/:orderId returns structured GST tax invoice', async () => {
    const res = await request(app)
      .get(`/api/buyer/invoices/${canonicalOrder.id}`)
      .set('Authorization', `Bearer ${buyerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.invoice).toBeDefined();
    expect(res.body.invoice.invoice_number).toMatch(/^INV-/);
    expect(res.body.invoice.tax).toBeDefined();
    expect(parseFloat(res.body.invoice.total_amount)).toBe(canonicalQuote.totalAmount);
    expect(res.body.invoice.payment_status).toBe('PAID');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 9: Production Integrity: Non-Existent Products Fail Closed with 404
  // ──────────────────────────────────────────────────────────────────────────
  test('INTEGRITY 9: Non-existent product ID fails closed with 404 and NEVER auto-creates demo store', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';

    // 1. Quote attempt on fake product
    const quoteRes = await request(app)
      .post('/api/ai/quote')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        productId: fakeId,
        quantity: 1,
      });

    expect(quoteRes.status).toBe(404);
    expect(quoteRes.body.error).toContain('not found');

    // 2. Purchase intent attempt on fake product
    const intentRes = await request(app)
      .post('/api/purchase-intents')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        agent_id: activeAgent.id,
        product_id: fakeId,
        amount: 5000,
      });

    expect(intentRes.status).toBe(404);
    expect(intentRes.body.error).toContain('not found');

    // 3. Verify that zero mock merchants were inserted into PostgreSQL
    const mockCheck = await query("SELECT COUNT(*) FROM merchants WHERE name = 'AutoGeneratedDummyStore'");
    expect(parseInt(mockCheck.rows[0].count, 10)).toBe(0);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 10: Simulation Namespace Isolation
  // ──────────────────────────────────────────────────────────────────────────
  test('SIMULATION 10: Simulation lab endpoints remain functional under /api/simulation/commerce', async () => {
    // 1. Readiness scorecard
    const readRes = await request(app).get('/api/simulation/commerce/catalog-readiness');
    expect(readRes.status).toBe(200);
    expect(readRes.body.success).toBe(true);
    const score = readRes.body.readiness?.overallScore ?? readRes.body.readinessScore;
    expect(score).toBeGreaterThanOrEqual(80);

    // 2. Surge protection simulation
    const surgeRes = await request(app).post('/api/simulation/commerce/test-surge-protection');
    expect(surgeRes.status).toBe(200);
    expect(surgeRes.body.decision).toBe('BLOCK');
    expect(surgeRes.body.orderStatus).toBe('NOT CREATED');

    // 3. Signature verification failure simulation
    const sigRes = await request(app).post('/api/simulation/commerce/test-signature-verification');
    expect(sigRes.status).toBe(200);
    expect(sigRes.body.orderStatus).toBe('NOT CONFIRMED');
    expect(sigRes.body.decision).toBe('STOPPED_AT_PAYMENT_GATE');
  });
});
