import { Router } from 'express';
import crypto from 'crypto';
import env from '../config/env.js';
import { createPaymentOrder, verifyPayment } from '../services/paymentService.js';
import { query } from '../config/database.js';
import { getUserIdFromRequest } from '../utils/authUtils.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { processRazorpayWebhook } from '../services/webhookService.js';
import { QuoteVerificationError } from '../services/quoteService.js';

const router = Router();

// Public Webhook Endpoint (Protected by HMAC signature verification)
// POST /api/payments/webhook — Razorpay Webhook Handler
router.post('/webhook', async (req, res, next) => {
  try {
    const io = req.app.get('io');
    const signature = req.headers['x-razorpay-signature'] || req.body?.signature;
    const environment = req.body?.environment === 'LIVE' ? 'LIVE' : 'TEST';
    const result = await processRazorpayWebhook({
      environment,
      signature,
      rawBody: req.body,
      payload: req.body,
      io,
    });

    res.json({ status: 'ok', received: true, result });
  } catch (err) {
    console.error('[Webhook] Error processing webhook:', err.message);
    res.json({ status: 'error', message: err.message });
  }
});

// All subsequent routes require authenticated session
router.use(requireAuth);

// GET /api/payments/transactions — List transactions strictly scoped to authenticated user/tenant
router.get('/transactions', async (req, res, next) => {
  try {
    const userId = getUserIdFromRequest(req);
    const { status, limit = 50, offset = 0 } = req.query;

    const uRes = await query('SELECT role, merchant_id FROM users WHERE id::text = $1', [userId]);
    const user = uRes.rows[0] || {};
    const role = (user.role || '').toUpperCase();
    const merchantId = user.merchant_id;

    let sql = `
      SELECT t.*, pi.amount, pi.status as intent_status,
             p.name as product_name, m.name as merchant_name,
             a.name as agent_name
      FROM transactions t
      JOIN purchase_intents pi ON t.purchase_intent_id = pi.id
      LEFT JOIN products p ON pi.product_id = p.id
      LEFT JOIN merchants m ON pi.merchant_id = m.id
      LEFT JOIN agents a ON t.agent_id = a.id
    `;
    const params = [];
    const conditions = [];

    if (role === 'MERCHANT' && merchantId) {
      params.push(merchantId);
      conditions.push(`pi.merchant_id = $${params.length}`);
    } else if (role !== 'ADMIN') {
      params.push(userId);
      conditions.push(`(t.user_id::text = $${params.length} OR pi.user_id::text = $${params.length})`);
    }

    if (status) {
      params.push(status);
      conditions.push(`t.status = $${params.length}`);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ` ORDER BY t.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await query(sql, params);
    res.json({ transactions: result.rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/payments/create & /create-order — Create Razorpay order for an authorized intent
router.post(['/create', '/create-order'], async (req, res, next) => {
  try {
    const purchase_intent_id = req.body.purchase_intent_id || req.body.purchaseIntentId;
    if (!purchase_intent_id) {
      return res.status(400).json({ error: 'purchase_intent_id is required' });
    }

    const userId = getUserIdFromRequest(req);
    const uRes = await query('SELECT role FROM users WHERE id::text = $1', [userId]);
    const role = (uRes.rows[0]?.role || '').toUpperCase();

    if (role === 'MERCHANT') {
      return res.status(403).json({ error: 'Forbidden: Merchant accounts cannot initiate checkout payments' });
    }

    // Verify user owns the purchase intent
    const piRes = await query('SELECT user_id FROM purchase_intents WHERE id::text = $1', [purchase_intent_id]);
    if (piRes.rows.length === 0) {
      return res.status(404).json({ error: 'Purchase intent not found' });
    }
    if (role !== 'ADMIN' && piRes.rows[0].user_id && piRes.rows[0].user_id !== userId) {
      return res.status(403).json({ error: 'Unauthorized to create payment for this purchase intent' });
    }

    const io = req.app.get('io');
    const order = await createPaymentOrder(purchase_intent_id, {
      quoteId: req.body.quote_id || req.body.quoteId,
      quote: req.body.quote,
      io,
    });
    res.status(201).json(order);
  } catch (err) {
    if (err instanceof QuoteVerificationError) {
      return res.status(400).json({
        error: err.message,
        code: err.code,
        details: err.details,
      });
    }
    next(err);
  }
});

// POST /api/payments/verify & /:id/verify — Server-side verify payment completion
router.post(['/verify', '/:id/verify'], async (req, res, next) => {
  try {
    const transaction_id = req.body.transaction_id || req.body.transactionId;
    const razorpay_order_id = req.body.razorpay_order_id || req.body.razorpayOrderId || req.params.id;
    const razorpay_payment_id = req.body.razorpay_payment_id || req.body.razorpayPaymentId;
    const razorpay_signature = req.body.razorpay_signature || req.body.razorpaySignature;

    const userId = getUserIdFromRequest(req);
    const uRes = await query('SELECT role, merchant_id FROM users WHERE id::text = $1', [userId]);
    const user = uRes.rows[0] || {};
    const role = (user.role || '').toUpperCase();
    const merchantId = user.merchant_id;
    const lookupRes = await query(`
      SELECT t.id, t.user_id, pi.merchant_id
      FROM transactions t
      JOIN purchase_intents pi ON t.purchase_intent_id = pi.id
      WHERE t.id::text = $1 OR t.razorpay_order_id = $2
      LIMIT 1
    `, [transaction_id || req.params.id || null, razorpay_order_id || null]);

    if (lookupRes.rows.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    const tx = lookupRes.rows[0];
    if (role === 'MERCHANT' && (!merchantId || tx.merchant_id !== merchantId)) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    if (role !== 'MERCHANT' && role !== 'ADMIN' && tx.user_id && tx.user_id !== userId) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const io = req.app.get('io');
    const result = await verifyPayment({
      transactionId: transaction_id || tx.id,
      razorpayOrderId: razorpay_order_id,
      razorpayPaymentId: razorpay_payment_id,
      razorpaySignature: razorpay_signature,
      quoteId: req.body.quote_id || req.body.quoteId || null,
      io,
    });

    res.json(result);
  } catch (err) {
    if (err instanceof QuoteVerificationError) {
      return res.status(400).json({
        success: false,
        error: err.message,
        code: err.code,
        details: err.details,
      });
    }
    next(err);
  }
});

// POST /api/payments/:id/sandbox-settle — TEST-ONLY server-side sandbox settlement
//
// Why this exists: in the hackathon sandbox there is no Razorpay Checkout widget
// returning a real payment signature. Previously the browser manufactured a
// placeholder signature and posted it to /verify. That is exactly the pattern
// that must never be able to reach live rails, so the simulation now lives
// server-side, behind an explicit TEST-only endpoint, and the signature is
// computed with the server's own test key secret.
//
// Hard invariants:
//   - refuses outright whenever the platform is in LIVE payment mode
//   - refuses for any transaction not recorded as a TEST/sandbox transaction
//   - refuses when the test key secret is absent (no "assume verified" path)
//   - the browser never supplies, and never learns, a payment signature
router.post(['/sandbox-settle', '/:id/sandbox-settle'], async (req, res, next) => {
  try {
    // Gate 1: platform-level live lock.
    if (env.isLiveMode || env.PAYMENT_MODE === 'live') {
      return res.status(403).json({
        error: 'Sandbox settlement is disabled: platform is running in LIVE payment mode.',
        code: 'SANDBOX_SETTLE_FORBIDDEN_IN_LIVE',
      });
    }

    const userId = getUserIdFromRequest(req);
    const uRes = await query('SELECT role FROM users WHERE id::text = $1', [userId]);
    const role = (uRes.rows[0]?.role || '').toUpperCase();
    if (role === 'MERCHANT') {
      return res.status(403).json({ error: 'Forbidden: Merchant accounts cannot settle buyer payments' });
    }

    const transactionId = req.body?.transaction_id || req.body?.transactionId || req.params.id;
    const razorpayOrderId = req.body?.razorpay_order_id || req.body?.razorpayOrderId || req.params.id;

    const txRes = await query(`
      SELECT t.id, t.user_id, t.razorpay_order_id, t.environment, t.payment_mode, t.status,
             pi.user_id AS intent_user_id
      FROM transactions t
      JOIN purchase_intents pi ON t.purchase_intent_id = pi.id
      WHERE t.id::text = $1 OR t.razorpay_order_id = $2
      LIMIT 1
    `, [transactionId || null, razorpayOrderId || null]);

    if (txRes.rows.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    const tx = txRes.rows[0];

    // Gate 2: ownership.
    const ownerId = tx.user_id || tx.intent_user_id;
    if (role !== 'ADMIN' && ownerId && String(ownerId) !== String(userId)) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    // Gate 3: the transaction itself must be a sandbox transaction.
    const txEnv = (tx.environment || tx.payment_mode || 'TEST').toUpperCase();
    if (txEnv !== 'TEST') {
      return res.status(403).json({
        error: `Sandbox settlement refused: transaction ${tx.id} is recorded on ${txEnv} rails.`,
        code: 'SANDBOX_SETTLE_FORBIDDEN_NON_TEST',
      });
    }

    // Gate 4: no credentials means no verification — fail closed, never assume.
    if (!env.RAZORPAY_TEST_KEY_SECRET) {
      return res.status(503).json({
        error: 'Sandbox settlement unavailable: RAZORPAY_TEST_KEY_SECRET is not configured. Payment cannot be cryptographically verified.',
        code: 'PAYMENT_CREDENTIALS_MISSING',
      });
    }

    const orderId = tx.razorpay_order_id;
    const sandboxPaymentId = `pay_sbx_${crypto.randomBytes(8).toString('hex')}`;
    const sandboxSignature = crypto
      .createHmac('sha256', env.RAZORPAY_TEST_KEY_SECRET)
      .update(`${orderId}|${sandboxPaymentId}`)
      .digest('hex');

    const io = req.app.get('io');
    const result = await verifyPayment({
      transactionId: tx.id,
      razorpayOrderId: orderId,
      razorpayPaymentId: sandboxPaymentId,
      razorpaySignature: sandboxSignature,
      quoteId: req.body?.quote_id || req.body?.quoteId || null,
      io,
    });

    res.json({ ...result, environment: 'TEST', settledVia: 'server-side-sandbox' });
  } catch (err) {
    if (err instanceof QuoteVerificationError) {
      return res.status(400).json({ success: false, error: err.message, code: err.code, details: err.details });
    }
    next(err);
  }
});

// GET /api/payments/:id — Get payment/transaction details by UUID or order_id
router.get('/:id', async (req, res, next) => {
  try {
    const userId = getUserIdFromRequest(req);
    const uRes = await query('SELECT role, merchant_id FROM users WHERE id::text = $1', [userId]);
    const user = uRes.rows[0] || {};
    const role = (user.role || '').toUpperCase();
    const merchantId = user.merchant_id;

    const result = await query(`
      SELECT t.*, pi.amount, pi.status as intent_status, pi.merchant_id,
             p.name as product_name, m.name as merchant_name,
             a.name as agent_name
      FROM transactions t
      JOIN purchase_intents pi ON t.purchase_intent_id = pi.id
      LEFT JOIN products p ON pi.product_id = p.id
      LEFT JOIN merchants m ON pi.merchant_id = m.id
      LEFT JOIN agents a ON t.agent_id = a.id
      WHERE t.id::text = $1 OR t.razorpay_order_id = $1
    `, [req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const tx = result.rows[0];

    // Resource ownership enforcement
    if (role === 'MERCHANT') {
      if (!merchantId || tx.merchant_id !== merchantId) {
        return res.status(404).json({ error: 'Transaction not found' });
      }
    } else if (role !== 'ADMIN') {
      if (tx.user_id && tx.user_id !== userId) {
        return res.status(404).json({ error: 'Transaction not found' });
      }
    }

    res.json({ transaction: tx });
  } catch (err) {
    next(err);
  }
});

export default router;
