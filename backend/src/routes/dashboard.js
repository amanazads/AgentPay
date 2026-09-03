import { Router } from 'express';
import { query } from '../config/database.js';
import { getUserIdFromRequest } from '../utils/authUtils.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = Router();

router.use(requireAuth);

// GET /api/dashboard & /api/dashboard/stats — Aggregated metrics scoped by tenant role
router.get(['/', '/stats'], async (req, res, next) => {
  try {
    const userId = getUserIdFromRequest(req);
    const uRes = await query('SELECT role, merchant_id FROM users WHERE id::text = $1', [userId]);
    const user = uRes.rows[0] || {};
    const role = (user.role || '').toUpperCase();
    const merchantId = user.merchant_id;

    let txWhere = '';
    let piWhere = '';
    let apWhere = '';
    let agWhere = '';
    const txParams = [];
    const piParams = [];
    const apParams = [];
    const agParams = [];

    if (role === 'MERCHANT' && merchantId) {
      txWhere = 'JOIN purchase_intents pi ON t.purchase_intent_id = pi.id WHERE pi.merchant_id = $1';
      txParams.push(merchantId);

      piWhere = 'WHERE merchant_id = $1';
      piParams.push(merchantId);

      apWhere = 'JOIN purchase_intents pi ON ap.purchase_intent_id = pi.id WHERE pi.merchant_id = $1';
      apParams.push(merchantId);

      agWhere = 'WHERE 1=0'; // Merchants do not own autonomous agents
    } else if (role !== 'ADMIN') {
      txWhere = 'WHERE t.user_id::text = $1';
      txParams.push(userId);

      piWhere = 'WHERE user_id::text = $1';
      piParams.push(userId);

      apWhere = 'JOIN purchase_intents pi ON ap.purchase_intent_id = pi.id WHERE pi.user_id::text = $1';
      apParams.push(userId);

      agWhere = 'WHERE owner_id::text = $1';
      agParams.push(userId);
    } else {
      txWhere = '';
      piWhere = '';
    }

    // Total transactions by status
    const txStats = await query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE t.status IN ('payment_completed', 'verified', 'completed') AND t.payment_verified = true) as completed,
        COUNT(*) FILTER (WHERE t.status = 'payment_failed') as failed,
        COUNT(*) FILTER (WHERE t.status = 'cancelled') as cancelled,
        COUNT(*) FILTER (WHERE t.status = 'refunded') as refunded,
        COALESCE(SUM(t.amount) FILTER (WHERE t.status IN ('payment_completed', 'verified', 'completed') AND t.payment_verified = true), 0) as total_value
      FROM transactions t
      ${txWhere}
    `, txParams);

    // Purchase intent decisions
    const intentWhereClause = piWhere ? `${piWhere} AND policy_decision IS NOT NULL` : 'WHERE policy_decision IS NOT NULL';
    const intentStats = await query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE policy_decision = 'ALLOW') as allowed,
        COUNT(*) FILTER (WHERE policy_decision = 'APPROVAL_REQUIRED') as approval_required,
        COUNT(*) FILTER (WHERE policy_decision = 'BLOCK') as blocked
      FROM purchase_intents
      ${intentWhereClause}
    `, piParams);

    // Pending approvals
    const pendingWhereClause = apWhere ? `${apWhere} AND ap.status = 'pending'` : "WHERE ap.status = 'pending'";
    const pendingApprovals = await query(`
      SELECT COUNT(*) as count FROM approvals ap
      ${pendingWhereClause}
    `, apParams);

    // Active agents
    const activeWhereClause = agWhere ? `${agWhere} AND status = 'active'` : "WHERE status = 'active'";
    const activeAgents = await query(`
      SELECT COUNT(*) as count FROM agents
      ${activeWhereClause}
    `, agParams);

    // Prevented unauthorized spend (blocked transactions total)
    const preventedWhereClause = piWhere ? `${piWhere} AND policy_decision = 'BLOCK'` : "WHERE policy_decision = 'BLOCK'";
    const preventedSpend = await query(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM purchase_intents
      ${preventedWhereClause}
    `, piParams);

    // Recent transactions
    const recentWhere = txWhere ? `${txWhere}` : '';
    const recent = await query(`
      SELECT t.*, pi.product_id, p.name as product_name, a.name as agent_name
      FROM transactions t
      LEFT JOIN purchase_intents pi ON t.purchase_intent_id = pi.id
      LEFT JOIN products p ON pi.product_id = p.id
      LEFT JOIN agents a ON t.agent_id = a.id
      ${recentWhere}
      ORDER BY t.created_at DESC
      LIMIT 10
    `, txParams);

    const tx = txStats.rows[0] || {};
    const pi = intentStats.rows[0] || {};

    res.json({
      transactions: {
        total: parseInt(tx.total || 0),
        completed: parseInt(tx.completed || 0),
        failed: parseInt(tx.failed || 0),
        cancelled: parseInt(tx.cancelled || 0),
        totalValue: parseFloat(tx.total_value || 0),
      },
      decisions: {
        total: parseInt(pi.total || 0),
        allowed: parseInt(pi.allowed || 0),
        approvalRequired: parseInt(pi.approval_required || 0),
        blocked: parseInt(pi.blocked || 0),
      },
      pendingApprovals: parseInt(pendingApprovals.rows[0]?.count || 0),
      activeAgents: parseInt(activeAgents.rows[0]?.count || 0),
      preventedSpend: parseFloat(preventedSpend.rows[0]?.total || 0),
      paymentSuccessRate: parseInt(tx.total || 0) > 0
        ? ((parseInt(tx.completed || 0) / parseInt(tx.total || 0)) * 100).toFixed(1)
        : 0,
      recentTransactions: recent.rows,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
