import { jest } from '@jest/globals';
import request from 'supertest';
import { app } from '../src/index.js';
import { query } from '../src/config/database.js';
import { generateAccessToken } from '../src/utils/authUtils.js';
import { validatePurchaseCandidate, PurchaseValidationError } from '../src/services/purchaseGate.js';
import { evaluatePolicy } from '../src/services/policyEngine.js';
import { parseBuyerIntent } from '../src/services/intentParser.js';
import { findEligibleProducts } from '../src/services/candidateFilter.js';

jest.setTimeout(35000);

describe('Track 04: AI Product Hallucination & Catalog Grounding Safety Suite', () => {
  let buyerUser, buyerToken;
  let merchantId;
  let policyId;
  let testAgent;
  let standardCharger, expensiveGanCharger, lowStockProduct, outOfStockProduct;

  beforeAll(async () => {
    // 1. Setup isolated test buyer
    const uRes = await query(`
      INSERT INTO users (email, name, role)
      VALUES ('ai_grounding_tester_' || floor(random()*1000000) || '@agentpay.com', 'Grounding Safety Tester', 'BUYER')
      RETURNING *
    `);
    buyerUser = uRes.rows[0];
    buyerToken = generateAccessToken(buyerUser);

    // 2. Setup verified merchant
    const mRes = await query(`
      INSERT INTO merchants (name, category, description, is_verified, rating, tier)
      VALUES ('Grounding Official Merchant ' || floor(random()*100000), 'Electronics', 'Verified Catalog Store', true, 4.9, 'tier_1')
      RETURNING id
    `);
    merchantId = mRes.rows[0].id;

    // 3. Setup Policy: 50,000 limit, 20,000 auto threshold, Electronics & Peripherals allowed
    const polRes = await query(`
      INSERT INTO policies (name, version, daily_budget, max_transaction, approval_threshold, allowed_categories, blocked_categories, max_retries, price_tolerance_pct, verified_merchants_only)
      VALUES ('Grounding Audit Policy', 'v1', 100000, 50000, 20000, ARRAY['Electronics', 'Peripherals'], ARRAY['Gambling', 'Weapons'], 1, 2.0, true)
      RETURNING id
    `);
    policyId = polRes.rows[0].id;

    // 4. Setup Agent
    const aRes = await query(`
      INSERT INTO agents (owner_id, name, description, policy_id, status)
      VALUES ($1, 'Autonomous Procurement Agent', 'Procurement Agent for Grounding Safety', $2, 'active')
      RETURNING *
    `, [buyerUser.id, policyId]);
    testAgent = aRes.rows[0];

    // 5. Seed Catalog Products
    // a. Standard 65W non-GaN Charger (₹1,499)
    const p1 = await query(`
      INSERT INTO products (merchant_id, name, description, brand, category, product_type, price, inventory, in_stock, specifications, is_test_lab, commerce_eligible)
      VALUES ($1, 'Standard 65W USB-C Wall Charger (Audited)', 'Standard silicon 65W fast charger', 'Anker', 'Electronics', 'charger', 1499.00, 30, true, '{"power": "65W", "technology": "Silicon"}', false, true)
      RETURNING *
    `, [merchantId]);
    standardCharger = p1.rows[0];

    // b. 65W GaN Charger priced at ₹3,499 (above ₹3,000 user budget)
    const p2 = await query(`
      INSERT INTO products (merchant_id, name, description, brand, category, product_type, price, inventory, in_stock, specifications, is_test_lab, commerce_eligible)
      VALUES ($1, 'Anker 735 65W GaN Fast Charger (Audited)', 'Compact GaN III 65W 3-port fast wall charger', 'Anker', 'Electronics', 'charger', 3499.00, 20, true, '{"power": "65W", "technology": "GaN"}', false, true)
      RETURNING *
    `, [merchantId]);
    expensiveGanCharger = p2.rows[0];

    // c. Product with low inventory (stock = 3)
    const p3 = await query(`
      INSERT INTO products (merchant_id, name, description, brand, category, product_type, price, inventory, in_stock, specifications, is_test_lab, commerce_eligible)
      VALUES ($1, 'Limited Stock Wireless Earbuds (Audited)', 'True wireless earbuds with ANC', 'Sony', 'Electronics', 'headphones', 2499.00, 3, true, '{"anc": true}', false, true)
      RETURNING *
    `, [merchantId]);
    lowStockProduct = p3.rows[0];

    // d. Out of stock product (stock = 0, in_stock = false)
    const p4 = await query(`
      INSERT INTO products (merchant_id, name, description, brand, category, product_type, price, inventory, in_stock, specifications, is_test_lab, commerce_eligible)
      VALUES ($1, 'Out Of Stock Mechanical Keyboard (Audited)', 'Custom RGB hot-swappable keyboard', 'Keychron', 'Peripherals', 'keyboard', 6999.00, 0, false, '{}', false, true)
      RETURNING *
    `, [merchantId]);
    outOfStockProduct = p4.rows[0];
  });

  afterAll(async () => {
    // Cleanup test fixtures
    if (buyerUser) {
      await query('DELETE FROM invoices WHERE order_id IN (SELECT id FROM orders WHERE user_id = $1)', [buyerUser.id]);
      await query('DELETE FROM orders WHERE user_id = $1', [buyerUser.id]);
      await query('DELETE FROM approvals WHERE purchase_intent_id IN (SELECT id FROM purchase_intents WHERE user_id = $1)', [buyerUser.id]);
      await query('DELETE FROM transactions WHERE user_id = $1', [buyerUser.id]);
      await query('DELETE FROM purchase_intents WHERE user_id = $1', [buyerUser.id]);
      await query('DELETE FROM agents WHERE owner_id = $1', [buyerUser.id]);
      await query('DELETE FROM user_preferences WHERE user_id = $1', [buyerUser.id]);
      await query('DELETE FROM in_app_notifications WHERE user_id = $1', [buyerUser.id]);
      await query('DELETE FROM users WHERE id = $1', [buyerUser.id]);
    }
    if (merchantId) {
      await query('DELETE FROM user_merchant_connections WHERE merchant_id = $1', [merchantId]);
      await query('DELETE FROM invoices WHERE order_id IN (SELECT id FROM orders WHERE purchase_intent_id IN (SELECT id FROM purchase_intents WHERE product_id IN (SELECT id FROM products WHERE merchant_id = $1)))', [merchantId]);
      await query('DELETE FROM orders WHERE purchase_intent_id IN (SELECT id FROM purchase_intents WHERE product_id IN (SELECT id FROM products WHERE merchant_id = $1))', [merchantId]);
      await query('DELETE FROM transactions WHERE purchase_intent_id IN (SELECT id FROM purchase_intents WHERE product_id IN (SELECT id FROM products WHERE merchant_id = $1))', [merchantId]);
      await query('DELETE FROM purchase_intents WHERE product_id IN (SELECT id FROM products WHERE merchant_id = $1)', [merchantId]);
      await query('DELETE FROM products WHERE merchant_id = $1', [merchantId]);
      await query('DELETE FROM merchants WHERE id = $1', [merchantId]);
    }
    if (policyId) await query('DELETE FROM policies WHERE id = $1', [policyId]);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 1: Nonexistent Product (AI Hallucinated Product ID)
  // ──────────────────────────────────────────────────────────────────────────
  test('TEST 1: Nonexistent product ID is strictly rejected with PRODUCT_NOT_FOUND fail-closed', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';

    // 1a. Direct API rejection
    const apiRes = await request(app)
      .post('/api/purchase-intents')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        agent_id: testAgent.id,
        product_id: fakeId,
        amount: 2500,
        quantity: 1,
      });

    expect(apiRes.status).toBe(404);
    expect(apiRes.body.code).toBe('PRODUCT_NOT_FOUND');

    // 1b. Pre-purchase gate rejection
    await expect(
      validatePurchaseCandidate({ id: fakeId, name: 'Hallucinated Device' }, {})
    ).rejects.toThrow(/does not exist in authoritative catalog/i);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 2: Wrong Category / Unrelated Product Substitution Rejection
  // ──────────────────────────────────────────────────────────────────────────
  test('TEST 2: Wrong category / product type mismatch is rejected fail-closed without substitution', async () => {
    // Attempting to buy a charger when request explicitly asked for a laptop
    const intent = { productType: 'laptop', maxPrice: 50000 };

    await expect(
      validatePurchaseCandidate(standardCharger, intent)
    ).rejects.toThrow(/Cannot purchase '.*' \(type: charger\) for request expecting 'laptop'/i);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 3: Wrong Specification (65W GaN Charger under ₹3,000)
  // ──────────────────────────────────────────────────────────────────────────
  test('TEST 3: "Buy a 65W GaN charger under ₹3,000" returns NO_MATCH with zero orders/payments created', async () => {
    const res = await request(app)
      .post('/api/ai/chat')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        agent_id: testAgent.id,
        message: 'Buy a 65W GaN charger under ₹3,000.',
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('NO_MATCH');
    expect(res.body.recommendation).toBeNull();
    expect(res.body.order).toBeFalsy();
    expect(res.body.authorization_status?.state).toBe('NO_MATCH');

    // Verify non-GaN charger was rejected for GaN requirement
    const nonGanIntent = {
      productType: 'charger',
      maxPrice: 3000,
      hardConstraints: { requiredWattageW: 65, requiredGan: true },
    };
    await expect(
      validatePurchaseCandidate(standardCharger, nonGanIntent)
    ).rejects.toThrow(/GaN \(Gallium Nitride\) technology is explicitly required/i);

    // Verify expensive GaN charger was rejected for exceeding budget
    await expect(
      validatePurchaseCandidate(expensiveGanCharger, nonGanIntent)
    ).rejects.toThrow(/exceeds user authorized maximum budget of ₹3000/i);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 4: Price Violation / Fabricated Price Rejection
  // ──────────────────────────────────────────────────────────────────────────
  test('TEST 4: Fabricated or manipulated price in AI/client output is strictly rejected', async () => {
    // 4a. Client or AI submits ₹1.00 for a ₹1,499 charger
    const manipulateRes = await request(app)
      .post('/api/purchase-intents')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        agent_id: testAgent.id,
        product_id: standardCharger.id,
        amount: 1.00,
        quantity: 1,
      });

    expect(manipulateRes.status).toBe(400);
    expect(manipulateRes.body.code).toBe('PRICE_MANIPULATION_DETECTED');

    // 4b. Pre-purchase gate rejects candidate proposing price divergence
    const fabricatedCandidate = {
      ...standardCharger,
      price: 1.00,
      unit_price: 1.00,
    };
    await expect(
      validatePurchaseCandidate(fabricatedCandidate, { maxPrice: 2000 })
    ).rejects.toThrow(/Proposed price.*diverges from authoritative catalog price/i);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 5: Valid Product Execution
  // ──────────────────────────────────────────────────────────────────────────
  test('TEST 5: Valid product matching all constraints succeeds with genuine order, invoice & audit event', async () => {
    const res = await request(app)
      .post('/api/ai/chat')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        agent_id: testAgent.id,
        message: 'Buy the Standard 65W USB-C Wall Charger under ₹2,000',
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('MATCH_FOUND');
    expect(res.body.execution_status).toBe('COMPLETED');
    expect(res.body.recommendation).toBeDefined();
    expect(res.body.recommendation.price).toBe(1499);
    expect(res.body.order).toBeDefined();
    expect(res.body.order.order_status).toBe('CONFIRMED');
    expect(res.body.invoice).toBeDefined();

    // Verify audit event exists
    const auditRes = await query(
      'SELECT * FROM audit_events WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
      [buyerUser.id]
    );
    expect(auditRes.rows.length).toBeGreaterThan(0);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 6: Valid Product with Insufficient Inventory
  // ──────────────────────────────────────────────────────────────────────────
  test('TEST 6: Valid product with insufficient inventory is rejected fail-closed without charging user', async () => {
    // 6a. Attempt to order quantity 10 of lowStockProduct (which only has stock=3)
    const intentRes = await request(app)
      .post('/api/purchase-intents')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        agent_id: testAgent.id,
        product_id: lowStockProduct.id,
        amount: 24990,
        quantity: 10,
      });

    expect(intentRes.status).toBe(422);
    expect(intentRes.body.code).toBe('INSUFFICIENT_INVENTORY');

    // 6b. Attempt to order outOfStockProduct (stock=0)
    const outOfStockRes = await request(app)
      .post('/api/purchase-intents')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        agent_id: testAgent.id,
        product_id: outOfStockProduct.id,
        amount: 6999,
        quantity: 1,
      });

    expect(outOfStockRes.status).toBe(422);
    expect(outOfStockRes.body.code).toBe('OUT_OF_STOCK');

    // 6c. Policy engine blocks insufficient inventory
    const policyResult = await evaluatePolicy({
      agentId: testAgent.id,
      userId: buyerUser.id,
      productId: lowStockProduct.id,
      amount: 24990,
      quantity: 10,
    });
    expect(policyResult.decision).toBe('BLOCK');
    expect(policyResult.rule).toBe('INSUFFICIENT_INVENTORY');

    // 6d. Pre-purchase gate rejects insufficient inventory
    await expect(
      validatePurchaseCandidate(lowStockProduct, { quantity: 10, maxPrice: 50000 })
    ).rejects.toThrow(/Insufficient inventory for product/i);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 7: Fabricated AI Response Cannot Result in Payment
  // ──────────────────────────────────────────────────────────────────────────
  test('TEST 7: Fabricated AI candidate cannot bypass pre-purchase gate or create financial payment', async () => {
    // Simulate malicious AI returning a hallucinated product
    const hallucinatedCandidate = {
      id: 'fa7e0000-0000-0000-0000-000000000000',
      name: 'Nonexistent Quantum Computer',
      price: 49999,
      inventory: 100,
      specifications: { quantum_qubits: 128 },
    };

    await expect(
      validatePurchaseCandidate(hallucinatedCandidate, { maxPrice: 100000 })
    ).rejects.toThrow(PurchaseValidationError);

    // Verify no orders were created
    const ordersRes = await query(
      'SELECT * FROM orders WHERE user_id = $1 AND product_id = $2',
      [buyerUser.id, hallucinatedCandidate.id]
    );
    expect(ordersRes.rows.length).toBe(0);
  });
});
