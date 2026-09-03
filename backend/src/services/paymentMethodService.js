import { query } from '../config/database.js';
import env from '../config/env.js';
import { recordAuditEvent } from './auditService.js';
import { logger } from '../utils/logger.js';

/**
 * Payment Authorization & Mandate Service for AgentPay
 * 
 * Manages tokenized payment authorizations, sandbox test mandates, and transaction spending limits.
 * 
 * Absolute Security Invariant:
 * AgentPay NEVER stores or exposes raw UPI PINs, CVVs, OTPs, bank passwords, or mandate secrets.
 */
export class PaymentMethodService {
  /**
   * Retrieves all active and configured payment authorizations for a buyer
   */
  async getUserPaymentMethods(userId, options = {}) {
    if (!userId) {
      throw new Error('User ID is required for payment methods retrieval');
    }

    const res = await query(`
      SELECT 
        id,
        user_id as buyer_id,
        provider,
        method_type,
        identifier_masked,
        COALESCE(single_transaction_limit, max_limit, 50000.00) as single_transaction_limit,
        COALESCE(max_limit, single_transaction_limit, 50000.00) as max_limit,
        COALESCE(daily_limit, 100000.00) as daily_limit,
        COALESCE(monthly_limit, 200000.00) as monthly_limit,
        COALESCE(currency, 'INR') as currency,
        is_default,
        status,
        COALESCE(auth_environment, 'SANDBOX') as auth_environment,
        created_at,
        expires_at,
        revoked_at,
        revoked_reason,
        last_used_at
      FROM user_payment_methods
      WHERE user_id = $1
      ORDER BY is_default DESC, created_at DESC
    `, [userId]);

    // Truthfulness: If no record exists, return [] in live mode or when skipAutoSeed is requested
    if (res.rows.length === 0) {
      if (options.skipAutoSeed || options.autoSeed === false || env.isLiveMode) {
        return [];
      }
      const defaultAuth = await this.addPaymentMethod(userId, {
        provider: 'razorpay_sandbox',
        method_type: 'upi_mandate',
        identifier_masked: 'user@okaxis (Sandbox Mandate)',
        single_transaction_limit: 50000.00,
        is_default: true,
      });
      return [defaultAuth];
    }

    return res.rows.map((row) => ({
      ...row,
      single_transaction_limit: parseFloat(row.single_transaction_limit),
      max_limit: parseFloat(row.max_limit),
      daily_limit: parseFloat(row.daily_limit),
      monthly_limit: parseFloat(row.monthly_limit),
      isExpired: row.expires_at ? new Date(row.expires_at) < new Date() : false,
      isRevoked: row.status === 'revoked' || Boolean(row.revoked_at),
      isActive: row.status === 'active' && (!row.expires_at || new Date(row.expires_at) > new Date()),
    }));
  }

  /**
   * Authorizes a new bounded payment mandate (Sandbox / Tokenized)
   */
  async addPaymentMethod(userId, data = {}) {
    if (!userId) {
      throw new Error('User ID is required for payment authorization');
    }

    const {
      provider = 'razorpay_sandbox',
      method_type = 'upi_mandate',
      identifier_masked = 'user@okaxis (Sandbox Mandate)',
      single_transaction_limit = 50000.00,
      daily_limit = 100000.00,
      monthly_limit = 200000.00,
      is_default = true,
      token_ref = `tok_sbx_${Date.now().toString(36)}`,
    } = data;

    const limitVal = parseFloat(single_transaction_limit || data.max_limit || 50000.00);

    if (is_default) {
      await query(`
        UPDATE user_payment_methods
        SET is_default = false
        WHERE user_id = $1
      `, [userId]);
    }

    const res = await query(`
      INSERT INTO user_payment_methods (
        user_id, provider, method_type, identifier_masked, max_limit, single_transaction_limit,
        daily_limit, monthly_limit, currency, is_default, status, token_ref, auth_environment,
        expires_at, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $5, $6, $7, 'INR', $8, 'active', $9, 'SANDBOX', NOW() + INTERVAL '1 year', NOW(), NOW())
      RETURNING *
    `, [
      userId,
      provider,
      method_type,
      identifier_masked,
      limitVal,
      daily_limit,
      monthly_limit,
      is_default,
      token_ref,
    ]);

    const created = res.rows[0];

    await recordAuditEvent({
      eventType: 'PAYMENT_AUTHORIZED',
      actor: 'buyer',
      userId,
      action: 'ESTABLISH_PAYMENT_AUTHORIZATION',
      decision: 'ALLOW',
      reasoning: `Buyer established ${method_type} payment authorization with ₹${limitVal.toLocaleString('en-IN')} single-transaction ceiling.`,
      metadata: { authorizationId: created.id, provider, singleTransactionLimit: limitVal },
    }).catch((err) => logger.warn('PaymentMethodService', `Audit log error: ${err.message}`));

    return {
      ...created,
      single_transaction_limit: parseFloat(created.single_transaction_limit),
      max_limit: parseFloat(created.max_limit),
      isActive: true,
      isRevoked: false,
    };
  }

  /**
   * Revokes a payment authorization and terminates pending in-flight payments
   */
  async revokePaymentMethod(userId, methodId, reason = 'Revoked by buyer') {
    if (!userId) {
      throw new Error('User ID is required for payment authorization revocation');
    }

    let res = await query(`
      UPDATE user_payment_methods
      SET status = 'revoked',
          revoked_at = NOW(),
          revoked_reason = $1,
          updated_at = NOW()
      WHERE id = $2 AND user_id = $3
      RETURNING *
    `, [reason, methodId, userId]);

    if (res.rows.length === 0) {
      if (methodId === 'all' || methodId === 'default') {
        res = await query(`
          UPDATE user_payment_methods
          SET status = 'revoked',
              revoked_at = NOW(),
              revoked_reason = $1,
              updated_at = NOW()
          WHERE user_id = $2 AND status = 'active'
          RETURNING *
        `, [reason, userId]);
      } else {
        const otherUserMethod = await query('SELECT id FROM user_payment_methods WHERE id = $1', [methodId]);
        if (otherUserMethod.rows.length > 0) {
          const err = new Error('Unauthorized: You do not own this payment authorization');
          err.status = 403;
          throw err;
        }
      }
    }

    // Fail-closed: Stop any active purchase intents in evaluating/pending state for this user
    await query(`
      UPDATE purchase_intents
      SET status = 'blocked',
          state = 'BLOCKED',
          policy_decision = 'BLOCK',
          policy_details = jsonb_set(
            COALESCE(policy_details, '{}'::jsonb),
            '{revocationReason}',
            '"Payment authorization revoked while transaction was pending"'
          ),
          updated_at = NOW()
      WHERE user_id = $1 
        AND status IN ('pending', 'evaluating', 'payment_pending', 'allowed')
    `, [userId]);

    await recordAuditEvent({
      eventType: 'PAYMENT_REVOKED',
      actor: 'buyer',
      userId,
      action: 'REVOKE_PAYMENT_AUTHORIZATION',
      decision: 'BLOCK',
      reasoning: `Buyer revoked payment authorization ${methodId}. Reason: ${reason}. In-flight autonomous payments halted.`,
      metadata: { authorizationId: methodId, reason },
    }).catch((err) => logger.warn('PaymentMethodService', `Audit log error: ${err.message}`));

    return { success: true, status: 'revoked', message: 'Payment authorization revoked. Autonomous payments disabled.' };
  }

  /**
   * Deterministic Server-Side Payment Authorization Check (Dual-Limit Resolution)
   */
  async verifyPaymentAuthorization(userId, amount, options = {}) {
    const parsedAmount = parseFloat(amount) || 0;
    const methods = await this.getUserPaymentMethods(userId, options);
    const activeMethods = methods.filter((m) => m.isActive && !m.isRevoked);

    if (activeMethods.length === 0) {
      return {
        authorized: false,
        rule: 'PAYMENT_AUTHORIZATION_REQUIRED',
        reason: 'Autonomous payment prohibited: No active payment mandate or payment authorization connected. Reconnect payment method to enable checkout.',
        authorization: null,
      };
    }

    // Select default or highest limit active mandate
    const defaultAuth = activeMethods.find((m) => m.is_default) || activeMethods[0];
    const singleLimit = parseFloat(defaultAuth.single_transaction_limit || defaultAuth.max_limit || 0);

    if (parsedAmount > singleLimit) {
      const overage = parsedAmount - singleLimit;
      return {
        authorized: false,
        rule: 'PAYMENT_AUTHORIZATION_EXCEEDED',
        reason: `Transaction amount (₹${parsedAmount.toLocaleString('en-IN')}) exceeds your payment authorization ceiling of ₹${singleLimit.toLocaleString('en-IN')} by ₹${overage.toLocaleString('en-IN')}. Update payment mandate limit or approve manually.`,
        authorization: defaultAuth,
        threshold: singleLimit,
      };
    }

    return {
      authorized: true,
      rule: 'PAYMENT_AUTHORIZATION_VALID',
      reason: `Payment authorized under ${defaultAuth.identifier_masked} (Limit: ₹${singleLimit.toLocaleString('en-IN')})`,
      authorization: defaultAuth,
      threshold: singleLimit,
    };
  }
}

export const paymentMethodService = new PaymentMethodService();
export default paymentMethodService;
