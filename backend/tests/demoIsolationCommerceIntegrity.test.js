import request from 'supertest';
import app from '../src/index.js';
import { query } from '../src/config/database.js';
import { generateAccessToken } from '../src/utils/authUtils.js';
import { executeSecurityScenario, SCENARIOS } from '../src/services/securityTestService.js';
import { resetDemoData } from '../src/services/demoResetService.js';
import { generateQuote, verifyQuoteForCheckout } from '../src/services/quoteService.js';
import { reserveInventory, commitReservation } from '../src/services/inventoryService.js';
import { createOrder } from '../src/services/orderService.js';
import env from '../src/config/env.js';

describe('Track 01: Demo Isolation & Core Commerce Independence Suite', () => {
  let organicBuyer, organicMerchantUser, organicMerchant;
  let organicBuyerToken, organicMerchantToken;
  let organicProduct;
  const nonce = Date.now();

  beforeAll(async () => {
    // 1. Create a 100% organic, non-demo merchant
    const mRes = await query(`
      INSERT INTO merchants (name, category, is_verified, risk_level, rating, description, is_test_lab)
      VALUES ('Organic Enterprise Store ' || $1, 'Industrial Hardware', true, 'low', 4.95, 'Independent production-ready merchant store', false)
      RETURNING *
    `, [nonce]);
    organicMerchant = mRes.rows[0];

    // 2. Create merchant user
    const muRes = await query(`
      INSERT INTO users (email, name, role, merchant_id)
      VALUES ('merchant_organic_' || $1 || '@organicstore.com', 'Organic Merchant Owner', 'merchant', $2)
      RETURNING *
    `, [nonce, organicMerchant.id]);
    organicMerchantUser = muRes.rows[0];
    organicMerchantToken = generateAccessToken(organicMerchantUser);

    // 3. Create organic buyer user
    const buRes = await query(`
      INSERT INTO users (email, name, role)
      VALUES ('buyer_organic_' || $1 || '@enterprisecorp.com', 'Organic Enterprise Buyer', 'user')
      RETURNING *
    `, [nonce]);
    organicBuyer = buRes.rows[0];
    organicBuyerToken = generateAccessToken(organicBuyer);

    // Set buyer preferences
    await query(`
      INSERT INTO user_preferences (user_id, monthly_budget, auto_purchase_limit, categories, preferred_brands)
      VALUES ($1, 500000, 50000, ARRAY['Industrial Hardware', 'Electronics'], ARRAY['IndustrialBrand'])
      ON CONFLICT (user_id) DO UPDATE SET monthly_budget = 500000, auto_purchase_limit = 50000
    `, [organicBuyer.id]);

    // Create organic product via merchant API or direct DB
    const pRes = await query(`
      INSERT INTO products (merchant_id, sku, name, description, brand, category, price, currency, inventory, in_stock, specifications, status, is_test_lab)
      VALUES ($1, 'SKU-ORG-' || $2, 'Precision Optical Calibrator', 'Industrial grade measurement tool', 'IndustrialBrand', 'Industrial Hardware', 14500, 'INR', 20, true, '{"precision":"0.001mm"}'::jsonb, 'ACTIVE', false)
      RETURNING *
    `, [organicMerchant.id, nonce]);
    organicProduct = pRes.rows[0];
  });

  // ── TEST 1: Full Normal Commerce Lifecycle Independent of Demo Fixtures ────
  test('TEST 1: Normal commerce flow completes end-to-end without requiring demo seed state', async () => {
    // 1. Generate Quote
    const quote = await generateQuote({
      productId: organicProduct.id,
      merchantId: organicMerchant.id,
      quantity: 2,
      buyerId: organicBuyer.id,
    });

    expect(quote.quoteId).toBeDefined();
    expect(quote.totalAmount).toBe(29000);
    expect(quote.signature).toBeDefined();

    // 2. Verify Quote
    const verification = await verifyQuoteForCheckout(quote, { buyerId: organicBuyer.id });
    expect(verification.valid).toBe(true);

    // 3. Reserve Inventory
    const reservation = await reserveInventory({
      productId: organicProduct.id,
      quantity: 2,
      quoteId: quote.quoteId,
      leaseSeconds: 900,
    });
    expect(reservation.status).toBe('RESERVED');
    expect(reservation.quantity).toBe(2);

    // 4. Create Transaction & Order
    const rzpOrderId = `rzp_order_org_${nonce}`;
    const txRes = await query(`
      INSERT INTO transactions (user_id, amount, currency, status, razorpay_order_id, razorpay_payment_id, environment)
      VALUES ($1, $2, 'INR', 'verified', $3, $4, 'TEST')
      RETURNING *
    `, [organicBuyer.id, quote.totalAmount, rzpOrderId, `pay_org_${nonce}`]);
    const tx = txRes.rows[0];

    const order = await createOrder({
      purchaseIntentId: null,
      transactionId: tx.id,
      userId: organicBuyer.id,
      merchantId: organicMerchant.id,
      productId: organicProduct.id,
      productName: organicProduct.name,
      quantity: 2,
      unitPrice: 14500,
      subtotal: 29000,
      totalAmount: 29000,
      deliveryAddress: { street: '100 Enterprise Way', city: 'Bengaluru', pincode: '560001' },
      environment: 'TEST',
    });

    expect(order.id).toBeDefined();
    expect(parseFloat(order.total_amount)).toBe(29000);
    expect(order.merchant_id).toBe(organicMerchant.id);

    // 5. Commit Reservation
    const commit = await commitReservation(reservation.reservationId);
    expect(commit.success).toBe(true);
    expect(commit.reservation.status).toBe('COMMITTED');

    // 6. Verify Remaining Stock (20 - 2 = 18)
    const pCheck = await query('SELECT inventory FROM products WHERE id = $1', [organicProduct.id]);
    expect(pCheck.rows[0].inventory).toBe(18);
  });

  // ── TEST 2: Security Lab Executes Scenarios Without Mutating User State ─────
  test('TEST 2: Security Lab scenarios execute through core engines without altering buyer policies', async () => {
    // Check baseline budget
    const beforePref = await query('SELECT monthly_budget, auto_purchase_limit FROM user_preferences WHERE user_id = $1', [organicBuyer.id]);
    expect(parseFloat(beforePref.rows[0].monthly_budget)).toBe(500000);

    // Run Security Lab Attack Scenario
    const result = await executeSecurityScenario('over_budget', null);
    expect(result.actualDecision).toBe('BLOCK');
    expect(result.passed).toBe(true);

    // Run Prompt Injection Scenario
    const injResult = await executeSecurityScenario('prompt_injection', null);
    expect(injResult.actualDecision).toBe('BLOCK');
    expect(injResult.passed).toBe(true);

    // Verify buyer policy is unchanged
    const afterPref = await query('SELECT monthly_budget, auto_purchase_limit FROM user_preferences WHERE user_id = $1', [organicBuyer.id]);
    expect(parseFloat(afterPref.rows[0].monthly_budget)).toBe(500000);
    expect(parseFloat(afterPref.rows[0].auto_purchase_limit)).toBe(50000);
  });

  // ── TEST 3: Demo Reset Scoping & Production Safety Shield ───────────────────
  test('TEST 3: Demo Reset in production preserves LIVE customer orders', async () => {
    // Insert a LIVE order record
    const liveTx = await query(`
      INSERT INTO transactions (user_id, amount, currency, status, razorpay_order_id, razorpay_payment_id, environment)
      VALUES ($1, 14500, 'INR', 'verified', 'rzp_live_test_order_' || $2, 'pay_live_test_' || $2, 'LIVE')
      RETURNING *
    `, [organicBuyer.id, nonce]);

    const liveOrd = await query(`
      INSERT INTO orders (order_number, transaction_id, user_id, merchant_id, product_id, product_name, quantity, unit_price, subtotal, total_amount, delivery_address, environment)
      VALUES ('ORD-LIVE-' || $2, $1, $3, $4, $5, 'Live Precision Calibrator', 1, 14500, 14500, 14500, '{"city":"Bengaluru"}'::jsonb, 'LIVE')
      RETURNING *
    `, [liveTx.rows[0].id, nonce, organicBuyer.id, organicMerchant.id, organicProduct.id]);

    // Simulate reset with production flag
    const originalIsProd = env.isProduction;
    env.isProduction = true;

    try {
      const resetResult = await resetDemoData(null);
      expect(resetResult.success).toBe(true);

      // Verify LIVE order was NOT deleted
      const checkLiveOrder = await query('SELECT id, environment FROM orders WHERE id = $1', [liveOrd.rows[0].id]);
      expect(checkLiveOrder.rows.length).toBe(1);
      expect(checkLiveOrder.rows[0].environment).toBe('LIVE');
    } finally {
      env.isProduction = originalIsProd;
      // Clean up test live order
      await query('DELETE FROM orders WHERE id = $1', [liveOrd.rows[0].id]);
      await query('DELETE FROM transactions WHERE id = $1', [liveTx.rows[0].id]);
    }
  });

  // ── TEST 4: Security Lab Scenarios List Integrity ───────────────────────────
  test('TEST 4: Security Lab exposes complete suite of attack vectors', async () => {
    const res = await request(app).get('/api/security-tests/scenarios');
    expect(res.status).toBe(200);
    expect(res.body.scenarios.length).toBeGreaterThanOrEqual(7);
    expect(res.body.scenarios.some(s => s.id === 'over_budget')).toBe(true);
    expect(res.body.scenarios.some(s => s.id === 'prompt_injection')).toBe(true);
    expect(res.body.scenarios.some(s => s.id === 'price_manipulation')).toBe(true);
  });
});
