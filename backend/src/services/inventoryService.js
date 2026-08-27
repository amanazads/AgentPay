import { query } from '../config/database.js';
import { logger } from '../utils/logger.js';

/**
 * Two-Phase Inventory Reservation Service
 * Protects against race conditions, stock overselling, and concurrent agent purchases.
 */
export async function reserveInventory({
  productId,
  quantity = 1,
  userId = null,
  quoteId = null,
  durationMinutes = 15,
}) {
  const expiresAt = new Date(Date.now() + durationMinutes * 60 * 1000).toISOString();

  // 1. Lock product row with FOR UPDATE
  const prodRes = await query(`
    SELECT id, name, inventory, in_stock
    FROM products
    WHERE id = $1
    FOR UPDATE
  `, [productId]);

  if (prodRes.rows.length === 0) {
    throw new Error(`Product ${productId} not found`);
  }

  const product = prodRes.rows[0];

  // 2. Fetch active reserved quantities
  const resRes = await query(`
    SELECT COALESCE(SUM(quantity), 0) as reserved_qty
    FROM inventory_reservations
    WHERE product_id = $1 AND status = 'RESERVED' AND expires_at > NOW()
  `, [productId]);

  const reservedQty = parseInt(resRes.rows[0]?.reserved_qty || 0, 10);
  const currentAvailable = (product.inventory || 0) - reservedQty;

  if (!product.in_stock || currentAvailable < quantity) {
    throw new Error(`Insufficient inventory: ${quantity} requested, but only ${Math.max(0, currentAvailable)} units available`);
  }

  // 2. Insert reservation record
  const res = await query(`
    INSERT INTO inventory_reservations (
      product_id, quantity, user_id, quote_id, status, expires_at
    )
    VALUES ($1, $2, $3, $4, 'RESERVED', $5)
    RETURNING *
  `, [productId, quantity, userId, quoteId, expiresAt]);

  const reservation = res.rows[0];
  logger.info('Inventory', `Reserved ${quantity} units of ${product.name} (Quote: ${quoteId || reservation.id}) until ${expiresAt}`);

  return {
    reservationId: reservation.id,
    productId,
    quantity,
    status: 'RESERVED',
    expiresAt,
  };
}

/**
 * Commits reservation upon verified order confirmation and decrements product inventory
 */
export async function commitReservation(reservationIdentifier) {
  const res = await query(`
    UPDATE inventory_reservations
    SET status = 'COMMITTED'
    WHERE (id::text = $1 OR quote_id = $1) AND status = 'RESERVED'
    RETURNING *
  `, [reservationIdentifier]);

  if (res.rows.length > 0) {
    const reservation = res.rows[0];
    await query(`
      UPDATE products
      SET inventory = GREATEST(0, inventory - $2),
          in_stock = CASE WHEN (inventory - $2) <= 0 THEN false ELSE in_stock END
      WHERE id = $1
    `, [reservation.product_id, reservation.quantity]);

    logger.info('Inventory', `Committed reservation ${reservation.id} for product ${reservation.product_id}`);
    return { success: true, reservation };
  }

  return { success: false, reason: 'No active reservation found to commit' };
}

/**
 * Releases reservation on payment failure, price surge block, or cancellation
 */
export async function releaseReservation(reservationIdentifier, reason = 'Cancelled') {
  const res = await query(`
    UPDATE inventory_reservations
    SET status = 'RELEASED'
    WHERE (id::text = $1 OR quote_id = $1) AND status = 'RESERVED'
    RETURNING *
  `, [reservationIdentifier]);

  if (res.rows.length > 0) {
    logger.info('Inventory', `Released reservation ${res.rows[0].id} (Reason: ${reason})`);
    return { success: true, reservation: res.rows[0] };
  }

  return { success: false, reason: 'No active reservation found to release' };
}

export default {
  reserveInventory,
  commitReservation,
  releaseReservation,
};
