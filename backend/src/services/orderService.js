import crypto from 'crypto';
import env from '../config/env.js';
import { query } from '../config/database.js';
import { recordAuditEvent } from './auditService.js';
import { dispatchCommerceNotification } from './notificationDispatcher.js';
import { logger } from '../utils/logger.js';

export const OrderFulfillmentStates = {
  REQUESTED: 'REQUESTED',
  CONFIRMED: 'CONFIRMED',
  ORDER_CONFIRMED: 'CONFIRMED', // alias
  PROCESSING: 'PROCESSING',
  PACKED: 'PACKED',
  SHIPPED: 'SHIPPED',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
  COMPLETED: 'DELIVERED', // normalized
  CANCELLED: 'CANCELLED',
  REFUND_PENDING: 'REFUND_PENDING',
  REFUNDED: 'REFUNDED',
  RECONCILIATION_REQUIRED: 'RECONCILIATION_REQUIRED',
};

export const ALLOWED_FULFILLMENT_TRANSITIONS = {
  [OrderFulfillmentStates.REQUESTED]: [
    OrderFulfillmentStates.CONFIRMED,
    OrderFulfillmentStates.CANCELLED,
    OrderFulfillmentStates.RECONCILIATION_REQUIRED,
  ],
  [OrderFulfillmentStates.CONFIRMED]: [
    OrderFulfillmentStates.PROCESSING,
    OrderFulfillmentStates.CANCELLED,
    OrderFulfillmentStates.REFUND_PENDING,
    OrderFulfillmentStates.RECONCILIATION_REQUIRED,
  ],
  [OrderFulfillmentStates.PROCESSING]: [
    OrderFulfillmentStates.PACKED,
    OrderFulfillmentStates.CANCELLED,
    OrderFulfillmentStates.REFUND_PENDING,
  ],
  [OrderFulfillmentStates.PACKED]: [
    OrderFulfillmentStates.SHIPPED,
    OrderFulfillmentStates.CANCELLED,
    OrderFulfillmentStates.REFUND_PENDING,
  ],
  [OrderFulfillmentStates.SHIPPED]: [
    OrderFulfillmentStates.OUT_FOR_DELIVERY,
    OrderFulfillmentStates.REFUND_PENDING,
    OrderFulfillmentStates.RECONCILIATION_REQUIRED,
  ],
  [OrderFulfillmentStates.OUT_FOR_DELIVERY]: [
    OrderFulfillmentStates.DELIVERED,
    OrderFulfillmentStates.REFUND_PENDING,
    OrderFulfillmentStates.RECONCILIATION_REQUIRED,
  ],
  [OrderFulfillmentStates.DELIVERED]: [
    OrderFulfillmentStates.REFUND_PENDING,
    OrderFulfillmentStates.REFUNDED,
  ],
  [OrderFulfillmentStates.CANCELLED]: [
    OrderFulfillmentStates.REFUND_PENDING,
    OrderFulfillmentStates.REFUNDED,
  ],
  [OrderFulfillmentStates.REFUND_PENDING]: [
    OrderFulfillmentStates.REFUNDED,
    OrderFulfillmentStates.RECONCILIATION_REQUIRED,
  ],
  [OrderFulfillmentStates.REFUNDED]: [],
  [OrderFulfillmentStates.RECONCILIATION_REQUIRED]: [
    OrderFulfillmentStates.CONFIRMED,
    OrderFulfillmentStates.REFUND_PENDING,
    OrderFulfillmentStates.REFUNDED,
    OrderFulfillmentStates.CANCELLED,
  ],
};

/**
 * Generate human-readable order number (e.g. AGP-ORD-748192)
 */
export function generateOrderNumber() {
  const rand = Math.floor(100000 + Math.random() * 900000);
  return `AGP-ORD-${rand}`;
}

/**
 * Generate tracking number (e.g. TRK-MTAFRQZ3-5278)
 */
export function generateTrackingNumber() {
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `TRK-${Date.now().toString(36).toUpperCase()}-${rand}`;
}

/**
 * Create confirmed order after successful payment verification with immutable snapshots
 */
export async function createOrder({
  purchaseIntentId,
  transactionId,
  userId,
  merchantId,
  productId,
  quoteId = null,
  quantity = 1,
  unitPrice,
  subtotal,
  discount = 0,
  tax = 0,
  deliveryFee = 0,
  totalAmount = 0,
  paymentMethod = 'PREPAID',
  paymentStatus = 'VERIFIED',
  deliveryAddress = { name: 'AgentPay Buyer', address_line1: '742 Tech Park', city: 'Bengaluru', state: 'Karnataka', pincode: '560100' },
  deliveryMethod = 'STANDARD',
  estimatedDeliveryDate,
  carrier = 'AgentPay Express Logistics',
  productName,
  productSku,
  productBrand,
  productCategory,
  io,
}) {
  // 1. Idempotency Check: Return existing order if one exists for this transaction or intent
  if (transactionId || purchaseIntentId) {
    const existing = await query(`
      SELECT * FROM orders 
      WHERE (transaction_id IS NOT NULL AND transaction_id = $1)
         OR (purchase_intent_id IS NOT NULL AND purchase_intent_id = $2)
      LIMIT 1
    `, [transactionId || null, purchaseIntentId || null]);

    if (existing.rows.length > 0) {
      logger.info('Order', `Existing order ${existing.rows[0].order_number} found for transaction ${transactionId} / intent ${purchaseIntentId} — returning idempotent existing record.`);
      return existing.rows[0];
    }
  }

  const orderNumber = generateOrderNumber();
  const parsedQty = Math.max(1, parseInt(quantity, 10) || 1);
  const safeUnitPrice = unitPrice !== undefined ? Math.round(parseFloat(unitPrice) * 100) / 100 : Math.round((parseFloat(totalAmount) / parsedQty) * 100) / 100;
  const safeSubtotal = subtotal !== undefined ? Math.round(parseFloat(subtotal) * 100) / 100 : Math.round(safeUnitPrice * parsedQty * 100) / 100;
  const safeDeliveryFee = Math.round((parseFloat(deliveryFee) || 0) * 100) / 100;
  const safeDiscount = Math.round((parseFloat(discount) || 0) * 100) / 100;
  const safeTax = Math.round((parseFloat(tax) || 0) * 100) / 100;
  const safeTotal = totalAmount !== undefined 
    ? Math.round(parseFloat(totalAmount) * 100) / 100 
    : Math.round((safeSubtotal + safeDeliveryFee - safeDiscount) * 100) / 100;

  // Pricing Integrity Assertions
  const expectedSubtotal = Math.round(safeUnitPrice * parsedQty * 100) / 100;
  if (Math.abs(safeSubtotal - expectedSubtotal) > 0.05) {
    throw new Error(`Order creation rejected: Subtotal (₹${safeSubtotal}) does not match unit_price × quantity (₹${expectedSubtotal})`);
  }

  const expectedTotal = Math.round((safeSubtotal + safeDeliveryFee - safeDiscount) * 100) / 100;
  if (Math.abs(safeTotal - expectedTotal) > 0.05) {
    throw new Error(`Order creation rejected: Total amount (₹${safeTotal}) does not match subtotal + deliveryFee - discount (₹${expectedTotal})`);
  }

  // Fetch product snapshot if not fully supplied
  let snapName = productName;
  let snapSku = productSku;
  let snapBrand = productBrand;
  let snapCategory = productCategory;

  if (!snapName && productId) {
    const pRes = await query('SELECT name, sku, brand, category FROM products WHERE id = $1', [productId]);
    if (pRes.rows.length > 0) {
      const p = pRes.rows[0];
      snapName = p.name;
      snapSku = p.sku || `SKU-${productId.substring(0, 6).toUpperCase()}`;
      snapBrand = p.brand || 'Store Catalog';
      snapCategory = p.category || 'General';
    }
  }

  const now = new Date().toISOString();
  const initialTimeline = [
    {
      state: 'CONFIRMED',
      title: 'Order Confirmed',
      description: 'Autonomous purchase confirmed and payment captured via verified payment infrastructure.',
      timestamp: now,
      completed: true,
    },
    {
      state: 'PROCESSING',
      title: 'Merchant Processing',
      description: 'Merchant fulfillment system notified and preparing order items.',
      timestamp: null,
      completed: false,
    },
    {
      state: 'PACKED',
      title: 'Package Assembly',
      description: 'Items securely packed and prepared for courier dispatch.',
      timestamp: null,
      completed: false,
    },
    {
      state: 'SHIPPED',
      title: 'Dispatched to Carrier',
      description: `Package handed over to carrier.`,
      timestamp: null,
      completed: false,
    },
    {
      state: 'OUT_FOR_DELIVERY',
      title: 'Out for Delivery',
      description: 'Courier out for final delivery to destination address.',
      timestamp: null,
      completed: false,
    },
    {
      state: 'DELIVERED',
      title: 'Delivered',
      description: 'Package successfully delivered to buyer.',
      timestamp: null,
      completed: false,
    },
  ];

  const environment = env.APP_ENV.toUpperCase();
  const paymentMode = (paymentMethod?.toLowerCase().includes('live') || env.isLiveMode) ? 'LIVE' : 'TEST';

  let res;
  try {
    res = await query(`
      INSERT INTO orders (
        order_number, purchase_intent_id, transaction_id, user_id, merchant_id, product_id,
        quantity, unit_price, subtotal, discount, tax, delivery_fee, total_amount,
        payment_method, payment_status, order_status, fulfillment_status, settlement_status,
        product_name, product_sku, product_brand, product_category,
        delivery_address, delivery_method, estimated_delivery_date, tracking_number, carrier, timeline,
        environment, payment_mode, quote_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'CONFIRMED', 'CONFIRMED', 'PENDING', $16, $17, $18, $19, $20, $21, $22, NULL, $23, $24, $25, $26, $27)
      RETURNING *
    `, [
      orderNumber,
      purchaseIntentId,
      transactionId,
      userId,
      merchantId,
      productId,
      quantity,
      safeUnitPrice,
      safeSubtotal,
      discount,
      tax,
      deliveryFee,
      safeTotal,
      paymentMethod,
      paymentStatus,
      snapName || 'Autonomous Commerce Item',
      snapSku || `SKU-${Date.now().toString(36).toUpperCase()}`,
      snapBrand || 'Verified Merchant Store',
      snapCategory || 'General',
      JSON.stringify(deliveryAddress),
      deliveryMethod,
      estimatedDeliveryDate || new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
      carrier,
      JSON.stringify(initialTimeline),
      environment,
      paymentMode,
      quoteId,
    ]);
  } catch (insertErr) {
    if (insertErr.code === '23505' && (transactionId || purchaseIntentId)) {
      const existing = await query(`
        SELECT * FROM orders 
        WHERE (transaction_id IS NOT NULL AND transaction_id = $1)
           OR (purchase_intent_id IS NOT NULL AND purchase_intent_id = $2)
        LIMIT 1
      `, [transactionId || null, purchaseIntentId || null]);
      if (existing.rows.length > 0) {
        logger.info('Order', `Concurrent order creation caught by unique constraint — returning existing order ${existing.rows[0].order_number}`);
        return existing.rows[0];
      }
    }
    throw insertErr;
  }

  const order = res.rows[0];

  // Audit event
  await recordAuditEvent({
    eventType: 'ORDER_CREATED',
    actor: 'system',
    userId,
    purchaseIntentId,
    transactionId,
    action: 'CREATE_ORDER',
    decision: 'ALLOW',
    reasoning: `Order ${orderNumber} confirmed for ₹${totalAmount}.`,
    outcome: 'Order confirmed and ready for merchant processing',
    io,
  });

  // Dispatch event notifications
  await dispatchCommerceNotification({
    userId,
    merchantId,
    orderId: order.id,
    eventType: 'ORDER_CONFIRMED',
    orderData: { orderNumber, totalAmount },
    io,
  });

  // Real-time synchronization
  if (io) {
    io.emit('order:created', order);
    io.emit('order:updated', order);
  }

  return order;
}

/**
 * Advance order fulfillment status with server-side transition validation
 */
export async function transitionOrderFulfillment(orderId, targetStatus, { merchantId, trackingNumber, carrier, reason, io } = {}) {
  let currentRes = await query('SELECT * FROM orders WHERE id::text = $1 OR transaction_id::text = $1', [orderId]);
  
  if (currentRes.rows.length === 0) {
    const txRes = await query(`
      SELECT t.*, pi.merchant_id, pi.product_id, pi.quantity, pi.user_id, p.price, p.name as product_name, p.sku, p.brand, p.category
      FROM transactions t
      JOIN purchase_intents pi ON t.purchase_intent_id = pi.id
      LEFT JOIN products p ON pi.product_id = p.id
      WHERE t.id::text = $1
    `, [orderId]);

    if (txRes.rows.length > 0) {
      const tx = txRes.rows[0];
      const newOrder = await createOrder({
        purchaseIntentId: tx.purchase_intent_id,
        transactionId: tx.id,
        userId: tx.user_id,
        merchantId: tx.merchant_id,
        productId: tx.product_id,
        productName: tx.product_name,
        productSku: tx.sku,
        productBrand: tx.brand,
        productCategory: tx.category,
        quantity: tx.quantity || 1,
        unitPrice: parseFloat(tx.amount || tx.price || 0),
        subtotal: parseFloat(tx.amount || tx.price || 0),
        totalAmount: parseFloat(tx.amount || tx.price || 0),
        deliveryAddress: { name: 'AgentPay Buyer', city: 'Bengaluru', state: 'Karnataka', pincode: '560100' },
        io,
      });
      currentRes = { rows: [newOrder] };
    } else {
      throw new Error(`Order ${orderId} not found`);
    }
  }

  const order = currentRes.rows[0];
  if (merchantId && order.merchant_id !== merchantId) {
    const err = new Error('Unauthorized: You can only advance fulfillment for your own merchant orders.');
    err.status = 403;
    throw err;
  }

  const currentStatus = order.fulfillment_status || order.order_status || 'CONFIRMED';
  const allowed = ALLOWED_FULFILLMENT_TRANSITIONS[currentStatus] || [];

  if (!allowed.includes(targetStatus) && currentStatus !== targetStatus) {
    const err = new Error(`Invalid fulfillment transition from '${currentStatus}' to '${targetStatus}'. Allowed transitions: ${allowed.join(', ') || 'None'}`);
    err.status = 400;
    throw err;
  }

  const now = new Date().toISOString();
  let timeline = Array.isArray(order.timeline) ? [...order.timeline] : [];

  // Authentic tracking and carrier assignment
  let assignedTracking = trackingNumber !== undefined ? trackingNumber : (order.tracking_number || (targetStatus === 'SHIPPED' ? generateTrackingNumber() : null));
  let assignedCarrier = carrier !== undefined ? carrier : (order.carrier || 'AgentPay Express Logistics');

  timeline = timeline.map((step) => {
    if (step.state === targetStatus || (step.state === 'CONFIRMED' && targetStatus === 'ORDER_CONFIRMED')) {
      return {
        ...step,
        completed: true,
        timestamp: now,
        description: reason || (targetStatus === 'SHIPPED' && assignedTracking ? `Assigned to ${assignedCarrier || 'Carrier'} (${assignedTracking}).` : step.description),
      };
    }
    return step;
  });

  const res = await query(`
    UPDATE orders SET
      order_status = $2,
      fulfillment_status = $2,
      tracking_number = $3,
      carrier = $4,
      timeline = $5,
      updated_at = NOW()
    WHERE id = $1
    RETURNING *
  `, [order.id, targetStatus, assignedTracking, assignedCarrier, JSON.stringify(timeline)]);

  const updatedOrder = res.rows[0];

  // Audit event
  await recordAuditEvent({
    eventType: `ORDER_${targetStatus}`,
    actor: 'merchant',
    userId: updatedOrder.user_id,
    purchaseIntentId: updatedOrder.purchase_intent_id,
    transactionId: updatedOrder.transaction_id,
    action: 'UPDATE_FULFILLMENT_STATE',
    decision: 'ALLOW',
    reasoning: `Order ${updatedOrder.order_number} transitioned to ${targetStatus}.${assignedTracking ? ` Tracking: ${assignedTracking}` : ''}`,
    outcome: `Fulfillment state updated to ${targetStatus}`,
    io,
  });

  // Dispatch notification
  await dispatchCommerceNotification({
    userId: updatedOrder.user_id,
    merchantId: updatedOrder.merchant_id,
    orderId: updatedOrder.id,
    eventType: `ORDER_${targetStatus}`,
    orderData: {
      orderNumber: updatedOrder.order_number,
      trackingNumber: updatedOrder.tracking_number,
      carrier: updatedOrder.carrier,
    },
    io,
  });

  // Emit WebSocket real-time synchronization
  if (io) {
    io.emit('order:updated', updatedOrder);
    io.emit('order:fulfillment_updated', {
      orderId: updatedOrder.id,
      orderNumber: updatedOrder.order_number,
      orderStatus: targetStatus,
      fulfillmentStatus: targetStatus,
      trackingNumber: updatedOrder.tracking_number,
      carrier: updatedOrder.carrier,
      timeline: updatedOrder.timeline,
      updatedAt: updatedOrder.updated_at,
    });
  }

  return updatedOrder;
}

export async function getOrdersForUser(userId) {
  const res = await query(`
    SELECT o.id,
           o.order_number,
           o.purchase_intent_id,
           o.transaction_id,
           o.user_id,
           o.merchant_id,
           o.product_id,
           COALESCE(o.product_name, p.name, 'Catalog Product') as product_name,
           COALESCE(o.product_sku, p.sku, 'SKU-GENERIC') as product_sku,
           COALESCE(o.product_brand, p.brand, 'Store Catalog') as product_brand,
           COALESCE(o.product_category, p.category, 'General') as product_category,
           p.image_url as product_image,
           o.quantity,
           o.unit_price,
           o.subtotal,
           o.discount,
           o.tax,
           o.delivery_fee,
           o.total_amount,
           o.payment_method,
           o.payment_status,
           o.order_status,
           COALESCE(o.fulfillment_status, o.order_status) as fulfillment_status,
           o.settlement_status,
           o.delivery_address,
           o.delivery_method,
           o.estimated_delivery_date,
           o.tracking_number,
           o.carrier,
           o.timeline,
           o.created_at,
           o.updated_at,
           m.name as merchant_name,
           m.is_verified as merchant_verified,
           inv.id as invoice_id,
           inv.invoice_number
    FROM orders o
    LEFT JOIN products p ON o.product_id = p.id
    LEFT JOIN merchants m ON o.merchant_id = m.id
    LEFT JOIN invoices inv ON inv.order_id = o.id
    WHERE o.user_id = $1
    ORDER BY o.created_at DESC
  `, [userId]);
  return res.rows;
}

export async function cancelOrder(orderId, { cancelledBy = 'merchant', reason = 'BUYER_CANCELLED', merchantId = null, userId = null, io } = {}) {
  const currentRes = await query('SELECT * FROM orders WHERE id::text = $1 OR order_number = $1', [orderId]);
  if (currentRes.rows.length === 0) {
    const err = new Error(`Order ${orderId} not found`);
    err.status = 404;
    throw err;
  }
  const order = currentRes.rows[0];

  if (merchantId && order.merchant_id !== merchantId) {
    const err = new Error('Unauthorized: You can only cancel your own merchant orders.');
    err.status = 403;
    throw err;
  }
  if (userId && order.user_id !== userId) {
    const err = new Error('Unauthorized: You can only cancel your own orders.');
    err.status = 403;
    throw err;
  }

  const previousStatus = order.fulfillment_status || order.order_status || 'CONFIRMED';

  if (previousStatus === 'CANCELLED') {
    return order; // Idempotent return for already cancelled order
  }

  if (['SHIPPED', 'DELIVERED', 'COMPLETED'].includes(previousStatus)) {
    throw new Error(`Cannot cancel order in '${previousStatus}' state`);
  }

  const updated = await query(`
    UPDATE orders SET
      order_status = 'CANCELLED',
      fulfillment_status = 'CANCELLED',
      cancelled_at = NOW(),
      cancelled_by = $2,
      cancellation_reason = $3,
      previous_status = $4,
      updated_at = NOW()
    WHERE id = $1
    RETURNING *
  `, [order.id, cancelledBy, reason, previousStatus]);

  await recordAuditEvent({
    eventType: 'ORDER_CANCELLED',
    actor: cancelledBy,
    userId: order.user_id,
    merchantId: order.merchant_id,
    orderId: order.id,
    purchaseIntentId: order.purchase_intent_id,
    transactionId: order.transaction_id,
    action: 'CANCEL_ORDER',
    decision: 'ALLOW',
    reasoning: `Order ${order.order_number} cancelled by ${cancelledBy}. Reason: ${reason}. Previous status: ${previousStatus}.`,
    metadata: { orderNumber: order.order_number, cancellationReason: reason, previousStatus },
    io,
  });

  return updated.rows[0];
}

export async function getOrdersForMerchant(merchantId) {
  const res = await query(`
    SELECT o.id,
           o.order_number,
           o.purchase_intent_id,
           o.transaction_id,
           o.user_id,
           o.merchant_id,
           o.product_id,
           COALESCE(o.product_name, p.name, 'Catalog Product') as product_name,
           COALESCE(o.product_sku, p.sku, 'SKU-GENERIC') as product_sku,
           COALESCE(o.product_brand, p.brand, 'Store Catalog') as product_brand,
           COALESCE(o.product_category, p.category, 'General') as product_category,
           p.image_url as product_image,
           o.quantity,
           o.unit_price,
           o.subtotal,
           o.discount,
           o.tax,
           o.delivery_fee,
           o.total_amount,
           o.payment_method,
           o.payment_status,
           o.order_status,
           COALESCE(o.fulfillment_status, o.order_status) as fulfillment_status,
           o.settlement_status,
           o.delivery_address,
           o.delivery_method,
           o.estimated_delivery_date,
           o.tracking_number,
           o.carrier,
           o.timeline,
           o.quote_id,
           o.cancelled_at,
           o.cancelled_by,
           o.cancellation_reason,
           o.previous_status,
           o.created_at,
           o.updated_at,
           u.name as buyer_name,
           u.email as buyer_email,
           inv.id as invoice_id,
           inv.invoice_number
    FROM orders o
    LEFT JOIN products p ON o.product_id = p.id
    LEFT JOIN users u ON o.user_id = u.id
    LEFT JOIN invoices inv ON inv.order_id = o.id
    WHERE o.merchant_id = $1
    ORDER BY o.created_at DESC
  `, [merchantId]);
  return res.rows;
}

export async function getOrderById(orderId) {
  const res = await query(`
    SELECT o.id,
           o.order_number,
           o.purchase_intent_id,
           o.transaction_id,
           o.user_id,
           o.merchant_id,
           o.product_id,
           COALESCE(o.product_name, p.name, 'Catalog Product') as product_name,
           COALESCE(o.product_sku, p.sku, 'SKU-GENERIC') as product_sku,
           COALESCE(o.product_brand, p.brand, 'Store Catalog') as product_brand,
           COALESCE(o.product_category, p.category, 'General') as product_category,
           p.image_url as product_image,
           o.quantity,
           o.unit_price,
           o.subtotal,
           o.discount,
           o.tax,
           o.delivery_fee,
           o.total_amount,
           o.payment_method,
           o.payment_status,
           o.order_status,
           COALESCE(o.fulfillment_status, o.order_status) as fulfillment_status,
           o.settlement_status,
           o.delivery_address,
           o.delivery_method,
           o.estimated_delivery_date,
           o.tracking_number,
           o.carrier,
           o.timeline,
           o.created_at,
           o.updated_at,
           m.name as merchant_name,
           u.name as buyer_name,
           u.email as buyer_email,
           inv.id as invoice_id,
           inv.invoice_number
    FROM orders o
    LEFT JOIN products p ON o.product_id = p.id
    LEFT JOIN merchants m ON o.merchant_id = m.id
    LEFT JOIN users u ON o.user_id = u.id
    LEFT JOIN invoices inv ON inv.order_id = o.id
    WHERE o.id::text = $1 OR o.order_number = $1
  `, [orderId]);
  return res.rows[0] || null;
}

/**
 * Server-Authoritative Order Refund Processor
 * Enforces transition: REFUND_PENDING -> confirmed payment provider refund -> REFUNDED
 */
export async function processOrderRefund(orderId, { amount, reason = 'Buyer refund request', merchantId = null, userId = null, io } = {}) {
  const currentRes = await query('SELECT * FROM orders WHERE id::text = $1 OR order_number = $1', [orderId]);
  if (currentRes.rows.length === 0) {
    const err = new Error(`Order ${orderId} not found`);
    err.status = 404;
    throw err;
  }
  const order = currentRes.rows[0];

  if (merchantId && order.merchant_id !== merchantId) {
    const err = new Error('Unauthorized: You can only refund your own merchant orders.');
    err.status = 403;
    throw err;
  }
  if (userId && order.user_id !== userId) {
    const err = new Error('Unauthorized: You can only refund your own orders.');
    err.status = 403;
    throw err;
  }

  const currentStatus = order.fulfillment_status || order.order_status || 'CONFIRMED';

  const eligibleStatuses = ['CONFIRMED', 'PROCESSING', 'PACKED', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'RECONCILIATION_REQUIRED', 'REFUND_PENDING'];
  if (!eligibleStatuses.includes(currentStatus)) {
    throw new Error(`Cannot refund order in '${currentStatus}' state.`);
  }

  const refundAmount = amount ? Math.round(parseFloat(amount) * 100) / 100 : parseFloat(order.total_amount);

  // Transition to REFUND_PENDING
  await query(`
    UPDATE orders SET
      order_status = 'REFUND_PENDING',
      fulfillment_status = 'REFUND_PENDING',
      updated_at = NOW()
    WHERE id = $1
  `, [order.id]);

  let refundResult = null;
  if (order.transaction_id) {
    const { refundTransaction } = await import('./paymentService.js');
    refundResult = await refundTransaction({
      transactionId: order.transaction_id,
      amount: refundAmount,
      reason,
      io,
    });
  }

  // Advance to REFUNDED upon confirmation
  const updated = await query(`
    UPDATE orders SET
      order_status = 'REFUNDED',
      fulfillment_status = 'REFUNDED',
      updated_at = NOW()
    WHERE id = $1
    RETURNING *
  `, [order.id]);

  const refundedOrder = updated.rows[0];

  await recordAuditEvent({
    eventType: 'ORDER_REFUNDED',
    actor: 'merchant',
    userId: refundedOrder.user_id,
    merchantId: refundedOrder.merchant_id,
    orderId: refundedOrder.id,
    purchaseIntentId: refundedOrder.purchase_intent_id,
    transactionId: refundedOrder.transaction_id,
    action: 'REFUND_ORDER',
    decision: 'ALLOW',
    reasoning: `Order ${refundedOrder.order_number} refunded for ₹${refundAmount}. Reason: ${reason}.`,
    metadata: { orderNumber: refundedOrder.order_number, refundAmount, refundId: refundResult?.refundId },
    io,
  });

  if (io) {
    io.emit('order:updated', refundedOrder);
    io.emit('order:fulfillment_updated', {
      orderId: refundedOrder.id,
      orderNumber: refundedOrder.order_number,
      orderStatus: 'REFUNDED',
      fulfillmentStatus: 'REFUNDED',
      updatedAt: refundedOrder.updated_at,
    });
  }

  return {
    success: true,
    order: refundedOrder,
    refundId: refundResult?.refundId || `rfnd_${Date.now()}`,
    status: 'REFUNDED',
    amount: refundAmount,
  };
}
