import { query } from '../config/database.js';
import { evaluatePolicy } from './policyEngine.js';
import { assessRisk } from './riskEngine.js';
import { recordAuditEvent } from './auditService.js';
import { transitionPurchaseState, PurchaseStates } from './purchaseStateMachine.js';
import { acquireBudgetLock, releaseBudgetLock } from './spendingService.js';
import { logger } from '../utils/logger.js';
import env from '../config/env.js';

/**
 * Transaction Decision Engine with Price Protection & Deterministic Policy Enforcement
 */
export async function evaluatePurchaseIntent(purchaseIntentId, io = null) {
  const startTime = Date.now();

  // 1. Immediate Global Kill Switch Gate
  const sysState = await query('SELECT kill_switch_active FROM system_state WHERE id = 1');
  if (sysState.rows[0]?.kill_switch_active) {
    const killReason = 'Emergency kill switch is active. All financial operations are halted.';
    await transitionPurchaseState(purchaseIntentId, PurchaseStates.BLOCKED, { actor: 'system', reason: killReason, io });
    await query(`
      UPDATE purchase_intents
      SET policy_decision = 'BLOCK',
          status = 'blocked',
          state = $1,
          updated_at = NOW()
      WHERE id = $2
    `, [PurchaseStates.BLOCKED, purchaseIntentId]);

    return {
      decision: 'BLOCK',
      status: 'blocked',
      state: PurchaseStates.BLOCKED,
      reason: killReason,
      rule: 'KILL_SWITCH_ACTIVE',
    };
  }

  // 2. Fetch Purchase Intent with live catalog & policy details
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

  // Acquire concurrency budget lock for the user during policy evaluation
  const releaseLock = await acquireBudgetLock(intent.user_id, 10);
  try {
    // 1b. Authoritative Catalog Product Grounding
    if (!intent.product_id || !intent.product_name) {
      const notFoundReason = `Product ${intent.product_id || 'unknown'} does not exist in authoritative catalog.`;
      await transitionPurchaseState(purchaseIntentId, PurchaseStates.BLOCKED, { actor: 'system', reason: notFoundReason, io });
      await query(`
        UPDATE purchase_intents
        SET policy_decision = 'BLOCK', status = 'blocked', state = $1, updated_at = NOW()
        WHERE id = $2
      `, [PurchaseStates.BLOCKED, purchaseIntentId]);
      return {
        decision: 'BLOCK',
        status: 'blocked',
        state: PurchaseStates.BLOCKED,
        reason: notFoundReason,
        rule: 'PRODUCT_NOT_FOUND',
      };
    }

  // 2. Price Protection Validation
  const intentAmount = parseFloat(intent.amount);
  const catalogPrice = intent.catalog_price ? parseFloat(intent.catalog_price) * (intent.quantity || 1) : intentAmount;
  const applicableDeliveryFee = parseFloat(intent.delivery_fee || 0);
  const expectedTotal = catalogPrice + applicableDeliveryFee;
  const tolerancePercent = env.PRICE_SURGE_TOLERANCE_PERCENT || 2.0;
  const priceSurgeTolerance = 1 + (tolerancePercent / 100);

  if (catalogPrice > 0 && intentAmount > expectedTotal * priceSurgeTolerance && intentAmount > catalogPrice * priceSurgeTolerance) {
    const driftPercent = (((intentAmount - expectedTotal) / expectedTotal) * 100).toFixed(2);
    const surgeReason = `Purchase stopped because the final checkout price (₹${intentAmount.toLocaleString('en-IN')}) exceeds authorized catalog price (₹${catalogPrice.toLocaleString('en-IN')}) by ${driftPercent}% (tolerance: ${tolerancePercent}%).`;
    
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
    nextState = PurchaseStates.AWAITING_APPROVAL;
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

  // 7. If APPROVAL_REQUIRED, create or update approval request with full snapshot & expiration
  if (finalDecision === 'APPROVAL_REQUIRED') {
    const expirationSeconds = parseInt(env.APPROVAL_EXPIRATION_SECONDS || 900, 10);
    const expiresAt = new Date(Date.now() + (expirationSeconds * 1000)).toISOString();
    const currentPrice = intent.catalog_price || (policyResult?.catalogPrice) || intent.amount;

    await query(`
      INSERT INTO approvals (
        purchase_intent_id, agent_id, user_id, product_id, merchant_id,
        quantity, quoted_price, current_price, risk_score, policy_version,
        status, expires_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', $11)
      ON CONFLICT (purchase_intent_id) DO UPDATE SET
        agent_id = EXCLUDED.agent_id,
        user_id = EXCLUDED.user_id,
        product_id = EXCLUDED.product_id,
        merchant_id = EXCLUDED.merchant_id,
        quantity = EXCLUDED.quantity,
        quoted_price = EXCLUDED.quoted_price,
        current_price = EXCLUDED.current_price,
        risk_score = EXCLUDED.risk_score,
        policy_version = EXCLUDED.policy_version,
        expires_at = EXCLUDED.expires_at,
        status = 'pending',
        decision = NULL,
        reason = NULL,
        reviewer_id = NULL,
        decided_at = NULL
    `, [
      purchaseIntentId,
      intent.agent_id,
      intent.user_id,
      intent.product_id,
      intent.merchant_id,
      intent.quantity || 1,
      intent.amount,
      currentPrice,
      riskResult.score,
      policyResult.policyVersion || 'v1',
      expiresAt,
    ]);

    await recordAuditEvent({
      eventType: 'HUMAN_APPROVAL_REQUESTED',
      actor: 'system',
      agentId: intent.agent_id,
      userId: intent.user_id,
      purchaseIntentId,
      action: 'REQUEST_HUMAN_APPROVAL',
      decision: 'APPROVAL_REQUIRED',
      reasoning: finalReason,
      policyVersion: policyResult.policyVersion || 'v1',
      riskScore: riskResult.score,
      outcome: 'Awaiting human review',
      metadata: {
        approvalExpiresAt: expiresAt,
        amount: intent.amount,
        productId: intent.product_id,
        quantity: intent.quantity || 1,
        riskScore: riskResult.score,
      },
      io,
    });

    if (io) {
      io.to('approvals').emit('approval:created', {
        intentId: purchaseIntentId,
        agentName: intent.agent_name,
        productName: intent.product_name,
        amount: intent.amount,
        riskScore: riskResult.score,
        expiresAt,
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
  } finally {
    if (typeof releaseLock === 'function') await releaseLock();
    await releaseBudgetLock(intent.user_id);
  }
}
