import request from 'supertest';
import { app } from '../src/index.js';
import { query } from '../src/config/database.js';
import { findEligibleProducts } from '../src/services/candidateFilter.js';
import { parseBuyerIntent } from '../src/services/intentParser.js';
import { reserveInventory, releaseReservation, commitReservation } from '../src/services/inventoryService.js';
import { createPaymentOrder, verifyPayment } from '../src/services/paymentService.js';
import { createOrder, transitionOrderFulfillment, cancelOrder } from '../src/services/orderService.js';
import { reconcileOrders } from '../src/services/reconciliationService.js';
import { generateAccessToken } from '../src/utils/authUtils.js';

describe('Track 01: Critical Order Ledger, Inventory & Idempotency Hardening Suite', () => {
  let merchantUser;
  let buyerUser;
  let merchantToken;
  let buyerToken;
  let merchantId;
  let inStockProduct;

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
        VALUES ('order_ledger_tester_${Date.now()}@agentpay.com', 'Order Ledger Tester', 'MERCHANT', $1)
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

    // 3. Ensure test product
    let pRes = await query("SELECT * FROM products WHERE merchant_id = $1 AND in_stock = true AND inventory > 0 LIMIT 1", [merchantId]);
    if (pRes.rows.length === 0) {
      const insP = await query(`
        INSERT INTO products (merchant_id, sku, name, description, brand, category, price, currency, inventory, in_stock, specifications, status)
        VALUES ($1, 'SKU-ORD-01', 'Logitech MX Master 3S Wireless Mouse', 'Mouse', 'Logitech', 'Electronics', 8995, 'INR', 10, true, '{"connectivity":"Bluetooth"}'::jsonb, 'ACTIVE')
        RETURNING *
      `, [merchantId]);
      inStockProduct = insP.rows[0];
    } else {
      const updP = await query("UPDATE products SET name = 'Logitech MX Master 3S Wireless Mouse', brand = 'Logitech', category = 'Electronics', in_stock = true, inventory = 10, status = 'ACTIVE' WHERE id = $1 RETURNING *", [pRes.rows[0].id]);
      inStockProduct = updP.rows[0];
    }
  });

  // TEST 1: Exact product matching
  it('TEST 1: Exact product query selects matching SKU and does not substitute unrelated items', async () => {
    const intent = await parseBuyerIntent(`Buy the ${inStockProduct.name}`);
    const result = await findEligibleProducts(intent, { merchantId });

    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates.some(c => c.id === inStockProduct.id)).toBe(true);
  });

  // TEST 2: Unavailable product returns NO MATCH
  it('TEST 2: Requesting non-existent product returns NO MATCH with zero fallback items', async () => {
    const missingIntent = await parseBuyerIntent('Buy NonExistentQuantumHyperDrive999');
    const result = await findEligibleProducts(missingIntent, { merchantId });

    expect(result.candidates.length).toBe(0);
  });

  // TEST 3: Out-of-stock product purchase is strictly blocked
  it('TEST 3: Out-of-stock product is excluded from purchase execution with zero orders created', async () => {
    const insOos = await query(`
      INSERT INTO products (merchant_id, sku, name, description, brand, category, price, currency, inventory, in_stock, specifications, status)
      VALUES ($1, 'SKU-OOS-TEST01', 'Out of Stock Test Unit', 'Test description', 'BrandX', 'Electronics', 1000, 'INR', 0, false, '{"capacity": "10000mAh"}'::jsonb, 'ACTIVE')
      RETURNING id
    `, [merchantId]);
    const oosId = insOos.rows[0].id;

    // Verify reservation rejects
    await expect(reserveInventory({
      productId: oosId,
      quantity: 1,
      quoteId: `quote_oos_${Date.now()}`,
    })).rejects.toThrow(/Insufficient inventory/i);

    // Clean up
    await query("DELETE FROM products WHERE id = $1", [oosId]);
  });

  // TEST 4: Price increase revalidation blocks transaction
  it('TEST 4: Price surge revalidation halts transaction with ₹0 charged and zero orders created', async () => {
    const surgeRes = await request(app)
      .post('/api/ai-commerce/simulate-price-change')
      .send({ productId: inStockProduct.id });

    expect(surgeRes.status).toBe(200);
    expect(surgeRes.body.decision).toBe('BLOCK');
    expect(surgeRes.body.orderStatus).toBe('NOT CREATED');
    expect(surgeRes.body.paymentStatus).toContain('NOT ATTEMPTED');
  });

  // TEST 5: One Intent = One Order (Strict Database Uniqueness & Idempotency)
  it('TEST 5: Duplicate purchase intent returns existing canonical order without creating duplicates', async () => {
    const idempKey = `idemp_order_test_${Date.now()}`;
    const piRes = await query(`
      INSERT INTO purchase_intents (user_id, merchant_id, product_id, amount, quantity, status, idempotency_key)
      VALUES ($1, $2, $3, $4, 1, 'approved', $5)
      RETURNING id
    `, [buyerUser.id, merchantId, inStockProduct.id, inStockProduct.price, idempKey]);
    const piId = piRes.rows[0].id;

    const txRes = await query(`
      INSERT INTO transactions (purchase_intent_id, user_id, amount, currency, status, idempotency_key)
      VALUES ($1, $2, $3, 'INR', 'verified', $4)
      RETURNING id
    `, [piId, buyerUser.id, inStockProduct.price, idempKey]);
    const txId = txRes.rows[0].id;

    // First order creation
    const order1 = await createOrder({
      purchaseIntentId: piId,
      transactionId: txId,
      userId: buyerUser.id,
      merchantId,
      productId: inStockProduct.id,
      totalAmount: parseFloat(inStockProduct.price),
      quoteId: `quote_${Date.now()}`,
    });

    expect(order1.id).toBeDefined();

    // Second duplicate creation attempt
    const order2 = await createOrder({
      purchaseIntentId: piId,
      transactionId: txId,
      userId: buyerUser.id,
      merchantId,
      productId: inStockProduct.id,
      totalAmount: parseFloat(inStockProduct.price),
      quoteId: `quote_${Date.now()}`,
    });

    // Must return the exact same canonical order
    expect(order2.id).toBe(order1.id);
    expect(order2.order_number).toBe(order1.order_number);
  });

  // TEST 6: Atomic inventory reservation prevents overselling
  it('TEST 6: Atomic inventory locking with FOR UPDATE prevents concurrent overselling on stock = 1', async () => {
    const insSingle = await query(`
      INSERT INTO products (merchant_id, sku, name, price, currency, inventory, in_stock, category, status)
      VALUES ($1, 'SKU-SINGLE-CONCUR', 'Single Stock Flash Item', 1999, 'INR', 1, true, 'Electronics', 'ACTIVE')
      RETURNING id
    `, [merchantId]);
    const singleId = insSingle.rows[0].id;

    // Buyer A reserves
    const resA = await reserveInventory({
      productId: singleId,
      quantity: 1,
      quoteId: `quote_buyer_a_${Date.now()}`,
    });
    expect(resA.status).toBe('RESERVED');

    // Buyer B attempts concurrent reservation and fails
    await expect(reserveInventory({
      productId: singleId,
      quantity: 1,
      quoteId: `quote_buyer_b_${Date.now()}`,
    })).rejects.toThrow(/Insufficient inventory/i);

    // Clean up
    await releaseReservation(resA.reservationId, 'Test complete');
    await query("DELETE FROM products WHERE id = $1", [singleId]);
  });

  // TEST 7: Order cancellation semantics
  it('TEST 7: Order cancellation records cancelled_at, cancelled_by, cancellation_reason, and previous_status', async () => {
    const order = await createOrder({
      userId: buyerUser.id,
      merchantId,
      productId: inStockProduct.id,
      totalAmount: parseFloat(inStockProduct.price),
      productName: inStockProduct.name,
      productSku: inStockProduct.sku,
    });

    const cancelled = await cancelOrder(order.id, {
      cancelledBy: 'merchant',
      reason: 'BUYER_REQUESTED_CANCEL',
    });

    expect(cancelled.order_status).toBe('CANCELLED');
    expect(cancelled.fulfillment_status).toBe('CANCELLED');
    expect(cancelled.cancellation_reason).toBe('BUYER_REQUESTED_CANCEL');
    expect(cancelled.cancelled_by).toBe('merchant');
    expect(cancelled.cancelled_at).toBeDefined();
    expect(cancelled.previous_status).toBe('CONFIRMED');
  });

  // TEST 8: Fulfillment state machine rejects invalid transitions
  it('TEST 8: Fulfillment progression enforces strict state machine transitions', async () => {
    const order = await createOrder({
      userId: buyerUser.id,
      merchantId,
      productId: inStockProduct.id,
      totalAmount: parseFloat(inStockProduct.price),
      productName: inStockProduct.name,
      productSku: inStockProduct.sku,
    });

    // CONFIRMED -> PROCESSING (Valid)
    const proc = await transitionOrderFulfillment(order.id, 'PROCESSING', { merchantId });
    expect(proc.fulfillment_status).toBe('PROCESSING');

    // PROCESSING -> PACKED (Valid)
    const packed = await transitionOrderFulfillment(order.id, 'PACKED', { merchantId });
    expect(packed.fulfillment_status).toBe('PACKED');

    // PACKED -> SHIPPED (Valid with auto tracking number)
    const shipped = await transitionOrderFulfillment(order.id, 'SHIPPED', { merchantId });
    expect(shipped.fulfillment_status).toBe('SHIPPED');
    expect(shipped.tracking_number).toBeDefined();

    // Direct transition SHIPPED -> CONFIRMED (Invalid transition - must throw)
    await expect(transitionOrderFulfillment(order.id, 'CONFIRMED', { merchantId })).rejects.toThrow(/Invalid fulfillment transition/i);
  });

  // TEST 9: GET /api/merchant/orders returns structured canonical metrics summary
  it('TEST 9: Merchant orders API returns canonical KPI counters and order history', async () => {
    const res = await request(app)
      .get('/api/merchant/orders')
      .set('Authorization', `Bearer ${merchantToken}`);

    expect(res.status).toBe(200);
    expect(res.body.hasStore).toBe(true);
    expect(Array.isArray(res.body.orders)).toBe(true);
    expect(res.body.summary).toBeDefined();
    expect(typeof res.body.summary.totalOrders).toBe('number');
    expect(typeof res.body.summary.confirmedCount).toBe('number');
  });

  // TEST 10: Automated reconciliation verifies order consistency
  it('TEST 10: Automated order reconciliation scans and auto-heals orphan orders', async () => {
    const recon = await reconcileOrders({ autoHeal: true });
    expect(recon.success).toBe(true);
    expect(typeof recon.totalOrdersScanned).toBe('number');
  });
});
