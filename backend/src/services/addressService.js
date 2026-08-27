import { query } from '../config/database.js';

/**
 * Address Service — Manages Buyer Shipping & Billing Addresses
 */
export async function getAddresses(userId) {
  const res = await query(
    'SELECT * FROM user_addresses WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC',
    [userId]
  );
  return res.rows;
}

export async function getDefaultAddress(userId) {
  const res = await query(
    'SELECT * FROM user_addresses WHERE user_id = $1 AND is_default = true LIMIT 1',
    [userId]
  );
  if (res.rows.length > 0) return res.rows[0];

  // Fallback to latest address
  const latestRes = await query(
    'SELECT * FROM user_addresses WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
    [userId]
  );
  if (latestRes.rows.length > 0) return latestRes.rows[0];

  // If none exists, create standard default
  const userRes = await query('SELECT name, email FROM users WHERE id = $1', [userId]);
  const userName = userRes.rows[0]?.name || 'AgentPay Buyer';

  const defaultAddr = await query(`
    INSERT INTO user_addresses (
      user_id, name, phone, address_line1, address_line2, city, state, pincode, country, address_type, is_default
    )
    VALUES ($1, $2, '+91 98765 43210', '742 Evergreen Terrace, Tech Park Sector 4', 'Tower B, Suite 502', 'Bengaluru', 'Karnataka', '560100', 'India', 'WORK', true)
    RETURNING *
  `, [userId, userName]);

  return defaultAddr.rows[0];
}

export async function createAddress(userId, data) {
  const { name, phone, addressLine1, addressLine2, city, state, pincode, country = 'India', addressType = 'HOME', isDefault = false } = data;

  if (isDefault) {
    await query('UPDATE user_addresses SET is_default = false WHERE user_id = $1', [userId]);
  }

  const res = await query(`
    INSERT INTO user_addresses (
      user_id, name, phone, address_line1, address_line2, city, state, pincode, country, address_type, is_default
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING *
  `, [userId, name, phone, addressLine1, addressLine2 || '', city, state, pincode, country, addressType, isDefault]);

  return res.rows[0];
}

export async function updateAddress(userId, addressId, data) {
  const { name, phone, addressLine1, addressLine2, city, state, pincode, country = 'India', addressType = 'HOME', isDefault = false } = data;

  if (isDefault) {
    await query('UPDATE user_addresses SET is_default = false WHERE user_id = $1', [userId]);
  }

  const res = await query(`
    UPDATE user_addresses SET
      name = COALESCE($3, name),
      phone = COALESCE($4, phone),
      address_line1 = COALESCE($5, address_line1),
      address_line2 = COALESCE($6, address_line2),
      city = COALESCE($7, city),
      state = COALESCE($8, state),
      pincode = COALESCE($9, pincode),
      country = COALESCE($10, country),
      address_type = COALESCE($11, address_type),
      is_default = COALESCE($12, is_default),
      updated_at = NOW()
    WHERE id = $1 AND user_id = $2
    RETURNING *
  `, [addressId, userId, name, phone, addressLine1, addressLine2, city, state, pincode, country, addressType, isDefault]);

  return res.rows[0] || null;
}

export async function deleteAddress(userId, addressId) {
  const res = await query('DELETE FROM user_addresses WHERE id = $1 AND user_id = $2 RETURNING id', [addressId, userId]);
  return res.rowCount > 0;
}
