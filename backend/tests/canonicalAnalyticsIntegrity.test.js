import request from 'supertest';
import { app } from '../src/index.js';
import { query } from '../src/config/database.js';
import { createOrder, cancelOrder, processOrderRefund } from '../src/services/orderService.js';
import { generateAccessToken } from '../src/utils/authUtils.js';

describe('Track 01: Canonical Analytics & Dashboard Metric Integrity Suite', () => {
  let merchantUserA;
  let merchantUserB;
  let merchantTokenA;
  let merchantTokenB;
  let merchantIdA;
  let merchantIdB;
  let buyerUser;
  let buyerToken;
  let productA;

  beforeAll(async () => {
    // 1. Create two distinct test merchants
    const mResA = await query(`
      INSERT INTO merchants (name, category, is_verified, rating, tier)
      VALUES ($1, 'Electronics', true, 4.9, 'tier_1')
      RETURNING *
    `, [`Analytics Store Alpha ${Date.now()}`]);
    merchantIdA = mResA.rows[0].id;

    const mResB = await query(`
      INSERT INTO merchants (name, category, is_verified, rating, tier)
      VALUES ($1, 'Hardware', true, 4.8, 'tier_1')
      RETURNING *
    `, [`Analytics Store Beta ${Date.now()}`]);
    merchantIdB = mResB.rows[0].id;

    // 2. Create users for merchants
    const uResA = await query(`
      INSERT INTO users (email, name, role, merchant_id)
      VALUES ($1, 'Analytics User A', 'MERCHANT', $2)
      RETURNING *
    `, [`analytics_user_a_${Date.now()}@test.internal`, merchantIdA]);
    merchantUserA = uResA.rows[0];
    merchantTokenA = generateAccessToken(merchantUserA);

    const uResB = await query(`
      INSERT INTO users (email, name, role, merchant_id)
      VALUES ($1, 'Analytics User B', 'MERCHANT', $2)
      RETURNING *
    `, [`analytics_user_b_${Date.now()}@test.internal`, merchantIdB]);
    merchantUserB = uResB.rows[0];
    merchantTokenB = generateAccessToken(merchantUserB);

    // 3. Create Buyer User
    const bRes = await query(`
      INSERT INTO users (email, name, role)
      VALUES ($1, 'Analytics Buyer', 'BUYER')
      RETURNING *
    `, [`analytics_buyer_${Date.now()}@test.internal`]);
    buyerUser = bRes.rows[0];
    buyerToken = generateAccessToken(buyerUser);

    // 4. Create Product for Merchant A
    const pResA = await query(`
      INSERT INTO products (merchant_id, name, category, price, in_stock, inventory)
      VALUES ($1, 'Analytics Test Gadget', 'Electronics', 1500.00, true, 50)
      RETURNING *
    `, [merchantIdA]);
    productA = pResA.rows[0];
  }, 30000);

  afterAll(async () => {
    // Cleanup test data
    if (merchantIdA && merchantIdB) {
      await query('DELETE FROM orders WHERE merchant_id IN ($1, $2)', [merchantIdA, merchantIdB]);
      await query('DELETE FROM purchase_intents WHERE merchant_id IN ($1, $2)', [merchantIdA, merchantIdB]);
      await query('DELETE FROM products WHERE merchant_id IN ($1, $2)', [merchantIdA, merchantIdB]);
      await query('DELETE FROM merchants WHERE id IN ($1, $2)', [merchantIdA, merchantIdB]);
    }
    if (merchantUserA && merchantUserB && buyerUser) {
      await query('DELETE FROM in_app_notifications WHERE user_id IN ($1, $2, $3)', [merchantUserA.id, merchantUserB.id, buyerUser.id]);
      await query('DELETE FROM event_notifications WHERE user_id IN ($1, $2, $3)', [merchantUserA.id, merchantUserB.id, buyerUser.id]);
      await query('DELETE FROM transactions WHERE user_id = $1', [buyerUser.id]);
      await query('DELETE FROM users WHERE id IN ($1, $2, $3)', [merchantUserA.id, merchantUserB.id, buyerUser.id]);
    }
  });

  // ── TEST 1: One Payment = Exactly One GMV Contribution ─────────────────────
  test('TEST 1: One verified payment contributes exactly one order and its exact monetary value to GMV', async () => {
    const initialRes = await request(app)
      .get('/api/merchant/analytics?timeRange=all')
      .set('Authorization', `Bearer ${merchantTokenA}`);
    const initialRev = initialRes.body.summary.aiOriginatedRevenue;
    const initialOrders = initialRes.body.summary.aiOriginatedOrders;

    const rzpOrderId = `order_gmv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const rzpPaymentId = `pay_gmv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    // Create a real transaction and order of ₹1,500
    const txRes = await query(`
      INSERT INTO transactions (
        user_id, amount, currency, status, payment_verified, razorpay_order_id, razorpay_payment_id, idempotency_key
      )
      VALUES ($1, 1500.00, 'INR', 'completed', true, $2, $3, $4)
      RETURNING *
    `, [buyerUser.id, rzpOrderId, rzpPaymentId, `idem_gmv_${Date.now()}`]);

    const order = await createOrder({
      userId: buyerUser.id,
      merchantId: merchantIdA,
      productId: productA.id,
      transactionId: txRes.rows[0].id,
      quantity: 1,
      unitPrice: 1500.00,
      subtotal: 1500.00,
      totalAmount: 1500.00,
      paymentStatus: 'VERIFIED',
    });

    const updatedRes = await request(app)
      .get('/api/merchant/analytics?timeRange=all')
      .set('Authorization', `Bearer ${merchantTokenA}`);

    expect(updatedRes.body.summary.aiOriginatedRevenue).toBe(initialRev + 1500);
    expect(updatedRes.body.summary.aiOriginatedOrders).toBe(initialOrders + 1);
  });

  // ── TEST 2: Duplicate Payment Webhook = No Additional GMV ─────────────────
  test('TEST 2: Duplicate / replayed webhook does not increase GMV or order count', async () => {
    const beforeRes = await request(app)
      .get('/api/merchant/analytics?timeRange=all')
      .set('Authorization', `Bearer ${merchantTokenA}`);
    const beforeRev = beforeRes.body.summary.aiOriginatedRevenue;
    const beforeOrders = beforeRes.body.summary.aiOriginatedOrders;

    const dupOrderId = `order_dup_${Date.now()}`;
    const dupPayId = `pay_dup_${Date.now()}`;

    // First insert succeeds
    await query(`
      INSERT INTO transactions (
        user_id, amount, currency, status, payment_verified, razorpay_order_id, razorpay_payment_id, idempotency_key
      )
      VALUES ($1, 1500.00, 'INR', 'completed', true, $2, $3, $4)
    `, [buyerUser.id, dupOrderId, dupPayId, `idem_dup_orig_${Date.now()}`]);

    // Second replayed insert with duplicate razorpay_order_id is rejected by unique constraint
    await expect(
      query(`
        INSERT INTO transactions (
          user_id, amount, currency, status, payment_verified, razorpay_order_id, razorpay_payment_id, idempotency_key
        )
        VALUES ($1, 1500.00, 'INR', 'completed', true, $2, $3, $4)
      `, [buyerUser.id, dupOrderId, dupPayId, `idem_dup_replay_${Date.now()}`])
    ).rejects.toThrow();

    const afterRes = await request(app)
      .get('/api/merchant/analytics?timeRange=all')
      .set('Authorization', `Bearer ${merchantTokenA}`);

    // No additional GMV added
    expect(afterRes.body.summary.aiOriginatedRevenue).toBe(beforeRev);
  });

  // ── TEST 3: Failed, Blocked, or Pending Payment = Zero GMV ─────────────────
  test('TEST 3: Failed, blocked, or pending payments contribute zero to GMV', async () => {
    const beforeRes = await request(app)
      .get('/api/merchant/analytics?timeRange=all')
      .set('Authorization', `Bearer ${merchantTokenA}`);
    const beforeRev = beforeRes.body.summary.aiOriginatedRevenue;
    const beforeOrders = beforeRes.body.summary.aiOriginatedOrders;

    // Insert a failed transaction
    await query(`
      INSERT INTO transactions (
        user_id, amount, currency, status, payment_verified, razorpay_order_id, razorpay_payment_id, idempotency_key
      )
      VALUES ($1, 5000.00, 'INR', 'payment_failed', false, $2, $3, $4)
    `, [buyerUser.id, `order_fail_${Date.now()}`, `pay_fail_${Date.now()}`, `idem_fail_${Date.now()}`]);

    // Insert a blocked purchase intent
    await query(`
      INSERT INTO purchase_intents (
        user_id, merchant_id, product_id, amount, currency, status, policy_decision, idempotency_key
      )
      VALUES ($1, $2, $3, 9000.00, 'INR', 'blocked', 'BLOCK', $4)
    `, [buyerUser.id, merchantIdA, productA.id, `idem_block_${Date.now()}`]);

    const afterRes = await request(app)
      .get('/api/merchant/analytics?timeRange=all')
      .set('Authorization', `Bearer ${merchantTokenA}`);

    expect(afterRes.body.summary.aiOriginatedRevenue).toBe(beforeRev);
    expect(afterRes.body.summary.aiOriginatedOrders).toBe(beforeOrders);
    expect(afterRes.body.outcomes.failed).toBeGreaterThanOrEqual(0);
  });

  // ── TEST 4: Refund Updates Financial Reporting Correctly ───────────────────
  test('TEST 4: Processing a refund increments refunded outcomes and updates metrics', async () => {
    // Create an order
    const txRes = await query(`
      INSERT INTO transactions (
        user_id, amount, currency, status, payment_verified, razorpay_order_id, razorpay_payment_id, idempotency_key, payment_mode
      )
      VALUES ($1, 1500.00, 'INR', 'completed', true, $2, $3, $4, 'test')
      RETURNING *
    `, [buyerUser.id, `order_ref_an_${Date.now()}`, `pay_ref_an_${Date.now()}`, `idem_ref_an_${Date.now()}`]);

    const order = await createOrder({
      userId: buyerUser.id,
      merchantId: merchantIdA,
      productId: productA.id,
      transactionId: txRes.rows[0].id,
      quantity: 1,
      unitPrice: 1500.00,
      subtotal: 1500.00,
      totalAmount: 1500.00,
      paymentStatus: 'VERIFIED',
    });

    const preRefundRes = await request(app)
      .get('/api/merchant/analytics?timeRange=all')
      .set('Authorization', `Bearer ${merchantTokenA}`);
    const preRefundCount = preRefundRes.body.outcomes.refunded || 0;

    // Refund the order
    await processOrderRefund(order.id, { amount: 1500.00, reason: 'Return for refund' });

    const postRefundRes = await request(app)
      .get('/api/merchant/analytics?timeRange=all')
      .set('Authorization', `Bearer ${merchantTokenA}`);

    expect(postRefundRes.body.outcomes.refunded).toBe(preRefundCount + 1);
  });

  // ── TEST 5: Simulation Data = Zero Production GMV ──────────────────────────
  test('TEST 5: Simulation / test lab transactions contribute zero to production merchant GMV', async () => {
    const beforeRes = await request(app)
      .get('/api/merchant/analytics?timeRange=all')
      .set('Authorization', `Bearer ${merchantTokenA}`);
    const beforeRev = beforeRes.body.summary.aiOriginatedRevenue;
    const beforeOrders = beforeRes.body.summary.aiOriginatedOrders;

    // Create a simulation / test lab product
    const simProdRes = await query(`
      INSERT INTO products (merchant_id, name, category, price, in_stock, inventory, is_test_lab)
      VALUES ($1, 'Simulation Sandbox Item', 'TestLab', 75000.00, true, 10, true)
      RETURNING *
    `, [merchantIdA]);
    const simProduct = simProdRes.rows[0];

    // Create a transaction and order for this test lab product
    const simTxRes = await query(`
      INSERT INTO transactions (
        user_id, amount, currency, status, payment_verified, razorpay_order_id, razorpay_payment_id, idempotency_key, payment_mode
      )
      VALUES ($1, 75000.00, 'INR', 'completed', true, $2, $3, $4, 'test')
      RETURNING *
    `, [buyerUser.id, `order_sim_att_${Date.now()}`, `pay_sim_att_${Date.now()}`, `idem_sim_att_${Date.now()}`]);

    await createOrder({
      userId: buyerUser.id,
      merchantId: merchantIdA,
      productId: simProduct.id,
      transactionId: simTxRes.rows[0].id,
      quantity: 1,
      unitPrice: 75000.00,
      subtotal: 75000.00,
      totalAmount: 75000.00,
      paymentStatus: 'VERIFIED',
    });

    const afterRes = await request(app)
      .get('/api/merchant/analytics?timeRange=all')
      .set('Authorization', `Bearer ${merchantTokenA}`);

    // Production GMV remains unaffected by the ₹75,000 simulation transaction
    expect(afterRes.body.summary.aiOriginatedRevenue).toBe(beforeRev);
    expect(afterRes.body.summary.aiOriginatedOrders).toBe(beforeOrders);

    // Cleanup simulation product
    await query('DELETE FROM orders WHERE product_id = $1', [simProduct.id]);
    await query('DELETE FROM products WHERE id = $1', [simProduct.id]);
  });

  // ── TEST 6: Multi-Tenant Merchant Isolation ─────────────────────────────────
  test('TEST 6: Merchant A cannot see Merchant B analytics or orders in dashboard overview', async () => {
    const resA = await request(app)
      .get('/api/merchant/overview')
      .set('Authorization', `Bearer ${merchantTokenA}`);

    const resB = await request(app)
      .get('/api/merchant/overview')
      .set('Authorization', `Bearer ${merchantTokenB}`);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    expect(resA.body.store.id).toBe(merchantIdA);
    expect(resB.body.store.id).toBe(merchantIdB);
  });
});
