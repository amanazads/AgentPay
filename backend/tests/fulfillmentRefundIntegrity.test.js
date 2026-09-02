import { query } from '../src/config/database.js';
import { 
  createOrder, 
  transitionOrderFulfillment, 
  cancelOrder, 
  processOrderRefund, 
  OrderFulfillmentStates, 
  ALLOWED_FULFILLMENT_TRANSITIONS 
} from '../src/services/orderService.js';
import { 
  StandardMerchantAdapter, 
  VerifiedMerchantStoreAdapter, 
  SimulationMerchantAdapter, 
  SimulationFulfillmentAdapter 
} from '../src/services/merchantAdapter.js';
import { refundTransaction } from '../src/services/paymentService.js';

describe('Track 01: Fulfillment, Cancellation & Refund Integrity Suite', () => {
  let testUserId;
  let testMerchantId;
  let testProductId;

  beforeAll(async () => {
    // Setup test merchant, user, product
    const uRes = await query(`
      INSERT INTO users (email, name, role)
      VALUES ($1, $2, 'BUYER')
      RETURNING id
    `, [`fulfill_buyer_${Date.now()}@test.internal`, 'Fulfillment Test Buyer']);
    testUserId = uRes.rows[0].id;

    const mRes = await query(`
      INSERT INTO merchants (name, category, is_verified, rating)
      VALUES ($1, 'Electronics', true, 4.9)
      RETURNING id
    `, [`Fulfillment Test Store ${Date.now()}`]);
    testMerchantId = mRes.rows[0].id;

    const pRes = await query(`
      INSERT INTO products (merchant_id, name, category, price, in_stock, inventory)
      VALUES ($1, 'Fulfillment Test Gadget', 'Electronics', 1200.00, true, 20)
      RETURNING id
    `, [testMerchantId]);
    testProductId = pRes.rows[0].id;
  }, 30000);

  afterAll(async () => {
    if (testMerchantId) {
      await query('DELETE FROM orders WHERE merchant_id = $1', [testMerchantId]);
      await query('DELETE FROM products WHERE merchant_id = $1', [testMerchantId]);
      await query('DELETE FROM merchants WHERE id = $1', [testMerchantId]);
    }
    if (testUserId) {
      await query('DELETE FROM in_app_notifications WHERE user_id = $1', [testUserId]);
      await query('DELETE FROM event_notifications WHERE user_id = $1', [testUserId]);
      await query('DELETE FROM orders WHERE user_id = $1', [testUserId]);
      await query('DELETE FROM users WHERE id = $1', [testUserId]);
    }
  });

  // ── TEST 1: Authoritative State Progression ─────────────────────────────────
  test('TEST 1: Order advances deterministically through valid fulfillment stages', async () => {
    const order = await createOrder({
      userId: testUserId,
      merchantId: testMerchantId,
      productId: testProductId,
      quantity: 1,
      unitPrice: 1200.00,
      subtotal: 1200.00,
      totalAmount: 1200.00,
    });

    expect(order.order_status).toBe('CONFIRMED');
    expect(order.fulfillment_status).toBe('CONFIRMED');

    // CONFIRMED -> PROCESSING
    const step1 = await transitionOrderFulfillment(order.id, OrderFulfillmentStates.PROCESSING, { merchantId: testMerchantId });
    expect(step1.fulfillment_status).toBe('PROCESSING');

    // PROCESSING -> PACKED
    const step2 = await transitionOrderFulfillment(order.id, OrderFulfillmentStates.PACKED, { merchantId: testMerchantId });
    expect(step2.fulfillment_status).toBe('PACKED');

    // PACKED -> SHIPPED (with explicit tracking)
    const step3 = await transitionOrderFulfillment(order.id, OrderFulfillmentStates.SHIPPED, {
      merchantId: testMerchantId,
      trackingNumber: 'AWB-DELHIVERY-998877',
      carrier: 'Delhivery Surface',
    });
    expect(step3.fulfillment_status).toBe('SHIPPED');
    expect(step3.tracking_number).toBe('AWB-DELHIVERY-998877');
    expect(step3.carrier).toBe('Delhivery Surface');

    // SHIPPED -> OUT_FOR_DELIVERY
    const step4 = await transitionOrderFulfillment(order.id, OrderFulfillmentStates.OUT_FOR_DELIVERY, { merchantId: testMerchantId });
    expect(step4.fulfillment_status).toBe('OUT_FOR_DELIVERY');

    // OUT_FOR_DELIVERY -> DELIVERED
    const step5 = await transitionOrderFulfillment(order.id, OrderFulfillmentStates.DELIVERED, { merchantId: testMerchantId });
    expect(step5.fulfillment_status).toBe('DELIVERED');
  });

  // ── TEST 2: Rejection of Invalid / Regressive State Transitions ─────────────
  test('TEST 2: Strict rejection of illegal or regressive fulfillment transitions', async () => {
    const order = await createOrder({
      userId: testUserId,
      merchantId: testMerchantId,
      productId: testProductId,
      quantity: 1,
      unitPrice: 1200.00,
      subtotal: 1200.00,
      totalAmount: 1200.00,
    });

    // Cannot skip directly from CONFIRMED to DELIVERED
    await expect(
      transitionOrderFulfillment(order.id, OrderFulfillmentStates.DELIVERED, { merchantId: testMerchantId })
    ).rejects.toThrow(/Invalid fulfillment transition from 'CONFIRMED' to 'DELIVERED'/);

    // Cancel the order
    await cancelOrder(order.id, { cancelledBy: 'merchant', reason: 'Buyer cancellation' });

    // CANCELLED -> SHIPPED is illegal and must be rejected
    await expect(
      transitionOrderFulfillment(order.id, OrderFulfillmentStates.SHIPPED, { merchantId: testMerchantId })
    ).rejects.toThrow(/Invalid fulfillment transition from 'CANCELLED' to 'SHIPPED'/);
  });

  // ── TEST 3: Cancellation Safety Guards ───────────────────────────────────────
  test('TEST 3: Orders in SHIPPED or DELIVERED status cannot be cancelled', async () => {
    const order = await createOrder({
      userId: testUserId,
      merchantId: testMerchantId,
      productId: testProductId,
      quantity: 1,
      unitPrice: 1200.00,
      subtotal: 1200.00,
      totalAmount: 1200.00,
    });

    await transitionOrderFulfillment(order.id, 'PROCESSING', { merchantId: testMerchantId });
    await transitionOrderFulfillment(order.id, 'PACKED', { merchantId: testMerchantId });
    await transitionOrderFulfillment(order.id, 'SHIPPED', { merchantId: testMerchantId });

    await expect(
      cancelOrder(order.id, { cancelledBy: 'buyer', reason: 'Item no longer needed' })
    ).rejects.toThrow(/Cannot cancel order in 'SHIPPED' state/);
  });

  // ── TEST 4: Real Merchant Adapter Integrity ──────────────────────────────────
  test('TEST 4: StandardMerchantAdapter returns authentic database order and never fakes courier tracking or refunds', async () => {
    const adapter = new StandardMerchantAdapter({
      id: testMerchantId,
      name: 'Real Partner Merchant',
      is_verified: true,
      rating: 4.9,
    });

    const order = await createOrder({
      userId: testUserId,
      merchantId: testMerchantId,
      productId: testProductId,
      quantity: 1,
      unitPrice: 1200.00,
      subtotal: 1200.00,
      totalAmount: 1200.00,
    });

    const fetched = await adapter.getOrder(order.order_number);
    expect(fetched.status).toBe('CONFIRMED');
    expect(fetched.trackingNumber).toBeNull(); // No fake tracking number generated

    const refundReq = await adapter.requestRefund(order.order_number, 1200.00, 'Return request');
    expect(refundReq.status).toBe('REFUND_PENDING');
    expect(refundReq.requiresProviderConfirmation).toBe(true);
  });

  // ── TEST 5: Explicit Simulation Adapter Isolation ────────────────────────────
  test('TEST 5: SimulationMerchantAdapter is clearly marked and isolated', async () => {
    const simAdapter = new SimulationMerchantAdapter();
    expect(simAdapter.isSimulation).toBe(true);
    expect(simAdapter.simulationMode).toBe(true);
    expect(simAdapter.adapterType).toBe('SIMULATION');

    const simOrder = await simAdapter.getOrder('ORD-SIM-123');
    expect(simOrder.isSimulation).toBe(true);
    expect(simOrder.fulfillment).toContain('Simulated');

    const simRefund = await simAdapter.simulateRefund('ORD-SIM-123', 500, 'Test Attack');
    expect(simRefund.isSimulation).toBe(true);
    expect(simRefund.status).toBe('SIMULATION_REFUND_EXECUTED');
  });

  // ── TEST 6: Simulated Refund Cannot Mutate Real GMV / Ledger ────────────────
  test('TEST 6: Simulated refunds cannot mutate real transaction ledger or contaminate GMV', async () => {
    // 1. Create a real completed transaction
    const txRes = await query(`
      INSERT INTO transactions (
        user_id, amount, currency, status, payment_verified, razorpay_order_id, razorpay_payment_id, idempotency_key
      )
      VALUES ($1, 2500.00, 'INR', 'completed', true, 'order_real_123', 'pay_real_123', $2)
      RETURNING *
    `, [testUserId, `idem_real_${Date.now()}`]);
    const realTx = txRes.rows[0];

    // Compute GMV before simulation
    const gmvBeforeRes = await query("SELECT SUM(amount) as gmv FROM transactions WHERE status = 'completed' AND payment_verified = true");
    const gmvBefore = parseFloat(gmvBeforeRes.rows[0].gmv);

    // 2. Execute simulated refund via SimulationMerchantAdapter
    const simAdapter = new SimulationMerchantAdapter();
    const simResult = await simAdapter.simulateRefund('ANY_SIM_ID', 2500.00, 'Simulation benchmark');
    expect(simResult.isSimulation).toBe(true);

    // 3. Verify real transaction is completely unchanged
    const txAfterRes = await query('SELECT * FROM transactions WHERE id = $1', [realTx.id]);
    expect(txAfterRes.rows[0].status).toBe('completed');
    expect(txAfterRes.rows[0].payment_verified).toBe(true);

    // 4. Verify GMV is identical
    const gmvAfterRes = await query("SELECT SUM(amount) as gmv FROM transactions WHERE status = 'completed' AND payment_verified = true");
    const gmvAfter = parseFloat(gmvAfterRes.rows[0].gmv);
    expect(gmvAfter).toBe(gmvBefore);

    // Cleanup
    await query('DELETE FROM transactions WHERE id = $1', [realTx.id]);
  });

  // ── TEST 7: Authoritative Order Refund Execution ─────────────────────────────
  test('TEST 7: processOrderRefund transitions order through REFUND_PENDING to REFUNDED upon payment confirmation', async () => {
    // Create real transaction
    const txRes = await query(`
      INSERT INTO transactions (
        user_id, amount, currency, status, payment_verified, razorpay_order_id, razorpay_payment_id, idempotency_key, payment_mode
      )
      VALUES ($1, 1200.00, 'INR', 'completed', true, 'order_test_ref_1', 'pay_test_ref_1', $2, 'test')
      RETURNING *
    `, [testUserId, `idem_ref_${Date.now()}`]);
    const tx = txRes.rows[0];

    const order = await createOrder({
      userId: testUserId,
      merchantId: testMerchantId,
      productId: testProductId,
      transactionId: tx.id,
      quantity: 1,
      unitPrice: 1200.00,
      subtotal: 1200.00,
      totalAmount: 1200.00,
    });

    const refundResult = await processOrderRefund(order.id, {
      amount: 1200.00,
      reason: 'Quality issue return',
    });

    expect(refundResult.success).toBe(true);
    expect(refundResult.status).toBe('REFUNDED');
    expect(refundResult.order.order_status).toBe('REFUNDED');
    expect(refundResult.order.fulfillment_status).toBe('REFUNDED');

    // Verify transaction status updated in DB
    const txCheck = await query('SELECT * FROM transactions WHERE id = $1', [tx.id]);
    expect(txCheck.rows[0].status).toBe('refunded');

    // Cleanup
    await query('DELETE FROM orders WHERE id = $1', [order.id]);
    await query('DELETE FROM transactions WHERE id = $1', [tx.id]);
  });
});
