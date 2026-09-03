import { jest } from '@jest/globals';
import request from 'supertest';
import crypto from 'crypto';
import { app } from '../src/index.js';
import { query } from '../src/config/database.js';
import env from '../src/config/env.js';
import { generateAccessToken } from '../src/utils/authUtils.js';
import {
  reserveInventory,
  commitReservation,
  releaseReservation,
  getAvailableInventory,
  expireStaleReservations,
} from '../src/services/inventoryService.js';
import {
  acquireIdempotencyLock,
  releaseIdempotencyLock,
  setForceDbFallback,
} from '../src/services/idempotencyService.js';
import { generateQuote } from '../src/services/quoteService.js';
import { createPaymentOrder, verifyPayment } from '../src/services/paymentService.js';

jest.setTimeout(45000);

describe('Track 03: Inventory Reservation & Payment Concurrency Hardening Suite', () => {
  let buyerA, buyerAToken;
  let buyerB, buyerBToken;
  let merchantId;
  let policyId;
  let testAgent, testAgentB;

  beforeAll(async () => {
    // 1. Setup Buyer A
    const uA = await query(`
      INSERT INTO users (email, name, role)
      VALUES ('conc_hard_buyer_a_' || floor(random()*1000000) || '@agentpay.com', 'Concurrency Buyer A', 'BUYER')
      RETURNING *
    `);
    buyerA = uA.rows[0];
    buyerAToken = generateAccessToken(buyerA);

    // 2. Setup Buyer B
    const uB = await query(`
      INSERT INTO users (email, name, role)
      VALUES ('conc_hard_buyer_b_' || floor(random()*1000000) || '@agentpay.com', 'Concurrency Buyer B', 'BUYER')
      RETURNING *
    `);
    buyerB = uB.rows[0];
    buyerBToken = generateAccessToken(buyerB);

    // 3. Setup Verified Merchant
    const mRes = await query(`
      INSERT INTO merchants (name, category, description, is_verified, rating, tier)
      VALUES ('Concurrency Tested Merchant ' || floor(random()*100000), 'Electronics', 'Verified Hardware Store', true, 4.9, 'tier_1')
      RETURNING id
    `);
    merchantId = mRes.rows[0].id;

    // 4. Setup Policy
    const polRes = await query(`
      INSERT INTO policies (name, version, daily_budget, max_transaction, approval_threshold, allowed_categories, blocked_categories, max_retries, price_tolerance_pct, verified_merchants_only)
      VALUES ('Concurrency Policy', 'v1', 200000, 100000, 50000, ARRAY['Electronics'], ARRAY['Gambling'], 1, 2.0, true)
      RETURNING id
    `);
    policyId = polRes.rows[0].id;

    // 5. Setup Agents for Buyer A and Buyer B
    const aRes = await query(`
      INSERT INTO agents (owner_id, name, description, policy_id, status)
      VALUES ($1, 'Concurrency Hardening Agent A', 'Agent for Concurrency Testing A', $2, 'active')
      RETURNING *
    `, [buyerA.id, policyId]);
    testAgent = aRes.rows[0];

    const aBRes = await query(`
      INSERT INTO agents (owner_id, name, description, policy_id, status)
      VALUES ($1, 'Concurrency Hardening Agent B', 'Agent for Concurrency Testing B', $2, 'active')
      RETURNING *
    `, [buyerB.id, policyId]);
    testAgentB = aBRes.rows[0];
  });

  afterAll(async () => {
    setForceDbFallback(false);
    const userIds = [buyerA?.id, buyerB?.id].filter(Boolean);
    if (userIds.length > 0) {
      await query('DELETE FROM in_app_notifications WHERE user_id = ANY($1)', [userIds]);
      await query('DELETE FROM user_preferences WHERE user_id = ANY($1)', [userIds]);
      await query('DELETE FROM invoices WHERE order_id IN (SELECT id FROM orders WHERE user_id = ANY($1))', [userIds]);
      await query('DELETE FROM orders WHERE user_id = ANY($1)', [userIds]);
      await query('DELETE FROM approvals WHERE purchase_intent_id IN (SELECT id FROM purchase_intents WHERE user_id = ANY($1))', [userIds]);
      await query('DELETE FROM transactions WHERE user_id = ANY($1)', [userIds]);
      await query('DELETE FROM inventory_reservations WHERE quote_id IN (SELECT id FROM quotes WHERE user_id = ANY($1))', [userIds]);
      await query('DELETE FROM quotes WHERE user_id = ANY($1)', [userIds]);
      await query('DELETE FROM purchase_intents WHERE user_id = ANY($1)', [userIds]);
      await query('DELETE FROM agents WHERE owner_id = ANY($1)', [userIds]);
      await query('DELETE FROM users WHERE id = ANY($1)', [userIds]);
    }
    if (merchantId) {
      await query('DELETE FROM products WHERE merchant_id = $1', [merchantId]);
      await query('DELETE FROM merchants WHERE id = $1', [merchantId]);
    }
    if (policyId) await query('DELETE FROM policies WHERE id = $1', [policyId]);
    await query('DELETE FROM idempotency_locks WHERE lock_key LIKE $1', ['test_%']);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 1: 10 Concurrent Buyers Competing for 1 Item
  // ──────────────────────────────────────────────────────────────────────────
  test('REQ 1, 2 & 3: 10 simultaneous buyers competing for 1 unit of stock results in exactly 1 reservation and 9 deterministic failures', async () => {
    // 1 unit in stock
    const pRes = await query(`
      INSERT INTO products (merchant_id, name, description, brand, category, product_type, price, inventory, in_stock, is_test_lab, commerce_eligible)
      VALUES ($1, 'Limited Edition GPU ' || floor(random()*100000), 'Flagship GPU', 'Nvidia', 'Electronics', 'gpu', 50000.00, 1, true, false, true)
      RETURNING *
    `, [merchantId]);
    const singleStockProduct = pRes.rows[0];

    // 10 concurrent reservation attempts
    const reservationPromises = Array.from({ length: 10 }).map((_, index) =>
      reserveInventory({
        productId: singleStockProduct.id,
        quantity: 1,
        userId: buyerA.id,
        quoteId: `quote_race_single_${index}_${Date.now()}`,
        durationMinutes: 15,
      })
        .then((res) => ({ success: true, res }))
        .catch((err) => ({ success: false, error: err.message }))
    );

    const results = await Promise.all(reservationPromises);

    const successes = results.filter((r) => r.success);
    const failures = results.filter((r) => !r.success);

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(9);
    for (const f of failures) {
      expect(f.error).toMatch(/Insufficient inventory/i);
    }

    // Available inventory must be exactly 0
    const remaining = await getAvailableInventory(singleStockProduct.id);
    expect(remaining).toBe(0);

    // Database stock must not be negative
    const dbStock = (await query('SELECT inventory FROM products WHERE id = $1', [singleStockProduct.id])).rows[0].inventory;
    expect(dbStock).toBe(1); // not decremented until payment commit
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 2: Redis Outage Degradation to PostgreSQL ACID Lock Fallback
  // ──────────────────────────────────────────────────────────────────────────
  test('REQ 9: When Redis fails completely, PostgreSQL ACID fallback lock admits exactly ONE concurrent caller and blocks duplicate', async () => {
    const testLockKey = `test_lock_redis_outage_${Date.now()}`;

    // Force DB fallback mode (simulating total Redis failure)
    setForceDbFallback(true);

    try {
      // Two simultaneous calls trying to acquire the same lock while Redis is down
      const [lock1, lock2] = await Promise.all([
        acquireIdempotencyLock(testLockKey, 30),
        acquireIdempotencyLock(testLockKey, 30),
      ]);

      // Exactly ONE caller acquires the lock; the other is rejected fail-closed
      expect((lock1 && !lock2) || (!lock1 && lock2)).toBe(true);

      // Verify row exists in PostgreSQL idempotency_locks table
      const lockRow = (await query('SELECT * FROM idempotency_locks WHERE lock_key = $1', [testLockKey])).rows;
      expect(lockRow.length).toBe(1);

      // Release lock
      await releaseIdempotencyLock(testLockKey);

      // Lock row must be cleaned up
      const lockRowAfter = (await query('SELECT * FROM idempotency_locks WHERE lock_key = $1', [testLockKey])).rows;
      expect(lockRowAfter.length).toBe(0);

      // After release, a new caller can acquire it
      const lock3 = await acquireIdempotencyLock(testLockKey, 30);
      expect(lock3).toBe(true);
      await releaseIdempotencyLock(testLockKey);
    } finally {
      setForceDbFallback(false);
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 3: Different Buyers Using Same Client Idempotency Key Never Collide
  // ──────────────────────────────────────────────────────────────────────────
  test('REQ 8: Buyer A and Buyer B sending identical client Idempotency-Key "shared-uuid-123" do NOT collide', async () => {
    const pRes = await query(`
      INSERT INTO products (merchant_id, name, description, brand, category, product_type, price, inventory, in_stock, is_test_lab, commerce_eligible)
      VALUES ($1, 'Dual Buyer SSD ' || floor(random()*100000), 'Fast NVMe SSD', 'Samsung', 'Electronics', 'ssd', 8000.00, 20, true, false, true)
      RETURNING *
    `, [merchantId]);
    const ssdProduct = pRes.rows[0];

    const sharedClientKey = `custom_client_key_${Date.now()}`;

    // Buyer A creates purchase intent with shared key
    const resA = await request(app)
      .post('/api/purchase-intents')
      .set('Authorization', `Bearer ${buyerAToken}`)
      .set('Idempotency-Key', sharedClientKey)
      .send({
        agent_id: testAgent.id,
        product_id: ssdProduct.id,
        amount: 8000.00,
        quantity: 1,
      });

    expect(resA.status).toBe(201);
    const intentA = resA.body.purchaseIntent || resA.body;
    expect(intentA.id).toBeDefined();

    // Buyer B creates purchase intent with the EXACT SAME client key
    const resB = await request(app)
      .post('/api/purchase-intents')
      .set('Authorization', `Bearer ${buyerBToken}`)
      .set('Idempotency-Key', sharedClientKey)
      .send({
        agent_id: testAgentB.id,
        product_id: ssdProduct.id,
        amount: 8000.00,
        quantity: 1,
      });

    expect(resB.status).toBe(201);
    const intentB = resB.body.purchaseIntent || resB.body;
    expect(intentB.id).toBeDefined();

    // They must be two distinct purchase intents with different database IDs
    expect(intentA.id).not.toBe(intentB.id);
    expect(intentA.idempotency_key).not.toBe(intentB.idempotency_key);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 4: Simultaneous Client Verification Callback & Webhook Race
  // ──────────────────────────────────────────────────────────────────────────
  test('REQ 6 & 7: Simultaneous client verification callback & webhook delivery execute exactly once without duplicate orders or stock decrements', async () => {
    // 10 units in stock
    const pRes = await query(`
      INSERT INTO products (merchant_id, name, description, brand, category, product_type, price, inventory, in_stock, is_test_lab, commerce_eligible)
      VALUES ($1, 'Race Condition Headset ' || floor(random()*100000), 'Wireless ANC Headset', 'Sony', 'Electronics', 'headset', 12000.00, 10, true, false, true)
      RETURNING *
    `, [merchantId]);
    const headset = pRes.rows[0];

    const quote = await generateQuote({
      productId: headset.id,
      quantity: 1,
      userId: buyerA.id,
      agentId: testAgent.id,
    });

    const piRes = await query(`
      INSERT INTO purchase_intents (agent_id, user_id, product_id, merchant_id, amount, quantity, status, quote_id)
      VALUES ($1, $2, $3, $4, 12000, 1, 'allowed', $5)
      RETURNING *
    `, [testAgent.id, buyerA.id, headset.id, merchantId, quote.quoteId]);
    const intent = piRes.rows[0];

    const paymentOrder = await createPaymentOrder(intent.id, { mode: 'TEST' });

    const secret = env.RAZORPAY_TEST_KEY_SECRET;
    const paymentId = `pay_simul_${Math.random().toString(36).substring(2, 10)}`;
    const body = `${paymentOrder.orderId}|${paymentId}`;
    const sig = secret ? crypto.createHmac('sha256', secret).update(body).digest('hex') : 'test_sig_simul';

    // Fire 5 concurrent verification attempts at the exact same millisecond
    const verifyPromises = Array.from({ length: 5 }).map(() =>
      verifyPayment({
        transactionId: paymentOrder.transactionId,
        razorpayOrderId: paymentOrder.orderId,
        razorpayPaymentId: paymentId,
        razorpaySignature: sig,
      })
    );

    const outcomes = await Promise.all(verifyPromises);

    // All 5 must succeed (1 primary, 4 idempotent duplicates)
    for (const out of outcomes) {
      expect(out.verified).toBe(true);
    }

    // Exactly ONE confirmed order in the database
    const orders = (await query('SELECT * FROM orders WHERE transaction_id = $1', [paymentOrder.transactionId])).rows;
    expect(orders.length).toBe(1);

    // Stock must be decremented by exactly 1 (10 -> 9), NEVER more
    const updatedProd = (await query('SELECT inventory FROM products WHERE id = $1', [headset.id])).rows[0];
    expect(updatedProd.inventory).toBe(9);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 5: Expired Reservation Restores Available Stock
  // ──────────────────────────────────────────────────────────────────────────
  test('REQ 5: Expired reservations cease holding inventory and allow new buyers to reserve', async () => {
    // 2 units in stock
    const pRes = await query(`
      INSERT INTO products (merchant_id, name, description, brand, category, product_type, price, inventory, in_stock, is_test_lab, commerce_eligible)
      VALUES ($1, 'Expiry Test Keyboard ' || floor(random()*100000), 'Mechanical Keyboard', 'Keychron', 'Electronics', 'keyboard', 6000.00, 2, true, false, true)
      RETURNING *
    `, [merchantId]);
    const keyboard = pRes.rows[0];

    // Buyer A reserves all 2 units with an already expired timestamp
    await reserveInventory({
      productId: keyboard.id,
      quantity: 2,
      userId: buyerA.id,
      quoteId: `quote_expired_kb_${Date.now()}`,
      durationMinutes: -10, // expired 10 minutes ago
    });

    // Run stale reservation sweeper
    const expiredList = await expireStaleReservations();
    expect(Array.isArray(expiredList)).toBe(true);

    // Buyer B can immediately reserve because Buyer A's reservation expired
    const resB = await reserveInventory({
      productId: keyboard.id,
      quantity: 2,
      userId: buyerB.id,
      quoteId: `quote_active_kb_${Date.now()}`,
      durationMinutes: 15,
    });

    expect(resB.status).toBe('RESERVED');
    expect(resB.quantity).toBe(2);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 6: Failed Payment Releases Reservation
  // ──────────────────────────────────────────────────────────────────────────
  test('REQ 4: Failed payment verification releases the reservation and restores available stock', async () => {
    const pRes = await query(`
      INSERT INTO products (merchant_id, name, description, brand, category, product_type, price, inventory, in_stock, is_test_lab, commerce_eligible)
      VALUES ($1, 'Failed Payment Router ' || floor(random()*100000), 'Wi-Fi 7 Router', 'Netgear', 'Electronics', 'router', 15000.00, 1, true, false, true)
      RETURNING *
    `, [merchantId]);
    const router = pRes.rows[0];

    const quote = await generateQuote({
      productId: router.id,
      quantity: 1,
      userId: buyerA.id,
      agentId: testAgent.id,
    });

    // Available inventory is now 0 (held by quote reservation)
    expect(await getAvailableInventory(router.id)).toBe(0);

    const piRes = await query(`
      INSERT INTO purchase_intents (agent_id, user_id, product_id, merchant_id, amount, quantity, status, quote_id)
      VALUES ($1, $2, $3, $4, 15000, 1, 'allowed', $5)
      RETURNING *
    `, [testAgent.id, buyerA.id, router.id, merchantId, quote.quoteId]);
    const intent = piRes.rows[0];

    const paymentOrder = await createPaymentOrder(intent.id, { mode: 'TEST' });

    // Submit tampered / invalid signature to simulate payment failure
    await expect(
      verifyPayment({
        transactionId: paymentOrder.transactionId,
        razorpayOrderId: paymentOrder.orderId,
        razorpayPaymentId: 'pay_tampered_123',
        razorpaySignature: 'completely_bogus_signature_invalid',
      })
    ).rejects.toThrow(/signature verification failed/i);

    // Reservation must be released
    const resv = (await query('SELECT status FROM inventory_reservations WHERE quote_id = $1', [quote.quoteId])).rows[0];
    expect(resv.status).toBe('RELEASED');

    // Available inventory must be restored to 1
    const availableRestored = await getAvailableInventory(router.id);
    expect(availableRestored).toBe(1);

    // Buyer B can now purchase the restored item
    const resvBuyerB = await reserveInventory({
      productId: router.id,
      quantity: 1,
      userId: buyerB.id,
      quoteId: `quote_buyer_b_restored_${Date.now()}`,
      durationMinutes: 15,
    });
    expect(resvBuyerB.status).toBe('RESERVED');
  });
});
