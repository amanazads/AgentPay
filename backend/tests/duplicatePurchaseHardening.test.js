/**
 * Track 01: Duplicate Purchase Execution & Concurrency Hardening Suite
 * 
 * Invariants under test:
 * 1. The same purchase intent NEVER results in multiple financial transactions or orders.
 * 2. 10 concurrent requests produce exactly 1 transaction, 1 order, and 1 invoice.
 * 3. Webhook replays (sequential or 10x concurrent) are completely idempotent (DUPLICATE_IGNORED).
 * 4. Network retries at any lifecycle point (post-creation, post-capture, post-order) return existing records.
 * 5. Fail-closed behavior is preserved under high concurrency.
 */
import crypto from 'crypto';
import { query } from '../src/config/database.js';
import env from '../src/config/env.js';
import { createPaymentOrder, verifyPayment } from '../src/services/paymentService.js';
import { processRazorpayWebhook } from '../src/services/webhookService.js';
import { createOrder } from '../src/services/orderService.js';
import { generateInvoiceForOrder } from '../src/services/invoiceService.js';
import { generateAccessToken } from '../src/utils/authUtils.js';
import { calculatePrice } from '../src/services/pricingService.js';

describe('Track 01: Duplicate Purchase & Idempotency Hardening Suite', () => {
  let testMerchant;
  let testProduct;
  let testUser;
  let testAgent;

  beforeAll(async () => {
    // 1. Ensure merchant
    const mRes = await query("SELECT * FROM merchants WHERE is_verified = true LIMIT 1");
    if (mRes.rows.length > 0) {
      testMerchant = mRes.rows[0];
    } else {
      const insM = await query(`
        INSERT INTO merchants (name, category, is_verified, rating)
        VALUES ('Idempotency Hardened Store', 'Electronics', true, 4.9)
        RETURNING *
      `);
      testMerchant = insM.rows[0];
    }

    // 2. Ensure product
    const insP = await query(`
      INSERT INTO products (merchant_id, name, category, price, in_stock, inventory)
      VALUES ($1, 'Idempotency Hardware Pro ' || $2, 'Electronics', 1999.00, true, 100)
      RETURNING *
    `, [testMerchant.id, Date.now()]);
    testProduct = insP.rows[0];

    // 3. Ensure user
    const insU = await query(`
      INSERT INTO users (email, name, role)
      VALUES ('idempotency_tester_' || $1 || '@agentpay.com', 'Idempotency Tester', 'BUYER')
      RETURNING *
    `, [Date.now()]);
    testUser = insU.rows[0];

    // 4. Ensure agent
    const aRes = await query("SELECT * FROM agents LIMIT 1");
    if (aRes.rows.length > 0) {
      testAgent = aRes.rows[0];
    } else {
      const insA = await query(`
        INSERT INTO agents (name, owner_id, status)
        VALUES ('Idempotency Agent', $1, 'active')
        RETURNING *
      `, [testUser.id]);
      testAgent = insA.rows[0];
    }
  });

  async function createTestIntent(customAmount = 1999.00) {
    const key = `intent_idem_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const res = await query(`
      INSERT INTO purchase_intents (
        agent_id, user_id, product_id, merchant_id, amount,
        quantity, status, idempotency_key
      )
      VALUES ($1, $2, $3, $4, $5, 1, 'allowed', $6)
      RETURNING *
    `, [testAgent.id, testUser.id, testProduct.id, testMerchant.id, customAmount, key]);
    return res.rows[0];
  }

  // ── TEST 1: Same Payment Order Request Twice (Sequential) ───────────────────
  test('TEST 1: Requesting payment order twice sequentially returns identical payment order with zero duplicate charge', async () => {
    const intent = await createTestIntent(1999.00);

    const order1 = await createPaymentOrder(intent.id);
    const order2 = await createPaymentOrder(intent.id);

    expect(order1.transactionId).toBe(order2.transactionId);
    expect(order1.orderId).toBe(order2.orderId);
    expect(order1.amount).toBe(order2.amount);
    expect(order2.isDuplicate).toBe(true);

    const txCount = await query('SELECT COUNT(*) as count FROM transactions WHERE purchase_intent_id = $1', [intent.id]);
    expect(parseInt(txCount.rows[0].count, 10)).toBe(1);
  });

  // ── TEST 2: 10 Concurrent Payment Order Requests ────────────────────────────
  test('TEST 2: 10 concurrent createPaymentOrder requests result in exactly ONE transaction record in database', async () => {
    const intent = await createTestIntent(1999.00);

    const results = await Promise.all([
      createPaymentOrder(intent.id),
      createPaymentOrder(intent.id),
      createPaymentOrder(intent.id),
      createPaymentOrder(intent.id),
      createPaymentOrder(intent.id),
      createPaymentOrder(intent.id),
      createPaymentOrder(intent.id),
      createPaymentOrder(intent.id),
      createPaymentOrder(intent.id),
      createPaymentOrder(intent.id),
    ]);

    expect(results).toHaveLength(10);
    const primaryTxId = results[0].transactionId;
    const primaryOrderId = results[0].orderId;

    for (const r of results) {
      expect(r.transactionId).toBe(primaryTxId);
      expect(r.orderId).toBe(primaryOrderId);
      expect(r.amount).toBe(1999.00);
    }

    const txCount = await query('SELECT COUNT(*) as count FROM transactions WHERE purchase_intent_id = $1', [intent.id]);
    expect(parseInt(txCount.rows[0].count, 10)).toBe(1);
  });

  // ── TEST 3: Payment Webhook Twice (Sequential Replay) ───────────────────────
  test('TEST 3: Replaying identical webhook event twice produces DUPLICATE_IGNORED with no extra state changes', async () => {
    const intent = await createTestIntent(1999.00);
    const paymentOrder = await createPaymentOrder(intent.id);

    const eventId = `evt_test_replay_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const payload = {
      event_id: eventId,
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: `pay_${crypto.randomBytes(6).toString('hex')}`,
            order_id: paymentOrder.orderId,
            amount: 199900,
            status: 'captured',
          },
        },
      },
    };

    const res1 = await processRazorpayWebhook({
      environment: 'TEST',
      payload,
    });
    expect(res1.success).toBe(true);
    expect(res1.status).toBe('PROCESSED');

    const res2 = await processRazorpayWebhook({
      environment: 'TEST',
      payload,
    });
    expect(res2.success).toBe(true);
    expect(res2.duplicate).toBe(true);
    expect(res2.status).toBe('DUPLICATE_IGNORED');

    const inboxCount = await query('SELECT COUNT(*) as count FROM webhook_inbox WHERE event_id = $1', [eventId]);
    expect(parseInt(inboxCount.rows[0].count, 10)).toBe(1);
  });

  // ── TEST 4: Payment Webhook 10 Times Concurrently ───────────────────────────
  test('TEST 4: 10 concurrent webhook executions with identical event_id are ingested exactly once with zero collisions', async () => {
    const intent = await createTestIntent(1999.00);
    const paymentOrder = await createPaymentOrder(intent.id);

    const eventId = `evt_concurrent_10x_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const payload = {
      event_id: eventId,
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: `pay_${crypto.randomBytes(6).toString('hex')}`,
            order_id: paymentOrder.orderId,
            amount: 199900,
            status: 'captured',
          },
        },
      },
    };

    const results = await Promise.all([
      processRazorpayWebhook({ environment: 'TEST', payload }),
      processRazorpayWebhook({ environment: 'TEST', payload }),
      processRazorpayWebhook({ environment: 'TEST', payload }),
      processRazorpayWebhook({ environment: 'TEST', payload }),
      processRazorpayWebhook({ environment: 'TEST', payload }),
      processRazorpayWebhook({ environment: 'TEST', payload }),
      processRazorpayWebhook({ environment: 'TEST', payload }),
      processRazorpayWebhook({ environment: 'TEST', payload }),
      processRazorpayWebhook({ environment: 'TEST', payload }),
      processRazorpayWebhook({ environment: 'TEST', payload }),
    ]);

    expect(results).toHaveLength(10);
    const processedCount = results.filter(r => r.status === 'PROCESSED').length;
    const duplicateCount = results.filter(r => r.status === 'DUPLICATE_IGNORED').length;

    expect(processedCount).toBe(1);
    expect(duplicateCount).toBe(9);

    const inboxCount = await query('SELECT COUNT(*) as count FROM webhook_inbox WHERE event_id = $1', [eventId]);
    expect(parseInt(inboxCount.rows[0].count, 10)).toBe(1);
  });

  // ── TEST 5: Network Retry After Payment Creation ────────────────────────────
  test('TEST 5: Network retry after payment creation returns existing order without creating new payment provider order', async () => {
    const intent = await createTestIntent(1999.00);

    const initial = await createPaymentOrder(intent.id);
    expect(initial.transactionId).toBeDefined();

    // Simulate client timeout & retry
    const retry = await createPaymentOrder(intent.id);
    expect(retry.isDuplicate).toBe(true);
    expect(retry.orderId).toBe(initial.orderId);
    expect(retry.transactionId).toBe(initial.transactionId);
  });

  // ── TEST 6: Retry After Payment Capture & Order Confirmation ────────────────
  test('TEST 6: Retrying payment verification for an already completed transaction produces idempotent existing order', async () => {
    const intent = await createTestIntent(1999.00);
    const paymentOrder = await createPaymentOrder(intent.id);

    const fakePaymentId = `pay_verify_retry_${Date.now()}`;
    const fakeSignature = crypto
      .createHmac('sha256', env.RAZORPAY_TEST_KEY_SECRET || 'test_secret')
      .update(`${paymentOrder.orderId}|${fakePaymentId}`)
      .digest('hex');

    // First verification (creates order & invoice)
    const res1 = await verifyPayment({
      transactionId: paymentOrder.transactionId,
      razorpayOrderId: paymentOrder.orderId,
      razorpayPaymentId: fakePaymentId,
      razorpaySignature: fakeSignature,
    });
    expect(res1.verified).toBe(true);
    expect(res1.order).toBeDefined();

    // Second verification (simulating duplicate webhook or client retry)
    const res2 = await verifyPayment({
      transactionId: paymentOrder.transactionId,
      razorpayOrderId: paymentOrder.orderId,
      razorpayPaymentId: fakePaymentId,
      razorpaySignature: fakeSignature,
    });
    expect(res2.verified).toBe(true);
    expect(res2.isDuplicate).toBe(true);
    expect(res2.order.id).toBe(res1.order.id);

    // Verify DB integrity: Exactly 1 order and 1 invoice exist
    const orderCount = await query('SELECT COUNT(*) as count FROM orders WHERE transaction_id = $1', [paymentOrder.transactionId]);
    expect(parseInt(orderCount.rows[0].count, 10)).toBe(1);

    const invoiceCount = await query('SELECT COUNT(*) as count FROM invoices WHERE order_id = $1', [res1.order.id]);
    expect(parseInt(invoiceCount.rows[0].count, 10)).toBe(1);
  });

  // ── TEST 7: Concurrent Direct Order Creation (10x createOrder) ──────────────
  test('TEST 7: 10 concurrent createOrder calls for the same transactionId produce exactly ONE order record', async () => {
    const intent = await createTestIntent(1999.00);
    const paymentOrder = await createPaymentOrder(intent.id);

    const orderCalls = Array.from({ length: 10 }, () =>
      createOrder({
        purchaseIntentId: intent.id,
        transactionId: paymentOrder.transactionId,
        userId: testUser.id,
        merchantId: testMerchant.id,
        productId: testProduct.id,
        quantity: 1,
        unitPrice: 1999.00,
        subtotal: 1999.00,
        totalAmount: 1999.00,
      })
    );

    const orders = await Promise.all(orderCalls);
    expect(orders).toHaveLength(10);

    const firstOrderNumber = orders[0].order_number;
    for (const o of orders) {
      expect(o.order_number).toBe(firstOrderNumber);
    }

    const orderCount = await query('SELECT COUNT(*) as count FROM orders WHERE transaction_id = $1', [paymentOrder.transactionId]);
    expect(parseInt(orderCount.rows[0].count, 10)).toBe(1);
  });

  // ── TEST 8: Concurrent Direct Invoice Creation (10x generateInvoice) ────────
  test('TEST 8: 10 concurrent generateInvoiceForOrder calls produce exactly ONE invoice record', async () => {
    const intent = await createTestIntent(1999.00);
    const paymentOrder = await createPaymentOrder(intent.id);

    const order = await createOrder({
      purchaseIntentId: intent.id,
      transactionId: paymentOrder.transactionId,
      userId: testUser.id,
      merchantId: testMerchant.id,
      productId: testProduct.id,
      quantity: 1,
      unitPrice: 1999.00,
      subtotal: 1999.00,
      totalAmount: 1999.00,
    });

    const invoiceCalls = Array.from({ length: 10 }, () =>
      generateInvoiceForOrder(order.id)
    );

    const invoices = await Promise.all(invoiceCalls);
    expect(invoices).toHaveLength(10);

    const firstInvoiceNumber = invoices[0].invoice_number;
    for (const inv of invoices) {
      expect(inv.invoice_number).toBe(firstInvoiceNumber);
    }

    const invoiceCount = await query('SELECT COUNT(*) as count FROM invoices WHERE order_id = $1', [order.id]);
    expect(parseInt(invoiceCount.rows[0].count, 10)).toBe(1);
  });
});
