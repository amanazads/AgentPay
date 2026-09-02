import { jest } from '@jest/globals';
import crypto from 'crypto';
import request from 'supertest';
import app from '../src/index.js';
import env, { Environments, PaymentModes } from '../src/config/env.js';
import {
  RazorpayTestProvider,
  RazorpayLiveProvider,
  razorpayTestProvider,
  razorpayLiveProvider,
  getPaymentProvider,
} from '../src/services/paymentProvider.js';
import { createPaymentOrder } from '../src/services/paymentService.js';
import { processRazorpayWebhook } from '../src/services/webhookService.js';
import { query } from '../src/config/database.js';

describe('Track 01: TEST vs LIVE Environment Isolation & Payment Rail Defense Suite', () => {
  let testAgentId;
  let testProductId;
  let testMerchantId;
  let testUserId;
  let testIntentId;

  beforeAll(async () => {
    // 1. Fetch or create merchant
    let mRes = await query("SELECT * FROM merchants WHERE is_verified = true LIMIT 1");
    let merchant = mRes.rows[0];
    if (!merchant) {
      const insM = await query(`
        INSERT INTO merchants (name, category, is_verified, risk_level, is_test_lab)
        VALUES ('Environment Isolation Store', 'Electronics', true, 'low', true)
        RETURNING *
      `);
      merchant = insM.rows[0];
    }
    testMerchantId = merchant.id;

    // 2. Product
    let pRes = await query("SELECT * FROM products WHERE merchant_id = $1 LIMIT 1", [testMerchantId]);
    let product = pRes.rows[0];
    if (!product) {
      const insP = await query(`
        INSERT INTO products (merchant_id, name, category, price, in_stock, inventory, is_test_lab)
        VALUES ($1, 'Isolation Hardened Headset', 'Electronics', 4999.00, true, 50, true)
        RETURNING *
      `, [testMerchantId]);
      product = insP.rows[0];
    }
    testProductId = product.id;

    // 3. User
    let uRes = await query("SELECT * FROM users WHERE role = 'BUYER' LIMIT 1");
    let user = uRes.rows[0];
    if (!user) {
      const insU = await query(`
        INSERT INTO users (email, name, role)
        VALUES ('env_isolation_tester@agentpay.com', 'Environment Tester', 'BUYER')
        RETURNING *
      `);
      user = insU.rows[0];
    }
    testUserId = user.id;

    // 4. Agent
    let aRes = await query("SELECT * FROM agents WHERE status = 'active' LIMIT 1");
    let agent = aRes.rows[0];
    testAgentId = agent ? agent.id : '00000000-0000-0000-0000-000000000001';

    // 5. Purchase Intent
    const insIntent = await query(`
      INSERT INTO purchase_intents (
        agent_id, user_id, product_id, merchant_id, amount, status, policy_decision, policy_details
      ) VALUES (
        $1, $2, $3, $4, 4999.00, 'allowed', 'ALLOW', '{"policyVersion":"v1"}'
      ) RETURNING id
    `, [testAgentId, testUserId, testProductId, testMerchantId]);
    testIntentId = insIntent.rows[0].id;
  });

  // ── TEST 1: Authoritative Environment & Mode Definitions ───────────────────
  test('TEST 1: Authoritative environment and payment modes are strictly defined', () => {
    expect(Environments.DEVELOPMENT).toBe('DEVELOPMENT');
    expect(Environments.TEST).toBe('TEST');
    expect(Environments.PRODUCTION).toBe('PRODUCTION');

    expect(PaymentModes.TEST).toBe('TEST');
    expect(PaymentModes.LIVE).toBe('LIVE');
  });

  // ── TEST 2: Test Credentials in Live Provider Fails Closed ─────────────────
  test('TEST 2: Test credentials (rzp_test_*) are strictly rejected by RazorpayLiveProvider', () => {
    const fakeLiveWithTestKey = new RazorpayLiveProvider({
      keyId: 'rzp_test_insecure_key_leak_12345',
      keySecret: 'test_secret_abc123',
      webhookSecret: 'whsec_test',
    });

    expect(() => fakeLiveWithTestKey.assertLiveConfigured()).toThrow(/FATAL SECURITY LOCK/i);
  });

  // ── TEST 3: Live Mode Requested Without Valid Credentials Fails Closed ─────
  test('TEST 3: Live mode requested without valid live credentials FAILS CLOSED server-side', async () => {
    const unconfiguredLiveProvider = new RazorpayLiveProvider({
      keyId: '',
      keySecret: '',
    });

    expect(() => unconfiguredLiveProvider.assertLiveConfigured()).toThrow(/FATAL SECURITY LOCK/i);

    // Calling createPaymentOrder with mode='live' when live credentials are not set must fail closed
    await expect(
      createPaymentOrder(testIntentId, { mode: 'live' })
    ).rejects.toThrow(/FATAL SECURITY LOCK/i);
  });

  // ── TEST 4: Test Payment Against Live Provider Fails Safely ────────────────
  test('TEST 4: Attempting to route a TEST payment to RazorpayLiveProvider is blocked', async () => {
    const mockLive = new RazorpayLiveProvider({
      keyId: 'rzp_live_real_mock_credential_key',
      keySecret: 'live_secret_mock_xyz987',
      webhookSecret: 'whsec_live_mock',
    });

    // Mock client to isolate assertion check
    mockLive.client = {
      orders: { create: jest.fn() },
    };

    await expect(
      mockLive.createOrder({ amount: 1000, environment: 'TEST' })
    ).rejects.toThrow(/SECURITY VIOLATION: Attempted to process a TEST payment through Razorpay LIVE provider/i);
  });

  // ── TEST 5: Live Payment Against Test Provider Fails Safely ────────────────
  test('TEST 5: Attempting to route a LIVE payment to RazorpayTestProvider is blocked', async () => {
    await expect(
      razorpayTestProvider.createOrder({ amount: 1000, environment: 'LIVE' })
    ).rejects.toThrow(/SECURITY VIOLATION: Attempted to process a LIVE payment through Razorpay TEST provider/i);
  });

  // ── TEST 6: Webhook Isolation - Missing or Invalid Signature in Live Mode ──
  test('TEST 6: Razorpay LIVE webhook rejects missing or mismatched signatures with HTTP 400', async () => {
    const payload = {
      event: 'payment.captured',
      payload: { payment: { entity: { id: 'pay_live_test_1', order_id: 'order_live_1', amount: 500000 } } },
    };

    // Missing signature
    await expect(
      processRazorpayWebhook({
        environment: 'LIVE',
        signature: null,
        rawBody: payload,
        payload,
      })
    ).rejects.toThrow();

    // Bad signature
    await expect(
      processRazorpayWebhook({
        environment: 'LIVE',
        signature: 'invalid_cryptographic_signature_hash_0000000000',
        rawBody: payload,
        payload,
      })
    ).rejects.toThrow();
  });

  // ── TEST 7: Webhook Isolation - Cross-Environment Mismatch Rejected ────────
  test('TEST 7: Mixed-environment webhook attempting to fulfill a LIVE transaction from TEST fails closed', async () => {
    // 1. Create a LIVE mock transaction in DB
    const liveOrderId = `order_live_${Date.now()}`;
    const insTx = await query(`
      INSERT INTO transactions (
        purchase_intent_id, agent_id, user_id, amount, currency, status,
        razorpay_order_id, idempotency_key, environment, payment_mode
      ) VALUES (
        $1, $2, $3, 4999.00, 'INR', 'payment_pending',
        $4, $5, 'LIVE', 'LIVE'
      ) RETURNING id
    `, [testIntentId, testAgentId, testUserId, liveOrderId, `idemp_live_test_${Date.now()}`]);

    const liveTxId = insTx.rows[0].id;

    // 2. Submit a TEST webhook payload referencing the LIVE order ID
    const testWebhookPayload = {
      event: 'payment.captured',
      event_id: `evt_test_mismatch_${Date.now()}`,
      payload: {
        payment: { entity: { id: 'pay_test_attacker_1', order_id: liveOrderId, amount: 499900 } },
        order: { entity: { id: liveOrderId } },
      },
    };

    // Must throw mixed-environment security violation
    await expect(
      processRazorpayWebhook({
        environment: 'TEST',
        signature: 'sandbox_test_sig',
        rawBody: testWebhookPayload,
        payload: testWebhookPayload,
      })
    ).rejects.toThrow(/SECURITY VIOLATION: Mixed environment webhook rejected/i);

    // 3. Confirm live transaction was NOT marked completed
    const checkTx = await query('SELECT status, payment_verified FROM transactions WHERE id = $1', [liveTxId]);
    expect(checkTx.rows[0].status).toBe('payment_pending');
    expect(checkTx.rows[0].payment_verified).toBe(false);
  });

  // ── TEST 8: Test Payments Are Authoritatively Labeled 'TEST' ───────────────
  test('TEST 8: Test mode financial operations create records authoritatively labeled TEST', async () => {
    // Create dedicated purchase intent for test payment
    const prodRes = await query('SELECT * FROM products WHERE id = $1', [testProductId]);
    const prodPrice = parseFloat(prodRes.rows[0].price);

    const freshIntent = await query(`
      INSERT INTO purchase_intents (
        agent_id, user_id, product_id, merchant_id, amount, status, policy_decision, policy_details
      ) VALUES (
        $1, $2, $3, $4, $5, 'allowed', 'ALLOW', '{"policyVersion":"v1"}'
      ) RETURNING id
    `, [testAgentId, testUserId, testProductId, testMerchantId, prodPrice]);

    const paymentOrderRes = await createPaymentOrder(freshIntent.rows[0].id, { mode: 'test' });

    expect(paymentOrderRes.orderId).toBeDefined();
    expect(paymentOrderRes.environment).toBe('TEST');
    expect(paymentOrderRes.paymentMode).toBe('TEST');

    const dbTx = await query('SELECT * FROM transactions WHERE id = $1', [paymentOrderRes.transactionId]);
    expect(dbTx.rows[0].environment).toBe('TEST');
    expect(dbTx.rows[0].payment_mode).toBe('TEST');
  });
});
