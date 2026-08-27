import request from 'supertest';
import { app } from '../src/index.js';
import { query } from '../src/config/database.js';
import { generateAccessToken } from '../src/utils/authUtils.js';

describe('Track 01: Merchant Security, Authentication & Trust Verification Suite', () => {
  let merchantAUser;
  let merchantBUser;
  let merchantAToken;
  let merchantBToken;
  let buyerUser;
  let buyerToken;
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
        VALUES ('security_merchant_a_${Date.now()}@agentpay.com', 'Security Merchant A', 'MERCHANT', $1)
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
        VALUES ('Security Isolation Store B', 'Electronics', true, NOW())
        RETURNING id
      `);
      merchantBId = insMB.rows[0].id;
    } else {
      merchantBId = mBRes.rows[0].id;
    }

    const insUB = await query(`
      INSERT INTO users (email, name, role, merchant_id)
      VALUES ('security_merchant_b_${Date.now()}@agentpay.com', 'Security Merchant B', 'MERCHANT', $1)
      RETURNING *
    `, [merchantBId]);
    merchantBUser = insUB.rows[0];
    merchantBToken = generateAccessToken(merchantBUser);

    // 3. Buyer User
    const bRes = await query("SELECT * FROM users WHERE role = 'BUYER' OR role = 'user' LIMIT 1");
    buyerUser = bRes.rows[0];
    buyerToken = generateAccessToken(buyerUser);
  });

  // TEST 1: Role-based Access Control — Buyer blocked from Merchant APIs
  it('TEST 1: Buyer role is strictly blocked from merchant management endpoints (403 Forbidden)', async () => {
    const res = await request(app)
      .get('/api/merchant/orders')
      .set('Authorization', `Bearer ${buyerToken}`);

    expect(res.status).toBe(403);
  });

  // TEST 2: Role-based Access Control — Merchant blocked from Buyer-private endpoints
  it('TEST 2: Merchant role is blocked from buyer-private procurement endpoints (403 Forbidden)', async () => {
    const res = await request(app)
      .get('/api/buyer/connections')
      .set('Authorization', `Bearer ${merchantAToken}`);

    expect(res.status).toBe(403);
  });

  // TEST 3: Multi-tenant Merchant Data Isolation on Products
  it('TEST 3: Merchant A cannot modify or delete Merchant B products', async () => {
    const pBRes = await query("SELECT id FROM products WHERE merchant_id = $1 LIMIT 1", [merchantBId]);
    if (pBRes.rows.length > 0) {
      const prodBId = pBRes.rows[0].id;

      // Merchant A attempts to delete Merchant B's product
      const res = await request(app)
        .delete(`/api/merchant/products/${prodBId}`)
        .set('Authorization', `Bearer ${merchantAToken}`);

      expect([403, 404]).toContain(res.status);
    }
  });

  // TEST 4: Security Health Check Endpoint (9-Point Diagnostics)
  it('TEST 4: POST /api/merchant/security/health-check runs live 9-point security diagnostics', async () => {
    const res = await request(app)
      .post('/api/merchant/security/health-check')
      .set('Authorization', `Bearer ${merchantAToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.overallStatus).toBe('HEALTHY');
    expect(Array.isArray(res.body.checks)).toBe(true);
    expect(res.body.checks.length).toBe(9);

    const checkNames = res.body.checks.map(c => c.name);
    expect(checkNames).toContain('Authentication Middleware');
    expect(checkNames).toContain('Authorization & Tenant Isolation');
    expect(checkNames).toContain('Catalog API');
    expect(checkNames).toContain('Inventory Protection');
    expect(checkNames).toContain('Price Revalidation');
    expect(checkNames).toContain('Transaction Idempotency');
    expect(checkNames).toContain('Payment Signature Verification');
    expect(checkNames).toContain('Webhook Replay Protection');
    expect(checkNames).toContain('Audit Trail Ledger');
  });

  // TEST 5: Zero Plaintext Credential Leaks
  it('TEST 5: Store and Settings endpoints never leak raw API keys or webhook secrets', async () => {
    const res = await request(app)
      .get('/api/merchant/store')
      .set('Authorization', `Bearer ${merchantAToken}`);

    expect(res.status).toBe(200);
    expect(res.body.credentials.apiKey.masked).toMatch(/^••••••••••••[a-zA-Z0-9]{4}$/);
    expect(res.body.credentials.webhookSecret.masked).toMatch(/^••••••••••••[a-zA-Z0-9]{4}$/);
    expect(res.body.apiKey).toBeUndefined();
    expect(res.body.webhookSecret).toBeUndefined();
  });

  // TEST 6: Zero-Trust Price Revalidation Guard
  it('TEST 6: Autonomous purchases with simulated price surges are rejected before payment capture', async () => {
    const pRes = await query("SELECT id FROM products WHERE merchant_id = $1 AND in_stock = true LIMIT 1", [merchantAId]);
    const simRes = await request(app)
      .post('/api/ai-commerce/simulate-price-change')
      .send({ productId: pRes.rows[0].id });

    expect(simRes.status).toBe(200);
    expect(simRes.body.decision).toBe('BLOCK');
    expect(simRes.body.orderStatus).toBe('NOT CREATED');
    expect(simRes.body.reason).toMatch(/surge|revalidation|limit/i);
  });
});
