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
  QuoteErrorCodes,
  QuoteVerificationError,
  consumeQuote,
} from '../src/services/quoteService.js';
import { createPaymentOrder, verifyPayment } from '../src/services/paymentService.js';
import { evaluatePurchaseIntent } from '../src/services/decisionEngine.js';

jest.setTimeout(35000);

describe('Track 02: Price Protection, Authorization Ceilings & Checkout Quote Lifecycle Suite', () => {
  let buyerA, buyerAToken;
  let buyerB, buyerBToken;
  let merchantId;
  let policyId;
  let testAgent;
  let baseProduct;

  beforeAll(async () => {
    // 1. Setup Buyer A
    const uA = await query(`
      INSERT INTO users (email, name, role)
      VALUES ('price_audit_buyer_a_' || floor(random()*1000000) || '@agentpay.com', 'Price Audit Buyer A', 'BUYER')
      RETURNING *
    `);
    buyerA = uA.rows[0];
    buyerAToken = generateAccessToken(buyerA);

    // 2. Setup Buyer B (for cross-tenant quote hijacking tests)
    const uB = await query(`
      INSERT INTO users (email, name, role)
      VALUES ('price_audit_buyer_b_' || floor(random()*1000000) || '@agentpay.com', 'Price Audit Buyer B', 'BUYER')
      RETURNING *
    `);
    buyerB = uB.rows[0];
    buyerBToken = generateAccessToken(buyerB);

    // 3. Setup Verified Merchant
    const mRes = await query(`
      INSERT INTO merchants (name, category, description, is_verified, rating, tier)
      VALUES ('Price Protection Electronics ' || floor(random()*100000), 'Electronics', 'Verified Merchant Store', true, 4.9, 'tier_1')
      RETURNING id
    `);
    merchantId = mRes.rows[0].id;

    // 4. Setup Policy with 2% tolerance and ₹50,000 ceiling
    const polRes = await query(`
      INSERT INTO policies (name, version, daily_budget, max_transaction, approval_threshold, allowed_categories, blocked_categories, max_retries, price_tolerance_pct, verified_merchants_only)
      VALUES ('Price Protection Policy', 'v1', 100000, 50000, 25000, ARRAY['Electronics'], ARRAY['Gambling'], 1, 2.0, true)
      RETURNING id
    `);
    policyId = polRes.rows[0].id;

    // 5. Setup Agent
    const aRes = await query(`
      INSERT INTO agents (owner_id, name, description, policy_id, status)
      VALUES ($1, 'Price Protection Audit Agent', 'Agent for Price Integrity Checks', $2, 'active')
      RETURNING *
    `, [buyerA.id, policyId]);
    testAgent = aRes.rows[0];

    // 6. Base Product: ₹10,000 baseline price, 50 in stock
    const pRes = await query(`
      INSERT INTO products (merchant_id, name, description, brand, category, product_type, price, inventory, in_stock, specifications, is_test_lab, commerce_eligible)
      VALUES ($1, 'Audited Ultra Laptop Hub', 'Thunderbolt 4 Dock', 'Anker', 'Electronics', 'hub', 10000.00, 50, true, '{"ports": 12}', false, true)
      RETURNING *
    `, [merchantId]);
    baseProduct = pRes.rows[0];
  });

  afterAll(async () => {
    const userIds = [buyerA?.id, buyerB?.id].filter(Boolean);
    if (userIds.length > 0) {
      await query('DELETE FROM in_app_notifications WHERE user_id = ANY($1)', [userIds]);
      await query('DELETE FROM user_preferences WHERE user_id = ANY($1)', [userIds]);
      await query('DELETE FROM invoices WHERE order_id IN (SELECT id FROM orders WHERE user_id = ANY($1))', [userIds]);
      await query('DELETE FROM orders WHERE user_id = ANY($1)', [userIds]);
      await query('DELETE FROM approvals WHERE purchase_intent_id IN (SELECT id FROM purchase_intents WHERE user_id = ANY($1))', [userIds]);
      await query('DELETE FROM transactions WHERE user_id = ANY($1)', [userIds]);
      await query('DELETE FROM inventory_reservations WHERE quote_id IN (SELECT id FROM quotes WHERE user_id = ANY($1))', [userIds]);
      await query('DELETE FROM quotes WHERE user_id = ANY($1)', [userIds]);
      await query('DELETE FROM purchase_intents WHERE user_id = ANY($1)', [userIds]);
      await query('DELETE FROM agents WHERE owner_id = ANY($1)', [userIds]);
      await query('DELETE FROM users WHERE id = ANY($1)', [userIds]);
    }
    if (merchantId) {
      await query('DELETE FROM products WHERE merchant_id = $1', [merchantId]);
      await query('DELETE FROM merchants WHERE id = $1', [merchantId]);
    }
    if (policyId) await query('DELETE FROM policies WHERE id = $1', [policyId]);
  });

  beforeEach(async () => {
    // Reset product price to ₹10,000 and inventory to 50
    await query('UPDATE products SET price = 10000.00, inventory = 50, in_stock = true WHERE id = $1', [baseProduct.id]);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 1: Server Authoritative Pricing & Frontend Modification Rejection
  // ──────────────────────────────────────────────────────────────────────────
  test('REQ 1 & 2: Server is authoritative; client-modified frontend amount is rejected fail-closed (₹0 charged)', async () => {
    // Client attempts to create intent submitting ₹1,000 for a ₹10,000 item
    const manipulatedRes = await request(app)
      .post('/api/purchase-intents')
      .set('Authorization', `Bearer ${buyerAToken}`)
      .send({
        agent_id: testAgent.id,
        product_id: baseProduct.id,
        amount: 1000.00, // 90% discount attempt
        quantity: 1,
      });

    expect(manipulatedRes.status).toBe(400);
    expect(manipulatedRes.body.code).toBe('PRICE_MANIPULATION_DETECTED');

    // Verify zero financial orders or transactions created
    const txCount = (await query('SELECT COUNT(*) FROM transactions WHERE user_id = $1', [buyerA.id])).rows[0].count;
    expect(parseInt(txCount, 10)).toBe(0);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 2: Quote Binding to Buyer, Agent, Merchant, and Product
  // ──────────────────────────────────────────────────────────────────────────
  test('REQ 3: Quote is cryptographically bound; Buyer B cannot consume Buyer A quote (₹0 charged)', async () => {
    // Buyer A generates quote
    const quote = await generateQuote({
      productId: baseProduct.id,
      quantity: 1,
      userId: buyerA.id,
      agentId: testAgent.id,
    });

    expect(quote.quoteId).toBeDefined();
    expect(quote.totalAmount).toBe(10000);

    // Buyer B attempts to verify and checkout Buyer A's quote
    await expect(
      verifyQuoteForCheckout(quote.quoteId, {
        userId: buyerB.id, // Wrong buyer
        agentId: testAgent.id,
        requestedProductId: baseProduct.id,
        requestedQuantity: 1,
      })
    ).rejects.toThrow(QuoteVerificationError);

    try {
      await verifyQuoteForCheckout(quote.quoteId, {
        userId: buyerB.id,
        agentId: testAgent.id,
        requestedProductId: baseProduct.id,
        requestedQuantity: 1,
      });
    } catch (err) {
      expect(err.code).toBe(QuoteErrorCodes.UNAUTHORIZED_QUOTE_CONSUMER);
    }

    // Reservation must be released
    const resv = (await query('SELECT status FROM inventory_reservations WHERE quote_id = $1', [quote.quoteId])).rows[0];
    expect(resv.status).toBe('RELEASED');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 3: +1% Price Change Behavior
  // ──────────────────────────────────────────────────────────────────────────
  test('REQ 5 & 10: +1% catalog price increase (+1.0%) respects quote price-lock; under zero tolerance rejects with PRICE_CHANGED', async () => {
    const quote = await generateQuote({
      productId: baseProduct.id,
      quantity: 1,
      userId: buyerA.id,
      agentId: testAgent.id,
    });

    // Merchant updates catalog price to ₹10,100 (+1.0%)
    await query('UPDATE products SET price = 10100.00 WHERE id = $1', [baseProduct.id]);

    // Scenario 1: Standard 2% tolerance: Quote price lock protects user at authorized ₹10,000 (₹0 extra charged)
    const verification = await verifyQuoteForCheckout(quote.quoteId, {
      userId: buyerA.id,
      agentId: testAgent.id,
      requestedProductId: baseProduct.id,
      requestedQuantity: 1,
      requestedAmount: 10000.00, // strictly authorized quote total
      tolerancePercent: 2.0,
    });

    expect(verification.valid).toBe(true);
    expect(verification.pricing.totalAmount).toBe(10000.00); // User is NOT charged the higher ₹10,100!

    // Scenario 2: If client attempts to charge the unapproved +1% catalog price without user authorization:
    await expect(
      verifyQuoteForCheckout(quote.quoteId, {
        userId: buyerA.id,
        agentId: testAgent.id,
        requestedProductId: baseProduct.id,
        requestedQuantity: 1,
        requestedAmount: 10100.00, // attempting to charge the new catalog price
      })
    ).rejects.toThrow(QuoteVerificationError);

    // Scenario 3: Under strict zero tolerance (rejectOnCatalogPriceChange: true):
    await expect(
      verifyQuoteForCheckout(quote.quoteId, {
        userId: buyerA.id,
        agentId: testAgent.id,
        requestedProductId: baseProduct.id,
        requestedQuantity: 1,
        rejectOnCatalogPriceChange: true,
      })
    ).rejects.toThrow(QuoteVerificationError);

    try {
      await verifyQuoteForCheckout(quote.quoteId, {
        userId: buyerA.id,
        agentId: testAgent.id,
        requestedProductId: baseProduct.id,
        requestedQuantity: 1,
        rejectOnCatalogPriceChange: true,
      });
    } catch (err) {
      expect(err.code).toBe(QuoteErrorCodes.PRICE_CHANGED);
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 4: +2% Price Change Behavior
  // ──────────────────────────────────────────────────────────────────────────
  test('REQ 5 & 10: +2% price change (+2.0%) protects authorized quote price; exceeding tolerance by +2.01% is strictly BLOCKED', async () => {
    const quote = await generateQuote({
      productId: baseProduct.id,
      quantity: 1,
      userId: buyerA.id,
      agentId: testAgent.id,
    });

    // Exactly +2.00% (₹10,200)
    await query('UPDATE products SET price = 10200.00 WHERE id = $1', [baseProduct.id]);

    const verification = await verifyQuoteForCheckout(quote.quoteId, {
      userId: buyerA.id,
      agentId: testAgent.id,
      requestedProductId: baseProduct.id,
      requestedQuantity: 1,
      requestedAmount: 10000.00,
      tolerancePercent: 2.0,
    });

    expect(verification.valid).toBe(true);
    expect(verification.pricing.totalAmount).toBe(10000.00); // Protected at authorized amount

    // Exceeding +2.00% (+2.01% -> ₹10,201) MUST fail closed
    await query('UPDATE products SET price = 10201.00 WHERE id = $1', [baseProduct.id]);

    await expect(
      verifyQuoteForCheckout(quote.quoteId, {
        userId: buyerA.id,
        agentId: testAgent.id,
        requestedProductId: baseProduct.id,
        requestedQuantity: 1,
        requestedAmount: 10000.00,
        tolerancePercent: 2.0,
      })
    ).rejects.toThrow(QuoteVerificationError);

    try {
      await verifyQuoteForCheckout(quote.quoteId, {
        userId: buyerA.id,
        agentId: testAgent.id,
        requestedProductId: baseProduct.id,
        requestedQuantity: 1,
        requestedAmount: 10000.00,
        tolerancePercent: 2.0,
      });
    } catch (err) {
      expect(err.code).toBe(QuoteErrorCodes.PRICE_SURGE_DETECTED);
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 5: Large Price Increase (+50% Surge)
  // ──────────────────────────────────────────────────────────────────────────
  test('REQ 5 & 10: Large price increase (+50%) is strictly rejected with PRICE_SURGE_DETECTED, releasing reservation (₹0 charged)', async () => {
    const quote = await generateQuote({
      productId: baseProduct.id,
      quantity: 1,
      userId: buyerA.id,
      agentId: testAgent.id,
    });

    // Jump from ₹10,000 to ₹15,000 (+50%)
    await query('UPDATE products SET price = 15000.00 WHERE id = $1', [baseProduct.id]);

    await expect(
      verifyQuoteForCheckout(quote.quoteId, {
        userId: buyerA.id,
        agentId: testAgent.id,
        requestedProductId: baseProduct.id,
        requestedQuantity: 1,
      })
    ).rejects.toThrow(QuoteVerificationError);

    // Verify reservation was released
    const resv = (await query('SELECT status FROM inventory_reservations WHERE quote_id = $1', [quote.quoteId])).rows[0];
    expect(resv.status).toBe('RELEASED');

    // Verify audit record created
    const auditRes = await query(`
      SELECT * FROM audit_events
      WHERE event_type = 'PRICE_SURGE_DETECTED'
      ORDER BY created_at DESC LIMIT 1
    `);
    expect(auditRes.rows.length).toBe(1);
    expect(auditRes.rows[0].decision).toBe('BLOCK');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 6: Authorization Ceiling Bypass Prevention
  // ──────────────────────────────────────────────────────────────────────────
  test('REQ 6: A price increase cannot bypass the user authorization ceiling (₹0 charged)', async () => {
    const quote = await generateQuote({
      productId: baseProduct.id,
      quantity: 1,
      userId: buyerA.id,
      agentId: testAgent.id,
    });

    // User sets strict authorization ceiling at ₹10,000
    // If total exceeds authorization ceiling (e.g. ₹10,050):
    await expect(
      verifyQuoteForCheckout(quote.quoteId, {
        userId: buyerA.id,
        agentId: testAgent.id,
        requestedProductId: baseProduct.id,
        requestedQuantity: 1,
        authorizationCeiling: 9999.00, // Ceiling below quote total
      })
    ).rejects.toThrow(QuoteVerificationError);

    try {
      await verifyQuoteForCheckout(quote.quoteId, {
        userId: buyerA.id,
        agentId: testAgent.id,
        requestedProductId: baseProduct.id,
        requestedQuantity: 1,
        authorizationCeiling: 9999.00,
      });
    } catch (err) {
      expect(err.code).toBe(QuoteErrorCodes.POLICY_VIOLATION);
      expect(err.message).toMatch(/Authorization ceiling exceeded/i);
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 7: Quantity Changes Invalidate & Reprice the Quote
  // ──────────────────────────────────────────────────────────────────────────
  test('REQ 7: Quantity changes strictly invalidate the quote with QUANTITY_MISMATCH (₹0 charged)', async () => {
    const quote = await generateQuote({
      productId: baseProduct.id,
      quantity: 1,
      userId: buyerA.id,
      agentId: testAgent.id,
    });

    // Client requests checkout with quantity = 2 on a quantity = 1 quote
    await expect(
      verifyQuoteForCheckout(quote.quoteId, {
        userId: buyerA.id,
        agentId: testAgent.id,
        requestedProductId: baseProduct.id,
        requestedQuantity: 2, // Mismatch
      })
    ).rejects.toThrow(QuoteVerificationError);

    try {
      await verifyQuoteForCheckout(quote.quoteId, {
        userId: buyerA.id,
        agentId: testAgent.id,
        requestedProductId: baseProduct.id,
        requestedQuantity: 2,
      });
    } catch (err) {
      expect(err.code).toBe(QuoteErrorCodes.QUANTITY_MISMATCH);
    }

    // Tampering with quantity inside quote object payload invalidates HMAC signature
    const tamperedQuotePayload = { ...quote, quantity: 2 };
    await expect(
      verifyQuoteForCheckout(tamperedQuotePayload, {
        userId: buyerA.id,
        agentId: testAgent.id,
      })
    ).rejects.toThrow(QuoteVerificationError);

    try {
      await verifyQuoteForCheckout(tamperedQuotePayload, {
        userId: buyerA.id,
        agentId: testAgent.id,
      });
    } catch (err) {
      expect(err.code).toBe(QuoteErrorCodes.INVALID_QUOTE_SIGNATURE);
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 8: Expired Quotes Cannot Be Used
  // ──────────────────────────────────────────────────────────────────────────
  test('REQ 8: Expired quotes are strictly rejected with QUOTE_EXPIRED, releasing reservations (₹0 charged)', async () => {
    // Generate quote with negative duration (already expired)
    const expiredQuote = await generateQuote({
      productId: baseProduct.id,
      quantity: 1,
      userId: buyerA.id,
      agentId: testAgent.id,
      durationMinutes: -5,
    });

    await expect(
      verifyQuoteForCheckout(expiredQuote.quoteId, {
        userId: buyerA.id,
        agentId: testAgent.id,
        requestedProductId: baseProduct.id,
        requestedQuantity: 1,
      })
    ).rejects.toThrow(QuoteVerificationError);

    try {
      await verifyQuoteForCheckout(expiredQuote.quoteId, {
        userId: buyerA.id,
        agentId: testAgent.id,
        requestedProductId: baseProduct.id,
        requestedQuantity: 1,
      });
    } catch (err) {
      expect(err.code).toBe(QuoteErrorCodes.QUOTE_EXPIRED);
    }

    // Reservation must be released
    const resv = (await query('SELECT status FROM inventory_reservations WHERE quote_id = $1', [expiredQuote.quoteId])).rows[0];
    expect(resv.status).toBe('RELEASED');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 9: Replaying / Reusing Old Quotes is Strictly Blocked
  // ──────────────────────────────────────────────────────────────────────────
  test('REQ 9: Replaying an already consumed quote cannot create a payment or order (₹0 charged)', async () => {
    const quote = await generateQuote({
      productId: baseProduct.id,
      quantity: 1,
      userId: buyerA.id,
      agentId: testAgent.id,
    });

    // Simulate order completion consuming the quote
    await consumeQuote(quote.quoteId);

    // Attempting second checkout with consumed quote
    await expect(
      verifyQuoteForCheckout(quote.quoteId, {
        userId: buyerA.id,
        agentId: testAgent.id,
        requestedProductId: baseProduct.id,
        requestedQuantity: 1,
      })
    ).rejects.toThrow(QuoteVerificationError);

    try {
      await verifyQuoteForCheckout(quote.quoteId, {
        userId: buyerA.id,
        agentId: testAgent.id,
        requestedProductId: baseProduct.id,
        requestedQuantity: 1,
      });
    } catch (err) {
      expect(err.code).toBe(QuoteErrorCodes.QUOTE_ALREADY_CONSUMED);
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 10: Pre-Payment Quote Revalidation Catches Mid-Flight Catalog Price Surge
  // ──────────────────────────────────────────────────────────────────────────
  test('REQ 4: Pre-payment quote revalidation in verifyPayment catches catalog surge before capture (₹0 charged)', async () => {
    // 1. Generate valid quote at ₹10,000
    const quote = await generateQuote({
      productId: baseProduct.id,
      quantity: 1,
      userId: buyerA.id,
      agentId: testAgent.id,
    });

    // 2. Create purchase intent and payment order
    const piRes = await query(`
      INSERT INTO purchase_intents (agent_id, user_id, product_id, merchant_id, amount, quantity, status, quote_id)
      VALUES ($1, $2, $3, $4, 10000, 1, 'allowed', $5)
      RETURNING *
    `, [testAgent.id, buyerA.id, baseProduct.id, merchantId, quote.quoteId]);
    const intent = piRes.rows[0];

    const paymentOrder = await createPaymentOrder(intent.id, { mode: 'TEST' });
    expect(paymentOrder.orderId).toBeDefined();

    // 3. MID-FLIGHT SURGE: Merchant increases catalog price to ₹15,000 (+50%) after order initialization
    await query('UPDATE products SET price = 15000.00 WHERE id = $1', [baseProduct.id]);

    const secret = env.RAZORPAY_TEST_KEY_SECRET;
    const paymentId = `pay_test_${Math.random().toString(36).substring(2, 10)}`;
    const body = `${paymentOrder.orderId}|${paymentId}`;
    const sig = secret ? crypto.createHmac('sha256', secret).update(body).digest('hex') : 'test_signature_valid';

    // 4. Pre-payment revalidation in verifyPayment MUST detect the surge and abort
    await expect(
      verifyPayment({
        transactionId: paymentOrder.transactionId,
        razorpayOrderId: paymentOrder.orderId,
        razorpayPaymentId: paymentId,
        razorpaySignature: sig,
      })
    ).rejects.toThrow(QuoteVerificationError);

    // Verify transaction status is 'failed' and NOT 'completed'
    const failedTx = (await query('SELECT status, payment_verified FROM transactions WHERE id = $1', [paymentOrder.transactionId])).rows[0];
    expect(failedTx.status).toBe('failed');
    expect(failedTx.payment_verified).toBe(false);

    // Verify reservation was released
    const resv = (await query('SELECT status FROM inventory_reservations WHERE quote_id = $1', [quote.quoteId])).rows[0];
    expect(resv.status).toBe('RELEASED');

    // Verify zero orders created
    const ordersCount = (await query('SELECT COUNT(*) FROM orders WHERE transaction_id = $1', [paymentOrder.transactionId])).rows[0].count;
    expect(parseInt(ordersCount, 10)).toBe(0);

    // Verify audit event logged
    const auditRes = await query(`
      SELECT * FROM audit_events
      WHERE transaction_id = $1 AND event_type = 'QUOTE_REVALIDATION_FAILED'
    `, [paymentOrder.transactionId]);
    expect(auditRes.rows.length).toBe(1);
    expect(auditRes.rows[0].decision).toBe('BLOCK');
  });
});
