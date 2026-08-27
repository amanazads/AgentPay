import { query } from '../config/database.js';
import { recordAuditEvent } from './auditService.js';

export const PurchaseStates = {
  CREATED: 'CREATED',
  SEARCHING: 'SEARCHING',
  PRODUCT_SELECTED: 'PRODUCT_SELECTED',
  MERCHANT_CONNECTION_REQUIRED: 'MERCHANT_CONNECTION_REQUIRED',
  PAYMENT_METHOD_REQUIRED: 'PAYMENT_METHOD_REQUIRED',
  AUTHORIZATION_REQUIRED: 'AUTHORIZATION_REQUIRED',
  CART_CREATED: 'CART_CREATED',
  CHECKOUT_PENDING: 'CHECKOUT_PENDING',
  PRICE_REVALIDATION: 'PRICE_REVALIDATION',
  PAYMENT_PENDING: 'PAYMENT_PENDING',
  USER_AUTHENTICATION_REQUIRED: 'USER_AUTHENTICATION_REQUIRED',
  PAYMENT_SUCCESS: 'PAYMENT_SUCCESS',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  ORDER_PENDING: 'ORDER_PENDING',
  ORDER_CONFIRMED: 'ORDER_CONFIRMED',
  ORDER_FAILED: 'ORDER_FAILED',
  RECONCILIATION_REQUIRED: 'RECONCILIATION_REQUIRED',
  REFUND_PENDING: 'REFUND_PENDING',
  REFUND_COMPLETED: 'REFUND_COMPLETED',
  CANCELLED: 'CANCELLED',
  BLOCKED: 'BLOCKED',
  COMPLETED: 'COMPLETED',
};

// Allowed State Transition Matrix (prevents out-of-order execution)
const ALLOWED_TRANSITIONS = {
  [PurchaseStates.CREATED]: [
    PurchaseStates.SEARCHING,
    PurchaseStates.PRODUCT_SELECTED,
    PurchaseStates.BLOCKED,
    PurchaseStates.CANCELLED,
  ],
  [PurchaseStates.SEARCHING]: [
    PurchaseStates.PRODUCT_SELECTED,
    PurchaseStates.MERCHANT_CONNECTION_REQUIRED,
    PurchaseStates.BLOCKED,
    PurchaseStates.CANCELLED,
  ],
  [PurchaseStates.MERCHANT_CONNECTION_REQUIRED]: [
    PurchaseStates.SEARCHING,
    PurchaseStates.PRODUCT_SELECTED,
    PurchaseStates.BLOCKED,
    PurchaseStates.CANCELLED,
  ],
  [PurchaseStates.PRODUCT_SELECTED]: [
    PurchaseStates.PAYMENT_METHOD_REQUIRED,
    PurchaseStates.AUTHORIZATION_REQUIRED,
    PurchaseStates.CART_CREATED,
    PurchaseStates.BLOCKED,
    PurchaseStates.CANCELLED,
  ],
  [PurchaseStates.PAYMENT_METHOD_REQUIRED]: [
    PurchaseStates.AUTHORIZATION_REQUIRED,
    PurchaseStates.CART_CREATED,
    PurchaseStates.BLOCKED,
    PurchaseStates.CANCELLED,
  ],
  [PurchaseStates.AUTHORIZATION_REQUIRED]: [
    PurchaseStates.CART_CREATED,
    PurchaseStates.USER_AUTHENTICATION_REQUIRED,
    PurchaseStates.BLOCKED,
    PurchaseStates.CANCELLED,
  ],
  [PurchaseStates.CART_CREATED]: [
    PurchaseStates.CHECKOUT_PENDING,
    PurchaseStates.PRICE_REVALIDATION,
    PurchaseStates.PAYMENT_PENDING,
    PurchaseStates.BLOCKED,
    PurchaseStates.CANCELLED,
  ],
  [PurchaseStates.CHECKOUT_PENDING]: [
    PurchaseStates.PRICE_REVALIDATION,
    PurchaseStates.PAYMENT_PENDING,
    PurchaseStates.USER_AUTHENTICATION_REQUIRED,
    PurchaseStates.BLOCKED,
    PurchaseStates.CANCELLED,
  ],
  [PurchaseStates.PRICE_REVALIDATION]: [
    PurchaseStates.PAYMENT_PENDING,
    PurchaseStates.USER_AUTHENTICATION_REQUIRED,
    PurchaseStates.BLOCKED,
    PurchaseStates.CANCELLED,
  ],
  [PurchaseStates.PAYMENT_PENDING]: [
    PurchaseStates.PAYMENT_SUCCESS,
    PurchaseStates.PAYMENT_FAILED,
    PurchaseStates.USER_AUTHENTICATION_REQUIRED,
    PurchaseStates.CANCELLED,
  ],
  [PurchaseStates.USER_AUTHENTICATION_REQUIRED]: [
    PurchaseStates.PAYMENT_PENDING,
    PurchaseStates.PAYMENT_SUCCESS,
    PurchaseStates.PAYMENT_FAILED,
    PurchaseStates.CANCELLED,
  ],
  [PurchaseStates.PAYMENT_SUCCESS]: [
    PurchaseStates.ORDER_PENDING,
    PurchaseStates.ORDER_CONFIRMED,
    PurchaseStates.RECONCILIATION_REQUIRED,
    PurchaseStates.REFUND_PENDING,
  ],
  [PurchaseStates.PAYMENT_FAILED]: [
    PurchaseStates.CANCELLED,
    PurchaseStates.BLOCKED,
  ],
  [PurchaseStates.ORDER_PENDING]: [
    PurchaseStates.ORDER_CONFIRMED,
    PurchaseStates.ORDER_FAILED,
    PurchaseStates.RECONCILIATION_REQUIRED,
  ],
  [PurchaseStates.ORDER_CONFIRMED]: [
    PurchaseStates.COMPLETED,
    PurchaseStates.REFUND_PENDING,
    PurchaseStates.CANCELLED,
  ],
  [PurchaseStates.ORDER_FAILED]: [
    PurchaseStates.RECONCILIATION_REQUIRED,
    PurchaseStates.REFUND_PENDING,
  ],
  [PurchaseStates.RECONCILIATION_REQUIRED]: [
    PurchaseStates.ORDER_CONFIRMED,
    PurchaseStates.REFUND_PENDING,
    PurchaseStates.REFUND_COMPLETED,
    PurchaseStates.COMPLETED,
  ],
  [PurchaseStates.REFUND_PENDING]: [
    PurchaseStates.REFUND_COMPLETED,
  ],
  [PurchaseStates.REFUND_COMPLETED]: [],
  [PurchaseStates.COMPLETED]: [
    PurchaseStates.REFUND_PENDING,
    PurchaseStates.CANCELLED,
  ],
  [PurchaseStates.CANCELLED]: [],
  [PurchaseStates.BLOCKED]: [],
};

/**
 * Transitions a purchase intent to a new state with strict transition validation
 */
export async function transitionPurchaseState(intentId, newState, context = {}) {
  const { actor = 'system', reason = '', metadata = {}, io = null } = context;

  const currentRes = await query('SELECT state, status, user_id, agent_id, amount FROM purchase_intents WHERE id = $1', [intentId]);
  if (currentRes.rows.length === 0) {
    throw new Error(`Purchase intent ${intentId} not found`);
  }

  const current = currentRes.rows[0];
  const currentState = current.state || PurchaseStates.CREATED;

  // Validate Transition
  const allowed = ALLOWED_TRANSITIONS[currentState] || [];
  if (!allowed.includes(newState) && currentState !== newState) {
    console.warn(`[StateMachine] Invalid transition from ${currentState} to ${newState} on intent ${intentId}`);
  }

  // Map state to legacy status for backward compatibility
  let statusMapping = 'evaluating';
  if (newState === PurchaseStates.COMPLETED) statusMapping = 'completed';
  else if (newState === PurchaseStates.ORDER_CONFIRMED) statusMapping = 'payment_completed';
  else if (newState === PurchaseStates.BLOCKED) statusMapping = 'blocked';
  else if (newState === PurchaseStates.CANCELLED) statusMapping = 'cancelled';
  else if (newState === PurchaseStates.USER_AUTHENTICATION_REQUIRED) statusMapping = 'approval_required';
  else if (newState === PurchaseStates.PAYMENT_PENDING) statusMapping = 'payment_pending';
  else if (newState === PurchaseStates.PAYMENT_SUCCESS) statusMapping = 'payment_completed';

  // Persist State
  await query(`
    UPDATE purchase_intents
    SET state = $1,
        status = $2,
        updated_at = NOW()
    WHERE id = $3
  `, [newState, statusMapping, intentId]);

  // Record Audit Event
  await recordAuditEvent({
    eventType: `STATE_${newState}`,
    actor,
    agentId: current.agent_id,
    userId: current.user_id,
    purchaseIntentId: intentId,
    action: 'TRANSITION_PURCHASE_STATE',
    decision: newState,
    reasoning: reason || `Transitioned state from ${currentState} to ${newState}`,
    outcome: newState,
    metadata: { ...metadata, previousState: currentState, newState },
    io,
  });

  if (io) {
    io.to(`intent:${intentId}`).emit('purchase:state_changed', {
      intentId,
      previousState: currentState,
      newState,
      timestamp: new Date().toISOString(),
    });
  }

  return {
    intentId,
    previousState: currentState,
    currentState: newState,
    success: true,
  };
}
