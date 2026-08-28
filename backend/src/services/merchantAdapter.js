import { query } from '../config/database.js';

/**
 * Base Merchant Adapter Interface
 * All connected ecommerce platforms (e.g. AgentPay Demo Store, verified partner merchants)
 * implement this normalized contract.
 */
export class BaseMerchantAdapter {
  constructor(merchantRecord) {
    this.id = merchantRecord.id;
    this.name = merchantRecord.name || 'Merchant Store';
    this.tier = merchantRecord.tier || 'tier_1';
    this.isVerified = merchantRecord.is_verified ?? true;
    this.rating = parseFloat(merchantRecord.rating) || 4.9;
    this.deliveryDays = merchantRecord.delivery_days || 2;
    this.description = merchantRecord.description || 'Verified merchant connected to AgentPay AI commerce engine.';
  }

  getCapabilities() {
    return {
      search: true,
      cart: true,
      checkout: true,
      autonomousPurchase: true,
      orderTracking: true,
      cancellation: true,
      refunds: true,
    };
  }

  async searchProducts(criteria = {}) {
    throw new Error('searchProducts() must be implemented by adapter');
  }

  async getProduct(productId) {
    throw new Error('getProduct() must be implemented by adapter');
  }

  async checkInventory(productId, quantity = 1) {
    throw new Error('checkInventory() must be implemented by adapter');
  }

  async getPrice(productId) {
    throw new Error('getPrice() must be implemented by adapter');
  }

  async createCart(items = []) {
    throw new Error('createCart() must be implemented by adapter');
  }

  async addToCart(cartId, item = {}) {
    throw new Error('addToCart() must be implemented by adapter');
  }

  async getCart(cartId) {
    throw new Error('getCart() must be implemented by adapter');
  }

  async createCheckout(cart, shippingDetails = {}) {
    throw new Error('createCheckout() must be implemented by adapter');
  }

  async placeOrder(checkout, paymentDetails = {}) {
    throw new Error('placeOrder() must be implemented by adapter');
  }

  async getOrder(orderId) {
    throw new Error('getOrder() must be implemented by adapter');
  }

  async cancelOrder(orderId, reason = '') {
    throw new Error('cancelOrder() must be implemented by adapter');
  }

  async requestRefund(orderId, amount, reason = '') {
    throw new Error('requestRefund() must be implemented by adapter');
  }

  async getRefundStatus(refundId) {
    throw new Error('getRefundStatus() must be implemented by adapter');
  }
}

/**
 * Standard Verified Merchant Adapter (AgentPay Demo Store & Native Merchants)
 */
export class StandardMerchantAdapter extends BaseMerchantAdapter {
  async searchProducts(criteria = {}) {
    const { query: searchQuery, category, maxPrice, limit = 20 } = criteria;
    let sql = `
      SELECT p.*, 
             m.name as merchant_name, 
             m.is_verified as merchant_verified,
             pam.ai_summary,
             pam.keywords as ai_keywords,
             pam.is_promoted,
             pam.margin_tier
      FROM products p
      JOIN merchants m ON p.merchant_id = m.id
      LEFT JOIN product_ai_metadata pam ON pam.product_id = p.id
      WHERE m.id = $1 AND p.in_stock = true AND (p.is_test_lab = false OR p.is_test_lab IS NULL)
    `;
    const params = [this.id];

    if (searchQuery) {
      params.push(`%${searchQuery}%`);
      sql += ` AND (p.name ILIKE $${params.length} OR p.description ILIKE $${params.length} OR p.brand ILIKE $${params.length})`;
    }

    if (category) {
      params.push(category);
      sql += ` AND p.category ILIKE $${params.length}`;
    }

    if (maxPrice) {
      params.push(maxPrice);
      sql += ` AND p.price <= $${params.length}`;
    }

    sql += ` ORDER BY pam.is_promoted DESC NULLS LAST, p.price ASC LIMIT $${params.length + 1}`;
    params.push(limit);

    const res = await query(sql, params);
    return res.rows.map((row) => ({
      ...row,
      price: parseFloat(row.price),
      merchant_rating: this.rating,
      delivery_days: this.deliveryDays,
    }));
  }

  async getProduct(productId) {
    const res = await query(`
      SELECT p.*, 
             m.name as merchant_name, 
             m.is_verified as merchant_verified,
             pam.ai_summary,
             pam.target_audience,
             pam.use_cases,
             pam.keywords as ai_keywords
      FROM products p
      JOIN merchants m ON p.merchant_id = m.id
      LEFT JOIN product_ai_metadata pam ON pam.product_id = p.id
      WHERE p.id = $1 AND m.id = $2
    `, [productId, this.id]);
    return res.rows[0] || null;
  }

  async checkInventory(productId, quantity = 1) {
    const p = await this.getProduct(productId);
    if (!p) return { available: false, reason: 'Product not found' };
    return {
      available: p.in_stock === true && (p.inventory === null || p.inventory >= quantity),
      stockCount: p.inventory !== null ? p.inventory : 50,
      price: parseFloat(p.price),
      currency: p.currency || 'INR',
    };
  }

  async getPrice(productId) {
    const p = await this.getProduct(productId);
    if (!p) throw new Error(`Product ${productId} not found on merchant ${this.name}`);
    return {
      price: parseFloat(p.price),
      currency: p.currency || 'INR',
      originalPrice: p.original_price ? parseFloat(p.original_price) : parseFloat(p.price),
    };
  }

  async createCart(items = []) {
    const cartId = `cart_${this.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${Date.now().toString(36)}`;
    let subtotal = 0;
    const resolvedItems = [];

    for (const it of items) {
      const p = await this.getProduct(it.productId);
      if (p) {
        const qty = it.quantity || 1;
        const itemTotal = parseFloat(p.price) * qty;
        subtotal += itemTotal;
        resolvedItems.push({
          productId: p.id,
          name: p.name,
          brand: p.brand,
          quantity: qty,
          unitPrice: parseFloat(p.price),
          totalPrice: itemTotal,
        });
      }
    }

    return {
      cartId,
      merchantId: this.id,
      merchantName: this.name,
      items: resolvedItems,
      subtotal,
      currency: 'INR',
      createdAt: new Date().toISOString(),
    };
  }

  async createCheckout(cart, shippingDetails = {}) {
    const checkoutId = `chk_${cart.cartId.replace('cart_', '')}`;
    const shippingFee = cart.subtotal > 2000 ? 0 : 99;
    const finalAmount = cart.subtotal + shippingFee;

    return {
      checkoutId,
      cartId: cart.cartId,
      merchantId: this.id,
      merchantName: this.name,
      subtotal: cart.subtotal,
      shippingFee,
      taxIncluded: true,
      finalAmount,
      currency: cart.currency || 'INR',
      estimatedDeliveryDays: this.deliveryDays,
      status: 'ready_for_payment',
    };
  }

  async placeOrder(checkout, paymentDetails = {}) {
    const orderId = `ORD-${this.name.substring(0, 3).toUpperCase()}-${Math.floor(10000 + Math.random() * 90000)}`;
    return {
      merchantOrderId: orderId,
      checkoutId: checkout.checkoutId,
      merchantName: this.name,
      amount: checkout.finalAmount,
      currency: checkout.currency || 'INR',
      paymentId: paymentDetails.paymentId,
      status: 'confirmed',
      estimatedDelivery: `${this.deliveryDays} business days (Assured SLA)`,
      createdAt: new Date().toISOString(),
    };
  }

  async createOrder(checkout, paymentDetails = {}) {
    return this.placeOrder(checkout, paymentDetails);
  }

  async getOrder(orderId) {
    return {
      orderId,
      merchantName: this.name,
      status: 'CONFIRMED',
      fulfillment: 'Dispatched — In Transit via BlueDart Express',
      trackingNumber: `BD${Math.floor(100000000 + Math.random() * 900000000)}IN`,
    };
  }

  async getOrderStatus(orderId) {
    return this.getOrder(orderId);
  }

  async cancelOrder(orderId, reason = '') {
    return {
      orderId,
      status: 'CANCELLED',
      cancellationReason: reason || 'Buyer requested cancellation',
      cancelledAt: new Date().toISOString(),
    };
  }

  async requestRefund(orderId, amount, reason = '') {
    const refundId = `ref_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
    return {
      refundId,
      orderId,
      amount,
      status: 'REFUND_COMPLETED',
      refundedAt: new Date().toISOString(),
      reason: reason || 'Autonomous reconciliation / return request',
    };
  }

  async getRefundStatus(refundId) {
    return {
      refundId,
      status: 'REFUND_COMPLETED',
    };
  }
}

/**
 * Verified Merchant Store Adapter
 * Primary verified merchant for autonomous AI commerce
 */
export class VerifiedMerchantStoreAdapter extends StandardMerchantAdapter {
  constructor(merchantRecord) {
    super(merchantRecord);
    this.name = merchantRecord?.name || 'Acme Tech Electronics';
    this.rating = parseFloat(merchantRecord?.rating) || 4.95;
    this.deliveryDays = 2;
  }
}

/**
 * Commerce Multi-Merchant Orchestrator
 * Coordinates product discovery, comparison, cart, and checkout across all connected merchants.
 */
export class CommerceOrchestrator {
  constructor() {
    this.adapters = new Map();
  }

  async initialize() {
    this.adapters.clear();
    const res = await query('SELECT * FROM merchants WHERE is_verified = true AND (is_test_lab = false OR is_test_lab IS NULL) ORDER BY name ASC');
    for (const m of res.rows) {
      this.adapters.set(m.id, new VerifiedMerchantStoreAdapter(m));
    }
  }

  async searchAllMerchants(criteria = {}) {
    await this.initialize();

    const searchPromises = Array.from(this.adapters.values()).map((adapter) =>
      adapter.searchProducts(criteria).catch((err) => {
        console.error(`[Orchestrator] Error searching merchant ${adapter.name}:`, err.message);
        return [];
      })
    );

    const results = await Promise.all(searchPromises);
    const flattened = results.flat();

    // Multi-merchant comparison ranking: Promoted first, then price ascending
    return flattened.sort((a, b) => {
      if (a.is_promoted && !b.is_promoted) return -1;
      if (!a.is_promoted && b.is_promoted) return 1;
      return a.price - b.price;
    });
  }

  async getAdapter(merchantId) {
    if (this.adapters.size === 0) {
      await this.initialize();
    }
    return this.adapters.get(merchantId) || null;
  }
}

export const commerceOrchestrator = new CommerceOrchestrator();
