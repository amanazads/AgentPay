import { Router } from 'express';
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
