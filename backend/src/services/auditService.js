import { query } from '../config/database.js';
import { logger } from '../utils/logger.js';

/**
 * Append-only Audit Service for AgentPay
 * Records immutable audit events for complete compliance and forensic traceability.
 */
export async function recordAuditEvent({
  eventType,
  actor = 'system',
  agentId = null,
  userId = null,
  transactionId = null,
  purchaseIntentId = null,
  action,
  decision = null,
  policyVersion = null,
  reasoning = null,
  riskScore = null,
  paymentId = null,
  outcome = null,
  metadata = {},
  io = null,
}) {
  try {
    const res = await query(`
      INSERT INTO audit_events (
        event_type, actor, agent_id, user_id, transaction_id,
        purchase_intent_id, action, decision, policy_version,
        reasoning, risk_score, payment_id, outcome, metadata
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
      ) RETURNING *
    `, [
      eventType,
      actor,
      agentId,
      userId,
      transactionId,
      purchaseIntentId,
      action,
      decision,
      policyVersion,
      reasoning,
      riskScore,
      paymentId,
      outcome,
      JSON.stringify(metadata || {}),
    ]);

    const event = res.rows[0];
    logger.info('Audit', `[${eventType}] ${action} → ${decision || outcome || 'OK'}`, {
      agentId,
      purchaseIntentId,
      transactionId,
    });

    if (io) {
      io.to('dashboard').emit('audit:event', event);
    }

    return event;
  } catch (err) {
    logger.error('Audit', 'Failed to record audit event:', { error: err.message });
    throw err;
  }
}

export default { recordAuditEvent };
