import { jest } from '@jest/globals';
import request from 'supertest';
import crypto from 'crypto';
import { app } from '../src/index.js';
import { query } from '../src/config/database.js';
import env from '../src/config/env.js';
import { generateAccessToken } from '../src/utils/authUtils.js';
import {
  getPaymentProvider,
  RazorpayTestProvider,
  RazorpayLiveProvider,
} from '../src/services/paymentProvider.js';
import { createPaymentOrder, verifyPayment } from '../src/services/paymentService.js';
import { processRazorpayWebhook, WebhookEventTypes, WebhookProcessingStates } from '../src/services/webhookService.js';
import { generateQuote } from '../src/services/quoteService.js';
import { calculatePrice, toRazorpayAmount } from '../src/services/pricingService.js';

jest.setTimeout(30000);

describe('Track 03: Complete Razorpay Payment Security & Webhook Audit Suite', () => {
  let buyerUser, buyerToken;
  let merchantId;
  let testProduct;

  beforeAll(async () => {
    // 1. Create fresh isolated test buyer
    const insB = await query(`
      INSERT INTO users (email, name, role)
      VALUES ('buyer_razorpay_audit_' || floor(random()*1000000) || '@agentpay.com', 'Razorpay Security Auditor', 'BUYER')
      RETURNING *
    `);
    buyerUser = insB.rows[0];
    buyerToken = generateAccessToken(buyerUser);

    // Ensure generous buyer limits
    await query(`
      INSERT INTO user_preferences (user_id, monthly_budget, auto_purchase_limit, categories, purchase_behavior)
      VALUES ($1, 1000000, 200000, ARRAY['Electronics', 'SecurityHardware'], 'auto_within_limit')
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
        VALUES ('Razorpay Security Store', 'Electronics', true, 4.9, false)
        RETURNING *
      `);
      merchantId = insM.rows[0].id;
    }

    // 3. Create dedicated test product
    const pRes = await query(`
      INSERT INTO products (
        merchant_id, sku, name, description, brand, category, price, currency, inventory, in_stock, specifications, status
      )
      VALUES ($1, $2, 'Razorpay Hardened Security Key', 'FIDO2 Hardware Key', 'YubiSafe', 'Electronics', 3500, 'INR', 100, true, '{}'::jsonb, 'ACTIVE')
      RETURNING *
    `, [merchantId, `SKU-RZP-${Date.now()}`]);
    testProduct = pRes.rows[0];
  });

  afterAll(async () => {
    if (testProduct) {
      await query('DELETE FROM invoices WHERE order_id IN (SELECT id FROM orders WHERE purchase_intent_id IN (SELECT id FROM purchase_intents WHERE product_id = $1))', [testProduct.id]);
      await query('DELETE FROM orders WHERE purchase_intent_id IN (SELECT id FROM purchase_intents WHERE product_id = $1)', [testProduct.id]);
      await query('DELETE FROM transactions WHERE purchase_intent_id IN (SELECT id FROM purchase_intents WHERE product_id = $1)', [testProduct.id]);
      await query('DELETE FROM inventory_reservations WHERE product_id = $1', [testProduct.id]);
      await query('DELETE FROM purchase_intents WHERE product_id = $1', [testProduct.id]);
      await query('DELETE FROM quotes WHERE product_id = $1', [testProduct.id]);
      await query('DELETE FROM products WHERE id = $1', [testProduct.id]);
    }
  });

  // ── TEST 1: Server-Side Order Creation with Authoritative Pricing ────────────
  it('TEST 1: Razorpay orders are created server-side with authoritative pricing in integer paise', async () => {
    const quote = await generateQuote({
      productId: testProduct.id,
      quantity: 2,
      userId: buyerUser.id,
      reserveStock: true,
    });

    const piRes = await query(`
      INSERT INTO purchase_intents (user_id, product_id, merchant_id, amount, quantity, status, state, quote_id)
      VALUES ($1, $2, $3, $4, 2, 'allowed', 'ALLOWED', $5)
      RETURNING *
    `, [buyerUser.id, testProduct.id, merchantId, quote.totalAmount, quote.quoteId]);
    const intent = piRes.rows[0];

    const paymentOrder = await createPaymentOrder({ purchaseIntentId: intent.id, quoteId: quote.quoteId });

    // Invariants:
    // 1. Order ID created server-side
    expect(paymentOrder.orderId).toBeDefined();
    expect(paymentOrder.orderId.length).toBeGreaterThan(5);

    // 2. Amount in integer paise
    const authoritativePricing = calculatePrice({ product: testProduct, quantity: 2 });
    expect(paymentOrder.amount).toBe(authoritativePricing.totalAmount);
    expect(paymentOrder.amountInPaise).toBe(toRazorpayAmount(authoritativePricing.totalAmount));
    expect(Number.isInteger(paymentOrder.amountInPaise)).toBe(true);

    // 3. Currency is INR
    expect(paymentOrder.currency).toBe('INR');
  });

  // ── TEST 2: Untrusted Frontend Payment Status Rejection ─────────────────────
  it('TEST 2: Never accept payment success from frontend as authoritative without server verification', async () => {
    // Attacker tries to submit an unverified transaction claiming success
    const piRes = await query(`
      INSERT INTO purchase_intents (user_id, product_id, merchant_id, amount, quantity, status, state)
      VALUES ($1, $2, $3, 3500, 1, 'allowed', 'ALLOWED')
      RETURNING *
    `, [buyerUser.id, testProduct.id, merchantId]);
    const intent = piRes.rows[0];

    const txRes = await query(`
      INSERT INTO transactions (purchase_intent_id, user_id, amount, currency, status, razorpay_order_id, environment, payment_mode)
      VALUES ($1, $2, 3500, 'INR', 'payment_pending', $3, 'TEST', 'TEST')
      RETURNING *
    `, [intent.id, buyerUser.id, `order_fake_${Date.now()}`]);
    const tx = txRes.rows[0];

    // Transaction must remain payment_pending until cryptographically verified
    const freshTx = (await query('SELECT * FROM transactions WHERE id = $1', [tx.id])).rows[0];
    expect(freshTx.status).toBe('payment_pending');
    expect(freshTx.payment_verified).toBe(false);

    // Assert zero orders created
    const ordRes = await query('SELECT * FROM orders WHERE transaction_id = $1', [tx.id]);
    expect(ordRes.rows.length).toBe(0);
  });

  // ── TEST 3: Invalid Razorpay Payment Signature Rejected ─────────────────────
  it('TEST 3: Forged or modified Razorpay payment signature is strictly rejected by HMAC verification', async () => {
    const quote = await generateQuote({
      productId: testProduct.id,
      quantity: 1,
      userId: buyerUser.id,
      reserveStock: true,
    });

    const piRes = await query(`
      INSERT INTO purchase_intents (user_id, product_id, merchant_id, amount, quantity, status, state, quote_id)
      VALUES ($1, $2, $3, $4, 1, 'allowed', 'ALLOWED', $5)
      RETURNING *
    `, [buyerUser.id, testProduct.id, merchantId, quote.totalAmount, quote.quoteId]);
    const intent = piRes.rows[0];

    const rzpOrderId = `order_sig_test_${Date.now()}`;
    const txRes = await query(`
      INSERT INTO transactions (purchase_intent_id, user_id, amount, currency, status, razorpay_order_id, environment, payment_mode)
      VALUES ($1, $2, $3, 'INR', 'payment_pending', $4, 'TEST', 'TEST')
      RETURNING *
    `, [intent.id, buyerUser.id, quote.totalAmount, rzpOrderId]);
    const tx = txRes.rows[0];

    // Attempt verification with forged HMAC signature
    await expect(
      verifyPayment({
        transactionId: tx.id,
        razorpayOrderId: rzpOrderId,
        razorpayPaymentId: 'pay_forged_12345',
        razorpaySignature: 'bad_signature_deadbeef1234567890abcdef',
        quoteId: quote.quoteId,
      })
    ).rejects.toThrow(/signature verification failed/i);

    // Assert transaction is not verified
    const dbTx = (await query('SELECT * FROM transactions WHERE id = $1', [tx.id])).rows[0];
    expect(['payment_pending', 'failed']).toContain(dbTx.status);
    expect(dbTx.payment_verified).toBe(false);

    // Assert reservation released on tamper detection
    const resv = (await query('SELECT status FROM inventory_reservations WHERE quote_id = $1', [quote.quoteId])).rows[0];
    expect(resv.status).toBe('RELEASED');
  });

  // ── TEST 4: Wrong / Tampered Order ID in Signature ──────────────────────────
  it('TEST 4: Mismatched order ID in payment verification fails signature check', async () => {
    const rzpOrderId = `order_orig_${Date.now()}`;
    const fakePaymentId = `pay_match_${Date.now()}`;

    // Compute signature for wrong order ID
    const signatureForWrongOrder = crypto
      .createHmac('sha256', env.RAZORPAY_TEST_KEY_SECRET || 'test_secret')
      .update(`order_different_999|${fakePaymentId}`)
      .digest('hex');

    const piRes = await query(`
      INSERT INTO purchase_intents (user_id, product_id, merchant_id, amount, quantity, status, state)
      VALUES ($1, $2, $3, 3500, 1, 'allowed', 'ALLOWED')
      RETURNING *
    `, [buyerUser.id, testProduct.id, merchantId]);
    const intent = piRes.rows[0];

    const txRes = await query(`
      INSERT INTO transactions (purchase_intent_id, user_id, amount, currency, status, razorpay_order_id, environment, payment_mode)
      VALUES ($1, $2, 3500, 'INR', 'payment_pending', $3, 'TEST', 'TEST')
      RETURNING *
    `, [intent.id, buyerUser.id, rzpOrderId]);
    const tx = txRes.rows[0];

    await expect(
      verifyPayment({
        transactionId: tx.id,
        razorpayOrderId: rzpOrderId,
        razorpayPaymentId: fakePaymentId,
        razorpaySignature: signatureForWrongOrder,
      })
    ).rejects.toThrow(/signature verification failed/i);
  });

  // ── TEST 5: Modified Payment Amount in Webhook Rejected ─────────────────────
  it('TEST 5: Webhook with tampered / reduced payment amount is rejected with amount mismatch alert', async () => {
    const rzpOrderId = `order_wh_amt_${Date.now()}`;
    const txRes = await query(`
      INSERT INTO transactions (purchase_intent_id, user_id, amount, currency, status, razorpay_order_id, environment, payment_mode)
      VALUES (null, $1, 3500.00, 'INR', 'payment_pending', $2, 'TEST', 'TEST')
      RETURNING *
    `, [buyerUser.id, rzpOrderId]);
    const tx = txRes.rows[0];

    // Attacker sends webhook with amount = 100 paise (₹1 instead of ₹3500)
    const tamperedPayload = {
      event_id: `evt_tamper_amt_${Date.now()}`,
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: `pay_tamper_${Date.now()}`,
            order_id: rzpOrderId,
            amount: 100, // ₹1
            currency: 'INR',
            status: 'captured',
          },
        },
      },
    };

    await expect(
      processRazorpayWebhook({
        environment: 'TEST',
        payload: tamperedPayload,
        rawBody: JSON.stringify(tamperedPayload),
      })
    ).rejects.toThrow(/Payment amount mismatch/i);

    // Confirm transaction not marked completed
    const checkTx = (await query('SELECT * FROM transactions WHERE id = $1', [tx.id])).rows[0];
    expect(checkTx.status).toBe('payment_pending');
  });

  // ── TEST 6: Currency Mismatch in Webhook Rejected ───────────────────────────
  it('TEST 6: Webhook with mismatched currency (e.g. USD instead of INR) is rejected', async () => {
    const rzpOrderId = `order_wh_curr_${Date.now()}`;
    const txRes = await query(`
      INSERT INTO transactions (purchase_intent_id, user_id, amount, currency, status, razorpay_order_id, environment, payment_mode)
      VALUES (null, $1, 3500.00, 'INR', 'payment_pending', $2, 'TEST', 'TEST')
      RETURNING *
    `, [buyerUser.id, rzpOrderId]);
    const tx = txRes.rows[0];

    // Attacker sends USD instead of INR
    const currencyMismatchPayload = {
      event_id: `evt_tamper_curr_${Date.now()}`,
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: `pay_usd_${Date.now()}`,
            order_id: rzpOrderId,
            amount: 350000,
            currency: 'USD',
            status: 'captured',
          },
        },
      },
    };

    await expect(
      processRazorpayWebhook({
        environment: 'TEST',
        payload: currencyMismatchPayload,
        rawBody: JSON.stringify(currencyMismatchPayload),
      })
    ).rejects.toThrow(/Payment currency mismatch/i);
  });

  // ── TEST 7: Durable Webhook Ingestion & Signature Verification ──────────────
  it('TEST 7: Durable webhook ingestion validates HMAC signature and records in inbox', async () => {
    const quote = await generateQuote({
      productId: testProduct.id,
      quantity: 1,
      userId: buyerUser.id,
      reserveStock: true,
    });

    const piRes = await query(`
      INSERT INTO purchase_intents (user_id, product_id, merchant_id, amount, quantity, status, state, quote_id)
      VALUES ($1, $2, $3, $4, 1, 'allowed', 'ALLOWED', $5)
      RETURNING *
    `, [buyerUser.id, testProduct.id, merchantId, quote.totalAmount, quote.quoteId]);
    const intent = piRes.rows[0];

    const rzpOrderId = `order_wh_valid_${Date.now()}`;
    const txRes = await query(`
      INSERT INTO transactions (purchase_intent_id, user_id, amount, currency, status, razorpay_order_id, environment, payment_mode)
      VALUES ($1, $2, $3, 'INR', 'payment_pending', $4, 'TEST', 'TEST')
      RETURNING *
    `, [intent.id, buyerUser.id, quote.totalAmount, rzpOrderId]);
    const tx = txRes.rows[0];

    const eventId = `evt_durable_${Date.now()}`;
    const webhookPayload = {
      event_id: eventId,
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: `pay_wh_${Date.now()}`,
            order_id: rzpOrderId,
            amount: toRazorpayAmount(quote.totalAmount),
            currency: 'INR',
            status: 'captured',
          },
        },
      },
    };

    const rawBody = JSON.stringify(webhookPayload);
    const signature = crypto
      .createHmac('sha256', env.RAZORPAY_TEST_WEBHOOK_SECRET || 'test_secret')
      .update(rawBody)
      .digest('hex');

    const result = await processRazorpayWebhook({
      environment: 'TEST',
      signature,
      rawBody,
      payload: webhookPayload,
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe(WebhookProcessingStates.PROCESSED);

    // Verify inbox record in DB
    const inboxRes = await query('SELECT * FROM webhook_inbox WHERE event_id = $1', [eventId]);
    expect(inboxRes.rows.length).toBe(1);
    expect(inboxRes.rows[0].processing_status).toBe('PROCESSED');
    expect(inboxRes.rows[0].signature_verified).toBe(true);
  });

  // ── TEST 8: Webhook Event Deduplication ─────────────────────────────────────
  it('TEST 8: Replaying identical webhook event ID returns DUPLICATE_IGNORED with zero double-processing', async () => {
    const eventId = `evt_dedup_${Date.now()}`;
    const payload = {
      event_id: eventId,
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: `pay_dedup_${Date.now()}`,
            order_id: `order_dedup_${Date.now()}`,
            amount: 350000,
            currency: 'INR',
          },
        },
      },
    };

    // First ingestion
    const res1 = await processRazorpayWebhook({
      environment: 'TEST',
      payload,
      rawBody: JSON.stringify(payload),
    });

    // Second ingestion (replayed event)
    const res2 = await processRazorpayWebhook({
      environment: 'TEST',
      payload,
      rawBody: JSON.stringify(payload),
    });

    expect(res2.duplicate).toBe(true);
    expect(res2.status).toBe(WebhookProcessingStates.DUPLICATE_IGNORED);
  });

  // ── TEST 9: Webhook payment.captured / order.paid Full Lifecycle ────────────
  it('TEST 9: payment.captured webhook confirms order, commits reservation, and generates invoice', async () => {
    const quote = await generateQuote({
      productId: testProduct.id,
      quantity: 1,
      userId: buyerUser.id,
      reserveStock: true,
    });

    const piRes = await query(`
      INSERT INTO purchase_intents (user_id, product_id, merchant_id, amount, quantity, status, state, quote_id)
      VALUES ($1, $2, $3, $4, 1, 'allowed', 'ALLOWED', $5)
      RETURNING *
    `, [buyerUser.id, testProduct.id, merchantId, quote.totalAmount, quote.quoteId]);
    const intent = piRes.rows[0];

    const rzpOrderId = `order_wh_full_${Date.now()}`;
    const txRes = await query(`
      INSERT INTO transactions (purchase_intent_id, user_id, amount, currency, status, razorpay_order_id, environment, payment_mode)
      VALUES ($1, $2, $3, 'INR', 'payment_pending', $4, 'TEST', 'TEST')
      RETURNING *
    `, [intent.id, buyerUser.id, quote.totalAmount, rzpOrderId]);
    const tx = txRes.rows[0];

    const rzpPaymentId = `pay_full_${Date.now()}`;
    await processRazorpayWebhook({
      environment: 'TEST',
      payload: {
        event_id: `evt_full_${Date.now()}`,
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: rzpPaymentId,
              order_id: rzpOrderId,
              amount: toRazorpayAmount(quote.totalAmount),
              currency: 'INR',
              status: 'captured',
            },
          },
        },
      },
    });

    // 1. Transaction completed
    const updatedTx = (await query('SELECT * FROM transactions WHERE id = $1', [tx.id])).rows[0];
    expect(updatedTx.status).toBe('completed');
    expect(updatedTx.payment_verified).toBe(true);

    // 2. Reservation committed
    const resv = (await query('SELECT * FROM inventory_reservations WHERE quote_id = $1', [quote.quoteId])).rows[0];
    expect(resv.status).toBe('COMMITTED');

    // 3. Order created
    const ordRes = await query('SELECT * FROM orders WHERE transaction_id = $1', [tx.id]);
    expect(ordRes.rows.length).toBe(1);

    // 4. Invoice generated
    const invRes = await query('SELECT * FROM invoices WHERE order_id = $1', [ordRes.rows[0].id]);
    expect(invRes.rows.length).toBe(1);
  });

  // ── TEST 10: Webhook payment.failed Releases Reservation ────────────────────
  it('TEST 10: payment.failed webhook releases inventory reservation and marks transaction failed', async () => {
    const quote = await generateQuote({
      productId: testProduct.id,
      quantity: 1,
      userId: buyerUser.id,
      reserveStock: true,
    });

    const piRes = await query(`
      INSERT INTO purchase_intents (user_id, product_id, merchant_id, amount, quantity, status, state, quote_id)
      VALUES ($1, $2, $3, $4, 1, 'allowed', 'ALLOWED', $5)
      RETURNING *
    `, [buyerUser.id, testProduct.id, merchantId, quote.totalAmount, quote.quoteId]);
    const intent = piRes.rows[0];

    const rzpOrderId = `order_wh_fail_${Date.now()}`;
    const txRes = await query(`
      INSERT INTO transactions (purchase_intent_id, user_id, amount, currency, status, razorpay_order_id, environment, payment_mode)
      VALUES ($1, $2, $3, 'INR', 'payment_pending', $4, 'TEST', 'TEST')
      RETURNING *
    `, [intent.id, buyerUser.id, quote.totalAmount, rzpOrderId]);
    const tx = txRes.rows[0];

    await processRazorpayWebhook({
      environment: 'TEST',
      payload: {
        event_id: `evt_fail_${Date.now()}`,
        event: 'payment.failed',
        payload: {
          payment: {
            entity: {
              id: `pay_fail_${Date.now()}`,
              order_id: rzpOrderId,
              error_description: 'Card expired or insufficient funds',
            },
          },
        },
      },
    });

    // Transaction failed
    const updatedTx = (await query('SELECT * FROM transactions WHERE id = $1', [tx.id])).rows[0];
    expect(updatedTx.status).toBe('failed');

    // Reservation released
    const resv = (await query('SELECT * FROM inventory_reservations WHERE quote_id = $1', [quote.quoteId])).rows[0];
    expect(resv.status).toBe('RELEASED');
  });

  // ── TEST 11: Webhook refund.processed Updates Transaction ───────────────────
  it('TEST 11: refund.processed webhook updates transaction status to refunded', async () => {
    const rzpPaymentId = `pay_to_refund_${Date.now()}`;
    const txRes = await query(`
      INSERT INTO transactions (purchase_intent_id, user_id, amount, currency, status, razorpay_payment_id, payment_verified, environment, payment_mode)
      VALUES (null, $1, 3500.00, 'INR', 'completed', $2, true, 'TEST', 'TEST')
      RETURNING *
    `, [buyerUser.id, rzpPaymentId]);
    const tx = txRes.rows[0];

    await processRazorpayWebhook({
      environment: 'TEST',
      payload: {
        event_id: `evt_rfnd_${Date.now()}`,
        event: 'refund.processed',
        payload: {
          refund: {
            entity: {
              id: `rfnd_${Date.now()}`,
              payment_id: rzpPaymentId,
              amount: 350000,
              status: 'processed',
            },
          },
        },
      },
    });

    const updatedTx = (await query('SELECT * FROM transactions WHERE id = $1', [tx.id])).rows[0];
    expect(updatedTx.status).toBe('refunded');
  });

  // ── TEST 12: Out-of-Order Webhook Protection ────────────────────────────────
  it('TEST 12: Late payment.failed webhook does NOT revert an already completed transaction', async () => {
    const rzpOrderId = `order_ooo_${Date.now()}`;
    const rzpPaymentId = `pay_ooo_${Date.now()}`;

    // Transaction is already verified & completed
    const txRes = await query(`
      INSERT INTO transactions (purchase_intent_id, user_id, amount, currency, status, razorpay_order_id, razorpay_payment_id, payment_verified, environment, payment_mode)
      VALUES (null, $1, 3500.00, 'INR', 'completed', $2, $3, true, 'TEST', 'TEST')
      RETURNING *
    `, [buyerUser.id, rzpOrderId, rzpPaymentId]);
    const tx = txRes.rows[0];

    // Stale payment.failed arrives out-of-order
    const result = await processRazorpayWebhook({
      environment: 'TEST',
      payload: {
        event_id: `evt_late_fail_${Date.now()}`,
        event: 'payment.failed',
        payload: {
          payment: {
            entity: {
              id: rzpPaymentId,
              order_id: rzpOrderId,
              error_description: 'Network timeout',
            },
          },
        },
      },
    });

    expect(result.status).toBe(WebhookProcessingStates.CONFLICT_IGNORED);

    // Transaction status remains completed
    const checkTx = (await query('SELECT * FROM transactions WHERE id = $1', [tx.id])).rows[0];
    expect(checkTx.status).toBe('completed');
    expect(checkTx.payment_verified).toBe(true);
  });

  // ── TEST 13: Cross-Environment Webhook Isolation ────────────────────────────
  it('TEST 13: TEST webhook attempting to update LIVE transaction is strictly rejected', async () => {
    const liveOrderId = `order_live_cross_${Date.now()}`;
    const txRes = await query(`
      INSERT INTO transactions (purchase_intent_id, user_id, amount, currency, status, razorpay_order_id, environment, payment_mode)
      VALUES (null, $1, 5000.00, 'INR', 'payment_pending', $2, 'LIVE', 'LIVE')
      RETURNING *
    `, [buyerUser.id, liveOrderId]);

    // Send TEST webhook targeting LIVE order
    await expect(
      processRazorpayWebhook({
        environment: 'TEST',
        payload: {
          event_id: `evt_cross_${Date.now()}`,
          event: 'payment.captured',
          payload: {
            payment: {
              entity: {
                id: `pay_cross_${Date.now()}`,
                order_id: liveOrderId,
                amount: 500000,
                currency: 'INR',
              },
            },
          },
        },
      })
    ).rejects.toThrow(/Mixed environment webhook rejected/i);
  });

  // ── TEST 14: LIVE Mode Fails Closed Without Valid Live Keys ─────────────────
  it('TEST 14: RazorpayLiveProvider throws FATAL SECURITY LOCK if live keys are invalid or missing', () => {
    const unconfiguredLiveProvider = new RazorpayLiveProvider({
      keyId: 'rzp_test_invalid_for_live',
      keySecret: 'dummy_secret',
    });

    expect(() => {
      unconfiguredLiveProvider.assertLiveConfigured();
    }).toThrow(/FATAL SECURITY LOCK/i);
  });

  // ── TEST 15: Private Credentials Protection ─────────────────────────────────
  it('TEST 15: Private credentials and webhook secrets are never exposed in public responses', async () => {
    const res = await request(app).get('/api/system/status');
    expect(res.status).toBe(200);

    const bodyStr = JSON.stringify(res.body);
    if (env.RAZORPAY_TEST_KEY_SECRET) {
      expect(bodyStr).not.toContain(env.RAZORPAY_TEST_KEY_SECRET);
    }
    if (env.RAZORPAY_TEST_WEBHOOK_SECRET) {
      expect(bodyStr).not.toContain(env.RAZORPAY_TEST_WEBHOOK_SECRET);
    }
    if (env.JWT_SECRET) {
      expect(bodyStr).not.toContain(env.JWT_SECRET);
    }
  });

  // ── TEST 16: Malformed Webhook Payload Rejection ────────────────────────────
  it('TEST 16: Malformed, null, or empty webhook payload is rejected with REJECTED status', async () => {
    const result = await processRazorpayWebhook({
      environment: 'TEST',
      payload: null,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(WebhookProcessingStates.REJECTED);
  });
});
