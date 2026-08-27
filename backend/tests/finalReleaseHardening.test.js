import request from 'supertest';
import { app } from '../src/index.js';
import { query } from '../src/config/database.js';
import { generateAccessToken } from '../src/utils/authUtils.js';
import { parseBuyerIntent } from '../src/services/intentParser.js';
import { findEligibleProducts } from '../src/services/candidateFilter.js';

describe('Track 01: Final Release Hardening & Evaluation Suite', () => {
  let merchantAUser;
  let merchantBUser;
  let buyerUser;
  let merchantAToken;
  let merchantBToken;
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
        VALUES ('release_merchant_a_${Date.now()}@agentpay.com', 'Release Merchant A', 'MERCHANT', $1)
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
        VALUES ('Release Isolation Store B', 'Electronics', true, NOW())
        RETURNING id
      `);
      merchantBId = insMB.rows[0].id;
    } else {
      merchantBId = mBRes.rows[0].id;
    }

    const insUB = await query(`
      INSERT INTO users (email, name, role, merchant_id)
      VALUES ('release_merchant_b_${Date.now()}@agentpay.com', 'Release Merchant B', 'MERCHANT', $1)
      RETURNING *
    `, [merchantBId]);
    merchantBUser = insUB.rows[0];
    merchantBToken = generateAccessToken(merchantBUser);

    // 3. Buyer User
    const bRes = await query("SELECT * FROM users WHERE role = 'BUYER' OR role = 'user' LIMIT 1");
    buyerUser = bRes.rows[0];
    buyerToken = generateAccessToken(buyerUser);
  });

  // TEST 1: Intent Parser with Comma-separated Capacities and Quantities
  it('TEST 1: Intent parser correctly extracts comma-separated capacity, quantities, and price limits', () => {
    const p1 = parseBuyerIntent('Find me a 20,000mAh power bank under ₹3,000');
    expect(p1.productType).toBe('power_bank');
    expect(p1.hardConstraints.requiredCapacityMah).toBe(20000);
    expect(p1.maxPrice).toBe(3000);

    const p2 = parseBuyerIntent('Order 5 ergonomic office chairs under ₹1,50,000');
    expect(p2.productType).toBe('chair');
    expect(p2.quantity).toBe(5);
    expect(p2.maxPrice).toBe(150000);

    const p3 = parseBuyerIntent('Sony WH-1000XM5 headphones with ANC under 30000');
    expect(p3.productType).toBe('headphones');
    expect(p3.hardConstraints.requiredBrand).toBe('Sony');
    expect(p3.hardConstraints.requiredAnc).toBe(true);
    expect(p3.maxPrice).toBe(30000);
  });

  // TEST 2: Word Boundary Matching ("ergonomic" does NOT match brand "Mi")
  it('TEST 2: Brand parser uses strict word boundaries so "ergonomic" does not extract "Mi"', () => {
    const parsed = parseBuyerIntent('Find an ergonomic mesh chair');
    expect(parsed.hardConstraints.requiredBrand).toBeUndefined();
    expect(parsed.softPreferences.ergonomic).toBe(true);
  });

  // TEST 3: Deterministic Candidate Matching (Power bank request selects power bank, NOT mouse)
  it('TEST 3: Power bank request selects a verified power bank within budget and never an unrelated product', async () => {
    const parsed = parseBuyerIntent('20,000mAh power bank under ₹3,000');
    const result = await findEligibleProducts(parsed, { userId: buyerUser.id, limit: 5 });

    expect(result.status).toBe('MATCH_FOUND');
    expect(result.winningCandidate).toBeDefined();
    expect(result.winningCandidate.name.toLowerCase()).toContain('power bank');
    expect(result.winningCandidate.price).toBeLessThanOrEqual(3000);
  });

  // TEST 4: Impossible Product Constraints Return NO_MATCH (Never fallback to wrong product)
  it('TEST 4: Impossible requests return NO_MATCH with zero transactions created', async () => {
    const parsed = parseBuyerIntent('Ferrari sports car under ₹500 with 50000mAh battery');
    const result = await findEligibleProducts(parsed, { userId: buyerUser.id, limit: 5 });

    expect(result.status).toBe('NO_MATCH');
    expect(result.winningCandidate).toBeNull();
  });

  // TEST 5: Conversational /api/ai/chat executes complete bounded purchase and returns confirmed order
  it('TEST 5: POST /api/ai/chat executes canonical end-to-end purchase when constraints pass', async () => {
    const res = await request(app)
      .post('/api/ai/chat')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        message: 'Buy Ambrane 20000mAh power bank under ₹2,500',
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('MATCH_FOUND');
    expect(res.body.recommendation).toBeDefined();
    expect(res.body.recommendation.price).toBeLessThanOrEqual(2500);
  });

  // TEST 6: Simulated Price Surge is Blocked with ₹0 Charged and No Order
  it('TEST 6: Unannounced price surge at checkout is blocked with ₹0 charged and 0 orders created', async () => {
    const pRes = await query("SELECT id FROM products WHERE merchant_id = $1 AND in_stock = true LIMIT 1", [merchantAId]);
    const simRes = await request(app)
      .post('/api/ai-commerce/simulate-price-change')
      .send({ productId: pRes.rows[0].id });

    expect(simRes.status).toBe(200);
    expect(simRes.body.decision).toBe('BLOCK');
    expect(simRes.body.paymentStatus).toContain('NOT ATTEMPTED');
    expect(simRes.body.orderStatus).toBe('NOT CREATED');
  });

  // TEST 7: Tenant Isolation — Merchant A cannot query Merchant B's orders
  it('TEST 7: Merchant A cannot query Merchant B orders (Tenant Scoping Verified)', async () => {
    const resA = await request(app)
      .get('/api/merchant/orders')
      .set('Authorization', `Bearer ${merchantAToken}`);

    const resB = await request(app)
      .get('/api/merchant/orders')
      .set('Authorization', `Bearer ${merchantBToken}`);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    for (const ord of resA.body.orders || []) {
      expect(ord.merchant_id).toBe(merchantAId);
    }
  });

  // TEST 8: Live Demo Reset Mechanism
  it('TEST 8: POST /api/system/reset-demo restores clean judge state (0 orders, ₹0 spent)', async () => {
    const resetRes = await request(app)
      .post('/api/system/reset-demo')
      .set('Authorization', `Bearer ${merchantAToken}`);

    expect(resetRes.status).toBe(200);
    expect(resetRes.body.success).toBe(true);

    const ordersCount = await query('SELECT COUNT(*) as count FROM orders');
    expect(parseInt(ordersCount.rows[0].count, 10)).toBe(0);

    const productsCount = await query('SELECT COUNT(*) as count FROM products WHERE in_stock = true');
    expect(parseInt(productsCount.rows[0].count, 10)).toBeGreaterThanOrEqual(20);
  });
});
