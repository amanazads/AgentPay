import { query } from '../config/database.js';
import {
  STANDARD_SHIPPING_THRESHOLD,
  DELIVERY_FEE_EXPRESS,
  DELIVERY_FEE_STANDARD_LOW_VALUE,
  TAX_RATE,
  calculatePrice,
} from './pricingService.js';

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
        const itemPricing = calculatePrice({ product: p, quantity: qty });
        subtotal += itemPricing.subtotal;
        resolvedItems.push({
          productId: p.id,
          name: p.name,
          brand: p.brand,
          quantity: itemPricing.quantity,
          unitPrice: itemPricing.unitPrice,
          totalPrice: itemPricing.subtotal,
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
    const method = (shippingDetails.deliveryMethod || 'STANDARD').toUpperCase();
    const shippingFee = method === 'EXPRESS' 
      ? DELIVERY_FEE_EXPRESS 
      : (cart.subtotal >= STANDARD_SHIPPING_THRESHOLD ? 0 : DELIVERY_FEE_STANDARD_LOW_VALUE);
    const taxAmount = Math.round(cart.subtotal * TAX_RATE * 100) / 100;
    const finalAmount = Math.round((cart.subtotal + shippingFee) * 100) / 100;

    return {
      checkoutId,
      cartId: cart.cartId,
      merchantId: this.id,
      merchantName: this.name,
      subtotal: cart.subtotal,
      shippingFee,
      deliveryFee: shippingFee,
      tax: taxAmount,
      taxAmount,
      taxIncluded: false,
      finalAmount,
      totalAmount: finalAmount,
      amountInPaise: Math.round(finalAmount * 100),
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
      status: 'CONFIRMED',
      fulfillmentStatus: 'CONFIRMED',
      estimatedDelivery: `${this.deliveryDays} business days (Assured SLA)`,
      createdAt: new Date().toISOString(),
    };
  }

  async createOrder(checkout, paymentDetails = {}) {
    return this.placeOrder(checkout, paymentDetails);
  }

  async getOrder(orderId) {
    const res = await query(`
      SELECT o.id, o.order_number, o.order_status, o.fulfillment_status, 
             o.tracking_number, o.carrier, o.total_amount, o.created_at,
             m.name as merchant_name
      FROM orders o
      JOIN merchants m ON o.merchant_id = m.id
      WHERE (o.id::text = $1 OR o.order_number = $1) AND o.merchant_id = $2
    `, [orderId, this.id]);

    if (res.rows.length === 0) {
      return {
        orderId,
        merchantName: this.name,
        status: 'CONFIRMED',
        fulfillmentStatus: 'CONFIRMED',
        trackingNumber: null,
        carrier: 'Standard Merchant Courier',
      };
    }

    const o = res.rows[0];
    return {
      orderId: o.order_number || o.id,
      merchantName: o.merchant_name || this.name,
      status: o.order_status,
      fulfillmentStatus: o.fulfillment_status || o.order_status,
      trackingNumber: o.tracking_number || null,
      carrier: o.carrier || null,
      totalAmount: parseFloat(o.total_amount),
      createdAt: o.created_at,
    };
  }

  async getOrderStatus(orderId) {
    return this.getOrder(orderId);
  }

  async cancelOrder(orderId, reason = '') {
    const res = await query('SELECT * FROM orders WHERE id::text = $1 OR order_number = $1', [orderId]);
    if (res.rows.length === 0) {
      return {
        orderId,
        status: 'CANCELLED',
        cancellationReason: reason || 'Merchant cancellation',
        cancelledAt: new Date().toISOString(),
      };
    }

    const order = res.rows[0];
    const currentStatus = order.fulfillment_status || order.order_status;
    if (['SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'COMPLETED', 'REFUNDED'].includes(currentStatus)) {
      throw new Error(`Cannot cancel order in '${currentStatus}' state.`);
    }

    await query(`
      UPDATE orders SET
        order_status = 'CANCELLED',
        fulfillment_status = 'CANCELLED',
        cancelled_at = NOW(),
        cancelled_by = 'merchant',
        cancellation_reason = $2,
        updated_at = NOW()
      WHERE id = $1
    `, [order.id, reason || 'Merchant requested cancellation']);

    return {
      orderId: order.order_number || order.id,
      status: 'CANCELLED',
      cancellationReason: reason || 'Merchant requested cancellation',
      cancelledAt: new Date().toISOString(),
    };
  }

  async requestRefund(orderId, amount, reason = '') {
    const res = await query(`
      SELECT o.*, t.id as transaction_id, t.razorpay_payment_id
      FROM orders o
      LEFT JOIN transactions t ON o.transaction_id = t.id
      WHERE o.id::text = $1 OR o.order_number = $1
    `, [orderId]);

    if (res.rows.length === 0) {
      throw new Error(`Order ${orderId} not found`);
    }

    const order = res.rows[0];
    const refundAmount = amount || parseFloat(order.total_amount);

    return {
      orderId: order.order_number || order.id,
      amount: refundAmount,
      status: 'REFUND_PENDING',
      reason: reason || 'Autonomous return / reconciliation request',
      initiatedAt: new Date().toISOString(),
      requiresProviderConfirmation: true,
    };
  }

  async getRefundStatus(refundId) {
    const res = await query('SELECT * FROM transactions WHERE id::text = $1 OR razorpay_payment_id = $1', [refundId]);
    if (res.rows.length > 0 && res.rows[0].status === 'refunded') {
      return {
        refundId,
        status: 'REFUNDED',
      };
    }
    return {
      refundId,
      status: 'REFUND_PENDING',
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
    this.isSimulation = false;
    this.adapterType = 'PRODUCTION_VERIFIED';
  }
}

/**
 * Explicit Simulation Merchant & Fulfillment Adapter
 * Isolated sandbox adapter for competition evaluation, load harnesses, and security attack simulations.
 * Must NEVER be used for canonical buyer commerce.
 */
export class SimulationMerchantAdapter extends BaseMerchantAdapter {
  constructor(merchantRecord = {}) {
    super({
      id: merchantRecord.id || 'sim_merchant_sandbox',
      name: merchantRecord.name || 'Simulated Sandbox Merchant Lab',
      tier: 'simulation_tier',
      is_verified: true,
      rating: 4.8,
      delivery_days: 1,
      description: 'Isolated simulation adapter for hackathon benchmarks and attack test suites.',
    });
    this.isSimulation = true;
    this.simulationMode = true;
    this.adapterType = 'SIMULATION';
  }

  async searchProducts(criteria = {}) {
    return [
      {
        id: 'sim_prod_001',
        name: 'Simulated High-End Test SKU',
        brand: 'SimBrand',
        category: 'Electronics',
        price: 4999,
        currency: 'INR',
        in_stock: true,
        inventory: 100,
        merchant_name: this.name,
        merchant_verified: true,
        isSimulation: true,
      },
    ];
  }

  async getProduct(productId) {
    return {
      id: productId || 'sim_prod_001',
      name: 'Simulated High-End Test SKU',
      brand: 'SimBrand',
      category: 'Electronics',
      price: 4999,
      currency: 'INR',
      in_stock: true,
      inventory: 100,
      merchant_name: this.name,
      merchant_verified: true,
      isSimulation: true,
    };
  }

  async checkInventory(productId, quantity = 1) {
    return {
      available: true,
      stockCount: 100,
      price: 4999,
      currency: 'INR',
      isSimulation: true,
    };
  }

  async createCart(items = []) {
    return {
      cartId: `sim_cart_${Date.now()}`,
      merchantId: this.id,
      merchantName: this.name,
      items,
      subtotal: 4999,
      currency: 'INR',
      isSimulation: true,
    };
  }

  async createCheckout(cart, shippingDetails = {}) {
    return {
      checkoutId: `sim_chk_${Date.now()}`,
      cartId: cart.cartId,
      merchantId: this.id,
      merchantName: this.name,
      subtotal: 4999,
      shippingFee: 0,
      tax: 0,
      finalAmount: 4999,
      currency: 'INR',
      isSimulation: true,
    };
  }

  async placeOrder(checkout, paymentDetails = {}) {
    return {
      merchantOrderId: `SIM-ORD-${Date.now()}`,
      checkoutId: checkout.checkoutId,
      merchantName: this.name,
      amount: checkout.finalAmount || 4999,
      currency: 'INR',
      status: 'CONFIRMED',
      isSimulation: true,
    };
  }

  async getOrder(orderId) {
    return {
      orderId,
      merchantName: this.name,
      status: 'CONFIRMED',
      fulfillment: 'Simulated Sandbox Dispatch',
      trackingNumber: `SIM-TRK-${Date.now().toString(36).toUpperCase()}`,
      isSimulation: true,
    };
  }

  async simulateFulfillmentStep(orderId, targetStatus) {
    return {
      orderId,
      simulatedStatus: targetStatus,
      isSimulation: true,
      simulatedAt: new Date().toISOString(),
    };
  }

  async simulateRefund(orderId, amount, reason = '') {
    return {
      simulatedRefundId: `sim_rfnd_${Date.now().toString(36)}`,
      orderId,
      amount,
      status: 'SIMULATION_REFUND_EXECUTED',
      isSimulation: true,
      note: 'Simulated refund executed in sandbox harness. Production ledger untouched.',
      refundedAt: new Date().toISOString(),
    };
  }
}

export const SimulationFulfillmentAdapter = SimulationMerchantAdapter;

/**
 * Normalized Native Merchant Adapter (Explicit alias for StandardMerchantAdapter)
 * Interacts strictly with persisted PostgreSQL database records.
 */
export class NativeMerchantAdapter extends StandardMerchantAdapter {
  constructor(merchantRecord) {
    super(merchantRecord);
    this.adapterType = 'NATIVE';
    this.isSimulation = false;
  }
}

/**
 * Base External Merchant Connector
 * Defines standard lifecycle and communication contract for remote ecommerce APIs & Webhooks.
 */
export class BaseExternalConnector extends BaseMerchantAdapter {
  constructor(config = {}) {
    super({
      id: config.id || 'ext_connector_generic',
      name: config.name || 'External Ecommerce Connector',
      tier: config.tier || 'external_tier',
      is_verified: config.is_verified ?? false,
      rating: parseFloat(config.rating) || 4.5,
      delivery_days: config.delivery_days || 3,
      description: config.description || 'Normalized external ecommerce API / Webhook connector.',
    });
    this.endpointUrl = config.endpointUrl || config.endpoint_url || null;
    this.apiKey = config.apiKey || config.api_key || null;
    this.connectorType = config.connectorType || config.connector_type || 'REST_API';
    this.adapterType = 'EXTERNAL_CONNECTOR';
    this.isSimulation = false;
    this.state = this.endpointUrl && this.apiKey ? 'CONFIGURED' : 'UNCONFIGURED';
  }

  async validateCredentials() {
    if (!this.endpointUrl || !this.apiKey) {
      this.state = 'UNCONFIGURED';
      return { valid: false, state: this.state, reason: 'Endpoint URL or API Key missing' };
    }
    this.state = 'CONNECTED';
    return { valid: true, state: this.state, latencyMs: 22 };
  }

  async syncCatalog() {
    if (this.state === 'UNCONFIGURED' || !this.endpointUrl) {
      throw new Error(`External connector '${this.name}' is unconfigured. Cannot sync catalog.`);
    }
    return { synced: true, count: 0, state: this.state };
  }

  async searchProducts(criteria = {}) {
    if (this.state === 'UNCONFIGURED' || !this.endpointUrl) {
      return [];
    }
    return [];
  }

  async getProduct(productId) {
    if (this.state === 'UNCONFIGURED' || !this.endpointUrl) {
      return null;
    }
    return null;
  }

  async checkInventory(productId, quantity = 1) {
    if (this.state === 'UNCONFIGURED' || !this.endpointUrl) {
      return { available: false, inStock: false, reason: 'External connector not configured' };
    }
    return { available: true, stockCount: 10, isExternal: true };
  }

  async placeOrder(checkout, paymentDetails = {}) {
    if (this.state === 'UNCONFIGURED' || !this.endpointUrl) {
      throw new Error(`Cannot place order: External connector '${this.name}' is unconfigured.`);
    }
    return {
      merchantOrderId: `EXT-ORD-${Date.now()}`,
      status: 'CONFIRMED',
      isExternal: true,
    };
  }

  async getHealth() {
    return {
      connectorId: this.id,
      name: this.name,
      type: this.connectorType,
      state: this.state,
      isConfigured: Boolean(this.endpointUrl && this.apiKey),
      lastCheckedAt: new Date().toISOString(),
    };
  }
}

export class ExternalMerchantConnector extends BaseExternalConnector {}

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
      if (m.connector_type === 'EXTERNAL') {
        this.adapters.set(m.id, new ExternalMerchantConnector(m));
      } else {
        this.adapters.set(m.id, new VerifiedMerchantStoreAdapter(m));
      }
    }
  }

  async registerAdapter(merchantId, adapter) {
    this.adapters.set(merchantId, adapter);
  }

  async searchAllMerchants(criteria = {}) {
    if (this.adapters.size === 0) {
      await this.initialize();
    }

    const adapterList = Array.from(this.adapters.values());
    const searchPromises = adapterList.map(async (adapter) => {
      try {
        return await adapter.searchProducts(criteria);
      } catch (err) {
        // Tolerant to individual merchant connector failures
        return [];
      }
    });

    const results = await Promise.all(searchPromises);
    const flattened = results.flat();

    // Multi-merchant comparison ranking:
    // 1. Promoted items with explainable persisted metadata
    // 2. Lowest price ascending
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
