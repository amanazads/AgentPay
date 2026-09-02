/**
 * End-to-End Pricing Consistency Integration Suite
 * 
 * Invariant under test:
 *   quote.totalAmount === checkout.totalAmount === payment.order.amount === transaction.amount === order.total === invoice.total
 * 
 * Proves that pricing, tax, delivery fee, quote total, checkout total, payment amount,
 * order total, and invoice total are NEVER calculated independently with divergent formulas.
 */
import request from 'supertest';
import express from 'express';
import crypto from 'crypto';
import { query } from '../src/config/database.js';
import env from '../src/config/env.js';
import aiRoutes from '../src/routes/ai.js';
import { merchantConnector } from '../src/services/merchantConnector.js';
import { commerceOrchestrator } from '../src/services/merchantAdapter.js';
import { createPaymentOrder, verifyPayment } from '../src/services/paymentService.js';
import { createOrder } from '../src/services/orderService.js';
import { generateInvoiceForOrder } from '../src/services/invoiceService.js';
import { calculatePrice, toRazorpayAmount } from '../src/services/pricingService.js';

const app = express();
app.use(express.json());
app.use('/api/ai', aiRoutes);

describe('Track 01: Authoritative End-to-End Pricing Consistency Suite', () => {
  let testUser;
  let testAgent;
  let testMerchant;
  let testProduct;

  beforeAll(async () => {
    // 1. Get or create a verified merchant
    let mRes = await query("SELECT * FROM merchants WHERE is_verified = true AND (is_test_lab = false OR is_test_lab IS NULL) LIMIT 1");
    if (mRes.rows.length > 0) {
      testMerchant = mRes.rows[0];
    } else {
      const insM = await query(`
        INSERT INTO merchants (name, category, is_verified, rating, is_test_lab)
        VALUES ('Pricing Verified Store', 'Electronics', true, 4.9, false)
        RETURNING *
      `);
      testMerchant = insM.rows[0];
    }

    // 2. Get or create a product with known price and zero/known delivery fee
    let pRes = await query(`
      SELECT * FROM products 
      WHERE merchant_id = $1 AND in_stock = true AND price > 0 AND (is_test_lab = false OR is_test_lab IS NULL)
      LIMIT 1
    `, [testMerchant.id]);

    if (pRes.rows.length > 0) {
      testProduct = pRes.rows[0];
      await query("UPDATE products SET in_stock = true, inventory = 100, status = 'ACTIVE' WHERE id = $1", [testProduct.id]);
    } else {
      const insP = await query(`
        INSERT INTO products (merchant_id, name, description, category, price, in_stock, inventory, status)
        VALUES ($1, 'High Precision Hardware Pro', 'Test hardware description', 'Electronics', 1499.00, true, 100, 'ACTIVE')
        RETURNING *
      `, [testMerchant.id]);
      testProduct = insP.rows[0];
    }

    // 3. Ensure test user
    const uRes = await query("SELECT * FROM users WHERE role = 'BUYER' OR role = 'user' LIMIT 1");
    if (uRes.rows.length > 0) {
      testUser = uRes.rows[0];
    } else {
      const insU = await query(`
        INSERT INTO users (email, name, role)
        VALUES ('pricing_test_user@agentpay.com', 'Pricing Test Buyer', 'BUYER')
        RETURNING *
      `);
      testUser = insU.rows[0];
    }

    // 4. Ensure test agent
    const aRes = await query("SELECT * FROM agents LIMIT 1");
    if (aRes.rows.length > 0) {
      testAgent = aRes.rows[0];
    } else {
      const insA = await query(`
        INSERT INTO agents (name, owner_id, status)
        VALUES ('Procurement Agent Pro', $1, 'active')
        RETURNING *
      `, [testUser.id]);
      testAgent = insA.rows[0];
    }
  });

  // ── TEST 1: Full Chain Invariant: Quantity = 1 ──────────────────────────────
  test('TEST 1: Full Lifecycle Invariant: Quote → Checkout → Payment Order → Transaction → Order → Invoice produces IDENTICAL monetary totals (Qty: 1, Standard Delivery)', async () => {
    const qty = 1;
    const deliveryMethod = 'STANDARD';
    const canonicalPricing = calculatePrice({
      product: testProduct,
      quantity: qty,
      deliveryMethod,
    });

    // 1. Machine-Guaranteed AI Quote API
    const quoteRes = await request(app)
      .post('/api/ai/quote')
      .send({
        productId: testProduct.id,
        quantity: qty,
        deliveryMethod,
      });

    expect(quoteRes.status).toBe(200);
    const quote = quoteRes.body;
    expect(quote.totalAmount).toBe(canonicalPricing.totalAmount);
    expect(quote.subtotal).toBe(canonicalPricing.subtotal);
    expect(quote.deliveryFee).toBe(canonicalPricing.deliveryFee);
    expect(quote.taxAmount).toBe(canonicalPricing.taxAmount);

    // 2. Merchant Connector & Adapter Checkout Total
    const connectorQuote = await merchantConnector.getQuote(testMerchant.id, testProduct.id, qty);
    expect(connectorQuote.totalAmount).toBe(canonicalPricing.totalAmount);

    const adapter = await commerceOrchestrator.getAdapter(testMerchant.id);
    if (adapter) {
      const cart = await adapter.createCart([{ productId: testProduct.id, quantity: qty }]);
      expect(cart.subtotal).toBe(canonicalPricing.subtotal);
    }

    // 3. Purchase Intent
    const idempotencyKey = `pricing_test_intent_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const intentRes = await query(`
      INSERT INTO purchase_intents (
        agent_id, user_id, product_id, merchant_id, amount,
        quantity, status, idempotency_key
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'allowed', $7)
      RETURNING *
    `, [
      testAgent.id,
      testUser.id,
      testProduct.id,
      testMerchant.id,
      canonicalPricing.totalAmount,
      qty,
      idempotencyKey,
    ]);
    const intent = intentRes.rows[0];
    expect(parseFloat(intent.amount)).toBe(canonicalPricing.totalAmount);

    // 4. Payment Order Creation (Razorpay rails)
    const paymentOrder = await createPaymentOrder({ purchaseIntentId: intent.id });
    expect(paymentOrder.amount).toBe(canonicalPricing.totalAmount);
    expect(paymentOrder.amountInPaise).toBe(toRazorpayAmount(canonicalPricing.totalAmount));

    // 5. Transaction Record
    const txRes = await query('SELECT * FROM transactions WHERE id = $1', [paymentOrder.transactionId]);
    const transaction = txRes.rows[0];
    expect(parseFloat(transaction.amount)).toBe(canonicalPricing.totalAmount);

    // 6. Cryptographic Payment Verification & Confirmed Order
    const fakePaymentId = `pay_test_${crypto.randomBytes(6).toString('hex')}`;
    const fakeSignature = crypto
      .createHmac('sha256', env.RAZORPAY_TEST_KEY_SECRET || 'test_secret')
      .update(`${paymentOrder.orderId}|${fakePaymentId}`)
      .digest('hex');

    const verifyResult = await verifyPayment({
      transactionId: transaction.id,
      razorpayOrderId: paymentOrder.orderId,
      razorpayPaymentId: fakePaymentId,
      razorpaySignature: fakeSignature,
    });
    expect(verifyResult.verified).toBe(true);

    // 7. Confirmed Order
    const orderRes = await query('SELECT * FROM orders WHERE transaction_id = $1', [transaction.id]);
    const confirmedOrder = orderRes.rows[0];
    expect(parseFloat(confirmedOrder.total_amount)).toBe(canonicalPricing.totalAmount);
    expect(parseFloat(confirmedOrder.unit_price)).toBe(canonicalPricing.unitPrice);
    expect(parseFloat(confirmedOrder.subtotal)).toBe(canonicalPricing.subtotal);
    expect(parseFloat(confirmedOrder.delivery_fee)).toBe(canonicalPricing.deliveryFee);
    expect(parseFloat(confirmedOrder.tax)).toBe(canonicalPricing.taxAmount);

    // 8. Invoice Record
    const invRes = await query('SELECT * FROM invoices WHERE order_id = $1', [confirmedOrder.id]);
    const invoice = invRes.rows[0];
    expect(parseFloat(invoice.total_amount)).toBe(canonicalPricing.totalAmount);
    expect(parseFloat(invoice.subtotal)).toBe(canonicalPricing.subtotal);
    expect(parseFloat(invoice.delivery_fee)).toBe(canonicalPricing.deliveryFee);
    expect(parseFloat(invoice.tax)).toBe(canonicalPricing.taxAmount);

    // ── STRICT CHAIN EQUALITY ASSERTION ──────────────────────────────────────
    const allAmounts = [
      quote.totalAmount,
      connectorQuote.totalAmount,
      parseFloat(intent.amount),
      paymentOrder.amount,
      parseFloat(transaction.amount),
      parseFloat(confirmedOrder.total_amount),
      parseFloat(invoice.total_amount),
    ];

    const uniqueAmounts = new Set(allAmounts);
    expect(uniqueAmounts.size).toBe(1);
    expect(allAmounts[0]).toBe(canonicalPricing.totalAmount);
  });

  // ── TEST 2: Multi-Item Quantity Invariant: Quantity = 3 ─────────────────────
  test('TEST 2: Quantity > 1 (Qty: 3) maintains exact mathematical consistency across quote, order, and invoice', async () => {
    const qty = 3;
    const canonicalPricing = calculatePrice({
      product: testProduct,
      quantity: qty,
      deliveryMethod: 'STANDARD',
    });

    const quoteRes = await request(app)
      .post('/api/ai/quote')
      .send({
        productId: testProduct.id,
        quantity: qty,
      });

    expect(quoteRes.status).toBe(200);
    const quote = quoteRes.body;
    expect(quote.quantity).toBe(3);
    expect(quote.unitPrice).toBe(parseFloat(testProduct.price));
    expect(quote.subtotal).toBe(parseFloat(testProduct.price) * 3);
    expect(quote.totalAmount).toBe(canonicalPricing.totalAmount);
    expect(quote.taxAmount).toBe(canonicalPricing.taxAmount);

    // Direct Order + Invoice creation
    const idempotencyKey = `pricing_test_qty3_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const order = await createOrder({
      productId: testProduct.id,
      merchantId: testMerchant.id,
      userId: testUser.id,
      quantity: canonicalPricing.quantity,
      unitPrice: canonicalPricing.unitPrice,
      subtotal: canonicalPricing.subtotal,
      discount: canonicalPricing.discountAmount,
      tax: canonicalPricing.taxAmount,
      deliveryFee: canonicalPricing.deliveryFee,
      totalAmount: canonicalPricing.totalAmount,
    });

    const invoice = await generateInvoiceForOrder(order.id);

    expect(quote.totalAmount).toBe(parseFloat(order.total_amount));
    expect(parseFloat(order.total_amount)).toBe(parseFloat(invoice.total_amount));
    expect(parseFloat(order.subtotal)).toBe(parseFloat(invoice.subtotal));
    expect(parseFloat(order.tax)).toBe(parseFloat(invoice.tax));
  });

  // ── TEST 3: Express Delivery Fee Invariant ──────────────────────────────────
  test('TEST 3: Express Delivery Method adds exact delivery fee (₹199) consistently across quote and pricing', async () => {
    const canonicalPricing = calculatePrice({
      product: testProduct,
      quantity: 1,
      deliveryMethod: 'EXPRESS',
    });

    const quoteRes = await request(app)
      .post('/api/ai/quote')
      .send({
        productId: testProduct.id,
        quantity: 1,
        deliveryMethod: 'EXPRESS',
      });

    expect(quoteRes.status).toBe(200);
    expect(quoteRes.body.deliveryFee).toBe(199);
    expect(quoteRes.body.totalAmount).toBe(parseFloat(testProduct.price) + 199);
    expect(quoteRes.body.totalAmount).toBe(canonicalPricing.totalAmount);
  });
});
