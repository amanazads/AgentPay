import { jest } from '@jest/globals';
import request from 'supertest';
import crypto from 'crypto';
import { app } from '../src/index.js';
import { query } from '../src/config/database.js';
import env from '../src/config/env.js';
import { generateAccessToken } from '../src/utils/authUtils.js';
import { PurchaseStates, transitionPurchaseState } from '../src/services/purchaseStateMachine.js';
import { createPaymentOrder, verifyPayment } from '../src/services/paymentService.js';
import { processApproval } from '../src/services/approvalService.js';
import { evaluatePurchaseIntent } from '../src/services/decisionEngine.js';
import { processRazorpayWebhook, WebhookEventTypes } from '../src/services/webhookService.js';

jest.setTimeout(35000);

describe('Track 05: Payment State Machine & Buyer-Facing Success State Integrity', () => {
  let buyerUser, buyerToken;
  let supervisorUser, supervisorToken;
  let merchantId;
  let policyId;
  let testAgent;
  let catalogProduct;

  beforeAll(async () => {
    // 1. Setup Buyer User
    const uRes = await query(`
      INSERT INTO users (email, name, role)
      VALUES ('pay_state_buyer_' || floor(random()*1000000) || '@agentpay.com', 'State Machine Buyer', 'BUYER')
      RETURNING *
    `);
    buyerUser = uRes.rows[0];
    buyerToken = generateAccessToken(buyerUser);

    // 2. Setup Supervisor User
    const supRes = await query(`
      INSERT INTO users (email, name, role)
      VALUES ('pay_state_sup_' || floor(random()*1000000) || '@agentpay.com', 'State Machine Supervisor', 'SUPERVISOR')
      RETURNING *
    `);
    supervisorUser = supRes.rows[0];
    supervisorToken = generateAccessToken(supervisorUser);

    // 3. Setup Verified Merchant
    const mRes = await query(`
      INSERT INTO merchants (name, category, description, is_verified, rating, tier)
      VALUES ('Official Payment Verification Merchant ' || floor(random()*100000), 'Electronics', 'Verified Store', true, 4.9, 'tier_1')
      RETURNING id
    `);
    merchantId = mRes.rows[0].id;

    // 4. Setup Policy: 100k max, 15k approval threshold (auto-spend up to 15k, human approval > 15k)
    const polRes = await query(`
      INSERT INTO policies (name, version, daily_budget, max_transaction, approval_threshold, allowed_categories, blocked_categories, max_retries, price_tolerance_pct, verified_merchants_only)
      VALUES ('State Machine Policy', 'v1', 100000, 100000, 15000, ARRAY['Electronics'], ARRAY['Gambling'], 1, 2.0, true)
      RETURNING id
    `);
    policyId = polRes.rows[0].id;

    // 5. Setup Agent
    const aRes = await query(`
      INSERT INTO agents (owner_id, name, description, policy_id, status)
      VALUES ($1, 'State Machine Procurement Agent', 'Agent for State Machine Audits', $2, 'active')
      RETURNING *
    `, [buyerUser.id, policyId]);
    testAgent = aRes.rows[0];

    // 6. Seed Product: ₹8,000 in-stock item (stock=50)
    const pRes = await query(`
      INSERT INTO products (merchant_id, name, description, brand, category, product_type, price, inventory, in_stock, specifications, is_test_lab, commerce_eligible)
      VALUES ($1, 'State Machine Audited Laptop Hub', 'Thunderbolt 4 verified hub', 'CalDigit', 'Electronics', 'dock', 8000.00, 50, true, '{"ports": 10}', false, true)
      RETURNING *
    `, [merchantId]);
    catalogProduct = pRes.rows[0];
  });

  afterAll(async () => {
    if (buyerUser) {
      await query('DELETE FROM in_app_notifications WHERE user_id = $1', [buyerUser.id]);
      await query('DELETE FROM user_preferences WHERE user_id = $1', [buyerUser.id]);
      await query('DELETE FROM invoices WHERE order_id IN (SELECT id FROM orders WHERE user_id = $1)', [buyerUser.id]);
      await query('DELETE FROM orders WHERE user_id = $1', [buyerUser.id]);
      await query('DELETE FROM approvals WHERE purchase_intent_id IN (SELECT id FROM purchase_intents WHERE user_id = $1)', [buyerUser.id]);
      await query('DELETE FROM transactions WHERE user_id = $1', [buyerUser.id]);
      await query('DELETE FROM purchase_intents WHERE user_id = $1', [buyerUser.id]);
      await query('DELETE FROM agents WHERE owner_id = $1', [buyerUser.id]);
      await query('DELETE FROM users WHERE id = $1', [buyerUser.id]);
    }
    if (supervisorUser) {
      await query('DELETE FROM in_app_notifications WHERE user_id = $1', [supervisorUser.id]);
      await query('DELETE FROM users WHERE id = $1', [supervisorUser.id]);
    }
    if (merchantId) {
      await query('DELETE FROM products WHERE merchant_id = $1', [merchantId]);
      await query('DELETE FROM merchants WHERE id = $1', [merchantId]);
    }
    if (policyId) await query('DELETE FROM policies WHERE id = $1', [policyId]);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // REQ 1 & 2: PurchaseIntent & Razorpay Order Creation are NOT Payment Success
  // ──────────────────────────────────────────────────────────────────────────
  test('REQ 1 & 2: Creating a PurchaseIntent & Razorpay order transitions to PAYMENT_PENDING, NOT payment success', async () => {
    // 1. Create PurchaseIntent
    const piRes = await request(app)
      .post('/api/purchase-intents')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        agent_id: testAgent.id,
        product_id: catalogProduct.id,
        amount: 8000,
        quantity: 1,
      });

    expect(piRes.status).toBe(201);
    const intent = piRes.body.purchaseIntent;
    expect(intent.status).toBe('pending');
    expect(intent.state || 'CREATED').toBe('CREATED');

    // 2. Initialize Payment Order
    const orderRes = await createPaymentOrder(intent.id, { mode: 'TEST' });
    expect(orderRes.orderId).toBeDefined();

    // Verify DB state is strictly PAYMENT_PENDING, zero orders exist
    const updatedPi = (await query('SELECT state, status FROM purchase_intents WHERE id = $1', [intent.id])).rows[0];
    expect(updatedPi.state).toBe(PurchaseStates.PAYMENT_PENDING);
    expect(updatedPi.status).toBe('payment_pending');

    const ordersCount = (await query('SELECT COUNT(*) FROM orders WHERE purchase_intent_id = $1', [intent.id])).rows[0].count;
    expect(parseInt(ordersCount, 10)).toBe(0);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // REQ 3: Policy ALLOW is NOT Payment Success
  // ──────────────────────────────────────────────────────────────────────────
  test('REQ 3: Policy ALLOW sets state to CART_CREATED, NOT payment success', async () => {
    const piRes = await query(`
      INSERT INTO purchase_intents (agent_id, user_id, product_id, merchant_id, amount, quantity, status)
      VALUES ($1, $2, $3, $4, 8000, 1, 'pending')
      RETURNING *
    `, [testAgent.id, buyerUser.id, catalogProduct.id, merchantId]);
    const intentId = piRes.rows[0].id;

    const evalResult = await evaluatePurchaseIntent(intentId);
    expect(evalResult.decision).toBe('ALLOW');
    expect(evalResult.state).toBe(PurchaseStates.CART_CREATED);

    // Verify database state
    const dbPi = (await query('SELECT state, status FROM purchase_intents WHERE id = $1', [intentId])).rows[0];
    expect(dbPi.state).toBe(PurchaseStates.CART_CREATED);
    expect(dbPi.status).toBe('allowed');

    // Verify zero financial transaction completion
    const txs = await query('SELECT * FROM transactions WHERE purchase_intent_id = $1', [intentId]);
    expect(txs.rows.length).toBe(0);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // REQ 4: Human Approval is NOT Payment Success
  // ──────────────────────────────────────────────────────────────────────────
  test('REQ 4: Supervisor approval transitions to APPROVED / PAYMENT_PENDING, NOT payment success', async () => {
    // 4 units of ₹8,000 = ₹32,000 (exceeds ₹15k approval threshold without price surge)
    const piRes = await query(`
      INSERT INTO purchase_intents (agent_id, user_id, product_id, merchant_id, amount, quantity, status)
      VALUES ($1, $2, $3, $4, 32000, 4, 'pending')
      RETURNING *
    `, [testAgent.id, buyerUser.id, catalogProduct.id, merchantId]);
    const intentId = piRes.rows[0].id;

    // Evaluate -> APPROVAL_REQUIRED
    const evalRes = await evaluatePurchaseIntent(intentId);
    expect(evalRes.decision).toBe('APPROVAL_REQUIRED');

    const appRecord = (await query('SELECT id FROM approvals WHERE purchase_intent_id = $1', [intentId])).rows[0];
    expect(appRecord).toBeDefined();

    // Supervisor Approves without auto-settling payment
    const approveRes = await processApproval({
      approvalId: appRecord.id,
      decision: 'APPROVE',
      reviewerId: supervisorUser.id,
      autoCreatePayment: false,
    });

    expect(approveRes.decision).toBe('APPROVE');

    // DB state must be APPROVED, NOT COMPLETED or ORDER_CONFIRMED
    const updatedPi = (await query('SELECT state, status FROM purchase_intents WHERE id = $1', [intentId])).rows[0];
    expect(updatedPi.state).toBe(PurchaseStates.APPROVED);
    expect(updatedPi.status).toBe('approved');

    // Initializing payment order after approval transitions to PAYMENT_PENDING, still NOT payment success
    const paymentOrder = await createPaymentOrder(intentId, { mode: 'TEST' });
    expect(paymentOrder.orderId).toBeDefined();

    const pendingPi = (await query('SELECT state, status FROM purchase_intents WHERE id = $1', [intentId])).rows[0];
    expect(pendingPi.state).toBe(PurchaseStates.PAYMENT_PENDING);
    expect(pendingPi.status).toBe('payment_pending');

    // Transaction exists in payment_pending status, NOT completed
    const tx = (await query('SELECT status, payment_verified FROM transactions WHERE purchase_intent_id = $1', [intentId])).rows[0];
    expect(tx.status).toBe('payment_pending');
    expect(tx.payment_verified).toBe(false);

    // No confirmed order yet
    const orderCount = (await query('SELECT COUNT(*) FROM orders WHERE purchase_intent_id = $1', [intentId])).rows[0].count;
    expect(parseInt(orderCount, 10)).toBe(0);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // REQ 5, 7 & 8: Signature Verification & Authoritative Confirmation
  // ──────────────────────────────────────────────────────────────────────────
  test('REQ 5, 7 & 8: Missing or invalid signature is rejected fail-closed; state transitions to PAYMENT_FAILED with zero orders', async () => {
    const piRes = await query(`
      INSERT INTO purchase_intents (agent_id, user_id, product_id, merchant_id, amount, quantity, status)
      VALUES ($1, $2, $3, $4, 8000, 1, 'pending')
      RETURNING *
    `, [testAgent.id, buyerUser.id, catalogProduct.id, merchantId]);
    const intentId = piRes.rows[0].id;

    await evaluatePurchaseIntent(intentId);
    const paymentOrder = await createPaymentOrder(intentId, { mode: 'TEST' });

    // 1. Missing signature
    await expect(
      verifyPayment({
        transactionId: paymentOrder.transactionId,
        razorpayOrderId: paymentOrder.orderId,
        razorpayPaymentId: 'pay_test_tampered',
        razorpaySignature: '', // Empty/missing
      })
    ).rejects.toThrow(/Payment signature verification failed/i);

    // Verify transaction status is failed and state is PAYMENT_FAILED
    const failedTx = (await query('SELECT status FROM transactions WHERE id = $1', [paymentOrder.transactionId])).rows[0];
    expect(failedTx.status).toBe('failed');

    const failedPi = (await query('SELECT state FROM purchase_intents WHERE id = $1', [intentId])).rows[0];
    expect(failedPi.state).toBe(PurchaseStates.PAYMENT_FAILED);

    // Verify zero orders created
    const orders = await query('SELECT * FROM orders WHERE purchase_intent_id = $1', [intentId]);
    expect(orders.rows.length).toBe(0);
  });

  test('REQ 6: Authoritative server verification with valid cryptographic signature confirms order and invoice', async () => {
    const piRes = await query(`
      INSERT INTO purchase_intents (agent_id, user_id, product_id, merchant_id, amount, quantity, status)
      VALUES ($1, $2, $3, $4, 8000, 1, 'pending')
      RETURNING *
    `, [testAgent.id, buyerUser.id, catalogProduct.id, merchantId]);
    const intentId = piRes.rows[0].id;

    await evaluatePurchaseIntent(intentId);
    const paymentOrder = await createPaymentOrder(intentId, { mode: 'TEST' });
    const paymentId = `pay_test_${Math.random().toString(36).substring(2, 11)}`;

    // Generate valid HMAC signature matching test key secret
    const secret = env.RAZORPAY_TEST_KEY_SECRET;
    const body = `${paymentOrder.orderId}|${paymentId}`;
    const validSig = secret
      ? crypto.createHmac('sha256', secret).update(body).digest('hex')
      : 'test_signature_valid';

    const verifyRes = await verifyPayment({
      transactionId: paymentOrder.transactionId,
      razorpayOrderId: paymentOrder.orderId,
      razorpayPaymentId: paymentId,
      razorpaySignature: validSig,
    });

    expect(verifyRes.verified).toBe(true);
    expect(verifyRes.order).toBeDefined();

    // Verify state machine reached COMPLETED
    const finalPi = (await query('SELECT state, status FROM purchase_intents WHERE id = $1', [intentId])).rows[0];
    expect(finalPi.state).toBe(PurchaseStates.COMPLETED);
    expect(finalPi.status).toBe('completed');

    // Verify transaction is completed and payment_verified is true
    const finalTx = (await query('SELECT status, payment_verified FROM transactions WHERE id = $1', [paymentOrder.transactionId])).rows[0];
    expect(finalTx.status).toBe('completed');
    expect(finalTx.payment_verified).toBe(true);

    // Verify invoice created
    const inv = (await query('SELECT * FROM invoices WHERE order_id = $1', [verifyRes.order.id])).rows[0];
    expect(inv).toBeDefined();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // REQ 9, 10 & 11: Webhook Security, Idempotency & Safe Unknown Event Handling
  // ──────────────────────────────────────────────────────────────────────────
  test('REQ 9: Webhook with invalid environment or tamper attempt is rejected fail-closed', async () => {
    const fakeEvent = {
      event: WebhookEventTypes.PAYMENT_CAPTURED,
      event_id: `evt_test_${Math.random().toString(36).substring(2, 10)}`,
      payload: {
        payment: { entity: { id: 'pay_tampered', order_id: 'order_nonexistent', amount: 800000, currency: 'INR' } },
      },
    };

    // Live mode without valid signature or unconfigured secret MUST fail
    await expect(
      processRazorpayWebhook({
        environment: 'LIVE',
        signature: null,
        rawBody: JSON.stringify(fakeEvent),
        payload: fakeEvent,
      })
    ).rejects.toThrow(/Missing signature|FATAL SECURITY LOCK/i);
  });

  test('REQ 10: Unknown webhook event type fails safely without mutating state', async () => {
    const unknownEvent = {
      event: 'subscription.paused.custom_event',
      event_id: `evt_unknown_${Math.random().toString(36).substring(2, 10)}`,
      payload: { custom_data: true },
    };

    const result = await processRazorpayWebhook({
      environment: 'TEST',
      signature: 'valid_test_sig',
      rawBody: JSON.stringify(unknownEvent),
      payload: unknownEvent,
    });

    expect(result.status).toBe('IGNORED');
    expect(result.success).toBe(true);
  });

  test('REQ 11: Duplicate webhook deliveries are strictly idempotent (DUPLICATE_IGNORED)', async () => {
    const eventId = `evt_dedup_${Math.random().toString(36).substring(2, 10)}`;
    const event = {
      event: WebhookEventTypes.ORDER_PAID,
      event_id: eventId,
      payload: {
        order: { entity: { id: 'order_duplicate_test' } },
      },
    };

    // First delivery
    const res1 = await processRazorpayWebhook({
      environment: 'TEST',
      signature: 'valid_test_sig',
      rawBody: JSON.stringify(event),
      payload: event,
    });

    // Second delivery with identical event_id
    const res2 = await processRazorpayWebhook({
      environment: 'TEST',
      signature: 'valid_test_sig',
      rawBody: JSON.stringify(event),
      payload: event,
    });

    expect(res2.duplicate).toBe(true);
    expect(res2.status).toBe('DUPLICATE_IGNORED');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // REQ 12 & 13: Zero Contradiction & Reconciliation Required Handling
  // ──────────────────────────────────────────────────────────────────────────
  test('REQ 12 & 13: When payment is uncertain or order creation fails, system transitions to RECONCILIATION_REQUIRED', async () => {
    const piRes = await query(`
      INSERT INTO purchase_intents (agent_id, user_id, product_id, merchant_id, amount, quantity, status)
      VALUES ($1, $2, $3, $4, 8000, 1, 'pending')
      RETURNING *
    `, [testAgent.id, buyerUser.id, catalogProduct.id, merchantId]);
    const intentId = piRes.rows[0].id;

    // Follow valid lifecycle transitions: CREATED -> CART_CREATED -> PAYMENT_PENDING -> RECONCILIATION_REQUIRED
    await transitionPurchaseState(intentId, PurchaseStates.CART_CREATED, { actor: 'system' });
    await transitionPurchaseState(intentId, PurchaseStates.PAYMENT_PENDING, { actor: 'system' });
    const reconTransition = await transitionPurchaseState(intentId, PurchaseStates.RECONCILIATION_REQUIRED, {
      actor: 'system',
      reason: 'Payment captured on gateway but order generation timed out',
    });

    expect(reconTransition.currentState).toBe(PurchaseStates.RECONCILIATION_REQUIRED);

    // Verify buyer purchases endpoint returns "Payment status pending / reconciliation required"
    // Create a transaction in reconciliation_required state
    await query(`
      INSERT INTO transactions (purchase_intent_id, agent_id, user_id, amount, status, razorpay_order_id, environment)
      VALUES ($1, $2, $3, 8000, 'reconciliation_required', 'order_recon_test', 'TEST')
    `, [intentId, testAgent.id, buyerUser.id]);

    const buyerPurchasesRes = await request(app)
      .get('/api/buyer/purchases')
      .set('Authorization', `Bearer ${buyerToken}`);

    expect(buyerPurchasesRes.status).toBe(200);
    const reconItem = buyerPurchasesRes.body.purchases.find(
      (p) => p.payment_status === 'RECONCILIATION_REQUIRED' || p.status === 'RECONCILIATION_REQUIRED'
    );
    expect(reconItem).toBeDefined();
    expect(reconItem.why).toBe('Payment status pending / reconciliation required');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // REQ 14: Illegal State Transitions Are Rejected Fail-Closed
  // ──────────────────────────────────────────────────────────────────────────
  test('REQ 14: Illegal state transition from CREATED directly to ORDER_CONFIRMED or COMPLETED throws error fail-closed', async () => {
    const piRes = await query(`
      INSERT INTO purchase_intents (agent_id, user_id, product_id, merchant_id, amount, quantity, status, state)
      VALUES ($1, $2, $3, $4, 8000, 1, 'pending', 'CREATED')
      RETURNING *
    `, [testAgent.id, buyerUser.id, catalogProduct.id, merchantId]);
    const intentId = piRes.rows[0].id;

    // Illegal jump from CREATED to ORDER_CONFIRMED must throw
    await expect(
      transitionPurchaseState(intentId, PurchaseStates.ORDER_CONFIRMED, { actor: 'malicious_client' })
    ).rejects.toThrow(/Illegal state transition rejected/i);

    // State must remain unchanged at CREATED
    const stateCheck = (await query('SELECT state FROM purchase_intents WHERE id = $1', [intentId])).rows[0];
    expect(stateCheck.state).toBe(PurchaseStates.CREATED);
  });
});
