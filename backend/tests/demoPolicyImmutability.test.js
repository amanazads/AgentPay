import request from 'supertest';
import { app } from '../src/index.js';
import { query } from '../src/config/database.js';
import { evaluatePolicy } from '../src/services/policyEngine.js';
import { resetDemoData } from '../src/services/demoResetService.js';
import { generateAccessToken } from '../src/utils/authUtils.js';

describe('AgentPay Invariant: Policy Immutability during Demo & Catalog Initialization', () => {
  let buyerUser;
  let buyerToken;
  let adminToken;
  let agentPolicy;
  let testAgent;
  let testProduct;

  const INITIAL_BUYER_PREFS = {
    monthly_budget: 75000.0,
    auto_purchase_limit: 18000.0,
    categories: ['Electronics', 'Peripherals'],
    preferred_brands: ['Sony', 'Logitech', 'Ambrane'],
    delivery_preference: 'Fastest available (within 2 days)',
    purchase_behavior: 'auto_within_limit',
  };

  const INITIAL_AGENT_POLICY = {
    daily_budget: 45000.0,
    max_transaction: 25000.0,
    approval_threshold: 15000.0,
    allowed_categories: ['electronics', 'peripherals'],
    blocked_categories: ['luxury', 'gambling', 'financial_products'],
    price_tolerance_pct: 2.0,
    verified_merchants_only: true,
  };

  beforeAll(async () => {
    // 1. Create or fetch isolated buyer user
    const userRes = await query(`
      INSERT INTO users (email, name, role)
      VALUES ('policy_immutability_tester_' || floor(random()*1000000) || '@agentpay.com', 'Policy Immutability Tester', 'BUYER')
      RETURNING id, name, email, role
    `);
    buyerUser = userRes.rows[0];
    buyerToken = generateAccessToken(buyerUser);

    const adminRes = await query(`
      INSERT INTO users (email, name, role)
      VALUES ('policy_immutability_admin_' || floor(random()*1000000) || '@agentpay.com', 'Policy Admin Tester', 'ADMIN')
      RETURNING id, name, email, role
    `);
    adminToken = generateAccessToken(adminRes.rows[0]);

    // 2. Set authoritative buyer preferences
    await query(`
      INSERT INTO user_preferences (
        user_id, monthly_budget, auto_purchase_limit, categories, preferred_brands,
        delivery_preference, purchase_behavior, policy_version, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 1, NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        monthly_budget = $2,
        auto_purchase_limit = $3,
        categories = $4,
        preferred_brands = $5,
        delivery_preference = $6,
        purchase_behavior = $7,
        policy_version = 1,
        updated_at = NOW()
    `, [
      buyerUser.id,
      INITIAL_BUYER_PREFS.monthly_budget,
      INITIAL_BUYER_PREFS.auto_purchase_limit,
      INITIAL_BUYER_PREFS.categories,
      INITIAL_BUYER_PREFS.preferred_brands,
      INITIAL_BUYER_PREFS.delivery_preference,
      INITIAL_BUYER_PREFS.purchase_behavior,
    ]);

    // 2b. Set active payment mandate for buyer so policy threshold rules can evaluate cleanly
    await query(`
      INSERT INTO user_payment_methods (
        user_id, method_type, provider, identifier_masked, single_transaction_limit,
        max_limit, daily_limit, monthly_limit, status, is_default, auth_environment
      )
      VALUES (
        $1, 'upi_mandate', 'razorpay', 'mandate_immutability@upi', 500000.00,
        500000.00, 500000.00, 500000.00, 'active', true, 'SANDBOX'
      )
    `, [buyerUser.id]);

    // 3. Create isolated agent policy
    const policyRes = await query(`
      INSERT INTO policies (
        name, version, daily_budget, max_transaction, approval_threshold,
        allowed_categories, blocked_categories, price_tolerance_pct, verified_merchants_only, is_active
      )
      VALUES (
        'Policy Immutability Test Policy', 'v-immutability-test', $1, $2, $3,
        $4, $5, $6, $7, true
      )
      RETURNING *
    `, [
      INITIAL_AGENT_POLICY.daily_budget,
      INITIAL_AGENT_POLICY.max_transaction,
      INITIAL_AGENT_POLICY.approval_threshold,
      INITIAL_AGENT_POLICY.allowed_categories,
      INITIAL_AGENT_POLICY.blocked_categories,
      INITIAL_AGENT_POLICY.price_tolerance_pct,
      INITIAL_AGENT_POLICY.verified_merchants_only,
    ]);
    agentPolicy = policyRes.rows[0];

    // 4. Create isolated agent assigned to this policy and buyer
    const agentRes = await query(`
      INSERT INTO agents (
        name, status, policy_id, owner_id, description
      )
      VALUES (
        'Policy Guard Agent', 'active', $1, $2, 'Agent dedicated to testing policy immutability invariants'
      )
      RETURNING *
    `, [agentPolicy.id, buyerUser.id]);
    testAgent = agentRes.rows[0];

    // 5. Fetch a product from verified merchant
    const prodRes = await query(`
      SELECT p.*, m.name as merchant_name
      FROM products p
      JOIN merchants m ON p.merchant_id = m.id
      WHERE p.in_stock = true AND m.is_verified = true
      LIMIT 1
    `);
    testProduct = prodRes.rows[0];
  });

  afterAll(async () => {
    if (testAgent) {
      await query('DELETE FROM agents WHERE id = $1', [testAgent.id]);
    }
    if (agentPolicy) {
      await query('DELETE FROM policies WHERE id = $1', [agentPolicy.id]);
    }
    if (buyerUser) {
      await query('DELETE FROM in_app_notifications WHERE user_id = $1', [buyerUser.id]);
      await query('DELETE FROM user_payment_methods WHERE user_id = $1', [buyerUser.id]);
      await query('DELETE FROM user_preferences WHERE user_id = $1', [buyerUser.id]);
      await query('DELETE FROM users WHERE id = $1', [buyerUser.id]);
    }
  });

  test('TEST 1: Calling demo initialization (catalog-readiness & demo-data) does NOT modify existing buyer preferences', async () => {
    // 1. Query before
    const beforePrefsRes = await query('SELECT * FROM user_preferences WHERE user_id = $1', [buyerUser.id]);
    const beforePrefs = beforePrefsRes.rows[0];

    // 2. Call catalog-readiness and demo-data endpoints
    const res1 = await request(app).get('/api/ai-commerce/catalog-readiness');
    expect(res1.status).toBe(200);

    const res2 = await request(app).get('/api/ai-commerce/demo-data');
    expect(res2.status).toBe(200);

    // 3. Query after
    const afterPrefsRes = await query('SELECT * FROM user_preferences WHERE user_id = $1', [buyerUser.id]);
    const afterPrefs = afterPrefsRes.rows[0];

    expect(parseFloat(afterPrefs.monthly_budget)).toBe(INITIAL_BUYER_PREFS.monthly_budget);
    expect(parseFloat(afterPrefs.auto_purchase_limit)).toBe(INITIAL_BUYER_PREFS.auto_purchase_limit);
    expect(afterPrefs.categories).toEqual(INITIAL_BUYER_PREFS.categories);
    expect(afterPrefs.preferred_brands).toEqual(INITIAL_BUYER_PREFS.preferred_brands);
    expect(afterPrefs.delivery_preference).toBe(INITIAL_BUYER_PREFS.delivery_preference);
    expect(afterPrefs.purchase_behavior).toBe(INITIAL_BUYER_PREFS.purchase_behavior);
  });

  test('TEST 2: Calling demo initialization repeatedly is strictly idempotent with zero policy drift', async () => {
    // Call 10 times in succession
    for (let i = 0; i < 10; i++) {
      const res = await request(app).get('/api/ai-commerce/catalog-readiness');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    }

    const currentPolicyRes = await query('SELECT * FROM policies WHERE id = $1', [agentPolicy.id]);
    const currentPolicy = currentPolicyRes.rows[0];

    expect(parseFloat(currentPolicy.daily_budget)).toBe(INITIAL_AGENT_POLICY.daily_budget);
    expect(parseFloat(currentPolicy.max_transaction)).toBe(INITIAL_AGENT_POLICY.max_transaction);
    expect(parseFloat(currentPolicy.approval_threshold)).toBe(INITIAL_AGENT_POLICY.approval_threshold);
    expect(currentPolicy.allowed_categories).toEqual(INITIAL_AGENT_POLICY.allowed_categories);
    expect(currentPolicy.blocked_categories).toEqual(INITIAL_AGENT_POLICY.blocked_categories);
  });

  test('TEST 3: A buyer\'s max transaction limit remains unchanged and is never overwritten with permissive values', async () => {
    // Call demo data endpoint
    await request(app).get('/api/ai-commerce/demo-data');

    const prefsRes = await query('SELECT auto_purchase_limit FROM user_preferences WHERE user_id = $1', [buyerUser.id]);
    const limit = parseFloat(prefsRes.rows[0].auto_purchase_limit);

    // Limit must be exactly 18,000, NOT 500,000
    expect(limit).toBe(18000.0);
    expect(limit).not.toBe(500000.0);
  });

  test('TEST 4: Approval threshold remains unchanged after demo initialization', async () => {
    await request(app).get('/api/ai-commerce/catalog-readiness');

    const policyRes = await query('SELECT approval_threshold FROM policies WHERE id = $1', [agentPolicy.id]);
    const threshold = parseFloat(policyRes.rows[0].approval_threshold);

    // Approval threshold must be exactly 15,000, NOT 500,000
    expect(threshold).toBe(15000.0);
    expect(threshold).not.toBe(500000.0);
  });

  test('TEST 5: Daily and monthly budgets remain unchanged', async () => {
    await request(app).get('/api/ai-commerce/demo-data');

    const policyRes = await query('SELECT daily_budget FROM policies WHERE id = $1', [agentPolicy.id]);
    const dailyBudget = parseFloat(policyRes.rows[0].daily_budget);

    const prefsRes = await query('SELECT monthly_budget FROM user_preferences WHERE user_id = $1', [buyerUser.id]);
    const monthlyBudget = parseFloat(prefsRes.rows[0].monthly_budget);

    // Daily budget must be 45,000 (NOT 10,000,000) and monthly budget must be 75,000
    expect(dailyBudget).toBe(45000.0);
    expect(dailyBudget).not.toBe(10000000.0);
    expect(monthlyBudget).toBe(75000.0);
    expect(monthlyBudget).not.toBe(10000000.0);
  });

  test('TEST 6: Category restrictions and blocked categories remain strictly enforced before and after demo initialization', async () => {
    await request(app).get('/api/ai-commerce/catalog-readiness');

    const policyRes = await query('SELECT allowed_categories, blocked_categories FROM policies WHERE id = $1', [agentPolicy.id]);
    const policy = policyRes.rows[0];

    expect(policy.allowed_categories).toEqual(['electronics', 'peripherals']);
    expect(policy.blocked_categories).toEqual(['luxury', 'gambling', 'financial_products']);
  });

  test('TEST 7: Executing autonomous purchase preview (evaluate-purchase-flow) does NOT mutate policy limits', async () => {
    const execRes = await request(app)
      .post('/api/ai-commerce/evaluate-purchase-flow')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        productId: testProduct.id,
        prompt: `Purchase ${testProduct.name}`,
        deliveryMethod: 'STANDARD',
      });

    expect(execRes.status).toBe(200);

    // Check policy limits again
    const policyRes = await query('SELECT daily_budget, max_transaction, approval_threshold FROM policies WHERE id = $1', [agentPolicy.id]);
    const policy = policyRes.rows[0];

    expect(parseFloat(policy.daily_budget)).toBe(INITIAL_AGENT_POLICY.daily_budget);
    expect(parseFloat(policy.max_transaction)).toBe(INITIAL_AGENT_POLICY.max_transaction);
    expect(parseFloat(policy.approval_threshold)).toBe(INITIAL_AGENT_POLICY.approval_threshold);

    const prefsRes = await query('SELECT monthly_budget, auto_purchase_limit FROM user_preferences WHERE user_id = $1', [buyerUser.id]);
    const prefs = prefsRes.rows[0];

    expect(parseFloat(prefs.monthly_budget)).toBe(INITIAL_BUYER_PREFS.monthly_budget);
    expect(parseFloat(prefs.auto_purchase_limit)).toBe(INITIAL_BUYER_PREFS.auto_purchase_limit);
  });

  test('TEST 8: Resetting demo state preserves buyer spending preferences and active policies', async () => {
    // Call reset endpoints
    const resetRes = await request(app)
      .post('/api/ai-commerce/reset-demo')
      .set('Authorization', `Bearer ${adminToken}`)
      .send();

    expect(resetRes.status).toBe(200);

    // Also test service-level resetDemoData
    const serviceReset = await resetDemoData();
    expect(serviceReset.success).toBe(true);

    // Verify buyer preferences still exist and limits are preserved
    const prefsRes = await query('SELECT monthly_budget, auto_purchase_limit, categories FROM user_preferences WHERE user_id = $1', [buyerUser.id]);
    expect(prefsRes.rows.length).toBe(1);
    expect(parseFloat(prefsRes.rows[0].monthly_budget)).toBe(INITIAL_BUYER_PREFS.monthly_budget);
    expect(parseFloat(prefsRes.rows[0].auto_purchase_limit)).toBe(INITIAL_BUYER_PREFS.auto_purchase_limit);
    expect(prefsRes.rows[0].categories).toEqual(INITIAL_BUYER_PREFS.categories);

    // Verify agent policy is untouched
    const policyRes = await query('SELECT daily_budget, max_transaction, approval_threshold FROM policies WHERE id = $1', [agentPolicy.id]);
    expect(policyRes.rows.length).toBe(1);
    expect(parseFloat(policyRes.rows[0].daily_budget)).toBe(INITIAL_AGENT_POLICY.daily_budget);
    expect(parseFloat(policyRes.rows[0].max_transaction)).toBe(INITIAL_AGENT_POLICY.max_transaction);
    expect(parseFloat(policyRes.rows[0].approval_threshold)).toBe(INITIAL_AGENT_POLICY.approval_threshold);
  });

  test('TEST 9: Deterministic Policy Engine enforces buyer authorization threshold (> ₹18,000 triggers human review gate)', async () => {
    // 1. Fetch a product whose verified catalog price is > ₹18,000 (e.g. Sony Headphones at ₹26,990)
    const thresholdProdRes = await query(`
      SELECT p.*, m.name as merchant_name
      FROM products p
      JOIN merchants m ON p.merchant_id = m.id
      WHERE p.price > 18000 AND p.in_stock = true AND m.is_verified = true
      ORDER BY p.price ASC
      LIMIT 1
    `);
    const thresholdProduct = thresholdProdRes.rows[0];
    const itemPrice = parseFloat(thresholdProduct.price);

    // Buyer auto_purchase_limit is ₹18,000.
    // The purchase price matches catalog price exactly, but exceeds ₹18,000 and MUST trigger APPROVAL_REQUIRED (not ALLOW)
    const evaluation = await evaluatePolicy({
      agentId: testAgent.id,
      userId: buyerUser.id,
      productId: thresholdProduct.id,
      merchantId: thresholdProduct.merchant_id,
      amount: itemPrice,
      quantity: 1,
    });

    expect(evaluation.decision).toBe('APPROVAL_REQUIRED');
    expect(evaluation.rule).toBe('APPROVAL_THRESHOLD');
    expect(evaluation.reason).toContain('exceeds autonomous spending threshold');
  });
});
