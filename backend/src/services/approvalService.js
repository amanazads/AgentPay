import crypto from 'crypto';
import { query, getClient } from '../config/database.js';
import { recordAuditEvent } from './auditService.js';
import { createPaymentOrder, verifyPayment } from './paymentService.js';
import { transitionPurchaseState, PurchaseStates } from './purchaseStateMachine.js';
import { logger } from '../utils/logger.js';
import env from '../config/env.js';

/**
 * Human Approval Service
 * Manages human-in-the-loop workflows for transactions exceeding autonomous thresholds.
 */
export async function getApprovalsList(status = 'pending', userId = null) {
  // 1. Auto-expire any pending approvals whose expires_at < NOW()
  await query(`
    UPDATE approvals
    SET status = 'expired',
        decision = 'EXPIRED',
        reason = 'Approval request expired without decision',
        decided_at = NOW()
    WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < NOW()
  `);

  let sql = `
    SELECT ap.*,
           pi.amount, pi.quantity, pi.ai_reasoning, pi.ai_recommendation,
           pi.risk_score, pi.risk_details, pi.policy_details,
           p.name as product_name, p.price as product_price, p.category as product_category,
           m.name as merchant_name, m.is_verified as merchant_verified,
           a.name as agent_name, a.status as agent_status, a.owner_id as agent_owner_id
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
  const client = await getClient();
  let appRecord;
  let newStatus;
  let newIntentStatus;
  let newPolicyDecision;
  const isApproved = decision.toUpperCase() === 'APPROVE';

  try {
    await client.query('BEGIN');

    // 0. Immediate Global Emergency Kill Switch Check
    const sysRes = await client.query('SELECT kill_switch_active FROM system_state WHERE id = 1');
    if (sysRes.rows[0]?.kill_switch_active) {
      const err = new Error('Emergency kill switch is active. Financial approval execution is halted.');
      err.status = 503;
      throw err;
    }

    // 1. Fetch & Lock Approval Record FOR UPDATE
    const appRes = await client.query(`
      SELECT ap.*, pi.id as intent_id, pi.amount, pi.agent_id, pi.user_id, pi.product_id as intent_product_id,
             pi.quantity as intent_quantity, a.name as agent_name, a.owner_id as agent_owner_id,
             p.name as product_name, p.price as live_product_price, p.inventory as live_inventory, p.in_stock
      FROM approvals ap
      JOIN purchase_intents pi ON ap.purchase_intent_id = pi.id
      LEFT JOIN agents a ON ap.agent_id = a.id
      LEFT JOIN products p ON pi.product_id = p.id
      WHERE ap.id = $1
      FOR UPDATE OF ap
    `, [approvalId]);

    if (appRes.rows.length === 0) {
      const err = new Error('Approval request not found');
      err.status = 404;
      throw err;
    }

    appRecord = appRes.rows[0];

    // 2. Check Expiration
    const isExpired = appRecord.status === 'expired' || 
      (appRecord.expires_at && new Date(appRecord.expires_at) < new Date());

    if (isExpired && appRecord.status === 'pending') {
      await client.query(`
        UPDATE approvals
        SET status = 'expired',
            decision = 'EXPIRED',
            reason = 'Approval request has expired and can no longer be processed',
            decided_at = NOW()
        WHERE id = $1
      `, [approvalId]);

      await client.query(`
        UPDATE purchase_intents
        SET status = 'cancelled',
            policy_decision = 'EXPIRED',
            updated_at = NOW()
        WHERE id = $1
      `, [appRecord.intent_id]);

      await client.query('COMMIT');

      await recordAuditEvent({
        eventType: 'APPROVAL_EXPIRED',
        actor: 'system',
        agentId: appRecord.agent_id,
        userId: appRecord.user_id,
        purchaseIntentId: appRecord.intent_id,
        action: 'EXPIRE_APPROVAL_REQUEST',
        decision: 'EXPIRED',
        reasoning: 'Approval request expired prior to human decision',
        outcome: 'Approval request expired — purchase cancelled',
        metadata: { approvalId, expiresAt: appRecord.expires_at },
        io,
      });

      const err = new Error('Approval request has expired and can no longer be processed.');
      err.status = 410;
      throw err;
    }

    // 3. Authorization RBAC check
    if (reviewerId) {
      const uRes = await client.query('SELECT id, role FROM users WHERE id::text = $1', [reviewerId]);
      const reviewer = uRes.rows[0];
      const role = (reviewer?.role || '').toUpperCase();
      const isOwner = appRecord.user_id && appRecord.user_id === reviewerId;
      const isAgentOwner = appRecord.agent_owner_id && appRecord.agent_owner_id === reviewerId;
      const isAuthorizedRole = role === 'ADMIN' || role === 'SUPERVISOR';

      if (!isOwner && !isAgentOwner && !isAuthorizedRole) {
        const err = new Error('Unauthorized: Only the assigned buyer, supervisor, or administrator can decide this approval request.');
        err.status = 403;
        throw err;
      }
    }

    // 4. Reject duplicate decisions
    if (appRecord.status !== 'pending') {
      const err = new Error(`Approval already processed. Current status: '${appRecord.status}'`);
      err.status = 409;
      throw err;
    }

    // 5. Live Price & Catalog Integrity Check upon Approval
    if (isApproved && appRecord.intent_product_id) {
      const initialPrice = parseFloat(appRecord.current_price || appRecord.quoted_price || appRecord.amount);
      const currentCatalogPrice = parseFloat(appRecord.live_product_price || 0);
      const tolerancePercent = env.PRICE_SURGE_TOLERANCE_PERCENT || 2.0;
      const surgeMultiplier = 1 + (tolerancePercent / 100);

      if (currentCatalogPrice > initialPrice * surgeMultiplier) {
        await client.query(`
          UPDATE approvals
          SET status = 'expired',
              decision = 'REJECTED',
              reason = 'Product catalog price changed after approval request — re-evaluation required',
              decided_at = NOW()
          WHERE id = $1
        `, [approvalId]);

        await client.query(`
          UPDATE purchase_intents
          SET status = 'approval_required',
              policy_decision = 'APPROVAL_REQUIRED',
              updated_at = NOW()
          WHERE id = $1
        `, [appRecord.intent_id]);

        await client.query('COMMIT');

        await recordAuditEvent({
          eventType: 'APPROVAL_INVALIDATED_PRICE_CHANGED',
          actor: 'system',
          agentId: appRecord.agent_id,
          userId: appRecord.user_id,
          purchaseIntentId: appRecord.intent_id,
          action: 'INVALIDATE_APPROVAL_ON_PRICE_SURGE',
          decision: 'APPROVAL_REQUIRED',
          reasoning: `Catalog price changed from ₹${initialPrice} to ₹${currentCatalogPrice}. Re-evaluation required.`,
          outcome: 'Approval invalidated — re-evaluation required',
          metadata: { previousPrice: initialPrice, currentPrice: currentCatalogPrice },
          io,
        });

        const err = new Error(`Product price changed from ₹${initialPrice} to ₹${currentCatalogPrice}. Re-evaluation required.`);
        err.status = 409;
        throw err;
      }
    }

    newStatus = isApproved ? 'approved' : 'rejected';
    newIntentStatus = isApproved ? 'approved' : 'rejected';
    newPolicyDecision = isApproved ? 'ALLOW' : 'BLOCK';

    // 6. Update Approval Row
    await client.query(`
      UPDATE approvals
      SET status = $1,
          decision = $2,
          reason = $3,
          reviewer_id = $4,
          decided_at = NOW()
      WHERE id = $5
    `, [newStatus, decision.toUpperCase(), notes || (isApproved ? 'Approved by human reviewer' : 'Rejected by human reviewer'), reviewerId, approvalId]);

    // 7. Update Purchase Intent
    await client.query(`
      UPDATE purchase_intents
      SET status = $1,
          policy_decision = $2,
          updated_at = NOW()
      WHERE id = $3
    `, [newIntentStatus, newPolicyDecision, appRecord.intent_id]);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  // Transition purchase state machine to APPROVED or REJECTED
  await transitionPurchaseState(
    appRecord.intent_id,
    isApproved ? PurchaseStates.APPROVED : PurchaseStates.REJECTED,
    { actor: 'user', reason: notes || (isApproved ? 'Human reviewer approved' : 'Human reviewer rejected'), io }
  ).catch((err) => {
    logger.warn('Approval', `State machine transition to ${isApproved ? 'APPROVED' : 'REJECTED'} notice:`, err.message);
  });

  // 8. Record Audit Trail
  await recordAuditEvent({
    eventType: isApproved ? 'HUMAN_APPROVAL_GRANTED' : 'HUMAN_APPROVAL_DENIED',
    actor: 'user',
    agentId: appRecord.agent_id,
    userId: reviewerId || appRecord.user_id,
    purchaseIntentId: appRecord.intent_id,
    action: isApproved ? 'APPROVE_PURCHASE_INTENT' : 'REJECT_PURCHASE_INTENT',
    decision: newPolicyDecision,
    reasoning: notes || (isApproved ? `Human reviewer approved purchase of ₹${parseFloat(appRecord.amount).toLocaleString('en-IN')}` : `Human reviewer rejected purchase`),
    outcome: isApproved ? 'Authorized for payment execution' : 'Transaction terminated',
    metadata: { approvalId, amount: appRecord.amount },
    io,
  });

  let paymentOrder = null;
  if (isApproved && autoCreatePayment) {
    paymentOrder = await createPaymentOrder(appRecord.intent_id, io);
    if (paymentOrder && paymentOrder.transactionId) {
      try {
        const autoPaymentId = `pay_${crypto.randomBytes(8).toString('hex')}`;
        const hmacBody = `${paymentOrder.orderId}|${autoPaymentId}`;
        const autoSignature = crypto
          .createHmac('sha256', env.RAZORPAY_TEST_KEY_SECRET)
          .update(hmacBody)
          .digest('hex');
        await verifyPayment({
          transactionId: paymentOrder.transactionId,
          razorpayOrderId: paymentOrder.orderId,
          razorpayPaymentId: autoPaymentId,
          razorpaySignature: autoSignature,
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

