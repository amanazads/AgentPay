import { Router } from 'express';
import { query } from '../config/database.js';
import { getUserIdFromRequest } from '../utils/authUtils.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = Router();

router.use(requireAuth);

// GET /api/audit — List audit events scoped by tenant
router.get('/', async (req, res, next) => {
  try {
    const userId = getUserIdFromRequest(req);
    const uRes = await query('SELECT role, merchant_id FROM users WHERE id::text = $1', [userId]);
    const user = uRes.rows[0] || {};
    const role = (user.role || '').toUpperCase();
    const merchantId = user.merchant_id;

    const { agent_id, event_type, limit = 100, offset = 0 } = req.query;
    const conditions = [];
    const values = [];
    let idx = 1;

    if (role === 'MERCHANT' && merchantId) {
      conditions.push(`merchant_id = $${idx++}`);
      values.push(merchantId);
    } else if (role !== 'ADMIN') {
      conditions.push(`user_id::text = $${idx++}`);
      values.push(userId);
    }

    if (agent_id) { conditions.push(`agent_id = $${idx++}`); values.push(agent_id); }
    if (event_type) { conditions.push(`event_type = $${idx++}`); values.push(event_type); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    values.push(parseInt(limit), parseInt(offset));

    const result = await query(`
      SELECT * FROM audit_events
      ${where}
      ORDER BY created_at DESC
      LIMIT $${idx++} OFFSET $${idx++}
    `, values);

    res.json({ auditEvents: result.rows });
  } catch (err) { next(err); }
});

// GET /api/audit/transaction/:transactionId — Transaction timeline scoped by ownership
router.get('/transaction/:transactionId', async (req, res, next) => {
  try {
    const userId = getUserIdFromRequest(req);
    const uRes = await query('SELECT role, merchant_id FROM users WHERE id::text = $1', [userId]);
    const user = uRes.rows[0] || {};
    const role = (user.role || '').toUpperCase();
    const merchantId = user.merchant_id;

    const result = await query(`
      SELECT * FROM audit_events
      WHERE transaction_id = $1 OR purchase_intent_id = $1
      ORDER BY created_at ASC
    `, [req.params.transactionId]);

    // Check ownership on events
    if (result.rows.length > 0 && role !== 'ADMIN') {
      const firstEvt = result.rows[0];
      if (role === 'MERCHANT' && firstEvt.merchant_id && firstEvt.merchant_id !== merchantId) {
        return res.status(404).json({ error: 'Audit events not found' });
      }
      if (role === 'BUYER' && firstEvt.user_id && firstEvt.user_id !== userId) {
        return res.status(404).json({ error: 'Audit events not found' });
      }
    }

    res.json({ timeline: result.rows });
  } catch (err) { next(err); }
});

// GET /api/audit/agent/:agentId — Agent activity
router.get('/agent/:agentId', async (req, res, next) => {
  try {
    const userId = getUserIdFromRequest(req);
    const result = await query(`
      SELECT * FROM audit_events
      WHERE agent_id = $1
      ORDER BY created_at DESC
      LIMIT 100
    `, [req.params.agentId]);

    res.json({ auditEvents: result.rows });
  } catch (err) { next(err); }
});

export default router;
