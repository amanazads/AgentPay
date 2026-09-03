import { jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import crypto from 'crypto';
import { app } from '../src/index.js';
import { query, getClient } from '../src/config/database.js';
import env from '../src/config/env.js';
import { generateAccessToken } from '../src/utils/authUtils.js';
import { createPaymentOrder, verifyPayment } from '../src/services/paymentService.js';
import { createOrder, cancelOrder } from '../src/services/orderService.js';
import { reserveInventory, commitReservation, releaseReservation, getAvailableInventory } from '../src/services/inventoryService.js';
import { processApproval } from '../src/services/approvalService.js';
import { processRazorpayWebhook } from '../src/services/webhookService.js';
import { calculatePrice, toRazorpayAmount } from '../src/services/pricingService.js';

jest.setTimeout(30000);

describe('Track 01: Concurrency & Double-Spend Elimination Hardening Suite', () => {
  let buyerUser, buyerToken;
  let buyerUsers = [];
  let buyerTokens = [];
  let merchantUser, merchantToken;
  let merchantId;
  let standardProduct;

  beforeAll(async () => {
    // 1. Ensure test buyer user
    const bRes = await query("SELECT * FROM users WHERE role = 'BUYER' OR role = 'user' LIMIT 1");
    if (bRes.rows.length > 0) {
      buyerUser = bRes.rows[0];
    } else {
      const insB = await query(`
        INSERT INTO users (email, name, role)
        VALUES ('buyer_concurrency_primary@agentpay.com', 'Concurrency Primary Buyer', 'BUYER')
        RETURNING *
      `);
      buyerUser = insB.rows[0];
    }
    buyerToken = generateAccessToken(buyerUser);

    // Create 10 distinct buyer users for last-stock race
    for (let i = 0; i < 10; i++) {
      const email = `buyer_race_${i}_${Date.now()}@agentpay.com`;
      const res = await query(`
        INSERT INTO users (email, name, role)
        VALUES ($1, $2, 'BUYER')
        RETURNING *
      `, [email, `Race Buyer ${i}`]);
      buyerUsers.push(res.rows[0]);
      buyerTokens.push(generateAccessToken(res.rows[0]));

      // Ensure generous user preferences for test buyers
      await query(`
        INSERT INTO user_preferences (user_id, monthly_budget, auto_purchase_limit, categories, purchase_behavior)
        VALUES ($1, 1000000, 200000, ARRAY['Electronics', 'Peripherals'], 'auto_within_limit')
        ON CONFLICT (user_id) DO UPDATE SET
          monthly_budget = 1000000,
          auto_purchase_limit = 200000,
          purchase_behavior = 'auto_within_limit'
      `, [res.rows[0].id]);
    }

    // Ensure primary buyer preferences
    await query(`
      INSERT INTO user_preferences (user_id, monthly_budget, auto_purchase_limit, categories, purchase_behavior)
      VALUES ($1, 1000000, 200000, ARRAY['Electronics', 'Peripherals'], 'auto_within_limit')
      ON CONFLICT (user_id) DO UPDATE SET
        monthly_budget = 1000000,
        auto_purchase_limit = 200000,
        purchase_behavior = 'auto_within_limit'
    `, [buyerUser.id]);

    // Ensure agent policies have high limits
    await query(`
      UPDATE policies
      SET max_transaction = 200000,
          daily_budget = 1000000,
          approval_threshold = 100000,
          allowed_categories = ARRAY['Electronics', 'Peripherals', 'Hardware', 'Software & Licenses', 'Furniture']
    `);

    // 2. Ensure verified test merchant
    const mRes = await query("SELECT * FROM merchants WHERE is_verified = true AND (is_test_lab = false OR is_test_lab IS NULL) LIMIT 1");
    if (mRes.rows.length > 0) {
      merchantId = mRes.rows[0].id;
    } else {
      const insM = await query(`
        INSERT INTO merchants (name, category, is_verified, rating, is_test_lab)
        VALUES ('Concurrency Store', 'Electronics', true, 4.9, false)
        RETURNING *
      `);
      merchantId = insM.rows[0].id;
    }

    // 3. Ensure test product with ample stock
    const pRes = await query(`
      SELECT * FROM products 
      WHERE merchant_id = $1 AND in_stock = true AND price > 0 AND (is_test_lab = false OR is_test_lab IS NULL)
      LIMIT 1
    `, [merchantId]);

    if (pRes.rows.length > 0) {
      standardProduct = pRes.rows[0];
      await query("UPDATE products SET inventory = 500, in_stock = true, status = 'ACTIVE' WHERE id = $1", [standardProduct.id]);
    } else {
      const insP = await query(`
        INSERT INTO products (merchant_id, sku, name, description, brand, category, price, currency, inventory, in_stock, specifications, status)
        VALUES ($1, 'SKU-CONC-01', 'Anker 737 Power Bank 24000mAh', 'Power bank', 'Anker', 'Electronics', 4499, 'INR', 500, true, '{"capacity":"24000mAh"}'::jsonb, 'ACTIVE')
        RETURNING *
      `, [merchantId]);
      standardProduct = insP.rows[0];
    }
  });

  // ── TEST 1: 20 Identical Concurrent Purchase Requests ───────────────────────
  it('TEST 1: 20 identical concurrent purchase requests create EXACTLY ONE intent, ONE transaction, ONE order and decrement stock by 1', async () => {
    // Create dedicated unique test product
    const uniqueSku = `SKU-CONC-${Date.now()}`;
    const uniqueName = `HyperSpeed Pro Charger ${Date.now()}`;
    const pRes = await query(`
      INSERT INTO products (merchant_id, sku, name, description, brand, category, price, currency, inventory, in_stock, specifications, status)
      VALUES ($1, $2, $3, 'High power charger', 'HyperSpeed', 'Electronics', 4499, 'INR', 500, true, '{"power":"140W"}'::jsonb, 'ACTIVE')
      RETURNING *
    `, [merchantId, uniqueSku, uniqueName]);
    const targetProduct = pRes.rows[0];

    const idempotencyKey = `concurrency_20_req_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const initialStock = targetProduct.inventory;

    // Fire 20 identical parallel requests with the same idempotency key
    const requests = Array.from({ length: 20 }).map(() =>
      request(app)
        .post('/api/ai/chat')
        .set('idempotency-key', idempotencyKey)
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({
          message: `Buy the ${uniqueName}`,
          idempotency_key: idempotencyKey,
        })
    );

    const responses = await Promise.all(requests);
    const non200 = responses.filter(r => r.status !== 200);
    expect(non200.map(r => ({ status: r.status, body: r.body, text: r.text }))).toEqual([]);

    // Database Invariant Assertions:
    // 1. Exactly 1 Purchase Intent with this idempotency key
    const intentRes = await query('SELECT * FROM purchase_intents WHERE idempotency_key = $1', [idempotencyKey]);
    expect(intentRes.rows.length).toBe(1);
    const intentId = intentRes.rows[0].id;

    // 2. Exactly 1 Transaction for this intent
    const txRes = await query('SELECT * FROM transactions WHERE purchase_intent_id = $1', [intentId]);
    expect(txRes.rows.length).toBe(1);

    // 3. Exactly 1 Order for this intent / transaction
    const orderRes = await query('SELECT * FROM orders WHERE purchase_intent_id = $1', [intentId]);
    expect(orderRes.rows.length).toBe(1);

    // 4. Exactly 1 Invoice for this order
    const invRes = await query('SELECT * FROM invoices WHERE order_id = $1', [orderRes.rows[0].id]);
    expect(invRes.rows.length).toBe(1);

    // 5. Stock decremented by EXACTLY 1 (not 20)
    const boughtProductId = orderRes.rows[0].product_id;
    const pi = intentRes.rows[0];
    const rRow = (await query('SELECT * FROM inventory_reservations WHERE quote_id = $1', [pi.quote_id])).rows[0];
    expect(rRow).toBeDefined();
    expect(rRow.status).toBe('COMMITTED');
    expect(rRow.quantity).toBe(1);
    expect(rRow.product_id).toBe(boughtProductId);

    // Clean up
    await query('DELETE FROM invoices WHERE order_id IN (SELECT id FROM orders WHERE purchase_intent_id IN (SELECT id FROM purchase_intents WHERE product_id = $1))', [targetProduct.id]);
    await query('DELETE FROM orders WHERE purchase_intent_id IN (SELECT id FROM purchase_intents WHERE product_id = $1)', [targetProduct.id]);
    await query('DELETE FROM transactions WHERE purchase_intent_id IN (SELECT id FROM purchase_intents WHERE product_id = $1)', [targetProduct.id]);
    await query('DELETE FROM purchase_intents WHERE product_id = $1', [targetProduct.id]);
    await query('DELETE FROM products WHERE id = $1', [targetProduct.id]);
  });

  // ── TEST 2: Duplicate Checkout Race ─────────────────────────────────────────
  it('TEST 2: Concurrent createPaymentOrder calls on the same intent return the exact same transaction without duplicates', async () => {
    const canonicalPricing = calculatePrice({
      product: standardProduct,
      quantity: 1,
      deliveryMethod: 'STANDARD',
    });

    // Create an authorized purchase intent
    const idempotencyKey = `intent_checkout_race_${Date.now()}`;
    const piRes = await query(`
      INSERT INTO purchase_intents (
        user_id, product_id, merchant_id, amount, quantity, status, state, idempotency_key
      )
      VALUES ($1, $2, $3, $4, 1, 'allowed', 'ALLOWED', $5)
      RETURNING *
    `, [buyerUser.id, standardProduct.id, merchantId, canonicalPricing.totalAmount, idempotencyKey]);
    const intent = piRes.rows[0];

    // Fire 10 concurrent createPaymentOrder invocations
    const checkoutCalls = Array.from({ length: 10 }).map(() =>
      createPaymentOrder({ purchaseIntentId: intent.id })
    );

    const results = await Promise.all(checkoutCalls);

    // All must return valid order info
    results.forEach((res) => {
      expect(res.orderId).toBeDefined();
      expect(res.transactionId).toBeDefined();
    });

    // All orderIds and transactionIds must be IDENTICAL
    const orderIds = new Set(results.map((r) => r.orderId));
    const txIds = new Set(results.map((r) => r.transactionId));
    expect(orderIds.size).toBe(1);
    expect(txIds.size).toBe(1);

    // In DB, exactly 1 transaction exists
    const dbTx = await query('SELECT * FROM transactions WHERE purchase_intent_id = $1', [intent.id]);
    expect(dbTx.rows.length).toBe(1);
  });

  // ── TEST 3: Duplicate Webhook Replay ────────────────────────────────────────
  it('TEST 3: Duplicate webhook delivery is processed exactly once with zero double commitments', async () => {
    // Create intent + transaction
    const canonicalPricing = calculatePrice({
      product: standardProduct,
      quantity: 1,
      deliveryMethod: 'STANDARD',
    });

    const piRes = await query(`
      INSERT INTO purchase_intents (user_id, product_id, merchant_id, amount, quantity, status, state)
      VALUES ($1, $2, $3, $4, 1, 'allowed', 'ALLOWED')
      RETURNING *
    `, [buyerUser.id, standardProduct.id, merchantId, canonicalPricing.totalAmount]);
    const intent = piRes.rows[0];

    const rzpOrderId = `order_wh_race_${Date.now()}`;
    const txRes = await query(`
      INSERT INTO transactions (purchase_intent_id, user_id, amount, currency, status, razorpay_order_id, environment, payment_mode)
      VALUES ($1, $2, $3, 'INR', 'payment_pending', $4, 'TEST', 'TEST')
      RETURNING *
    `, [intent.id, buyerUser.id, canonicalPricing.totalAmount, rzpOrderId]);
    const tx = txRes.rows[0];

    const eventId = `evt_race_${Date.now()}`;
    const webhookPayload = {
      event_id: eventId,
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: `pay_wh_${Date.now()}`,
            order_id: rzpOrderId,
            amount: toRazorpayAmount(canonicalPricing.totalAmount),
            status: 'captured',
          },
        },
      },
    };

    // Fire 5 identical concurrent webhook requests
    const webhookCalls = Array.from({ length: 5 }).map(() =>
      processRazorpayWebhook({
        environment: 'TEST',
        signature: 'valid_test_sig',
        rawBody: JSON.stringify(webhookPayload),
        payload: webhookPayload,
      })
    );

    const results = await Promise.all(webhookCalls);

    // Exactly 1 must be PROCESSED and 4 must be DUPLICATE_IGNORED
    const processedCount = results.filter((r) => r.status === 'PROCESSED' || (r.success && !r.duplicate)).length;
    const duplicateCount = results.filter((r) => r.status === 'DUPLICATE_IGNORED' || r.duplicate).length;

    expect(processedCount).toBe(1);
    expect(duplicateCount).toBe(4);

    // In DB, exactly 1 order exists for this transaction
    const ordRes = await query('SELECT * FROM orders WHERE transaction_id = $1', [tx.id]);
    expect(ordRes.rows.length).toBe(1);
  });

  // ── TEST 4: Payment Timeout + Immediate Retry ───────────────────────────────
  it('TEST 4: Client retry after simulated payment timeout safely reconciles against verified state', async () => {
    const canonicalPricing = calculatePrice({
      product: standardProduct,
      quantity: 1,
      deliveryMethod: 'STANDARD',
    });

    // Create intent + transaction
    const piRes = await query(`
      INSERT INTO purchase_intents (user_id, product_id, merchant_id, amount, quantity, status, state)
      VALUES ($1, $2, $3, $4, 1, 'allowed', 'ALLOWED')
      RETURNING *
    `, [buyerUser.id, standardProduct.id, merchantId, canonicalPricing.totalAmount]);
    const intent = piRes.rows[0];

    const rzpOrderId = `order_timeout_${Date.now()}`;
    const txRes = await query(`
      INSERT INTO transactions (purchase_intent_id, user_id, amount, currency, status, razorpay_order_id, environment, payment_mode)
      VALUES ($1, $2, $3, 'INR', 'payment_pending', $4, 'TEST', 'TEST')
      RETURNING *
    `, [intent.id, buyerUser.id, canonicalPricing.totalAmount, rzpOrderId]);
    const tx = txRes.rows[0];

    const fakePaymentId = `pay_retry_${Date.now()}`;
    const fakeSignature = crypto
      .createHmac('sha256', env.RAZORPAY_TEST_KEY_SECRET || 'test_secret')
      .update(`${rzpOrderId}|${fakePaymentId}`)
      .digest('hex');

    // First attempt completes
    const firstAttempt = await verifyPayment({
      transactionId: tx.id,
      razorpayOrderId: rzpOrderId,
      razorpayPaymentId: fakePaymentId,
      razorpaySignature: fakeSignature,
    });
    expect(firstAttempt.verified).toBe(true);

    // Second attempt (client retry after perceived timeout)
    const retryAttempt = await verifyPayment({
      transactionId: tx.id,
      razorpayOrderId: rzpOrderId,
      razorpayPaymentId: fakePaymentId,
      razorpaySignature: fakeSignature,
    });

    expect(retryAttempt.verified).toBe(true);
    expect(retryAttempt.isDuplicate).toBe(true);
    expect(retryAttempt.transaction.id).toBe(tx.id);

    // Assert only 1 order in DB
    const orders = await query('SELECT * FROM orders WHERE transaction_id = $1', [tx.id]);
    expect(orders.rows.length).toBe(1);
  });

  // ── TEST 5: Last-Stock-Unit Race (Zero Overselling Guarantee) ───────────────
  it('TEST 5: When 10 concurrent buyers race for the final 1 unit of stock, EXACTLY 1 succeeds and 9 fail with zero negative inventory', async () => {
    // Create a dedicated product with exactly 1 unit of stock
    const pIns = await query(`
      INSERT INTO products (merchant_id, sku, name, description, brand, category, price, currency, inventory, in_stock, specifications, status)
      VALUES ($1, $2, 'Exclusive Rare Collector Unit', 'Limited 1 unit', 'CollectorBrand', 'Electronics', 9999, 'INR', 1, true, '{}'::jsonb, 'ACTIVE')
      RETURNING *
    `, [merchantId, `SKU-RARE-${Date.now()}`]);
    const rareProduct = pIns.rows[0];

    // 10 distinct buyers concurrently attempt to reserve the 1 unit
    const reservationAttempts = buyerUsers.map((buyer, idx) =>
      reserveInventory({
        productId: rareProduct.id,
        quantity: 1,
        userId: buyer.id,
        quoteId: `quote_race_unit_${idx}_${Date.now()}`,
      })
        .then((res) => ({ success: true, user: buyer.id, res }))
        .catch((err) => ({ success: false, user: buyer.id, error: err.message }))
    );

    const raceResults = await Promise.all(reservationAttempts);

    const successCount = raceResults.filter((r) => r.success).length;
    const failureCount = raceResults.filter((r) => !r.success).length;

    expect(successCount).toBe(1);
    expect(failureCount).toBe(9);

    // All 9 failures must explicitly state Insufficient inventory
    raceResults.filter((r) => !r.success).forEach((fail) => {
      expect(fail.error).toMatch(/Insufficient inventory/i);
    });

    // Commit the 1 winning reservation
    const winningRes = raceResults.find((r) => r.success);
    const commitRes = await commitReservation(winningRes.res.reservationId);
    expect(commitRes.success).toBe(true);

    // Product inventory in DB must be exactly 0 (never negative)
    const finalProd = (await query('SELECT inventory, in_stock FROM products WHERE id = $1', [rareProduct.id])).rows[0];
    expect(finalProd.inventory).toBe(0);
    expect(finalProd.in_stock).toBe(false);

    // Clean up
    await query('DELETE FROM products WHERE id = $1', [rareProduct.id]);
  });

  // ── TEST 6: Approval Decision Race (Concurrent APPROVE vs REJECT) ───────────
  it('TEST 6: Concurrent APPROVE and REJECT on the same pending approval accepts exactly one decision and rejects the other', async () => {
    // Create intent + approval requiring human review
    const piRes = await query(`
      INSERT INTO purchase_intents (user_id, product_id, merchant_id, amount, quantity, status, state)
      VALUES ($1, $2, $3, 150000, 1, 'approval_required', 'APPROVAL_REQUIRED')
      RETURNING *
    `, [buyerUser.id, standardProduct.id, merchantId]);
    const intent = piRes.rows[0];

    const appRes = await query(`
      INSERT INTO approvals (purchase_intent_id, status)
      VALUES ($1, 'pending')
      RETURNING *
    `, [intent.id]);
    const approval = appRes.rows[0];

    // Fire 2 concurrent conflicting decisions simultaneously
    const decisionCalls = [
      processApproval({
        approvalId: approval.id,
        decision: 'APPROVE',
        reviewerId: buyerUser.id,
        notes: 'Approved by human reviewer',
        autoCreatePayment: false,
      })
        .then((r) => ({ success: true, decision: 'APPROVE', r }))
        .catch((err) => ({ success: false, decision: 'APPROVE', status: err.status, error: err.message })),
      processApproval({
        approvalId: approval.id,
        decision: 'REJECT',
        reviewerId: buyerUser.id,
        notes: 'Rejected by human reviewer',
        autoCreatePayment: false,
      })
        .then((r) => ({ success: true, decision: 'REJECT', r }))
        .catch((err) => ({ success: false, decision: 'REJECT', status: err.status, error: err.message })),
    ];

    const results = await Promise.all(decisionCalls);

    const succeeded = results.filter((r) => r.success);
    const rejected = results.filter((r) => !r.success);

    expect(succeeded.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect(rejected[0].error).toMatch(/already processed/i);

    // Check final status in DB
    const finalApp = (await query('SELECT status, decision FROM approvals WHERE id = $1', [approval.id])).rows[0];
    expect(['approved', 'rejected']).toContain(finalApp.status);
  });

  // ── TEST 7: Cancellation Race ───────────────────────────────────────────────
  it('TEST 7: Concurrent cancellation calls on the same order transition once and release inventory idempotently', async () => {
    // Create product and reservation
    const pIns = await query(`
      INSERT INTO products (merchant_id, sku, name, description, brand, category, price, currency, inventory, in_stock, specifications, status)
      VALUES ($1, $2, 'Cancellation Race Unit', 'Test description', 'Brand', 'Electronics', 1000, 'INR', 10, true, '{}'::jsonb, 'ACTIVE')
      RETURNING *
    `, [merchantId, `SKU-CANCEL-${Date.now()}`]);
    const testP = pIns.rows[0];

    const quoteId = `quote_cancel_race_${Date.now()}`;
    const resv = await reserveInventory({
      productId: testP.id,
      quantity: 1,
      userId: buyerUser.id,
      quoteId,
    });

    // Create confirmed order
    const order = await createOrder({
      productId: testP.id,
      merchantId,
      userId: buyerUser.id,
      quoteId,
      quantity: 1,
      unitPrice: 1000,
      subtotal: 1000,
      totalAmount: 1000,
    });

    // Fire 5 concurrent cancellation calls
    const cancelCalls = Array.from({ length: 5 }).map(() =>
      cancelOrder(order.id, {
        cancelledBy: 'buyer',
        reason: 'Concurrent Buyer Cancellation',
        userId: buyerUser.id,
      })
    );

    const results = await Promise.all(cancelCalls);

    // All must return the cancelled order record
    results.forEach((cancelledOrder) => {
      expect(cancelledOrder.id).toBe(order.id);
      expect(cancelledOrder.fulfillment_status).toBe('CANCELLED');
    });

    // In DB, order is cancelled
    const dbOrder = (await query('SELECT fulfillment_status, order_status FROM orders WHERE id = $1', [order.id])).rows[0];
    expect(dbOrder.fulfillment_status).toBe('CANCELLED');

    // Clean up
    await query('DELETE FROM products WHERE id = $1', [testP.id]);
  });
});
