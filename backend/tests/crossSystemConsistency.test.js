import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { query } from '../src/config/database.js';
import { createOrder, transitionOrderFulfillment, getOrdersForUser, getOrdersForMerchant, getOrderById } from '../src/services/orderService.js';
import { reconcileOrders } from '../src/services/reconciliationService.js';

describe('Cross-System Order State, Data Consistency & Fulfillment State Machine', () => {
  let buyerUserId;
  let otherBuyerUserId;
  let merchantId;
  let otherMerchantId;
  let productId;
  let testOrderId;

  beforeAll(async () => {
    // 1. Resolve or create primary buyer and secondary buyer
    const uRes = await query("SELECT id FROM users WHERE role = 'BUYER' LIMIT 2");
    buyerUserId = uRes.rows[0]?.id;
    otherBuyerUserId = uRes.rows[1]?.id || buyerUserId;

    // 2. Resolve primary and secondary merchants
    const mRes = await query("SELECT id FROM merchants WHERE is_verified = true LIMIT 2");
    merchantId = mRes.rows[0]?.id;
    otherMerchantId = mRes.rows[1]?.id || merchantId;

    // 3. Resolve product
    const pRes = await query("SELECT id, name, price, brand, category, sku FROM products WHERE merchant_id = $1 LIMIT 1", [merchantId]);
    productId = pRes.rows[0]?.id;
  });

  it('TEST 1: Create new order - Buyer & Merchant share identical order record and snapshots', async () => {
    const order = await createOrder({
      userId: buyerUserId,
      merchantId,
      productId,
      quantity: 1,
      unitPrice: 4999,
      subtotal: 4999,
      totalAmount: 4999,
      paymentMethod: 'PREPAID',
      paymentStatus: 'VERIFIED',
      productName: 'Cross-System Test Headset',
      productSku: 'SKU-CS-TEST-01',
      productBrand: 'TestBrand',
      productCategory: 'Electronics',
      deliveryAddress: { name: 'Test Buyer', city: 'Bengaluru', state: 'Karnataka', pincode: '560100' },
    });

    testOrderId = order.id;

    // Verify Buyer sees this order
    const buyerOrders = await getOrdersForUser(buyerUserId);
    const buyerOrder = buyerOrders.find((o) => o.id === testOrderId);
    expect(buyerOrder).toBeDefined();
    expect(buyerOrder.order_number).toBe(order.order_number);
    expect(buyerOrder.product_name).toBe('Cross-System Test Headset');
    expect(buyerOrder.total_amount).toBe('4999.00');
    expect(buyerOrder.payment_status).toBe('VERIFIED');
    expect(buyerOrder.order_status).toBe('CONFIRMED');
    expect(buyerOrder.fulfillment_status).toBe('CONFIRMED');

    // Verify Merchant sees the exact same order
    const merchantOrders = await getOrdersForMerchant(merchantId);
    const merchantOrder = merchantOrders.find((o) => o.id === testOrderId);
    expect(merchantOrder).toBeDefined();
    expect(merchantOrder.order_number).toBe(order.order_number);
    expect(merchantOrder.total_amount).toBe('4999.00');
    expect(merchantOrder.payment_status).toBe('VERIFIED');
    expect(merchantOrder.order_status).toBe('CONFIRMED');
  });

  it('TEST 2: Merchant advances order to PROCESSING - Buyer reflects PROCESSING', async () => {
    const updated = await transitionOrderFulfillment(testOrderId, 'PROCESSING', {
      merchantId,
      reason: 'Merchant started item packaging',
    });

    expect(updated.order_status).toBe('PROCESSING');
    expect(updated.fulfillment_status).toBe('PROCESSING');

    // Verify Buyer sees updated status
    const buyerOrder = await getOrderById(testOrderId);
    expect(buyerOrder.order_status).toBe('PROCESSING');
    expect(buyerOrder.fulfillment_status).toBe('PROCESSING');
  });

  it('TEST 3: Merchant advances order to PACKED - Buyer reflects PACKED', async () => {
    const updated = await transitionOrderFulfillment(testOrderId, 'PACKED', {
      merchantId,
      reason: 'Items secured in packaging',
    });

    expect(updated.order_status).toBe('PACKED');
    expect(updated.fulfillment_status).toBe('PACKED');

    const buyerOrder = await getOrderById(testOrderId);
    expect(buyerOrder.order_status).toBe('PACKED');
  });

  it('TEST 4: Merchant advances order to SHIPPED - Tracking number generated & visible to Buyer', async () => {
    const updated = await transitionOrderFulfillment(testOrderId, 'SHIPPED', {
      merchantId,
      carrier: 'AgentPay Express Logistics',
    });

    expect(updated.order_status).toBe('SHIPPED');
    expect(updated.fulfillment_status).toBe('SHIPPED');
    expect(updated.tracking_number).toMatch(/^(SIM-TRK|TRK)-/);

    const buyerOrder = await getOrderById(testOrderId);
    expect(buyerOrder.order_status).toBe('SHIPPED');
    expect(buyerOrder.tracking_number).toBe(updated.tracking_number);
    expect(buyerOrder.carrier).toBe('AgentPay Express Logistics');
  });

  it('TEST 5: Merchant advances order to DELIVERED - Buyer reflects DELIVERED', async () => {
    // Note: Out for delivery first then delivered
    await transitionOrderFulfillment(testOrderId, 'OUT_FOR_DELIVERY', { merchantId });
    const updated = await transitionOrderFulfillment(testOrderId, 'DELIVERED', { merchantId });

    expect(updated.order_status).toBe('DELIVERED');
    expect(updated.fulfillment_status).toBe('DELIVERED');

    const buyerOrder = await getOrderById(testOrderId);
    expect(buyerOrder.order_status).toBe('DELIVERED');
    expect(buyerOrder.fulfillment_status).toBe('DELIVERED');
  });

  it('TEST 6: Invalid transition rejection - SHIPPED to PACKED is rejected', async () => {
    // Create new order at SHIPPED
    const tempOrder = await createOrder({
      userId: buyerUserId,
      merchantId,
      productId,
      totalAmount: 1000,
    });
    await transitionOrderFulfillment(tempOrder.id, 'PROCESSING', { merchantId });
    await transitionOrderFulfillment(tempOrder.id, 'PACKED', { merchantId });
    await transitionOrderFulfillment(tempOrder.id, 'SHIPPED', { merchantId });

    // Attempt invalid jump backwards
    await expect(
      transitionOrderFulfillment(tempOrder.id, 'PACKED', { merchantId })
    ).rejects.toThrow(/Invalid fulfillment transition/);
  });

  it('TEST 7: Multi-point order reconciliation tool executes without errors', async () => {
    const report = await reconcileOrders({ autoHeal: true });
    expect(report.success).toBe(true);
    expect(report.totalOrdersScanned).toBeGreaterThan(0);
    expect(report.durationMs).toBeLessThan(2000);
  });

  it('TEST 8: Tenant isolation - Merchant A cannot access Merchant B order', async () => {
    if (otherMerchantId !== merchantId) {
      await expect(
        transitionOrderFulfillment(testOrderId, 'PROCESSING', { merchantId: otherMerchantId })
      ).rejects.toThrow(/Unauthorized/);
    }
  });

  afterAll(async () => {
    // Clean up temporary test order
    if (testOrderId) {
      await query('DELETE FROM orders WHERE id = $1', [testOrderId]);
    }
  });
});
