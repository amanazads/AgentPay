import { query } from '../config/database.js';
import { recordAuditEvent } from './auditService.js';

export function generateInvoiceNumber() {
  const d = new Date();
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const rand = Math.floor(10000 + Math.random() * 90000);
  return `INV-${yr}${mo}-${rand}`;
}

/**
 * Generates an idempotent invoice for a confirmed order
 */
export async function generateInvoiceForOrder(orderId, { paymentReference, billingAddress, shippingAddress, io } = {}) {
  // Check if invoice already exists (Idempotency)
  const existing = await query('SELECT * FROM invoices WHERE order_id = $1', [orderId]);
  if (existing.rows.length > 0) {
    return existing.rows[0];
  }

  const orderRes = await query(`
    SELECT o.*, 
           p.name as product_name, p.brand as product_brand, p.category as product_category,
           m.name as merchant_name, m.category as merchant_category,
           u.name as buyer_name, u.email as buyer_email
    FROM orders o
    LEFT JOIN products p ON o.product_id = p.id
    LEFT JOIN merchants m ON o.merchant_id = m.id
    LEFT JOIN users u ON o.user_id = u.id
    WHERE o.id = $1
  `, [orderId]);

  if (orderRes.rows.length === 0) {
    throw new Error(`Cannot generate invoice: Order ${orderId} not found`);
  }

  const order = orderRes.rows[0];
  const invoiceNumber = generateInvoiceNumber();

  const items = [
    {
      productId: order.product_id,
      name: order.product_name || 'Product',
      brand: order.product_brand || 'Standard',
      category: order.product_category || 'Electronics',
      quantity: order.quantity || 1,
      unitPrice: parseFloat(order.unit_price) || 0,
      total: parseFloat(order.subtotal) || 0,
    },
  ];

  const billAddr = billingAddress || order.delivery_address || { name: order.buyer_name, city: 'Bengaluru', state: 'Karnataka', pincode: '560100' };
  const shipAddr = shippingAddress || order.delivery_address || billAddr;

  const environment = order.environment || 'TEST';
  const paymentMode = order.payment_mode || (order.payment_method?.toLowerCase().includes('live') ? 'LIVE' : 'TEST');

  let res;
  try {
    res = await query(`
      INSERT INTO invoices (
        invoice_number, order_id, user_id, merchant_id, items,
        subtotal, discount, tax, delivery_fee, total_amount,
        payment_method, payment_status, payment_reference,
        billing_address, shipping_address, invoice_date,
        environment, payment_mode
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), $16, $17)
      RETURNING *
    `, [
      invoiceNumber,
      order.id,
      order.user_id,
      order.merchant_id,
      JSON.stringify(items),
      order.subtotal,
      order.discount,
      order.tax,
      order.delivery_fee,
      order.total_amount,
      order.payment_method || 'PREPAID',
      order.payment_status === 'VERIFIED' ? 'PAID' : 'DUE_ON_DELIVERY',
      paymentReference || order.transaction_id || `PAY-RAZORPAY-${Date.now().toString(36).toUpperCase()}`,
      JSON.stringify(billAddr),
      JSON.stringify(shipAddr),
      environment,
      paymentMode,
    ]);
  } catch (insertErr) {
    if (insertErr.code === '23505') {
      const existingAfterRace = await query('SELECT * FROM invoices WHERE order_id = $1', [orderId]);
      if (existingAfterRace.rows.length > 0) {
        return existingAfterRace.rows[0];
      }
    }
    throw insertErr;
  }

  const invoice = res.rows[0];

  // Audit event
  await recordAuditEvent({
    eventType: 'INVOICE_GENERATED',
    actor: 'system',
    userId: order.user_id,
    purchaseIntentId: order.purchase_intent_id,
    transactionId: order.transaction_id,
    action: 'GENERATE_INVOICE',
    decision: 'ALLOW',
    reasoning: `Invoice ${invoiceNumber} generated for order ${order.order_number}`,
    outcome: 'Invoice created successfully',
    io,
  });

  return invoice;
}

export async function getInvoiceByOrderId(orderId) {
  const res = await query(`
    SELECT inv.*,
           o.order_number,
           m.name as merchant_name,
           u.name as buyer_name,
           u.email as buyer_email
    FROM invoices inv
    LEFT JOIN orders o ON inv.order_id = o.id
    LEFT JOIN merchants m ON inv.merchant_id = m.id
    LEFT JOIN users u ON inv.user_id = u.id
    WHERE inv.order_id = $1
  `, [orderId]);
  return res.rows[0] || null;
}

export async function getInvoiceById(invoiceId) {
  const res = await query(`
    SELECT inv.*,
           o.order_number,
           m.name as merchant_name,
           u.name as buyer_name,
           u.email as buyer_email
    FROM invoices inv
    LEFT JOIN orders o ON inv.order_id = o.id
    LEFT JOIN merchants m ON inv.merchant_id = m.id
    LEFT JOIN users u ON inv.user_id = u.id
    WHERE inv.id = $1
  `, [invoiceId]);
  return res.rows[0] || null;
}
