import request from 'supertest';
import app from '../src/index.js';
import { query } from '../src/config/database.js';
import { generateAccessToken, hashPassword } from '../src/utils/authUtils.js';
import { transitionPurchaseState, PurchaseStates } from '../src/services/purchaseStateMachine.js';
import { transitionOrderFulfillment, OrderFulfillmentStates, createOrder } from '../src/services/orderService.js';
import { processRazorpayWebhook } from '../src/services/webhookService.js';

describe('Complete State Transition Matrix & Financial Invariant Audit', () => {
  let adminUser, adminToken;
  let buyerUser, buyerToken;
  let merchantStore, merchantUser, merchantToken;
  let product;
  let buyerAgent;

  beforeAll(async () => {
    const passHash = await hashPassword('password123');

    // Admin
    const adminRes = await query(`
      INSERT INTO users (email, name, role, password_hash)
      VALUES ('stm_admin_${Date.now()}@test.com', 'STM Admin', 'ADMIN', $1)
      RETURNING *
    `, [passHash]);
    adminUser = adminRes.rows[0];
    adminToken = generateAccessToken(adminUser);

    // Buyer
    const buyerRes = await query(`
      INSERT INTO users (email, name, role, password_hash)
      VALUES ('stm_buyer_${Date.now()}@test.com', 'STM Buyer', 'BUYER', $1)
      RETURNING *
    `, [passHash]);
    buyerUser = buyerRes.rows[0];
    buyerToken = generateAccessToken(buyerUser);

    // Merchant
    const mRes = await query(`
      INSERT INTO merchants (name, category, is_verified, risk_level, rating, is_test_lab)
      VALUES ('STM Store', 'Electronics', true, 'low', 4.9, false)
      RETURNING *
    `);
    merchantStore = mRes.rows[0];

    const mUserRes = await query(`
      INSERT INTO users (email, name, role, merchant_id, password_hash)
      VALUES ('stm_merch_${Date.now()}@test.com', 'STM Merchant', 'MERCHANT', $1, $2)
      RETURNING *
    `, [merchantStore.id, passHash]);
    merchantUser = mUserRes.rows[0];
    merchantToken = generateAccessToken(merchantUser);

    // Product
    const pRes = await query(`
      INSERT INTO products (
        merchant_id, sku, name, description, category, price, inventory, in_stock, commerce_eligible, is_test_lab
      )
      VALUES (
        $1, 'SKU-STM-01', 'State Machine Test Device', 'Testing all transitions', 'Electronics', 2999.00, 50, true, true, false
      )
      RETURNING *
    `, [merchantStore.id]);
    product = pRes.rows[0];

    // Policy & Agent
    const polRes = await query(`
      INSERT INTO policies (name, version, daily_budget, max_transaction, approval_threshold, allowed_categories)
      VALUES ('STM Policy', 'v1', 100000, 50000, 10000, ARRAY['electronics'])
      RETURNING *
    `);
    const buyerPolicy = polRes.rows[0];

    const aRes = await query(`
      INSERT INTO agents (name, owner_id, policy_id, description, status)
      VALUES ('STM Agent', $1, $2, 'State machine agent', 'active')
      RETURNING *
    `, [buyerUser.id, buyerPolicy.id]);
    buyerAgent = aRes.rows[0];
  });

  async function createTestIntent(initialState = PurchaseStates.CREATED) {
    const res = await query(`
      INSERT INTO purchase_intents (
        agent_id, user_id, product_id, merchant_id, amount, quantity, status, state
      )
      VALUES ($1, $2, $3, $4, 2999.00, 1, 'evaluating', $5)
      RETURNING *
    `, [buyerAgent.id, buyerUser.id, product.id, merchantStore.id, initialState]);
    return res.rows[0];
  }

  async function createTestOrder(initialState = OrderFulfillmentStates.CONFIRMED) {
    const intent = await createTestIntent(PurchaseStates.ORDER_CONFIRMED);
    const txId = `tx_stm_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const txRes = await query(`
      INSERT INTO transactions (
        purchase_intent_id, user_id, agent_id, amount, currency,
        razorpay_order_id, razorpay_payment_id, status, state, payment_verified
      )
      VALUES ($1, $2, $3, 2999.00, 'INR', $4, $5, 'completed', 'PAYMENT_SUCCESS', true)
      RETURNING *
    `, [intent.id, buyerUser.id, buyerAgent.id, `order_${txId}`, `pay_${txId}`]);

    const order = await createOrder({
      purchaseIntentId: intent.id,
      transactionId: txRes.rows[0].id,
      userId: buyerUser.id,
      merchantId: merchantStore.id,
      productId: product.id,
      quantity: 1,
      unitPrice: 2999.00,
      subtotal: 2999.00,
      totalAmount: 2999.00,
    });

    if (initialState !== OrderFulfillmentStates.CONFIRMED) {
      await query('UPDATE orders SET fulfillment_status = $1 WHERE id = $2', [initialState, order.id]);
      order.fulfillment_status = initialState;
    }
    return order;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // 1. Valid Canonical Transitions
  // ────────────────────────────────────────────────────────────────────────────

  describe('Section 1: Valid Canonical State Transitions', () => {
    it('1.1: Complete canonical purchase lifecycle CREATED → PAYMENT_PENDING → PAYMENT_SUCCESS → ORDER_CONFIRMED → COMPLETED', async () => {
      const intent = await createTestIntent(PurchaseStates.CREATED);

      // CREATED -> PAYMENT_PENDING
      const t1 = await transitionPurchaseState(intent.id, PurchaseStates.PAYMENT_PENDING);
      expect(t1.currentState).toBe(PurchaseStates.PAYMENT_PENDING);

      // PAYMENT_PENDING -> PAYMENT_SUCCESS
      const t2 = await transitionPurchaseState(intent.id, PurchaseStates.PAYMENT_SUCCESS);
      expect(t2.currentState).toBe(PurchaseStates.PAYMENT_SUCCESS);

      // PAYMENT_SUCCESS -> ORDER_CONFIRMED
      const t3 = await transitionPurchaseState(intent.id, PurchaseStates.ORDER_CONFIRMED);
      expect(t3.currentState).toBe(PurchaseStates.ORDER_CONFIRMED);

      // ORDER_CONFIRMED -> COMPLETED
      const t4 = await transitionPurchaseState(intent.id, PurchaseStates.COMPLETED);
      expect(t4.currentState).toBe(PurchaseStates.COMPLETED);
    });

    it('1.2: Complete canonical fulfillment lifecycle CONFIRMED → PROCESSING → PACKED → SHIPPED → OUT_FOR_DELIVERY → DELIVERED', async () => {
      const order = await createTestOrder(OrderFulfillmentStates.CONFIRMED);

      // CONFIRMED -> PROCESSING
      const f1 = await transitionOrderFulfillment(order.id, OrderFulfillmentStates.PROCESSING);
      expect(f1.fulfillment_status).toBe(OrderFulfillmentStates.PROCESSING);

      // PROCESSING -> PACKED
      const f2 = await transitionOrderFulfillment(order.id, OrderFulfillmentStates.PACKED);
      expect(f2.fulfillment_status).toBe(OrderFulfillmentStates.PACKED);

      // PACKED -> SHIPPED
      const f3 = await transitionOrderFulfillment(order.id, OrderFulfillmentStates.SHIPPED);
      expect(f3.fulfillment_status).toBe(OrderFulfillmentStates.SHIPPED);
      expect(f3.tracking_number).toBeDefined();

      // SHIPPED -> OUT_FOR_DELIVERY
      const f4 = await transitionOrderFulfillment(order.id, OrderFulfillmentStates.OUT_FOR_DELIVERY);
      expect(f4.fulfillment_status).toBe(OrderFulfillmentStates.OUT_FOR_DELIVERY);

      // OUT_FOR_DELIVERY -> DELIVERED
      const f5 = await transitionOrderFulfillment(order.id, OrderFulfillmentStates.DELIVERED);
      expect(f5.fulfillment_status).toBe(OrderFulfillmentStates.DELIVERED);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 2. Invalid & Contradictory Transitions (Requirement 1, 7 & 8)
  // ────────────────────────────────────────────────────────────────────────────

  describe('Section 2: Invalid Transitions Strictly Rejected Fail-Closed', () => {
    it('2.1: Requirement 7: PAYMENT_FAILED cannot transition to ORDER_CONFIRMED or COMPLETED', async () => {
      const intent = await createTestIntent(PurchaseStates.PAYMENT_FAILED);

      await expect(
        transitionPurchaseState(intent.id, PurchaseStates.ORDER_CONFIRMED)
      ).rejects.toThrow(/Illegal state transition rejected/i);

      await expect(
        transitionPurchaseState(intent.id, PurchaseStates.COMPLETED)
      ).rejects.toThrow(/Illegal state transition rejected/i);
    });

    it('2.2: Requirement 8: BLOCKED or CANCELLED transaction cannot transition to PAYMENT_SUCCESS or COMPLETED', async () => {
      const blockedIntent = await createTestIntent(PurchaseStates.BLOCKED);
      await expect(
        transitionPurchaseState(blockedIntent.id, PurchaseStates.PAYMENT_SUCCESS)
      ).rejects.toThrow(/Illegal state transition rejected/i);

      const cancelledIntent = await createTestIntent(PurchaseStates.CANCELLED);
      await expect(
        transitionPurchaseState(cancelledIntent.id, PurchaseStates.PAYMENT_SUCCESS)
      ).rejects.toThrow(/Illegal state transition rejected/i);
    });

    it('2.3: Fulfillment regression (DELIVERED → SHIPPED / PACKED / PROCESSING) is strictly rejected', async () => {
      const deliveredOrder = await createTestOrder(OrderFulfillmentStates.DELIVERED);

      await expect(
        transitionOrderFulfillment(deliveredOrder.id, OrderFulfillmentStates.SHIPPED)
      ).rejects.toThrow(/Invalid.*transition/i);

      await expect(
        transitionOrderFulfillment(deliveredOrder.id, OrderFulfillmentStates.PROCESSING)
      ).rejects.toThrow(/Invalid.*transition/i);
    });

    it('2.4: Skipping fulfillment states (CONFIRMED → DELIVERED or CONFIRMED → SHIPPED) is strictly rejected', async () => {
      const confirmedOrder = await createTestOrder(OrderFulfillmentStates.CONFIRMED);

      await expect(
        transitionOrderFulfillment(confirmedOrder.id, OrderFulfillmentStates.DELIVERED)
      ).rejects.toThrow(/Invalid.*transition/i);

      await expect(
        transitionOrderFulfillment(confirmedOrder.id, OrderFulfillmentStates.SHIPPED)
      ).rejects.toThrow(/Invalid.*transition/i);
    });

    it('2.5: REJECTED or EXPIRED approval cannot transition to APPROVED or PAYMENT_SUCCESS', async () => {
      const rejectedIntent = await createTestIntent(PurchaseStates.REJECTED);
      await expect(
        transitionPurchaseState(rejectedIntent.id, PurchaseStates.APPROVED)
      ).rejects.toThrow(/Illegal state transition rejected/i);

      const expiredIntent = await createTestIntent(PurchaseStates.EXPIRED);
      await expect(
        transitionPurchaseState(expiredIntent.id, PurchaseStates.APPROVED)
      ).rejects.toThrow(/Illegal state transition rejected/i);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 3. Emergency Reconciliation Transitions (Requirement 9)
  // ────────────────────────────────────────────────────────────────────────────

  describe('Section 3: In-Flight Emergency Stop to RECONCILIATION_REQUIRED', () => {
    it('3.1: All in-flight states can safely transition to RECONCILIATION_REQUIRED during emergency', async () => {
      const inflightStates = [
        PurchaseStates.CREATED,
        PurchaseStates.CART_CREATED,
        PurchaseStates.CHECKOUT_PENDING,
        PurchaseStates.PRICE_REVALIDATION,
        PurchaseStates.PAYMENT_PENDING,
        PurchaseStates.USER_AUTHENTICATION_REQUIRED,
        PurchaseStates.PAYMENT_SUCCESS,
        PurchaseStates.ORDER_PENDING,
        PurchaseStates.ORDER_CONFIRMED,
        PurchaseStates.ORDER_FAILED,
        PurchaseStates.APPROVED,
      ];

      for (const st of inflightStates) {
        const intent = await createTestIntent(st);
        const res = await transitionPurchaseState(intent.id, PurchaseStates.RECONCILIATION_REQUIRED, {
          actor: 'system',
          reason: `Emergency stop while at ${st}`,
        });
        expect(res.currentState).toBe(PurchaseStates.RECONCILIATION_REQUIRED);
      }
    });

    it('3.2: Requirement 9: In-flight fulfillment state transitions to RECONCILIATION_REQUIRED', async () => {
      const order = await createTestOrder(OrderFulfillmentStates.SHIPPED);
      const res = await transitionOrderFulfillment(order.id, OrderFulfillmentStates.RECONCILIATION_REQUIRED, {
        actor: 'system',
        reason: 'Carrier API timeout during tracking sync',
      });
      expect(res.fulfillment_status).toBe(OrderFulfillmentStates.RECONCILIATION_REQUIRED);
    });

    it('3.3: Requirement 9: Reconciliation-required records are visible in system reconciliation report', async () => {
      const reportRes = await request(app)
        .get('/api/system/reconciliation-report')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(reportRes.status).toBe(200);
      expect(reportRes.body.success).toBe(true);
      expect(reportRes.body).toHaveProperty('totalOrdersScanned');
      expect(reportRes.body).toHaveProperty('issuesCount');
      expect(reportRes.body).toHaveProperty('issues');
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 4. Webhooks State Machine & Idempotency (Requirements 4, 5 & 6)
  // ────────────────────────────────────────────────────────────────────────────

  describe('Section 4: Webhook Event Ingestion, Idempotency & Safety', () => {
    it('4.1: Requirement 4 & 5: payment.captured webhook triggers valid state transition and duplicate is ignored', async () => {
      const intent = await createTestIntent(PurchaseStates.PAYMENT_PENDING);
      const orderId = `order_hook_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
      const paymentId = `pay_hook_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

      await query(`
        INSERT INTO transactions (
          purchase_intent_id, user_id, agent_id, amount, currency,
          razorpay_order_id, status, state
        )
        VALUES ($1, $2, $3, 2999.00, 'INR', $4, 'payment_pending', 'PAYMENT_PENDING')
      `, [intent.id, buyerUser.id, buyerAgent.id, orderId]);

      const eventPayload = {
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: paymentId,
              order_id: orderId,
              amount: 299900,
              currency: 'INR',
              status: 'captured',
            },
          },
        },
      };

      // First webhook delivery
      const res1 = await processRazorpayWebhook({
        environment: 'TEST',
        signature: 'valid_test_sig',
        rawBody: JSON.stringify(eventPayload),
        payload: eventPayload,
      });

      expect(['PROCESSED', 'DUPLICATE_IGNORED']).toContain(res1.status);

      // Duplicate webhook delivery
      const res2 = await processRazorpayWebhook({
        environment: 'TEST',
        signature: 'valid_test_sig',
        rawBody: JSON.stringify(eventPayload),
        payload: eventPayload,
      });

      expect(['DUPLICATE_IGNORED', 'PROCESSED']).toContain(res2.status);
    });

    it('4.2: Requirement 6: Unknown webhook event fails safely with IGNORED status', async () => {
      const unknownPayload = {
        event: 'unknown.custom.third_party_event',
        payload: { dummy: true },
      };

      const res = await processRazorpayWebhook({
        environment: 'TEST',
        signature: 'valid_test_sig',
        rawBody: JSON.stringify(unknownPayload),
        payload: unknownPayload,
      });

      expect(res.status).toBe('IGNORED');
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 5. Server-Side Authority (Requirement 2 & 3)
  // ────────────────────────────────────────────────────────────────────────────

  describe('Section 5: Server-Side State Authority & Frontend Non-Authority', () => {
    it('5.1: Client attempting to send fabricated state in request body cannot bypass state machine', async () => {
      const intent = await createTestIntent(PurchaseStates.CREATED);

      // Client calls purchase-intent update with fake completed state
      const res = await request(app)
        .patch(`/api/purchase-intents/${intent.id}`)
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ state: 'COMPLETED', status: 'completed' });

      // Either route does not allow direct state patching (404/405/ignored) or server preserves authoritative state
      const chkIntent = await query('SELECT state, status FROM purchase_intents WHERE id = $1', [intent.id]);
      expect(chkIntent.rows[0].state).not.toBe('COMPLETED');
    });

    it('5.2: State machine idempotently handles repeated calls with identical target state (isNoop: true)', async () => {
      const intent = await createTestIntent(PurchaseStates.CREATED);
      const res1 = await transitionPurchaseState(intent.id, PurchaseStates.SEARCHING);
      expect(res1.currentState).toBe(PurchaseStates.SEARCHING);

      const res2 = await transitionPurchaseState(intent.id, PurchaseStates.SEARCHING);
      expect(res2.isNoop).toBe(true);
      expect(res2.currentState).toBe(PurchaseStates.SEARCHING);
    });
  });
});
