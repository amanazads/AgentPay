import { Router } from 'express';
import { query } from '../config/database.js';
import { requireAuth, requireBuyer } from '../middleware/authMiddleware.js';
import { commerceOrchestrator } from '../services/merchantAdapter.js';
import { getUserIdFromRequest } from '../utils/authUtils.js';
import { getAddresses, createAddress, updateAddress, deleteAddress, getDefaultAddress } from '../services/addressService.js';
import { getOrdersForUser, getOrderById } from '../services/orderService.js';
import { getInvoiceByOrderId, getInvoiceById } from '../services/invoiceService.js';

const router = Router();

// Apply Buyer guards to all buyer endpoints
router.use(requireAuth, requireBuyer);

// POST /api/buyer/search — Search products across platform merchants (excludes test lab)
router.post('/search', async (req, res, next) => {
  try {
    const { query: searchQuery, category, maxPrice } = req.body || {};
    const results = await commerceOrchestrator.searchAllMerchants({
      query: searchQuery,
      category,
      maxPrice: maxPrice || 250000,
      limit: 20,
    });
    res.json({ products: results, count: results.length });
  } catch (err) {
    next(err);
  }
});

// GET /api/buyer/purchases — Buyer's transaction ledger with authoritative fulfillment states
router.get('/purchases', async (req, res, next) => {
  try {
    const userId = getUserIdFromRequest(req);
    
    // Fetch authoritative confirmed orders from orders table
    const orders = await getOrdersForUser(userId);

    // Fetch transactions & intents (including blocked / failed / pending for full history)
    const txRes = await query(`
      SELECT t.id,
             t.amount,
             t.status as tx_status,
             t.created_at,
             t.razorpay_order_id,
             t.razorpay_payment_id,
             pi.id as intent_id,
             pi.status as intent_status,
             pi.ai_reasoning,
             pi.ai_recommendation,
             COALESCE(o.product_name, p.name, 'Autonomous Purchase') as product_name, 
             COALESCE(o.product_brand, p.brand, 'Store Catalog') as product_brand,
             COALESCE(o.product_category, p.category, 'General') as product_category,
             p.image_url as product_image,
             m.name as merchant_name, 
             m.is_verified as merchant_verified,
             o.id as order_id,
             o.order_number,
             o.order_status,
             COALESCE(o.fulfillment_status, o.order_status, 'CONFIRMED') as fulfillment_status,
             o.payment_status,
             o.tracking_number,
             o.carrier,
             o.timeline as order_timeline,
             inv.id as invoice_id,
             inv.invoice_number
      FROM transactions t
      JOIN purchase_intents pi ON t.purchase_intent_id = pi.id
      LEFT JOIN products p ON pi.product_id = p.id
      LEFT JOIN merchants m ON pi.merchant_id = m.id
      LEFT JOIN orders o ON (o.transaction_id = t.id OR (t.purchase_intent_id IS NOT NULL AND o.purchase_intent_id = t.purchase_intent_id))
      LEFT JOIN invoices inv ON inv.order_id = o.id
      WHERE t.user_id = $1
      ORDER BY t.created_at DESC
      LIMIT 100
    `, [userId]);

    // Also fetch blocked purchase intents with ₹0 charge
    const blockedRes = await query(`
      SELECT pi.id as intent_id,
             pi.amount,
             pi.status as intent_status,
             pi.ai_reasoning,
             pi.ai_recommendation,
             p.name as product_name,
             p.brand as product_brand,
             p.category as product_category,
             m.name as merchant_name,
             pi.created_at
      FROM purchase_intents pi
      LEFT JOIN products p ON pi.product_id = p.id
      LEFT JOIN merchants m ON pi.merchant_id = m.id
      WHERE pi.user_id = $1 AND pi.status = 'blocked'
      ORDER BY pi.created_at DESC
      LIMIT 20
    `, [userId]);

    // Format purchases list
    const purchases = [];

    // 1. Confirmed Orders
    for (const o of orders) {
      purchases.push({
        id: o.id,
        order_id: o.id,
        order_number: o.order_number,
        product_name: o.product_name,
        product_brand: o.product_brand,
        product_category: o.product_category,
        product_image: o.product_image,
        amount: parseFloat(o.total_amount),
        merchant_name: o.merchant_name || 'Verified Merchant Store',
        merchant_verified: o.merchant_verified,
        payment_status: o.payment_status || 'VERIFIED',
        order_status: o.order_status || 'CONFIRMED',
        fulfillment_status: o.fulfillment_status || o.order_status || 'CONFIRMED',
        status: o.fulfillment_status || o.order_status || 'CONFIRMED',
        tracking_number: o.tracking_number,
        carrier: o.carrier || (['SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(o.fulfillment_status) ? 'Simulated Courier (Demo)' : null),
        is_simulated: o.environment !== 'LIVE',
        timeline: o.timeline || [],
        order_timeline: o.timeline || [],
        invoice_id: o.invoice_id,
        invoice_number: o.invoice_number,
        created_at: o.created_at,
        is_order: true,
        why: 'Discovered and purchased by Autonomous Buyer Agent',
      });
    }

    // 1b. Pending, Failed & Reconciliation Transactions (where no confirmed order exists)
    for (const t of txRes.rows) {
      if (!t.order_id) {
        const isReconciliation = t.tx_status === 'reconciliation_required' || t.intent_status === 'reconciliation_required';
        const isFailed = t.tx_status === 'failed' || t.intent_status === 'failed';

        purchases.push({
          id: t.id,
          order_id: null,
          order_number: `TX-${t.id.substring(0, 8).toUpperCase()}`,
          product_name: t.product_name || 'Procurement Item',
          product_brand: t.product_brand || 'Store Catalog',
          product_category: t.product_category || 'General',
          product_image: t.product_image,
          amount: parseFloat(t.amount || 0),
          merchant_name: t.merchant_name || 'Store Catalog',
          merchant_verified: t.merchant_verified,
          payment_status: isReconciliation ? 'RECONCILIATION_REQUIRED' : isFailed ? 'FAILED' : 'PAYMENT_PENDING',
          order_status: isReconciliation ? 'RECONCILIATION_REQUIRED' : isFailed ? 'PAYMENT_FAILED' : 'PAYMENT_PENDING',
          fulfillment_status: isReconciliation ? 'RECONCILIATION_REQUIRED' : isFailed ? 'PAYMENT_FAILED' : 'NOT_STARTED',
          status: isReconciliation ? 'RECONCILIATION_REQUIRED' : isFailed ? 'PAYMENT_FAILED' : 'PAYMENT_PENDING',
          tracking_number: null,
          carrier: null,
          timeline: [],
          order_timeline: [],
          invoice_id: null,
          invoice_number: null,
          created_at: t.created_at,
          is_order: false,
          why: isReconciliation
            ? 'Payment status pending / reconciliation required'
            : isFailed
            ? 'Payment attempt failed'
            : 'Payment authorized, awaiting settlement',
        });
      }
    }

    // 2. Blocked Transactions
    for (const b of blockedRes.rows) {
      purchases.push({
        id: b.intent_id,
        order_id: null,
        order_number: `INTENT-${b.intent_id.substring(0, 8).toUpperCase()}`,
        product_name: b.product_name || 'Blocked Item',
        product_brand: b.product_brand || 'Store Catalog',
        product_category: b.product_category || 'General',
        amount: parseFloat(b.amount || 0),
        merchant_name: b.merchant_name || 'Store Catalog',
        payment_status: 'NOT_ATTEMPTED',
        order_status: 'BLOCKED',
        fulfillment_status: 'NOT_CREATED',
        status: 'BLOCKED',
        tracking_number: null,
        carrier: null,
        timeline: [],
        invoice_id: null,
        created_at: b.created_at,
        is_order: false,
        why: b.ai_reasoning || 'Transaction blocked by AgentPay Safety & Policy Guard',
      });
    }

    res.json({
      purchases,
      orders,
      count: purchases.length,
      metrics: {
        totalConfirmed: orders.length,
        totalDelivered: orders.filter((o) => (o.fulfillment_status || o.order_status) === 'DELIVERED').length,
        totalBlocked: blockedRes.rows.length,
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/buyer/orders — Confirmed orders list
router.get('/orders', async (req, res, next) => {
  try {
    const userId = getUserIdFromRequest(req);
    const orders = await getOrdersForUser(userId);
    res.json({ orders, count: orders.length });
  } catch (err) {
    next(err);
  }
});

// GET /api/buyer/orders/:id — Order detail with vertical timeline
router.get('/orders/:id', async (req, res, next) => {
  try {
    const order = await getOrderById(req.params.id);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    const userId = getUserIdFromRequest(req);
    if (order.user_id && order.user_id !== userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    res.json({ order });
  } catch (err) {
    next(err);
  }
});

// GET /api/buyer/invoices/:orderId — Invoice detail
router.get('/invoices/:orderId', async (req, res, next) => {
  try {
    const invoice = await getInvoiceByOrderId(req.params.orderId);
    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found for this order' });
    }
    const userId = getUserIdFromRequest(req);
    if (invoice.user_id && invoice.user_id !== userId) {
      return res.status(403).json({ error: 'Unauthorized to access this invoice' });
    }
    res.json({ invoice });
  } catch (err) {
    next(err);
  }
});

// Address Management Endpoints
router.get('/addresses', async (req, res, next) => {
  try {
    const userId = getUserIdFromRequest(req);
    const addresses = await getAddresses(userId);
    const defaultAddr = await getDefaultAddress(userId);
    res.json({ addresses, defaultAddress: defaultAddr });
  } catch (err) {
    next(err);
  }
});

router.post('/addresses', async (req, res, next) => {
  try {
    const userId = getUserIdFromRequest(req);
    const address = await createAddress(userId, req.body);
    res.status(201).json({ success: true, address });
  } catch (err) {
    next(err);
  }
});

router.put('/addresses/:id', async (req, res, next) => {
  try {
    const userId = getUserIdFromRequest(req);
    const address = await updateAddress(userId, req.params.id, req.body);
    if (!address) return res.status(404).json({ error: 'Address not found' });
    res.json({ success: true, address });
  } catch (err) {
    next(err);
  }
});

router.delete('/addresses/:id', async (req, res, next) => {
  try {
    const userId = getUserIdFromRequest(req);
    const deleted = await deleteAddress(userId, req.params.id);
    res.json({ success: deleted });
  } catch (err) {
    next(err);
  }
});

// GET /api/buyer/preferences — Buyer's spending ceiling & criteria with authoritative spend metrics
router.get('/preferences', async (req, res, next) => {
  try {
    const userId = getUserIdFromRequest(req);
    const { getSpendingSummary } = await import('../services/spendingService.js');
    const spendingSummary = await getSpendingSummary(userId);

    res.json({
      preferences: {
        monthlyBudget: spendingSummary.monthlyBudget,
        spentThisMonth: spendingSummary.spentThisMonth,
        grossSpent: spendingSummary.grossSpent,
        totalRefunded: spendingSummary.totalRefunded,
        orderCount: spendingSummary.orderCount,
        remainingBudget: spendingSummary.remainingBudget,
        automaticPurchaseLimit: spendingSummary.autoPurchaseLimit,
        categories: spendingSummary.categories,
        preferredBrands: spendingSummary.preferredBrands,
        deliveryPreference: spendingSummary.deliveryPreference,
        purchaseBehavior: spendingSummary.purchaseBehavior,
        customCriteria: spendingSummary.customCriteria,
        naturalLanguageRules: spendingSummary.naturalLanguageRules,
        categoryRules: spendingSummary.categoryRules,
        deliveryRules: spendingSummary.deliveryRules,
        brandRules: spendingSummary.brandRules,
        policyVersion: spendingSummary.policyVersion,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/buyer/preferences — Update buyer limits & criteria with validation and audit history
router.post('/preferences', async (req, res, next) => {
  try {
    const userId = getUserIdFromRequest(req);
    const {
      monthlyBudget = 100000,
      automaticPurchaseLimit = 50000,
      categories = ['Electronics', 'Peripherals'],
      preferredBrands = ['Apple', 'Sony', 'Logitech'],
      deliveryPreference = 'Fastest available (within 2 days)',
      purchaseBehavior = 'auto_within_limit',
      customCriteria = [],
      naturalLanguageRules = [],
      categoryRules = {},
      deliveryRules = {},
      brandRules = {},
    } = req.body;

    const numMonthlyBudget = parseFloat(monthlyBudget);
    const numAutoLimit = parseFloat(automaticPurchaseLimit);

    if (isNaN(numMonthlyBudget) || numMonthlyBudget <= 0) {
      return res.status(400).json({ error: 'Monthly budget must be a positive number greater than 0.' });
    }
    if (isNaN(numAutoLimit) || numAutoLimit < 0) {
      return res.status(400).json({ error: 'Autonomous purchase limit must be greater than or equal to 0.' });
    }
    if (numAutoLimit > numMonthlyBudget) {
      return res.status(400).json({ error: `Autonomous limit (₹${numAutoLimit}) cannot exceed total monthly budget (₹${numMonthlyBudget}).` });
    }
    if (!Array.isArray(categories) || categories.length === 0) {
      return res.status(400).json({ error: 'At least one permitted product category must be selected.' });
    }

    const existingRes = await query('SELECT * FROM user_preferences WHERE user_id = $1', [userId]);
    const oldRow = existingRes.rows[0] || {};
    const oldVersion = parseInt(oldRow.policy_version || 1);
    const newVersion = oldVersion + 1;

    await query(`
      INSERT INTO user_preferences (
        user_id, monthly_budget, auto_purchase_limit, categories, preferred_brands, delivery_preference,
        purchase_behavior, custom_criteria, natural_language_rules, category_rules, delivery_rules, brand_rules, policy_version, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        monthly_budget = $2,
        auto_purchase_limit = $3,
        categories = $4,
        preferred_brands = $5,
        delivery_preference = $6,
        purchase_behavior = $7,
        custom_criteria = $8,
        natural_language_rules = $9,
        category_rules = $10,
        delivery_rules = $11,
        brand_rules = $12,
        policy_version = $13,
        updated_at = NOW()
    `, [
      userId,
      numMonthlyBudget,
      numAutoLimit,
      categories,
      preferredBrands,
      deliveryPreference,
      purchaseBehavior,
      JSON.stringify(customCriteria),
      JSON.stringify(naturalLanguageRules),
      JSON.stringify(categoryRules),
      JSON.stringify(deliveryRules),
      JSON.stringify(brandRules),
      newVersion,
    ]);

    const { getSpendingSummary } = await import('../services/spendingService.js');
    const updated = await getSpendingSummary(userId);

    res.json({
      success: true,
      message: 'Preferences updated successfully',
      preferences: updated,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/buyer/connections — Verified platform merchant network (excludes test lab)
router.get('/connections', async (req, res, next) => {
  try {
    const merchRes = await query('SELECT * FROM merchants WHERE is_verified = true AND (is_test_lab = false OR is_test_lab IS NULL) ORDER BY name ASC');
    const formatted = merchRes.rows.map((m) => ({
      merchantId: m.id,
      merchantName: m.name,
      category: m.category,
      description: m.description,
      isVerified: true,
      rating: parseFloat(m.rating) || 4.8,
      status: 'AVAILABLE',
      capabilities: {
        productDiscovery: true,
        liveInventory: true,
        cartCreation: true,
        autonomousOrder: true,
      },
    }));

    res.json({ merchants: formatted, count: formatted.length });
  } catch (err) {
    next(err);
  }
});

export default router;
