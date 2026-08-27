import { Router } from 'express';
import { query } from '../config/database.js';

const router = Router();

// GET /api/agents — List all agents
router.get('/', async (req, res, next) => {
  try {
    const result = await query(`
      SELECT a.*, p.name as policy_name, p.daily_budget, p.max_transaction,
             p.approval_threshold, p.allowed_categories, p.blocked_categories,
             u.name as owner_name
      FROM agents a
      LEFT JOIN policies p ON a.policy_id = p.id
      LEFT JOIN users u ON a.owner_id = u.id
      ORDER BY a.created_at DESC
    `);
    res.json({ agents: result.rows });
  } catch (err) { next(err); }
});

// GET /api/agents/:id — Get agent details
router.get('/:id', async (req, res, next) => {
  try {
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
    res.json({ agent: result.rows[0] });
  } catch (err) { next(err); }
});

// POST /api/agents — Create agent
router.post('/', async (req, res, next) => {
  try {
    const { name, owner_id, policy_id, description } = req.body;
    const result = await query(`
      INSERT INTO agents (name, owner_id, policy_id, description)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [name, owner_id, policy_id, description]);
    res.status(201).json({ agent: result.rows[0] });
  } catch (err) { next(err); }
});

// PATCH /api/agents/:id — Update agent
router.patch('/:id', async (req, res, next) => {
  try {
    const { name, status, policy_id, description } = req.body;
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

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    // Emit real-time update
    const io = req.app.get('io');
    io.to('dashboard').emit('agent:updated', result.rows[0]);

    res.json({ agent: result.rows[0] });
  } catch (err) { next(err); }
});

// GET /api/agents/:id/spending — Get today's spending
router.get('/:id/spending', async (req, res, next) => {
  try {
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
  } catch (err) { next(err); }
});

export default router;
