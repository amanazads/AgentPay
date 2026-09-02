import { jest } from '@jest/globals';
import request from 'supertest';
import crypto from 'crypto';
import { app } from '../src/index.js';
import { query } from '../src/config/database.js';
import env from '../src/config/env.js';
import { generateAccessToken } from '../src/utils/authUtils.js';
import {
  generateQuote,
  verifyQuoteForCheckout,
  signCanonicalQuote,
  QuoteVerificationError,
  QuoteErrorCodes,
} from '../src/services/quoteService.js';
import { createPaymentOrder, verifyPayment } from '../src/services/paymentService.js';
import { reserveInventory, getAvailableInventory } from '../src/services/inventoryService.js';
import { calculatePrice, toRazorpayAmount } from '../src/services/pricingService.js';
import { evaluatePurchaseIntent } from '../src/services/decisionEngine.js';

jest.setTimeout(30000);

describe('Track 02: Dedicated Adversarial Price Integrity Audit Suite', () => {
  let buyerUser, buyerToken;
  let merchantId;
  let baseProduct;

  beforeAll(async () => {
    // 1. Create fresh isolated test buyer
    const insB = await query(`
      INSERT INTO users (email, name, role)
      VALUES ('buyer_price_adv_' || floor(random()*1000000) || '@agentpay.com', 'Price Integrity Adversary', 'BUYER')
      RETURNING *
    `);
    buyerUser = insB.rows[0];
    buyerToken = generateAccessToken(buyerUser);

    // Ensure generous buyer limits
    await query(`
      INSERT INTO user_preferences (user_id, monthly_budget, auto_purchase_limit, categories, purchase_behavior)
      VALUES ($1, 1000000, 200000, ARRAY['Electronics', 'Hardware', 'Peripherals'], 'auto_within_limit')
      ON CONFLICT (user_id) DO UPDATE SET
        monthly_budget = 1000000,
        auto_purchase_limit = 200000,
        purchase_behavior = 'auto_within_limit'
    `, [buyerUser.id]);

    // 2. Ensure verified merchant
    const mRes = await query("SELECT * FROM merchants WHERE is_verified = true AND (is_test_lab = false OR is_test_lab IS NULL) LIMIT 1");
    if (mRes.rows.length > 0) {
      merchantId = mRes.rows[0].id;
    } else {
      const insM = await query(`
        INSERT INTO merchants (name, category, is_verified, rating, is_test_lab)
        VALUES ('Price Defense Merchant', 'Electronics', true, 4.9, false)
        RETURNING *
      `);
      merchantId = insM.rows[0].id;
    }

    // 3. Create dedicated test product with base price ₹10,000
    const pRes = await query(`
      INSERT INTO products (
        merchant_id, sku, name, description, brand, category, price, currency, inventory, in_stock, specifications, status
      )
      VALUES ($1, $2, 'Price Integrity Benchmark Laptop Stand', 'Ergonomic aluminum stand', 'TechErgo', 'Electronics', 10000, 'INR', 100, true, '{}'::jsonb, 'ACTIVE')
      RETURNING *
    `, [merchantId, `SKU-PRICE-${Date.now()}`]);
    baseProduct = pRes.rows[0];
  });

  afterAll(async () => {
    if (baseProduct) {
      await query('DELETE FROM invoices WHERE order_id IN (SELECT id FROM orders WHERE purchase_intent_id IN (SELECT id FROM purchase_intents WHERE product_id = $1))', [baseProduct.id]);
      await query('DELETE FROM orders WHERE purchase_intent_id IN (SELECT id FROM purchase_intents WHERE product_id = $1)', [baseProduct.id]);
      await query('DELETE FROM transactions WHERE purchase_intent_id IN (SELECT id FROM purchase_intents WHERE product_id = $1)', [baseProduct.id]);
      await query('DELETE FROM inventory_reservations WHERE product_id = $1', [baseProduct.id]);
      await query('DELETE FROM purchase_intents WHERE product_id = $1', [baseProduct.id]);
      await query('DELETE FROM quotes WHERE product_id = $1', [baseProduct.id]);
      await query('DELETE FROM products WHERE id = $1', [baseProduct.id]);
    }
  });

  // ── TEST 1: +1% Price Increase (Within Tolerance) ───────────────────────────
  it('TEST 1: +1% catalog price increase is WITHIN 2.0% tolerance and ALLOWED', async () => {
    // Reset product price to ₹10,000
    await query('UPDATE products SET price = 10000, in_stock = true, inventory = 100 WHERE id = $1', [baseProduct.id]);

    // Generate locked quote at ₹10,000
    const quote = await generateQuote({
      productId: baseProduct.id,
      quantity: 1,
      userId: buyerUser.id,
      reserveStock: true,
    });
    expect(quote.unitPrice).toBe(10000);

    // Merchant updates live catalog price to ₹10,100 (+1.0%)
    await query('UPDATE products SET price = 10100 WHERE id = $1', [baseProduct.id]);

    // Verify quote for checkout with default 2.0% tolerance
    const verification = await verifyQuoteForCheckout(quote.quoteId, {
      userId: buyerUser.id,
      requestedProductId: baseProduct.id,
      requestedQuantity: 1,
    });

    expect(verification.valid).toBe(true);
    expect(verification.quote.unitPrice).toBe(10000); // Locked to quote price
  });

  // ── TEST 2: +2% Price Increase (Exact Boundary) ─────────────────────────────
  it('TEST 2: +2% catalog price increase is on EXACT boundary and ALLOWED', async () => {
    // Reset product price to ₹10,000
    await query('UPDATE products SET price = 10000, in_stock = true, inventory = 100 WHERE id = $1', [baseProduct.id]);

    // Generate locked quote at ₹10,000
    const quote = await generateQuote({
      productId: baseProduct.id,
      quantity: 1,
      userId: buyerUser.id,
      reserveStock: true,
    });
    expect(quote.unitPrice).toBe(10000);

    // Merchant updates live catalog price to ₹10,200 (+2.00%)
    await query('UPDATE products SET price = 10200 WHERE id = $1', [baseProduct.id]);

    const verification = await verifyQuoteForCheckout(quote.quoteId, {
      userId: buyerUser.id,
      requestedProductId: baseProduct.id,
      requestedQuantity: 1,
    });

    expect(verification.valid).toBe(true);
    expect(verification.quote.unitPrice).toBe(10000);
  });

  // ── TEST 3: +2.01% Price Increase (Exceeds Tolerance) ───────────────────────
  it('TEST 3: +2.01% catalog price increase EXCEEDS 2.0% tolerance, ABORTS payment, and RELEASES reservation', async () => {
    // Reset product price to ₹10,000
    await query('UPDATE products SET price = 10000, in_stock = true, inventory = 100 WHERE id = $1', [baseProduct.id]);

    // Generate locked quote with stock reservation
    const quote = await generateQuote({
      productId: baseProduct.id,
      quantity: 1,
      userId: buyerUser.id,
      reserveStock: true,
    });

    // Verify reservation is active
    const resvBefore = (await query('SELECT status FROM inventory_reservations WHERE quote_id = $1', [quote.quoteId])).rows[0];
    expect(resvBefore.status).toBe('RESERVED');

    // Merchant updates live catalog price to ₹10,201 (+2.01%)
    await query('UPDATE products SET price = 10201 WHERE id = $1', [baseProduct.id]);

    // Verification must fail with PRICE_SURGE_DETECTED
    let errorCaught = null;
    try {
      await verifyQuoteForCheckout(quote.quoteId, {
        userId: buyerUser.id,
        requestedProductId: baseProduct.id,
        requestedQuantity: 1,
      });
    } catch (err) {
      errorCaught = err;
    }

    expect(errorCaught).toBeInstanceOf(QuoteVerificationError);
    expect(errorCaught.code).toBe(QuoteErrorCodes.PRICE_SURGE_DETECTED);
    expect(errorCaught.message).toMatch(/Price surge detected/i);

    // In DB, reservation must be automatically RELEASED
    const resvAfter = (await query('SELECT status FROM inventory_reservations WHERE quote_id = $1', [quote.quoteId])).rows[0];
    expect(resvAfter.status).toBe('RELEASED');

    // Audit event must be recorded
    const auditRes = await query(`
      SELECT * FROM audit_events 
      WHERE event_type = 'PRICE_SURGE_DETECTED'
      ORDER BY created_at DESC LIMIT 1
    `);
    expect(auditRes.rows.length).toBe(1);
    expect(auditRes.rows[0].decision).toBe('BLOCK');
  });

  // ── TEST 4: Large Price Increase (+50% Surge) ───────────────────────────────
  it('TEST 4: Large +50% price surge is strictly BLOCKED, aborting payment creation', async () => {
    // Reset product price to ₹10,000
    await query('UPDATE products SET price = 10000, in_stock = true, inventory = 100 WHERE id = $1', [baseProduct.id]);

    const quote = await generateQuote({
      productId: baseProduct.id,
      quantity: 1,
      userId: buyerUser.id,
      reserveStock: true,
    });

    // Create purchase intent with quote
    const piRes = await query(`
      INSERT INTO purchase_intents (
        user_id, product_id, merchant_id, amount, quantity, status, state, quote_id
      )
      VALUES ($1, $2, $3, $4, 1, 'allowed', 'ALLOWED', $5)
      RETURNING *
    `, [buyerUser.id, baseProduct.id, merchantId, quote.totalAmount, quote.quoteId]);
    const intent = piRes.rows[0];

    // Merchant spikes price to ₹15,000 (+50%)
    await query('UPDATE products SET price = 15000 WHERE id = $1', [baseProduct.id]);

    // Payment creation must fail closed on live catalog re-read
    await expect(
      createPaymentOrder({ purchaseIntentId: intent.id, quoteId: quote.quoteId })
    ).rejects.toThrow(/Price surge detected/i);

    // Assert zero transactions created in DB
    const txRes = await query('SELECT * FROM transactions WHERE purchase_intent_id = $1', [intent.id]);
    expect(txRes.rows.length).toBe(0);

    // Assert reservation released
    const resv = (await query('SELECT status FROM inventory_reservations WHERE quote_id = $1', [quote.quoteId])).rows[0];
    expect(resv.status).toBe('RELEASED');
  });

  // ── TEST 5: Price Decrease (-5% Discount) ───────────────────────────────────
  it('TEST 5: Price decrease (-5% discount) is ALLOWED and never blocked by surge protection', async () => {
    // Reset product price to ₹10,000
    await query('UPDATE products SET price = 10000, in_stock = true, inventory = 100 WHERE id = $1', [baseProduct.id]);

    const quote = await generateQuote({
      productId: baseProduct.id,
      quantity: 1,
      userId: buyerUser.id,
      reserveStock: true,
    });

    // Merchant drops price to ₹9,500 (-5.0%)
    await query('UPDATE products SET price = 9500 WHERE id = $1', [baseProduct.id]);

    // Verification must succeed (price drop is allowed)
    const verification = await verifyQuoteForCheckout(quote.quoteId, {
      userId: buyerUser.id,
      requestedProductId: baseProduct.id,
      requestedQuantity: 1,
    });

    expect(verification.valid).toBe(true);
  });

  // ── TEST 6: Stale / Expired Quote Replay ─────────────────────────────────────
  it('TEST 6: Stale / Expired quote is strictly rejected with QUOTE_EXPIRED', async () => {
    await query('UPDATE products SET price = 10000, in_stock = true, inventory = 100 WHERE id = $1', [baseProduct.id]);

    // Generate expired quote (-10 minutes in the past)
    const quote = await generateQuote({
      productId: baseProduct.id,
      quantity: 1,
      userId: buyerUser.id,
      durationMinutes: -10, // Expired immediately
    });

    await expect(
      verifyQuoteForCheckout(quote.quoteId, {
        userId: buyerUser.id,
        requestedProductId: baseProduct.id,
      })
    ).rejects.toThrow(/has expired/i);
  });

  // ── TEST 7: Manipulated Client Amount (Tampered Price / Payload) ─────────────
  it('TEST 7: Manipulating client-submitted price payload triggers HMAC signature mismatch and fails', async () => {
    await query('UPDATE products SET price = 10000, in_stock = true, inventory = 100 WHERE id = $1', [baseProduct.id]);

    const quote = await generateQuote({
      productId: baseProduct.id,
      quantity: 1,
      userId: buyerUser.id,
    });

    // Attacker modifies unitPrice from ₹10,000 to ₹1,000 in the quote object
    const tamperedQuote = {
      ...quote,
      unitPrice: 1000,
      subtotal: 1000,
      totalAmount: 1180,
    };

    // Verification must fail with INVALID_QUOTE_SIGNATURE
    let tamperError = null;
    try {
      await verifyQuoteForCheckout(tamperedQuote, {
        userId: buyerUser.id,
        requestedProductId: baseProduct.id,
      });
    } catch (err) {
      tamperError = err;
    }

    expect(tamperError).toBeInstanceOf(QuoteVerificationError);
    expect(tamperError.code).toBe(QuoteErrorCodes.INVALID_QUOTE_SIGNATURE);
  });

  // ── TEST 8: Product ID Substitution / Swapping Attack ───────────────────────
  it('TEST 8: Submitting cheap product quote for expensive product is BLOCKED with MERCHANT_PRODUCT_MISMATCH', async () => {
    // Create expensive product (₹50,000)
    const expRes = await query(`
      INSERT INTO products (merchant_id, sku, name, description, brand, category, price, currency, inventory, in_stock, specifications, status)
      VALUES ($1, $2, 'Flagship Ultrabook Laptop', 'High-end laptop', 'ProBrand', 'Electronics', 50000, 'INR', 10, true, '{}'::jsonb, 'ACTIVE')
      RETURNING *
    `, [merchantId, `SKU-EXP-${Date.now()}`]);
    const expensiveProduct = expRes.rows[0];

    // Generate quote for cheap product (₹10,000)
    const cheapQuote = await generateQuote({
      productId: baseProduct.id,
      quantity: 1,
      userId: buyerUser.id,
    });

    // Attacker attempts to use cheapQuote to purchase expensiveProduct
    let swapError = null;
    try {
      await verifyQuoteForCheckout(cheapQuote.quoteId, {
        userId: buyerUser.id,
        requestedProductId: expensiveProduct.id,
      });
    } catch (err) {
      swapError = err;
    }

    expect(swapError).toBeInstanceOf(QuoteVerificationError);
    expect(swapError.code).toBe(QuoteErrorCodes.MERCHANT_PRODUCT_MISMATCH);

    // Clean up
    await query('DELETE FROM products WHERE id = $1', [expensiveProduct.id]);
  });

  // ── TEST 9: Concurrent Catalog Price Update During Checkout ─────────────────
  it('TEST 9: Pre-payment live catalog re-read catches concurrent price drift before payment creation', async () => {
    await query('UPDATE products SET price = 10000, in_stock = true, inventory = 100 WHERE id = $1', [baseProduct.id]);

    const quote = await generateQuote({
      productId: baseProduct.id,
      quantity: 1,
      userId: buyerUser.id,
      reserveStock: true,
    });

    const piRes = await query(`
      INSERT INTO purchase_intents (user_id, product_id, merchant_id, amount, quantity, status, state, quote_id)
      VALUES ($1, $2, $3, $4, 1, 'allowed', 'ALLOWED', $5)
      RETURNING *
    `, [buyerUser.id, baseProduct.id, merchantId, quote.totalAmount, quote.quoteId]);
    const intent = piRes.rows[0];

    // Concurrently, merchant changes product price in database to ₹13,000 (+30%)
    await query('UPDATE products SET price = 13000 WHERE id = $1', [baseProduct.id]);

    // createPaymentOrder must catch the live catalog surge and reject
    await expect(
      createPaymentOrder({ purchaseIntentId: intent.id, quoteId: quote.quoteId })
    ).rejects.toThrow(/Price surge detected/i);
  });

  // ── TEST 10: Payment Provider Amount Guarantee ──────────────────────────────
  it('TEST 10: Payment provider orders are created strictly with server-calculated authoritative amount', async () => {
    const p10Res = await query(`
      INSERT INTO products (merchant_id, sku, name, description, brand, category, price, currency, inventory, in_stock, specifications, status)
      VALUES ($1, $2, 'Payment Provider Amount Guarantee Unit', 'Test unit', 'TechErgo', 'Electronics', 10000, 'INR', 100, true, '{}'::jsonb, 'ACTIVE')
      RETURNING *
    `, [merchantId, `SKU-P10-${Date.now()}`]);
    const p10 = p10Res.rows[0];

    const quote = await generateQuote({
      productId: p10.id,
      quantity: 1,
      userId: buyerUser.id,
      reserveStock: true,
    });

    const piRes = await query(`
      INSERT INTO purchase_intents (user_id, product_id, merchant_id, amount, quantity, status, state, quote_id)
      VALUES ($1, $2, $3, $4, 1, 'allowed', 'ALLOWED', $5)
      RETURNING *
    `, [buyerUser.id, p10.id, merchantId, quote.totalAmount, quote.quoteId]);
    const intent = piRes.rows[0];

    const paymentOrder = await createPaymentOrder({ purchaseIntentId: intent.id, quoteId: quote.quoteId });

    // Assert that payment order amount in paise matches authoritative calculation
    const authoritativePricing = calculatePrice({ product: p10, quantity: 1 });
    expect(paymentOrder.amount).toBe(authoritativePricing.totalAmount);
    expect(paymentOrder.amountInPaise).toBe(toRazorpayAmount(authoritativePricing.totalAmount));

    // Clean up
    await query('DELETE FROM transactions WHERE purchase_intent_id = $1', [intent.id]);
    await query('DELETE FROM inventory_reservations WHERE product_id = $1', [p10.id]);
    await query('DELETE FROM purchase_intents WHERE id = $1', [intent.id]);
    await query('DELETE FROM quotes WHERE product_id = $1', [p10.id]);
    await query('DELETE FROM products WHERE id = $1', [p10.id]);
  });
});
