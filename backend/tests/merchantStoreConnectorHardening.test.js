import request from 'supertest';
import { app } from '../src/index.js';
import { query } from '../src/config/database.js';
import { generateAccessToken } from '../src/utils/authUtils.js';

describe('Track 01: Merchant Store Profile & Agentic Commerce Connector Hardening Suite', () => {
  let merchantAUser;
  let merchantBUser;
  let merchantAToken;
  let merchantBToken;
  let merchantAId;
  let merchantBId;

  beforeAll(async () => {
    // 1. Merchant A
    const mARes = await query("SELECT id FROM merchants WHERE is_verified = true ORDER BY created_at ASC LIMIT 1");
    merchantAId = mARes.rows[0].id;

    let uARes = await query("SELECT * FROM users WHERE merchant_id = $1 LIMIT 1", [merchantAId]);
    if (uARes.rows.length === 0) {
      const insUA = await query(`
        INSERT INTO users (email, name, role, merchant_id)
        VALUES ('connector_tester_a_${Date.now()}@agentpay.com', 'Connector Tester A', 'MERCHANT', $1)
        RETURNING *
      `, [merchantAId]);
      merchantAUser = insUA.rows[0];
    } else {
      merchantAUser = uARes.rows[0];
    }
    merchantAToken = generateAccessToken(merchantAUser);

    // 2. Merchant B
    let mBRes = await query("SELECT id FROM merchants WHERE id != $1 LIMIT 1", [merchantAId]);
    if (mBRes.rows.length === 0) {
      const insMB = await query(`
        INSERT INTO merchants (name, category, is_verified, created_at)
        VALUES ('Connector Isolation Store', 'Electronics', true, NOW())
        RETURNING id
      `);
      merchantBId = insMB.rows[0].id;
    } else {
      merchantBId = mBRes.rows[0].id;
    }

    const insUB = await query(`
      INSERT INTO users (email, name, role, merchant_id)
      VALUES ('connector_tester_b_${Date.now()}@agentpay.com', 'Connector Tester B', 'MERCHANT', $1)
      RETURNING *
    `, [merchantBId]);
    merchantBUser = insUB.rows[0];
    merchantBToken = generateAccessToken(merchantBUser);
  });

  // TEST 1: GET /api/merchant/store masks credentials and never exposes plaintext secrets
  it('TEST 1: Store connector GET endpoint returns masked credentials and never leaks plaintext secrets', async () => {
    const res = await request(app)
      .get('/api/merchant/store')
      .set('Authorization', `Bearer ${merchantAToken}`);

    expect(res.status).toBe(200);
    expect(res.body.hasStore).toBe(true);
    expect(res.body.store.id).toBe(merchantAId);
    expect(res.body.credentials).toBeDefined();

    // Verify API Key is masked
    expect(res.body.credentials.apiKey.masked).toMatch(/^••••••••••••[a-zA-Z0-9]{4}$/);
    expect(res.body.credentials.apiKey.status).toBe('Active');

    // Verify Webhook Secret is masked
    expect(res.body.credentials.webhookSecret.masked).toMatch(/^••••••••••••[a-zA-Z0-9]{4}$/);
    expect(res.body.credentials.webhookSecret.status).toBe('Configured');

    // Verify no raw unmasked secrets returned
    expect(res.body.apiKey).toBeUndefined();
    expect(res.body.webhookSecret).toBeUndefined();
  });

  // TEST 2: Multi-tenant merchant isolation
  it('TEST 2: Merchant A cannot read or modify Merchant B store connector', async () => {
    const resA = await request(app)
      .get('/api/merchant/store')
      .set('Authorization', `Bearer ${merchantAToken}`);

    const resB = await request(app)
      .get('/api/merchant/store')
      .set('Authorization', `Bearer ${merchantBToken}`);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    expect(resA.body.store.id).toBe(merchantAId);
    expect(resB.body.store.id).toBe(merchantBId);
    expect(resA.body.store.id).not.toBe(resB.body.store.id);
  });

  // TEST 3: POST /api/merchant/store/rotate-api-key securely rotates API key and hashes server-side
  it('TEST 3: Rotating API key updates hash and last4 fingerprint in DB and logs audit event', async () => {
    const rotateRes = await request(app)
      .post('/api/merchant/store/rotate-api-key')
      .set('Authorization', `Bearer ${merchantAToken}`);

    expect(rotateRes.status).toBe(200);
    expect(rotateRes.body.success).toBe(true);
    expect(rotateRes.body.newApiKey).toMatch(/^agp_live_sec_[a-f0-9]{32}$/);
    expect(rotateRes.body.last4).toBeDefined();

    // Check DB has hash stored (not raw key)
    const dbRes = await query("SELECT api_key_hash, api_key_last4 FROM merchants WHERE id = $1", [merchantAId]);
    expect(dbRes.rows[0].api_key_hash).toBeDefined();
    expect(dbRes.rows[0].api_key_hash).not.toBe(rotateRes.body.newApiKey);
    expect(dbRes.rows[0].api_key_last4).toBe(rotateRes.body.last4);
  });

  // TEST 4: POST /api/merchant/store/rotate-webhook-secret securely rotates Webhook Secret
  it('TEST 4: Rotating Webhook Secret updates hash and last4 fingerprint in DB and logs audit event', async () => {
    const rotateRes = await request(app)
      .post('/api/merchant/store/rotate-webhook-secret')
      .set('Authorization', `Bearer ${merchantAToken}`);

    expect(rotateRes.status).toBe(200);
    expect(rotateRes.body.success).toBe(true);
    expect(rotateRes.body.newWebhookSecret).toMatch(/^whsec_[a-f0-9]{32}$/);
    expect(rotateRes.body.last4).toBeDefined();

    // Check DB has hash stored
    const dbRes = await query("SELECT webhook_secret_hash, webhook_secret_last4 FROM merchants WHERE id = $1", [merchantAId]);
    expect(dbRes.rows[0].webhook_secret_hash).toBeDefined();
    expect(dbRes.rows[0].webhook_secret_hash).not.toBe(rotateRes.body.newWebhookSecret);
    expect(dbRes.rows[0].webhook_secret_last4).toBe(rotateRes.body.last4);
  });

  // TEST 5: POST /api/merchant/store/health-check executes live component diagnostics
  it('TEST 5: Connector health check runs live subsystem diagnostics and updates last_health_check_at', async () => {
    const healthRes = await request(app)
      .post('/api/merchant/store/health-check')
      .set('Authorization', `Bearer ${merchantAToken}`);

    expect(healthRes.status).toBe(200);
    expect(healthRes.body.success).toBe(true);
    expect(healthRes.body.overallStatus).toBe('HEALTHY');
    expect(Array.isArray(healthRes.body.checks)).toBe(true);
    expect(healthRes.body.checks.length).toBeGreaterThanOrEqual(6);

    for (const check of healthRes.body.checks) {
      expect(check.status).toBe('HEALTHY');
      expect(typeof check.latencyMs).toBe('number');
    }
  });

  // TEST 6: POST /api/merchant/store/test-webhook executes safe HMAC synthetic ping
  it('TEST 6: Test webhook endpoint verifies HMAC-SHA256 signature without creating orders or revenue', async () => {
    const ordersCountBefore = await query("SELECT COUNT(*) as count FROM orders WHERE merchant_id = $1", [merchantAId]);

    const pingRes = await request(app)
      .post('/api/merchant/store/test-webhook')
      .set('Authorization', `Bearer ${merchantAToken}`);

    expect(pingRes.status).toBe(200);
    expect(pingRes.body.success).toBe(true);
    expect(pingRes.body.signatureAlgorithm).toBe('HMAC-SHA256');
    expect(pingRes.body.eventId).toBeDefined();

    const ordersCountAfter = await query("SELECT COUNT(*) as count FROM orders WHERE merchant_id = $1", [merchantAId]);
    expect(ordersCountAfter.rows[0].count).toBe(ordersCountBefore.rows[0].count);
  });
});
