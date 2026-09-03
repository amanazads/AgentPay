import request from 'supertest';
import app from '../src/index.js';
import { query } from '../src/config/database.js';
import { generateAccessToken, hashPassword } from '../src/utils/authUtils.js';
import { evaluatePurchaseIntent } from '../src/services/decisionEngine.js';
import { createPaymentOrder, verifyPayment } from '../src/services/paymentService.js';
import { processApproval } from '../src/services/approvalService.js';
import { generateQuote, verifyQuoteForCheckout } from '../src/services/quoteService.js';
import { PurchaseStates } from '../src/services/purchaseStateMachine.js';

describe('Global Emergency Kill Switch Financial Guard Audit', () => {
  let adminUser, adminToken;
  let buyerUser, buyerToken;
  let merchantUser, merchantToken;
  let merchantStore;
  let product;
  let buyerAgent;
  let buyerPolicy;

  beforeAll(async () => {
    const passHash = await hashPassword('password123');

    // 1. Admin
    const adminRes = await query(`
      INSERT INTO users (email, name, role, password_hash)
      VALUES ('ks_admin_${Date.now()}@test.com', 'Kill Switch Admin', 'ADMIN', $1)
      RETURNING *
    `, [passHash]);
    adminUser = adminRes.rows[0];
    adminToken = generateAccessToken(adminUser);

    // 2. Buyer
    const buyerRes = await query(`
      INSERT INTO users (email, name, role, password_hash)
      VALUES ('ks_buyer_${Date.now()}@test.com', 'Kill Switch Buyer', 'BUYER', $1)
      RETURNING *
    `, [passHash]);
    buyerUser = buyerRes.rows[0];
    buyerToken = generateAccessToken(buyerUser);

    await query(`
      INSERT INTO user_preferences (user_id, monthly_budget, auto_purchase_limit, categories)
      VALUES ($1, 100000, 20000, ARRAY['Electronics', 'Hardware'])
      ON CONFLICT (user_id) DO UPDATE SET monthly_budget = 100000, auto_purchase_limit = 20000
    `, [buyerUser.id]);

    // 3. Merchant
    const mRes = await query(`
      INSERT INTO merchants (name, category, is_verified, risk_level, rating, is_test_lab)
      VALUES ('Kill Switch Verified Store', 'Electronics', true, 'low', 4.9, false)
      RETURNING *
    `);
    merchantStore = mRes.rows[0];

    const mUserRes = await query(`
      INSERT INTO users (email, name, role, merchant_id, password_hash)
      VALUES ('ks_merchant_${Date.now()}@test.com', 'Store Merchant', 'MERCHANT', $1, $2)
      RETURNING *
    `, [merchantStore.id, passHash]);
    merchantUser = mUserRes.rows[0];
    merchantToken = generateAccessToken(merchantUser);

    // 4. Product
    const pRes = await query(`
      INSERT INTO products (
        merchant_id, sku, name, description, category, price, inventory, in_stock, commerce_eligible, is_test_lab
      )
      VALUES (
        $1, 'SKU-KS-PROD-01', 'Enterprise Smart Dock', 'Universal dual display dock', 'Electronics', 4999.00, 50, true, true, false
      )
      RETURNING *
    `, [merchantStore.id]);
    product = pRes.rows[0];

    // 5. Policy & Agent
    const polRes = await query(`
      INSERT INTO policies (name, version, daily_budget, max_transaction, approval_threshold, allowed_categories)
      VALUES ('Kill Switch Guard Policy', 'v1', 100000, 50000, 15000, ARRAY['electronics', 'hardware'])
      RETURNING *
    `);
    buyerPolicy = polRes.rows[0];

    const aRes = await query(`
      INSERT INTO agents (name, owner_id, policy_id, description, status)
      VALUES ('Kill Switch Test Agent', $1, $2, 'Testing emergency freeze', 'active')
      RETURNING *
    `, [buyerUser.id, buyerPolicy.id]);
    buyerAgent = aRes.rows[0];
  });

  beforeEach(async () => {
    // Ensure clean state before each test
    await query('UPDATE system_state SET kill_switch_active = false WHERE id = 1');
  });

  afterAll(async () => {
    // Restore kill switch to false
    await query('UPDATE system_state SET kill_switch_active = false WHERE id = 1');
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 1. Role Restrictions for Activating / Deactivating Kill Switch
  // ────────────────────────────────────────────────────────────────────────────

  describe('Requirement 6: Role Restrictions on Kill Switch Toggle', () => {
    it('6.1: ADMIN can activate and deactivate global kill switch', async () => {
      const activateRes = await request(app)
        .post('/api/system/kill-switch')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ active: true, reason: 'Security Drill' });

      expect(activateRes.status).toBe(200);
      expect(activateRes.body.killSwitchActive).toBe(true);

      const sysRes = await query('SELECT kill_switch_active, kill_switch_activated_by FROM system_state WHERE id = 1');
      expect(sysRes.rows[0].kill_switch_active).toBe(true);
      expect(sysRes.rows[0].kill_switch_activated_by).toBe(adminUser.id);

      const deactivateRes = await request(app)
        .post('/api/system/kill-switch')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ active: false, reason: 'Drill Ended' });

      expect(deactivateRes.status).toBe(200);
      expect(deactivateRes.body.killSwitchActive).toBe(false);
    });

    it('6.2: BUYER is strictly forbidden from toggling kill switch (403)', async () => {
      const res = await request(app)
        .post('/api/system/kill-switch')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ active: true });

      expect(res.status).toBe(403);
    });

    it('6.3: MERCHANT is strictly forbidden from toggling kill switch (403)', async () => {
      const res = await request(app)
        .post('/api/system/kill-switch')
        .set('Authorization', `Bearer ${merchantToken}`)
        .send({ active: true });

      expect(res.status).toBe(403);
    });

    it('6.4: Unauthenticated caller receives 401 Unauthorized', async () => {
      const res = await request(app)
        .post('/api/system/kill-switch')
        .send({ active: true });

      expect(res.status).toBe(401);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 2. Lifecycle Audit: Activation Across All Transaction Stages
  // ────────────────────────────────────────────────────────────────────────────

  describe('Requirement 2: Kill Switch Activation Across Transaction Stages', () => {
    it('2.1: Activated BEFORE policy evaluation -> Intent blocked immediately and audited', async () => {
      // Activate kill switch
      await query('UPDATE system_state SET kill_switch_active = true WHERE id = 1');

      const intentRes = await query(`
        INSERT INTO purchase_intents (
          agent_id, user_id, product_id, merchant_id, amount, quantity, status
        )
        VALUES ($1, $2, $3, $4, 4999.00, 1, 'pending')
        RETURNING *
      `, [buyerAgent.id, buyerUser.id, product.id, merchantStore.id]);
      const intent = intentRes.rows[0];

      const evaluation = await evaluatePurchaseIntent(intent.id);
      expect(evaluation.decision).toBe('BLOCK');
      expect(evaluation.rule).toBe('KILL_SWITCH_ACTIVE');

      const updatedIntent = await query('SELECT state, status FROM purchase_intents WHERE id = $1', [intent.id]);
      expect(updatedIntent.rows[0].state).toBe(PurchaseStates.BLOCKED);
      expect(updatedIntent.rows[0].status).toBe('blocked');
    });

    it('2.2: Activated AFTER policy evaluation (intent allowed) -> Payment order creation halted (503)', async () => {
      const intentRes = await query(`
        INSERT INTO purchase_intents (
          agent_id, user_id, product_id, merchant_id, amount, quantity, status, policy_decision
        )
        VALUES ($1, $2, $3, $4, 4999.00, 1, 'pending', 'ALLOW')
        RETURNING *
      `, [buyerAgent.id, buyerUser.id, product.id, merchantStore.id]);
      const intent = intentRes.rows[0];

      // Activate kill switch after evaluation
      await query('UPDATE system_state SET kill_switch_active = true WHERE id = 1');

      // Attempt to create payment order
      await expect(
        createPaymentOrder(intent.id)
      ).rejects.toThrow(/Emergency kill switch is active/i);

      // Verify no transaction record was created
      const txRes = await query('SELECT * FROM transactions WHERE purchase_intent_id = $1', [intent.id]);
      expect(txRes.rows.length).toBe(0);
    });

    it('2.3: Activated DURING approval workflow -> Approval execution halted (503)', async () => {
      const intentRes = await query(`
        INSERT INTO purchase_intents (
          agent_id, user_id, product_id, merchant_id, amount, quantity, status, policy_decision
        )
        VALUES ($1, $2, $3, $4, 25000.00, 1, 'approval_required', 'APPROVAL_REQUIRED')
        RETURNING *
      `, [buyerAgent.id, buyerUser.id, product.id, merchantStore.id]);
      const intent = intentRes.rows[0];

      const appRes = await query(`
        INSERT INTO approvals (purchase_intent_id, agent_id, status)
        VALUES ($1, $2, 'pending')
        RETURNING *
      `, [intent.id, buyerAgent.id]);
      const approval = appRes.rows[0];

      // Activate kill switch
      await query('UPDATE system_state SET kill_switch_active = true WHERE id = 1');

      // Attempt human approval
      await expect(
        processApproval({
          approvalId: approval.id,
          decision: 'APPROVE',
          reviewerId: buyerUser.id,
        })
      ).rejects.toThrow(/Emergency kill switch is active/i);

      // Approval remains pending, intent not advanced
      const chkApp = await query('SELECT status FROM approvals WHERE id = $1', [approval.id]);
      expect(chkApp.rows[0].status).toBe('pending');
    });

    it('2.4: Activated IMMEDIATELY BEFORE payment verification -> Payment verification halted', async () => {
      const uniqueOrderId = `order_ks_mock_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
      const intentRes = await query(`
        INSERT INTO purchase_intents (
          agent_id, user_id, product_id, merchant_id, amount, quantity, status, policy_decision
        )
        VALUES ($1, $2, $3, $4, 4999.00, 1, 'pending', 'ALLOW')
        RETURNING *
      `, [buyerAgent.id, buyerUser.id, product.id, merchantStore.id]);
      const intent = intentRes.rows[0];

      const txRes = await query(`
        INSERT INTO transactions (
          purchase_intent_id, user_id, agent_id, amount, currency,
          razorpay_order_id, status, state
        )
        VALUES ($1, $2, $3, 4999.00, 'INR', $4, 'payment_pending', 'PAYMENT_PENDING')
        RETURNING *
      `, [intent.id, buyerUser.id, buyerAgent.id, uniqueOrderId]);
      const tx = txRes.rows[0];

      // Activate kill switch
      await query('UPDATE system_state SET kill_switch_active = true WHERE id = 1');

      // Direct API verification attempt
      const res = await request(app)
        .post('/api/payments/verify')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({
          transaction_id: tx.id,
          razorpay_order_id: uniqueOrderId,
          razorpay_payment_id: `pay_ks_mock_${Date.now()}`,
          razorpay_signature: 'sig_mock',
        });

      expect(res.status).toBe(503);
    });

    it('2.5: Activated DURING an IN-FLIGHT transaction -> Transitions to RECONCILIATION_REQUIRED', async () => {
      const uniqueOrderId = `order_ks_inflight_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
      const intentRes = await query(`
        INSERT INTO purchase_intents (
          agent_id, user_id, product_id, merchant_id, amount, quantity, status, policy_decision
        )
        VALUES ($1, $2, $3, $4, 4999.00, 1, 'evaluating', 'ALLOW')
        RETURNING *
      `, [buyerAgent.id, buyerUser.id, product.id, merchantStore.id]);
      const intent = intentRes.rows[0];

      const txRes = await query(`
        INSERT INTO transactions (
          purchase_intent_id, user_id, agent_id, amount, currency,
          razorpay_order_id, status, state
        )
        VALUES ($1, $2, $3, 4999.00, 'INR', $4, 'payment_pending', 'PAYMENT_PENDING')
        RETURNING *
      `, [intent.id, buyerUser.id, buyerAgent.id, uniqueOrderId]);
      const tx = txRes.rows[0];

      // Activate kill switch while verification is being processed
      await query('UPDATE system_state SET kill_switch_active = true WHERE id = 1');

      try {
        await verifyPayment({
          transactionId: tx.id,
          razorpayOrderId: uniqueOrderId,
          razorpayPaymentId: `pay_ks_inflight_${Date.now()}`,
          razorpaySignature: 'mock_sig',
        });
      } catch (err) {
        expect(err.status).toBe(503);
        expect(err.message).toContain('Emergency kill switch is active');
      }

      // Check that in-flight transaction transitioned to RECONCILIATION_REQUIRED
      const updatedTx = await query('SELECT state, status FROM transactions WHERE id = $1', [tx.id]);
      expect(updatedTx.rows[0].state).toBe('RECONCILIATION_REQUIRED');

      const updatedIntent = await query('SELECT state FROM purchase_intents WHERE id = $1', [intent.id]);
      expect(updatedIntent.rows[0].state).toBe('RECONCILIATION_REQUIRED');

      // Verify audit event KILL_SWITCH_IN_FLIGHT_HELD was recorded
      const auditRes = await query(`
        SELECT * FROM audit_events 
        WHERE transaction_id = $1 AND event_type = 'KILL_SWITCH_IN_FLIGHT_HELD'
      `, [tx.id]);
      expect(auditRes.rows.length).toBe(1);
      expect(auditRes.rows[0].decision).toBe('HOLD');
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 3. AI, Frontend & Direct API Bypass Resistance
  // ────────────────────────────────────────────────────────────────────────────

  describe('Requirements 1, 3, 4 & 5: Universal Bypass Resistance & Inventory Safety', () => {
    it('3.1: AI chat cannot execute purchases when kill switch is active', async () => {
      await query('UPDATE system_state SET kill_switch_active = true WHERE id = 1');

      const res = await request(app)
        .post('/api/ai/chat')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ message: `Buy ${product.name}`, agent_id: buyerAgent.id });

      expect(res.status).toBe(200);
      if (res.body.status === 'MATCH_FOUND') {
        expect(res.body.execution_status).toBe('BLOCKED');
        expect(res.body.authorization_status.state).toBe('BLOCK');
      } else {
        expect(res.body.status).toBe('NO_MATCH');
      }

      // Ensure no completed orders were generated
      const ordersRes = await query(`
        SELECT * FROM orders 
        WHERE user_id = $1 AND product_id = $2
      `, [buyerUser.id, product.id]);
      expect(ordersRes.rows.length).toBe(0);
    });

    it('3.2: Direct API call to create payment order is rejected with 503', async () => {
      const intentRes = await query(`
        INSERT INTO purchase_intents (
          agent_id, user_id, product_id, merchant_id, amount, quantity, status, policy_decision
        )
        VALUES ($1, $2, $3, $4, 4999.00, 1, 'pending', 'ALLOW')
        RETURNING *
      `, [buyerAgent.id, buyerUser.id, product.id, merchantStore.id]);
      const intent = intentRes.rows[0];

      await query('UPDATE system_state SET kill_switch_active = true WHERE id = 1');

      const res = await request(app)
        .post('/api/payments/create')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ purchase_intent_id: intent.id });

      expect(res.status).toBe(503);
      expect(res.body.message || res.body.error).toContain('Emergency kill switch is active');
    });

    it('3.3: Direct API call to checkout endpoint (/api/ai/checkout) is rejected', async () => {
      await query('UPDATE system_state SET kill_switch_active = true WHERE id = 1');

      const res = await request(app)
        .post('/api/ai/checkout')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ productId: product.id, quantity: 1 });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('KILL_SWITCH_ACTIVE');
    });

    it('3.4: Quote generation rejects when kill switch is active and holds 0 locked inventory', async () => {
      await query('UPDATE system_state SET kill_switch_active = true WHERE id = 1');

      await expect(
        generateQuote({
          productId: product.id,
          quantity: 1,
          userId: buyerUser.id,
          agentId: buyerAgent.id,
        })
      ).rejects.toThrow(/Emergency kill switch is active/i);

      // Verify product inventory in database was NOT decremented or locked
      const prodRes = await query('SELECT inventory FROM products WHERE id = $1', [product.id]);
      expect(prodRes.rows[0].inventory).toBe(50);
    });

    it('3.5: Kill switch state persistence survives across system reads', async () => {
      await query('UPDATE system_state SET kill_switch_active = true WHERE id = 1');

      const res1 = await query('SELECT kill_switch_active FROM system_state WHERE id = 1');
      expect(res1.rows[0].kill_switch_active).toBe(true);

      const statusRes = await request(app).get('/api/system/status');
      expect(statusRes.status).toBe(200);
      expect(statusRes.body.killSwitchActive).toBe(true);
    });
  });
});
