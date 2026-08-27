import crypto from 'crypto';
import env from '../config/env.js';
import { query } from '../config/database.js';
import { acquireIdempotencyLock, releaseIdempotencyLock } from './idempotencyService.js';
import { recordAuditEvent } from './auditService.js';
import { transitionPurchaseState, PurchaseStates } from './purchaseStateMachine.js';
import { commerceOrchestrator } from './merchantAdapter.js';
import { generateIdempotencyKey } from '../utils/helpers.js';
import { logger } from '../utils/logger.js';
import { getPaymentProvider } from './paymentProvider.js';
import { commitReservation, releaseReservation } from './inventoryService.js';
import { createOrder } from './orderService.js';
import { generateInvoiceForOrder } from './invoiceService.js';
import { getDefaultAddress } from './addressService.js';
import { merchantConnectionService } from './merchantConnectionService.js';
import { paymentMethodService } from './paymentMethodService.js';

/**
 * Creates a Razorpay Order for an authorized purchase intent.
 * Enforces strict authorization validation, environment isolation, platform spending caps, and idempotency locks.
 */
export async function createPaymentOrder(arg1, arg2 = {}) {
  let purchaseIntentId;
  let options = {};
  if (typeof arg1 === 'object' && arg1 !== null) {
    purchaseIntentId = arg1.purchase_intent_id || arg1.purchaseIntentId || arg1.id;
    options = arg1;
  } else {
    purchaseIntentId = arg1;
    options = typeof arg2 === 'object' && arg2 !== null ? arg2 : {};
  }
  const { mode = env.PAYMENT_MODE, quoteId = null, io = null } = options;

  // 1. Fetch Purchase Intent
  const intentRes = await query(`
    SELECT pi.*, a.name as agent_name, p.name as product_name, p.id as prod_id, p.merchant_id as merch_id
    FROM purchase_intents pi
    LEFT JOIN agents a ON pi.agent_id = a.id
    LEFT JOIN products p ON pi.product_id = p.id
    WHERE pi.id = $1
  `, [purchaseIntentId]);

  if (intentRes.rows.length === 0) {
    throw new Error('Purchase intent not found');
  }

  const intent = intentRes.rows[0];
  const amount = parseFloat(intent.amount);

  // 2. Strict Authorization Gate
  const authorizedStatuses = ['allowed', 'approved'];
  if (!authorizedStatuses.includes(intent.status)) {
    throw new Error(`Financial execution denied: Intent status is '${intent.status}'. Must be 'allowed' or 'approved' by AgentPay policy engine.`);
  }

  // 2b. Pre-payment Merchant Connectivity & Payment Authorization Revalidation
  if (intent.user_id && intent.merchant_id) {
    const merchantCheck = await merchantConnectionService.validateMerchantForCheckout(intent.user_id, intent.merchant_id);
    if (!merchantCheck.allowed) {
      throw new Error(`Merchant checkout unavailable: ${merchantCheck.reason}`);
    }

    const authCheck = await paymentMethodService.verifyPaymentAuthorization(intent.user_id, amount);
    if (!authCheck.authorized) {
      throw new Error(`Payment authorization invalid: ${authCheck.reason}`);
    }
  }

  // 3. Environment & Mode Authorization Check
  const effectiveMode = (mode === 'live' && env.isLiveMode) ? 'LIVE' : 'TEST';
  const effectiveEnv = env.APP_ENV.toUpperCase();

  // Platform Safeguards for LIVE Autonomous Commerce
  if (effectiveMode === 'LIVE') {
    if (env.LIVE_AUTONOMOUS_COMMERCE_MODE === 'disabled') {
      throw new Error('SECURITY LOCK: Live autonomous commerce is currently disabled platform-wide.');
    }
    if (amount > env.PLATFORM_MAX_TRANSACTION_LIMIT) {
      throw new Error(`Platform limit exceeded: Maximum allowed autonomous transaction is ₹${env.PLATFORM_MAX_TRANSACTION_LIMIT.toLocaleString('en-IN')}`);
    }
  }

  // 4. Idempotency Check
  const existingTx = await query('SELECT * FROM transactions WHERE purchase_intent_id = $1', [intent.id]);
  if (existingTx.rows.length > 0) {
    const tx = existingTx.rows[0];
    logger.info('Payment', `Existing transaction ${tx.id} found for intent ${intent.id} — returning existing payment order.`);
    return {
      isDuplicate: true,
      transactionId: tx.id,
      orderId: tx.razorpay_order_id,
      amount,
      amountInPaise: Math.round(amount * 100),
      currency: 'INR',
      environment: tx.environment || effectiveEnv,
      paymentMode: tx.payment_mode || effectiveMode,
      isSandbox: (tx.payment_mode || effectiveMode) === 'TEST',
    };
  }

  const idempotencyKey = generateIdempotencyKey(intent.id, amount.toString(), `${effectiveMode}:${intent.policy_decision || 'ALLOW'}`);

  const lockAcquired = await acquireIdempotencyLock(idempotencyKey, 120);
  if (!lockAcquired) {
    // Check if transaction already exists
    const existingTxByKey = await query('SELECT * FROM transactions WHERE idempotency_key = $1', [idempotencyKey]);
    if (existingTxByKey.rows.length > 0) {
      const tx = existingTxByKey.rows[0];
      return {
        isDuplicate: true,
        transactionId: tx.id,
        orderId: tx.razorpay_order_id,
        amount,
        amountInPaise: Math.round(amount * 100),
        currency: 'INR',
        environment: effectiveEnv,
        paymentMode: effectiveMode,
        isSandbox: effectiveMode === 'TEST',
      };
    }
    throw new Error('Duplicate payment processing in progress. Idempotency lock active.');
  }

  try {
    const provider = getPaymentProvider(effectiveMode.toLowerCase());
    const rzpResult = await provider.createOrder({
      amount,
      currency: 'INR',
      receipt: `rcpt_${intent.id.substring(0, 16)}`,
      notes: {
        agent_id: intent.agent_id,
        purchase_intent_id: intent.id,
        product_name: intent.product_name || 'AgentPay Purchase',
        environment: effectiveEnv,
        payment_mode: effectiveMode,
      },
    });

    const orderId = rzpResult.orderId;

    // 5. Create Transaction Record in Database with Explicit Environment & Payment Mode
    const txRes = await query(`
      INSERT INTO transactions (
        purchase_intent_id, agent_id, user_id, amount,
        currency, status, razorpay_order_id, idempotency_key,
        environment, payment_mode
      ) VALUES (
        $1, $2, $3, $4, 'INR', 'payment_pending', $5, $6,
        $7, $8
      ) RETURNING *
    `, [intent.id, intent.agent_id, intent.user_id, amount, orderId, idempotencyKey, effectiveEnv, effectiveMode]);

    const transaction = txRes.rows[0];

    // 6. Update Intent Status & State
    await transitionPurchaseState(intent.id, PurchaseStates.PAYMENT_PENDING, {
      actor: 'system',
      reason: `Payment order ${orderId} initialized with ${effectiveMode} payment provider`,
      metadata: { transactionId: transaction.id, orderId, environment: effectiveEnv, paymentMode: effectiveMode },
      io,
    });

    // 7. Record Audit Event
    await recordAuditEvent({
      eventType: 'PAYMENT_ORDER_CREATED',
      actor: 'system',
      agentId: intent.agent_id,
      userId: intent.user_id,
      transactionId: transaction.id,
      purchaseIntentId: intent.id,
      action: 'CREATE_RAZORPAY_ORDER',
      decision: 'ALLOW',
      policyVersion: intent.policy_details?.policyVersion || 'v1',
      reasoning: `Authorized Razorpay ${effectiveMode} order created for ₹${amount.toLocaleString('en-IN')}`,
      paymentId: orderId,
      outcome: `Order initialized on ${effectiveMode} rails`,
      metadata: { razorpayOrderId: orderId, amount, environment: effectiveEnv, paymentMode: effectiveMode },
      io,
    });

    if (io) {
      io.to('dashboard').emit('payment:order_created', {
        transactionId: transaction.id,
        orderId,
        amount,
        intentId: intent.id,
        environment: effectiveEnv,
        paymentMode: effectiveMode,
      });
    }

    return {
      transactionId: transaction.id,
      orderId,
      amount,
      amountInPaise: Math.round(amount * 100),
      currency: 'INR',
      keyId: rzpResult.keyId,
      environment: effectiveEnv,
      paymentMode: effectiveMode,
      isSandbox: effectiveMode === 'TEST',
    };
  } finally {
    await releaseIdempotencyLock(idempotencyKey);
  }
}

/**
 * Verifies Razorpay payment signature server-side and finalizes transaction.
 */
export async function verifyPayment({
  transactionId,
  razorpayOrderId,
  razorpayPaymentId,
  razorpaySignature,
  quoteId = null,
  io = null,
}) {
  // 1. Fetch transaction with intent and merchant details
  const txRes = await query(`
    SELECT t.*, pi.agent_id, pi.user_id, pi.id as intent_id, pi.amount, pi.merchant_id, pi.product_id,
           a.name as agent_name, p.name as product_name, m.name as merchant_name
    FROM transactions t
    JOIN purchase_intents pi ON t.purchase_intent_id = pi.id
    LEFT JOIN agents a ON pi.agent_id = a.id
    LEFT JOIN products p ON pi.product_id = p.id
    LEFT JOIN merchants m ON pi.merchant_id = m.id
    WHERE t.id::text = $1 OR t.razorpay_order_id = $2
  `, [transactionId || null, razorpayOrderId || null]);

  if (txRes.rows.length === 0) {
    throw new Error('Transaction record not found');
  }

  const tx = txRes.rows[0];

  // Idempotency: If transaction is already completed, return existing verified record
  if (tx.status === 'completed' && tx.payment_verified) {
    logger.info('Payment', `Transaction ${tx.id} already verified & completed — returning existing order idempotently.`);
    const existingOrderRes = await query('SELECT * FROM orders WHERE transaction_id = $1 OR purchase_intent_id = $2', [tx.id, tx.intent_id]);
    return {
      verified: true,
      isDuplicate: true,
      transaction: tx,
      order: existingOrderRes.rows[0] || null,
    };
  }

  const effectiveMode = (tx.payment_mode || env.PAYMENT_MODE).toLowerCase();
  const provider = getPaymentProvider(effectiveMode);

  // 2. Cryptographic Signature Verification via Provider
  const verifyResult = await provider.verifyPayment({
    orderId: razorpayOrderId || tx.razorpay_order_id,
    paymentId: razorpayPaymentId,
    signature: razorpaySignature,
  });

  if (!verifyResult.verified) {
    await recordAuditEvent({
      eventType: 'PAYMENT_VERIFICATION_FAILED',
      actor: 'system',
      agentId: tx.agent_id,
      userId: tx.user_id,
      transactionId: tx.id,
      purchaseIntentId: tx.intent_id,
      action: 'VERIFY_PAYMENT_SIGNATURE',
      decision: 'BLOCK',
      outcome: 'Invalid signature. Potential tamper attempt.',
      metadata: { transactionId: tx.id, razorpayOrderId, razorpayPaymentId, environment: tx.environment },
      io,
    });

    if (quoteId) {
      await releaseReservation(quoteId, 'Payment signature verification failed');
    }

    throw new Error('Payment signature verification failed. Tampering detected.');
  }

  // 2b. Re-verify Payment Authorization is still active (Fail-closed on mid-flight revocation)
  if (tx.user_id) {
    const authCheck = await paymentMethodService.verifyPaymentAuthorization(tx.user_id, parseFloat(tx.amount));
    if (!authCheck.authorized) {
      if (quoteId) {
        await releaseReservation(quoteId, 'Payment authorization was revoked before verification');
      }
      throw new Error(`Payment verification halted: ${authCheck.reason}`);
    }
  }

  // 3. Update Transaction Record as Verified
  const updatedTx = await query(`
    UPDATE transactions SET
      razorpay_payment_id = $2,
      razorpay_signature = $3,
      payment_verified = true,
      status = 'completed',
      updated_at = NOW()
    WHERE id = $1
    RETURNING *
  `, [tx.id, razorpayPaymentId, razorpaySignature]);

  // 4. Commit Inventory Reservation
  if (quoteId) {
    await commitReservation(quoteId);
  }

  // 5. Create Confirmed Order & Invoice (Idempotent)
  let confirmedOrder = null;
  const existingOrderRes = await query('SELECT * FROM orders WHERE transaction_id = $1 OR purchase_intent_id = $2', [tx.id, tx.intent_id]);
  if (existingOrderRes.rows.length > 0) {
    confirmedOrder = existingOrderRes.rows[0];
  } else {
    try {
      const deliveryAddress = await getDefaultAddress(tx.user_id);
      confirmedOrder = await createOrder({
        purchaseIntentId: tx.intent_id,
        transactionId: tx.id,
        userId: tx.user_id,
        merchantId: tx.merchant_id,
        productId: tx.product_id,
        quantity: 1,
        unitPrice: parseFloat(tx.amount),
        subtotal: parseFloat(tx.amount),
        discount: 0,
        tax: Math.round(parseFloat(tx.amount) * 0.18),
        deliveryFee: 0,
        totalAmount: parseFloat(tx.amount),
        paymentMethod: 'PREPAID',
        paymentStatus: 'VERIFIED',
        deliveryAddress,
        deliveryMethod: 'STANDARD',
        carrier: 'AgentPay Express Logistics',
        io,
      });

      await generateInvoiceForOrder(confirmedOrder.id, {
        paymentReference: razorpayPaymentId,
        io,
      });
    } catch (ordErr) {
      logger.warn('Payment', 'Order or invoice generation notice during verifyPayment:', ordErr.message);
    }
  }

  // 6. State Machine Transition
  await transitionPurchaseState(tx.intent_id, PurchaseStates.PAYMENT_SUCCESS, {
    actor: 'system',
    reason: `Payment ${razorpayPaymentId} successfully verified on ${tx.payment_mode || 'TEST'} rails.`,
    metadata: { paymentId: razorpayPaymentId, transactionId: tx.id, orderId: confirmedOrder?.id },
    io,
  });

  await transitionPurchaseState(tx.intent_id, PurchaseStates.ORDER_CONFIRMED, {
    actor: 'system',
    reason: 'Payment confirmed. Merchant order confirmed.',
    metadata: { paymentId: razorpayPaymentId, transactionId: tx.id, orderId: confirmedOrder?.id },
    io,
  });

  await transitionPurchaseState(tx.intent_id, PurchaseStates.COMPLETED, {
    actor: 'system',
    reason: 'Autonomous transaction flow completed successfully.',
    metadata: { paymentId: razorpayPaymentId, orderId: confirmedOrder?.id },
    io,
  });

  // 7. Record Audit Event
  await recordAuditEvent({
    eventType: 'PAYMENT_VERIFIED',
    actor: 'system',
    agentId: tx.agent_id,
    userId: tx.user_id,
    transactionId: tx.id,
    purchaseIntentId: tx.intent_id,
    action: 'CONFIRM_PAYMENT_SUCCESS',
    decision: 'ALLOW',
    reasoning: `Cryptographic HMAC signature verified. Payment captured on ${tx.payment_mode || 'TEST'} rails.`,
    paymentId: razorpayPaymentId,
    outcome: 'Transaction confirmed',
    metadata: {
      amount: tx.amount,
      razorpayPaymentId,
      environment: tx.environment,
      paymentMode: tx.payment_mode,
      orderId: confirmedOrder?.id,
    },
    io,
  });

  return {
    success: true,
    verified: true,
    status: 'payment_completed',
    transaction: updatedTx.rows[0],
    environment: tx.environment,
    paymentMode: tx.payment_mode,
  };
}

/**
 * Refunds a completed transaction through the appropriate payment provider
 */
export async function refundTransaction({ transactionId, amount, reason = 'Buyer cancellation', io = null }) {
  const txRes = await query('SELECT * FROM transactions WHERE id = $1', [transactionId]);
  if (txRes.rows.length === 0) {
    throw new Error(`Transaction ${transactionId} not found`);
  }

  const tx = txRes.rows[0];
  const effectiveMode = (tx.payment_mode || env.PAYMENT_MODE).toLowerCase();
  const provider = getPaymentProvider(effectiveMode);

  const refundRes = await provider.refundPayment({
    paymentId: tx.razorpay_payment_id,
    amount: amount || parseFloat(tx.amount),
    notes: { reason, transactionId: tx.id },
  });

  await query(`
    UPDATE transactions SET
      status = 'refunded',
      updated_at = NOW()
    WHERE id = $1
  `, [tx.id]);

  await recordAuditEvent({
    eventType: 'PAYMENT_REFUNDED',
    actor: 'admin',
    transactionId: tx.id,
    purchaseIntentId: tx.purchase_intent_id,
    action: 'PROCESS_REFUND',
    decision: 'ALLOW',
    reasoning: `Refund of ₹${(amount || tx.amount).toLocaleString('en-IN')} processed on ${tx.payment_mode || 'TEST'} rails. Reason: ${reason}`,
    outcome: 'REFUNDED',
    metadata: { refundId: refundRes.refundId, environment: tx.environment },
    io,
  });

  return {
    success: true,
    refundId: refundRes.refundId,
    status: 'REFUNDED',
    amount: amount || tx.amount,
  };
}

export default {
  createPaymentOrder,
  verifyPayment,
  refundTransaction,
};
