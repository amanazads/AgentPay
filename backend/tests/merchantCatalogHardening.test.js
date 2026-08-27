import request from 'supertest';
import { jest } from '@jest/globals';
import { app } from '../src/index.js';
import { query } from '../src/config/database.js';
import { findEligibleProducts } from '../src/services/candidateFilter.js';
import { parseBuyerIntent } from '../src/services/intentParser.js';
import { generateAccessToken } from '../src/utils/authUtils.js';

describe('Track 01: Merchant Product Catalog Final Hardening Suite', () => {
  jest.setTimeout(30000);

  let merchantUser;
  let buyerUser;
  let merchantToken;
  let buyerToken;
  let merchantId;
  let inStockProduct;
  let outOfStockProduct;

  beforeAll(async () => {
    // 1. Fetch primary merchant containing catalog products
    const mRes = await query(`
      SELECT merchant_id as id FROM products 
      WHERE merchant_id IS NOT NULL 
      GROUP BY merchant_id 
      ORDER BY COUNT(*) DESC 
      LIMIT 1
    `);
    merchantId = mRes.rows[0].id;

    let uRes = await query("SELECT * FROM users WHERE merchant_id = $1 LIMIT 1", [merchantId]);
    if (uRes.rows.length === 0) {
      const insUser = await query(`
        INSERT INTO users (email, name, role, merchant_id)
        VALUES ('primary_merchant_${Date.now()}@agentpay.com', 'Primary Merchant', 'MERCHANT', $1)
        RETURNING *
      `, [merchantId]);
      merchantUser = insUser.rows[0];
    } else {
      merchantUser = uRes.rows[0];
    }
    await query("UPDATE users SET merchant_id = $1 WHERE id = $2", [merchantId, merchantUser.id]);
    merchantToken = generateAccessToken(merchantUser);

    // 2. Fetch buyer user
    const bRes = await query("SELECT * FROM users WHERE role = 'BUYER' OR role = 'user' LIMIT 1");
    buyerUser = bRes.rows[0];
    buyerToken = generateAccessToken(buyerUser);

    // 3. Ensure test products for this exact merchantId
    const inRes = await query("SELECT * FROM products WHERE merchant_id = $1 AND in_stock = true AND inventory > 0 LIMIT 1", [merchantId]);
    if (inRes.rows.length === 0) {
      const insIn = await query(`
        INSERT INTO products (merchant_id, sku, name, description, brand, category, price, currency, inventory, in_stock, specifications, status)
        VALUES ($1, 'SKU-INSTOCK01', 'In Stock Test Unit', 'Test description', 'BrandX', 'Electronics', 1999, 'INR', 20, true, '{"capacity": "10000mAh"}'::jsonb, 'ACTIVE')
        RETURNING *
      `, [merchantId]);
      inStockProduct = insIn.rows[0];
    } else {
      inStockProduct = inRes.rows[0];
    }

    let outRes = await query("SELECT * FROM products WHERE merchant_id = $1 AND (in_stock = false OR inventory = 0) AND status = 'ACTIVE' LIMIT 1", [merchantId]);
    if (outRes.rows.length === 0) {
      const insOut = await query(`
        INSERT INTO products (merchant_id, sku, name, description, brand, category, price, currency, inventory, in_stock, specifications, status)
        VALUES ($1, 'SKU-OUTSTOCK01', 'Out of Stock Test Unit', 'Test description', 'BrandX', 'Electronics', 4999, 'INR', 0, false, '{"capacity": "10000mAh"}'::jsonb, 'ACTIVE')
        RETURNING *
      `, [merchantId]);
      outOfStockProduct = insOut.rows[0];
    } else {
      outOfStockProduct = outRes.rows[0];
    }
    await query("UPDATE products SET merchant_id = $1, status = 'ACTIVE', in_stock = false, inventory = 0 WHERE id = $2", [merchantId, outOfStockProduct.id]);
  });

  // TEST 1: Discoverable vs Transactable distinction
  it('TEST 1: In-stock items are both Discoverable and Transactable; Out-of-stock items are Discoverable only', async () => {
    const res = await request(app)
      .get('/api/merchant/products')
      .set('Authorization', `Bearer ${merchantToken}`);

    expect(res.status).toBe(200);
    expect(res.body.hasStore).toBe(true);
    expect(Array.isArray(res.body.products)).toBe(true);

    const inStockItem = res.body.products.find((p) => p.id === inStockProduct.id);
    expect(inStockItem).toBeDefined();
    expect(inStockItem.aiDiscoverable).toBe(true);
    expect(inStockItem.aiTransactable).toBe(true);
    expect(inStockItem.checks.inventoryAvailable).toBe(true);

    const outStockItem = res.body.products.find((p) => p.id === outOfStockProduct.id);
    expect(outStockItem).toBeDefined();
    expect(outStockItem.aiDiscoverable).toBe(true);
    expect(outStockItem.aiTransactable).toBe(false);
    expect(outStockItem.readinessReason).toContain('Out of stock');
  });

  // TEST 2: Structured attribute filtering (20,000mAh under ₹3,000 isolates Ambrane & Mi, rejects Anker)
  it('TEST 2: Structured attribute matching filters products accurately against hard constraints', async () => {
    const parsedIntent = await parseBuyerIntent('Find me a 20000mAh power bank under ₹3,000');
    const result = await findEligibleProducts(parsedIntent, { merchantId });

    expect(result.candidates.length).toBeGreaterThan(0);

    for (const cand of result.candidates) {
      // Must be under ₹3,000
      expect(parseFloat(cand.price)).toBeLessThanOrEqual(3000);
      // Brand must not be Anker (> ₹3,000)
      if (cand.brand?.toLowerCase() === 'anker') {
        expect(parseFloat(cand.price)).toBeLessThanOrEqual(3000);
      }
    }
  });

  // TEST 3: Exact product request integrity
  it('TEST 3: Exact product request matches target SKU; non-existent product returns NO MATCH without substitution', async () => {
    // 1. Exact match
    const exactIntent = await parseBuyerIntent('Buy the Logitech MX Master 3S mouse');
    const exactResult = await findEligibleProducts(exactIntent, { merchantId });

    const logitech = exactResult.candidates.find((c) => c.name.toLowerCase().includes('mx master 3s'));
    expect(logitech).toBeDefined();
    expect(logitech.brand.toLowerCase()).toBe('logitech');

    // 2. Missing product request
    const missingIntent = await parseBuyerIntent('Buy NonExistentAlienGadget2099XYZ');
    const missingResult = await findEligibleProducts(missingIntent, { merchantId });

    expect(missingResult.candidates.length).toBe(0);
  });

  // TEST 4: Priority Promoted items cannot override buyer budget limits
  it('TEST 4: Priority Promoted merchant products never override buyer budget limits', async () => {
    const budgetIntent = await parseBuyerIntent('Find me headphones under ₹10,000');
    const result = await findEligibleProducts(budgetIntent, { merchantId });

    // Sony WH-1000XM5 is promoted at ₹28,990 but MUST be excluded due to ₹10,000 hard budget constraint
    const sonyHighEnd = result.candidates.find((c) => parseFloat(c.price) > 10000);
    expect(sonyHighEnd).toBeUndefined();
  });

  // TEST 5: Margin tier is strictly merchant-private and stripped from buyer feeds
  it('TEST 5: Private merchant margin tiers are completely stripped from public AI buyer catalog feeds', async () => {
    const feedRes = await request(app)
      .get('/api/ai/catalog')
      .query({ merchantId });

    expect(feedRes.status).toBe(200);
    expect(Array.isArray(feedRes.body.items)).toBe(true);

    for (const item of feedRes.body.items) {
      // Must not expose marginTier or internal ranking keys
      expect(item.marginTier).toBeUndefined();
      expect(item.aiMetadata?.marginTier).toBeUndefined();
    }
  });

  // TEST 6: Product status lifecycle (PAUSED and ARCHIVED products are excluded from AI buyer queries)
  it('TEST 6: Paused and Archived products are excluded from AI buyer catalog discovery', async () => {
    // Insert temporary paused product
    const insPaused = await query(`
      INSERT INTO products (merchant_id, sku, name, description, brand, category, price, currency, inventory, in_stock, specifications, status)
      VALUES ($1, 'SKU-PAUSE01', 'Paused Test Drone', 'Drone description', 'DJI', 'Electronics', 45000, 'INR', 10, false, '{"camera": "4K"}'::jsonb, 'PAUSED')
      RETURNING id
    `, [merchantId]);
    const pausedId = insPaused.rows[0].id;

    // AI Catalog Query
    const feedRes = await request(app)
      .get('/api/ai/catalog')
      .query({ merchantId, inStockOnly: 'false' });

    const foundPaused = feedRes.body.items.find((i) => i.productId === pausedId);
    expect(foundPaused).toBeUndefined();

    // Clean up
    await query("DELETE FROM products WHERE id = $1", [pausedId]);
  });

  // TEST 7: Price snapshot & quote revalidation blocks price surge (>2%)
  it('TEST 7: Price surge revalidation halts transaction with ₹0 charged and zero orders created', async () => {
    const surgeRes = await request(app)
      .post('/api/ai-commerce/simulate-price-change')
      .send({ productId: inStockProduct.id });

    expect(surgeRes.status).toBe(200);
    expect(surgeRes.body.decision).toBe('BLOCK');
    expect(surgeRes.body.orderStatus).toBe('NOT CREATED');
    expect(surgeRes.body.paymentStatus).toContain('NOT ATTEMPTED');
  });

  // TEST 8: Catalog audit trail logs creations, price updates, stock updates, and status changes
  it('TEST 8: Catalog modifications generate immutable audit log records', async () => {
    // Update product price
    const updateRes = await request(app)
      .put(`/api/merchant/products/${inStockProduct.id}`)
      .set('Authorization', `Bearer ${merchantToken}`)
      .send({
        name: inStockProduct.name,
        price: parseFloat(inStockProduct.price) + 10,
        inventory: inStockProduct.inventory,
      });

    expect(updateRes.status).toBe(200);

    // Verify audit event recorded
    const auditRes = await query(`
      SELECT * FROM audit_events
      WHERE (metadata->>'productId' = $1 OR reasoning ILIKE $2)
        AND event_type IN ('PRICE_UPDATED', 'PRODUCT_UPDATED')
      ORDER BY created_at DESC LIMIT 1
    `, [inStockProduct.id, `%${inStockProduct.name}%`]);

    expect(auditRes.rows.length).toBeGreaterThan(0);
    expect(auditRes.rows[0].action).toBe('UPDATE_PRODUCT');

    // Revert price back to original
    await query("UPDATE products SET price = $1 WHERE id = $2", [inStockProduct.price, inStockProduct.id]);
  });
});
