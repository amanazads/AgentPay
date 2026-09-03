import { query } from '../config/database.js';
import logger from './logger.js';

/**
 * Ensures a BUYER user has the required default policy, agent, preferences,
 * payment method, address, and verified merchant connections.
 */
export async function ensureBuyerDefaults(userId, userEmail = null) {
  if (!userId) return null;

  try {
    // 1. Resolve user info
    let email = userEmail;
    if (!email) {
      const uRes = await query('SELECT email FROM users WHERE id = $1', [userId]);
      email = uRes.rows[0]?.email || 'buyer@agentpay.ai';
    }

    // 2. Ensure default policy
    let policyId = null;
    const existingPol = await query("SELECT id FROM policies WHERE name = 'Standard Procurement Policy' LIMIT 1");
    if (existingPol.rows.length > 0) {
      policyId = existingPol.rows[0].id;
    } else {
      const polRes = await query(`
        INSERT INTO policies (
          name, version, daily_budget, max_transaction, approval_threshold,
          allowed_categories, blocked_categories, max_retries, price_tolerance_pct, verified_merchants_only
        )
        VALUES (
          'Standard Procurement Policy', 'v1', 500000, 200000, 25000,
          ARRAY['Electronics', 'Electronics & Technology', 'Peripherals', 'Software & Licenses', 'Office Supplies', 'Furniture', 'Hardware'],
          ARRAY['Gambling', 'Luxury', 'Weapons'],
          1, 2.0, true
        )
        RETURNING id
      `);
      policyId = polRes.rows[0].id;
    }

    // 3. Ensure default agent
    let agent = null;
    const existingAgent = await query('SELECT * FROM agents WHERE owner_id = $1 LIMIT 1', [userId]);
    if (existingAgent.rows.length > 0) {
      agent = existingAgent.rows[0];
    } else {
      const agentRes = await query(`
        INSERT INTO agents (owner_id, name, description, policy_id, status)
        VALUES ($1, 'Autonomous Procurement Agent', 'Standard Autonomous Procurement Assistant', $2, 'active')
        RETURNING *
      `, [userId, policyId]);
      agent = agentRes.rows[0];
    }

    // 4. Ensure user preferences
    await query(`
      INSERT INTO user_preferences (
        user_id, monthly_budget, auto_purchase_limit, categories, preferred_brands, purchase_behavior, updated_at
      )
      VALUES (
        $1, 1000000, 25000,
        ARRAY['Electronics', 'Electronics & Technology', 'Peripherals', 'Software & Licenses', 'Office Supplies', 'Furniture', 'Hardware'],
        ARRAY['Apple', 'Sony', 'Samsung', 'Dell', 'Logitech', 'Anker'],
        'auto_within_limit', NOW()
      )
      ON CONFLICT (user_id) DO UPDATE SET
        categories = ARRAY['Electronics', 'Electronics & Technology', 'Peripherals', 'Software & Licenses', 'Office Supplies', 'Furniture', 'Hardware'],
        updated_at = NOW()
    `, [userId]);

    // 5. Ensure default payment method
    const existingPm = await query("SELECT id FROM user_payment_methods WHERE user_id = $1 AND status = 'active' LIMIT 1", [userId]);
    if (existingPm.rows.length === 0) {
      await query(`
        INSERT INTO user_payment_methods (
          user_id, provider, method_type, identifier_masked, single_transaction_limit, monthly_limit, is_default, status
        )
        VALUES (
          $1, 'razorpay_sandbox', 'upi_mandate', 'user@okaxis (Sandbox Mandate)', 50000.00, 500000.00, true, 'active'
        )
      `, [userId]);
    }

    // 6. Ensure default delivery address
    const existingAddr = await query('SELECT id FROM user_addresses WHERE user_id = $1 AND is_default = true LIMIT 1', [userId]);
    if (existingAddr.rows.length === 0) {
      await query(`
        INSERT INTO user_addresses (
          user_id, address_type, name, address_line1, address_line2, city, state, pincode, country, phone, is_default
        )
        VALUES (
          $1, 'home', 'Procurement Department', 'Floor 4, Tech Park', 'Indiranagar', 'Bengaluru', 'Karnataka', '560038', 'IN', '+919876543210', true
        )
      `, [userId]);
    }

    // 7. Auto-connect all active verified merchants
    const verifiedMerchants = await query('SELECT id FROM merchants WHERE is_verified = true');
    for (const m of verifiedMerchants.rows) {
      await query(`
        INSERT INTO user_merchant_connections (user_id, merchant_id, status, account_identifier)
        VALUES ($1, $2, 'connected', $3)
        ON CONFLICT (user_id, merchant_id) DO UPDATE SET status = 'connected'
      `, [userId, m.id, email]);
    }

    return agent;
  } catch (err) {
    logger.error('Provisioner', `Failed to ensure buyer defaults for user ${userId}: ${err.message}`);
    return null;
  }
}
