import crypto from 'crypto';
import request from 'supertest';
import app from '../src/index.js';
import { query } from '../src/config/database.js';
import env from '../src/config/env.js';
import { generateAccessToken, hashPassword } from '../src/utils/authUtils.js';
import {
  calculatePrice,
  toRazorpayAmount,
  fromRazorpayAmount,
  TAX_RATE,
  DELIVERY_FEE_EXPRESS,
} from '../src/services/pricingService.js';
import { generateQuote, verifyQuoteForCheckout, QuoteErrorCodes } from '../src/services/quoteService.js';
import { createOrder } from '../src/services/orderService.js';
import { generateInvoiceForOrder } from '../src/services/invoiceService.js';

describe('Track 01: Complete Pricing-Integrity & Mathematical Consistency Audit Suite', () => {
  let buyerUser;
  let buyerToken;
  let testMerchant;
  let testProduct;
  let activeAgent;
  let activePolicy;

  beforeAll(async () => {
    const passHash = await hashPassword('password123');

    // 1. Fetch / Seed Buyer User
    const uRes = await query("SELECT * FROM users WHERE role = 'BUYER' LIMIT 1");
    buyerUser = uRes.rows[0] || { id: '00000000-0000-0000-0000-000000000002', email: 'pricing_buyer@agentpay.ai', role: 'BUYER' };
    await query("UPDATE users SET password_hash = $1 WHERE id = $2", [passHash, buyerUser.id]);
    buyerToken = generateAccessToken({ ...buyerUser, role: 'BUYER' });

    // 2. Fetch verified Merchant
    const mRes = await query("SELECT * FROM merchants WHERE is_verified = true LIMIT 1");
    testMerchant = mRes.rows[0];

    // 3. Fetch or create Product with precise pricing
    const pRes = await query("SELECT * FROM products WHERE merchant_id = $1 AND in_stock = true AND inventory >= 10 LIMIT 1", [testMerchant.id]);
    if (pRes.rows.length > 0) {
      testProduct = pRes.rows[0];
    } else {
      const newP = await query(`
        INSERT INTO products (merchant_id, name, sku, category, price, inventory, in_stock, commerce_eligible)
        VALUES ($1, 'Pricing Integrity Test Device', 'SKU-PRICING-TEST', 'Electronics', 1999.00, 50, true, true)
        RETURNING *
      `, [testMerchant.id]);
      testProduct = newP.rows[0];
    }

    // Ensure test product has healthy stock
    await query("UPDATE products SET in_stock = true, inventory = 50, commerce_eligible = true, is_test_lab = false WHERE id = $1", [testProduct.id]);

    // 4. Fetch Agent & Policy
    const aRes = await query("SELECT * FROM agents WHERE status = 'active' LIMIT 1");
    activeAgent = aRes.rows[0];

    const polRes = await query("SELECT * FROM policies LIMIT 1");
    activePolicy = polRes.rows[0];

    // 5. Seed merchant connection, payment mandate & preferences for buyer
    await query(`
      INSERT INTO user_merchant_connections (user_id, merchant_id, connection_state, catalog_status, inventory_status, checkout_status, payment_provider_status, status)
      SELECT $1, id, 'CONNECTED', 'HEALTHY', 'FRESH', 'AVAILABLE', 'AVAILABLE', 'connected'
      FROM merchants
      ON CONFLICT DO NOTHING
    `, [buyerUser.id]);

    await query(`
      INSERT INTO user_payment_methods (user_id, provider, method_type, identifier_masked, single_transaction_limit, max_limit, daily_limit, is_default, status)
      VALUES ($1, 'razorpay', 'upi_mandate', 'pricing_buyer@oksbi', 500000.00, 500000.00, 1000000.00, true, 'active')
      ON CONFLICT DO NOTHING
    `, [buyerUser.id]);

    await query(`
      INSERT INTO user_preferences (user_id, monthly_budget, auto_purchase_limit, categories, purchase_behavior)
      VALUES ($1, 500000, 100000, ARRAY['Electronics', 'Peripherals', 'Hardware'], 'auto_within_limit')
      ON CONFLICT (user_id) DO UPDATE SET
        monthly_budget = 500000,
        auto_purchase_limit = 100000,
        categories = ARRAY['Electronics', 'Peripherals', 'Hardware'],
        purchase_behavior = 'auto_within_limit'
    `, [buyerUser.id]);

    await query("UPDATE system_state SET kill_switch_active = false WHERE id = 1");
  }, 30000);

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 1: Pure Pricing Service Function & Integer Paise Mathematical Precision
  // ──────────────────────────────────────────────────────────────────────────
  test('PRICING 1: Authoritative pricing calculation & integer paise conversion', () => {
    const testCases = [
      { price: 1999, qty: 1, method: 'STANDARD', fee: 0, discount: 0 },
      { price: 1499.50, qty: 2, method: 'EXPRESS', fee: 199, discount: 100 },
      { price: 99.99, qty: 3, method: 'STANDARD', fee: 50, discount: 20 },
      { price: 12345.67, qty: 1, method: 'EXPRESS', fee: 199, discount: 0 },
    ];

    for (const tc of testCases) {
      const pricing = calculatePrice({
        product: { price: tc.price, delivery_fee: tc.fee, currency: 'INR' },
        quantity: tc.qty,
        deliveryMethod: tc.method,
        discountAmount: tc.discount,
      });

      // 1. Subtotal = unitPrice × quantity
      expect(pricing.subtotal).toBe(Math.round(tc.price * tc.qty * 100) / 100);
      expect(pricing.subtotalInPaise).toBe(Math.round(pricing.subtotal * 100));

      // 2. Delivery fee
      const expectedFee = tc.method === 'EXPRESS' ? DELIVERY_FEE_EXPRESS : tc.fee;
      expect(pricing.deliveryFee).toBe(expectedFee);
      expect(pricing.deliveryFeeInPaise).toBe(Math.round(expectedFee * 100));

      // 3. Tax = 18% GST (deterministic)
      expect(pricing.taxAmount).toBe(Math.round(pricing.subtotal * TAX_RATE * 100) / 100);
      expect(pricing.taxInPaise).toBe(Math.round(pricing.subtotalInPaise * TAX_RATE));

      // 4. Total = subtotal + deliveryFee - discount
      const expectedTotal = Math.round((pricing.subtotal + pricing.deliveryFee - tc.discount) * 100) / 100;
      expect(pricing.totalAmount).toBe(expectedTotal);
      expect(pricing.amountInPaise).toBe(Math.round(expectedTotal * 100));

      // 5. Razorpay helper parity
      expect(toRazorpayAmount(pricing.totalAmount)).toBe(pricing.amountInPaise);
      expect(fromRazorpayAmount(pricing.amountInPaise)).toBe(pricing.totalAmount);
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 2: Multi-Item Pricing (Quantity > 1)
  // ──────────────────────────────────────────────────────────────────────────
  test('PRICING 2: Quantity > 1 scales subtotal exactly with zero rounding drift', async () => {
    const qty = 3;
    const unitPrice = parseFloat(testProduct.price);
    const quote = await generateQuote({
      productId: testProduct.id,
      quantity: qty,
      deliveryMethod: 'STANDARD',
      userId: buyerUser.id,
    });

    const expectedSubtotal = Math.round(unitPrice * qty * 100) / 100;
    expect(quote.quantity).toBe(qty);
    expect(quote.unitPrice).toBe(unitPrice);
    expect(quote.subtotal).toBe(expectedSubtotal);
    expect(quote.totalAmount).toBe(expectedSubtotal + quote.deliveryFee);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 3: Shipping Fee Variations (Standard vs Express Next-Day)
  // ──────────────────────────────────────────────────────────────────────────
  test('PRICING 3: Shipping fee is deterministically applied (Standard vs Express ₹199)', async () => {
    const standardQuote = await generateQuote({
      productId: testProduct.id,
      quantity: 1,
      deliveryMethod: 'STANDARD',
      userId: buyerUser.id,
    });

    const expressQuote = await generateQuote({
      productId: testProduct.id,
      quantity: 1,
      deliveryMethod: 'EXPRESS',
      userId: buyerUser.id,
    });

    expect(standardQuote.deliveryFee).toBe(parseFloat(testProduct.delivery_fee || 0));
    expect(expressQuote.deliveryFee).toBe(199);
    expect(expressQuote.totalAmount).toBe(standardQuote.subtotal + 199);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 4: Price Changed After Quote Generation Fails Closed
  // ──────────────────────────────────────────────────────────────────────────
  test('PRICING 4: Live catalog price modification triggers CATALOG_PRICE_CHANGED on checkout', async () => {
    const originalPrice = parseFloat(testProduct.price);
    const quote = await generateQuote({
      productId: testProduct.id,
      quantity: 1,
      userId: buyerUser.id,
    });

    try {
      // Simulate merchant changing product price in catalog
      const surgedPrice = originalPrice + 500;
      await query('UPDATE products SET price = $1 WHERE id = $2', [surgedPrice, testProduct.id]);

      // Attempt to verify quote for checkout — must reject fail-closed
      await expect(
        verifyQuoteForCheckout(quote.quoteId, {
          userId: buyerUser.id,
          requestedProductId: testProduct.id,
        })
      ).rejects.toThrow(/Catalog price.*has changed/i);
    } finally {
      // Restore original price
      await query('UPDATE products SET price = $1 WHERE id = $2', [originalPrice, testProduct.id]);
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 5: Client-Submitted Manipulated Price Rejection (Frontend Untrusted)
  // ──────────────────────────────────────────────────────────────────────────
  test('PRICING 5: Client-submitted manipulated price in purchase intent is strictly rejected', async () => {
    const unitPrice = parseFloat(testProduct.price);
    const manipulatedAmount = 1.00; // Client trying to pay ₹1 for a ₹1999 item

    const res = await request(app)
      .post('/api/purchase-intents')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        agent_id: activeAgent.id,
        product_id: testProduct.id,
        merchant_id: testMerchant.id,
        amount: manipulatedAmount,
        quantity: 1,
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PRICE_MANIPULATION_DETECTED');
    expect(res.body.authoritativeAmount).toBe(unitPrice);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 6: Order Creation Rejects Subtotal / Total Mathematical Mismatches
  // ──────────────────────────────────────────────────────────────────────────
  test('PRICING 6: createOrder throws error on mathematical inconsistency between subtotal and total', async () => {
    await expect(
      createOrder({
        purchaseIntentId: null,
        transactionId: null,
        userId: buyerUser.id,
        merchantId: testMerchant.id,
        productId: testProduct.id,
        quantity: 2,
        unitPrice: 1000,
        subtotal: 2000,
        deliveryFee: 100,
        discount: 0,
        totalAmount: 9999, // Mismatched total!
      })
    ).rejects.toThrow(/Order creation rejected: Total amount.*does not match/i);

    await expect(
      createOrder({
        purchaseIntentId: null,
        transactionId: null,
        userId: buyerUser.id,
        merchantId: testMerchant.id,
        productId: testProduct.id,
        quantity: 2,
        unitPrice: 1000,
        subtotal: 500, // Mismatched subtotal!
        deliveryFee: 0,
        discount: 0,
        totalAmount: 500,
      })
    ).rejects.toThrow(/Order creation rejected: Subtotal.*does not match/i);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 7: Complete End-to-End Pricing Integrity Chain
  // ──────────────────────────────────────────────────────────────────────────
  test('PRICING 7: Complete Chain Invariant: Catalog === Quote === Intent === Razorpay === Order === Invoice === GMV', async () => {
    const qty = 2;
    const deliveryMethod = 'EXPRESS';

    // 1. Catalog Price
    const catalogUnitPrice = parseFloat(testProduct.price);

    // 2. Authoritative Pricing Service Calculation
    const expectedPricing = calculatePrice({
      product: testProduct,
      quantity: qty,
      deliveryMethod,
    });

    // 3. Generate Cryptographic Price Lock Quote
    const quoteRes = await request(app)
      .post('/api/ai/quote')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        productId: testProduct.id,
        quantity: qty,
        deliveryMethod,
        userId: buyerUser.id,
        agentId: activeAgent.id,
      });

    expect(quoteRes.status).toBe(200);
    const quote = quoteRes.body;
    expect(quote.unitPrice).toBe(catalogUnitPrice);
    expect(quote.quantity).toBe(qty);
    expect(quote.subtotal).toBe(expectedPricing.subtotal);
    expect(quote.deliveryFee).toBe(expectedPricing.deliveryFee);
    expect(quote.taxAmount).toBe(expectedPricing.taxAmount);
    expect(quote.totalAmount).toBe(expectedPricing.totalAmount);

    // Shift previous intent timestamps back to satisfy 2-minute anti-replay policy
    await query("UPDATE purchase_intents SET created_at = NOW() - INTERVAL '5 minutes' WHERE agent_id = $1", [activeAgent.id]);

    // 4. Create Purchase Intent
    const intentRes = await request(app)
      .post('/api/purchase-intents')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        agent_id: activeAgent.id,
        product_id: testProduct.id,
        merchant_id: testMerchant.id,
        quantity: qty,
        delivery_method: deliveryMethod,
      });

    expect(intentRes.status).toBe(201);
    const intent = intentRes.body.purchaseIntent;
    expect(parseFloat(intent.amount)).toBe(expectedPricing.totalAmount);
    expect(intent.quantity).toBe(qty);

    // Ensure status is allowed
    await query("UPDATE purchase_intents SET status = 'allowed' WHERE id = $1", [intent.id]);

    // 5. Create Razorpay Test Order
    const rzpOrderRes = await request(app)
      .post('/api/payments/create-order')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        purchase_intent_id: intent.id,
        quote_id: quote.quoteId,
      });

    if (rzpOrderRes.status !== 201) {
      console.log('RZP_ORDER_ERROR:', rzpOrderRes.body);
    }
    expect(rzpOrderRes.status).toBe(201);
    expect(rzpOrderRes.body.amount).toBe(expectedPricing.totalAmount);
    expect(rzpOrderRes.body.amountInPaise).toBe(expectedPricing.amountInPaise);

    // 6. Verify Payment via HMAC
    const paymentId = `pay_integrity_${Date.now()}`;
    const validSignature = crypto
      .createHmac('sha256', env.RAZORPAY_TEST_KEY_SECRET)
      .update(`${rzpOrderRes.body.orderId}|${paymentId}`)
      .digest('hex');

    const verifyRes = await request(app)
      .post(`/api/payments/${rzpOrderRes.body.orderId}/verify`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        transactionId: rzpOrderRes.body.transactionId,
        razorpayPaymentId: paymentId,
        razorpaySignature: validSignature,
      });

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.verified).toBe(true);

    // 7. Inspect Created Order
    const ordersRes = await request(app)
      .get('/api/buyer/orders')
      .set('Authorization', `Bearer ${buyerToken}`);

    expect(ordersRes.status).toBe(200);
    const order = ordersRes.body.orders.find((o) => o.transaction_id === rzpOrderRes.body.transactionId);
    expect(order).toBeDefined();
    expect(parseFloat(order.unit_price)).toBe(catalogUnitPrice);
    expect(order.quantity).toBe(qty);
    expect(parseFloat(order.subtotal)).toBe(expectedPricing.subtotal);
    expect(parseFloat(order.delivery_fee)).toBe(expectedPricing.deliveryFee);
    expect(parseFloat(order.tax)).toBe(expectedPricing.taxAmount);
    expect(parseFloat(order.total_amount)).toBe(expectedPricing.totalAmount);

    // 8. Inspect Structured Tax Invoice
    const invoice = await generateInvoiceForOrder(order.id, {
      paymentReference: paymentId,
    });

    expect(invoice).toBeDefined();
    expect(parseFloat(invoice.subtotal)).toBe(expectedPricing.subtotal);
    expect(parseFloat(invoice.delivery_fee)).toBe(expectedPricing.deliveryFee);
    expect(parseFloat(invoice.tax)).toBe(expectedPricing.taxAmount);
    expect(parseFloat(invoice.total_amount)).toBe(expectedPricing.totalAmount);

    // 9. Inspect Analytics GMV & Revenue Aggregation
    const gmvRes = await query(`
      SELECT SUM(total_amount) as total_gmv
      FROM orders
      WHERE id = $1
    `, [order.id]);

    expect(parseFloat(gmvRes.rows[0].total_gmv)).toBe(expectedPricing.totalAmount);
  });
});
