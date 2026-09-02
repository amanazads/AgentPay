import { query } from '../src/config/database.js';
import { 
  BaseMerchantAdapter, 
  StandardMerchantAdapter, 
  NativeMerchantAdapter, 
  VerifiedMerchantStoreAdapter, 
  SimulationMerchantAdapter, 
  BaseExternalConnector, 
  ExternalMerchantConnector, 
  CommerceOrchestrator 
} from '../src/services/merchantAdapter.js';
import { findEligibleProducts } from '../src/services/candidateFilter.js';
import request from 'supertest';
import express from 'express';
import merchantPortalRouter from '../src/routes/merchantPortal.js';
import { authenticateUser } from '../src/middleware/authMiddleware.js';
import { generateAccessToken } from '../src/utils/authUtils.js';

describe('Track 01: Merchant Adapter & Multi-Merchant Architecture Suite', () => {
  let app;
  let merchantA, merchantB;
  let userA, userB, buyerUser;
  let tokenA, tokenB;
  let productA, productB;

  beforeAll(async () => {
    // Setup Express test app for merchantPortal routes
    app = express();
    app.use(express.json());
    app.use(authenticateUser);
    app.use('/api/merchant', merchantPortalRouter);

    // 1. Create two distinct merchants in DB
    const mResA = await query(`
      INSERT INTO merchants (name, category, is_verified, rating, tier)
      VALUES ($1, 'Electronics', true, 4.9, 'tier_1')
      RETURNING *
    `, [`Store Alpha ${Date.now()}`]);
    merchantA = mResA.rows[0];

    const mResB = await query(`
      INSERT INTO merchants (name, category, is_verified, rating, tier)
      VALUES ($1, 'Hardware', true, 4.8, 'tier_1')
      RETURNING *
    `, [`Store Beta ${Date.now()}`]);
    merchantB = mResB.rows[0];

    // 2. Create users linked to respective merchants
    const uResA = await query(`
      INSERT INTO users (email, name, role, merchant_id)
      VALUES ($1, 'Merchant User A', 'MERCHANT', $2)
      RETURNING *
    `, [`merchant_a_${Date.now()}@test.internal`, merchantA.id]);
    userA = uResA.rows[0];
    tokenA = generateAccessToken(userA);

    const uResB = await query(`
      INSERT INTO users (email, name, role, merchant_id)
      VALUES ($1, 'Merchant User B', 'MERCHANT', $2)
      RETURNING *
    `, [`merchant_b_${Date.now()}@test.internal`, merchantB.id]);
    userB = uResB.rows[0];
    tokenB = generateAccessToken(userB);

    const bRes = await query(`
      INSERT INTO users (email, name, role)
      VALUES ($1, 'Test Discovery Buyer', 'BUYER')
      RETURNING *
    `, [`buyer_discovery_${Date.now()}@test.internal`]);
    buyerUser = bRes.rows[0];

    // 3. Create products for each merchant
    const pResA = await query(`
      INSERT INTO products (merchant_id, name, category, brand, price, in_stock, inventory, description)
      VALUES ($1, 'Alpha Gaming Keyboard RGB', 'Electronics', 'KeyMaster', 3499.00, true, 15, 'Mechanical keyboard')
      RETURNING *
    `, [merchantA.id]);
    productA = pResA.rows[0];

    const pResB = await query(`
      INSERT INTO products (merchant_id, name, category, brand, price, in_stock, inventory, description)
      VALUES ($1, 'Beta Ergonomic Vertical Mouse', 'Electronics', 'ErgoGrip', 2199.00, true, 25, 'Wireless ergonomic mouse')
      RETURNING *
    `, [merchantB.id]);
    productB = pResB.rows[0];
  }, 30000);

  afterAll(async () => {
    // Cleanup test data
    if (merchantA?.id && merchantB?.id) {
      await query('DELETE FROM products WHERE merchant_id IN ($1, $2)', [merchantA.id, merchantB.id]);
      await query('DELETE FROM orders WHERE merchant_id IN ($1, $2)', [merchantA.id, merchantB.id]);
      await query('DELETE FROM merchants WHERE id IN ($1, $2)', [merchantA.id, merchantB.id]);
    }
    if (userA?.id && userB?.id) {
      await query('DELETE FROM in_app_notifications WHERE user_id IN ($1, $2, $3)', [userA.id, userB.id, buyerUser.id]);
      await query('DELETE FROM event_notifications WHERE user_id IN ($1, $2, $3)', [userA.id, userB.id, buyerUser.id]);
      await query('DELETE FROM users WHERE id IN ($1, $2, $3)', [userA.id, userB.id, buyerUser.id]);
    }
  });

  // ── TEST 1: Multiple Native Merchants Aggregation ───────────────────────────
  test('TEST 1: CommerceOrchestrator discovers and aggregates products across multiple distinct native merchants', async () => {
    const orchestrator = new CommerceOrchestrator();
    await orchestrator.initialize();

    const adapterA = await orchestrator.getAdapter(merchantA.id);
    const adapterB = await orchestrator.getAdapter(merchantB.id);

    expect(adapterA).toBeDefined();
    expect(adapterB).toBeDefined();
    expect(adapterA.name).toBe(merchantA.name);
    expect(adapterB.name).toBe(merchantB.name);

    // Multi-merchant unified search
    const results = await orchestrator.searchAllMerchants({ category: 'Electronics' });
    const productNames = results.map((p) => p.name);

    expect(productNames).toContain(productA.name);
    expect(productNames).toContain(productB.name);
  });

  // ── TEST 2: Server-Side Merchant Isolation ──────────────────────────────────
  test('TEST 2: Merchant A cannot view, update, or delete Merchant B products or orders', async () => {
    // Attempt to update Merchant B's product using Merchant A's token
    const updateRes = await request(app)
      .put(`/api/merchant/products/${productB.id}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ price: 999.00, name: 'Malicious Overwrite' });

    expect(updateRes.status).toBe(404);
    expect(updateRes.body.error).toMatch(/Product not found/i);

    // Verify Merchant B's product was not mutated in DB
    const checkProd = await query('SELECT * FROM products WHERE id = $1', [productB.id]);
    expect(checkProd.rows[0].price).toBe('2199.00');
    expect(checkProd.rows[0].name).toBe('Beta Ergonomic Vertical Mouse');

    // Attempt to delete Merchant B's product using Merchant A's token
    const deleteRes = await request(app)
      .delete(`/api/merchant/products/${productB.id}`)
      .set('Authorization', `Bearer ${tokenA}`);

    expect(deleteRes.status).toBe(404);
  });

  // ── TEST 3: Multi-Merchant Buyer Discovery ─────────────────────────────────
  test('TEST 3: Buyer discovery aggregates candidates from multiple verified native merchants', async () => {
    const discovery = await findEligibleProducts({
      productType: 'mouse',
      category: 'Electronics',
      maxPrice: 5000,
    });

    expect(discovery.status).toBe('MATCH_FOUND');
    expect(discovery.eligibleCandidates.length).toBeGreaterThanOrEqual(1);

    const foundBeta = discovery.eligibleCandidates.some((c) => c.id === productB.id && c.merchant_id === merchantB.id);
    expect(foundBeta).toBe(true);
  });

  // ── TEST 4: Product Ownership Server-Side Enforcement ───────────────────────
  test('TEST 4: Creating a product server-side always assigns the authenticated merchant ID', async () => {
    // Merchant A attempts to spoof merchant_id in request body to Merchant B
    const createRes = await request(app)
      .post('/api/merchant/products')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        name: 'Alpha Wireless Headset Pro',
        category: 'Electronics',
        brand: 'SoundPulse',
        price: 4999.00,
        inventory: 10,
        merchant_id: merchantB.id, // Attempted spoof
        merchantId: merchantB.id,  // Attempted spoof
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.product).toBeDefined();

    // Verify it is strictly owned by Merchant A
    expect(createRes.body.product.merchant_id).toBe(merchantA.id);

    // Cleanup
    await query('DELETE FROM products WHERE id = $1', [createRes.body.product.id]);
  });

  // ── TEST 5: Unavailable Merchant Resilience ─────────────────────────────────
  test('TEST 5: CommerceOrchestrator gracefully tolerates failing or unavailable merchant adapters', async () => {
    const orchestrator = new CommerceOrchestrator();
    await orchestrator.initialize();

    // Register a broken mock adapter that throws an error
    const brokenAdapter = {
      name: 'Failing Remote Merchant',
      id: 'failing_merch_id',
      async searchProducts() {
        throw new Error('Remote merchant connection timed out (504 Gateway Timeout)');
      },
    };
    await orchestrator.registerAdapter('failing_merch_id', brokenAdapter);

    // Search should not throw; should return healthy results from Merchant A & B
    const results = await orchestrator.searchAllMerchants({ category: 'Electronics' });
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  // ── TEST 6: External Connector Lifecycle & Failure Handling ─────────────────
  test('TEST 6: ExternalMerchantConnector fails closed when unconfigured without synthesizing fake data', async () => {
    const connector = new ExternalMerchantConnector({
      id: 'ext_test_unconfigured',
      name: 'Generic OpenAPI Connector',
    });

    expect(connector.adapterType).toBe('EXTERNAL_CONNECTOR');
    expect(connector.state).toBe('UNCONFIGURED');

    const credCheck = await connector.validateCredentials();
    expect(credCheck.valid).toBe(false);
    expect(credCheck.state).toBe('UNCONFIGURED');

    // Unconfigured search returns empty array, not fake items
    const searchRes = await connector.searchProducts({ query: 'laptop' });
    expect(searchRes).toEqual([]);

    // Unconfigured sync throws informative error
    await expect(connector.syncCatalog()).rejects.toThrow(/unconfigured/i);

    // Unconfigured order placement throws error
    await expect(connector.placeOrder({ checkoutId: '123' })).rejects.toThrow(/unconfigured/i);
  });

  // ── TEST 7: Simulation Adapter Separation & Isolation ───────────────────────
  test('TEST 7: SimulationMerchantAdapter is isolated and tagged with simulation metadata', async () => {
    const simAdapter = new SimulationMerchantAdapter();
    expect(simAdapter.isSimulation).toBe(true);
    expect(simAdapter.adapterType).toBe('SIMULATION');

    const simOrder = await simAdapter.getOrder('ORD-TEST-99');
    expect(simOrder.isSimulation).toBe(true);

    const simRefund = await simAdapter.simulateRefund('ORD-TEST-99', 1000, 'Attack test');
    expect(simRefund.isSimulation).toBe(true);
    expect(simRefund.note).toContain('Production ledger untouched');
  });
});
