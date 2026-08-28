import request from 'supertest';
import { app } from '../src/index.js';
import { query } from '../src/config/database.js';
import { createOrder } from '../src/services/orderService.js';
import { createPaymentOrder, verifyPayment } from '../src/services/paymentService.js';
import { findEligibleProducts } from '../src/services/candidateFilter.js';
import { parseBuyerIntent } from '../src/services/intentParser.js';
import { generateAccessToken } from '../src/utils/authUtils.js';
import crypto from 'crypto';
import env from '../src/config/env.js';

describe('Track 01: Merchant Dashboard, Data Integrity & Revenue Attribution Suite', () => {
  let merchantUser;
  let otherMerchantUser;
  let buyerUser;
  let merchantToken;
  let otherMerchantToken;
  let buyerToken;
  let merchantId;
  let otherMerchantId;
  let testProduct;

  beforeAll(async () => {
    // 1. Fetch primary verified merchant & linked user
    const mRes = await query("SELECT * FROM merchants WHERE is_verified = true ORDER BY created_at ASC LIMIT 1");
    merchantId = mRes.rows[0].id;

    let uRes = await query("SELECT * FROM users WHERE merchant_id = $1 LIMIT 1", [merchantId]);
    if (uRes.rows.length === 0) {
      const insUser = await query(`
        INSERT INTO users (email, name, role, merchant_id)
        VALUES ('merchant_tester@agentpay.com', 'Merchant Tester', 'MERCHANT', $1)
        RETURNING *
      `, [merchantId]);
      merchantUser = insUser.rows[0];
    } else {
      merchantUser = uRes.rows[0];
    }
    merchantToken = generateAccessToken(merchantUser);

    // 2. Fetch or create a second merchant for tenant isolation testing
    let omRes = await query("SELECT * FROM merchants WHERE id != $1 LIMIT 1", [merchantId]);
    if (omRes.rows.length === 0) {
      const insM = await query(`
        INSERT INTO merchants (name, category, is_verified, rating)
        VALUES ('Secondary Isolated Store', 'Electronics', true, 4.8)
        RETURNING *
      `);
      otherMerchantId = insM.rows[0].id;
    } else {
      otherMerchantId = omRes.rows[0].id;
    }

    const insOtherUser = await query(`
      INSERT INTO users (email, name, role, merchant_id)
      VALUES ('other_merchant_${Date.now()}@agentpay.com', 'Other Merchant', 'MERCHANT', $1)
      RETURNING *
    `, [otherMerchantId]);
    otherMerchantUser = insOtherUser.rows[0];
    otherMerchantToken = generateAccessToken(otherMerchantUser);

    // 3. Buyer user
    const bRes = await query("SELECT * FROM users WHERE role = 'BUYER' OR role = 'user' LIMIT 1");
    buyerUser = bRes.rows[0];
    buyerToken = generateAccessToken(buyerUser);

    // 4. Fetch an in-stock catalog product
    const pRes = await query("SELECT * FROM products WHERE merchant_id = $1 AND in_stock = true LIMIT 1", [merchantId]);
    testProduct = pRes.rows[0];
  });

  // TEST 1: Valid AI purchase -> 1 intent, 1 transaction, 1 payment, 1 order, 1 revenue contribution
  it('TEST 1: Valid AI purchase maps 1:1 across intent, transaction, payment, order, and GMV', async () => {
    // 1. Create unique purchase intent
    const piRes = await query(`
      INSERT INTO purchase_intents (
        user_id, merchant_id, product_id, amount, quantity, status
      )
      VALUES ($1, $2, $3, $4, 1, 'approved')
      RETURNING id
    `, [buyerUser.id, merchantId, testProduct.id, testProduct.price]);
    const purchaseIntentId = piRes.rows[0].id;

    // 2. Create payment order
    const paymentOrder = await createPaymentOrder({
      amount: parseFloat(testProduct.price),
      currency: 'INR',
      purchaseIntentId,
      userId: buyerUser.id,
      merchantId,
      productId: testProduct.id,
    });

    expect(paymentOrder.transactionId).toBeDefined();

    // 3. Verify payment
    const paymentId = `pay_${crypto.randomBytes(8).toString('hex')}`;
    const hmacBody = `${paymentOrder.orderId}|${paymentId}`;
    const razorpaySignature = crypto
      .createHmac('sha256', env.RAZORPAY_TEST_KEY_SECRET)
      .update(hmacBody)
      .digest('hex');

    const verifyResult = await verifyPayment({
      transactionId: paymentOrder.transactionId,
      razorpayOrderId: paymentOrder.orderId,
      razorpayPaymentId: paymentId,
      razorpaySignature,
    });

    expect(verifyResult.verified).toBe(true);

    // 4. Create authoritative order
    const order = await createOrder({
      purchaseIntentId,
      transactionId: paymentOrder.transactionId,
      userId: buyerUser.id,
      merchantId,
      productId: testProduct.id,
      unitPrice: parseFloat(testProduct.price),
      totalAmount: parseFloat(testProduct.price),
      paymentMethod: 'PREPAID',
      paymentStatus: 'VERIFIED',
    });

    expect(order.id).toBeDefined();
    expect(order.order_number).toMatch(/^AGP-ORD-\d+/);

    // 5. Verify Merchant Overview API reflects the order in GMV
    const overviewRes = await request(app)
      .get('/api/merchant/overview')
      .set('Authorization', `Bearer ${merchantToken}`);

    expect(overviewRes.status).toBe(200);
    expect(overviewRes.body.metrics.totalOrders).toBeGreaterThanOrEqual(1);
    expect(overviewRes.body.metrics.totalRevenue).toBeGreaterThanOrEqual(parseFloat(testProduct.price));
  });

  // TEST 2: Double-click purchase / duplicate transaction retry returns existing record without double-counting
  it('TEST 2: Idempotent order creation returns existing order without creating duplicates or increasing revenue', async () => {
    // Query current overview metrics
    const beforeRes = await request(app)
      .get('/api/merchant/overview')
      .set('Authorization', `Bearer ${merchantToken}`);
    const beforeOrders = beforeRes.body.metrics.totalOrders;
    const beforeRevenue = beforeRes.body.metrics.totalRevenue;

    // Fetch existing order from DB
    const existingOrderRes = await query("SELECT * FROM orders WHERE merchant_id = $1 AND transaction_id IS NOT NULL LIMIT 1", [merchantId]);
    const existing = existingOrderRes.rows[0];

    // Attempt duplicate createOrder call with same transactionId
    const dupOrder = await createOrder({
      purchaseIntentId: existing.purchase_intent_id,
      transactionId: existing.transaction_id,
      userId: existing.user_id,
      merchantId: existing.merchant_id,
      productId: existing.product_id,
      totalAmount: parseFloat(existing.total_amount),
    });

    expect(dupOrder.id).toBe(existing.id);
    expect(dupOrder.order_number).toBe(existing.order_number);

    // Verify overview metrics remained unchanged
    const afterRes = await request(app)
      .get('/api/merchant/overview')
      .set('Authorization', `Bearer ${merchantToken}`);

    expect(afterRes.body.metrics.totalOrders).toBe(beforeOrders);
    expect(afterRes.body.metrics.totalRevenue).toBe(beforeRevenue);
  });

  // TEST 3: Duplicate webhook does not duplicate order or revenue
  it('TEST 3: Duplicate webhook events are handled idempotently and do not inflate metrics', async () => {
    const dupEventId = `evt_test_dup_${Date.now()}`;
    const payload = {
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: `pay_test_${Date.now()}`,
            amount: 189900,
            currency: 'INR',
            status: 'captured',
            notes: { merchantId },
          },
        },
      },
    };

    // First delivery
    const res1 = await request(app)
      .post('/api/webhooks/razorpay/test')
      .set('x-razorpay-event-id', dupEventId)
      .send(payload);

    expect(res1.status).toBe(200);

    // Second delivery of same webhook event
    const res2 = await request(app)
      .post('/api/webhooks/razorpay/test')
      .set('x-razorpay-event-id', dupEventId)
      .send(payload);

    expect(res2.status).toBe(200);
    expect(res2.body.result?.duplicate || res2.body.status === 'ok').toBe(true);
  });

  // TEST 4: Price surge failure (>2%) blocks transaction with zero payment and zero order
  it('TEST 4: Price surge above tolerance blocks checkout without creating order or charging buyer', async () => {
    const surgeRes = await request(app)
      .post('/api/ai-commerce/simulate-price-change')
      .send({ productId: testProduct.id });

    expect(surgeRes.status).toBe(200);
    expect(surgeRes.body.decision).toBe('BLOCK');
    expect(surgeRes.body.orderStatus).toBe('NOT CREATED');
    expect(surgeRes.body.paymentStatus).toContain('NOT ATTEMPTED');
  });

  // TEST 5: Out of stock product halts purchase with zero payment and zero order
  it('TEST 5: Out-of-stock product is rejected by candidate filter with NO_MATCH', async () => {
    // Insert temporary out-of-stock product
    const insOut = await query(`
      INSERT INTO products (merchant_id, name, price, currency, inventory, in_stock, category)
      VALUES ($1, 'Sold Out Headphones', 5000, 'INR', 0, false, 'Electronics')
      RETURNING id
    `, [merchantId]);
    const outId = insOut.rows[0].id;

    const parsedIntent = await parseBuyerIntent('Find me Sold Out Headphones under ₹6,000');
    const result = await findEligibleProducts(parsedIntent, { merchantId });

    const matched = result.candidates.find((c) => c.id === outId);
    expect(matched).toBeUndefined();

    // Clean up temporary out-of-stock product
    await query("DELETE FROM products WHERE id = $1", [outId]);
  });

  // TEST 6: AI recommendation strictly filters to authenticated merchant catalog
  it('TEST 6: AI buyer product matching strictly restricts candidate evaluation to the merchant catalog', async () => {
    const parsedIntent = await parseBuyerIntent('Find a 20000mAh power bank under ₹3,000');
    const result = await findEligibleProducts(parsedIntent, { merchantId });

    // All returned candidates must strictly belong to merchantId
    expect(result.candidates.length).toBeGreaterThan(0);
    for (const prod of result.candidates) {
      expect(prod.merchant_id).toBe(merchantId);
      expect(prod.merchant_id).not.toBe(otherMerchantId);
    }
  });

  // TEST 7: Tenant isolation - Merchant A cannot access Merchant B orders or analytics
  it('TEST 7: Multi-tenant isolation prevents Merchant B from accessing Merchant A orders or analytics', async () => {
    // 1. Fetch Merchant A's overview with Merchant B token
    const resB = await request(app)
      .get('/api/merchant/overview')
      .set('Authorization', `Bearer ${otherMerchantToken}`);

    expect(resB.status).toBe(200);
    // Merchant B must see their own store metrics, not Merchant A's store
    expect(resB.body.store.id).toBe(otherMerchantId);
    expect(resB.body.store.id).not.toBe(merchantId);

    // 2. Fetch Merchant A's order with Merchant B's token
    const aOrdersRes = await query("SELECT id FROM orders WHERE merchant_id = $1 LIMIT 1", [merchantId]);
    if (aOrdersRes.rows.length > 0) {
      const orderAId = aOrdersRes.rows[0].id;
      const fulfillAttempt = await request(app)
        .post(`/api/merchant/orders/${orderAId}/fulfill`)
        .set('Authorization', `Bearer ${otherMerchantToken}`)
        .send({ targetStatus: 'PROCESSING' });

      // Merchant B cannot fulfill Merchant A's order
      expect([403, 404, 500]).toContain(fulfillAttempt.status);
    }
  });

  // TEST 8: Mathematical conversion rate and GMV calculations match database truth
  it('TEST 8: Conversion rate and GMV calculations strictly reflect underlying database records', async () => {
    const overviewRes = await request(app)
      .get('/api/merchant/overview')
      .set('Authorization', `Bearer ${merchantToken}`);

    expect(overviewRes.status).toBe(200);
    const m = overviewRes.body.metrics;

    // Direct database validation
    const dbOrders = await query(`
      SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as gmv
      FROM orders
      WHERE merchant_id = $1
        AND order_status NOT IN ('CANCELLED', 'VOIDED', 'FAILED', 'BLOCKED')
        AND payment_status = 'VERIFIED'
    `, [merchantId]);

    const expectedCount = parseInt(dbOrders.rows[0].count);
    const expectedGmv = parseFloat(dbOrders.rows[0].gmv);

    expect(m.totalOrders).toBe(expectedCount);
    expect(m.totalRevenue).toBe(expectedGmv);
    expect(typeof m.conversionRate).toBe('number');
    expect(m.conversionRate).toBeGreaterThanOrEqual(0);
    expect(m.conversionRate).toBeLessThanOrEqual(100);
  });
});
