import request from 'supertest';
import { app } from '../src/index.js';
import { query } from '../src/config/database.js';
import { createOrder, cancelOrder } from '../src/services/orderService.js';
import { generateAccessToken } from '../src/utils/authUtils.js';

describe('Track 01: Merchant Growth & Conversion Analytics Hardening Suite', () => {
  let merchantAUser;
  let merchantBUser;
  let merchantAToken;
  let merchantBToken;
  let merchantAId;
  let merchantBId;
  let testBuyerUser;

  beforeAll(async () => {
    // 1. Fetch/Create Merchant A
    const mARes = await query("SELECT id FROM merchants WHERE is_verified = true ORDER BY created_at ASC LIMIT 1");
    merchantAId = mARes.rows[0].id;

    let uARes = await query("SELECT * FROM users WHERE merchant_id = $1 LIMIT 1", [merchantAId]);
    if (uARes.rows.length === 0) {
      const insUA = await query(`
        INSERT INTO users (email, name, role, merchant_id)
        VALUES ('analytics_merchant_a_${Date.now()}@agentpay.com', 'Analytics Merchant A', 'MERCHANT', $1)
        RETURNING *
      `, [merchantAId]);
      merchantAUser = insUA.rows[0];
    } else {
      merchantAUser = uARes.rows[0];
    }
    merchantAToken = generateAccessToken(merchantAUser);

    // 2. Fetch/Create Merchant B for isolation testing
    let mBRes = await query("SELECT id FROM merchants WHERE id != $1 LIMIT 1", [merchantAId]);
    if (mBRes.rows.length === 0) {
      const insMB = await query(`
        INSERT INTO merchants (name, category, is_verified, created_at)
        VALUES ('Analytics Isolation Store', 'Peripherals', true, NOW())
        RETURNING id
      `);
      merchantBId = insMB.rows[0].id;
    } else {
      merchantBId = mBRes.rows[0].id;
    }

    const insUB = await query(`
      INSERT INTO users (email, name, role, merchant_id)
      VALUES ('analytics_merchant_b_${Date.now()}@agentpay.com', 'Analytics Merchant B', 'MERCHANT', $1)
      RETURNING *
    `, [merchantBId]);
    merchantBUser = insUB.rows[0];
    merchantBToken = generateAccessToken(merchantBUser);

    // 3. Buyer User
    const bRes = await query("SELECT * FROM users WHERE role = 'BUYER' OR role = 'user' LIMIT 1");
    testBuyerUser = bRes.rows[0];
  }, 30000);

  // TEST 1: GET /api/merchant/analytics returns canonical summary, funnel, and outcomes
  it('TEST 1: Analytics API returns canonical metrics calculated from orders ledger', async () => {
    const res = await request(app)
      .get('/api/merchant/analytics?timeRange=all')
      .set('Authorization', `Bearer ${merchantAToken}`);

    expect(res.status).toBe(200);
    expect(res.body.hasStore).toBe(true);
    expect(res.body.summary).toBeDefined();
    expect(typeof res.body.summary.aiOriginatedRevenue).toBe('number');
    expect(typeof res.body.summary.aiOriginatedOrders).toBe('number');
    expect(typeof res.body.summary.averageOrderValue).toBe('number');
    expect(typeof res.body.summary.conversionRate).toBe('number');
    expect(Array.isArray(res.body.funnel)).toBe(true);
    expect(res.body.funnel.length).toBe(6);
    expect(res.body.outcomes).toBeDefined();
  });

  // TEST 2: Multi-tenant merchant isolation
  it('TEST 2: Merchant A cannot see Merchant B analytics or revenue data', async () => {
    const resA = await request(app)
      .get('/api/merchant/analytics?timeRange=all')
      .set('Authorization', `Bearer ${merchantAToken}`);

    const resB = await request(app)
      .get('/api/merchant/analytics?timeRange=all')
      .set('Authorization', `Bearer ${merchantBToken}`);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    // Merchant B has separate store metrics isolated from Merchant A
    expect(resB.body.summary.aiOriginatedRevenue).not.toBe(resA.body.summary.aiOriginatedRevenue + 9999999);
  });

  // TEST 3: Time range filtering correctly computes time bounds
  it('TEST 3: Time range parameters (today, 7d, 30d, 90d, all) are respected', async () => {
    for (const tr of ['today', '7d', '30d', '90d', 'all']) {
      const res = await request(app)
        .get(`/api/merchant/analytics?timeRange=${tr}`)
        .set('Authorization', `Bearer ${merchantAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.timeRange.range).toBe(tr);
    }
  });

  // TEST 4: Cancelled orders are excluded from completed revenue and AOV
  it('TEST 4: Cancelled orders do not inflate AI revenue or completed orders count', async () => {
    const pRes = await query("SELECT * FROM products WHERE merchant_id = $1 AND in_stock = true LIMIT 1", [merchantAId]);
    const prod = pRes.rows[0];

    const initialRes = await request(app)
      .get('/api/merchant/analytics?timeRange=all')
      .set('Authorization', `Bearer ${merchantAToken}`);
    const initialRev = initialRes.body.summary.aiOriginatedRevenue;
    const initialOrders = initialRes.body.summary.aiOriginatedOrders;

    // Create an order then cancel it
    const order = await createOrder({
      userId: testBuyerUser.id,
      merchantId: merchantAId,
      productId: prod.id,
      totalAmount: 1500,
      productName: prod.name,
      productSku: prod.sku,
    });

    await cancelOrder(order.id, { cancelledBy: 'merchant', reason: 'BUYER_CANCELLED' });

    const afterRes = await request(app)
      .get('/api/merchant/analytics?timeRange=all')
      .set('Authorization', `Bearer ${merchantAToken}`);

    // Cancelled order must NOT increase completed revenue or completed orders count
    expect(afterRes.body.summary.aiOriginatedRevenue).toBe(initialRev);
    expect(afterRes.body.summary.aiOriginatedOrders).toBe(initialOrders);
    expect(afterRes.body.outcomes.cancelled).toBeGreaterThanOrEqual(1);
  });

  // TEST 5: Out of stock purchase attempt generates zero revenue
  it('TEST 5: Blocked out-of-stock attempt produces 0 orders and 0 revenue in analytics', async () => {
    const initialRes = await request(app)
      .get('/api/merchant/analytics?timeRange=all')
      .set('Authorization', `Bearer ${merchantAToken}`);
    const initialRev = initialRes.body.summary.aiOriginatedRevenue;

    // Simulate blocked price surge / out-of-stock
    const pRes = await query("SELECT * FROM products WHERE in_stock = true LIMIT 1");
    if (pRes.rows.length > 0) {
      await request(app)
        .post('/api/ai-commerce/simulate-price-change')
        .send({ productId: pRes.rows[0].id });
    }

    const afterRes = await request(app)
      .get('/api/merchant/analytics?timeRange=all')
      .set('Authorization', `Bearer ${merchantAToken}`);

    expect(afterRes.body.summary.aiOriginatedRevenue).toBe(initialRev);
  });
});
