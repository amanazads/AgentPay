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
import { calculatePrice, toRazorpayAmount } from './pricingService.js';
import { verifyQuoteForCheckout, consumeQuote, cancelQuote } from './quoteService.js';

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

  // 1a. Immediate Server-Side Global Kill Switch Gate
  const sysState = await query('SELECT kill_switch_active FROM system_state WHERE id = 1');
  if (sysState.rows[0]?.kill_switch_active) {
    const err = new Error('Emergency kill switch is active. Financial execution is halted.');
    err.status = 503;
    throw err;
  }

  // 1b. Server-Side Per-Agent Active Status Check
  if (intent.agent_id) {
    const agentRes = await query('SELECT status, name FROM agents WHERE id = $1', [intent.agent_id]);
    const agentStatus = agentRes.rows[0]?.status;
    if (agentStatus && agentStatus !== 'active') {
      const err = new Error(`Financial execution denied: Agent '${agentRes.rows[0]?.name}' is suspended/disabled (${agentStatus}).`);
      err.status = 403;
      throw err;
    }
  }

  const requestedMode = (mode || '').toLowerCase();
  if (requestedMode === 'live') {
    if (!env.isLiveMode || !env.hasLiveRazorpayKeys || !env.RAZORPAY_LIVE_KEY_ID || env.RAZORPAY_LIVE_KEY_ID.startsWith('rzp_test_')) {
      throw new Error('FATAL SECURITY LOCK: LIVE payment mode requested but valid live credentials (starting with rzp_live_) are missing or unconfigured. Fail closed.');
    }
  }

  const effectiveMode = (requestedMode === 'live' && env.isLiveMode) ? 'LIVE' : 'TEST';
  const effectiveEnv = effectiveMode;

  // 1b. Early Idempotency Check: if transaction already created for this intent, return it immediately
  const existingTx = await query('SELECT * FROM transactions WHERE purchase_intent_id = $1', [intent.id]);
  if (existingTx.rows.length > 0) {
    const tx = existingTx.rows[0];
    logger.info('Payment', `Existing transaction ${tx.id} found for intent ${intent.id} — returning existing payment order.`);
    return {
      isDuplicate: true,
      transactionId: tx.id,
      orderId: tx.razorpay_order_id,
      amount,
      amountInPaise: toRazorpayAmount(amount),
      currency: 'INR',
      environment: tx.environment || effectiveEnv,
      paymentMode: tx.payment_mode || effectiveMode,
    };
  }

  const idempotencyKey = generateIdempotencyKey(intent.id, amount.toString(), `${effectiveMode}:${intent.policy_decision || 'ALLOW'}`);

  const lockAcquired = await acquireIdempotencyLock(idempotencyKey, 120);
  if (!lockAcquired) {
    // Wait for in-flight concurrent completion
    for (let attempt = 0; attempt < 60; attempt++) {
      await new Promise((r) => setTimeout(r, 100));
      const existingTxByKey = await query('SELECT * FROM transactions WHERE idempotency_key = $1 OR purchase_intent_id = $2', [idempotencyKey, intent.id]);
      if (existingTxByKey.rows.length > 0) {
        const tx = existingTxByKey.rows[0];
        return {
          isDuplicate: true,
          transactionId: tx.id,
          orderId: tx.razorpay_order_id,
          amount,
          amountInPaise: toRazorpayAmount(amount),
          currency: 'INR',
          environment: tx.environment || effectiveEnv,
          paymentMode: tx.payment_mode || effectiveMode,
        };
      }
    }
    throw new Error('Duplicate payment processing in progress. Idempotency lock active.');
  }

  // 1c. Double-checked locking: Verify if a transaction was committed by the previous lock holder
  const postLockTx = await query('SELECT * FROM transactions WHERE purchase_intent_id = $1', [intent.id]);
  if (postLockTx.rows.length > 0) {
    await releaseIdempotencyLock(idempotencyKey);
    const tx = postLockTx.rows[0];
    return {
      isDuplicate: true,
      transactionId: tx.id,
      orderId: tx.razorpay_order_id,
      amount,
      amountInPaise: toRazorpayAmount(amount),
      currency: 'INR',
      environment: tx.environment || effectiveEnv,
      paymentMode: tx.payment_mode || effectiveMode,
    };
  }

  // 2. Strict Authorization Gate
  const authorizedStatuses = ['allowed', 'approved', 'completed', 'paid'];
  if (!authorizedStatuses.includes(intent.status)) {
    await releaseIdempotencyLock(idempotencyKey);
    throw new Error(`Financial execution denied: Intent status is '${intent.status}'. Must be 'allowed' or 'approved' by AgentPay policy engine.`);
  }

  // 2a. Human Approval Integrity Verification (if intent has an approval record or policy decision required approval)
  if (intent.status === 'approved') {
    const appCheckRes = await query('SELECT * FROM approvals WHERE purchase_intent_id = $1', [intent.id]);
    if (appCheckRes.rows.length > 0) {
      const appRecord = appCheckRes.rows[0];
      if (appRecord.status !== 'approved' || appRecord.decision !== 'APPROVE') {
        await releaseIdempotencyLock(idempotencyKey);
        throw new Error(`Financial execution denied: Approval state mismatch. Approval record is '${appRecord.status}' / '${appRecord.decision}'.`);
      }

      // Verify approval snapshot parameters cannot be reused or modified
      if (appRecord.product_id && appRecord.product_id !== intent.product_id) {
        await releaseIdempotencyLock(idempotencyKey);
        throw new Error('Security Violation: Approval record is bound to a different product ID.');
      }
      if (appRecord.quantity && appRecord.quantity !== intent.quantity) {
        await releaseIdempotencyLock(idempotencyKey);
        throw new Error('Security Violation: Approval record is bound to a different purchase quantity.');
      }
      if (appRecord.quoted_price && parseFloat(appRecord.quoted_price) !== amount) {
        await releaseIdempotencyLock(idempotencyKey);
        throw new Error('Security Violation: Approval record is bound to a different authorized amount.');
      }
      if (appRecord.expires_at && new Date(appRecord.expires_at) < new Date()) {
        await releaseIdempotencyLock(idempotencyKey);
        throw new Error('Financial execution denied: Approval record has expired.');
      }
    } else if (intent.policy_decision === 'APPROVAL_REQUIRED') {
      await releaseIdempotencyLock(idempotencyKey);
      throw new Error('Financial execution denied: Approval record missing for approved purchase intent.');
    }
  }

  // 2b. Live Inventory Availability Check
  if (intent.product_id) {
    const prodStockRes = await query('SELECT inventory, in_stock, name FROM products WHERE id = $1', [intent.product_id]);
    if (prodStockRes.rows.length === 0) {
      await releaseIdempotencyLock(idempotencyKey);
      throw new Error(`Product ${intent.product_id} no longer exists in catalog.`);
    }
    const prodStock = prodStockRes.rows[0];
    const qty = intent.quantity || 1;
    if (!prodStock.in_stock || prodStock.inventory < qty) {
      await recordAuditEvent({
        eventType: 'INVENTORY_UNAVAILABLE_POST_APPROVAL',
        actor: 'system',
        userId: intent.user_id,
        agentId: intent.agent_id,
        purchaseIntentId: intent.id,
        action: 'INVENTORY_PRE_PAYMENT_VALIDATION',
        decision: 'BLOCK',
        reasoning: `Product '${prodStock.name}' is out of stock or requested quantity (${qty}) exceeds available inventory (${prodStock.inventory}).`,
        outcome: 'Payment creation aborted — out of stock',
        io,
      });
      await releaseIdempotencyLock(idempotencyKey);
      throw new Error(`Inventory unavailable: Product '${prodStock.name}' is out of stock or inventory (${prodStock.inventory}) is insufficient for quantity ${qty}.`);
    }
  }

  // 2c. Pre-payment Merchant Connectivity & Payment Authorization Revalidation
  if (intent.user_id && intent.merchant_id) {
    const merchantCheck = await merchantConnectionService.validateMerchantForCheckout(intent.user_id, intent.merchant_id);
    if (!merchantCheck.allowed) {
      await releaseIdempotencyLock(idempotencyKey);
      throw new Error(`Merchant checkout unavailable: ${merchantCheck.reason}`);
    }

    const authCheck = await paymentMethodService.verifyPaymentAuthorization(intent.user_id, amount);
    if (!authCheck.authorized) {
      await releaseIdempotencyLock(idempotencyKey);
      throw new Error(`Payment authorization invalid: ${authCheck.reason}`);
    }
  }

  // 2c. Cryptographic Quote Verification (if quote provided or linked to intent)
  const targetQuote = options.quote || quoteId || intent.quote_id;
  if (targetQuote) {
    try {
      const quoteVerification = await verifyQuoteForCheckout(targetQuote, {
        userId: intent.user_id,
        agentId: intent.agent_id,
        intentId: intent.id,
        purchaseIntentId: intent.id,
        requestedProductId: intent.product_id,
        requestedMerchantId: intent.merchant_id,
        requestedQuantity: intent.quantity,
        requestedAmount: amount,
      });
      const verifiedQuoteId = quoteVerification.quote?.quoteId || (typeof targetQuote === 'string' ? targetQuote : targetQuote.quoteId);
      if (verifiedQuoteId) {
        await query('UPDATE purchase_intents SET quote_id = $1 WHERE id = $2', [verifiedQuoteId, intent.id]);
      }
    } catch (qvErr) {
      await releaseIdempotencyLock(idempotencyKey);
      throw qvErr;
    }
  } else if (intent.product_id) {
    // Re-read authoritative product price from database
    const prodRes = await query('SELECT * FROM products WHERE id = $1', [intent.product_id]);
    if (prodRes.rows.length === 0) {
      await releaseIdempotencyLock(idempotencyKey);
      throw new Error(`Product ${intent.product_id} no longer exists in catalog.`);
    }
    const dbProduct = prodRes.rows[0];
    const qty = intent.quantity || 1;
    const pricing = calculatePrice({ product: dbProduct, quantity: qty });
    const tolerancePercent = env.PRICE_SURGE_TOLERANCE_PERCENT || 2.0;
    const surgeMultiplier = 1 + (tolerancePercent / 100);

    if (amount > pricing.totalAmount * surgeMultiplier) {
      const driftPercent = (((amount - pricing.totalAmount) / pricing.totalAmount) * 100).toFixed(2);
      await recordAuditEvent({
        eventType: 'PRICE_SURGE_DETECTED',
        actor: 'system',
        userId: intent.user_id,
        agentId: intent.agent_id,
        purchaseIntentId: intent.id,
        action: 'PRICE_INTEGRITY_CHECK',
        decision: 'BLOCK',
        reasoning: `Payment amount (₹${amount}) exceeds authoritative total (₹${pricing.totalAmount}) by ${driftPercent}%, exceeding allowed tolerance of ${tolerancePercent}%.`,
        outcome: 'Payment creation aborted.',
      });
      await releaseIdempotencyLock(idempotencyKey);
      throw new Error(`Price surge detected: Checkout amount (₹${amount}) exceeds authoritative catalog price (₹${pricing.totalAmount}) by ${driftPercent}%.`);
    }
  }

  // 3. Environment & Mode Authorization Check
  // Platform Safeguards for LIVE Autonomous Commerce
  if (effectiveMode === 'LIVE') {
    if (env.LIVE_AUTONOMOUS_COMMERCE_MODE === 'disabled') {
      await releaseIdempotencyLock(idempotencyKey);
      throw new Error('SECURITY LOCK: Live autonomous commerce is currently disabled platform-wide.');
    }
    if (amount > env.PLATFORM_MAX_TRANSACTION_LIMIT) {
      await releaseIdempotencyLock(idempotencyKey);
      throw new Error(`Platform limit exceeded: Maximum allowed autonomous transaction is ₹${env.PLATFORM_MAX_TRANSACTION_LIMIT.toLocaleString('en-IN')}`);
    }
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

    let transaction;
    try {
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
      transaction = txRes.rows[0];
    } catch (insertErr) {
      if (insertErr.code === '23505') {
        const existingTxAfterRace = await query('SELECT * FROM transactions WHERE purchase_intent_id = $1 OR idempotency_key = $2', [intent.id, idempotencyKey]);
        if (existingTxAfterRace.rows.length > 0) {
          const tx = existingTxAfterRace.rows[0];
          logger.info('Payment', `Concurrent transaction creation caught by unique constraint for intent ${intent.id} — returning existing transaction ${tx.id}.`);
          return {
            isDuplicate: true,
            transactionId: tx.id,
            orderId: tx.razorpay_order_id,
            amount,
            amountInPaise: toRazorpayAmount(amount),
            currency: 'INR',
            environment: tx.environment || effectiveEnv,
            paymentMode: tx.payment_mode || effectiveMode,
          };
        }
      }
      throw insertErr;
    }

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
      amountInPaise: toRazorpayAmount(amount),
      currency: 'INR',
      keyId: rzpResult.keyId,
      environment: effectiveEnv,
      paymentMode: effectiveMode,
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
    SELECT t.*, pi.agent_id, pi.user_id, pi.id as intent_id, pi.amount, pi.quantity as intent_quantity, pi.merchant_id, pi.product_id,
           a.name as agent_name, p.name as product_name, p.price as product_price, m.name as merchant_name
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

    const targetQuoteId = quoteId || (await query('SELECT quote_id FROM purchase_intents WHERE id = $1', [tx.intent_id])).rows[0]?.quote_id;

    if (targetQuoteId) {
      await releaseReservation(targetQuoteId, 'Payment signature verification failed');
      await cancelQuote(targetQuoteId, 'Payment signature verification failed').catch(() => {});
    }

    throw new Error('Payment signature verification failed. Tampering detected.');
  }

  // 2b. Re-verify Payment Authorization is still active (Fail-closed on mid-flight revocation)
  if (tx.user_id) {
    const authCheck = await paymentMethodService.verifyPaymentAuthorization(tx.user_id, parseFloat(tx.amount));
    if (!authCheck.authorized) {
      const targetQuoteId = quoteId || (await query('SELECT quote_id FROM purchase_intents WHERE id = $1', [tx.intent_id])).rows[0]?.quote_id;
      if (targetQuoteId) {
        await releaseReservation(targetQuoteId, 'Payment authorization was revoked before verification');
        await cancelQuote(targetQuoteId, 'Payment authorization was revoked before verification').catch(() => {});
      }
      throw new Error(`Payment verification halted: ${authCheck.reason}`);
    }
  }

  // 2c. Global Kill Switch Check during Payment Verification (Safely transitions to reconciliation)
  const sysState = await query('SELECT kill_switch_active FROM system_state WHERE id = 1');
  if (sysState.rows[0]?.kill_switch_active) {
    await query(`
      UPDATE transactions SET
        status = 'payment_pending',
        state = 'RECONCILIATION_REQUIRED',
        updated_at = NOW()
      WHERE id = $1
    `, [tx.id]);

    await query(`
      UPDATE purchase_intents SET
        status = 'evaluating',
        state = 'RECONCILIATION_REQUIRED',
        updated_at = NOW()
      WHERE id = $1
    `, [tx.intent_id]);

    await recordAuditEvent({
      eventType: 'KILL_SWITCH_IN_FLIGHT_HELD',
      actor: 'system',
      userId: tx.user_id,
      agentId: tx.agent_id,
      purchaseIntentId: tx.intent_id,
      transactionId: tx.id,
      action: 'HOLD_PAYMENT_UNDER_KILL_SWITCH',
      decision: 'HOLD',
      reasoning: 'Emergency kill switch is active. In-flight payment held for reconciliation.',
      outcome: 'Payment held for post-emergency reconciliation.',
      io,
    });

    const err = new Error('Emergency kill switch is active. In-flight payment held for reconciliation.');
    err.status = 503;
    throw err;
  }

  // 2d. Per-Agent Active Status Check during Payment Verification
  if (tx.agent_id) {
    const agentRes = await query('SELECT status, name FROM agents WHERE id = $1', [tx.agent_id]);
    const agentStatus = agentRes.rows[0]?.status;
    if (agentStatus && agentStatus !== 'active') {
      const err = new Error(`Financial execution denied: Agent '${agentRes.rows[0]?.name}' is suspended/disabled (${agentStatus}).`);
      err.status = 403;
      throw err;
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

  // 4. Commit Inventory Reservation & Consume Quote
  const finalQuoteId = quoteId || (await query('SELECT quote_id FROM purchase_intents WHERE id = $1', [tx.intent_id])).rows[0]?.quote_id;
  if (finalQuoteId) {
    await commitReservation(finalQuoteId);
    await consumeQuote(finalQuoteId).catch(() => {});
  }

  // 5. Create Confirmed Order & Invoice (Idempotent)
  let confirmedOrder = null;
  const existingOrderRes = await query('SELECT * FROM orders WHERE transaction_id = $1 OR purchase_intent_id = $2', [tx.id, tx.intent_id]);
  if (existingOrderRes.rows.length > 0) {
    confirmedOrder = existingOrderRes.rows[0];
  } else {
    try {
      const deliveryAddress = await getDefaultAddress(tx.user_id);
      let quoteRow = null;
      if (finalQuoteId) {
        const qRes = await query('SELECT * FROM quotes WHERE id = $1', [finalQuoteId]);
        if (qRes.rows.length > 0) quoteRow = qRes.rows[0];
      }

      const prodRes = await query('SELECT * FROM products WHERE id = $1', [tx.product_id]);
      const dbProd = prodRes.rows[0] || null;

      const qty = quoteRow ? parseInt(quoteRow.quantity, 10) : Math.max(1, parseInt(tx.intent_quantity, 10) || 1);
      const deliveryMethod = quoteRow ? quoteRow.delivery_method : 'STANDARD';

      const pricing = quoteRow ? {
        unitPrice: parseFloat(quoteRow.unit_price),
        quantity: qty,
        subtotal: parseFloat(quoteRow.subtotal),
        deliveryFee: parseFloat(quoteRow.delivery_fee),
        taxAmount: parseFloat(quoteRow.tax),
        discountAmount: 0,
        totalAmount: parseFloat(quoteRow.total_amount),
      } : (dbProd ? calculatePrice({
        product: dbProd,
        quantity: qty,
        deliveryMethod,
      }) : {
        unitPrice: Math.round((parseFloat(tx.amount) / qty) * 100) / 100,
        quantity: qty,
        subtotal: Math.round(parseFloat(tx.amount) * 100) / 100,
        deliveryFee: 0,
        taxAmount: Math.round(parseFloat(tx.amount) * 0.18 * 100) / 100,
        discountAmount: 0,
        totalAmount: Math.round(parseFloat(tx.amount) * 100) / 100,
      });

      // Pricing Integrity Check: Transaction amount must equal calculated order total
      if (Math.abs(parseFloat(tx.amount) - pricing.totalAmount) > 0.05) {
        throw new Error(`Payment verification rejected: Transaction amount (₹${tx.amount}) does not match authoritative total (₹${pricing.totalAmount})`);
      }

      confirmedOrder = await createOrder({
        purchaseIntentId: tx.intent_id,
        transactionId: tx.id,
        userId: tx.user_id,
        merchantId: tx.merchant_id,
        productId: tx.product_id,
        quantity: pricing.quantity,
        unitPrice: pricing.unitPrice,
        subtotal: pricing.subtotal,
        discount: pricing.discountAmount,
        tax: pricing.taxAmount,
        deliveryFee: pricing.deliveryFee,
        totalAmount: pricing.totalAmount,
        paymentMethod: 'PREPAID',
        paymentStatus: 'VERIFIED',
        deliveryAddress,
        deliveryMethod,
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
    order: confirmedOrder,
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
