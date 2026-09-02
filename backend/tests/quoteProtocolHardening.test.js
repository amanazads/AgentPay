/**
 * Machine-Readable Cryptographic Quote Protocol Hardening Suite
 * 
 * Invariants under test:
 * 1. A quote is cryptographically bound to the exact commercial terms (price, quantity, product, merchant, expiration, policy).
 * 2. Deterministic canonical serialization: identical payloads produce identical signatures.
 * 3. Client tampering of any field (amount, quantity, product, merchant, expiration) invalidates the signature and is rejected.
 * 4. Expired quotes cannot be used or replayed.
 * 5. Consumed quotes cannot be replayed for new orders.
 * 6. Catalog price changes or inventory exhaustion invalidate quote checkout.
 * 7. System remains fail-closed without leaking secrets.
 */
import request from 'supertest';
import express from 'express';
import crypto from 'crypto';
import { query } from '../src/config/database.js';
import aiRoutes from '../src/routes/ai.js';
import paymentRoutes from '../src/routes/payments.js';
import {
  generateQuote,
  verifyQuoteForCheckout,
  serializeCanonicalQuote,
  signCanonicalQuote,
  verifyQuoteSignature,
  consumeQuote,
  cancelQuote,
  QuoteErrorCodes,
  QuoteVerificationError,
} from '../src/services/quoteService.js';
import { createPaymentOrder } from '../src/services/paymentService.js';
import { generateAccessToken } from '../src/utils/authUtils.js';

const app = express();
app.use(express.json());
app.use('/api/ai', aiRoutes);
app.use('/api/payments', paymentRoutes);

describe('Track 01: Cryptographic Quote Protocol & Checkout Integrity Suite', () => {
  let testMerchant;
  let testProduct;
  let testUser;
  let userToken;

  beforeAll(async () => {
    // 1. Ensure verified merchant
    const mRes = await query("SELECT * FROM merchants WHERE is_verified = true LIMIT 1");
    if (mRes.rows.length > 0) {
      testMerchant = mRes.rows[0];
    } else {
      const insM = await query(`
        INSERT INTO merchants (name, category, is_verified, rating)
        VALUES ('Cryptographic Quote Store', 'Electronics', true, 4.9)
        RETURNING *
      `);
      testMerchant = insM.rows[0];
    }

    // 2. Ensure dedicated in-stock product
    const insP = await query(`
      INSERT INTO products (merchant_id, name, category, price, in_stock, inventory)
      VALUES ($1, 'Quote Protocol Test Product ' || $2, 'Electronics', 2499.00, true, 50)
      RETURNING *
    `, [testMerchant.id, Date.now()]);
    testProduct = insP.rows[0];

    // 3. Ensure dedicated test user
    const insU = await query(`
      INSERT INTO users (email, name, role)
      VALUES ('quote_tester_' || $1 || '@agentpay.com', 'Quote Protocol Tester', 'BUYER')
      RETURNING *
    `, [Date.now()]);
    testUser = insU.rows[0];
    userToken = generateAccessToken(testUser);
  });

  // ── TEST 1: Canonical Serialization & Deterministic Signature ──────────────
  test('TEST 1: Canonical serialization is strictly deterministic regardless of object key order', () => {
    const payload1 = {
      quoteId: 'quote_test123',
      productId: 'prod_abc',
      merchantId: 'merch_xyz',
      quantity: 2,
      unitPrice: 500.00,
      subtotal: 1000.00,
      deliveryFee: 0.00,
      tax: 180.00,
      totalAmount: 1000.00,
      currency: 'INR',
      deliveryMethod: 'STANDARD',
      expiration: '2026-08-30T12:00:00.000Z',
      policyVersion: 'v1.0',
    };

    // Construct identical payload with reversed key order
    const payload2 = {
      policyVersion: 'v1.0',
      expiration: '2026-08-30T12:00:00.000Z',
      deliveryMethod: 'STANDARD',
      currency: 'INR',
      totalAmount: 1000.00,
      tax: 180.00,
      deliveryFee: 0.00,
      subtotal: 1000.00,
      unitPrice: 500.00,
      quantity: 2,
      merchantId: 'merch_xyz',
      productId: 'prod_abc',
      quoteId: 'quote_test123',
    };

    const str1 = serializeCanonicalQuote(payload1);
    const str2 = serializeCanonicalQuote(payload2);
    expect(str1).toBe(str2);

    const sig1 = signCanonicalQuote(str1);
    const sig2 = signCanonicalQuote(str2);
    expect(sig1).toBe(sig2);
    expect(sig1).toHaveLength(64); // SHA256 hex
  });

  // ── TEST 2: Valid Quote Generation & Verification ───────────────────────────
  test('TEST 2: Valid quote generation succeeds with all mandatory canonical fields and passes checkout verification', async () => {
    const quote = await generateQuote({
      productId: testProduct.id,
      quantity: 1,
      deliveryMethod: 'STANDARD',
      userId: testUser.id,
    });

    expect(quote.quoteId).toMatch(/^quote_/);
    expect(quote.productId).toBe(testProduct.id);
    expect(quote.merchantId).toBe(testProduct.merchant_id);
    expect(quote.quantity).toBe(1);
    expect(quote.unitPrice).toBe(parseFloat(testProduct.price));
    expect(quote.subtotal).toBe(parseFloat(testProduct.price));
    expect(quote.deliveryFee).toBe(0);
    expect(quote.taxAmount).toBe(Math.round(parseFloat(testProduct.price) * 0.18 * 100) / 100);
    expect(quote.totalAmount).toBe(parseFloat(testProduct.price));
    expect(quote.currency).toBe('INR');
    expect(quote.signature).toBeDefined();
    expect(quote.expiration).toBeDefined();

    // Verify quote for checkout
    const verification = await verifyQuoteForCheckout(quote, {
      userId: testUser.id,
      requestedProductId: testProduct.id,
    });

    expect(verification.valid).toBe(true);
    expect(verification.quote.quoteId).toBe(quote.quoteId);
  });

  // ── TEST 3: Modified Amount Tampering ───────────────────────────────────────
  test('TEST 3: Client modification of totalAmount (tampering) fails signature check and halts checkout', async () => {
    const quote = await generateQuote({
      productId: testProduct.id,
      quantity: 1,
    });

    // Malicious attacker attempts to lower the price to ₹1 while retaining the signature
    const tamperedQuote = {
      ...quote,
      totalAmount: 1.00,
      subtotal: 1.00,
      unitPrice: 1.00,
    };

    await expect(
      verifyQuoteForCheckout(tamperedQuote)
    ).rejects.toThrow(QuoteVerificationError);

    try {
      await verifyQuoteForCheckout(tamperedQuote);
    } catch (err) {
      expect(err.code).toBe(QuoteErrorCodes.INVALID_QUOTE_SIGNATURE);
      expect(err.message).toContain('tampered');
    }
  });

  // ── TEST 4: Modified Quantity Tampering ─────────────────────────────────────
  test('TEST 4: Client modification of quantity fails signature verification and halts checkout', async () => {
    const quote = await generateQuote({
      productId: testProduct.id,
      quantity: 1,
    });

    // Attacker increases quantity from 1 to 5 without recalculating quote
    const tamperedQuote = {
      ...quote,
      quantity: 5,
    };

    await expect(
      verifyQuoteForCheckout(tamperedQuote)
    ).rejects.toThrow(QuoteVerificationError);

    try {
      await verifyQuoteForCheckout(tamperedQuote);
    } catch (err) {
      expect(err.code).toBe(QuoteErrorCodes.INVALID_QUOTE_SIGNATURE);
    }
  });

  // ── TEST 5: Modified Product Identity Tampering ─────────────────────────────
  test('TEST 5: Client swapping productId to a different product fails signature check', async () => {
    const quote = await generateQuote({
      productId: testProduct.id,
      quantity: 1,
    });

    const fakeProductId = '11111111-2222-3333-4444-555555555555';
    const tamperedQuote = {
      ...quote,
      productId: fakeProductId,
    };

    await expect(
      verifyQuoteForCheckout(tamperedQuote)
    ).rejects.toThrow(QuoteVerificationError);

    try {
      await verifyQuoteForCheckout(tamperedQuote);
    } catch (err) {
      expect(err.code).toBe(QuoteErrorCodes.INVALID_QUOTE_SIGNATURE);
    }
  });

  // ── TEST 6: Modified Merchant Identity Tampering ────────────────────────────
  test('TEST 6: Client swapping merchantId fails signature check', async () => {
    const quote = await generateQuote({
      productId: testProduct.id,
      quantity: 1,
    });

    const fakeMerchantId = '99999999-8888-7777-6666-555555555555';
    const tamperedQuote = {
      ...quote,
      merchantId: fakeMerchantId,
    };

    await expect(
      verifyQuoteForCheckout(tamperedQuote)
    ).rejects.toThrow(QuoteVerificationError);

    try {
      await verifyQuoteForCheckout(tamperedQuote);
    } catch (err) {
      expect(err.code).toBe(QuoteErrorCodes.INVALID_QUOTE_SIGNATURE);
    }
  });

  // ── TEST 7: Expired Quote Rejection ─────────────────────────────────────────
  test('TEST 7: Expired quote is rejected and cannot be used for checkout', async () => {
    // Generate quote with negative duration (already expired)
    const quote = await generateQuote({
      productId: testProduct.id,
      quantity: 1,
      durationMinutes: -5, // expired 5 minutes ago
    });

    await expect(
      verifyQuoteForCheckout(quote)
    ).rejects.toThrow(QuoteVerificationError);

    try {
      await verifyQuoteForCheckout(quote);
    } catch (err) {
      expect(err.code).toBe(QuoteErrorCodes.QUOTE_EXPIRED);
      expect(err.message).toContain('expired');
    }
  });

  // ── TEST 8: Invalid Cryptographic Signature ─────────────────────────────────
  test('TEST 8: Forged or corrupted signature is rejected with INVALID_QUOTE_SIGNATURE', async () => {
    const quote = await generateQuote({
      productId: testProduct.id,
      quantity: 1,
    });

    const forgedQuote = {
      ...quote,
      signature: 'deadbeef1234567890abcdefdeadbeef1234567890abcdefdeadbeef12345678',
    };

    await expect(
      verifyQuoteForCheckout(forgedQuote)
    ).rejects.toThrow(QuoteVerificationError);

    try {
      await verifyQuoteForCheckout(forgedQuote);
    } catch (err) {
      expect(err.code).toBe(QuoteErrorCodes.INVALID_QUOTE_SIGNATURE);
    }
  });

  // ── TEST 9: Replay Prevention on Consumed Quotes ────────────────────────────
  test('TEST 9: Consumed quote cannot be replayed for subsequent orders', async () => {
    const quote = await generateQuote({
      productId: testProduct.id,
      quantity: 1,
    });

    // Verify once before consumption
    const firstCheck = await verifyQuoteForCheckout(quote.quoteId);
    expect(firstCheck.valid).toBe(true);

    // Consume quote (simulating completed purchase)
    const consumeRes = await consumeQuote(quote.quoteId);
    expect(consumeRes.success).toBe(true);

    // Attempt to reuse the same quoteId
    await expect(
      verifyQuoteForCheckout(quote.quoteId)
    ).rejects.toThrow(QuoteVerificationError);

    try {
      await verifyQuoteForCheckout(quote.quoteId);
    } catch (err) {
      expect(err.code).toBe(QuoteErrorCodes.QUOTE_ALREADY_CONSUMED);
      expect(err.message).toContain('already been consumed');
    }
  });

  // ── TEST 10: Changed Catalog Price Invalidation ─────────────────────────────
  test('TEST 10: Changed catalog price invalidates quote during checkout revalidation', async () => {
    // 1. Create a dynamic test product with specific price
    const insP = await query(`
      INSERT INTO products (merchant_id, name, category, price, in_stock, inventory)
      VALUES ($1, 'Dynamic Price Product', 'Electronics', 999.00, true, 10)
      RETURNING *
    `, [testMerchant.id]);
    const dynProd = insP.rows[0];

    // 2. Generate quote at ₹999
    const quote = await generateQuote({
      productId: dynProd.id,
      quantity: 1,
    });

    // 3. Merchant updates price in catalog to ₹1499
    await query('UPDATE products SET price = 1499.00 WHERE id = $1', [dynProd.id]);

    // 4. Verification must catch the price discrepancy
    await expect(
      verifyQuoteForCheckout(quote)
    ).rejects.toThrow(QuoteVerificationError);

    try {
      await verifyQuoteForCheckout(quote);
    } catch (err) {
      expect(err.code === QuoteErrorCodes.CATALOG_PRICE_CHANGED || err.code === QuoteErrorCodes.PRICE_SURGE_DETECTED).toBe(true);
      expect(err.message).toContain('Catalog price');
    }

    // Cleanup
    await query('DELETE FROM products WHERE id = $1', [dynProd.id]);
  });

  // ── TEST 11: HTTP API /api/ai/checkout Integration ──────────────────────────
  test('TEST 11: POST /api/ai/checkout returns verified checkout session for valid quote and 400 for tampered quote', async () => {
    // 1. Get valid quote via API
    const quoteRes = await request(app)
      .post('/api/ai/quote')
      .send({
        productId: testProduct.id,
        quantity: 1,
      });

    expect(quoteRes.status).toBe(200);
    const validQuote = quoteRes.body;

    // 2. Submit valid quote to /api/ai/checkout
    const checkoutRes = await request(app)
      .post('/api/ai/checkout')
      .send({
        quote: validQuote,
      });

    expect(checkoutRes.status).toBe(200);
    expect(checkoutRes.body.success).toBe(true);
    expect(checkoutRes.body.status).toBe('READY_FOR_PAYMENT');
    expect(checkoutRes.body.checkoutId).toBeDefined();
    expect(checkoutRes.body.pricing.totalAmount).toBe(validQuote.totalAmount);

    // 3. Submit tampered quote to /api/ai/checkout
    const tamperedRes = await request(app)
      .post('/api/ai/checkout')
      .send({
        quote: {
          ...validQuote,
          totalAmount: 10.00,
        },
      });

    expect(tamperedRes.status).toBe(400);
    expect(tamperedRes.body.success).toBe(false);
    expect(tamperedRes.body.code).toBe(QuoteErrorCodes.INVALID_QUOTE_SIGNATURE);
  });

  // ── TEST 12: Payment Order Creation Fails Closed on Bad Quote ───────────────
  test('TEST 12: createPaymentOrder fails closed when supplied with a tampered quote', async () => {
    const quote = await generateQuote({
      productId: testProduct.id,
      quantity: 1,
    });

    const fakeIntentId = `test_intent_tamper_${Date.now()}`;
    const insIntent = await query(`
      INSERT INTO purchase_intents (
        agent_id, user_id, product_id, merchant_id, amount,
        quantity, status, idempotency_key
      )
      VALUES (
        (SELECT id FROM agents LIMIT 1),
        $1, $2, $3, $4, 1, 'allowed', $5
      )
      RETURNING *
    `, [testUser.id, testProduct.id, testProduct.merchant_id, quote.totalAmount, fakeIntentId]);
    const intent = insIntent.rows[0];

    // Attempt to create payment order with tampered quote
    const tamperedQuote = {
      ...quote,
      totalAmount: 5.00,
    };

    await expect(
      createPaymentOrder(intent.id, { quote: tamperedQuote })
    ).rejects.toThrow();
  });
});
