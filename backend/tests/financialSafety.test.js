import { query } from '../src/config/database.js';
import { evaluatePolicy } from '../src/services/policyEngine.js';
import { evaluatePurchaseIntent } from '../src/services/decisionEngine.js';

describe('Financial Safety & Deterministic Policy Tests', () => {
  let testAgentId;
  let testProductId;
  let testMerchantId;
  let testUserId;

  beforeAll(async () => {
    // 1. Setup isolated test user
    const userRes = await query(`
      INSERT INTO users (email, name, role)
      VALUES ('financial_tester_${Date.now()}@agentpay.ai', 'Financial Tester', 'BUYER')
      RETURNING id
    `);
    testUserId = userRes.rows[0].id;

    // 2. Setup verified test merchant
    const merchantRes = await query(`
      INSERT INTO merchants (name, category, is_verified, rating)
      VALUES ('Safety Test Store ${Date.now()}', 'Electronics', true, 4.9)
      RETURNING id
    `);
    testMerchantId = merchantRes.rows[0].id;

    // 3. Setup test policy
    const policyRes = await query(`
      INSERT INTO policies (name, version, daily_budget, max_transaction, approval_threshold, allowed_categories, verified_merchants_only)
      VALUES ('Strict Policy Test', 'v1.0', 50000, 30000, 15000, ARRAY['Electronics', 'Furniture'], true)
      RETURNING id
    `);
    const policyId = policyRes.rows[0].id;

    // 4. Setup agent with policy
    const agentRes = await query(`
      INSERT INTO agents (name, owner_id, policy_id, status)
      VALUES ('Safety Agent', $1, $2, 'active')
      RETURNING id
    `, [testUserId, policyId]);
    testAgentId = agentRes.rows[0].id;

    // 5. Setup product
    const prodRes = await query(`
      INSERT INTO products (merchant_id, name, description, category, price, in_stock)
      VALUES ($1, 'Safety Test Item', 'Item for automated policy validation', 'Electronics', 12000, true)
      RETURNING id
    `, [testMerchantId]);
    testProductId = prodRes.rows[0].id;
  });

  afterAll(async () => {
    // Cleanup isolated entities
    if (testUserId) {
      await query('DELETE FROM purchase_intents WHERE user_id = $1', [testUserId]);
      await query('DELETE FROM agents WHERE owner_id = $1', [testUserId]);
      await query('DELETE FROM users WHERE id = $1', [testUserId]);
    }
    if (testMerchantId) {
      await query('DELETE FROM products WHERE merchant_id = $1', [testMerchantId]);
      await query('DELETE FROM merchants WHERE id = $1', [testMerchantId]);
    }
  });

  test('Purchase within limit returns ALLOW', async () => {
    const res = await evaluatePolicy({
      agentId: testAgentId,
      userId: testUserId,
      productId: testProductId,
      merchantId: testMerchantId,
      amount: 12000, // Below approval_threshold (15000)
      quantity: 1,
    });

    expect(res.decision).toBe('ALLOW');
  });

  test('Purchase above approval threshold returns APPROVAL_REQUIRED', async () => {
    // Create product priced at 22000 (above threshold 15000, below max 30000)
    const pRes = await query(`
      INSERT INTO products (merchant_id, name, description, category, price, in_stock)
      VALUES ($1, 'High Value Item', 'Needs approval', 'Electronics', 22000, true)
      RETURNING id
    `, [testMerchantId]);

    const res = await evaluatePolicy({
      agentId: testAgentId,
      userId: testUserId,
      productId: pRes.rows[0].id,
      merchantId: testMerchantId,
      amount: 22000,
      quantity: 1,
    });

    expect(res.decision).toBe('APPROVAL_REQUIRED');
    expect(res.reason).toMatch(/spending threshold|approval threshold/i);

    await query('DELETE FROM products WHERE id = $1', [pRes.rows[0].id]);
  });

  test('Purchase exceeding max transaction limit returns BLOCK', async () => {
    // Create product priced at 35000 (exceeds max_transaction 30000)
    const pRes = await query(`
      INSERT INTO products (merchant_id, name, description, category, price, in_stock)
      VALUES ($1, 'Overbudget Item', 'Exceeds max limit', 'Electronics', 35000, true)
      RETURNING id
    `, [testMerchantId]);

    const res = await evaluatePolicy({
      agentId: testAgentId,
      userId: testUserId,
      productId: pRes.rows[0].id,
      merchantId: testMerchantId,
      amount: 35000,
      quantity: 1,
    });

    expect(res.decision).toBe('BLOCK');
    expect(res.rule).toBe('MAX_TRANSACTION_EXCEEDED');

    await query('DELETE FROM products WHERE id = $1', [pRes.rows[0].id]);
  });

  test('Purchase in unallowed category returns BLOCK', async () => {
    const unapprovedProdRes = await query(`
      INSERT INTO products (merchant_id, name, description, category, price, in_stock)
      VALUES ($1, 'Jewelry Item', 'Unapproved', 'Jewelry', 5000, true)
      RETURNING id
    `, [testMerchantId]);

    const res = await evaluatePolicy({
      agentId: testAgentId,
      userId: testUserId,
      productId: unapprovedProdRes.rows[0].id,
      merchantId: testMerchantId,
      amount: 5000,
      quantity: 1,
    });

    expect(res.decision).toBe('BLOCK');
    expect(res.rule).toBe('CATEGORY_RESTRICTED');

    await query('DELETE FROM products WHERE id = $1', [unapprovedProdRes.rows[0].id]);
  });

  test('Price surge triggers Price Protection and BLOCKS transaction', async () => {
    // Create intent with catalog price 12000, but surge checkout amount 25000
    const intentRes = await query(`
      INSERT INTO purchase_intents (agent_id, user_id, product_id, merchant_id, amount, status)
      VALUES ($1, $2, $3, $4, 25000, 'pending')
      RETURNING id
    `, [testAgentId, testUserId, testProductId, testMerchantId]);

    const result = await evaluatePurchaseIntent(intentRes.rows[0].id);
    expect(result.decision).toBe('BLOCK');
    expect(result.status).toBe('blocked');
    expect(result.priceProtectionTriggered).toBe(true);

    await query('DELETE FROM purchase_intents WHERE id = $1', [intentRes.rows[0].id]);
  });
});
