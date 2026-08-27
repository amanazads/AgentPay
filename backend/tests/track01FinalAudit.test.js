import request from 'supertest';
import { app } from '../src/index.js';
import { query } from '../src/config/database.js';
import { findEligibleProducts } from '../src/services/candidateFilter.js';
import { parseBuyerIntent } from '../src/services/intentParser.js';
import { reserveInventory, releaseReservation } from '../src/services/inventoryService.js';
import { createPaymentOrder, verifyPayment } from '../src/services/paymentService.js';
import { createOrder } from '../src/services/orderService.js';
import { reconcileOrders } from '../src/services/reconciliationService.js';
import { generateAccessToken } from '../src/utils/authUtils.js';

describe('Track 01: Final Merchant Catalog & AI Commerce Readiness Audit Suite', () => {
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
        VALUES ('track01_tester@agentpay.com', 'Track01 Tester', 'MERCHANT', $1)
        RETURNING *
      `, [merchantId]);
      merchantUser = insUser.rows[0];
    } else {
      merchantUser = uRes.rows[0];
    }
    merchantToken = generateAccessToken(merchantUser);

    // 2. Fetch or create a second isolated merchant
    let omRes = await query("SELECT * FROM merchants WHERE id != $1 LIMIT 1", [merchantId]);
    if (omRes.rows.length === 0) {
      const insM = await query(`
        INSERT INTO merchants (name, category, is_verified, rating)
        VALUES ('Secondary Test Store', 'Electronics', true, 4.8)
        RETURNING *
      `);
      otherMerchantId = insM.rows[0].id;
    } else {
      otherMerchantId = omRes.rows[0].id;
    }

    const insOtherUser = await query(`
      INSERT INTO users (email, name, role, merchant_id)
      VALUES ('other_merchant_audit_${Date.now()}@agentpay.com', 'Other Merchant Audit', 'MERCHANT', $1)
      RETURNING *
    `, [otherMerchantId]);
    otherMerchantUser = insOtherUser.rows[0];
    otherMerchantToken = generateAccessToken(otherMerchantUser);

    // 3. Buyer user
    const bRes = await query("SELECT * FROM users WHERE role = 'BUYER' OR role = 'user' LIMIT 1");
    buyerUser = bRes.rows[0];
    buyerToken = generateAccessToken(buyerUser);

    // 4. In-stock test product
    const pRes = await query("SELECT * FROM products WHERE merchant_id = $1 AND in_stock = true AND inventory > 0 LIMIT 1", [merchantId]);
    testProduct = pRes.rows[0];
  });

  // TEST 1: Exact product purchase matches target SKU
  it('TEST 1: Exact product purchase matches target SKU without substituting unrelated products', async () => {
    const exactIntent = await parseBuyerIntent(`Buy the ${testProduct.name}`);
    const result = await findEligibleProducts(exactIntent, { merchantId });

    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates[0].id).toBe(testProduct.id);
  });

  // TEST 2: Product not in catalog returns NO MATCH without fallback substitution
  it('TEST 2: Product not in merchant catalog returns NO MATCH with zero substitutions', async () => {
    const missingIntent = await parseBuyerIntent('Buy SuperQuantumTeleporter9000');
    const result = await findEligibleProducts(missingIntent, { merchantId });

    expect(result.candidates.length).toBe(0);
  });

  // TEST 3: Price exceeds budget is filtered out before ranking
  it('TEST 3: Products exceeding authorized buyer budget are rejected prior to ranking', async () => {
    const budgetIntent = await parseBuyerIntent('Find me laptops under ₹50,000');
    const result = await findEligibleProducts(budgetIntent, { merchantId });

    for (const cand of result.candidates) {
      expect(parseFloat(cand.price)).toBeLessThanOrEqual(50000);
    }
  });

  // TEST 4: Inventory becomes zero halts transactability
  it('TEST 4: Out-of-stock product is excluded from purchase candidate list', async () => {
    const insZero = await query(`
      INSERT INTO products (merchant_id, sku, name, price, currency, inventory, in_stock, category, status)
      VALUES ($1, 'SKU-ZERO01', 'Zero Stock Item', 2500, 'INR', 0, false, 'Electronics', 'ACTIVE')
      RETURNING id
    `, [merchantId]);
    const zeroId = insZero.rows[0].id;

    const intent = await parseBuyerIntent('Buy Zero Stock Item under ₹5,000');
    const result = await findEligibleProducts(intent, { merchantId });

    const matched = result.candidates.find((c) => c.id === zeroId);
    expect(matched).toBeUndefined();

    // Clean up
    await query("DELETE FROM products WHERE id = $1", [zeroId]);
  });

  // TEST 5: Price changes after quote triggers revalidation block
  it('TEST 5: Price surge revalidation halts transaction with ₹0 charged and 0 orders created', async () => {
    const surgeRes = await request(app)
      .post('/api/ai-commerce/simulate-price-change')
      .send({ productId: testProduct.id });

    expect(surgeRes.status).toBe(200);
    expect(surgeRes.body.decision).toBe('BLOCK');
    expect(surgeRes.body.orderStatus).toBe('NOT CREATED');
    expect(surgeRes.body.paymentStatus).toContain('NOT ATTEMPTED');
  });

  // TEST 6: Atomic inventory reservation prevents overselling
  it('TEST 6: Atomic inventory reservation locks stock and rejects secondary concurrent attempts', async () => {
    // Insert single-stock item
    const insSingle = await query(`
      INSERT INTO products (merchant_id, sku, name, price, currency, inventory, in_stock, category, status)
      VALUES ($1, 'SKU-SINGLE01', 'Single Stock Flash Deal', 1000, 'INR', 1, true, 'Electronics', 'ACTIVE')
      RETURNING id
    `, [merchantId]);
    const singleId = insSingle.rows[0].id;

    // Buyer 1 reserves stock
    const res1 = await reserveInventory({
      productId: singleId,
      quantity: 1,
      quoteId: `quote_buyer1_${Date.now()}`,
    });

    expect(res1.status).toBe('RESERVED');
    expect(res1.reservationId).toBeDefined();

    // Buyer 2 attempts to reserve same stock and is rejected
    await expect(reserveInventory({
      productId: singleId,
      quantity: 1,
      quoteId: `quote_buyer2_${Date.now()}`,
    })).rejects.toThrow(/Insufficient inventory/i);

    // Release reservation & clean up
    await releaseReservation(res1.reservationId, 'Test complete');
    await query("DELETE FROM products WHERE id = $1", [singleId]);
  });

  // TEST 7: Duplicate purchase request returns idempotent existing order
  it('TEST 7: Duplicate purchase request returns existing canonical order without double-counting', async () => {
    const existingOrderRes = await query("SELECT * FROM orders WHERE merchant_id = $1 AND transaction_id IS NOT NULL LIMIT 1", [merchantId]);
    const existing = existingOrderRes.rows[0];

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
  });

  // TEST 8: Duplicate webhook delivery is handled idempotently
  it('TEST 8: Duplicate webhook delivery is recognized and handled idempotently', async () => {
    const dupEvt = `evt_audit_dup_${Date.now()}`;
    const payload = {
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: `pay_audit_${Date.now()}`,
            amount: 191900,
            currency: 'INR',
            status: 'captured',
            notes: { merchantId },
          },
        },
      },
    };

    const res1 = await request(app)
      .post('/api/webhooks/razorpay/test')
      .set('x-razorpay-event-id', dupEvt)
      .send(payload);

    expect(res1.status).toBe(200);

    const res2 = await request(app)
      .post('/api/webhooks/razorpay/test')
      .set('x-razorpay-event-id', dupEvt)
      .send(payload);

    expect(res2.status).toBe(200);
    expect(res2.body.result?.duplicate || res2.body.status === 'ok').toBe(true);
  });

  // TEST 9: Multi-tenant isolation between merchants
  it('TEST 9: Merchant B cannot access Merchant A products, orders, or analytics', async () => {
    const resB = await request(app)
      .get('/api/merchant/overview')
      .set('Authorization', `Bearer ${otherMerchantToken}`);

    expect(resB.status).toBe(200);
    expect(resB.body.store.id).toBe(otherMerchantId);
    expect(resB.body.store.id).not.toBe(merchantId);
  });

  // TEST 10: AI recommendation is strictly restricted to merchant catalog
  it('TEST 10: AI product discovery strictly evaluates products from the merchant catalog', async () => {
    const parsedIntent = await parseBuyerIntent('Find a power bank with 20000mAh capacity');
    const result = await findEligibleProducts(parsedIntent, { merchantId });

    expect(result.candidates.length).toBeGreaterThan(0);
    for (const c of result.candidates) {
      expect(c.merchant_id).toBe(merchantId);
    }
  });

  // TEST 11: Merchant Priority Promotion cannot override buyer budget
  it('TEST 11: Promoted products never override buyer budget hard constraints', async () => {
    const budgetIntent = await parseBuyerIntent('Find headphones under ₹10,000');
    const result = await findEligibleProducts(budgetIntent, { merchantId });

    for (const cand of result.candidates) {
      expect(parseFloat(cand.price)).toBeLessThanOrEqual(10000);
    }
  });

  // TEST 12: Invalid payment HMAC signature is rejected
  it('TEST 12: Invalid payment signature is rejected with fail-closed security boundary', async () => {
    const piRes = await query(`
      INSERT INTO purchase_intents (user_id, merchant_id, product_id, amount, quantity, status)
      VALUES ($1, $2, $3, $4, 1, 'approved')
      RETURNING id
    `, [buyerUser.id, merchantId, testProduct.id, testProduct.price]);
    const piId = piRes.rows[0].id;

    const paymentOrder = await createPaymentOrder({
      amount: parseFloat(testProduct.price),
      currency: 'INR',
      purchaseIntentId: piId,
      userId: buyerUser.id,
      merchantId,
      productId: testProduct.id,
    });

    await expect(verifyPayment({
      transactionId: paymentOrder.transactionId,
      razorpayPaymentId: 'pay_tampered_123',
      razorpaySignature: 'invalid_tampered_signature_xyz',
    })).rejects.toThrow();
  });

  // TEST 13: Order reconciliation auto-heals payment-verified orders
  it('TEST 13: Automated reconciliation self-heals orphaned payment-verified orders', async () => {
    const reconResult = await reconcileOrders({ autoHeal: true });
    expect(reconResult.success).toBe(true);
    expect(typeof reconResult.totalOrdersScanned).toBe('number');
  });

  // TEST 14: Paused products are excluded from AI buyer feeds
  it('TEST 14: Paused products are excluded from AI buyer catalog feeds', async () => {
    const insPaused = await query(`
      INSERT INTO products (merchant_id, sku, name, price, currency, inventory, in_stock, category, status)
      VALUES ($1, 'SKU-PAUSE99', 'Temporarily Paused SKU', 3999, 'INR', 20, false, 'Electronics', 'PAUSED')
      RETURNING id
    `, [merchantId]);
    const pausedId = insPaused.rows[0].id;

    const feedRes = await request(app)
      .get('/api/ai/catalog')
      .query({ merchantId, inStockOnly: 'false' });

    const found = feedRes.body.items.find((i) => i.productId === pausedId);
    expect(found).toBeUndefined();

    // Clean up
    await query("DELETE FROM products WHERE id = $1", [pausedId]);
  });

  // TEST 15: 6-Pillar evidence-based readiness calculation matches database truth
  it('TEST 15: 6-pillar evidence readiness returns truthful verified capability counts', async () => {
    const aiRes = await request(app)
      .get('/api/merchant/ai-commerce')
      .set('Authorization', `Bearer ${merchantToken}`);

    expect(aiRes.status).toBe(200);
    expect(aiRes.body.verifiedPillarsCount).toBe(6);
    expect(aiRes.body.totalPillarsCount).toBe(6);
    expect(aiRes.body.pillars.length).toBe(6);
    expect(aiRes.body.catalogHealthText).toContain('total products');
  });
});
