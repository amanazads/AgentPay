import { describe, it, expect, beforeEach } from '@jest/globals';
import { v4 as uuidv4 } from 'uuid';
import db from '../src/config/database.js';
import {
  createOrder,
  getOrderById,
  getOrdersForMerchant,
  transitionOrderFulfillment,
  cancelOrder,
  generateTrackingNumber,
  OrderFulfillmentStates,
} from '../src/services/orderService.js';
import { getNotificationContent } from '../src/services/notificationDispatcher.js';
import { evaluateSystemReadiness, ReadinessStatuses } from '../src/services/systemReadinessService.js';

describe('Track: Order Fulfillment Lifecycle & Truthfulness Audit Suite', () => {
  let testMerchantId;
  let testBuyerId;
  let testProductId;

  beforeEach(async () => {
    testMerchantId = uuidv4();
    testBuyerId = uuidv4();
    testProductId = uuidv4();

    await db.query(
      `INSERT INTO merchants (id, name, category, description, is_verified, rating, tier)
       VALUES ($1, 'Truthful Store', 'Electronics', 'Authentic Merchant Store', true, 4.8, 'STANDARD')
       ON CONFLICT (id) DO NOTHING`,
      [testMerchantId]
    );

    await db.query(
      `INSERT INTO users (id, email, name, role)
       VALUES ($1, $2, 'Test Buyer', 'buyer')
       ON CONFLICT (id) DO NOTHING`,
      [testBuyerId, `buyer_${Date.now()}@truthful.test`]
    );

    await db.query(
      `INSERT INTO products (id, merchant_id, name, sku, price, inventory, in_stock, category, commerce_eligible)
       VALUES ($1, $2, 'Truthful Test Item', $3, 1500.00, 50, true, 'Electronics', true)
       ON CONFLICT (id) DO NOTHING`,
      [testProductId, testMerchantId, `SKU-TRUTH-${Date.now()}`]
    );
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Requirement 1 & 2: Decouple Payment, Order, Fulfillment, and Shipment
  // ──────────────────────────────────────────────────────────────────────────
  it('Requirement 1 & 2: Payment success and order creation MUST NOT automatically mean shipped or delivered', async () => {
    const txId = uuidv4();
    const intentId = uuidv4();

    // Create purchase intent
    await db.query(
      `INSERT INTO purchase_intents (id, user_id, product_id, merchant_id, amount, quantity, status, state)
       VALUES ($1, $2, $3, $4, 1500.00, 1, 'payment_completed', 'ORDER_CONFIRMED')`,
      [intentId, testBuyerId, testProductId, testMerchantId]
    );

    // Create a transaction record simulating completed payment
    await db.query(
      `INSERT INTO transactions (id, user_id, amount, status, purchase_intent_id)
       VALUES ($1, $2, 1500.00, 'completed', $3)`,
      [txId, testBuyerId, intentId]
    );

    const order = await createOrder({
      transactionId: txId,
      purchaseIntentId: intentId,
      merchantId: testMerchantId,
      userId: testBuyerId,
      productId: testProductId,
      quantity: 1,
      unitPrice: 1500.00,
      totalAmount: 1500.00,
    });

    // Verify distinct states
    expect(order.order_status).toBe('CONFIRMED');
    expect(order.fulfillment_status).toBe(OrderFulfillmentStates.CONFIRMED);

    // CRITICAL: Payment success must NOT automatically mean shipped
    expect(order.fulfillment_status).not.toBe(OrderFulfillmentStates.SHIPPED);
    expect(order.fulfillment_status).not.toBe(OrderFulfillmentStates.DELIVERED);

    // CRITICAL: Tracking and carrier must be unassigned at creation
    expect(order.tracking_number).toBeNull();
    expect(order.carrier).toBeNull();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Requirement 3: Order creation must not automatically mean dispatched
  // ──────────────────────────────────────────────────────────────────────────
  it('Requirement 3: Newly created order has no dispatched status or carrier allocation', async () => {
    const order = await createOrder({
      merchantId: testMerchantId,
      userId: testBuyerId,
      productId: testProductId,
      quantity: 1,
      unitPrice: 1500.00,
      totalAmount: 1500.00,
    });

    const retrieved = await getOrderById(order.id);
    expect(retrieved.fulfillment_status).toBe('CONFIRMED');
    expect(retrieved.carrier).toBeNull();
    expect(retrieved.tracking_number).toBeNull();

    // Timeline must NOT show shipped or delivered as completed
    const shippedEvent = retrieved.timeline.find((t) => t.status === 'SHIPPED');
    const deliveredEvent = retrieved.timeline.find((t) => t.status === 'DELIVERED');
    expect(shippedEvent).toBeUndefined();
    expect(deliveredEvent).toBeUndefined();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Requirement 4: Simulated tracking tokens must be visibly identified as simulated/demo tracking
  // ──────────────────────────────────────────────────────────────────────────
  it('Requirement 4: Simulated tracking tokens are prefixed with SIM-TRK- and flagged as simulated', () => {
    const trackingSim = generateTrackingNumber(true);
    expect(trackingSim).toMatch(/^SIM-TRK-[A-Z0-9]+-[A-Z0-9]+$/);

    const trackingLive = generateTrackingNumber(false);
    expect(trackingLive).toMatch(/^TRK-[A-Z0-9]+-[A-Z0-9]+$/);
    expect(trackingLive.startsWith('SIM-TRK-')).toBe(false);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Requirement 5 & 6: Truthful carrier & tracking claims supported by backend state
  // ──────────────────────────────────────────────────────────────────────────
  it('Requirement 5 & 6: Carrier and tracking tokens are assigned ONLY when order advances to SHIPPED', async () => {
    const order = await createOrder({
      merchantId: testMerchantId,
      userId: testBuyerId,
      productId: testProductId,
      quantity: 1,
      unitPrice: 1500.00,
      totalAmount: 1500.00,
    });

    // In CONFIRMED: no carrier, no tracking
    expect(order.carrier).toBeNull();
    expect(order.tracking_number).toBeNull();

    // Advance to PROCESSING: still no carrier, no tracking
    const processingOrder = await transitionOrderFulfillment(order.id, 'PROCESSING', {
      merchantId: testMerchantId,
    });
    expect(processingOrder.fulfillment_status).toBe('PROCESSING');
    expect(processingOrder.carrier).toBeNull();
    expect(processingOrder.tracking_number).toBeNull();

    // Advance to PACKED: still no carrier, no tracking
    const packedOrder = await transitionOrderFulfillment(order.id, 'PACKED', {
      merchantId: testMerchantId,
    });
    expect(packedOrder.fulfillment_status).toBe('PACKED');
    expect(packedOrder.carrier).toBeNull();
    expect(packedOrder.tracking_number).toBeNull();

    // Advance to SHIPPED: now and ONLY now are tracking and carrier assigned
    const shippedOrder = await transitionOrderFulfillment(order.id, 'SHIPPED', {
      merchantId: testMerchantId,
    });
    expect(shippedOrder.fulfillment_status).toBe('SHIPPED');
    expect(shippedOrder.tracking_number).toMatch(/^SIM-TRK-[A-Z0-9]+-[A-Z0-9]+$/);
    expect(shippedOrder.carrier).toBe('Simulated Courier (Demo)');
    expect(shippedOrder.tracking_number.startsWith('SIM-TRK-')).toBe(true);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Requirement 7: Canonical order state between Buyer and Merchant views
  // ──────────────────────────────────────────────────────────────────────────
  it('Requirement 7: Merchant and Buyer views use the identical canonical order state at every stage', async () => {
    const order = await createOrder({
      merchantId: testMerchantId,
      userId: testBuyerId,
      productId: testProductId,
      quantity: 1,
      unitPrice: 1500.00,
      totalAmount: 1500.00,
    });

    // Check CONFIRMED stage
    let buyerView = await getOrderById(order.id);
    let merchantView = (await getOrdersForMerchant(testMerchantId)).find((o) => o.id === order.id);
    expect(buyerView.fulfillment_status).toBe('CONFIRMED');
    expect(merchantView.fulfillment_status).toBe('CONFIRMED');
    expect(buyerView.tracking_number).toBeNull();
    expect(merchantView.tracking_number).toBeNull();
    expect(buyerView.carrier).toBeNull();
    expect(merchantView.carrier).toBeNull();

    // Advance to PROCESSING
    await transitionOrderFulfillment(order.id, 'PROCESSING', { merchantId: testMerchantId });
    buyerView = await getOrderById(order.id);
    merchantView = (await getOrdersForMerchant(testMerchantId)).find((o) => o.id === order.id);
    expect(buyerView.fulfillment_status).toBe('PROCESSING');
    expect(merchantView.fulfillment_status).toBe('PROCESSING');

    // Advance to PACKED
    await transitionOrderFulfillment(order.id, 'PACKED', { merchantId: testMerchantId });
    buyerView = await getOrderById(order.id);
    merchantView = (await getOrdersForMerchant(testMerchantId)).find((o) => o.id === order.id);
    expect(buyerView.fulfillment_status).toBe('PACKED');
    expect(merchantView.fulfillment_status).toBe('PACKED');

    // Advance to SHIPPED
    await transitionOrderFulfillment(order.id, 'SHIPPED', { merchantId: testMerchantId });
    buyerView = await getOrderById(order.id);
    merchantView = (await getOrdersForMerchant(testMerchantId)).find((o) => o.id === order.id);
    expect(buyerView.fulfillment_status).toBe('SHIPPED');
    expect(merchantView.fulfillment_status).toBe('SHIPPED');
    expect(buyerView.tracking_number).toBe(merchantView.tracking_number);
    expect(buyerView.carrier).toBe(merchantView.carrier);
    expect(buyerView.tracking_number).toMatch(/^SIM-TRK-/);

    // Advance to OUT_FOR_DELIVERY
    await transitionOrderFulfillment(order.id, 'OUT_FOR_DELIVERY', { merchantId: testMerchantId });
    buyerView = await getOrderById(order.id);
    merchantView = (await getOrdersForMerchant(testMerchantId)).find((o) => o.id === order.id);
    expect(buyerView.fulfillment_status).toBe('OUT_FOR_DELIVERY');
    expect(merchantView.fulfillment_status).toBe('OUT_FOR_DELIVERY');

    // Advance to DELIVERED
    await transitionOrderFulfillment(order.id, 'DELIVERED', { merchantId: testMerchantId });
    buyerView = await getOrderById(order.id);
    merchantView = (await getOrdersForMerchant(testMerchantId)).find((o) => o.id === order.id);
    expect(buyerView.fulfillment_status).toBe('DELIVERED');
    expect(merchantView.fulfillment_status).toBe('DELIVERED');
    expect(buyerView.tracking_number).toBe(merchantView.tracking_number);
    expect(buyerView.carrier).toBe(merchantView.carrier);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Requirement 8: No contradictory states (e.g. merchant SHIPPED vs buyer awaiting processing)
  // ──────────────────────────────────────────────────────────────────────────
  it('Requirement 8: No contradictory state aliasing between COMPLETED and DELIVERED', () => {
    // OrderFulfillmentStates must not define COMPLETED: 'DELIVERED' alias
    expect(OrderFulfillmentStates.COMPLETED).toBeUndefined();
    expect(OrderFulfillmentStates.DELIVERED).toBe('DELIVERED');
    expect(OrderFulfillmentStates.SHIPPED).toBe('SHIPPED');
    expect(OrderFulfillmentStates.CONFIRMED).toBe('CONFIRMED');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Requirement 9: Strict state machine transitions preventing illegal/regressive transitions
  // ──────────────────────────────────────────────────────────────────────────
  describe('Requirement 9: State Machine Transition Enforcement', () => {
    it('Rejects skipping states (CONFIRMED -> SHIPPED)', async () => {
      const order = await createOrder({
        merchantId: testMerchantId,
        userId: testBuyerId,
        productId: testProductId,
        quantity: 1,
        unitPrice: 1500.00,
        totalAmount: 1500.00,
      });

      await expect(
        transitionOrderFulfillment(order.id, 'SHIPPED', { merchantId: testMerchantId })
      ).rejects.toThrow(/Invalid fulfillment transition from 'CONFIRMED' to 'SHIPPED'/);
    });

    it('Rejects skipping states (CONFIRMED -> DELIVERED)', async () => {
      const order = await createOrder({
        merchantId: testMerchantId,
        userId: testBuyerId,
        productId: testProductId,
        quantity: 1,
        unitPrice: 1500.00,
        totalAmount: 1500.00,
      });

      await expect(
        transitionOrderFulfillment(order.id, 'DELIVERED', { merchantId: testMerchantId })
      ).rejects.toThrow(/Invalid fulfillment transition/);
    });

    it('Rejects skipping states (PROCESSING -> DELIVERED)', async () => {
      const order = await createOrder({
        merchantId: testMerchantId,
        userId: testBuyerId,
        productId: testProductId,
        quantity: 1,
        unitPrice: 1500.00,
        totalAmount: 1500.00,
      });

      await transitionOrderFulfillment(order.id, 'PROCESSING', { merchantId: testMerchantId });

      await expect(
        transitionOrderFulfillment(order.id, 'DELIVERED', { merchantId: testMerchantId })
      ).rejects.toThrow(/Invalid fulfillment transition from 'PROCESSING' to 'DELIVERED'/);
    });

    it('Rejects regression (SHIPPED -> PACKED)', async () => {
      const order = await createOrder({
        merchantId: testMerchantId,
        userId: testBuyerId,
        productId: testProductId,
        quantity: 1,
        unitPrice: 1500.00,
        totalAmount: 1500.00,
      });

      await transitionOrderFulfillment(order.id, 'PROCESSING', { merchantId: testMerchantId });
      await transitionOrderFulfillment(order.id, 'PACKED', { merchantId: testMerchantId });
      await transitionOrderFulfillment(order.id, 'SHIPPED', { merchantId: testMerchantId });

      await expect(
        transitionOrderFulfillment(order.id, 'PACKED', { merchantId: testMerchantId })
      ).rejects.toThrow(/Invalid fulfillment transition from 'SHIPPED' to 'PACKED'/);
    });

    it('Rejects regression (DELIVERED -> SHIPPED or any other state)', async () => {
      const order = await createOrder({
        merchantId: testMerchantId,
        userId: testBuyerId,
        productId: testProductId,
        quantity: 1,
        unitPrice: 1500.00,
        totalAmount: 1500.00,
      });

      await transitionOrderFulfillment(order.id, 'PROCESSING', { merchantId: testMerchantId });
      await transitionOrderFulfillment(order.id, 'PACKED', { merchantId: testMerchantId });
      await transitionOrderFulfillment(order.id, 'SHIPPED', { merchantId: testMerchantId });
      await transitionOrderFulfillment(order.id, 'OUT_FOR_DELIVERY', { merchantId: testMerchantId });
      await transitionOrderFulfillment(order.id, 'DELIVERED', { merchantId: testMerchantId });

      await expect(
        transitionOrderFulfillment(order.id, 'SHIPPED', { merchantId: testMerchantId })
      ).rejects.toThrow(/Invalid fulfillment transition from 'DELIVERED' to 'SHIPPED'/);

      await expect(
        transitionOrderFulfillment(order.id, 'PROCESSING', { merchantId: testMerchantId })
      ).rejects.toThrow(/Invalid fulfillment transition/);
    });

    it('Rejects cancellation once order is SHIPPED or DELIVERED', async () => {
      const order = await createOrder({
        merchantId: testMerchantId,
        userId: testBuyerId,
        productId: testProductId,
        quantity: 1,
        unitPrice: 1500.00,
        totalAmount: 1500.00,
      });

      await transitionOrderFulfillment(order.id, 'PROCESSING', { merchantId: testMerchantId });
      await transitionOrderFulfillment(order.id, 'PACKED', { merchantId: testMerchantId });
      await transitionOrderFulfillment(order.id, 'SHIPPED', { merchantId: testMerchantId });

      await expect(
        cancelOrder(order.id, { reason: 'Changed mind' })
      ).rejects.toThrow(/Cannot cancel order in 'SHIPPED' state/);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Notifications & 3PL System Truthfulness
  // ──────────────────────────────────────────────────────────────────────────
  describe('Notifications & System Readiness Truthfulness', () => {
    it('Notification copy explicitly identifies simulated fulfillment and does not claim real dispatch', () => {
      const notifConfirmed = getNotificationContent('ORDER_CONFIRMED', { orderNumber: 'AGP-ORD-123456', totalAmount: 1500 });
      expect(notifConfirmed.message).toContain('queued for merchant warehouse processing');
      expect(notifConfirmed.message).not.toContain('dispatched to the merchant');

      const notifShipped = getNotificationContent('ORDER_SHIPPED', {
        orderNumber: 'AGP-ORD-123456',
        carrier: 'Simulated Courier (Demo)',
        trackingNumber: 'SIM-TRK-ABC1234567',
      });
      expect(notifShipped.subject).toContain('Simulated');
      expect(notifShipped.message).toContain('Simulated fulfillment active; no physical courier dispatched');
    });

    it('System readiness reports EXT_CARRIER_FULFILLMENT as SIMULATED with liveCarrierApiConfigured: false', async () => {
      const report = await evaluateSystemReadiness({});
      const carrierCheck = report.checklist.find((c) => c.id === 'EXT_CARRIER_FULFILLMENT');

      expect(carrierCheck).toBeDefined();
      expect(carrierCheck.status).toBe(ReadinessStatuses.SIMULATED);
      expect(carrierCheck.evidence.liveCarrierApiConfigured).toBe(false);
      expect(carrierCheck.evidence.carrierName).toBe('Simulated Courier (Demo)');
    });
  });
});
