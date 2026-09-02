import crypto from 'crypto';
import request from 'supertest';
import app from '../src/index.js';
import env from '../src/config/env.js';
import {
  processRazorpayWebhook,
  WebhookEventTypes,
  WebhookProcessingStates,
} from '../src/services/webhookService.js';
import { createPaymentOrder } from '../src/services/paymentService.js';
import { query } from '../src/config/database.js';

describe('Track 01: Webhook Reliability, Cryptographic Security & State Machine Audit', () => {
  let testMerchant;
  let testProduct;
  let testUser;
  let testAgent;

  beforeAll(async () => {
    // 1. Merchant
    let mRes = await query("SELECT * FROM merchants WHERE is_verified = true LIMIT 1");
    if (mRes.rows.length > 0) {
      testMerchant = mRes.rows[0];
    } else {
      const insM = await query(`
        INSERT INTO merchants (name, category, is_verified, risk_level)
        VALUES ('Webhook Audit Store', 'Electronics', true, 'low')
        RETURNING *
      `);
      testMerchant = insM.rows[0];
    }

    // 2. Product
    const insP = await query(`
      INSERT INTO products (merchant_id, name, category, price, in_stock, inventory, is_test_lab)
      VALUES ($1, 'Webhook Test Item ' || $2, 'Electronics', 2499.00, true, 100, true)
      RETURNING *
    `, [testMerchant.id, Date.now()]);
    testProduct = insP.rows[0];

    // 3. User
    let uRes = await query("SELECT * FROM users WHERE role = 'BUYER' LIMIT 1");
    if (uRes.rows.length > 0) {
      testUser = uRes.rows[0];
    } else {
      const insU = await query(`
        INSERT INTO users (email, name, role)
        VALUES ('webhook_tester_' || $1 || '@agentpay.ai', 'Webhook Tester', 'BUYER')
        RETURNING *
      `, [Date.now()]);
      testUser = insU.rows[0];
    }

    // 4. Agent
    let aRes = await query("SELECT * FROM agents WHERE status = 'active' LIMIT 1");
    testAgent = aRes.rows[0] || { id: '00000000-0000-0000-0000-000000000001' };
  });

  // Helper to create fresh intent & transaction
  async function createTestIntentAndTx(price = 2499.00) {
    const insIntent = await query(`
      INSERT INTO purchase_intents (
        agent_id, user_id, product_id, merchant_id, amount, status, policy_decision, policy_details
      ) VALUES (
        $1, $2, $3, $4, $5, 'allowed', 'ALLOW', '{"policyVersion":"v1"}'
      ) RETURNING id
    `, [testAgent.id, testUser.id, testProduct.id, testMerchant.id, price]);
    const intentId = insIntent.rows[0].id;

    const paymentOrderRes = await createPaymentOrder(intentId, { mode: 'test' });
    return { intentId, ...paymentOrderRes };
  }

  // ── TEST 1: Valid Webhook Processing (payment.captured & order.paid) ───────
  test('TEST 1: Valid payment.captured webhook confirms transaction, order, and invoice', async () => {
    const { orderId, transactionId, intentId } = await createTestIntentAndTx(2499.00);
    const eventId = `evt_valid_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const paymentId = `pay_test_${Date.now()}`;

    const payload = {
      event: 'payment.captured',
      event_id: eventId,
      payload: {
        payment: {
          entity: {
            id: paymentId,
            order_id: orderId,
            amount: 249900, // in paise
            currency: 'INR',
            status: 'captured',
          },
        },
        order: {
          entity: {
            id: orderId,
            amount: 249900,
            status: 'paid',
          },
        },
      },
    };

    const res = await processRazorpayWebhook({
      environment: 'TEST',
      payload,
      rawBody: payload,
    });

    expect(res.success).toBe(true);
    expect(res.status).toBe('PROCESSED');
    expect(res.eventId).toBe(eventId);

    // Verify DB states
    const txRes = await query('SELECT * FROM transactions WHERE id = $1', [transactionId]);
    expect(txRes.rows[0].status).toBe('completed');
    expect(txRes.rows[0].payment_verified).toBe(true);
    expect(txRes.rows[0].razorpay_payment_id).toBe(paymentId);

    const intentRes = await query('SELECT status FROM purchase_intents WHERE id = $1', [intentId]);
    expect(['completed', 'payment_completed', 'order_confirmed']).toContain(intentRes.rows[0].status);

    // Verify order was created
    const orderRes = await query('SELECT * FROM orders WHERE transaction_id = $1', [transactionId]);
    expect(orderRes.rows.length).toBe(1);
    expect(orderRes.rows[0].payment_status).toBe('VERIFIED');
  });

  // ── TEST 2: Invalid HMAC Signature Rejection ──────────────────────────────
  test('TEST 2: LIVE webhook with invalid HMAC signature is strictly rejected', async () => {
    const payload = {
      event: 'payment.captured',
      event_id: `evt_bad_sig_${Date.now()}`,
      payload: { payment: { entity: { id: 'pay_live_fake', order_id: 'order_live_fake', amount: 50000 } } },
    };

    // When secret is not configured or invalid signature provided in LIVE mode, fails closed
    await expect(
      processRazorpayWebhook({
        environment: 'LIVE',
        signature: 'invalid_forged_signature_00000000000000000000000000000000',
        rawBody: payload,
        payload,
      })
    ).rejects.toThrow(/FATAL SECURITY LOCK|Invalid webhook cryptographic signature/i);
  });

  // ── TEST 3: Duplicate Webhook Idempotency ──────────────────────────────────
  test('TEST 3: Duplicate webhook delivery with same event_id is idempotent (DUPLICATE_IGNORED)', async () => {
    const { orderId } = await createTestIntentAndTx(2499.00);
    const eventId = `evt_dedup_${Date.now()}`;
    const payload = {
      event: 'payment.captured',
      event_id: eventId,
      payload: {
        payment: { entity: { id: `pay_dedup_${Date.now()}`, order_id: orderId, amount: 249900 } },
      },
    };

    // First delivery
    const firstRes = await processRazorpayWebhook({ environment: 'TEST', payload, rawBody: payload });
    expect(firstRes.status).toBe('PROCESSED');

    // Second delivery (Duplicate Replay)
    const secondRes = await processRazorpayWebhook({ environment: 'TEST', payload, rawBody: payload });
    expect(secondRes.status).toBe('DUPLICATE_IGNORED');
    expect(secondRes.duplicate).toBe(true);
    expect(secondRes.success).toBe(true);

    // Verify only 1 order exists for this transaction
    const ordersRes = await query('SELECT * FROM orders WHERE purchase_intent_id IN (SELECT purchase_intent_id FROM transactions WHERE razorpay_order_id = $1)', [orderId]);
    expect(ordersRes.rows.length).toBe(1);
  });

  // ── TEST 4: Unknown Webhook Events Safely Ignored ──────────────────────────
  test('TEST 4: Unknown/unhandled webhook events are logged and safely IGNORED without state transition', async () => {
    const eventId = `evt_unknown_${Date.now()}`;
    const payload = {
      event: 'payout.processed.unknown_extension',
      event_id: eventId,
      payload: { payout: { id: 'pout_123', amount: 50000 } },
    };

    const res = await processRazorpayWebhook({ environment: 'TEST', payload, rawBody: payload });
    expect(res.status).toBe('IGNORED');
    expect(res.success).toBe(true);

    // Verify recorded in inbox as IGNORED
    const inboxRes = await query('SELECT * FROM webhook_inbox WHERE event_id = $1', [eventId]);
    expect(inboxRes.rows[0].processing_status).toBe('IGNORED');
  });

  // ── TEST 5: Delayed Webhook Handling ──────────────────────────────────────
  test('TEST 5: Delayed payment.captured webhook arriving for already completed transaction is a safe no-op', async () => {
    const { orderId, transactionId } = await createTestIntentAndTx(2499.00);

    // Complete transaction in advance
    await query("UPDATE transactions SET status = 'completed', payment_verified = true WHERE id = $1", [transactionId]);

    const eventId = `evt_delayed_${Date.now()}`;
    const payload = {
      event: 'payment.captured',
      event_id: eventId,
      payload: {
        payment: { entity: { id: `pay_delayed_${Date.now()}`, order_id: orderId, amount: 249900 } },
      },
    };

    const res = await processRazorpayWebhook({ environment: 'TEST', payload, rawBody: payload });
    expect(res.status).toBe('DUPLICATE_IGNORED');
    expect(res.success).toBe(true);
  });

  // ── TEST 6: Out-of-Order Webhook Protection ───────────────────────────────
  test('TEST 6: Out-of-order payment.failed arriving after payment completion is safely rejected (CONFLICT_IGNORED)', async () => {
    const { orderId, transactionId } = await createTestIntentAndTx(2499.00);

    // Mark completed first
    await query("UPDATE transactions SET status = 'completed', payment_verified = true WHERE id = $1", [transactionId]);

    const eventId = `evt_late_fail_${Date.now()}`;
    const payload = {
      event: 'payment.failed',
      event_id: eventId,
      payload: {
        payment: { entity: { id: `pay_fail_${Date.now()}`, order_id: orderId, error_description: 'Late failure' } },
      },
    };

    const res = await processRazorpayWebhook({ environment: 'TEST', payload, rawBody: payload });
    expect(res.status).toBe('CONFLICT_IGNORED');

    // Confirm transaction status remained completed
    const txRes = await query('SELECT status FROM transactions WHERE id = $1', [transactionId]);
    expect(txRes.rows[0].status).toBe('completed');
  });

  // ── TEST 7: Malformed Payload Handling ────────────────────────────────────
  test('TEST 7: Malformed or non-object webhook payloads are safely handled and rejected', async () => {
    const res = await processRazorpayWebhook({
      environment: 'TEST',
      payload: null,
      rawBody: '',
    });

    expect(res.success).toBe(false);
    expect(res.status).toBe('REJECTED');
  });

  // ── TEST 8: HTTP Route Integration Verification ───────────────────────────
  test('TEST 8: POST /api/webhooks/razorpay/test endpoint returns 200 with structured status', async () => {
    const { orderId } = await createTestIntentAndTx(2499.00);
    const eventId = `evt_http_${Date.now()}`;
    const payload = {
      event: 'payment.captured',
      event_id: eventId,
      payload: {
        payment: { entity: { id: `pay_http_${Date.now()}`, order_id: orderId, amount: 249900 } },
      },
    };

    const res = await request(app)
      .post('/api/webhooks/razorpay/test')
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.environment).toBe('TEST');
    expect(res.body.result.status).toBe('PROCESSED');
  });
});
