import { evaluatePolicy } from '../src/services/policyEngine.js';
import { query } from '../src/config/database.js';

describe('AgentPay Deterministic Policy Engine', () => {
  let policyId;
  let agentId;
  let normalProduct;
  let thresholdProduct;
  let overBudgetProduct;
  let unverifiedProduct;
  let testMerchantId;
  let unverifiedMerchantId;

  beforeAll(async () => {
    // Clear recent test intents
    await query("DELETE FROM transactions WHERE purchase_intent_id IN (SELECT id FROM purchase_intents WHERE ai_reasoning LIKE '%Test%')");
    await query("DELETE FROM approvals WHERE purchase_intent_id IN (SELECT id FROM purchase_intents WHERE ai_reasoning LIKE '%Test%')");
    await query("DELETE FROM purchase_intents WHERE ai_reasoning LIKE '%Test%'");

    // Create a dedicated isolated policy and agent for testing deterministic thresholds
    const polRes = await query(`
      INSERT INTO policies (name, version, daily_budget, max_transaction, approval_threshold, allowed_categories, blocked_categories, max_retries, price_tolerance_pct, verified_merchants_only)
      VALUES ('Policy Unit Test Policy', 'v1', 200000, 50000, 25000, ARRAY['electronics', 'peripherals'], ARRAY['luxury'], 1, 2.0, true)
      RETURNING id
    `);
    policyId = polRes.rows[0].id;

    const aRes = await query(`
      INSERT INTO agents (name, description, policy_id, status)
      VALUES ('Policy Isolated Test Agent', 'Isolated Policy Test', $1, 'active')
      RETURNING *
    `, [policyId]);
    agentId = aRes.rows[0].id;

    // Create isolated test merchants
    const m1 = await query(`
      INSERT INTO merchants (name, category, description, is_verified, rating, tier)
      VALUES ('Policy Test Store', 'Electronics', 'Verified', true, 4.9, 'tier_1')
      RETURNING id
    `);
    testMerchantId = m1.rows[0].id;

    const m2 = await query(`
      INSERT INTO merchants (name, category, description, is_verified, rating, tier)
      VALUES ('Unverified Store', 'Electronics', 'Unverified', false, 3.2, 'tier_3')
      RETURNING id
    `);
    unverifiedMerchantId = m2.rows[0].id;

    // Create products
    const p1 = await query(`
      INSERT INTO products (merchant_id, name, description, category, price, currency, in_stock, specifications)
      VALUES ($1, 'Test Mouse', 'Wireless Mouse', 'peripherals', 4999, 'INR', true, '{"wireless": true}')
      RETURNING *
    `, [testMerchantId]);
    normalProduct = p1.rows[0];

    const p2 = await query(`
      INSERT INTO products (merchant_id, name, description, category, price, currency, in_stock, specifications)
      VALUES ($1, 'Test Monitor', '4K Monitor', 'peripherals', 32000, 'INR', true, '{"resolution": "4K"}')
      RETURNING *
    `, [testMerchantId]);
    thresholdProduct = p2.rows[0];

    const p3 = await query(`
      INSERT INTO products (merchant_id, name, description, category, price, currency, in_stock, specifications)
      VALUES ($1, 'Test Server', 'High End Server', 'electronics', 75000, 'INR', true, '{"cpu": "64 core"}')
      RETURNING *
    `, [testMerchantId]);
    overBudgetProduct = p3.rows[0];

    const p4 = await query(`
      INSERT INTO products (merchant_id, name, description, category, price, currency, in_stock, specifications)
      VALUES ($1, 'Fake Product', 'Unverified Product', 'electronics', 9999, 'INR', true, '{}')
      RETURNING *
    `, [unverifiedMerchantId]);
    unverifiedProduct = p4.rows[0];
  });

  afterAll(async () => {
    if (testMerchantId || unverifiedMerchantId) {
      await query('DELETE FROM products WHERE merchant_id IN ($1, $2)', [testMerchantId, unverifiedMerchantId]);
      await query('DELETE FROM merchants WHERE id IN ($1, $2)', [testMerchantId, unverifiedMerchantId]);
    }
    if (agentId) {
      await query('DELETE FROM agents WHERE id = $1', [agentId]);
    }
    if (policyId) {
      await query('DELETE FROM policies WHERE id = $1', [policyId]);
    }
  });

  test('Rule 1 & 9: ALLOW when purchase is within autonomous spending limit', async () => {
    const result = await evaluatePolicy({
      agentId,
      productId: normalProduct.id,
      merchantId: normalProduct.merchant_id,
      amount: parseFloat(normalProduct.price),
    });

    expect(result.decision).toBe('ALLOW');
  });

  test('Rule 12: APPROVAL_REQUIRED when amount exceeds autonomous threshold (₹25k) but within max tx (₹50k)', async () => {
    const result = await evaluatePolicy({
      agentId,
      productId: thresholdProduct.id,
      merchantId: thresholdProduct.merchant_id,
      amount: parseFloat(thresholdProduct.price),
    });

    expect(result.decision).toBe('APPROVAL_REQUIRED');
    expect(result.reason).toContain('exceeds autonomous spending threshold');
  });

  test('Rule 9: BLOCK when single-transaction limit is exceeded (> ₹50k)', async () => {
    const result = await evaluatePolicy({
      agentId,
      productId: overBudgetProduct.id,
      merchantId: overBudgetProduct.merchant_id,
      amount: parseFloat(overBudgetProduct.price),
    });

    expect(result.decision).toBe('BLOCK');
    expect(result.reason).toContain('single-transaction ceiling');
  });

  test('Rule 8: BLOCK when price manipulation is detected (> 2% tolerance)', async () => {
    const inflatedPrice = parseFloat(normalProduct.price) * 1.30; // 30% higher
    const result = await evaluatePolicy({
      agentId,
      productId: normalProduct.id,
      merchantId: normalProduct.merchant_id,
      amount: inflatedPrice,
    });

    expect(result.decision).toBe('BLOCK');
    expect(result.reason).toContain('deviates by');
  });

  test('Rule 6: BLOCK when merchant is unverified', async () => {
    const result = await evaluatePolicy({
      agentId,
      productId: unverifiedProduct.id,
      merchantId: unverifiedProduct.merchant_id,
      amount: parseFloat(unverifiedProduct.price),
    });

    expect(result.decision).toBe('BLOCK');
    expect(result.reason).toContain('is unverified');
  });

  test('Rule 5: BLOCK when category is in blocked list', async () => {
    const pBlocked = await query(`
      INSERT INTO products (merchant_id, name, description, category, price, in_stock)
      VALUES ($1, 'Diamond Watch', 'Luxury Watch', 'luxury', 10000, true)
      RETURNING *
    `, [testMerchantId]);

    const result = await evaluatePolicy({
      agentId,
      productId: pBlocked.rows[0].id,
      merchantId: testMerchantId,
      amount: 10000,
    });

    expect(result.decision).toBe('BLOCK');
    expect(result.reason).toContain('is restricted by agent policy');

    await query('DELETE FROM products WHERE id = $1', [pBlocked.rows[0].id]);
  });
});
