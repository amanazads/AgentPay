import { query } from '../config/database.js';
import env from '../config/env.js';
import { logger } from '../utils/logger.js';

// Sensitive keys that must NEVER be persisted in plaintext audit logs
const SENSITIVE_KEY_PATTERNS = [
  /password/i,
  /secret/i,
  /key_secret/i,
  /api_?key/i,
  /token/i,
  /jwt/i,
  /authorization/i,
  /bearer/i,
  /card_?number/i,
  /cvv/i,
  /cvc/i,
  /pin/i,
  /private_?key/i,
  /credential/i,
];

/**
 * Deeply sanitizes an object to redact secrets, tokens, passwords, and sensitive credentials
 */
export function sanitizeAuditMetadata(data, depth = 0) {
  if (depth > 8 || data === null || data === undefined) {
    return data;
  }

  if (typeof data === 'string') {
    // Redact JWT patterns
    if (/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/.test(data)) {
      return '[REDACTED:JWT_TOKEN]';
    }
    // Redact Bearer authorization patterns
    if (/^Bearer\s+[A-Za-z0-9-_.]+/i.test(data)) {
      return '[REDACTED:BEARER_TOKEN]';
    }
    return data;
  }

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeAuditMetadata(item, depth + 1));
  }

  if (typeof data === 'object') {
    const clean = {};
    for (const [key, val] of Object.entries(data)) {
      const isSensitiveKey = SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
      if (isSensitiveKey) {
        clean[key] = typeof val === 'string' && val.length > 4 ? `[REDACTED:${val.slice(-4)}]` : '[REDACTED]';
      } else {
        clean[key] = sanitizeAuditMetadata(val, depth + 1);
      }
    }
    return clean;
  }

  return data;
}

/**
 * Append-only Audit Service for AgentPay
 * Records immutable audit events for complete compliance, forensic traceability,
 * and database-enforced non-repudiation.
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
  environment = null,
  paymentMode = null,
  metadata = {},
  strict = true,
  io = null,
}) {
  const effectiveEnv = (environment || env.APP_ENV || 'TEST').toUpperCase();
  const effectivePaymentMode = (paymentMode || env.PAYMENT_MODE || 'TEST').toUpperCase();
  const sanitizedMetadata = sanitizeAuditMetadata(metadata || {});

  try {
    const res = await query(`
      INSERT INTO audit_events (
        event_type, actor, agent_id, user_id, transaction_id,
        purchase_intent_id, action, decision, policy_version,
        reasoning, risk_score, payment_id, outcome, environment, payment_mode, metadata
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
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
      effectiveEnv,
      effectivePaymentMode,
      JSON.stringify(sanitizedMetadata),
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
    logger.error('Audit', 'Failed to record mandatory compliance audit event:', {
      eventType,
      action,
      error: err.message,
    });

    // In mandatory compliance mode, rethrow so callers do not falsely report silent success
    if (strict) {
      throw new Error(`COMPLIANCE AUDIT FAILURE: Could not persist immutable audit event '${eventType}'. Operation halted.`);
    }

    return null;
  }
}

/**
 * Asserts database-level append-only protection on audit_events
 */
export async function verifyAuditTrailImmutability() {
  // Test 1: Insert a probe record
  const probe = await query(`
    INSERT INTO audit_events (
      event_type, actor, action, outcome, metadata
    ) VALUES (
      'AUDIT_IMMUTABILITY_PROBE', 'system', 'PROBE_IMMUTABILITY', 'VERIFIED', '{"probe":true}'
    ) RETURNING id
  `);

  const probeId = probe.rows[0].id;

  // Test 2: Attempt UPDATE on probe record — must throw database trigger exception
  let updateBlocked = false;
  try {
    await query('UPDATE audit_events SET outcome = $1 WHERE id = $2', ['TAMPERED', probeId]);
  } catch (err) {
    if (err.message.includes('SECURITY VIOLATION') || err.code === '55000') {
      updateBlocked = true;
    }
  }

  // Test 3: Attempt DELETE on probe record — must throw database trigger exception
  let deleteBlocked = false;
  try {
    await query('DELETE FROM audit_events WHERE id = $1', [probeId]);
  } catch (err) {
    if (err.message.includes('SECURITY VIOLATION') || err.code === '55000') {
      deleteBlocked = true;
    }
  }

  return {
    probeId,
    updateBlocked,
    deleteBlocked,
    immutable: updateBlocked && deleteBlocked,
  };
}

export default {
  recordAuditEvent,
  sanitizeAuditMetadata,
  verifyAuditTrailImmutability,
};
