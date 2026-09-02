import { Router } from 'express';
import { query } from '../config/database.js';
import { getUserIdFromRequest } from '../utils/authUtils.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = Router();

router.use(requireAuth);

// GET /api/agents — List all agents scoped to current user (or all if admin)
router.get('/', async (req, res, next) => {
  try {
    const userId = getUserIdFromRequest(req);
    const uRes = await query('SELECT role FROM users WHERE id::text = $1', [userId]);
    const role = (uRes.rows[0]?.role || '').toUpperCase();

    let sql = `
      SELECT a.*, p.name as policy_name, p.daily_budget, p.max_transaction,
             p.approval_threshold, p.allowed_categories, p.blocked_categories,
             u.name as owner_name
      FROM agents a
      LEFT JOIN policies p ON a.policy_id = p.id
      LEFT JOIN users u ON a.owner_id = u.id
    `;
    const params = [];
    if (role !== 'ADMIN') {
      params.push(userId);
      sql += ` WHERE a.owner_id::text = $1`;
    }
    sql += ` ORDER BY a.created_at DESC`;

    const result = await query(sql, params);
    res.json({ agents: result.rows });
  } catch (err) {
    next(err);
  }
});

// GET /api/agents/:id — Get agent details scoped to owner
router.get('/:id', async (req, res, next) => {
  try {
    const userId = getUserIdFromRequest(req);
    const uRes = await query('SELECT role FROM users WHERE id::text = $1', [userId]);
    const role = (uRes.rows[0]?.role || '').toUpperCase();

    const result = await query(`
      SELECT a.*, p.name as policy_name, p.daily_budget, p.max_transaction,
             p.approval_threshold, p.allowed_categories, p.blocked_categories,
             p.max_retries, p.price_tolerance_pct, p.verified_merchants_only,
             p.version as policy_version,
             u.name as owner_name
      FROM agents a
      LEFT JOIN policies p ON a.policy_id = p.id
      LEFT JOIN users u ON a.owner_id = u.id
      WHERE a.id = $1
    `, [req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const agent = result.rows[0];
    if (role !== 'ADMIN' && agent.owner_id && agent.owner_id !== userId) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    res.json({ agent });
  } catch (err) {
    next(err);
  }
});

// POST /api/agents — Create agent owned by authenticated user
router.post('/', async (req, res, next) => {
  try {
    const userId = getUserIdFromRequest(req);
    const { name, policy_id, description } = req.body || {};

    if (!name) {
      return res.status(400).json({ error: 'Agent name is required' });
    }

    const result = await query(`
      INSERT INTO agents (name, owner_id, policy_id, description)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [name, userId, policy_id || null, description || null]);

    res.status(201).json({ agent: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/agents/:id — Update agent owned by authenticated user
router.patch('/:id', async (req, res, next) => {
  try {
    const userId = getUserIdFromRequest(req);
    const uRes = await query('SELECT role FROM users WHERE id::text = $1', [userId]);
    const role = (uRes.rows[0]?.role || '').toUpperCase();

    // Check ownership
    const agentCheck = await query('SELECT owner_id FROM agents WHERE id = $1', [req.params.id]);
    if (agentCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    if (role !== 'ADMIN' && agentCheck.rows[0].owner_id && agentCheck.rows[0].owner_id !== userId) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const { name, status, policy_id, description } = req.body || {};
    const sets = [];
    const values = [];
    let idx = 1;

    if (name !== undefined) { sets.push(`name = $${idx++}`); values.push(name); }
    if (status !== undefined) { sets.push(`status = $${idx++}`); values.push(status); }
    if (policy_id !== undefined) { sets.push(`policy_id = $${idx++}`); values.push(policy_id); }
    if (description !== undefined) { sets.push(`description = $${idx++}`); values.push(description); }
    sets.push(`updated_at = NOW()`);
    values.push(req.params.id);

    const result = await query(
      `UPDATE agents SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    const io = req.app.get('io');
    if (io) {
      io.to('dashboard').emit('agent:updated', result.rows[0]);
    }

    res.json({ agent: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// GET /api/agents/:id/spending — Get today's spending scoped to owner
router.get('/:id/spending', async (req, res, next) => {
  try {
    const userId = getUserIdFromRequest(req);
    const uRes = await query('SELECT role FROM users WHERE id::text = $1', [userId]);
    const role = (uRes.rows[0]?.role || '').toUpperCase();

    const agentCheck = await query('SELECT owner_id FROM agents WHERE id = $1', [req.params.id]);
    if (agentCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    if (role !== 'ADMIN' && agentCheck.rows[0].owner_id && agentCheck.rows[0].owner_id !== userId) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const result = await query(`
      SELECT COALESCE(SUM(amount), 0) as total_spent
      FROM transactions
      WHERE agent_id = $1
        AND status IN ('payment_completed', 'verified')
        AND created_at >= CURRENT_DATE
    `, [req.params.id]);

    const policyResult = await query(`
      SELECT p.daily_budget
      FROM agents a
      JOIN policies p ON a.policy_id = p.id
      WHERE a.id = $1
    `, [req.params.id]);

    const totalSpent = parseFloat(result.rows[0]?.total_spent || 0);
    const dailyBudget = parseFloat(policyResult.rows[0]?.daily_budget || 0);

    res.json({
      agentId: req.params.id,
      totalSpentToday: totalSpent,
      dailyBudget,
      remaining: dailyBudget - totalSpent,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
