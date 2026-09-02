import { jest } from '@jest/globals';
import request from 'supertest';
import { app } from '../src/index.js';
import { query } from '../src/config/database.js';
import { generateAccessToken } from '../src/utils/authUtils.js';
import { evaluatePurchaseIntent } from '../src/services/decisionEngine.js';
import { processApproval, getApprovalsList } from '../src/services/approvalService.js';
import { createPaymentOrder } from '../src/services/paymentService.js';

jest.setTimeout(30000);

describe('Track 05: Human Approval Workflow Security & Audit Suite', () => {
  let buyerA, buyerAToken;
  let buyerB, buyerBToken;
  let adminUser, adminToken;
  let testMerchantId;
  let testPolicyId;
  let testAgent;

  beforeAll(async () => {
    // 1. Create Buyer A
    const uARes = await query(`
      INSERT INTO users (email, name, role)
      VALUES ('buyer_a_' || floor(random()*1000000) || '@agentpay.com', 'Buyer Alpha', 'BUYER')
      RETURNING *
    `);
    buyerA = uARes.rows[0];
    buyerAToken = generateAccessToken(buyerA);

    await query(`
      INSERT INTO user_preferences (user_id, monthly_budget, auto_purchase_limit, categories, purchase_behavior)
      VALUES ($1, 100000, 20000, ARRAY['Electronics', 'Peripherals'], 'auto_within_limit')
      ON CONFLICT (user_id) DO UPDATE SET
        monthly_budget = 100000,
        auto_purchase_limit = 20000,
        purchase_behavior = 'auto_within_limit'
    `, [buyerA.id]);

    // 2. Create Buyer B (Attacker / Unauthorized Reviewer)
    const uBRes = await query(`
      INSERT INTO users (email, name, role)
      VALUES ('buyer_b_' || floor(random()*1000000) || '@agentpay.com', 'Buyer Beta', 'BUYER')
      RETURNING *
    `);
    buyerB = uBRes.rows[0];
    buyerBToken = generateAccessToken(buyerB);

    // 3. Create Admin User
    const adminRes = await query(`
      INSERT INTO users (email, name, role)
      VALUES ('admin_reviewer_' || floor(random()*1000000) || '@agentpay.com', 'Admin Supervisor', 'ADMIN')
      RETURNING *
    `);
    adminUser = adminRes.rows[0];
    adminToken = generateAccessToken(adminUser);

    // 4. Create Verified Merchant
    const mRes = await query(`
      INSERT INTO merchants (name, category, description, is_verified, rating, tier)
      VALUES ('Approval Store ' || floor(random()*100000), 'Electronics', 'Verified Store for Approvals', true, 4.9, 'tier_1')
      RETURNING id
    `);
    testMerchantId = mRes.rows[0].id;

    // 5. Create Policy & Agent
    const polRes = await query(`
      INSERT INTO policies (name, version, daily_budget, max_transaction, approval_threshold, allowed_categories, blocked_categories, max_retries, price_tolerance_pct, verified_merchants_only)
      VALUES ('Approval Policy v2', 'v2', 100000, 100000, 20000, ARRAY['Electronics', 'Peripherals'], ARRAY['Gambling'], 1, 2.0, true)
      RETURNING id
    `);
    testPolicyId = polRes.rows[0].id;

    const aRes = await query(`
      INSERT INTO agents (owner_id, name, description, policy_id, status)
      VALUES ($1, 'Executive Procurement Bot', 'Agent for Approval Audit', $2, 'active')
      RETURNING *
    `, [buyerA.id, testPolicyId]);
    testAgent = aRes.rows[0];
  });

  afterAll(async () => {
    const userIds = [buyerA?.id, buyerB?.id, adminUser?.id].filter(Boolean);
    if (userIds.length > 0) {
      await query('DELETE FROM in_app_notifications WHERE user_id = ANY($1)', [userIds]);
      await query('DELETE FROM invoices WHERE order_id IN (SELECT id FROM orders WHERE purchase_intent_id IN (SELECT id FROM purchase_intents WHERE user_id = ANY($1)))', [userIds]);
      await query('DELETE FROM orders WHERE purchase_intent_id IN (SELECT id FROM purchase_intents WHERE user_id = ANY($1))', [userIds]);
      await query('DELETE FROM transactions WHERE purchase_intent_id IN (SELECT id FROM purchase_intents WHERE user_id = ANY($1)) OR user_id = ANY($1)', [userIds]);
      await query('DELETE FROM inventory_reservations WHERE quote_id IN (SELECT quote_id FROM purchase_intents WHERE user_id = ANY($1))', [userIds]);
      await query('DELETE FROM approvals WHERE purchase_intent_id IN (SELECT id FROM purchase_intents WHERE user_id = ANY($1))', [userIds]);
      await query('DELETE FROM purchase_intents WHERE user_id = ANY($1)', [userIds]);
      await query('DELETE FROM user_preferences WHERE user_id = ANY($1)', [userIds]);
      await query('DELETE FROM agents WHERE owner_id = ANY($1)', [userIds]);
      await query('DELETE FROM policies WHERE id = $1', [testPolicyId]);
      await query('DELETE FROM users WHERE id = ANY($1)', [userIds]);
      await query('DELETE FROM products WHERE merchant_id = $1', [testMerchantId]);
      await query('DELETE FROM merchants WHERE id = $1', [testMerchantId]);
    }
  });

  // ── TEST 1: Valid Approval Flow with Payment Order Generation ───────────────
  it('TEST 1: Authorized buyer successfully approves pending intent, generating payment order and audit trail', async () => {
    const pRes = await query(`
      INSERT INTO products (merchant_id, sku, name, description, category, price, inventory, in_stock)
      VALUES ($1, $2, 'Ultra High-End Workstation', 'Multi-GPU workstation', 'Electronics', 35000, 10, true)
      RETURNING *
    `, [testMerchantId, `SKU-WKS-${Date.now()}`]);
    const product = pRes.rows[0];

    try {
      const intentRes = await query(`
        INSERT INTO purchase_intents (agent_id, user_id, product_id, merchant_id, amount, quantity, status, state)
        VALUES ($1, $2, $3, $4, 35000.00, 1, 'pending', 'CREATED')
        RETURNING *
      `, [testAgent.id, buyerA.id, product.id, testMerchantId]);
      const intent = intentRes.rows[0];

      // Evaluate -> Exceeds 20,000 threshold -> APPROVAL_REQUIRED
      const decisionRes = await evaluatePurchaseIntent(intent.id);
      expect(decisionRes.decision).toBe('APPROVAL_REQUIRED');

      const appRes = await query('SELECT * FROM approvals WHERE purchase_intent_id = $1', [intent.id]);
      expect(appRes.rows.length).toBe(1);
      const approval = appRes.rows[0];
      expect(approval.status).toBe('pending');
      expect(parseFloat(approval.quoted_price)).toBe(35000);

      // Authorized Buyer A approves
      const res = await request(app)
        .post(`/api/approvals/${approval.id}/approve`)
        .set('Authorization', `Bearer ${buyerAToken}`)
        .send({ notes: 'Approved for engineering workstation', auto_create_payment: true });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('approved');
      expect(res.body.decision).toBe('APPROVE');

      // Verify intent state transitioned
      const checkIntent = (await query('SELECT status, state FROM purchase_intents WHERE id = $1', [intent.id])).rows[0];
      expect(['approved', 'completed', 'payment_completed']).toContain(checkIntent.status);

      // Verify audit trail has HUMAN_APPROVAL_GRANTED
      const auditRes = await query(`
        SELECT * FROM audit_events 
        WHERE purchase_intent_id = $1 AND event_type = 'HUMAN_APPROVAL_GRANTED'
      `, [intent.id]);
      expect(auditRes.rows.length).toBeGreaterThan(0);
      expect(auditRes.rows[0].decision).toBe('ALLOW');
    } finally {
      await query('DELETE FROM invoices WHERE order_id IN (SELECT id FROM orders WHERE purchase_intent_id IN (SELECT id FROM purchase_intents WHERE product_id = $1))', [product.id]);
      await query('DELETE FROM orders WHERE purchase_intent_id IN (SELECT id FROM purchase_intents WHERE product_id = $1)', [product.id]);
      await query('DELETE FROM transactions WHERE purchase_intent_id IN (SELECT id FROM purchase_intents WHERE product_id = $1)', [product.id]);
      await query('DELETE FROM approvals WHERE purchase_intent_id IN (SELECT id FROM purchase_intents WHERE product_id = $1)', [product.id]);
      await query('DELETE FROM purchase_intents WHERE product_id = $1', [product.id]);
      await query('DELETE FROM products WHERE id = $1', [product.id]);
    }
  });

  // ── TEST 2: Expired Approval Rejected Fail-Closed ───────────────────────────
  it('TEST 2: Approval past expiration timestamp cannot be approved and fails closed', async () => {
    const pRes = await query(`
      INSERT INTO products (merchant_id, sku, name, description, category, price, inventory, in_stock)
      VALUES ($1, $2, 'Time-Sensitive Server Rack', '42U Server Rack', 'Electronics', 28000, 5, true)
      RETURNING *
    `, [testMerchantId, `SKU-RCK-${Date.now()}`]);
    const product = pRes.rows[0];

    try {
      const intentRes = await query(`
        INSERT INTO purchase_intents (agent_id, user_id, product_id, merchant_id, amount, quantity, status, state)
        VALUES ($1, $2, $3, $4, 28000.00, 1, 'approval_required', 'AWAITING_APPROVAL')
        RETURNING *
      `, [testAgent.id, buyerA.id, product.id, testMerchantId]);
      const intent = intentRes.rows[0];

      // Approval created with expired timestamp (1 hour ago)
      const pastTime = new Date(Date.now() - 3600000).toISOString();
      const appRes = await query(`
        INSERT INTO approvals (
          purchase_intent_id, agent_id, user_id, product_id, merchant_id,
          quantity, quoted_price, current_price, risk_score, policy_version,
          status, expires_at
        )
        VALUES ($1, $2, $3, $4, $5, 1, 28000, 28000, 15, 'v2', 'pending', $6)
        RETURNING *
      `, [intent.id, testAgent.id, buyerA.id, product.id, testMerchantId, pastTime]);
      const approval = appRes.rows[0];

      // Attempt to approve expired request
      const res = await request(app)
        .post(`/api/approvals/${approval.id}/approve`)
        .set('Authorization', `Bearer ${buyerAToken}`)
        .send({ notes: 'Attempting to approve stale request' });

      expect([410, 400, 409]).toContain(res.status);

      // Verify approval marked expired in DB
      const checkApp = (await query('SELECT status, decision FROM approvals WHERE id = $1', [approval.id])).rows[0];
      expect(checkApp.status).toBe('expired');

      // Verify audit event recorded
      const auditRes = await query('SELECT * FROM audit_events WHERE purchase_intent_id = $1 AND event_type = \'APPROVAL_EXPIRED\'', [intent.id]);
      expect(auditRes.rows.length).toBeGreaterThan(0);
    } finally {
      await query('DELETE FROM approvals WHERE purchase_intent_id IN (SELECT id FROM purchase_intents WHERE product_id = $1)', [product.id]);
      await query('DELETE FROM purchase_intents WHERE product_id = $1', [product.id]);
      await query('DELETE FROM products WHERE id = $1', [product.id]);
    }
  });

  // ── TEST 3: Unauthorized Reviewer Rejected with HTTP 403 ───────────────────
  it('TEST 3: Unauthorized reviewer (Buyer B) attempting to decide Buyer A approval is rejected with 403 Forbidden', async () => {
    const pRes = await query(`
      INSERT INTO products (merchant_id, sku, name, description, category, price, inventory, in_stock)
      VALUES ($1, $2, 'Executive Tablet Pro', 'OLED Tablet', 'Electronics', 24000, 10, true)
      RETURNING *
    `, [testMerchantId, `SKU-TAB-${Date.now()}`]);
    const product = pRes.rows[0];

    try {
      const intentRes = await query(`
        INSERT INTO purchase_intents (agent_id, user_id, product_id, merchant_id, amount, quantity, status, state)
        VALUES ($1, $2, $3, $4, 24000.00, 1, 'approval_required', 'AWAITING_APPROVAL')
        RETURNING *
      `, [testAgent.id, buyerA.id, product.id, testMerchantId]);
      const intent = intentRes.rows[0];

      const expiresAt = new Date(Date.now() + 3600000).toISOString();
      const appRes = await query(`
        INSERT INTO approvals (
          purchase_intent_id, agent_id, user_id, product_id, merchant_id,
          quantity, quoted_price, current_price, risk_score, policy_version,
          status, expires_at
        )
        VALUES ($1, $2, $3, $4, $5, 1, 24000, 24000, 10, 'v2', 'pending', $6)
        RETURNING *
      `, [intent.id, testAgent.id, buyerA.id, product.id, testMerchantId, expiresAt]);
      const approval = appRes.rows[0];

      // Buyer B tries to approve Buyer A's purchase
      const res = await request(app)
        .post(`/api/approvals/${approval.id}/approve`)
        .set('Authorization', `Bearer ${buyerBToken}`)
        .send({ notes: 'Malicious unauthorized approval attempt' });

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/unauthorized/i);

      // Verify approval remains pending
      const checkApp = (await query('SELECT status FROM approvals WHERE id = $1', [approval.id])).rows[0];
      expect(checkApp.status).toBe('pending');
    } finally {
      await query('DELETE FROM approvals WHERE purchase_intent_id IN (SELECT id FROM purchase_intents WHERE product_id = $1)', [product.id]);
      await query('DELETE FROM purchase_intents WHERE product_id = $1', [product.id]);
      await query('DELETE FROM products WHERE id = $1', [product.id]);
    }
  });

  // ── TEST 4: Supervisor / Admin Approval Permitted ───────────────────────────
  it('TEST 4: Admin / Supervisor can authorize approval requests on behalf of buyers', async () => {
    const pRes = await query(`
      INSERT INTO products (merchant_id, sku, name, description, category, price, inventory, in_stock)
      VALUES ($1, $2, 'Conference Room Display', '75-inch 4K Interactive', 'Peripherals', 65000, 4, true)
      RETURNING *
    `, [testMerchantId, `SKU-CONF-${Date.now()}`]);
    const product = pRes.rows[0];

    try {
      const intentRes = await query(`
        INSERT INTO purchase_intents (agent_id, user_id, product_id, merchant_id, amount, quantity, status, state)
        VALUES ($1, $2, $3, $4, 65000.00, 1, 'approval_required', 'AWAITING_APPROVAL')
        RETURNING *
      `, [testAgent.id, buyerA.id, product.id, testMerchantId]);
      const intent = intentRes.rows[0];

      const expiresAt = new Date(Date.now() + 3600000).toISOString();
      const appRes = await query(`
        INSERT INTO approvals (
          purchase_intent_id, agent_id, user_id, product_id, merchant_id,
          quantity, quoted_price, current_price, risk_score, policy_version,
          status, expires_at
        )
        VALUES ($1, $2, $3, $4, $5, 1, 65000, 65000, 20, 'v2', 'pending', $6)
        RETURNING *
      `, [intent.id, testAgent.id, buyerA.id, product.id, testMerchantId, expiresAt]);
      const approval = appRes.rows[0];

      // Admin approves
      const res = await request(app)
        .post(`/api/approvals/${approval.id}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ notes: 'Authorized by Executive Admin', auto_create_payment: false });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('approved');

      // Verify reviewer_id recorded in approvals table
      const checkApp = (await query('SELECT reviewer_id, status FROM approvals WHERE id = $1', [approval.id])).rows[0];
      expect(checkApp.status).toBe('approved');
      expect(checkApp.reviewer_id).toBe(adminUser.id);
    } finally {
      await query('DELETE FROM approvals WHERE purchase_intent_id IN (SELECT id FROM purchase_intents WHERE product_id = $1)', [product.id]);
      await query('DELETE FROM purchase_intents WHERE product_id = $1', [product.id]);
      await query('DELETE FROM products WHERE id = $1', [product.id]);
    }
  });

  // ── TEST 5: Client-Modified Amount Ignored / Blocked ────────────────────────
  it('TEST 5: Client attempting to submit modified amount during approval cannot tamper with authoritative server pricing', async () => {
    const pRes = await query(`
      INSERT INTO products (merchant_id, sku, name, description, category, price, inventory, in_stock)
      VALUES ($1, $2, 'Smart Video Bar Pro', 'Integrated Sound & Camera', 'Peripherals', 32000, 8, true)
      RETURNING *
    `, [testMerchantId, `SKU-VBAR-${Date.now()}`]);
    const product = pRes.rows[0];

    try {
      const intentRes = await query(`
        INSERT INTO purchase_intents (agent_id, user_id, product_id, merchant_id, amount, quantity, status, state)
        VALUES ($1, $2, $3, $4, 32000.00, 1, 'approval_required', 'AWAITING_APPROVAL')
        RETURNING *
      `, [testAgent.id, buyerA.id, product.id, testMerchantId]);
      const intent = intentRes.rows[0];

      const expiresAt = new Date(Date.now() + 3600000).toISOString();
      const appRes = await query(`
        INSERT INTO approvals (
          purchase_intent_id, agent_id, user_id, product_id, merchant_id,
          quantity, quoted_price, current_price, risk_score, policy_version,
          status, expires_at
        )
        VALUES ($1, $2, $3, $4, $5, 1, 32000, 32000, 10, 'v2', 'pending', $6)
        RETURNING *
      `, [intent.id, testAgent.id, buyerA.id, product.id, testMerchantId, expiresAt]);
      const approval = appRes.rows[0];

      // Client passes fake amount in body: ₹100
      const res = await request(app)
        .post(`/api/approvals/${approval.id}/approve`)
        .set('Authorization', `Bearer ${buyerAToken}`)
        .send({ amount: 100, notes: 'Tampered amount payload', auto_create_payment: false });

      expect(res.status).toBe(200);

      // Verify intent amount in DB remained ₹32,000, never changed to ₹100
      const checkIntent = (await query('SELECT amount FROM purchase_intents WHERE id = $1', [intent.id])).rows[0];
      expect(parseFloat(checkIntent.amount)).toBe(32000);
    } finally {
      await query('DELETE FROM approvals WHERE purchase_intent_id IN (SELECT id FROM purchase_intents WHERE product_id = $1)', [product.id]);
      await query('DELETE FROM purchase_intents WHERE product_id = $1', [product.id]);
      await query('DELETE FROM products WHERE id = $1', [product.id]);
    }
  });

  // ── TEST 6: Reused Approval / Modified Product ID Rejected at Payment ───────
  it('TEST 6: Approval snapshot bound to Product A cannot be used to execute payment for Product B', async () => {
    const p1 = await query(`
      INSERT INTO products (merchant_id, sku, name, description, category, price, inventory, in_stock)
      VALUES ($1, $2, 'Original Approved Item A', 'Authorized Item', 'Electronics', 25000, 5, true)
      RETURNING *
    `, [testMerchantId, `SKU-P1-${Date.now()}`]);
    const productA = p1.rows[0];

    const p2 = await query(`
      INSERT INTO products (merchant_id, sku, name, description, category, price, inventory, in_stock)
      VALUES ($1, $2, 'Swapped High-End Item B', 'Unauthorized Swap', 'Electronics', 25000, 5, true)
      RETURNING *
    `, [testMerchantId, `SKU-P2-${Date.now()}`]);
    const productB = p2.rows[0];

    try {
      const intentRes = await query(`
        INSERT INTO purchase_intents (agent_id, user_id, product_id, merchant_id, amount, quantity, status, state)
        VALUES ($1, $2, $3, $4, 25000.00, 1, 'approved', 'APPROVED')
        RETURNING *
      `, [testAgent.id, buyerA.id, productB.id, testMerchantId]); // Intent has productB
      const intent = intentRes.rows[0];

      // Approval record in DB was tied to productA
      await query(`
        INSERT INTO approvals (
          purchase_intent_id, agent_id, user_id, product_id, merchant_id,
          quantity, quoted_price, current_price, risk_score, policy_version,
          status, decision, expires_at
        )
        VALUES ($1, $2, $3, $4, $5, 1, 25000, 25000, 10, 'v2', 'approved', 'APPROVE', NOW() + INTERVAL '1 hour')
      `, [intent.id, testAgent.id, buyerA.id, productA.id, testMerchantId]);

      // Attempt payment order creation
      await expect(createPaymentOrder(intent.id)).rejects.toThrow(/Security Violation: Approval record is bound to a different product ID/i);
    } finally {
      await query('DELETE FROM approvals WHERE purchase_intent_id IN (SELECT id FROM purchase_intents WHERE product_id IN ($1, $2))', [productA.id, productB.id]);
      await query('DELETE FROM purchase_intents WHERE product_id IN ($1, $2)', [productA.id, productB.id]);
      await query('DELETE FROM products WHERE id IN ($1, $2)', [productA.id, productB.id]);
    }
  });

  // ── TEST 7: Duplicate Approval Decision Rejected with HTTP 409 ──────────────
  it('TEST 7: Concurrent or repeated approval decisions on already-decided request return 409 Conflict', async () => {
    const pRes = await query(`
      INSERT INTO products (merchant_id, sku, name, description, category, price, inventory, in_stock)
      VALUES ($1, $2, 'Conference Microphone Array', 'Ceiling mic array', 'Peripherals', 29000, 6, true)
      RETURNING *
    `, [testMerchantId, `SKU-MIC-${Date.now()}`]);
    const product = pRes.rows[0];

    try {
      const intentRes = await query(`
        INSERT INTO purchase_intents (agent_id, user_id, product_id, merchant_id, amount, quantity, status, state)
        VALUES ($1, $2, $3, $4, 29000.00, 1, 'approval_required', 'AWAITING_APPROVAL')
        RETURNING *
      `, [testAgent.id, buyerA.id, product.id, testMerchantId]);
      const intent = intentRes.rows[0];

      const expiresAt = new Date(Date.now() + 3600000).toISOString();
      const appRes = await query(`
        INSERT INTO approvals (
          purchase_intent_id, agent_id, user_id, product_id, merchant_id,
          quantity, quoted_price, current_price, risk_score, policy_version,
          status, expires_at
        )
        VALUES ($1, $2, $3, $4, $5, 1, 29000, 29000, 10, 'v2', 'pending', $6)
        RETURNING *
      `, [intent.id, testAgent.id, buyerA.id, product.id, testMerchantId, expiresAt]);
      const approval = appRes.rows[0];

      // First decision: approve
      const res1 = await request(app)
        .post(`/api/approvals/${approval.id}/approve`)
        .set('Authorization', `Bearer ${buyerAToken}`)
        .send({ notes: 'First decision', auto_create_payment: false });
      expect(res1.status).toBe(200);

      // Second decision: reject on same approval
      const res2 = await request(app)
        .post(`/api/approvals/${approval.id}/reject`)
        .set('Authorization', `Bearer ${buyerAToken}`)
        .send({ notes: 'Second conflicting decision' });
      expect(res2.status).toBe(409);
      expect(res2.body.error).toMatch(/already processed/i);
    } finally {
      await query('DELETE FROM invoices WHERE order_id IN (SELECT id FROM orders WHERE purchase_intent_id IN (SELECT id FROM purchase_intents WHERE product_id = $1))', [product.id]);
      await query('DELETE FROM orders WHERE purchase_intent_id IN (SELECT id FROM purchase_intents WHERE product_id = $1)', [product.id]);
      await query('DELETE FROM transactions WHERE purchase_intent_id IN (SELECT id FROM purchase_intents WHERE product_id = $1)', [product.id]);
      await query('DELETE FROM approvals WHERE purchase_intent_id IN (SELECT id FROM purchase_intents WHERE product_id = $1)', [product.id]);
      await query('DELETE FROM purchase_intents WHERE product_id = $1', [product.id]);
      await query('DELETE FROM products WHERE id = $1', [product.id]);
    }
  });

  // ── TEST 8: Price Change After Approval Forces Re-Evaluation ────────────────
  it('TEST 8: Catalog price surge after approval request invalidates approval and forces re-evaluation', async () => {
    const pRes = await query(`
      INSERT INTO products (merchant_id, sku, name, description, category, price, inventory, in_stock)
      VALUES ($1, $2, 'Dynamic Price Asset', 'Volatile price device', 'Electronics', 22000, 10, true)
      RETURNING *
    `, [testMerchantId, `SKU-DPA-${Date.now()}`]);
    const product = pRes.rows[0];

    try {
      const intentRes = await query(`
        INSERT INTO purchase_intents (agent_id, user_id, product_id, merchant_id, amount, quantity, status, state)
        VALUES ($1, $2, $3, $4, 22000.00, 1, 'approval_required', 'AWAITING_APPROVAL')
        RETURNING *
      `, [testAgent.id, buyerA.id, product.id, testMerchantId]);
      const intent = intentRes.rows[0];

      const expiresAt = new Date(Date.now() + 3600000).toISOString();
      const appRes = await query(`
        INSERT INTO approvals (
          purchase_intent_id, agent_id, user_id, product_id, merchant_id,
          quantity, quoted_price, current_price, risk_score, policy_version,
          status, expires_at
        )
        VALUES ($1, $2, $3, $4, $5, 1, 22000, 22000, 10, 'v2', 'pending', $6)
        RETURNING *
      `, [intent.id, testAgent.id, buyerA.id, product.id, testMerchantId, expiresAt]);
      const approval = appRes.rows[0];

      // Merchant raises price in live catalog from 22,000 to 32,000
      await query('UPDATE products SET price = 32000 WHERE id = $1', [product.id]);

      // Buyer attempts to approve based on old price of 22,000
      const res = await request(app)
        .post(`/api/approvals/${approval.id}/approve`)
        .set('Authorization', `Bearer ${buyerAToken}`)
        .send({ notes: 'Approving at old price' });

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/price (changed|increased)/i);

      // Verify audit event recorded
      const auditRes = await query('SELECT * FROM audit_events WHERE purchase_intent_id = $1 AND event_type = \'APPROVAL_INVALIDATED_PRICE_CHANGED\'', [intent.id]);
      expect(auditRes.rows.length).toBeGreaterThan(0);
    } finally {
      await query('DELETE FROM approvals WHERE purchase_intent_id IN (SELECT id FROM purchase_intents WHERE product_id = $1)', [product.id]);
      await query('DELETE FROM purchase_intents WHERE product_id = $1', [product.id]);
      await query('DELETE FROM products WHERE id = $1', [product.id]);
    }
  });

  // ── TEST 9: Inventory Becoming Unavailable Post-Approval Aborts Payment ─────
  it('TEST 9: Inventory dropping to 0 after approval aborts payment creation fail-closed', async () => {
    const pRes = await query(`
      INSERT INTO products (merchant_id, sku, name, description, category, price, inventory, in_stock)
      VALUES ($1, $2, 'Limited Edition Smart Device', 'Collector Unit', 'Electronics', 26000, 1, true)
      RETURNING *
    `, [testMerchantId, `SKU-LTD-${Date.now()}`]);
    const product = pRes.rows[0];

    try {
      const intentRes = await query(`
        INSERT INTO purchase_intents (agent_id, user_id, product_id, merchant_id, amount, quantity, status, state)
        VALUES ($1, $2, $3, $4, 26000.00, 1, 'approved', 'APPROVED')
        RETURNING *
      `, [testAgent.id, buyerA.id, product.id, testMerchantId]);
      const intent = intentRes.rows[0];

      await query(`
        INSERT INTO approvals (
          purchase_intent_id, agent_id, user_id, product_id, merchant_id,
          quantity, quoted_price, current_price, risk_score, policy_version,
          status, decision, expires_at
        )
        VALUES ($1, $2, $3, $4, $5, 1, 26000, 26000, 10, 'v2', 'approved', 'APPROVE', NOW() + INTERVAL '1 hour')
      `, [intent.id, testAgent.id, buyerA.id, product.id, testMerchantId]);

      // Product sells out before payment
      await query('UPDATE products SET inventory = 0, in_stock = false WHERE id = $1', [product.id]);

      // Attempt to create payment order
      await expect(createPaymentOrder(intent.id)).rejects.toThrow(/Inventory unavailable|out of stock/i);

      // Verify audit event recorded
      const auditRes = await query('SELECT * FROM audit_events WHERE purchase_intent_id = $1 AND event_type = \'INVENTORY_UNAVAILABLE_POST_APPROVAL\'', [intent.id]);
      expect(auditRes.rows.length).toBeGreaterThan(0);
    } finally {
      await query('DELETE FROM approvals WHERE purchase_intent_id IN (SELECT id FROM purchase_intents WHERE product_id = $1)', [product.id]);
      await query('DELETE FROM purchase_intents WHERE product_id = $1', [product.id]);
      await query('DELETE FROM products WHERE id = $1', [product.id]);
    }
  });

  // ── TEST 10: Complete Audit Ledger Persistence Across Life Cycle ────────────
  it('TEST 10: Every approval lifecycle event is immutably persisted in audit_events ledger', async () => {
    const pRes = await query(`
      INSERT INTO products (merchant_id, sku, name, description, category, price, inventory, in_stock)
      VALUES ($1, $2, 'Audit Test System', 'Audited Hardware Unit', 'Electronics', 30000, 10, true)
      RETURNING *
    `, [testMerchantId, `SKU-AUD-${Date.now()}`]);
    const product = pRes.rows[0];

    try {
      const intentRes = await query(`
        INSERT INTO purchase_intents (agent_id, user_id, product_id, merchant_id, amount, quantity, status, state)
        VALUES ($1, $2, $3, $4, 30000.00, 1, 'pending', 'CREATED')
        RETURNING *
      `, [testAgent.id, buyerA.id, product.id, testMerchantId]);
      const intent = intentRes.rows[0];

      // 1. Evaluate (triggers HUMAN_APPROVAL_REQUESTED)
      await evaluatePurchaseIntent(intent.id);
      const approvalRow = (await query('SELECT id FROM approvals WHERE purchase_intent_id = $1', [intent.id])).rows[0];

      // 2. Reject decision (triggers HUMAN_APPROVAL_DENIED)
      await request(app)
        .post(`/api/approvals/${approvalRow.id}/reject`)
        .set('Authorization', `Bearer ${buyerAToken}`)
        .send({ notes: 'Budget unapproved for this quarter' });

      const auditTrail = await query(`
        SELECT event_type, decision, actor, action 
        FROM audit_events 
        WHERE purchase_intent_id = $1 
        ORDER BY created_at ASC
      `, [intent.id]);

      const eventTypes = auditTrail.rows.map(r => r.event_type);
      expect(eventTypes).toContain('PURCHASE_INTENT_EVALUATION');
      expect(eventTypes).toContain('HUMAN_APPROVAL_REQUESTED');
      expect(eventTypes).toContain('HUMAN_APPROVAL_DENIED');
    } finally {
      await query('DELETE FROM approvals WHERE purchase_intent_id IN (SELECT id FROM purchase_intents WHERE product_id = $1)', [product.id]);
      await query('DELETE FROM purchase_intents WHERE product_id = $1', [product.id]);
      await query('DELETE FROM products WHERE id = $1', [product.id]);
    }
  });

  // ── TEST 11: Real Persisted State Across Restarts ───────────────────────────
  it('TEST 11: APPROVAL_REQUIRED and AWAITING_APPROVAL state persists across system queries with full snapshot', async () => {
    const pRes = await query(`
      INSERT INTO products (merchant_id, sku, name, description, category, price, inventory, in_stock)
      VALUES ($1, $2, 'Enterprise Router Rack', '10GbE Core Router', 'Electronics', 42000, 5, true)
      RETURNING *
    `, [testMerchantId, `SKU-RTR-${Date.now()}`]);
    const product = pRes.rows[0];

    try {
      const intentRes = await query(`
        INSERT INTO purchase_intents (agent_id, user_id, product_id, merchant_id, amount, quantity, status, state)
        VALUES ($1, $2, $3, $4, 42000.00, 2, 'pending', 'CREATED')
        RETURNING *
      `, [testAgent.id, buyerA.id, product.id, testMerchantId]);
      const intent = intentRes.rows[0];

      await evaluatePurchaseIntent(intent.id);

      const dbIntent = (await query('SELECT status, state FROM purchase_intents WHERE id = $1', [intent.id])).rows[0];
      expect(dbIntent.status).toBe('approval_required');
      expect(dbIntent.state).toBe('AWAITING_APPROVAL');

      const dbApproval = (await query('SELECT * FROM approvals WHERE purchase_intent_id = $1', [intent.id])).rows[0];
      expect(dbApproval.user_id).toBe(buyerA.id);
      expect(dbApproval.product_id).toBe(product.id);
      expect(dbApproval.merchant_id).toBe(testMerchantId);
      expect(dbApproval.quantity).toBe(2);
      expect(parseFloat(dbApproval.quoted_price)).toBe(42000);
      expect(dbApproval.expires_at).toBeDefined();
    } finally {
      await query('DELETE FROM approvals WHERE purchase_intent_id IN (SELECT id FROM purchase_intents WHERE product_id = $1)', [product.id]);
      await query('DELETE FROM purchase_intents WHERE product_id = $1', [product.id]);
      await query('DELETE FROM products WHERE id = $1', [product.id]);
    }
  });

  // ── TEST 12: Never Treat UI Approval State as Authoritative ─────────────────
  it('TEST 12: Client sending UI approval state without backend approval record is rejected fail-closed', async () => {
    const pRes = await query(`
      INSERT INTO products (merchant_id, sku, name, description, category, price, inventory, in_stock)
      VALUES ($1, $2, 'Unauthorized Execution Target', 'High-value asset', 'Electronics', 55000, 5, true)
      RETURNING *
    `, [testMerchantId, `SKU-UET-${Date.now()}`]);
    const product = pRes.rows[0];

    try {
      // Intent in pending state in DB
      const intentRes = await query(`
        INSERT INTO purchase_intents (agent_id, user_id, product_id, merchant_id, amount, quantity, status, state)
        VALUES ($1, $2, $3, $4, 55000.00, 1, 'pending', 'CREATED')
        RETURNING *
      `, [testAgent.id, buyerA.id, product.id, testMerchantId]);
      const intent = intentRes.rows[0];

      // Client passes { status: 'approved', state: 'APPROVED' } in options
      await expect(createPaymentOrder(intent.id, { status: 'approved', state: 'APPROVED' }))
        .rejects.toThrow(/Financial execution denied: Intent status is 'pending'/i);
    } finally {
      await query('DELETE FROM purchase_intents WHERE product_id = $1', [product.id]);
      await query('DELETE FROM products WHERE id = $1', [product.id]);
    }
  });
});
