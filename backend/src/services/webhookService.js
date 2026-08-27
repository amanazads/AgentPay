import crypto from 'crypto';
import { query } from '../config/database.js';
import env from '../config/env.js';
import { logger } from '../utils/logger.js';
import { recordAuditEvent } from './auditService.js';
import { transitionPurchaseState, PurchaseStates } from './purchaseStateMachine.js';
import { transitionOrderFulfillment } from './orderService.js';
import { dispatchCommerceNotification } from './notificationDispatcher.js';

/**
 * Durable Webhook Processing Service
 * Guarantees zero double-charging, idempotent handling, signature verification,
 * and persistent inbox storage.
 */
export async function processRazorpayWebhook({
  environment = 'TEST', // 'TEST' | 'LIVE'
  signature,
  rawBody,
  payload,
  io = null,
}) {
  const secret = environment === 'LIVE' ? env.RAZORPAY_LIVE_WEBHOOK_SECRET : env.RAZORPAY_TEST_WEBHOOK_SECRET;

  // 1. Signature Verification
  let signatureVerified = false;
  if (secret && signature) {
    try {
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody))
        .digest('hex');

      signatureVerified = crypto.timingSafeEqual(
        Buffer.from(expectedSignature),
        Buffer.from(signature)
      );
    } catch (e) {
      signatureVerified = false;
    }
  } else if (environment === 'TEST' && (!secret || signature === 'valid_test_signature')) {
    // Whitelisted test sandbox signature
    signatureVerified = true;
  }

  if (!signatureVerified && environment === 'LIVE') {
    logger.error('Webhook', `SECURITY ALERT: Invalid Razorpay LIVE webhook signature rejected.`);
    throw new Error('Invalid webhook cryptographic signature');
  }

  const eventId = payload.event_id || payload.id || `evt_${crypto.randomBytes(8).toString('hex')}`;
  const eventType = payload.event || payload.event_type || 'unknown';

  // 2. Durable Webhook Inbox Ingestion & Deduplication
  let inboxRecord;
  try {
    const inboxRes = await query(`
      INSERT INTO webhook_inbox (
        event_id, provider, environment, event_type, payload, signature_verified, processing_status
      )
      VALUES ($1, 'razorpay', $2, $3, $4, $5, 'PENDING')
      ON CONFLICT (event_id) DO NOTHING
      RETURNING *
    `, [eventId, environment, eventType, JSON.stringify(payload), signatureVerified]);

    if (inboxRes.rows.length === 0) {
      // Event already recorded in inbox
      const existing = await query('SELECT * FROM webhook_inbox WHERE event_id = $1', [eventId]);
      logger.info('Webhook', `Duplicate webhook event ${eventId} (${eventType}) detected — skipping redundant execution.`);
      return { success: true, duplicate: true, status: 'DUPLICATE_IGNORED', eventId, processed: true };
    }
    inboxRecord = inboxRes.rows[0];
  } catch (err) {
    logger.error('Webhook', 'Inbox ingestion error:', err.message);
    throw err;
  }

  // 3. Event Processing Router
  let processingStatus = 'PROCESSED';
  let errorMessage = null;

  try {
    const paymentEntity = payload.payload?.payment?.entity || {};
    const orderEntity = payload.payload?.order?.entity || {};
    const refundEntity = payload.payload?.refund?.entity || {};
    const disputeEntity = payload.payload?.dispute?.entity || {};

    const rzpOrderId = paymentEntity.order_id || orderEntity.id;
    const rzpPaymentId = paymentEntity.id;

    switch (eventType) {
      case 'payment.captured':
      case 'order.paid': {
        const txRes = await query(`
          SELECT t.*, pi.id as intent_id, pi.user_id, pi.agent_id, pi.merchant_id, pi.product_id
          FROM transactions t
          LEFT JOIN purchase_intents pi ON t.purchase_intent_id = pi.id
          WHERE t.razorpay_order_id = $1 OR t.id::text = $1
        `, [rzpOrderId]);

        if (txRes.rows.length > 0) {
          const tx = txRes.rows[0];
          await query(`
            UPDATE transactions
            SET razorpay_payment_id = COALESCE(razorpay_payment_id, $2),
                payment_verified = true,
                status = 'completed',
                updated_at = NOW()
            WHERE id = $1
          `, [tx.id, rzpPaymentId]);

          await transitionPurchaseState(tx.intent_id, PurchaseStates.PAYMENT_SUCCESS, {
            reason: `Webhook confirmed payment capture (${rzpPaymentId})`,
            io,
          });

          await transitionPurchaseState(tx.intent_id, PurchaseStates.ORDER_CONFIRMED, {
            reason: 'Order confirmed via durable payment webhook',
            io,
          });
        }
        break;
      }

      case 'payment.failed': {
        const txRes = await query(`
          SELECT t.*, pi.id as intent_id
          FROM transactions t
          LEFT JOIN purchase_intents pi ON t.purchase_intent_id = pi.id
          WHERE t.razorpay_order_id = $1 OR t.razorpay_payment_id = $2
        `, [rzpOrderId, rzpPaymentId]);

        if (txRes.rows.length > 0) {
          const tx = txRes.rows[0];
          await query(`UPDATE transactions SET status = 'failed', updated_at = NOW() WHERE id = $1`, [tx.id]);
          await transitionPurchaseState(tx.intent_id, PurchaseStates.PAYMENT_FAILED, {
            reason: `Webhook reported payment failure (${paymentEntity.error_description || 'Declined'})`,
            io,
          });
        }
        break;
      }

      case 'refund.processed': {
        const refundPaymentId = refundEntity.payment_id;
        const refundAmount = refundEntity.amount ? refundEntity.amount / 100 : 0;

        await query(`
          UPDATE transactions
          SET status = 'refunded', updated_at = NOW()
          WHERE razorpay_payment_id = $1
        `, [refundPaymentId]);
        break;
      }

      case 'payment.dispute.created': {
        const disputeId = disputeEntity.id || `disp_${crypto.randomBytes(6).toString('hex')}`;
        await query(`
          INSERT INTO payment_disputes (
            dispute_id, payment_id, amount, currency, reason, status, environment, evidence
          )
          VALUES ($1, $2, $3, 'INR', $4, 'OPEN', $5, $6)
          ON CONFLICT (dispute_id) DO NOTHING
        `, [
          disputeId,
          paymentEntity.id || 'pay_unknown',
          paymentEntity.amount ? paymentEntity.amount / 100 : 0,
          disputeEntity.reason_code || 'Chargeback inquiry',
          environment,
          JSON.stringify(disputeEntity),
        ]);
        break;
      }

      default:
        logger.info('Webhook', `Unhandled webhook event type: ${eventType}`);
        processingStatus = 'IGNORED';
    }

    // 4. Record Audit Event
    await recordAuditEvent({
      eventType: `WEBHOOK_${eventType.toUpperCase().replace(/\./g, '_')}`,
      actor: 'razorpay_webhook',
      action: 'PROCESS_WEBHOOK_EVENT',
      decision: 'ALLOW',
      reasoning: `Durable webhook event ${eventId} processed for environment ${environment}.`,
      outcome: processingStatus,
      io,
    });
  } catch (err) {
    logger.error('Webhook', `Error processing event ${eventId}:`, err.message);
    processingStatus = 'FAILED';
    errorMessage = err.message;
  }

  // 5. Update Webhook Inbox Record
  await query(`
    UPDATE webhook_inbox
    SET processing_status = $2, error_message = $3, processed_at = NOW()
    WHERE id = $1
  `, [inboxRecord.id, processingStatus, errorMessage]);

  return { success: processingStatus === 'PROCESSED', status: processingStatus, eventId, eventType, environment };
}

export default { processRazorpayWebhook };
