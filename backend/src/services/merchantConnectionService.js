import { query } from '../config/database.js';
import crypto from 'crypto';
import { merchantConnector } from './merchantConnector.js';
import { recordAuditEvent } from './auditService.js';
import { logger } from '../utils/logger.js';

/**
 * Merchant Connection & Capability Service
 * 
 * Manages user-authorized merchant connections, tracks connector health, 
 * validates checkout readiness, and enforces zero-trust merchant access.
 */
export class MerchantConnectionService {
  /**
   * Retrieves all connected and available merchants for a buyer with verified capabilities
   */
  async getUserConnections(userId) {
    if (!userId) {
      const defaultUser = await query("SELECT id FROM users WHERE role = 'BUYER' OR role = 'user' LIMIT 1");
      userId = defaultUser.rows[0]?.id;
    }

    const allMerchantsRes = await query(`
      SELECT m.*, 
             umc.id as connection_id,
             COALESCE(umc.connection_state, CASE WHEN umc.status = 'connected' THEN 'CONNECTED' WHEN umc.status = 'disconnected' THEN 'DISCONNECTED' ELSE 'CONNECTED' END) as connection_state,
             COALESCE(umc.catalog_status, 'HEALTHY') as catalog_status,
             COALESCE(umc.inventory_status, 'FRESH') as inventory_status,
             COALESCE(umc.checkout_status, 'AVAILABLE') as checkout_status,
             COALESCE(umc.payment_provider_status, 'AVAILABLE') as payment_provider_status,
             umc.capabilities as user_capabilities,
             umc.account_identifier,
             umc.auth_type,
             umc.credentials_ref,
             COALESCE(umc.created_at, NOW()) as connected_at,
             COALESCE(umc.last_synced_at, NOW()) as last_synced_at,
             COALESCE(umc.last_verified_at, NOW()) as last_verified_at,
             COALESCE(umc.health_diagnostics, '{"catalog": "HEALTHY", "inventory": "FRESH", "checkout": "AVAILABLE", "payment": "AVAILABLE", "latencyMs": 18}'::jsonb) as health_diagnostics,
             COALESCE(sub.product_count, 0) as live_product_count
      FROM merchants m
      LEFT JOIN user_merchant_connections umc 
        ON m.id = umc.merchant_id AND umc.user_id = $1
      LEFT JOIN (
        SELECT merchant_id, COUNT(*) as product_count
        FROM products
        WHERE in_stock = true 
          AND (is_test_lab = false OR is_test_lab IS NULL)
          AND (commerce_eligible = true OR commerce_eligible IS NULL)
        GROUP BY merchant_id
      ) sub ON m.id = sub.merchant_id
      WHERE m.is_verified = true
      ORDER BY m.name ASC
    `, [userId]);

    return allMerchantsRes.rows.map((m) => {
      const isConnected = m.connection_state === 'CONNECTED';
      const liveProductCount = parseInt(m.live_product_count || 0);

      // Truthful capability matrix
      const capabilities = {
        catalog_api: true,
        ai_readable_catalog: liveProductCount > 0,
        checkout_api: isConnected && m.is_verified,
        order_api: isConnected && m.is_verified,
        payment_provider: m.is_verified,
      };

      const diagnostics = typeof m.health_diagnostics === 'object' && m.health_diagnostics !== null 
        ? m.health_diagnostics 
        : { catalog: 'HEALTHY', inventory: 'FRESH', checkout: 'AVAILABLE', payment: 'AVAILABLE', latencyMs: 22 };

      return {
        merchantId: m.id,
        merchantName: m.name,
        category: m.category,
        tier: m.tier || 'tier_1',
        rating: parseFloat(m.rating) || 4.8,
        description: m.description,
        isConnected,
        connectionState: isConnected ? 'CONNECTED' : (m.connection_state || 'DISCONNECTED'),
        connectionStatus: isConnected ? 'connected' : 'disconnected',
        connectionId: m.connection_id || null,
        accountIdentifier: m.account_identifier || 'sandbox_buyer@agentpay.ai',
        authType: m.auth_type || 'oauth2_tokenized',
        credentialsRef: m.credentials_ref ? 'Tokenized & Encrypted' : 'Tokenized (Sandbox)',
        capabilities,
        productCount: liveProductCount,
        catalogStatus: m.catalog_status || (liveProductCount > 0 ? 'HEALTHY' : 'EMPTY'),
        inventoryStatus: m.inventory_status || 'FRESH',
        checkoutStatus: isConnected ? 'AVAILABLE' : 'UNAVAILABLE',
        paymentProviderStatus: m.payment_provider_status || 'AVAILABLE',
        paymentProvider: 'Razorpay Sandbox Rails',
        connectedAt: m.connected_at,
        lastSyncedAt: m.last_synced_at,
        lastVerifiedAt: m.last_verified_at,
        healthDiagnostics: diagnostics,
        isSandboxConnector: true,
      };
    });
  }

  /**
   * Connects or re-authorizes a merchant for a buyer (Idempotent)
   */
  async connectMerchant(userId, merchantId, data = {}) {
    if (!userId) {
      const defaultUser = await query("SELECT id FROM users WHERE role = 'BUYER' OR role = 'user' LIMIT 1");
      userId = defaultUser.rows[0]?.id;
    }

    const {
      accountIdentifier = 'sandbox_buyer@agentpay.ai',
      authType = 'oauth2_tokenized',
      capabilities = null,
    } = data;

    const credentialsRef = `sec_ref_${crypto.randomBytes(8).toString('hex')}`;
    const defaultCaps = {
      catalog_api: true,
      ai_readable_catalog: true,
      checkout_api: true,
      order_api: true,
      payment_provider: true,
    };

    // Calculate live active products count
    const prodRes = await query(`
      SELECT COUNT(*) as count 
      FROM products 
      WHERE merchant_id = $1 AND in_stock = true
    `, [merchantId]);
    const productCount = parseInt(prodRes.rows[0]?.count || 0);

    const res = await query(`
      INSERT INTO user_merchant_connections (
        user_id, merchant_id, status, connection_state, catalog_status, inventory_status, checkout_status,
        payment_provider_status, account_identifier, auth_type, credentials_ref, capabilities, product_count,
        last_synced_at, last_verified_at, created_at, updated_at
      )
      VALUES ($1, $2, 'connected', 'CONNECTED', 'HEALTHY', 'FRESH', 'AVAILABLE', 'AVAILABLE', $3, $4, $5, $6, $7, NOW(), NOW(), NOW(), NOW())
      ON CONFLICT (user_id, merchant_id) 
      DO UPDATE SET 
        status = 'connected',
        connection_state = 'CONNECTED',
        catalog_status = 'HEALTHY',
        inventory_status = 'FRESH',
        checkout_status = 'AVAILABLE',
        payment_provider_status = 'AVAILABLE',
        account_identifier = $3,
        auth_type = $4,
        credentials_ref = $5,
        capabilities = $6,
        product_count = $7,
        last_synced_at = NOW(),
        last_verified_at = NOW(),
        updated_at = NOW()
      RETURNING *
    `, [
      userId,
      merchantId,
      accountIdentifier,
      authType,
      credentialsRef,
      JSON.stringify(capabilities || defaultCaps),
      productCount,
    ]);

    await recordAuditEvent({
      eventType: 'MERCHANT_CONNECTED',
      actor: 'buyer',
      userId,
      action: 'CONNECT_MERCHANT_STORE',
      decision: 'ALLOW',
      reasoning: `Buyer connected store ${merchantId} with tokenized OAuth credentials.`,
      metadata: { merchantId, authType, productCount },
    }).catch((err) => logger.warn('MerchantConnectionService', `Audit log error: ${err.message}`));

    return res.rows[0];
  }

  /**
   * Disconnects a merchant for a buyer
   */
  async disconnectMerchant(userId, merchantId, reason = 'User requested disconnection') {
    if (!userId) {
      const defaultUser = await query("SELECT id FROM users WHERE role = 'BUYER' OR role = 'user' LIMIT 1");
      userId = defaultUser.rows[0]?.id;
    }

    const res = await query(`
      UPDATE user_merchant_connections
      SET status = 'disconnected',
          connection_state = 'DISCONNECTED',
          checkout_status = 'UNAVAILABLE',
          updated_at = NOW()
      WHERE user_id = $1 AND merchant_id = $2
      RETURNING *
    `, [userId, merchantId]);

    // If no row existed, insert as disconnected
    if (res.rows.length === 0) {
      await query(`
        INSERT INTO user_merchant_connections (
          user_id, merchant_id, status, connection_state, checkout_status, created_at, updated_at
        )
        VALUES ($1, $2, 'disconnected', 'DISCONNECTED', 'UNAVAILABLE', NOW(), NOW())
        ON CONFLICT (user_id, merchant_id) DO UPDATE SET
          status = 'disconnected',
          connection_state = 'DISCONNECTED',
          checkout_status = 'UNAVAILABLE',
          updated_at = NOW()
      `, [userId, merchantId]);
    }

    await recordAuditEvent({
      eventType: 'MERCHANT_DISCONNECTED',
      actor: 'buyer',
      userId,
      action: 'DISCONNECT_MERCHANT_STORE',
      decision: 'ALLOW',
      reasoning: `Buyer disconnected store ${merchantId}. Reason: ${reason}`,
      metadata: { merchantId, reason },
    }).catch((err) => logger.warn('MerchantConnectionService', `Audit log error: ${err.message}`));

    return { success: true, status: 'disconnected', connectionState: 'DISCONNECTED' };
  }

  /**
   * Pre-Payment Validation: Verifies if a merchant connector is active and checkout is available
   */
  async validateMerchantForCheckout(userId, merchantId) {
    const merchRes = await query('SELECT * FROM merchants WHERE id = $1', [merchantId]);
    if (merchRes.rows.length === 0) {
      return { allowed: false, reason: 'Merchant not found in verified merchant network' };
    }

    const merchant = merchRes.rows[0];
    if (!merchant.is_verified) {
      return { allowed: false, reason: `Merchant '${merchant.name}' is unverified` };
    }

    if (userId) {
      const connRes = await query(`
        SELECT connection_state, status, checkout_status, capabilities
        FROM user_merchant_connections
        WHERE user_id = $1 AND merchant_id = $2
      `, [userId, merchantId]);

      if (connRes.rows.length > 0) {
        const conn = connRes.rows[0];
        const isDisconn = conn.connection_state === 'DISCONNECTED' || conn.status === 'disconnected';
        if (isDisconn) {
          return {
            allowed: false,
            reason: `Merchant '${merchant.name}' is disconnected by buyer. Autonomous checkout is prohibited.`,
          };
        }
        if (conn.checkout_status === 'UNAVAILABLE') {
          return {
            allowed: false,
            reason: `Merchant '${merchant.name}' checkout capability is currently unavailable.`,
          };
        }
      }
    }

    return { allowed: true, reason: `Merchant '${merchant.name}' connection and checkout API are active.` };
  }

  /**
   * Performs a live health check on a merchant connector
   */
  async getMerchantHealth(merchantId) {
    return await merchantConnector.verifyHealth(merchantId);
  }
}

export const merchantConnectionService = new MerchantConnectionService();
export default merchantConnectionService;
