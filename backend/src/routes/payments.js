import { Router } from 'express';
import { createPaymentOrder, verifyPayment } from '../services/paymentService.js';
import { query } from '../config/database.js';
import { getUserIdFromRequest } from '../utils/authUtils.js';

const router = Router();

// GET /api/payments/transactions — List transactions scoped to user
router.get('/transactions', async (req, res, next) => {
  try {
    const userId = getUserIdFromRequest(req);
    const { status, limit = 50, offset = 0 } = req.query;

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

    if (userId) {
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
    const { purchase_intent_id } = req.body;
    if (!purchase_intent_id) {
      return res.status(400).json({ error: 'purchase_intent_id is required' });
    }

    const io = req.app.get('io');
    const order = await createPaymentOrder(purchase_intent_id, io);
    res.status(201).json(order);
  } catch (err) {
    next(err);
  }
});

// POST /api/payments/verify & /:id/verify — Server-side verify payment completion
router.post(['/verify', '/:id/verify'], async (req, res, next) => {
  try {
    const {
      transaction_id,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = req.body;

    const io = req.app.get('io');
    const result = await verifyPayment({
      transactionId: transaction_id || req.params.id,
      razorpayOrderId: razorpay_order_id,
      razorpayPaymentId: razorpay_payment_id,
      razorpaySignature: razorpay_signature,
      io,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/payments/webhook — Razorpay Webhook Handler
router.post('/webhook', async (req, res, next) => {
  try {
    const io = req.app.get('io');
    const event = req.body?.event;
    const payload = req.body?.payload;

    if (event === 'payment.captured') {
      const paymentEntity = payload?.payment?.entity;
      const orderId = paymentEntity?.order_id;
      const paymentId = paymentEntity?.id;

      if (orderId) {
        await verifyPayment({
          razorpayOrderId: orderId,
          razorpayPaymentId: paymentId,
          io,
        });
      }
    }

    res.json({ status: 'ok', received: true });
  } catch (err) {
    console.error('[Webhook] Error processing webhook:', err.message);
    res.json({ status: 'error', message: err.message });
  }
});

// GET /api/payments/:id — Get payment/transaction details by UUID or order_id
router.get('/:id', async (req, res, next) => {
  try {
    const result = await query(`
      SELECT t.*, pi.amount, pi.status as intent_status,
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
    res.json({ transaction: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

export default router;
