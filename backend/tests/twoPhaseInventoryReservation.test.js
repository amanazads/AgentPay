/**
 * Track 01: Two-Phase Inventory Reservation & Anti-Overselling Concurrency Suite
 * 
 * Invariants under test:
 * 1. Concurrent requests NEVER reserve more units than available inventory.
 * 2. stock=1 with 2 buyers: exactly 1 wins, 1 rejected.
 * 3. stock=5 with 10 buyers: exactly 5 win, 5 rejected.
 * 4. Verified payment transitions RESERVED -> COMMITTED and decrements stock once.
 * 5. Payment failure/cancellation transitions RESERVED -> RELEASED and restores availability.
 * 6. Abandoned/expired reservations transition to EXPIRED and cease locking inventory.
 * 7. Duplicate webhook or commit retries NEVER double-decrement stock.
 * 8. PostgreSQL constraint mathematically guarantees inventory >= 0.
 */
import { query } from '../src/config/database.js';
import {
  reserveInventory,
  commitReservation,
  releaseReservation,
  getAvailableInventory,
  expireStaleReservations,
  InventoryStates,
} from '../src/services/inventoryService.js';
import { generateQuote, verifyQuoteForCheckout } from '../src/services/quoteService.js';

describe('Track 01: Two-Phase Inventory Reservation Protocol Suite', () => {
  let testMerchant;
  let testUser;

  beforeAll(async () => {
    // 1. Merchant
    const mRes = await query("SELECT * FROM merchants WHERE is_verified = true LIMIT 1");
    if (mRes.rows.length > 0) {
      testMerchant = mRes.rows[0];
    } else {
      const insM = await query(`
        INSERT INTO merchants (name, category, is_verified, rating)
        VALUES ('Inventory Rails Store', 'Electronics', true, 4.9)
        RETURNING *
      `);
      testMerchant = insM.rows[0];
    }

    // 2. User
    const insU = await query(`
      INSERT INTO users (email, name, role)
      VALUES ('inventory_tester_' || $1 || '@agentpay.com', 'Inventory Tester', 'BUYER')
      RETURNING *
    `, [Date.now()]);
    testUser = insU.rows[0];
  });

  async function createTestProduct(inventory = 1, price = 999.00) {
    const insP = await query(`
      INSERT INTO products (merchant_id, name, category, price, in_stock, inventory)
      VALUES ($1, 'Limited Stock Key ' || $2, 'Electronics', $3, true, $4)
      RETURNING *
    `, [testMerchant.id, `${Date.now()}_${Math.random().toString(36).substring(2, 6)}`, price, inventory]);
    return insP.rows[0];
  }

  // ── TEST 1: Stock=1, Two Concurrent Buyers ─────────────────────────────────
  test('TEST 1: Stock=1 with 2 concurrent buyers: exactly ONE succeeds, ONE fails with Insufficient inventory', async () => {
    const product = await createTestProduct(1);

    const [res1, res2] = await Promise.allSettled([
      reserveInventory({ productId: product.id, quantity: 1, userId: testUser.id, quoteId: `q_1_${Date.now()}` }),
      reserveInventory({ productId: product.id, quantity: 1, userId: testUser.id, quoteId: `q_2_${Date.now()}` }),
    ]);

    const fulfilled = [res1, res2].filter(r => r.status === 'fulfilled');
    const rejected = [res1, res2].filter(r => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    expect(fulfilled[0].value.status).toBe(InventoryStates.RESERVED);
    expect(rejected[0].reason.message).toMatch(/Insufficient inventory/);

    const available = await getAvailableInventory(product.id);
    expect(available).toBe(0);
  });

  // ── TEST 2: Stock=5, Ten Concurrent Buyers ──────────────────────────────────
  test('TEST 2: Stock=5 with 10 concurrent buyers: exactly 5 succeed, 5 fail without overselling', async () => {
    const product = await createTestProduct(5);

    const buyerRequests = Array.from({ length: 10 }, (_, i) =>
      reserveInventory({
        productId: product.id,
        quantity: 1,
        userId: testUser.id,
        quoteId: `q_ten_${i}_${Date.now()}`,
      })
    );

    const results = await Promise.allSettled(buyerRequests);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    expect(fulfilled).toHaveLength(5);
    expect(rejected).toHaveLength(5);

    for (const rej of rejected) {
      expect(rej.reason.message).toMatch(/Insufficient inventory/);
    }

    const available = await getAvailableInventory(product.id);
    expect(available).toBe(0);
  });

  // ── TEST 3: Payment Success (RESERVED -> COMMITTED) ─────────────────────────
  test('TEST 3: Payment success converts RESERVED -> COMMITTED and decrements inventory permanently', async () => {
    const product = await createTestProduct(10);
    const quoteId = `quote_commit_test_${Date.now()}`;

    // 1. Reserve 3 units
    const reservation = await reserveInventory({
      productId: product.id,
      quantity: 3,
      userId: testUser.id,
      quoteId,
    });
    expect(reservation.status).toBe(InventoryStates.RESERVED);

    // Initial stock in DB is 10, available is 7
    let available = await getAvailableInventory(product.id);
    expect(available).toBe(7);

    // 2. Verified Payment -> Commit Reservation
    const commitResult = await commitReservation(quoteId);
    expect(commitResult.success).toBe(true);
    expect(commitResult.reservation.status).toBe(InventoryStates.COMMITTED);
    expect(commitResult.previousInventory).toBe(10);
    expect(commitResult.newInventory).toBe(7);

    // 3. Product inventory in DB is now permanently 7
    const prodCheck = await query('SELECT inventory, in_stock FROM products WHERE id = $1', [product.id]);
    expect(prodCheck.rows[0].inventory).toBe(7);
    expect(prodCheck.rows[0].in_stock).toBe(true);

    available = await getAvailableInventory(product.id);
    expect(available).toBe(7);
  });

  // ── TEST 4: Payment Failure (RESERVED -> RELEASED) ──────────────────────────
  test('TEST 4: Payment failure converts RESERVED -> RELEASED and restores available inventory', async () => {
    const product = await createTestProduct(5);
    const quoteId = `quote_release_test_${Date.now()}`;

    // 1. Reserve 2 units
    await reserveInventory({
      productId: product.id,
      quantity: 2,
      userId: testUser.id,
      quoteId,
    });

    let available = await getAvailableInventory(product.id);
    expect(available).toBe(3);

    // 2. Payment Failure -> Release Reservation
    const releaseResult = await releaseReservation(quoteId, 'Simulated payment signature mismatch');
    expect(releaseResult.success).toBe(true);
    expect(releaseResult.reservation.status).toBe(InventoryStates.RELEASED);

    // 3. Available inventory is immediately restored to 5
    available = await getAvailableInventory(product.id);
    expect(available).toBe(5);

    // Product total inventory remains 5
    const prodCheck = await query('SELECT inventory FROM products WHERE id = $1', [product.id]);
    expect(prodCheck.rows[0].inventory).toBe(5);
  });

  // ── TEST 5: Reservation Expiry (Stale Lease Sweeping) ───────────────────────
  test('TEST 5: Expired reservations cease holding inventory and allow new buyers to reserve', async () => {
    const product = await createTestProduct(2);
    const staleQuoteId = `quote_stale_${Date.now()}`;

    // 1. Reserve with negative duration (already expired)
    await reserveInventory({
      productId: product.id,
      quantity: 2,
      userId: testUser.id,
      quoteId: staleQuoteId,
      durationMinutes: -10, // Expired 10m ago
    });

    // 2. Sweeper / dynamic check ignores expired reservations
    const available = await getAvailableInventory(product.id);
    expect(available).toBe(2);

    // 3. New buyer can immediately reserve 2 units
    const newReservation = await reserveInventory({
      productId: product.id,
      quantity: 2,
      userId: testUser.id,
      quoteId: `quote_new_buyer_${Date.now()}`,
    });

    expect(newReservation.status).toBe(InventoryStates.RESERVED);

    // Verify the stale reservation status transitioned to EXPIRED
    const staleResCheck = await query('SELECT status FROM inventory_reservations WHERE quote_id = $1', [staleQuoteId]);
    expect(staleResCheck.rows[0].status).toBe(InventoryStates.EXPIRED);
  });

  // ── TEST 6: Duplicate Webhook / Double Commit Idempotency ───────────────────
  test('TEST 6: Duplicate webhook or commit retries NEVER decrement inventory more than once', async () => {
    const product = await createTestProduct(10);
    const quoteId = `quote_webhook_retry_${Date.now()}`;

    // 1. Reserve 4 units
    await reserveInventory({
      productId: product.id,
      quantity: 4,
      userId: testUser.id,
      quoteId,
    });

    // 2. Replay commit 5 times (e.g. 5 duplicate webhooks)
    const commit1 = await commitReservation(quoteId);
    const commit2 = await commitReservation(quoteId);
    const commit3 = await commitReservation(quoteId);
    const commit4 = await commitReservation(quoteId);
    const commit5 = await commitReservation(quoteId);

    expect(commit1.success).toBe(true);
    expect(commit1.isDuplicate).toBeUndefined();
    expect(commit1.newInventory).toBe(6);

    expect(commit2.success).toBe(true);
    expect(commit2.isDuplicate).toBe(true);
    expect(commit3.isDuplicate).toBe(true);
    expect(commit4.isDuplicate).toBe(true);
    expect(commit5.isDuplicate).toBe(true);

    // 3. Verify final stock in DB is EXACTLY 6 (not decremented 5x to -10)
    const prodCheck = await query('SELECT inventory FROM products WHERE id = $1', [product.id]);
    expect(prodCheck.rows[0].inventory).toBe(6);
  });

  // ── TEST 7: PostgreSQL Non-Negative Check Constraint ────────────────────────
  test('TEST 7: Database check constraint guarantees inventory can NEVER become negative', async () => {
    const product = await createTestProduct(0);

    // Direct malicious update attempt below 0
    await expect(
      query('UPDATE products SET inventory = -5 WHERE id = $1', [product.id])
    ).rejects.toThrow(/chk_products_inventory_non_negative/);
  });
});
