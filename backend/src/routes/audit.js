import { Router } from 'express';
import { query } from '../config/database.js';

const router = Router();

// GET /api/audit — List audit events
router.get('/', async (req, res, next) => {
  try {
    const { agent_id, event_type, limit = 100, offset = 0 } = req.query;
    const conditions = [];
    const values = [];
    let idx = 1;

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

// GET /api/audit/transaction/:transactionId — Transaction timeline
router.get('/transaction/:transactionId', async (req, res, next) => {
  try {
    const result = await query(`
      SELECT * FROM audit_events
      WHERE transaction_id = $1 OR purchase_intent_id = $1
      ORDER BY created_at ASC
    `, [req.params.transactionId]);

    res.json({ timeline: result.rows });
  } catch (err) { next(err); }
});

// GET /api/audit/agent/:agentId — Agent activity
router.get('/agent/:agentId', async (req, res, next) => {
  try {
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
