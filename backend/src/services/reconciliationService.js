import { query } from '../config/database.js';
import { logger } from '../utils/logger.js';
import { generateTrackingNumber } from './orderService.js';

/**
 * Multi-Point Cross-System Order State Reconciliation Engine
 * Identifies and heals data inconsistencies across transactions, orders, fulfillment, tracking, and invoices.
 */
export async function reconcileOrders({ autoHeal = true } = {}) {
  const startTime = Date.now();
  const issues = [];
  const healed = [];

  try {
    // 1. Fetch all orders with linked transaction, purchase intent, and invoice
    const res = await query(`
      SELECT o.*,
             t.status as tx_status,
             t.razorpay_payment_id,
             t.razorpay_order_id,
             pi.status as intent_status,
             pi.amount as intent_amount,
             p.name as catalog_product_name,
             p.sku as catalog_sku,
             p.brand as catalog_brand,
             p.category as catalog_category,
             p.merchant_id as product_merchant_id,
             inv.id as invoice_id,
             inv.total_amount as invoice_total
      FROM orders o
      LEFT JOIN transactions t ON o.transaction_id = t.id
      LEFT JOIN purchase_intents pi ON o.purchase_intent_id = pi.id
      LEFT JOIN products p ON o.product_id = p.id
      LEFT JOIN invoices inv ON inv.order_id = o.id
      ORDER BY o.created_at DESC
    `);

    for (const ord of res.rows) {
      const orderId = ord.id;
      const orderNum = ord.order_number;

      // Check 1: Missing snapshots
      if (!ord.product_name || !ord.product_sku || !ord.fulfillment_status) {
        issues.push({
          orderId,
          orderNumber: orderNum,
          type: 'MISSING_SNAPSHOTS',
          description: 'Order missing immutable product snapshot or fulfillment status.',
        });

        if (autoHeal) {
          await query(`
            UPDATE orders SET
              product_name = COALESCE(product_name, $2, 'Catalog Product'),
              product_sku = COALESCE(product_sku, $3, 'SKU-GENERIC'),
              product_brand = COALESCE(product_brand, $4, 'Store Brand'),
              product_category = COALESCE(product_category, $5, 'General'),
              fulfillment_status = COALESCE(fulfillment_status, order_status, 'CONFIRMED'),
              settlement_status = COALESCE(settlement_status, 'NOT_APPLICABLE_TEST_MODE')
            WHERE id = $1
          `, [
            orderId,
            ord.catalog_product_name,
            ord.catalog_sku,
            ord.catalog_brand,
            ord.catalog_category,
          ]);
          healed.push({ orderId, orderNumber: orderNum, fix: 'Populated immutable product snapshot fields' });
        }
      }

      // Check 2: Timeline progression synchronization
      let timeline = Array.isArray(ord.timeline) ? [...ord.timeline] : [];
      let timelineNeedsUpdate = false;
      const currentStatus = ord.fulfillment_status || ord.order_status || 'CONFIRMED';

      const stateOrder = ['CONFIRMED', 'PROCESSING', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED'];
      const targetIndex = stateOrder.indexOf(currentStatus);

      if (targetIndex >= 0 && timeline.length > 0) {
        timeline = timeline.map((step) => {
          const stepIndex = stateOrder.indexOf(step.state);
          if (stepIndex >= 0 && stepIndex <= targetIndex && !step.completed) {
            timelineNeedsUpdate = true;
            return {
              ...step,
              completed: true,
              timestamp: step.timestamp || ord.updated_at || ord.created_at,
            };
          }
          return step;
        });

        if (timelineNeedsUpdate && autoHeal) {
          await query('UPDATE orders SET timeline = $1 WHERE id = $2', [JSON.stringify(timeline), orderId]);
          healed.push({ orderId, orderNumber: orderNum, fix: `Synchronized vertical timeline for status ${currentStatus}` });
        }
      }

      // Check 3: Tracking number consistency for SHIPPED orders
      if (['SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(currentStatus) && !ord.tracking_number) {
        issues.push({
          orderId,
          orderNumber: orderNum,
          type: 'MISSING_TRACKING',
          description: `Order in ${currentStatus} state lacks courier tracking number.`,
        });

        if (autoHeal) {
          const newTracking = generateTrackingNumber();
          await query(`
            UPDATE orders SET
              tracking_number = $1,
              carrier = COALESCE(carrier, 'Simulated Courier (Demo)')
            WHERE id = $2
          `, [newTracking, orderId]);
          healed.push({ orderId, orderNumber: orderNum, fix: `Assigned tracking number ${newTracking}` });
        }
      }

      // Check 4: Payment status synchronization
      if (ord.tx_status === 'completed' && ord.payment_status !== 'VERIFIED') {
        issues.push({
          orderId,
          orderNumber: orderNum,
          type: 'PAYMENT_STATE_MISMATCH',
          description: `Transaction status is completed but order payment status is ${ord.payment_status}.`,
        });

        if (autoHeal) {
          await query("UPDATE orders SET payment_status = 'VERIFIED' WHERE id = $1", [orderId]);
          healed.push({ orderId, orderNumber: orderNum, fix: 'Set order payment_status to VERIFIED' });
        }
      }
    }

    // Check 5: Duplicate Order Detection & Auto-Consolidation
    const duplicateRes = await query(`
      SELECT purchase_intent_id, COUNT(*) as cnt
      FROM orders
      WHERE purchase_intent_id IS NOT NULL
      GROUP BY purchase_intent_id
      HAVING COUNT(*) > 1
    `);

    for (const dup of duplicateRes.rows) {
      issues.push({
        type: 'DUPLICATE_ORDER_DETECTED',
        intentId: dup.purchase_intent_id,
        count: parseInt(dup.cnt),
        description: `Found ${dup.cnt} duplicate orders for purchase intent ${dup.purchase_intent_id}.`,
      });

      if (autoHeal) {
        // Keep the earliest created order, remove duplicate order entries
        const dupOrders = await query(`
          SELECT id, order_number FROM orders 
          WHERE purchase_intent_id = $1 
          ORDER BY created_at ASC
        `, [dup.purchase_intent_id]);

        const [primary, ...toRemove] = dupOrders.rows;
        for (const rem of toRemove) {
          await query('DELETE FROM invoices WHERE order_id = $1', [rem.id]);
          await query('DELETE FROM orders WHERE id = $1', [rem.id]);
          healed.push({
            orderId: rem.id,
            orderNumber: rem.order_number,
            fix: `Removed duplicate order, retained primary order ${primary.order_number}`,
          });
        }
      }
    }

    const durationMs = Date.now() - startTime;
    logger.info(`[Reconciliation] Scanned ${res.rows.length} orders in ${durationMs}ms. Found ${issues.length} issues, auto-healed ${healed.length}.`);

    return {
      success: true,
      totalOrdersScanned: res.rows.length,
      issuesCount: issues.length,
      healedCount: healed.length,
      issues,
      healed,
      durationMs,
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    logger.error('Order reconciliation error:', err);
    throw err;
  }
}
