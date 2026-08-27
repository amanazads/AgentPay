import { query } from '../config/database.js';
import { recordAuditEvent } from './auditService.js';
import { createPaymentOrder } from './paymentService.js';
import { logger } from '../utils/logger.js';

/**
 * Human Approval Service
 * Manages human-in-the-loop workflows for transactions exceeding autonomous thresholds.
 */
export async function getApprovalsList(status = 'pending', userId = null) {
  let sql = `
    SELECT ap.*,
           pi.amount, pi.quantity, pi.ai_reasoning, pi.ai_recommendation,
           pi.risk_score, pi.risk_details, pi.policy_details,
           p.name as product_name, p.price as product_price, p.category as product_category,
           m.name as merchant_name, m.is_verified as merchant_verified,
           a.name as agent_name, a.status as agent_status
    FROM approvals ap
    JOIN purchase_intents pi ON ap.purchase_intent_id = pi.id
    LEFT JOIN products p ON pi.product_id = p.id
    LEFT JOIN merchants m ON pi.merchant_id = m.id
    LEFT JOIN agents a ON ap.agent_id = a.id
    WHERE ap.status = $1
  `;
  const params = [status];

  if (userId) {
    params.push(userId);
    sql += ` AND (pi.user_id::text = $${params.length} OR a.owner_id::text = $${params.length})`;
  }

  sql += ' ORDER BY ap.created_at DESC';
  const result = await query(sql, params);
  return result.rows;
}

export async function processApproval({
  approvalId,
  decision, // 'APPROVE' or 'REJECT'
  reviewerId = null,
  notes = '',
  autoCreatePayment = false,
  io = null,
}) {
  // 1. Fetch Approval Record
  const appRes = await query(`
    SELECT ap.*, pi.id as intent_id, pi.amount, pi.agent_id, pi.user_id,
           a.name as agent_name, p.name as product_name
    FROM approvals ap
    JOIN purchase_intents pi ON ap.purchase_intent_id = pi.id
    LEFT JOIN agents a ON ap.agent_id = a.id
    LEFT JOIN products p ON pi.product_id = p.id
    WHERE ap.id = $1
  `, [approvalId]);

  if (appRes.rows.length === 0) {
    throw new Error('Approval request not found');
  }

  const appRecord = appRes.rows[0];

  if (appRecord.status !== 'pending') {
    throw new Error(`Approval already processed. Current status: '${appRecord.status}'`);
  }

  const isApproved = decision.toUpperCase() === 'APPROVE';
  const newStatus = isApproved ? 'approved' : 'rejected';
  const newIntentStatus = isApproved ? 'approved' : 'rejected';
  const newPolicyDecision = isApproved ? 'ALLOW' : 'BLOCK';

  // 2. Update Approval Row
  await query(`
    UPDATE approvals
    SET status = $1,
        decision = $2,
        reason = $3,
        reviewer_id = $4,
        decided_at = NOW()
    WHERE id = $5
  `, [newStatus, decision.toUpperCase(), notes || (isApproved ? 'Approved by human reviewer' : 'Rejected by human reviewer'), reviewerId, approvalId]);

  // 3. Update Purchase Intent
  await query(`
    UPDATE purchase_intents
    SET status = $1,
        policy_decision = $2,
        updated_at = NOW()
    WHERE id = $3
  `, [newIntentStatus, newPolicyDecision, appRecord.intent_id]);

  // 4. Record Audit Trail
  await recordAuditEvent({
    eventType: isApproved ? 'HUMAN_APPROVAL_GRANTED' : 'HUMAN_APPROVAL_DENIED',
    actor: 'user',
    agentId: appRecord.agent_id,
    userId: reviewerId || appRecord.user_id,
    purchaseIntentId: appRecord.intent_id,
    action: isApproved ? 'APPROVE_PURCHASE_INTENT' : 'REJECT_PURCHASE_INTENT',
    decision: newPolicyDecision,
    reasoning: notes || (isApproved ? `Human supervisor approved purchase of ₹${parseFloat(appRecord.amount).toLocaleString('en-IN')}` : `Human supervisor rejected purchase`),
    outcome: isApproved ? 'Authorized for payment execution' : 'Transaction terminated',
    metadata: { approvalId, amount: appRecord.amount },
    io,
  });

  let paymentOrder = null;
  if (isApproved && autoCreatePayment) {
    paymentOrder = await createPaymentOrder(appRecord.intent_id, io);
    if (paymentOrder && paymentOrder.transactionId) {
      try {
        const { verifyPayment } = await import('./paymentService.js');
        await verifyPayment({
          transactionId: paymentOrder.transactionId,
          razorpayOrderId: paymentOrder.orderId,
          razorpayPaymentId: `pay_test_${Math.random().toString(36).substring(2, 10)}`,
          razorpaySignature: 'valid_test_signature',
          io,
        });
      } catch (verErr) {
        console.error('[ApprovalService] Auto-settle verification failed:', verErr.message);
      }
    }
  }

  if (io) {
    io.to('approvals').emit('approval:decided', {
      approvalId,
      status: newStatus,
      decision: decision.toUpperCase(),
      intentId: appRecord.intent_id,
    });
    io.to('dashboard').emit('dashboard:refresh');
  }

  return {
    approvalId,
    status: newStatus,
    decision: decision.toUpperCase(),
    intentId: appRecord.intent_id,
    paymentOrder,
  };
}

export default { getApprovalsList, processApproval };
