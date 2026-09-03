import { jest } from '@jest/globals';
import request from 'supertest';
import { app } from '../src/index.js';
import { query } from '../src/config/database.js';
import { generateAccessToken } from '../src/utils/authUtils.js';

jest.setTimeout(40000);

describe('Final Authorization & IDOR Regression Audit Suite', () => {
  let buyerA, tokenBuyerA;
  let buyerB, tokenBuyerB;
  let merchantAUser, merchantAStore, tokenMerchantA;
  let merchantBUser, merchantBStore, tokenMerchantB;
  let adminUser, tokenAdmin;

  let buyerAAgent, buyerBAgent;
  let productA, productB;
  let orderA, orderB;
  let intentA, intentB;
  let txA, txB;
  let approvalA, approvalB;
  let addressA, addressB;
  let paymentMethodA, paymentMethodB;

  beforeAll(async () => {
    // 1. Create Buyer A & Buyer B
    const bARes = await query(`
      INSERT INTO users (email, name, role)
      VALUES ('buyer_a_' || floor(random()*1000000) || '@test.com', 'Buyer Alpha', 'BUYER')
      RETURNING *
    `);
    buyerA = bARes.rows[0];
    tokenBuyerA = generateAccessToken(buyerA);

    const bBRes = await query(`
      INSERT INTO users (email, name, role)
      VALUES ('buyer_b_' || floor(random()*1000000) || '@test.com', 'Buyer Beta', 'BUYER')
      RETURNING *
    `);
    buyerB = bBRes.rows[0];
    tokenBuyerB = generateAccessToken(buyerB);

    // 2. Create Merchant A Store & User
    const mStoreARes = await query(`
      INSERT INTO merchants (name, category, is_verified, rating, tier)
      VALUES ('Merchant Alpha Store ' || floor(random()*10000), 'Electronics', true, 4.9, 'tier_1')
      RETURNING *
    `);
    merchantAStore = mStoreARes.rows[0];

    const mUARes = await query(`
      INSERT INTO users (email, name, role, merchant_id)
      VALUES ('merchant_a_' || floor(random()*1000000) || '@store.com', 'Merchant Alpha User', 'MERCHANT', $1)
      RETURNING *
    `, [merchantAStore.id]);
    merchantAUser = mUARes.rows[0];
    tokenMerchantA = generateAccessToken(merchantAUser);

    // 3. Create Merchant B Store & User
    const mStoreBRes = await query(`
      INSERT INTO merchants (name, category, is_verified, rating, tier)
      VALUES ('Merchant Beta Store ' || floor(random()*10000), 'Electronics', true, 4.8, 'tier_1')
      RETURNING *
    `);
    merchantBStore = mStoreBRes.rows[0];

    const mUBRes = await query(`
      INSERT INTO users (email, name, role, merchant_id)
      VALUES ('merchant_b_' || floor(random()*1000000) || '@store.com', 'Merchant Beta User', 'MERCHANT', $1)
      RETURNING *
    `, [merchantBStore.id]);
    merchantBUser = mUBRes.rows[0];
    tokenMerchantB = generateAccessToken(merchantBUser);

    // 4. Create Admin User
    const adminRes = await query(`
      INSERT INTO users (email, name, role)
      VALUES ('admin_' || floor(random()*1000000) || '@agentpay.ai', 'System Admin', 'ADMIN')
      RETURNING *
    `);
    adminUser = adminRes.rows[0];
    tokenAdmin = generateAccessToken(adminUser);

    // 5. Create Buyer Agents
    const agentARes = await query(`
      INSERT INTO agents (owner_id, name, description, status)
      VALUES ($1, 'Buyer A Autonomous Agent', 'Agent for Buyer A', 'active')
      RETURNING *
    `, [buyerA.id]);
    buyerAAgent = agentARes.rows[0];

    const agentBRes = await query(`
      INSERT INTO agents (owner_id, name, description, status)
      VALUES ($1, 'Buyer B Autonomous Agent', 'Agent for Buyer B', 'active')
      RETURNING *
    `, [buyerB.id]);
    buyerBAgent = agentBRes.rows[0];

    // 6. Create Products
    const pARes = await query(`
      INSERT INTO products (merchant_id, sku, name, description, category, price, inventory, in_stock)
      VALUES ($1, $2, 'Alpha Mechanical Keyboard', 'Keyboard from Merchant A', 'Electronics', 4999.00, 20, true)
      RETURNING *
    `, [merchantAStore.id, `SKU-A-${Date.now()}`]);
    productA = pARes.rows[0];

    const pBRes = await query(`
      INSERT INTO products (merchant_id, sku, name, description, category, price, inventory, in_stock)
      VALUES ($1, $2, 'Beta Wireless Mouse', 'Mouse from Merchant B', 'Electronics', 2499.00, 30, true)
      RETURNING *
    `, [merchantBStore.id, `SKU-B-${Date.now()}`]);
    productB = pBRes.rows[0];

    // 7. Create Purchase Intents
    const iARes = await query(`
      INSERT INTO purchase_intents (agent_id, user_id, product_id, merchant_id, amount, quantity, status)
      VALUES ($1, $2, $3, $4, 4999.00, 1, 'pending')
      RETURNING *
    `, [buyerAAgent.id, buyerA.id, productA.id, merchantAStore.id]);
    intentA = iARes.rows[0];

    const iBRes = await query(`
      INSERT INTO purchase_intents (agent_id, user_id, product_id, merchant_id, amount, quantity, status)
      VALUES ($1, $2, $3, $4, 2499.00, 1, 'pending')
      RETURNING *
    `, [buyerBAgent.id, buyerB.id, productB.id, merchantBStore.id]);
    intentB = iBRes.rows[0];

    // 8. Create Transactions
    const txARes = await query(`
      INSERT INTO transactions (purchase_intent_id, agent_id, user_id, amount, status, razorpay_order_id)
      VALUES ($1, $2, $3, 4999.00, 'pending', 'order_test_alpha_123')
      RETURNING *
    `, [intentA.id, buyerAAgent.id, buyerA.id]);
    txA = txARes.rows[0];

    const txBRes = await query(`
      INSERT INTO transactions (purchase_intent_id, agent_id, user_id, amount, status, razorpay_order_id)
      VALUES ($1, $2, $3, 2499.00, 'pending', 'order_test_beta_456')
      RETURNING *
    `, [intentB.id, buyerBAgent.id, buyerB.id]);
    txB = txBRes.rows[0];

    // 9. Create Confirmed Orders & Invoices
    const ordARes = await query(`
      INSERT INTO orders (
        order_number, user_id, merchant_id, product_id, product_name, purchase_intent_id, transaction_id,
        quantity, unit_price, subtotal, total_amount, order_status, fulfillment_status, payment_status, delivery_address
      )
      VALUES ('AGP-ORD-ALPHA-01', $1, $2, $3, $4, $5, $6, 1, 4999.00, 4999.00, 4999.00, 'CONFIRMED', 'CONFIRMED', 'VERIFIED', '{"city": "Bengaluru"}'::jsonb)
      RETURNING *
    `, [buyerA.id, merchantAStore.id, productA.id, productA.name, intentA.id, txA.id]);
    orderA = ordARes.rows[0];

    const ordBRes = await query(`
      INSERT INTO orders (
        order_number, user_id, merchant_id, product_id, product_name, purchase_intent_id, transaction_id,
        quantity, unit_price, subtotal, total_amount, order_status, fulfillment_status, payment_status, delivery_address
      )
      VALUES ('AGP-ORD-BETA-02', $1, $2, $3, $4, $5, $6, 1, 2499.00, 2499.00, 2499.00, 'CONFIRMED', 'CONFIRMED', 'VERIFIED', '{"city": "Mumbai"}'::jsonb)
      RETURNING *
    `, [buyerB.id, merchantBStore.id, productB.id, productB.name, intentB.id, txB.id]);
    orderB = ordBRes.rows[0];

    const { generateInvoiceForOrder } = await import('../src/services/invoiceService.js');
    await generateInvoiceForOrder(orderA.id);
    await generateInvoiceForOrder(orderB.id);

    // 10. Create Approvals
    const apARes = await query(`
      INSERT INTO approvals (agent_id, purchase_intent_id, status)
      VALUES ($1, $2, 'pending')
      RETURNING *
    `, [buyerAAgent.id, intentA.id]);
    approvalA = apARes.rows[0];

    const apBRes = await query(`
      INSERT INTO approvals (agent_id, purchase_intent_id, status)
      VALUES ($1, $2, 'pending')
      RETURNING *
    `, [buyerBAgent.id, intentB.id]);
    approvalB = apBRes.rows[0];

    // 11. Create Addresses
    const addrARes = await query(`
      INSERT INTO user_addresses (user_id, name, phone, address_line1, city, state, pincode, is_default)
      VALUES ($1, 'Buyer Alpha', '+91 9876543210', '123 Alpha St', 'Bengaluru', 'Karnataka', '560001', true)
      RETURNING *
    `, [buyerA.id]);
    addressA = addrARes.rows[0];

    const addrBRes = await query(`
      INSERT INTO user_addresses (user_id, name, phone, address_line1, city, state, pincode, is_default)
      VALUES ($1, 'Buyer Beta', '+91 9876543211', '456 Beta Ave', 'Mumbai', 'Maharashtra', '400001', true)
      RETURNING *
    `, [buyerB.id]);
    addressB = addrBRes.rows[0];

    // 12. Create Payment Methods
    const pmARes = await query(`
      INSERT INTO user_payment_methods (user_id, provider, method_type, identifier_masked, max_limit, status)
      VALUES ($1, 'razorpay_sandbox', 'upi_mandate', 'buyerA@okaxis', 50000, 'active')
      RETURNING *
    `, [buyerA.id]);
    paymentMethodA = pmARes.rows[0];

    const pmBRes = await query(`
      INSERT INTO user_payment_methods (user_id, provider, method_type, identifier_masked, max_limit, status)
      VALUES ($1, 'razorpay_sandbox', 'upi_mandate', 'buyerB@okaxis', 50000, 'active')
      RETURNING *
    `, [buyerB.id]);
    paymentMethodB = pmBRes.rows[0];
  });

  afterAll(async () => {
    // Cleanup created test records
    await query('DELETE FROM invoices WHERE order_id IN ($1, $2)', [orderA?.id, orderB?.id]).catch(() => {});
    await query('DELETE FROM orders WHERE id IN ($1, $2)', [orderA?.id, orderB?.id]).catch(() => {});
    await query('DELETE FROM approvals WHERE id IN ($1, $2)', [approvalA?.id, approvalB?.id]).catch(() => {});
    await query('DELETE FROM transactions WHERE id IN ($1, $2)', [txA?.id, txB?.id]).catch(() => {});
    await query('DELETE FROM purchase_intents WHERE id IN ($1, $2)', [intentA?.id, intentB?.id]).catch(() => {});
    await query('DELETE FROM products WHERE id IN ($1, $2)', [productA?.id, productB?.id]).catch(() => {});
    await query('DELETE FROM user_addresses WHERE id IN ($1, $2)', [addressA?.id, addressB?.id]).catch(() => {});
    await query('DELETE FROM user_payment_methods WHERE id IN ($1, $2)', [paymentMethodA?.id, paymentMethodB?.id]).catch(() => {});
    await query('DELETE FROM agents WHERE id IN ($1, $2)', [buyerAAgent?.id, buyerBAgent?.id]).catch(() => {});
    await query('DELETE FROM users WHERE id IN ($1, $2, $3, $4, $5)', [buyerA?.id, buyerB?.id, merchantAUser?.id, merchantBUser?.id, adminUser?.id]).catch(() => {});
    await query('DELETE FROM merchants WHERE id IN ($1, $2)', [merchantAStore?.id, merchantBStore?.id]).catch(() => {});
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 1. BUYER A → BUYER B (Cross-Buyer Isolation & IDOR Defense)
  // ══════════════════════════════════════════════════════════════════════════
  describe('Vector 1: Buyer A -> Buyer B Cross-User Isolation', () => {
    it('1.1: Buyer A cannot view Buyer B order detail (GET /api/buyer/orders/:id)', async () => {
      const res = await request(app)
        .get(`/api/buyer/orders/${orderB.id}`)
        .set('Authorization', `Bearer ${tokenBuyerA}`);

      expect(res.status).toBe(403);
    });

    it('1.2: Buyer A orders list does not contain Buyer B orders (GET /api/buyer/orders)', async () => {
      const res = await request(app)
        .get('/api/buyer/orders')
        .set('Authorization', `Bearer ${tokenBuyerA}`);

      expect(res.status).toBe(200);
      const ids = res.body.orders.map((o) => o.id);
      expect(ids).toContain(orderA.id);
      expect(ids).not.toContain(orderB.id);
    });

    it('1.3: Buyer A cannot view Buyer B invoice (GET /api/buyer/invoices/:orderId)', async () => {
      const res = await request(app)
        .get(`/api/buyer/invoices/${orderB.id}`)
        .set('Authorization', `Bearer ${tokenBuyerA}`);

      expect(res.status).toBe(403);
    });

    it('1.4: Buyer A cannot view or edit Buyer B agent (GET/PATCH /api/agents/:id)', async () => {
      const getRes = await request(app)
        .get(`/api/agents/${buyerBAgent.id}`)
        .set('Authorization', `Bearer ${tokenBuyerA}`);
      expect(getRes.status).toBe(404);

      const patchRes = await request(app)
        .patch(`/api/agents/${buyerBAgent.id}`)
        .set('Authorization', `Bearer ${tokenBuyerA}`)
        .send({ name: 'Hacked Agent Name' });
      expect(patchRes.status).toBe(404);
    });

    it('1.5: Buyer A cannot view Buyer B agent spending metrics (GET /api/agents/:id/spending)', async () => {
      const res = await request(app)
        .get(`/api/agents/${buyerBAgent.id}/spending`)
        .set('Authorization', `Bearer ${tokenBuyerA}`);

      expect(res.status).toBe(404);
    });

    it('1.6: Buyer A cannot view or decide Buyer B approval request (POST /api/approvals/:id/approve)', async () => {
      const decideRes = await request(app)
        .post(`/api/approvals/${approvalB.id}/approve`)
        .set('Authorization', `Bearer ${tokenBuyerA}`)
        .send({ notes: 'Malicious approval by another buyer' });

      expect(decideRes.status).toBe(403);
    });

    it('1.7: Buyer A approvals list excludes Buyer B approval requests (GET /api/approvals)', async () => {
      const res = await request(app)
        .get('/api/approvals')
        .set('Authorization', `Bearer ${tokenBuyerA}`);

      expect(res.status).toBe(200);
      const approvalIds = res.body.approvals.map((a) => a.id);
      expect(approvalIds).toContain(approvalA.id);
      expect(approvalIds).not.toContain(approvalB.id);
    });

    it('1.8: Buyer A cannot access Buyer B purchase intent (GET /api/purchase-intents/:id)', async () => {
      const res = await request(app)
        .get(`/api/purchase-intents/${intentB.id}`)
        .set('Authorization', `Bearer ${tokenBuyerA}`);

      expect(res.status).toBe(404);
    });

    it('1.9: Buyer A cannot view Buyer B transaction (GET /api/payments/:id)', async () => {
      const res = await request(app)
        .get(`/api/payments/${txB.id}`)
        .set('Authorization', `Bearer ${tokenBuyerA}`);

      expect(res.status).toBe(404);
    });

    it('1.10: Buyer A cannot revoke Buyer B payment method (POST /api/connections/payment-methods/:id/revoke)', async () => {
      const res = await request(app)
        .post(`/api/connections/payment-methods/${paymentMethodB.id}/revoke`)
        .set('Authorization', `Bearer ${tokenBuyerA}`);

      expect(res.status).toBe(403);
    });

    it('1.11: Buyer A cannot modify or delete Buyer B address (PUT/DELETE /api/buyer/addresses/:id)', async () => {
      const putRes = await request(app)
        .put(`/api/buyer/addresses/${addressB.id}`)
        .set('Authorization', `Bearer ${tokenBuyerA}`)
        .send({ name: 'Tampered Address' });
      expect(putRes.status).toBe(404);

      const delRes = await request(app)
        .delete(`/api/buyer/addresses/${addressB.id}`)
        .set('Authorization', `Bearer ${tokenBuyerA}`);
      expect(delRes.body.success).toBe(false);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 2. MERCHANT A → MERCHANT B (Cross-Merchant Isolation & IDOR Defense)
  // ══════════════════════════════════════════════════════════════════════════
  describe('Vector 2: Merchant A -> Merchant B Cross-Merchant Isolation', () => {
    it('2.1: Merchant A product list contains only Merchant A products (GET /api/merchant/products)', async () => {
      const res = await request(app)
        .get('/api/merchant/products')
        .set('Authorization', `Bearer ${tokenMerchantA}`);

      expect(res.status).toBe(200);
      const productIds = res.body.products.map((p) => p.id);
      expect(productIds).toContain(productA.id);
      expect(productIds).not.toContain(productB.id);
    });

    it('2.2: Merchant A cannot modify Merchant B product (PUT /api/merchant/products/:id)', async () => {
      const res = await request(app)
        .put(`/api/merchant/products/${productB.id}`)
        .set('Authorization', `Bearer ${tokenMerchantA}`)
        .send({ price: 1.00, name: 'Defaced Product' });

      expect(res.status).toBe(404);
    });

    it('2.3: Merchant A cannot toggle status or delete Merchant B product (POST/DELETE /api/merchant/products/:id)', async () => {
      const statusRes = await request(app)
        .post(`/api/merchant/products/${productB.id}/status`)
        .set('Authorization', `Bearer ${tokenMerchantA}`)
        .send({ status: 'ARCHIVED' });
      expect(statusRes.status).toBe(404);

      const delRes = await request(app)
        .delete(`/api/merchant/products/${productB.id}`)
        .set('Authorization', `Bearer ${tokenMerchantA}`);
      expect(delRes.status).toBe(404);
    });

    it('2.4: Merchant A orders list excludes Merchant B orders (GET /api/merchant/orders)', async () => {
      const res = await request(app)
        .get('/api/merchant/orders')
        .set('Authorization', `Bearer ${tokenMerchantA}`);

      expect(res.status).toBe(200);
      const orderIds = res.body.orders.map((o) => o.id);
      expect(orderIds).toContain(orderA.id);
      expect(orderIds).not.toContain(orderB.id);
    });

    it('2.5: Merchant A cannot advance fulfillment on Merchant B order (POST /api/merchant/orders/:id/fulfill)', async () => {
      const res = await request(app)
        .post(`/api/merchant/orders/${orderB.id}/fulfill`)
        .set('Authorization', `Bearer ${tokenMerchantA}`)
        .send({ targetStatus: 'PROCESSING' });

      expect(res.status).toBe(403);
    });

    it('2.6: Merchant A cannot cancel or refund Merchant B order (POST /api/merchant/orders/:id/cancel|refund)', async () => {
      const cancelRes = await request(app)
        .post(`/api/merchant/orders/${orderB.id}/cancel`)
        .set('Authorization', `Bearer ${tokenMerchantA}`)
        .send({ reason: 'Malicious merchant cancellation' });
      expect(cancelRes.status).toBe(403);

      const refundRes = await request(app)
        .post(`/api/merchant/orders/${orderB.id}/refund`)
        .set('Authorization', `Bearer ${tokenMerchantA}`)
        .send({ amount: 2499.00 });
      expect(refundRes.status).toBe(403);
    });

    it('2.7: Merchant A overview metrics strictly reflect Merchant A sales', async () => {
      const res = await request(app)
        .get('/api/merchant/overview')
        .set('Authorization', `Bearer ${tokenMerchantA}`);

      expect(res.status).toBe(200);
      expect(res.body.hasStore).toBe(true);
      // Merchant A total revenue must match Order A (4999), not Order A + B (7498)
      expect(res.body.metrics.grossRevenue).toBe(4999);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 3. BUYER → MERCHANT ENDPOINTS (Role Boundary Defense)
  // ══════════════════════════════════════════════════════════════════════════
  describe('Vector 3: Buyer -> Merchant Endpoints Rejection', () => {
    it('3.1: Buyer cannot access merchant overview (GET /api/merchant/overview)', async () => {
      const res = await request(app)
        .get('/api/merchant/overview')
        .set('Authorization', `Bearer ${tokenBuyerA}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('3.2: Buyer cannot access merchant products (GET /api/merchant/products)', async () => {
      const res = await request(app)
        .get('/api/merchant/products')
        .set('Authorization', `Bearer ${tokenBuyerA}`);

      expect(res.status).toBe(403);
    });

    it('3.3: Buyer cannot access merchant orders (GET /api/merchant/orders)', async () => {
      const res = await request(app)
        .get('/api/merchant/orders')
        .set('Authorization', `Bearer ${tokenBuyerA}`);

      expect(res.status).toBe(403);
    });

    it('3.4: Buyer cannot rotate merchant API keys (POST /api/merchant/store/rotate-api-key)', async () => {
      const res = await request(app)
        .post('/api/merchant/store/rotate-api-key')
        .set('Authorization', `Bearer ${tokenBuyerA}`);

      expect(res.status).toBe(403);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 4. MERCHANT → BUYER ENDPOINTS (Role Boundary Defense)
  // ══════════════════════════════════════════════════════════════════════════
  describe('Vector 4: Merchant -> Buyer Endpoints Rejection', () => {
    it('4.1: Merchant cannot access buyer purchases (GET /api/buyer/purchases)', async () => {
      const res = await request(app)
        .get('/api/buyer/purchases')
        .set('Authorization', `Bearer ${tokenMerchantA}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('4.2: Merchant cannot access buyer orders ledger (GET /api/buyer/orders)', async () => {
      const res = await request(app)
        .get('/api/buyer/orders')
        .set('Authorization', `Bearer ${tokenMerchantA}`);

      expect(res.status).toBe(403);
    });

    it('4.3: Merchant cannot access buyer preferences (GET /api/preferences & /api/buyer/preferences)', async () => {
      const res1 = await request(app)
        .get('/api/preferences')
        .set('Authorization', `Bearer ${tokenMerchantA}`);
      expect(res1.status).toBe(403);

      const res2 = await request(app)
        .get('/api/buyer/preferences')
        .set('Authorization', `Bearer ${tokenMerchantA}`);
      expect(res2.status).toBe(403);
    });

    it('4.4: Merchant cannot invoke AI buyer chat procurement (POST /api/ai/chat)', async () => {
      const res = await request(app)
        .post('/api/ai/chat')
        .set('Authorization', `Bearer ${tokenMerchantA}`)
        .send({ message: 'Buy me a keyboard' });

      expect(res.status).toBe(403);
    });

    it('4.5: Merchant cannot create buyer purchase intents (POST /api/purchase-intents)', async () => {
      const res = await request(app)
        .post('/api/purchase-intents')
        .set('Authorization', `Bearer ${tokenMerchantA}`)
        .send({
          agent_id: buyerAAgent.id,
          product_id: productA.id,
          amount: 4999.00,
        });

      expect(res.status).toBe(403);
    });

    it('4.6: Merchant cannot create buyer payment orders (POST /api/payments/create)', async () => {
      const res = await request(app)
        .post('/api/payments/create')
        .set('Authorization', `Bearer ${tokenMerchantA}`)
        .send({ purchase_intent_id: intentA.id });

      expect(res.status).toBe(403);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 5. UNAUTHORIZED ADMIN ENDPOINTS
  // ══════════════════════════════════════════════════════════════════════════
  describe('Vector 5: Unauthorized Admin Endpoints Rejection', () => {
    it('5.1: Non-admin (Buyer) cannot toggle kill switch (POST /api/system/kill-switch)', async () => {
      const res = await request(app)
        .post('/api/system/kill-switch')
        .set('Authorization', `Bearer ${tokenBuyerA}`)
        .send({ active: true, reason: 'Unauthorized toggle' });

      expect(res.status).toBe(403);
    });

    it('5.2: Non-admin (Merchant) cannot toggle kill switch (POST /api/system/kill-switch)', async () => {
      const res = await request(app)
        .post('/api/system/kill-switch')
        .set('Authorization', `Bearer ${tokenMerchantA}`)
        .send({ active: true, reason: 'Unauthorized toggle' });

      expect(res.status).toBe(403);
    });

    it('5.3: Non-admin cannot trigger system order reconciliation (POST /api/system/reconcile-orders)', async () => {
      const res = await request(app)
        .post('/api/system/reconcile-orders')
        .set('Authorization', `Bearer ${tokenBuyerA}`)
        .send({ autoHeal: true });

      expect(res.status).toBe(403);
    });

    it('5.4: Non-admin cannot trigger demo ledger reset (POST /api/system/reset-demo)', async () => {
      const res = await request(app)
        .post('/api/system/reset-demo')
        .set('Authorization', `Bearer ${tokenMerchantA}`);

      expect(res.status).toBe(403);
    });

    it('5.5: Non-admin cannot access internal webhook inbox (GET /api/webhooks/inbox)', async () => {
      const res = await request(app)
        .get('/api/webhooks/inbox')
        .set('Authorization', `Bearer ${tokenBuyerA}`);

      expect(res.status).toBe(403);
    });

    it('5.6: Admin CAN access administrative endpoints', async () => {
      const res = await request(app)
        .get('/api/webhooks/inbox')
        .set('Authorization', `Bearer ${tokenAdmin}`);

      expect(res.status).toBe(200);
      expect(res.body.events).toBeDefined();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 6. MANIPULATED URL & REQUEST-BODY IDs
  // ══════════════════════════════════════════════════════════════════════════
  describe('Vector 6: Manipulated URL & Request-Body IDs Defense', () => {
    it('6.1: Buyer A attempting to create purchase intent using Buyer B agent ID is strictly REJECTED', async () => {
      const res = await request(app)
        .post('/api/purchase-intents')
        .set('Authorization', `Bearer ${tokenBuyerA}`)
        .send({
          agent_id: buyerBAgent.id, // Manipulated agent ID
          product_id: productA.id,
          amount: 4999.00,
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/unauthorized|do not own/i);
    });

    it('6.2: Buyer A injecting user_id: buyerB.id in request body does NOT attribute intent to Buyer B', async () => {
      const res = await request(app)
        .post('/api/purchase-intents')
        .set('Authorization', `Bearer ${tokenBuyerA}`)
        .send({
          agent_id: buyerAAgent.id,
          product_id: productA.id,
          user_id: buyerB.id, // Client spoofing attempt
          amount: 4999.00,
          auto_evaluate: false,
        });

      expect(res.status).toBe(201);
      // Database record must have user_id = buyerA.id, ignoring client request body injection
      const createdIntent = res.body.purchaseIntent;
      expect(createdIntent.user_id).toBe(buyerA.id);
      expect(createdIntent.user_id).not.toBe(buyerB.id);

      await query('DELETE FROM purchase_intents WHERE id = $1', [createdIntent.id]);
    });

    it('6.3: Merchant A creating product with merchant_id: merchantB.id creates product strictly for Merchant A', async () => {
      const res = await request(app)
        .post('/api/merchant/products')
        .set('Authorization', `Bearer ${tokenMerchantA}`)
        .send({
          name: 'Injected Merchant Product',
          price: 999.00,
          merchant_id: merchantBStore.id, // Spoof attempt
          category: 'Electronics',
        });

      expect(res.status).toBe(201);
      const prodId = res.body.productId;

      const dbCheck = await query('SELECT merchant_id FROM products WHERE id = $1', [prodId]);
      expect(dbCheck.rows[0].merchant_id).toBe(merchantAStore.id);
      expect(dbCheck.rows[0].merchant_id).not.toBe(merchantBStore.id);

      await query('DELETE FROM product_ai_metadata WHERE product_id = $1', [prodId]);
      await query('DELETE FROM products WHERE id = $1', [prodId]);
    });

    it('6.4: Random non-existent UUIDs in URL return 404 cleanly without 500 error or leakage', async () => {
      const randomUuid = '00000000-0000-0000-0000-000000000000';

      const resOrder = await request(app)
        .get(`/api/buyer/orders/${randomUuid}`)
        .set('Authorization', `Bearer ${tokenBuyerA}`);
      expect(resOrder.status).toBe(404);

      const resInvoice = await request(app)
        .get(`/api/buyer/invoices/${randomUuid}`)
        .set('Authorization', `Bearer ${tokenBuyerA}`);
      expect(resInvoice.status).toBe(404);

      const resAgent = await request(app)
        .get(`/api/agents/${randomUuid}`)
        .set('Authorization', `Bearer ${tokenBuyerA}`);
      expect(resAgent.status).toBe(404);

      const resTx = await request(app)
        .get(`/api/payments/${randomUuid}`)
        .set('Authorization', `Bearer ${tokenBuyerA}`);
      expect(resTx.status).toBe(404);
    });
  });
});
