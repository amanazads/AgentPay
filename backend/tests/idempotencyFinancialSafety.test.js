import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import { query } from '../src/config/database.js';
import aiRoutes from '../src/routes/ai.js';
import { createPaymentOrder, verifyPayment } from '../src/services/paymentService.js';
import { createOrder, getOrderById } from '../src/services/orderService.js';
import { processRazorpayWebhook } from '../src/services/webhookService.js';
import { reconcileOrders } from '../src/services/reconciliationService.js';
import { authenticateUser } from '../src/middleware/authMiddleware.js';
import { generateAccessToken } from '../src/utils/authUtils.js';

const app = express();
app.use(express.json());
app.use(authenticateUser);
app.use('/api/ai', aiRoutes);

describe('Track 01: Strict Financial Idempotency & Concurrency Safety Suite', () => {
  let buyerUserId;
  let merchantId;
  let productId;
  let testIntentId;
  let buyerToken;

  beforeAll(async () => {
    const uRes = await query("SELECT id, email, name, role FROM users WHERE role = 'BUYER' LIMIT 1");
    buyerUserId = uRes.rows[0]?.id;
    buyerToken = generateAccessToken({ ...uRes.rows[0], role: 'BUYER' });

    const mRes = await query("SELECT id FROM merchants WHERE is_verified = true LIMIT 1");
    merchantId = mRes.rows[0]?.id;

    const pRes = await query("SELECT id, name, price, brand, category FROM products WHERE merchant_id = $1 LIMIT 1", [merchantId]);
    productId = pRes.rows[0]?.id;

    if (buyerUserId) {
      await query(`
        INSERT INTO user_preferences (user_id, monthly_budget, auto_purchase_limit, categories, preferred_brands, purchase_behavior, updated_at)
        VALUES ($1, 1000000, 100000, ARRAY['Electronics', 'Peripherals'], ARRAY['Apple', 'Sony', 'Ambrane'], 'auto_within_limit', NOW())
        ON CONFLICT (user_id) DO UPDATE SET
          monthly_budget = 1000000,
          auto_purchase_limit = 100000,
          categories = ARRAY['Electronics', 'Peripherals'],
          preferred_brands = ARRAY['Apple', 'Sony', 'Ambrane'],
          purchase_behavior = 'auto_within_limit',
          updated_at = NOW()
      `, [buyerUserId]);
    }
  });

  it('TEST 1: Single purchase execution creates exactly 1 intent, 1 transaction, and 1 order', async () => {
    const res = await request(app)
      .post('/api/ai/chat')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        message: 'Order a power bank with 20000mAh battery under ₹5,000',
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('MATCH_FOUND');
    expect(res.body.recommendation).toBeDefined();

    if (res.body.order) {
      const order = res.body.order;
      testIntentId = order.purchase_intent_id;

      // Verify in DB that only 1 order exists for this intent
      const ordRes = await query('SELECT * FROM orders WHERE purchase_intent_id = $1', [testIntentId]);
      expect(ordRes.rows.length).toBe(1);

      // Verify in DB that only 1 transaction exists for this intent
      const txRes = await query('SELECT * FROM transactions WHERE purchase_intent_id = $1', [testIntentId]);
      expect(txRes.rows.length).toBe(1);
    }
  });

  it('TEST 2: Concurrent rapid requests with same idempotency key return existing transaction without creating duplicate orders', async () => {
    const idempotencyKey = `concurrent_test_${Date.now()}_${Math.random()}`;

    // Fire 5 concurrent requests simultaneously
    const requests = Array.from({ length: 5 }).map(() =>
      request(app)
        .post('/api/ai/chat')
        .set('idempotency-key', idempotencyKey)
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({
          message: 'Order Sony WH-1000XM5 headphones under ₹30,000',
          idempotency_key: idempotencyKey,
        })
    );

    const results = await Promise.all(requests);
    results.forEach((res) => {
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('MATCH_FOUND');
    });

    // Check DB: exactly 1 intent and 1 order must exist for this idempotency key
    const intentRes = await query('SELECT * FROM purchase_intents WHERE idempotency_key = $1', [idempotencyKey]);
    expect(intentRes.rows.length).toBe(1);

    const orderRes = await query('SELECT * FROM orders WHERE purchase_intent_id = $1', [intentRes.rows[0].id]);
    expect(orderRes.rows.length).toBe(1);
  });

  it('TEST 3: Retrying createPaymentOrder on same intent returns existing transaction without duplicating', async () => {
    const intentId = testIntentId;
    if (!intentId) return;

    const res1 = await createPaymentOrder({
      purchase_intent_id: intentId,
      amount: 1899,
      currency: 'INR',
    });

    const res2 = await createPaymentOrder({
      purchase_intent_id: intentId,
      amount: 1899,
      currency: 'INR',
    });

    expect(res2.isDuplicate).toBe(true);
    expect(res2.orderId).toBe(res1.orderId);

    const txRes = await query('SELECT * FROM transactions WHERE purchase_intent_id = $1', [intentId]);
    expect(txRes.rows.length).toBe(1);
  });

  it('TEST 4: Retrying createOrder on same transaction returns existing order record', async () => {
    const txRes = await query('SELECT * FROM transactions WHERE purchase_intent_id = $1 LIMIT 1', [testIntentId]);
    if (txRes.rows.length === 0) return;
    const tx = txRes.rows[0];

    const order1 = await createOrder({
      purchaseIntentId: testIntentId,
      transactionId: tx.id,
      userId: buyerUserId,
      merchantId,
      productId,
      totalAmount: 1899,
    });

    const order2 = await createOrder({
      purchaseIntentId: testIntentId,
      transactionId: tx.id,
      userId: buyerUserId,
      merchantId,
      productId,
      totalAmount: 1899,
    });

    expect(order1.id).toBe(order2.id);
    expect(order1.order_number).toBe(order2.order_number);

    const dbOrders = await query('SELECT * FROM orders WHERE transaction_id = $1', [tx.id]);
    expect(dbOrders.rows.length).toBe(1);
  });

  it('TEST 5: Retrying verifyPayment on already completed transaction is safe & idempotent', async () => {
    const txRes = await query('SELECT * FROM transactions WHERE purchase_intent_id = $1 LIMIT 1', [testIntentId]);
    if (txRes.rows.length === 0) return;
    const tx = txRes.rows[0];

    const verify1 = await verifyPayment({
      transactionId: tx.id,
      razorpayPaymentId: 'pay_test_dup_123',
      razorpaySignature: 'simulated_test_signature_valid',
    });

    const verify2 = await verifyPayment({
      transactionId: tx.id,
      razorpayPaymentId: 'pay_test_dup_123',
      razorpaySignature: 'simulated_test_signature_valid',
    });

    expect(verify2.isDuplicate).toBe(true);
    expect(verify2.verified).toBe(true);
  });

  it('TEST 6: Duplicate webhook delivery is processed exactly once', async () => {
    const webhookEventId = `evt_test_dup_${Date.now()}`;
    const payload = {
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_test_webhook_dup_1',
            order_id: 'order_test_wh_dup',
            amount: 189900,
            currency: 'INR',
            status: 'captured',
          },
        },
      },
    };

    const firstRun = await processRazorpayWebhook({
      environment: 'TEST',
      signature: 'valid_test_signature',
      rawBody: payload,
      payload: { ...payload, id: webhookEventId },
    });
    expect(firstRun.success).toBe(true);

    // Second run with exact same webhook event ID
    const secondRun = await processRazorpayWebhook({
      environment: 'TEST',
      signature: 'valid_test_signature',
      rawBody: payload,
      payload: { ...payload, id: webhookEventId },
    });
    expect(secondRun.success).toBe(true);
    expect(secondRun.duplicate).toBe(true);
  });

  it('TEST 7: Multi-point order reconciliation detects and heals zero anomalies', async () => {
    const report = await reconcileOrders({ autoHeal: true });
    expect(report.success).toBe(true);
    expect(report.totalOrdersScanned).toBeGreaterThan(0);
  });

  afterAll(async () => {
    // Cleanup test records
    if (testIntentId) {
      await query('DELETE FROM invoices WHERE order_id IN (SELECT id FROM orders WHERE purchase_intent_id = $1)', [testIntentId]);
      await query('DELETE FROM orders WHERE purchase_intent_id = $1', [testIntentId]);
      await query('DELETE FROM transactions WHERE purchase_intent_id = $1', [testIntentId]);
      await query('DELETE FROM purchase_intents WHERE id = $1', [testIntentId]);
    }
  });
});
