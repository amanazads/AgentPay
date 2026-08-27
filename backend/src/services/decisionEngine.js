import { query } from '../config/database.js';
import { evaluatePolicy } from './policyEngine.js';
import { assessRisk } from './riskEngine.js';
import { recordAuditEvent } from './auditService.js';
import { transitionPurchaseState, PurchaseStates } from './purchaseStateMachine.js';
import { logger } from '../utils/logger.js';

/**
 * Transaction Decision Engine with Price Protection & Deterministic Policy Enforcement
 */
export async function evaluatePurchaseIntent(purchaseIntentId, io = null) {
  const startTime = Date.now();

  // 1. Fetch Purchase Intent with live catalog & policy details
  const intentRes = await query(`
    SELECT pi.*, a.name as agent_name, p.name as product_name, p.price as catalog_price,
           m.name as merchant_name, m.is_verified as merchant_verified
    FROM purchase_intents pi
    LEFT JOIN agents a ON pi.agent_id = a.id
    LEFT JOIN products p ON pi.product_id = p.id
    LEFT JOIN merchants m ON pi.merchant_id = m.id
    WHERE pi.id = $1
  `, [purchaseIntentId]);

  if (intentRes.rows.length === 0) {
    throw new Error('Purchase intent not found');
  }

  const intent = intentRes.rows[0];

  // 2. Price Protection Validation
  const intentAmount = parseFloat(intent.amount);
  const catalogPrice = intent.catalog_price ? parseFloat(intent.catalog_price) * (intent.quantity || 1) : intentAmount;
  const priceSurgeTolerance = 1.05; // Max 5% price drift allowed before mandatory block

  if (catalogPrice > 0 && intentAmount > catalogPrice * priceSurgeTolerance) {
    const surgeReason = `Purchase stopped because the final checkout price (₹${intentAmount.toLocaleString('en-IN')}) exceeds authorized catalog price (₹${catalogPrice.toLocaleString('en-IN')}).`;
    
    await transitionPurchaseState(purchaseIntentId, PurchaseStates.BLOCKED, {
      actor: 'system',
      reason: surgeReason,
      io,
    });

    await query(`
      UPDATE purchase_intents
      SET policy_decision = 'BLOCK',
          policy_details = $1,
          status = 'blocked',
          updated_at = NOW()
      WHERE id = $2
    `, [JSON.stringify({ reason: surgeReason, priceSurgeDetected: true }), purchaseIntentId]);

    return {
      decision: 'BLOCK',
      status: 'blocked',
      reason: surgeReason,
      priceProtectionTriggered: true,
    };
  }

  // 3. Run Deterministic Policy Engine
  const policyResult = await evaluatePolicy({
    agentId: intent.agent_id,
    userId: intent.user_id,
    productId: intent.product_id,
    merchantId: intent.merchant_id,
    amount: intent.amount,
    quantity: intent.quantity || 1,
    idempotencyKey: intent.idempotency_key,
  });

  // 4. Run Explainable Risk Engine
  const riskResult = await assessRisk({
    agentId: intent.agent_id,
    productId: intent.product_id,
    merchantId: intent.merchant_id,
    amount: intent.amount,
    quantity: intent.quantity || 1,
  });

  // 5. Combined Decision Synthesis
  let finalDecision = policyResult.decision;
  let finalReason = policyResult.reason;

  // If policy allows, but risk score is high (>= 70), escalate to APPROVAL_REQUIRED
  if (finalDecision === 'ALLOW' && riskResult.score >= 70) {
    finalDecision = 'APPROVAL_REQUIRED';
    finalReason = `Policy checks passed, but elevated risk score (${riskResult.score}/100) requires human oversight. ${riskResult.explanation}`;
  }

  // Map to status & State Machine State
  let newStatus = 'evaluating';
  let nextState = PurchaseStates.CREATED;

  if (finalDecision === 'ALLOW') {
    newStatus = 'allowed';
    nextState = PurchaseStates.CART_CREATED;
  } else if (finalDecision === 'APPROVAL_REQUIRED') {
    newStatus = 'approval_required';
    nextState = PurchaseStates.USER_AUTHENTICATION_REQUIRED;
  } else if (finalDecision === 'BLOCK') {
    newStatus = 'blocked';
    nextState = PurchaseStates.BLOCKED;
  }

  // 6. Update Purchase Intent in DB
  const updateRes = await query(`
    UPDATE purchase_intents
    SET policy_decision = $1,
        policy_details = $2,
        risk_score = $3,
        risk_details = $4,
        status = $5,
        state = $6,
        updated_at = NOW()
    WHERE id = $7
    RETURNING *
  `, [
    finalDecision,
    JSON.stringify(policyResult),
    riskResult.score,
    JSON.stringify(riskResult),
    newStatus,
    nextState,
    purchaseIntentId,
  ]);

  const updatedIntent = updateRes.rows[0];

  // 7. If APPROVAL_REQUIRED, create or update approval request
  if (finalDecision === 'APPROVAL_REQUIRED') {
    await query(`
      INSERT INTO approvals (purchase_intent_id, agent_id, status)
      VALUES ($1, $2, 'pending')
      ON CONFLICT DO NOTHING
    `, [purchaseIntentId, intent.agent_id]);

    if (io) {
      io.to('approvals').emit('approval:created', {
        intentId: purchaseIntentId,
        agentName: intent.agent_name,
        productName: intent.product_name,
        amount: intent.amount,
        riskScore: riskResult.score,
        reason: finalReason,
      });
    }
  }

  // 8. Record Immutable Audit Event
  await recordAuditEvent({
    eventType: 'PURCHASE_INTENT_EVALUATION',
    actor: 'system',
    agentId: intent.agent_id,
    userId: intent.user_id,
    purchaseIntentId,
    action: 'EVALUATE_PURCHASE_INTENT',
    decision: finalDecision,
    reasoning: finalReason,
    policyVersion: policyResult.policyVersion,
    riskScore: riskResult.score,
    outcome: finalDecision,
    metadata: {
      policyResult,
      riskResult,
      latencyMs: Date.now() - startTime,
    },
    io,
  });

  logger.info('Audit', `[PURCHASE_INTENT_EVALUATION] EVALUATE_PURCHASE_INTENT → ${finalDecision}`, {
    agentId: intent.agent_id,
    purchaseIntentId,
    transactionId: null,
  });

  return {
    decision: finalDecision,
    status: newStatus,
    state: nextState,
    reason: finalReason,
    policyResult,
    riskResult,
    intent: updatedIntent,
  };
}
