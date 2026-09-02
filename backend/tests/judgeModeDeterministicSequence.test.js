import request from 'supertest';
import app from '../src/index.js';
import { query } from '../src/config/database.js';
import { JUDGE_STEPS } from '../src/routes/judge.js';

describe('Judge Mode Deterministic 15-Step Sequence Suite', () => {
  let contextAccumulator = {};

  beforeAll(async () => {
    // Ensure clean baseline before test suite starts
    await request(app).post('/api/judge/reset');
  });

  afterAll(async () => {
    // Leave environment in pristine baseline
    await request(app).post('/api/judge/reset');
  });

  test('METADATA: GET /api/judge/sequence returns all 15 defined steps & architecture invariant', async () => {
    const res = await request(app).get('/api/judge/sequence');

    expect(res.status).toBe(200);
    expect(res.body.totalSteps).toBe(15);
    expect(res.body.steps.length).toBe(15);
    expect(res.body.architectureInvariant.proposes).toBeDefined();
    expect(res.body.architectureInvariant.authorizes).toBeDefined();
    expect(res.body.architectureInvariant.executes).toBeDefined();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 1 to STEP 10: HAPPY PATH PROCUREMENT & AUDIT TRAIL
  // ──────────────────────────────────────────────────────────────────────────

  test('STEP 1: AI Buyer Natural-Language Request', async () => {
    const res = await request(app)
      .post('/api/judge/run-step')
      .send({ step: 1, context: {} });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.result.intent).toBeDefined();
    expect(res.body.result.intent.category).toBeDefined();
    expect(res.body.result.intent.maxBudget).toBeGreaterThan(0);

    contextAccumulator = { ...contextAccumulator, ...res.body.result };
  });

  test('STEP 2: Product Discovery & Catalog Match', async () => {
    const res = await request(app)
      .post('/api/judge/run-step')
      .send({ step: 2, context: contextAccumulator });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.result.selectedProduct).toBeDefined();
    expect(res.body.result.selectedProduct.id).toBeDefined();
    expect(res.body.result.selectedProduct.inStock).toBe(true);

    contextAccumulator = { ...contextAccumulator, ...res.body.result };
  });

  test('STEP 3: Server-Authoritative Policy Evaluation', async () => {
    const res = await request(app)
      .post('/api/judge/run-step')
      .send({ step: 3, context: contextAccumulator });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.result.decision).toBe('ALLOW');
    expect(res.body.result.ruleEvaluations).toBeDefined();
    expect(res.body.result.ruleCount).toBeGreaterThanOrEqual(10);

    contextAccumulator = { ...contextAccumulator, ...res.body.result };
  });

  test('STEP 4: 5-Pillar Multi-Factor Risk Assessment', async () => {
    const res = await request(app)
      .post('/api/judge/run-step')
      .send({ step: 4, context: contextAccumulator });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.result.decision).toBe('ALLOW');
    expect(res.body.result.compositeScore).toBeLessThan(70);
    expect(Array.isArray(res.body.result.pillars)).toBe(true);

    contextAccumulator = { ...contextAccumulator, ...res.body.result };
  });

  test('STEP 5: Price Lock & Inventory Reservation', async () => {
    const res = await request(app)
      .post('/api/judge/run-step')
      .send({ step: 5, context: contextAccumulator });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.result.quoteId).toBeDefined();
    expect(res.body.result.quoteStatus).toBe('ACTIVE');
    expect(res.body.result.reservationStatus).toBe('RESERVED');

    contextAccumulator = { ...contextAccumulator, ...res.body.result };
  });

  test('STEP 6: Zero-Trust Connector & Mandate Authorization', async () => {
    const res = await request(app)
      .post('/api/judge/run-step')
      .send({ step: 6, context: contextAccumulator });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.result.merchantConnector.status).toBe('CONNECTED');
    expect(res.body.result.paymentAuthorization.authorized).toBe(true);

    contextAccumulator = { ...contextAccumulator, ...res.body.result };
  });

  test('STEP 7: Razorpay Test Payment & HMAC Verification', async () => {
    const res = await request(app)
      .post('/api/judge/run-step')
      .send({ step: 7, context: contextAccumulator });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.result.orderId.startsWith('order_')).toBe(true);
    expect(res.body.result.environment).toBe('TEST');
    expect(res.body.result.signatureVerified).toBe(true);
    expect(res.body.result.badge).toContain('TEST MODE');

    contextAccumulator = { ...contextAccumulator, ...res.body.result };
  });

  test('STEP 8: Server-Authoritative Order Creation', async () => {
    const res = await request(app)
      .post('/api/judge/run-step')
      .send({ step: 8, context: contextAccumulator });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.result.orderId).toBeDefined();
    expect(res.body.result.orderNumber.startsWith('AGP-ORD-')).toBe(true);

    contextAccumulator = { ...contextAccumulator, ...res.body.result };
  });

  test('STEP 9: Structured GST Tax Invoice', async () => {
    const res = await request(app)
      .post('/api/judge/run-step')
      .send({ step: 9, context: contextAccumulator });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.result.invoiceId).toBeDefined();
    expect(res.body.result.invoiceNumber).toMatch(/^INV-\d{6}-\d{5}$/);
    expect(res.body.result.totalAmount).toBeGreaterThan(0);

    contextAccumulator = { ...contextAccumulator, ...res.body.result };
  });

  test('STEP 10: Immutable Audit Trail Verification', async () => {
    const res = await request(app)
      .post('/api/judge/run-step')
      .send({ step: 10, context: contextAccumulator });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.result.totalEventsLogged).toBeGreaterThan(0);
    expect(res.body.result.immutableTriggerEnforced).toBe(true);

    contextAccumulator = { ...contextAccumulator, ...res.body.result };
  });

  // ──────────────────────────────────────────────────────────────────────────
  // STEP 11 to STEP 15: SECURITY DEFENSE & ATTACK LAB
  // ──────────────────────────────────────────────────────────────────────────

  test('STEP 11: Attack Defense: Price Manipulation', async () => {
    const res = await request(app)
      .post('/api/judge/run-step')
      .send({ step: 11, context: contextAccumulator });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.result.decision).toBe('BLOCK');
    expect(res.body.result.chargedAmount).toBe('₹0.00');
  });

  test('STEP 12: Attack Defense: Prompt Injection Jailbreak', async () => {
    const res = await request(app)
      .post('/api/judge/run-step')
      .send({ step: 12, context: contextAccumulator });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.result.decision).toBe('BLOCK');
    expect(res.body.result.threatNeutralized).toBe(true);
  });

  test('STEP 13: Human-in-the-Loop: Approval Escalation', async () => {
    const res = await request(app)
      .post('/api/judge/run-step')
      .send({ step: 13, context: contextAccumulator });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.result.decision).toBe('APPROVAL_REQUIRED');
  });

  test('STEP 14: Attack Defense: Duplicate Replay Attack', async () => {
    const res = await request(app)
      .post('/api/judge/run-step')
      .send({ step: 14, context: contextAccumulator });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.result.decision).toBe('BLOCK');
    expect(res.body.result.doubleChargePrevented).toBe(true);
  });

  test('STEP 15: Emergency Stop: Global Kill Switch', async () => {
    const res = await request(app)
      .post('/api/judge/run-step')
      .send({ step: 15, context: contextAccumulator });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.result.decision).toBe('BLOCK');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // RESET JUDGE SESSION
  // ──────────────────────────────────────────────────────────────────────────

  test('RESET: POST /api/judge/reset restores clean judge baseline', async () => {
    const res = await request(app).post('/api/judge/reset');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain('Judge session successfully reset');
  });
});
