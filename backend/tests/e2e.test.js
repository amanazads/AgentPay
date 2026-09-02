import { jest } from '@jest/globals';
import crypto from 'crypto';
import { evaluatePurchaseIntent } from '../src/services/decisionEngine.js';
import { createPaymentOrder, verifyPayment } from '../src/services/paymentService.js';
import { processApproval } from '../src/services/approvalService.js';
import { query } from '../src/config/database.js';
import env from '../src/config/env.js';

jest.setTimeout(30000);

describe('AgentPay End-to-End Autonomous Commerce Lifecycle', () => {
  let policyId;
  let agentId;
  let userId;
  let testMerchantId;
  let normalProduct;
  let thresholdProduct;

  beforeAll(async () => {
    // Create an isolated test user and buyer account for this test suite
    const userRes = await query(`
      INSERT INTO users (email, name, role)
      VALUES ('e2e_lifecycle_tester_' || floor(random()*1000000) || '@agentpay.com', 'E2E Lifecycle Tester', 'user')
      RETURNING id
    `);
    userId = userRes.rows[0].id;

    // Create a dedicated isolated policy and agent for deterministic E2E test limits
    const polRes = await query(`
      INSERT INTO policies (name, version, daily_budget, max_transaction, approval_threshold, allowed_categories, blocked_categories, max_retries, price_tolerance_pct, verified_merchants_only)
      VALUES ('E2E Isolated Policy', 'v1', 1000000, 100000, 50000, ARRAY['electronics', 'peripherals'], ARRAY['luxury'], 1, 2.0, true)
      RETURNING id
    `);
    policyId = polRes.rows[0].id;

    const newAgentRes = await query(`
      INSERT INTO agents (name, description, policy_id, status, owner_id)
      VALUES ('E2E Isolated Agent', 'Autonomous Buyer Agent', $1, 'active', $2)
      RETURNING *
    `, [policyId, userId]);
    agentId = newAgentRes.rows[0].id;

    // Create a verified merchant for tests
    const mRes = await query(`
      INSERT INTO merchants (name, category, description, is_verified, rating, tier)
      VALUES ('E2E Verified Electronics', 'Electronics', 'Verified Merchant for E2E Tests', true, 4.8, 'tier_1')
      RETURNING id
    `);
    testMerchantId = mRes.rows[0].id;

    // Seed test products
    const p1Res = await query(`
      INSERT INTO products (merchant_id, name, description, category, price, currency, in_stock, specifications)
      VALUES ($1, 'Test Headphones', 'Noise Cancelling Headphones', 'electronics', 14999, 'INR', true, '{"anc": true}')
      RETURNING *
    `, [testMerchantId]);
    normalProduct = p1Res.rows[0];

    const p2Res = await query(`
      INSERT INTO products (merchant_id, name, description, category, price, currency, in_stock, specifications)
      VALUES ($1, 'Test Laptop', 'Development Laptop', 'electronics', 64990, 'INR', true, '{"ram": "16GB"}')
      RETURNING *
    `, [testMerchantId]);
    thresholdProduct = p2Res.rows[0];

    // Seed payment mandate covering test limits
    await query(`
      INSERT INTO user_payment_methods (user_id, provider, method_type, identifier_masked, single_transaction_limit, max_limit, is_default, status)
      VALUES ($1, 'razorpay_sandbox', 'upi_mandate', 'user@okaxis (Sandbox Mandate)', 100000, 100000, true, 'active')
    `, [userId]);
  });

  afterAll(async () => {
    if (testMerchantId) {
      await query('DELETE FROM transactions WHERE purchase_intent_id IN (SELECT id FROM purchase_intents WHERE merchant_id = $1)', [testMerchantId]);
      await query('DELETE FROM approvals WHERE purchase_intent_id IN (SELECT id FROM purchase_intents WHERE merchant_id = $1)', [testMerchantId]);
      await query('DELETE FROM purchase_intents WHERE merchant_id = $1', [testMerchantId]);
      await query('DELETE FROM products WHERE merchant_id = $1', [testMerchantId]);
      await query('DELETE FROM merchants WHERE id = $1', [testMerchantId]);
    }
    if (userId) {
      await query('DELETE FROM invoices WHERE user_id = $1', [userId]);
      await query('DELETE FROM orders WHERE user_id = $1', [userId]);
      await query('DELETE FROM in_app_notifications WHERE user_id = $1', [userId]);
      await query('DELETE FROM event_notifications WHERE user_id = $1', [userId]);
      await query('DELETE FROM transactions WHERE user_id = $1', [userId]);
      await query('DELETE FROM approvals WHERE purchase_intent_id IN (SELECT id FROM purchase_intents WHERE user_id = $1)', [userId]);
      await query('DELETE FROM purchase_intents WHERE user_id = $1', [userId]);
      await query('DELETE FROM agents WHERE owner_id = $1', [userId]);
      await query('DELETE FROM users WHERE id = $1', [userId]);
    }
    if (policyId) {
      await query('DELETE FROM policies WHERE id = $1', [policyId]);
    }
  });

  test('Complete Flow: Intent Creation -> Decision Engine ALLOW -> Razorpay Order -> Signature Verification -> Audit Log', async () => {
    const amount = parseFloat(normalProduct.price);
    const idempotencyKey = crypto.createHash('sha256').update(`${agentId}:${normalProduct.id}:${amount}:${Date.now()}`).digest('hex');

    // 1. Create Purchase Intent (Autonomous tier)
    const insRes = await query(`
      INSERT INTO purchase_intents (
        agent_id, user_id, product_id, merchant_id, amount, currency, status, idempotency_key, ai_reasoning
      )
      VALUES ($1, $2, $3, $4, $5, 'INR', 'pending', $6, 'Automated test purchase intent')
      RETURNING id
    `, [agentId, userId, normalProduct.id, normalProduct.merchant_id, amount, idempotencyKey]);
    const purchaseIntentId = insRes.rows[0].id;

    // 2. Evaluate through Policy & Risk Decision Engine
    const evaluated = await evaluatePurchaseIntent(purchaseIntentId);
    expect(evaluated.decision).toBe('ALLOW');
    expect(evaluated.policyResult.decision).toBe('ALLOW');
    expect(evaluated.riskResult.score).toBeLessThan(70);

    // 3. Generate Razorpay Order
    const paymentOrder = await createPaymentOrder(purchaseIntentId);
    expect(paymentOrder.orderId).toBeDefined();
    expect(paymentOrder.transactionId).toBeDefined();

    // 4. Verify Payment Signature
    const paymentId = `pay_${crypto.randomBytes(8).toString('hex')}`;
    const hmacBody = `${paymentOrder.orderId}|${paymentId}`;
    const razorpaySignature = crypto
      .createHmac('sha256', env.RAZORPAY_TEST_KEY_SECRET)
      .update(hmacBody)
      .digest('hex');

    const verificationResult = await verifyPayment({
      transactionId: paymentOrder.transactionId,
      razorpayPaymentId: paymentId,
      razorpayOrderId: paymentOrder.orderId,
      razorpaySignature,
    });

    expect(verificationResult.success).toBe(true);
    expect(verificationResult.verified).toBe(true);
    expect(verificationResult.status).toBe('payment_completed');

    // 5. Verify Immutable Audit Trail
    const auditRes = await query(
      'SELECT * FROM audit_events WHERE purchase_intent_id = $1 ORDER BY created_at ASC',
      [purchaseIntentId]
    );
    expect(auditRes.rows.length).toBeGreaterThanOrEqual(2);
    expect(auditRes.rows.some((r) => r.event_type === 'PURCHASE_INTENT_EVALUATION')).toBe(true);
    expect(auditRes.rows.some((r) => r.event_type === 'PAYMENT_VERIFIED')).toBe(true);
  });

  test('Approval Flow: Intent Creation (> ₹50k) -> APPROVAL_REQUIRED -> Human Approval -> Razorpay Order Settlement', async () => {
    const amount = parseFloat(thresholdProduct.price);
    const idempotencyKey = crypto.createHash('sha256').update(`${agentId}:${thresholdProduct.id}:${amount}:${Date.now()}`).digest('hex');

    // 1. Create intent above autonomous threshold (e.g. ₹64,990)
    const insRes = await query(`
      INSERT INTO purchase_intents (
        agent_id, user_id, product_id, merchant_id, amount, currency, status, idempotency_key, ai_reasoning
      )
      VALUES ($1, $2, $3, $4, $5, 'INR', 'pending', $6, 'Automated test purchase intent')
      RETURNING id
    `, [agentId, userId, thresholdProduct.id, thresholdProduct.merchant_id, amount, idempotencyKey]);
    const purchaseIntentId = insRes.rows[0].id;

    const evaluated = await evaluatePurchaseIntent(purchaseIntentId);
    expect(evaluated.decision).toBe('APPROVAL_REQUIRED');

    // Fetch the created approval record
    const appRes = await query('SELECT id FROM approvals WHERE purchase_intent_id = $1', [purchaseIntentId]);
    const approvalId = appRes.rows[0].id;

    // 2. Human Supervisor Grants Approval
    const approvalRecord = await processApproval({
      approvalId,
      decision: 'APPROVE',
      reviewerId: userId,
      notes: 'Approved via test suite',
    });

    expect(approvalRecord.status).toBe('approved');

    // 3. Execute Payment Order Post-Approval
    const paymentOrder = await createPaymentOrder(purchaseIntentId);

    expect(paymentOrder.orderId).toBeDefined();
    expect(paymentOrder.transactionId).toBeDefined();

    // 4. Verify Final Settlement
    const paymentId2 = `pay_${crypto.randomBytes(8).toString('hex')}`;
    const hmacBody2 = `${paymentOrder.orderId}|${paymentId2}`;
    const razorpaySignature2 = crypto
      .createHmac('sha256', env.RAZORPAY_TEST_KEY_SECRET)
      .update(hmacBody2)
      .digest('hex');

    const verificationResult = await verifyPayment({
      transactionId: paymentOrder.transactionId,
      razorpayPaymentId: paymentId2,
      razorpayOrderId: paymentOrder.orderId,
      razorpaySignature: razorpaySignature2,
    });

    expect(verificationResult.success).toBe(true);
    expect(verificationResult.verified).toBe(true);
    expect(verificationResult.status).toBe('payment_completed');
  });
});
