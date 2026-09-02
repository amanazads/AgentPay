import { getClient, query } from '../config/database.js';
import { logger } from '../utils/logger.js';

/**
 * Two-Phase Inventory Reservation Protocol States
 */
export const InventoryStates = {
  AVAILABLE: 'AVAILABLE',
  RESERVED: 'RESERVED',
  COMMITTED: 'COMMITTED',
  RELEASED: 'RELEASED',
  EXPIRED: 'EXPIRED',
};

/**
 * Two-Phase Inventory Reservation Service
 * Protects against race conditions, stock overselling, and concurrent agent purchases
 * by holding row-level locks on product inventory and tracking reservation leases.
 */
export async function reserveInventory({
  productId,
  quantity = 1,
  userId = null,
  quoteId = null,
  durationMinutes = 15,
}) {
  const reqQty = parseInt(quantity, 10) || 1;
  const expiresAt = new Date(Date.now() + durationMinutes * 60 * 1000).toISOString();
  const client = await getClient();

  try {
    await client.query('BEGIN');

    // 1. Lock the product row FOR UPDATE to strictly serialize concurrent reservation attempts
    const prodRes = await client.query(`
      SELECT id, name, inventory, in_stock
      FROM products
      WHERE id = $1
      FOR UPDATE
    `, [productId]);

    if (prodRes.rows.length === 0) {
      throw new Error(`Product ${productId} not found`);
    }

    const product = prodRes.rows[0];

    // 2. Expire any stale reservations on this product inside the transaction
    await client.query(`
      UPDATE inventory_reservations
      SET status = 'EXPIRED', updated_at = NOW()
      WHERE product_id = $1 AND status = 'RESERVED' AND expires_at <= NOW()
    `, [productId]);

    // 3. Compute active reserved quantity (only unexpired RESERVED rows)
    const resRes = await client.query(`
      SELECT COALESCE(SUM(quantity), 0) as reserved_qty
      FROM inventory_reservations
      WHERE product_id = $1 AND status = 'RESERVED' AND expires_at > NOW()
    `, [productId]);

    const reservedQty = parseInt(resRes.rows[0]?.reserved_qty || 0, 10);
    const currentAvailable = (product.inventory || 0) - reservedQty;

    if (!product.in_stock || currentAvailable < reqQty) {
      throw new Error(`Insufficient inventory: ${reqQty} requested, but only ${Math.max(0, currentAvailable)} units available`);
    }

    // 4. Create durable reservation with quote link
    const res = await client.query(`
      INSERT INTO inventory_reservations (
        product_id, quantity, user_id, quote_id, status, expires_at
      )
      VALUES ($1, $2, $3, $4, 'RESERVED', $5)
      RETURNING *
    `, [productId, reqQty, userId, quoteId, expiresAt]);

    await client.query('COMMIT');

    const reservation = res.rows[0];
    logger.info('Inventory', `Reserved ${reqQty} units of ${product.name} (Quote: ${quoteId || reservation.id}) until ${expiresAt}`);

    return {
      reservationId: reservation.id,
      quoteId,
      productId,
      quantity: reqQty,
      status: InventoryStates.RESERVED,
      availableRemaining: currentAvailable - reqQty,
      expiresAt,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Commits reservation upon verified order confirmation and decrements product inventory.
 * Guaranteed idempotent and atomic: multiple commit attempts will only decrement stock ONCE.
 */
export async function commitReservation(reservationIdentifier) {
  if (!reservationIdentifier) {
    return { success: false, reason: 'No reservation identifier provided' };
  }

  const client = await getClient();

  try {
    await client.query('BEGIN');

    // 1. Lock the reservation row FOR UPDATE
    const resCheck = await client.query(`
      SELECT * FROM inventory_reservations
      WHERE (id::text = $1 OR quote_id = $1)
      FOR UPDATE
    `, [reservationIdentifier]);

    if (resCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, reason: 'No reservation found' };
    }

    const reservation = resCheck.rows[0];

    // Idempotent return if already committed (prevents multiple stock decrements on retries/webhooks)
    if (reservation.status === InventoryStates.COMMITTED) {
      await client.query('COMMIT');
      logger.info('Inventory', `Reservation ${reservation.id} already COMMITTED — idempotent commit.`);
      return { success: true, isDuplicate: true, reservation };
    }

    if (reservation.status !== InventoryStates.RESERVED) {
      await client.query('ROLLBACK');
      return { success: false, reason: `Cannot commit reservation with status '${reservation.status}'` };
    }

    // 2. Lock product row FOR UPDATE and decrement stock safely
    const prodRes = await client.query(`
      SELECT id, inventory, in_stock FROM products WHERE id = $1 FOR UPDATE
    `, [reservation.product_id]);

    if (prodRes.rows.length === 0) {
      throw new Error(`Product ${reservation.product_id} not found for reservation commitment`);
    }

    const currentInventory = prodRes.rows[0].inventory;
    const newInventory = Math.max(0, currentInventory - reservation.quantity);
    const newInStock = newInventory > 0;

    await client.query(`
      UPDATE products
      SET inventory = $1, in_stock = $2, updated_at = NOW()
      WHERE id = $3
    `, [newInventory, newInStock, reservation.product_id]);

    // 3. Transition reservation state to COMMITTED
    const updatedRes = await client.query(`
      UPDATE inventory_reservations
      SET status = 'COMMITTED', updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `, [reservation.id]);

    await client.query('COMMIT');
    logger.info('Inventory', `Committed reservation ${reservation.id} for product ${reservation.product_id}. New stock: ${newInventory}`);

    return {
      success: true,
      reservation: updatedRes.rows[0],
      previousInventory: currentInventory,
      newInventory,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Releases reservation on payment failure, price surge block, or order cancellation.
 * Frees reserved quantity back to available inventory.
 */
export async function releaseReservation(reservationIdentifier, reason = 'Cancelled') {
  if (!reservationIdentifier) {
    return { success: false, reason: 'No reservation identifier provided' };
  }

  const client = await getClient();

  try {
    await client.query('BEGIN');

    const resCheck = await client.query(`
      SELECT * FROM inventory_reservations
      WHERE (id::text = $1 OR quote_id = $1)
      FOR UPDATE
    `, [reservationIdentifier]);

    if (resCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, reason: 'No reservation found' };
    }

    const reservation = resCheck.rows[0];

    // Idempotent return if already released or expired
    if (reservation.status === InventoryStates.RELEASED || reservation.status === InventoryStates.EXPIRED) {
      await client.query('COMMIT');
      return { success: true, isDuplicate: true, reservation };
    }

    if (reservation.status !== InventoryStates.RESERVED) {
      await client.query('ROLLBACK');
      return { success: false, reason: `Cannot release reservation with status '${reservation.status}'` };
    }

    const updatedRes = await client.query(`
      UPDATE inventory_reservations
      SET status = 'RELEASED', updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `, [reservation.id]);

    await client.query('COMMIT');
    logger.info('Inventory', `Released reservation ${reservation.id} (Reason: ${reason})`);

    return { success: true, reservation: updatedRes.rows[0] };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Gets live available inventory for a product (Total Inventory minus Active Unexpired Reservations)
 */
export async function getAvailableInventory(productId) {
  const prodRes = await query('SELECT inventory, in_stock FROM products WHERE id = $1', [productId]);
  if (prodRes.rows.length === 0) return 0;
  if (!prodRes.rows[0].in_stock) return 0;

  const resRes = await query(`
    SELECT COALESCE(SUM(quantity), 0) as reserved_qty
    FROM inventory_reservations
    WHERE product_id = $1 AND status = 'RESERVED' AND expires_at > NOW()
  `, [productId]);

  const reservedQty = parseInt(resRes.rows[0]?.reserved_qty || 0, 10);
  return Math.max(0, (prodRes.rows[0].inventory || 0) - reservedQty);
}

/**
 * Background / on-demand sweeper to mark expired reservations as EXPIRED
 */
export async function expireStaleReservations() {
  const res = await query(`
    UPDATE inventory_reservations
    SET status = 'EXPIRED', updated_at = NOW()
    WHERE status = 'RESERVED' AND expires_at <= NOW()
    RETURNING id, product_id, quantity
  `);
  if (res.rows.length > 0) {
    logger.info('Inventory', `Expired ${res.rows.length} stale inventory reservations`);
  }
  return res.rows;
}

export default {
  InventoryStates,
  reserveInventory,
  commitReservation,
  releaseReservation,
  getAvailableInventory,
  expireStaleReservations,
};
