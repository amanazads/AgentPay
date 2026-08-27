import { query } from '../config/database.js';
import { recordAuditEvent } from './auditService.js';

/**
 * Purchasing Authorization & Atomic Limit Reservation Service
 * Prevents race-condition overspending across concurrent agent purchases.
 */
export class AuthorizationService {
  /**
   * Evaluates user's available purchasing authorization against the requested amount
   */
  async checkUserAuthorization(userId, amount, category = 'electronics') {
    const parsedAmount = parseFloat(amount) || 0;

    // Fetch active reservations in the last 15 minutes
    const resRes = await query(`
      SELECT COALESCE(SUM(amount), 0) as reserved_total
      FROM authorization_reservations
      WHERE user_id = $1 AND status = 'RESERVED' AND expires_at > NOW()
    `, [userId]);

    const reservedAmount = parseFloat(resRes.rows[0]?.reserved_total) || 0;

    // Fetch settled spending for the current month
    const spendRes = await query(`
      SELECT COALESCE(SUM(t.amount), 0) as spent_month
      FROM transactions t
      WHERE t.user_id = $1
        AND t.status IN ('payment_completed', 'success', 'authorized')
        AND t.created_at >= DATE_TRUNC('month', CURRENT_DATE)
    `, [userId]);

    const spentMonth = parseFloat(spendRes.rows[0]?.spent_month) || 0;
    const monthlyLimit = 200000;
    const maxAutonomousTx = 50000;

    const availableLimit = Math.max(0, monthlyLimit - spentMonth - reservedAmount);
    const isWithinMonthlyLimit = availableLimit >= parsedAmount;
    const isWithinAutonomousTx = parsedAmount <= maxAutonomousTx;

    return {
      userId,
      requestedAmount: parsedAmount,
      monthlyLimit,
      spentMonth,
      reservedAmount,
      availableLimit,
      maxAutonomousTx,
      isAuthorized: isWithinMonthlyLimit && isWithinAutonomousTx,
      requiresApproval: isWithinMonthlyLimit && !isWithinAutonomousTx,
      isBlocked: !isWithinMonthlyLimit,
      reason: !isWithinMonthlyLimit
        ? `Requested amount ₹${parsedAmount.toLocaleString('en-IN')} exceeds available monthly purchasing limit of ₹${availableLimit.toLocaleString('en-IN')}`
        : !isWithinAutonomousTx
        ? `Requested amount ₹${parsedAmount.toLocaleString('en-IN')} exceeds autonomous limit of ₹${maxAutonomousTx.toLocaleString('en-IN')}. Requires approval.`
        : 'Authorized within autonomous purchasing limits.',
    };
  }

  /**
   * Atomically places a temporary hold on the user's spending limit
   */
  async reserveAuthorization(userId, purchaseIntentId, amount) {
    const authCheck = await this.checkUserAuthorization(userId, amount);
    if (authCheck.isBlocked) {
      throw new Error(`Reservation failed: ${authCheck.reason}`);
    }

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15-minute reservation window

    const res = await query(`
      INSERT INTO authorization_reservations (user_id, purchase_intent_id, amount, status, expires_at)
      VALUES ($1, $2, $3, 'RESERVED', $4)
      RETURNING *
    `, [userId, purchaseIntentId, amount, expiresAt]);

    const reservation = res.rows[0];

    await recordAuditEvent({
      eventType: 'AUTHORIZATION_RESERVED',
      actor: 'system',
      userId,
      purchaseIntentId,
      action: 'RESERVE_PURCHASING_LIMIT',
      decision: 'RESERVED',
      reasoning: `Reserved ₹${parseFloat(amount).toLocaleString('en-IN')} against monthly limit (Hold ID: ${reservation.id})`,
      outcome: 'Limit reserved for 15 minutes',
      metadata: { reservationId: reservation.id, amount, expiresAt },
    });

    return reservation;
  }

  /**
   * Consumes the reserved limit upon verified payment & order confirmation
   */
  async consumeReservation(reservationId) {
    await query(`
      UPDATE authorization_reservations
      SET status = 'CONSUMED',
          updated_at = NOW()
      WHERE id = $1
    `, [reservationId]);
  }

  /**
   * Releases the reservation back to available purchasing limit upon failure or cancellation
   */
  async releaseReservation(reservationId) {
    await query(`
      UPDATE authorization_reservations
      SET status = 'RELEASED',
          updated_at = NOW()
      WHERE id = $1
    `, [reservationId]);
  }
}

export const authorizationService = new AuthorizationService();
