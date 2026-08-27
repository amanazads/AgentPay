import { Router } from 'express';
import { processRazorpayWebhook } from '../services/webhookService.js';
import { query } from '../config/database.js';
import { requireAdmin } from '../middleware/authMiddleware.js';

const router = Router();

/**
 * POST /api/webhooks/razorpay/test
 * Dedicated Razorpay TEST Webhook Endpoint
 */
router.post('/razorpay/test', async (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'] || req.body?.signature;
    const io = req.app.get('io');

    const result = await processRazorpayWebhook({
      environment: 'TEST',
      signature,
      rawBody: req.body,
      payload: req.body,
      io,
    });

    res.status(200).json({ status: 'ok', environment: 'TEST', result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/webhooks/razorpay/live
 * Dedicated Razorpay LIVE Webhook Endpoint (Strict HMAC Verification)
 */
router.post('/razorpay/live', async (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    const io = req.app.get('io');

    if (!signature) {
      return res.status(400).json({ error: 'x-razorpay-signature header required for live webhooks' });
    }

    const result = await processRazorpayWebhook({
      environment: 'LIVE',
      signature,
      rawBody: req.body,
      payload: req.body,
      io,
    });

    res.status(200).json({ status: 'ok', environment: 'LIVE', result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * GET /api/webhooks/inbox
 * View durable webhook log entries (Deduplication & Audit View)
 */
router.get('/inbox', async (req, res, next) => {
  try {
    const { environment, limit = 50 } = req.query;
    const where = environment ? 'WHERE environment = $1' : '';
    const params = environment ? [environment, parseInt(limit)] : [parseInt(limit)];

    const result = await query(`
      SELECT * FROM webhook_inbox
      ${where}
      ORDER BY created_at DESC
      LIMIT $${params.length}
    `, params);

    res.json({
      total: result.rows.length,
      events: result.rows,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
