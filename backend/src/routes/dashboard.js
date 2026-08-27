import { Router } from 'express';
import { query } from '../config/database.js';

const router = Router();

// GET /api/dashboard/stats — Aggregated metrics
router.get('/stats', async (req, res, next) => {
  try {
    // Total transactions by status
    const txStats = await query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status IN ('payment_completed', 'verified')) as completed,
        COUNT(*) FILTER (WHERE status = 'payment_failed') as failed,
        COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled,
        COALESCE(SUM(amount) FILTER (WHERE status IN ('payment_completed', 'verified')), 0) as total_value
      FROM transactions
    `);

    // Purchase intent decisions
    const intentStats = await query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE policy_decision = 'ALLOW') as allowed,
        COUNT(*) FILTER (WHERE policy_decision = 'APPROVAL_REQUIRED') as approval_required,
        COUNT(*) FILTER (WHERE policy_decision = 'BLOCK') as blocked
      FROM purchase_intents
      WHERE policy_decision IS NOT NULL
    `);

    // Pending approvals
    const pendingApprovals = await query(`
      SELECT COUNT(*) as count FROM approvals WHERE status = 'pending'
    `);

    // Active agents
    const activeAgents = await query(`
      SELECT COUNT(*) as count FROM agents WHERE status = 'active'
    `);

    // Prevented unauthorized spend (blocked transactions total)
    const preventedSpend = await query(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM purchase_intents
      WHERE policy_decision = 'BLOCK'
    `);

    // Recent transactions
    const recent = await query(`
      SELECT t.*, pi.product_id, p.name as product_name, a.name as agent_name
      FROM transactions t
      LEFT JOIN purchase_intents pi ON t.purchase_intent_id = pi.id
      LEFT JOIN products p ON pi.product_id = p.id
      LEFT JOIN agents a ON t.agent_id = a.id
      ORDER BY t.created_at DESC
      LIMIT 10
    `);

    const tx = txStats.rows[0];
    const pi = intentStats.rows[0];

    res.json({
      transactions: {
        total: parseInt(tx.total),
        completed: parseInt(tx.completed),
        failed: parseInt(tx.failed),
        cancelled: parseInt(tx.cancelled),
        totalValue: parseFloat(tx.total_value),
      },
      decisions: {
        total: parseInt(pi.total),
        allowed: parseInt(pi.allowed),
        approvalRequired: parseInt(pi.approval_required),
        blocked: parseInt(pi.blocked),
      },
      pendingApprovals: parseInt(pendingApprovals.rows[0].count),
      activeAgents: parseInt(activeAgents.rows[0].count),
      preventedSpend: parseFloat(preventedSpend.rows[0].total),
      paymentSuccessRate: tx.total > 0
        ? ((parseInt(tx.completed) / parseInt(tx.total)) * 100).toFixed(1)
        : 0,
      recentTransactions: recent.rows,
    });
  } catch (err) { next(err); }
});

export default router;
