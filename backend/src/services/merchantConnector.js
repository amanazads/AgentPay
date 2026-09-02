import { query } from '../config/database.js';
import crypto from 'crypto';
import { calculatePrice } from './pricingService.js';
import { generateQuote } from './quoteService.js';
import { logger } from '../utils/logger.js';

/**
 * Merchant Connector Interface & Adapter Architecture
 * 
 * Cleanly abstracts merchant commerce APIs so the AI Buyer Agent operates 
 * exclusively on normalized commerce primitives without vendor-specific logic.
 */

export class StandardPlatformMerchantAdapter {
  constructor(name = 'PlatformCommerceAdapter') {
    this.name = name;
  }

  /**
   * Fetches normalized active catalog from the merchant
   */
  async getCatalog(merchantId) {
    const res = await query(`
      SELECT p.*, m.name as merchant_name, m.is_verified as merchant_verified, m.rating as merchant_rating
      FROM products p
      JOIN merchants m ON p.merchant_id = m.id
      WHERE p.merchant_id = $1 
        AND p.in_stock = true
        AND (p.is_test_lab = false OR p.is_test_lab IS NULL)
      ORDER BY p.price ASC
    `, [merchantId]);

    return res.rows.map((row) => this.normalizeProduct(row));
  }

  /**
   * Fetches real-time product data and current pricing/inventory
   */
  async getProduct(merchantId, productId) {
    const res = await query(`
      SELECT p.*, m.name as merchant_name, m.is_verified as merchant_verified
      FROM products p
      JOIN merchants m ON p.merchant_id = m.id
      WHERE p.id = $1 AND p.merchant_id = $2
    `, [productId, merchantId]);

    if (res.rows.length === 0) return null;
    return this.normalizeProduct(res.rows[0]);
  }

  /**
   * Checks real-time inventory freshness
   */
  async checkInventory(merchantId, productId, requestedQuantity = 1) {
    const res = await query(`
      SELECT in_stock, inventory, name
      FROM products
      WHERE id = $1 AND merchant_id = $2
    `, [productId, merchantId]);

    if (res.rows.length === 0) {
      return { available: false, inStock: false, availableQuantity: 0, reason: 'Product not found in merchant catalog' };
    }

    const item = res.rows[0];
    const availableQty = parseInt(item.inventory || 0);
    const inStock = item.in_stock && availableQty >= requestedQuantity;

    return {
      available: inStock,
      inStock: item.in_stock,
      availableQuantity: availableQty,
      requestedQuantity,
      freshness: 'DEMO_DATABASE_CURRENT',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Generates a time-bound price lock quote
   */
  async getQuote(merchantId, productId, requestedQuantity = 1) {
    const product = await this.getProduct(merchantId, productId);
    if (!product || !product.in_stock) {
      throw new Error(`Product ${productId} unavailable for quote from merchant ${merchantId}`);
    }

    return generateQuote({
      productId,
      quantity: requestedQuantity,
      deliveryMethod: 'STANDARD',
    });
  }

  /**
   * Verifies health and capabilities of the merchant connector
   */
  async verifyHealth(merchantId) {
    const startTime = Date.now();
    const merchRes = await query('SELECT * FROM merchants WHERE id = $1', [merchantId]);
    if (merchRes.rows.length === 0) {
      return {
        overall: 'ERROR',
        catalog: 'ERROR',
        inventory: 'ERROR',
        checkout: 'UNAVAILABLE',
        payment: 'UNAVAILABLE',
        latencyMs: Date.now() - startTime,
        reason: 'Merchant not registered in platform network',
      };
    }

    const merchant = merchRes.rows[0];
    const isVerified = merchant.is_verified;

    // Check active product count and inventory
    const prodRes = await query(`
      SELECT COUNT(*) as total_count,
             COUNT(CASE WHEN in_stock = true THEN 1 END) as in_stock_count
      FROM products
      WHERE merchant_id = $1
    `, [merchantId]);

    const totalCount = parseInt(prodRes.rows[0]?.total_count || 0);
    const inStockCount = parseInt(prodRes.rows[0]?.in_stock_count || 0);

    const catalogHealth = totalCount > 0 ? 'HEALTHY' : 'DEGRADED';
    const inventoryHealth = inStockCount > 0 ? 'FRESH' : 'OUT_OF_STOCK';
    const checkoutHealth = isVerified ? 'AVAILABLE' : 'RESTRICTED';
    const paymentHealth = isVerified ? 'AVAILABLE' : 'UNAVAILABLE';

    const overall = isVerified && totalCount > 0 ? 'HEALTHY' : 'DEGRADED';

    return {
      overall,
      catalog: catalogHealth,
      inventory: inventoryHealth,
      checkout: checkoutHealth,
      payment: paymentHealth,
      productCount: totalCount,
      inStockCount,
      latencyMs: Date.now() - startTime,
      lastCheckedAt: new Date().toISOString(),
    };
  }

  /**
   * Normalizes raw database/API row into standard AgentPay Product Schema
   */
  normalizeProduct(row) {
    return {
      merchant_id: row.merchant_id,
      merchant_name: row.merchant_name,
      merchant_verified: row.merchant_verified || false,
      product_id: row.id,
      sku: row.sku || `SKU-${(row.id || '').substring(0, 8).toUpperCase()}`,
      name: row.name,
      brand: row.brand || '',
      category: row.category,
      description: row.description,
      price: parseFloat(row.price),
      currency: row.currency || 'INR',
      delivery_fee: parseFloat(row.delivery_fee || 0),
      delivery_days: parseInt(row.delivery_days || 2),
      in_stock: Boolean(row.in_stock),
      inventory: parseInt(row.inventory || 25),
      attributes: typeof row.attributes === 'object' && row.attributes !== null ? row.attributes : {},
      specifications: typeof row.specifications === 'object' && row.specifications !== null ? row.specifications : {},
      updated_at: row.updated_at,
    };
  }
}

export const merchantConnector = new StandardPlatformMerchantAdapter();
export default merchantConnector;
