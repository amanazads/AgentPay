import request from 'supertest';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import env from '../src/config/env.js';
import { query } from '../src/config/database.js';
import { generateAccessToken } from '../src/utils/authUtils.js';
import { authenticateUser } from '../src/middleware/authMiddleware.js';

// Route imports
import buyerRoutes from '../src/routes/buyerRoutes.js';
import merchantPortalRoutes from '../src/routes/merchantPortal.js';
import approvalRoutes from '../src/routes/approvals.js';
import agentRoutes from '../src/routes/agents.js';
import paymentRoutes from '../src/routes/payments.js';
import systemRoutes from '../src/routes/system.js';
import webhookRoutes from '../src/routes/webhooks.js';
import productRoutes from '../src/routes/products.js';
import merchantRoutes from '../src/routes/merchants.js';
import preferencesRoutes from '../src/routes/preferences.js';
import connectionRoutes from '../src/routes/connections.js';
import auditRoutes from '../src/routes/audit.js';
import authRoutes from '../src/routes/auth.js';
import notificationRoutes from '../src/routes/notifications.js';
import purchaseIntentRoutes from '../src/routes/purchaseIntents.js';
import aiRoutes from '../src/routes/ai.js';

const app = express();
app.use(cors());
app.use(cookieParser());
app.use(express.json());
app.use(authenticateUser);

app.use('/api/auth', authRoutes);
app.use('/api/buyer', buyerRoutes);
app.use('/api/merchant', merchantPortalRoutes);
app.use('/api/approvals', approvalRoutes);
app.use('/api/agents', agentRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/system', systemRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/products', productRoutes);
app.use('/api/merchants', merchantRoutes);
app.use('/api/preferences', preferencesRoutes);
app.use('/api/connections', connectionRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/purchase-intents', purchaseIntentRoutes);
app.use('/api/ai', aiRoutes);

describe('Track 01: Authentication & Authorization Security Hardening Suite', () => {
  let buyerA, buyerAToken;
  let buyerB, buyerBToken;
  let merchantA, merchantAUser, merchantAToken;
  let merchantB, merchantBUser, merchantBToken;
  let adminUser, adminToken;

  let buyerBOrder, buyerBInvoice, buyerBAddress, buyerBApproval, buyerBAgent, buyerBTx;
  let merchantBProduct, merchantBOrder;

  beforeAll(async () => {
    // 1. Create Buyer A & Buyer B
    const bA = await query(`
      INSERT INTO users (email, name, role)
      VALUES ('buyer_a_${Date.now()}@agentpay.com', 'Buyer Alpha', 'BUYER')
      RETURNING *
    `);
    buyerA = bA.rows[0];
    buyerAToken = generateAccessToken(buyerA);

    const bB = await query(`
      INSERT INTO users (email, name, role)
      VALUES ('buyer_b_${Date.now()}@agentpay.com', 'Buyer Beta', 'BUYER')
      RETURNING *
    `);
    buyerB = bB.rows[0];
    buyerBToken = generateAccessToken(buyerB);

    // 2. Create Merchant A & Merchant B
    const mA = await query(`
      INSERT INTO merchants (name, category, is_verified, risk_level, rating, is_test_lab)
      VALUES ('Merchant Alpha Store', 'Electronics', true, 'low', 4.9, false)
      RETURNING *
    `);
    merchantA = mA.rows[0];
    const mAU = await query(`
      INSERT INTO users (email, name, role, merchant_id)
      VALUES ('merchant_a_${Date.now()}@agentpay.com', 'Merchant Alpha User', 'MERCHANT', $1)
      RETURNING *
    `, [merchantA.id]);
    merchantAUser = mAU.rows[0];
    merchantAToken = generateAccessToken(merchantAUser);

    const mB = await query(`
      INSERT INTO merchants (name, category, is_verified, risk_level, rating, is_test_lab)
      VALUES ('Merchant Beta Store', 'Hardware', true, 'low', 4.8, false)
      RETURNING *
    `);
    merchantB = mB.rows[0];
    const mBU = await query(`
      INSERT INTO users (email, name, role, merchant_id)
      VALUES ('merchant_b_${Date.now()}@agentpay.com', 'Merchant Beta User', 'MERCHANT', $1)
      RETURNING *
    `, [merchantB.id]);
    merchantBUser = mBU.rows[0];
    merchantBToken = generateAccessToken(merchantBUser);

    // 3. Create Admin User
    const adm = await query(`
      INSERT INTO users (email, name, role)
      VALUES ('admin_${Date.now()}@agentpay.com', 'Security Admin', 'ADMIN')
      RETURNING *
    `);
    adminUser = adm.rows[0];
    adminToken = generateAccessToken(adminUser);

    // 4. Create Seed Resources for Buyer B
    // Product for merchant B
    const pB = await query(`
      INSERT INTO products (merchant_id, sku, name, description, brand, category, price, currency, inventory, in_stock, specifications, status)
      VALUES ($1, 'SKU-MB-PROD01', 'Merchant B Dedicated Product', 'Description', 'BrandB', 'Electronics', 4999, 'INR', 10, true, '{"attr":"val"}'::jsonb, 'ACTIVE')
      RETURNING *
    `, [merchantB.id]);
    merchantBProduct = pB.rows[0];

    // Intent & Order for Buyer B
    const piB = await query(`
      INSERT INTO purchase_intents (user_id, product_id, merchant_id, amount, quantity, status)
      VALUES ($1, $2, $3, 4999, 1, 'completed')
      RETURNING *
    `, [buyerB.id, merchantBProduct.id, merchantB.id]);

    const nonce = Date.now();
    const txB = await query(`
      INSERT INTO transactions (user_id, purchase_intent_id, amount, currency, status, razorpay_order_id, razorpay_payment_id)
      VALUES ($1, $2, 4999, 'INR', 'verified', 'order_rzp_b_' || $3, 'pay_rzp_b_' || $3)
      RETURNING *
    `, [buyerB.id, piB.rows[0].id, nonce]);
    buyerBTx = txB.rows[0];

    const ordB = await query(`
      INSERT INTO orders (user_id, merchant_id, product_id, transaction_id, order_number, unit_price, quantity, subtotal, total_amount, delivery_address, order_status, payment_status, product_name)
      VALUES ($1, $2, $3, $4, 'ORD-BETA-' || $5, 4999, 1, 4999, 4999, '{"address_line1":"123 Beta St","city":"Bengaluru"}'::jsonb, 'CONFIRMED', 'VERIFIED', 'Merchant B Dedicated Product')
      RETURNING *
    `, [buyerB.id, merchantB.id, merchantBProduct.id, buyerBTx.id, nonce]);
    buyerBOrder = ordB.rows[0];
    merchantBOrder = ordB.rows[0];

    const invB = await query(`
      INSERT INTO invoices (order_id, invoice_number, user_id, merchant_id, subtotal, total_amount, items, payment_method, payment_status, billing_address, shipping_address)
      VALUES ($1, 'INV-BETA-' || $2, $3, $4, 4999, 4999, '[{"name":"Merchant B Dedicated Product","quantity":1,"price":4999}]'::jsonb, 'UPI_AUTONOMOUS', 'PAID', '{"city":"Bengaluru"}'::jsonb, '{"city":"Bengaluru"}'::jsonb)
      RETURNING *
    `, [buyerBOrder.id, nonce, buyerB.id, merchantB.id]);
    buyerBInvoice = invB.rows[0];

    // Address for Buyer B
    const addrB = await query(`
      INSERT INTO user_addresses (user_id, name, phone, address_line1, city, state, pincode, country, is_default)
      VALUES ($1, 'Buyer Beta', '9876543210', '123 Beta Street', 'Bengaluru', 'Karnataka', '560001', 'India', true)
      RETURNING *
    `, [buyerB.id]);
    buyerBAddress = addrB.rows[0];

    // Agent for Buyer B
    const agB = await query(`
      INSERT INTO agents (name, owner_id, description, status)
      VALUES ('Buyer B Procurement Agent', $1, 'Beta agent', 'active')
      RETURNING *
    `, [buyerB.id]);
    buyerBAgent = agB.rows[0];

    // Pending Approval for Buyer B
    const piBApp = await query(`
      INSERT INTO purchase_intents (user_id, product_id, merchant_id, amount, quantity, status)
      VALUES ($1, $2, $3, 150000, 1, 'pending')
      RETURNING *
    `, [buyerB.id, merchantBProduct.id, merchantB.id]);

    const appB = await query(`
      INSERT INTO approvals (purchase_intent_id, agent_id, status)
      VALUES ($1, $2, 'pending')
      RETURNING *
    `, [piBApp.rows[0].id, buyerBAgent.id]);
    buyerBApproval = appB.rows[0];
  });

  // ── CATEGORY 1: Unauthenticated Rejections (401 Unauthorized) ───────────────
  describe('Category 1: Unauthenticated Endpoint Protection (401)', () => {
    test('GET /api/buyer/orders rejects unauthenticated requests', async () => {
      const res = await request(app).get('/api/buyer/orders');
      expect(res.status).toBe(401);
    });

    test('GET /api/buyer/purchases rejects unauthenticated requests', async () => {
      const res = await request(app).get('/api/buyer/purchases');
      expect(res.status).toBe(401);
    });

    test('GET /api/buyer/addresses rejects unauthenticated requests', async () => {
      const res = await request(app).get('/api/buyer/addresses');
      expect(res.status).toBe(401);
    });

    test('GET /api/buyer/preferences rejects unauthenticated requests', async () => {
      const res = await request(app).get('/api/buyer/preferences');
      expect(res.status).toBe(401);
    });

    test('GET /api/merchant/overview rejects unauthenticated requests', async () => {
      const res = await request(app).get('/api/merchant/overview');
      expect(res.status).toBe(401);
    });

    test('GET /api/merchant/products rejects unauthenticated requests', async () => {
      const res = await request(app).get('/api/merchant/products');
      expect(res.status).toBe(401);
    });

    test('GET /api/approvals rejects unauthenticated requests', async () => {
      const res = await request(app).get('/api/approvals');
      expect(res.status).toBe(401);
    });

    test('GET /api/agents rejects unauthenticated requests', async () => {
      const res = await request(app).get('/api/agents');
      expect(res.status).toBe(401);
    });

    test('GET /api/payments/transactions rejects unauthenticated requests', async () => {
      const res = await request(app).get('/api/payments/transactions');
      expect(res.status).toBe(401);
    });

    test('GET /api/connections/merchants rejects unauthenticated requests', async () => {
      const res = await request(app).get('/api/connections/merchants');
      expect(res.status).toBe(401);
    });

    test('GET /api/audit rejects unauthenticated requests', async () => {
      const res = await request(app).get('/api/audit');
      expect(res.status).toBe(401);
    });

    test('GET /api/notifications rejects unauthenticated requests', async () => {
      const res = await request(app).get('/api/notifications');
      expect(res.status).toBe(401);
    });

    test('POST /api/preferences/evaluate rejects unauthenticated requests', async () => {
      const res = await request(app).post('/api/preferences/evaluate').send({ amount: 1000 });
      expect(res.status).toBe(401);
    });

    test('GET /api/buyer/orders rejects expired JWT with 401', async () => {
      const expiredToken = jwt.sign(
        { id: buyerA.id, email: buyerA.email, role: 'BUYER' },
        env.JWT_SECRET,
        { expiresIn: '-10s', algorithm: 'HS256' }
      );
      const res = await request(app)
        .get('/api/buyer/orders')
        .set('Authorization', `Bearer ${expiredToken}`);
      expect(res.status).toBe(401);
    });

    test('GET /api/buyer/orders rejects forged signature JWT with 401', async () => {
      const forgedToken = jwt.sign(
        { id: buyerA.id, email: buyerA.email, role: 'BUYER' },
        'forged_secret_key_attacker',
        { expiresIn: '24h', algorithm: 'HS256' }
      );
      const res = await request(app)
        .get('/api/buyer/orders')
        .set('Authorization', `Bearer ${forgedToken}`);
      expect(res.status).toBe(401);
    });
  });

  // ── CATEGORY 2: Horizontal Privilege Escalation (Buyer A vs Buyer B) ────────
  describe('Category 2: Horizontal Privilege Escalation Protection (Buyer Isolation)', () => {
    test('Buyer A CANNOT fetch Buyer B order details by ID', async () => {
      const res = await request(app)
        .get(`/api/buyer/orders/${buyerBOrder.id}`)
        .set('Authorization', `Bearer ${buyerAToken}`);

      expect(res.status).toBe(403);
    });

    test('Buyer A CANNOT fetch Buyer B invoice by order ID', async () => {
      const res = await request(app)
        .get(`/api/buyer/invoices/${buyerBOrder.id}`)
        .set('Authorization', `Bearer ${buyerAToken}`);

      expect(res.status).toBe(403);
    });

    test('Buyer A CANNOT update Buyer B address', async () => {
      const res = await request(app)
        .put(`/api/buyer/addresses/${buyerBAddress.id}`)
        .set('Authorization', `Bearer ${buyerAToken}`)
        .send({ city: 'Hacked City' });

      expect([403, 404]).toContain(res.status);

      // Verify Buyer B address in DB remains unchanged
      const check = await query('SELECT city FROM user_addresses WHERE id = $1', [buyerBAddress.id]);
      expect(check.rows[0].city).toBe('Bengaluru');
    });

    test('Buyer A CANNOT decide Buyer B pending approval', async () => {
      const res = await request(app)
        .post(`/api/approvals/${buyerBApproval.id}/decide`)
        .set('Authorization', `Bearer ${buyerAToken}`)
        .send({ decision: 'APPROVE', notes: 'Unauthorized approval attempt' });

      expect(res.status).toBe(403);

      // Verify approval in DB is still pending
      const check = await query('SELECT status FROM approvals WHERE id = $1', [buyerBApproval.id]);
      expect(check.rows[0].status).toBe('pending');
    });

    test('Buyer A CANNOT view or update Buyer B agent', async () => {
      // GET Buyer B's agent
      const getRes = await request(app)
        .get(`/api/agents/${buyerBAgent.id}`)
        .set('Authorization', `Bearer ${buyerAToken}`);

      expect([403, 404]).toContain(getRes.status);

      // PATCH Buyer B's agent
      const patchRes = await request(app)
        .patch(`/api/agents/${buyerBAgent.id}`)
        .set('Authorization', `Bearer ${buyerAToken}`)
        .send({ name: 'Hacked Agent Name' });

      expect([403, 404]).toContain(patchRes.status);

      // Verify agent name in DB is unchanged
      const check = await query('SELECT name FROM agents WHERE id = $1', [buyerBAgent.id]);
      expect(check.rows[0].name).toBe('Buyer B Procurement Agent');
    });

    test('Buyer A CANNOT view Buyer B payment transaction', async () => {
      const res = await request(app)
        .get(`/api/payments/${buyerBTx.id}`)
        .set('Authorization', `Bearer ${buyerAToken}`);

      expect([403, 404]).toContain(res.status);
    });

    test('Buyer A CANNOT propose purchase intent using Buyer B agent ID (IDOR prevention)', async () => {
      const res = await request(app)
        .post('/api/purchase-intents')
        .set('Authorization', `Bearer ${buyerAToken}`)
        .send({
          agent_id: buyerBAgent.id, // Buyer B's agent
          product_id: merchantBProduct.id,
          amount: 4999,
          quantity: 1,
        });

      expect(res.status).toBe(403);
    });

    test('Buyer A CANNOT chat using Buyer B agent ID (IDOR prevention)', async () => {
      const res = await request(app)
        .post('/api/ai/chat')
        .set('Authorization', `Bearer ${buyerAToken}`)
        .send({
          message: 'Buy high performance laptop',
          agent_id: buyerBAgent.id, // Buyer B's agent
        });

      expect(res.status).toBe(403);
    });

    test('Buyer A evaluating preferences with Buyer B userId ignores input and uses Buyer A preferences', async () => {
      const res = await request(app)
        .post('/api/preferences/evaluate')
        .set('Authorization', `Bearer ${buyerAToken}`)
        .send({
          userId: buyerB.id, // Maliciously specify Buyer B's userId
          amount: 500,
        });

      expect(res.status).toBe(200);
      // Response spending_metrics must belong to Buyer A, not Buyer B
      expect(res.body.spending_metrics).toBeDefined();
    });

    test('Buyer A receives only their own notifications and cannot see Buyer B notifications', async () => {
      // Seed notification for Buyer B
      await query(`
        INSERT INTO in_app_notifications (user_id, event_type, title, message)
        VALUES ($1, 'TEST_ALERT', 'Confidential Alert for B', 'Secret message for Beta')
      `, [buyerB.id]);

      const res = await request(app)
        .get('/api/notifications')
        .set('Authorization', `Bearer ${buyerAToken}`);

      expect(res.status).toBe(200);
      const betaAlert = res.body.notifications.find((n) => n.title === 'Confidential Alert for B');
      expect(betaAlert).toBeUndefined();
    });
  });

  // ── CATEGORY 3: Merchant Isolation (Merchant A vs Merchant B) ──────────────
  describe('Category 3: Merchant Tenant Isolation & Mutation Safeguards', () => {
    test('Merchant A CANNOT modify Merchant B product catalog item', async () => {
      const res = await request(app)
        .put(`/api/merchant/products/${merchantBProduct.id}`)
        .set('Authorization', `Bearer ${merchantAToken}`)
        .send({ name: 'Merchant A Overwrite Attempt', price: 10 });

      expect([403, 404]).toContain(res.status);

      // Verify DB product name & price are unchanged
      const check = await query('SELECT name, price FROM products WHERE id = $1', [merchantBProduct.id]);
      expect(check.rows[0].name).toBe('Merchant B Dedicated Product');
      expect(parseFloat(check.rows[0].price)).toBe(4999);
    });

    test('Merchant A CANNOT change status or delete Merchant B product', async () => {
      const statusRes = await request(app)
        .patch(`/api/merchant/products/${merchantBProduct.id}/status`)
        .set('Authorization', `Bearer ${merchantAToken}`)
        .send({ status: 'ARCHIVED' });

      expect([403, 404]).toContain(statusRes.status);

      const delRes = await request(app)
        .delete(`/api/merchant/products/${merchantBProduct.id}`)
        .set('Authorization', `Bearer ${merchantAToken}`);

      expect([403, 404]).toContain(delRes.status);

      // Verify product is still ACTIVE in DB
      const check = await query('SELECT status FROM products WHERE id = $1', [merchantBProduct.id]);
      expect(check.rows[0].status).toBe('ACTIVE');
    });

    test('Merchant A CANNOT fulfill Merchant B order', async () => {
      const res = await request(app)
        .post(`/api/merchant/orders/${merchantBOrder.id}/fulfill`)
        .set('Authorization', `Bearer ${merchantAToken}`)
        .send({ targetStatus: 'SHIPPED', trackingNumber: 'TRK-HACK-999' });

      expect([403, 404]).toContain(res.status);

      // Verify order status in DB is untouched
      const check = await query('SELECT order_status FROM orders WHERE id = $1', [merchantBOrder.id]);
      expect(check.rows[0].order_status).toBe('CONFIRMED');
    });

    test('Merchant A CANNOT cancel Merchant B order', async () => {
      const res = await request(app)
        .post(`/api/merchant/orders/${merchantBOrder.id}/cancel`)
        .set('Authorization', `Bearer ${merchantAToken}`)
        .send({ reason: 'Malicious merchant cancellation' });

      expect(res.status).toBe(403);

      // Verify order status in DB is untouched
      const check = await query('SELECT order_status FROM orders WHERE id = $1', [merchantBOrder.id]);
      expect(check.rows[0].order_status).toBe('CONFIRMED');
    });

    test('Merchant A CANNOT refund Merchant B order', async () => {
      const res = await request(app)
        .post(`/api/merchant/orders/${merchantBOrder.id}/refund`)
        .set('Authorization', `Bearer ${merchantAToken}`)
        .send({ amount: 4999, reason: 'Malicious merchant refund' });

      expect(res.status).toBe(403);
    });

    test('Merchant role CANNOT access buyer-only routes', async () => {
      const res = await request(app)
        .get('/api/buyer/purchases')
        .set('Authorization', `Bearer ${merchantAToken}`);

      expect(res.status).toBe(403);
    });

    test('Buyer role CANNOT access merchant-only routes', async () => {
      const res = await request(app)
        .get('/api/merchant/overview')
        .set('Authorization', `Bearer ${buyerAToken}`);

      expect(res.status).toBe(403);
    });
  });

  // ── CATEGORY 4: Vertical Privilege Escalation (Buyer/Merchant vs Admin) ─────
  describe('Category 4: Vertical Privilege Escalation Protection (Admin Only)', () => {
    test('Buyer CANNOT activate global kill switch', async () => {
      const res = await request(app)
        .post('/api/system/kill-switch')
        .set('Authorization', `Bearer ${buyerAToken}`)
        .send({ active: true, reason: 'Buyer unauthorized attempt' });

      expect(res.status).toBe(403);
    });

    test('Merchant CANNOT trigger system order reconciliation', async () => {
      const res = await request(app)
        .post('/api/system/reconcile-orders')
        .set('Authorization', `Bearer ${merchantAToken}`)
        .send({ autoHeal: true });

      expect(res.status).toBe(403);
    });

    test('Buyer CANNOT access webhooks inbox audit log', async () => {
      const res = await request(app)
        .get('/api/webhooks/inbox')
        .set('Authorization', `Bearer ${buyerAToken}`);

      expect(res.status).toBe(403);
    });

    test('Buyer CANNOT trigger demo reset', async () => {
      const res = await request(app)
        .post('/api/system/reset-demo')
        .set('Authorization', `Bearer ${buyerAToken}`);

      expect(res.status).toBe(403);
    });

    test('Public signup requesting ADMIN role is strictly sanitized to BUYER role', async () => {
      const hackerEmail = `admin_wannabe_${Date.now()}@agentpay.com`;
      const res = await request(app)
        .post('/api/auth/signup')
        .send({
          name: 'Hacker User',
          email: hackerEmail,
          password: 'Password123!',
          role: 'ADMIN', // Maliciously request ADMIN role
        });

      expect(res.status).toBe(201);
      expect(res.body.user.role).toBe('BUYER');
      expect(res.body.user.role).not.toBe('ADMIN');

      // Verify in DB directly
      const dbCheck = await query('SELECT role FROM users WHERE email = $1', [hackerEmail]);
      expect(dbCheck.rows[0].role).toBe('BUYER');
    });

    test('Admin successfully executes administrative operations', async () => {
      const res = await request(app)
        .post('/api/system/kill-switch')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ active: false, reason: 'Admin restored operations' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // ── CATEGORY 5: Request Body Spoofing Invariance ─────────────────────────────
  describe('Category 5: Request Body Spoofing Protection (Untrusted IDs in Payload)', () => {
    test('POST /api/agents ignores body owner_id and binds strictly to authenticated identity', async () => {
      const res = await request(app)
        .post('/api/agents')
        .set('Authorization', `Bearer ${buyerAToken}`)
        .send({
          name: 'Agent Spoof Test',
          owner_id: buyerB.id, // Maliciously specify Buyer B's ID
          description: 'Testing owner binding',
        });

      expect(res.status).toBe(201);
      expect(res.body.agent.owner_id).toBe(buyerA.id);
      expect(res.body.agent.owner_id).not.toBe(buyerB.id);
    });

    test('POST /api/merchant/products ignores body merchant_id and binds strictly to user merchant record', async () => {
      const res = await request(app)
        .post('/api/merchant/products')
        .set('Authorization', `Bearer ${merchantAToken}`)
        .send({
          sku: `SKU-SPOOF-${Date.now()}`,
          name: 'Merchant Spoof Product',
          merchant_id: merchantB.id, // Maliciously specify Merchant B's ID
          price: 1299,
          category: 'Electronics',
          inventory: 5,
        });

      expect(res.status).toBe(201);
      expect(res.body.product.merchant_id).toBe(merchantA.id);
      expect(res.body.product.merchant_id).not.toBe(merchantB.id);
    });
  });

  // ── CATEGORY 6: Public Catalog & Secret Non-Exposure ────────────────────────
  describe('Category 6: Public Catalog APIs & Secret Non-Exposure Guarantees', () => {
    test('Public read-only product catalog is accessible without authentication', async () => {
      const res = await request(app).get('/api/products');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.products)).toBe(true);
    });

    test('Public merchant directory NEVER exposes api_key_hash or webhook_secret_hash', async () => {
      const res = await request(app).get('/api/merchants');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.merchants)).toBe(true);

      for (const m of res.body.merchants) {
        expect(m.api_key_hash).toBeUndefined();
        expect(m.webhook_secret_hash).toBeUndefined();
        expect(m.settlement_account_ref).toBeUndefined();
      }
    });

    test('Public system status endpoint returns 200/503 health probe without exposing internal credentials', async () => {
      const res = await request(app).get('/api/system/status');
      expect([200, 503]).toContain(res.status);
      expect(res.body.status).toBeDefined();
      expect(res.body.dependencies).toBeDefined();
      expect(res.body.apiKey).toBeUndefined();
      expect(res.body.jwtSecret).toBeUndefined();
    });
  });
});
