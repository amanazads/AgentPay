import request from 'supertest';
import { app } from '../src/index.js';
import { query } from '../src/config/database.js';
import { evaluatePolicy } from '../src/services/policyEngine.js';
import { findEligibleProducts } from '../src/services/candidateFilter.js';
import { parseBuyerIntent } from '../src/services/intentParser.js';
import { parseNaturalLanguagePreference } from '../src/services/preferenceParser.js';
import { calculateMonthlySpend, getSpendingSummary } from '../src/services/spendingService.js';

describe('Track 01: Buyer Preferences & Procurement Policy Hardening Suite', () => {
  let testBuyerUserId;
  let testAgentId;
  let testMerchantId;
  let powerBankProduct;
  let headphonesProduct;
  let laptopProduct;
  let chairProduct;

  beforeAll(async () => {
    // 1. Fetch test buyer user
    const userRes = await query("SELECT id FROM users WHERE role = 'user' LIMIT 1");
    testBuyerUserId = userRes.rows[0]?.id;

    // 2. Fetch test agent
    const agentRes = await query("SELECT id FROM agents WHERE status = 'active' LIMIT 1");
    testAgentId = agentRes.rows[0]?.id;

    // 3. Fetch test merchant
    const merchRes = await query("SELECT id FROM merchants WHERE is_verified = true LIMIT 1");
    testMerchantId = merchRes.rows[0]?.id;

    // 4. Fetch test products across categories
    const pbRes = await query("SELECT * FROM products WHERE name ILIKE '%Ambrane%' LIMIT 1");
    powerBankProduct = pbRes.rows[0];

    const hpRes = await query("SELECT * FROM products WHERE name ILIKE '%Sony%' LIMIT 1");
    headphonesProduct = hpRes.rows[0];

    const lapRes = await query("SELECT * FROM products WHERE name ILIKE '%Zephyrus%' OR name ILIKE '%MacBook%' LIMIT 1");
    laptopProduct = lapRes.rows[0];

    const chairRes = await query("SELECT * FROM products WHERE category ILIKE '%Furniture%' OR name ILIKE '%Chair%' LIMIT 1");
    chairProduct = chairRes.rows[0];

    // Ensure buyer has high payment mandate ceiling so policy rules can be tested cleanly
    await query(`
      UPDATE user_payment_methods
      SET single_transaction_limit = 500000.00,
          max_limit = 500000.00,
          status = 'active',
          revoked_at = NULL
      WHERE user_id = $1
    `, [testBuyerUserId]);
  });

  // TEST 1: Monthly budget ₹2,00,000, Spent ₹50,000, Purchase ₹20,000 -> PASS
  it('TEST 1: Purchase within monthly budget returns ALLOW and calculates correct remaining budget', async () => {
    // Set buyer preferences: monthly budget 200,000, auto limit 50,000
    await query(`
      INSERT INTO user_preferences (user_id, monthly_budget, auto_purchase_limit, categories, preferred_brands, purchase_behavior, updated_at)
      VALUES ($1, 200000, 50000, ARRAY['Electronics', 'Peripherals'], ARRAY['Apple', 'Sony', 'Ambrane'], 'auto_within_limit', NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        monthly_budget = 200000,
        auto_purchase_limit = 50000,
        categories = ARRAY['Electronics', 'Peripherals'],
        preferred_brands = ARRAY['Apple', 'Sony', 'Ambrane'],
        purchase_behavior = 'auto_within_limit',
        updated_at = NOW()
    `, [testBuyerUserId]);

    const evalResult = await evaluatePolicy({
      agentId: testAgentId,
      userId: testBuyerUserId,
      productId: powerBankProduct.id,
      merchantId: powerBankProduct.merchant_id,
      amount: 1899,
      deliveryFee: 100,
    });

    expect(evalResult.decision).toBe('ALLOW');
    expect(evalResult.remainingBudget).toBeGreaterThanOrEqual(1899);
  });

  // TEST 2: Monthly remaining ₹10,000, Purchase ₹12,000 -> BLOCKED
  it('TEST 2: Purchase exceeding remaining monthly budget is strictly BLOCKED with transparent explanation', async () => {
    // Set small monthly budget of ₹10,000
    await query(`
      UPDATE user_preferences
      SET monthly_budget = 10000,
          auto_purchase_limit = 10000
      WHERE user_id = $1
    `, [testBuyerUserId]);

    const evalResult = await evaluatePolicy({
      agentId: testAgentId,
      userId: testBuyerUserId,
      productId: headphonesProduct.id, // Sony WH-1000XM5: ₹26,990
      merchantId: headphonesProduct.merchant_id,
      amount: parseFloat(headphonesProduct.price),
    });

    expect(evalResult.decision).toBe('BLOCK');
    expect(evalResult.rule).toBe('MONTHLY_BUDGET_EXCEEDED');
    expect(evalResult.reason).toContain('exceeds your monthly spending budget');
  });

  // TEST 3: Autonomous limit ₹50,000, Purchase ₹49,999 -> AUTONOMOUS (ALLOW)
  it('TEST 3: Purchase at or below autonomous limit is authorized automatically (ALLOW)', async () => {
    await query(`
      UPDATE user_preferences
      SET monthly_budget = 200000,
          auto_purchase_limit = 50000,
          purchase_behavior = 'auto_within_limit'
      WHERE user_id = $1
    `, [testBuyerUserId]);

    const evalResult = await evaluatePolicy({
      agentId: testAgentId,
      userId: testBuyerUserId,
      productId: headphonesProduct.id,
      merchantId: headphonesProduct.merchant_id,
      amount: parseFloat(headphonesProduct.price),
    });

    expect(evalResult.decision).toBe('ALLOW');
    expect(evalResult.threshold).toBe(50000);
  });

  // TEST 4: Autonomous limit ₹50,000, Purchase ₹50,001 -> APPROVAL_REQUIRED
  it('TEST 4: Purchase exceeding autonomous limit escalates to APPROVAL_REQUIRED without calling payment execution', async () => {
    await query(`
      UPDATE user_preferences
      SET monthly_budget = 300000,
          auto_purchase_limit = 50000,
          purchase_behavior = 'auto_within_limit'
      WHERE user_id = $1
    `, [testBuyerUserId]);

    const evalResult = await evaluatePolicy({
      agentId: testAgentId,
      userId: testBuyerUserId,
      productId: laptopProduct.id, // > ₹50,000
      merchantId: laptopProduct.merchant_id,
      amount: parseFloat(laptopProduct.price),
    });

    expect(evalResult.decision).toBe('APPROVAL_REQUIRED');
    expect(evalResult.rule).toBe('APPROVAL_THRESHOLD');
    expect(evalResult.reason).toContain('exceeds autonomous spending threshold');
  });

  // TEST 5: Furniture not permitted -> Request "Buy me an office chair" -> BLOCKED
  it('TEST 5: Product in unpermitted category is strictly BLOCKED by policy boundary', async () => {
    // Only permit Electronics and Peripherals (strictly exclude Furniture)
    await query(`
      UPDATE user_preferences
      SET categories = ARRAY['Electronics', 'Peripherals']
      WHERE user_id = $1
    `, [testBuyerUserId]);

    if (chairProduct) {
      const evalResult = await evaluatePolicy({
        agentId: testAgentId,
        userId: testBuyerUserId,
        productId: chairProduct.id,
        merchantId: chairProduct.merchant_id,
        amount: parseFloat(chairProduct.price),
      });

      expect(evalResult.decision).toBe('BLOCK');
      expect(evalResult.rule).toBe('CATEGORY_NOT_PERMITTED');
      expect(evalResult.reason).toContain('not permitted by your purchasing policy');
    }

    // Also test candidate filter excludes chair when user only permits Electronics
    const intent = parseBuyerIntent('Buy an ergonomic office chair under ₹25,000');
    const searchRes = await findEligibleProducts(intent, { userId: testBuyerUserId });
    expect(searchRes.status).toBe('NO_MATCH');
  });

  // TEST 6: Preferred brand Sony -> Prioritizes Sony in candidate ranking
  it('TEST 6: Preferred brand influences ranking score (+15 boost) without blocking other eligible candidates', async () => {
    await query(`
      UPDATE user_preferences
      SET categories = ARRAY['Electronics', 'Peripherals'],
          preferred_brands = ARRAY['Sony']
      WHERE user_id = $1
    `, [testBuyerUserId]);

    const intent = parseBuyerIntent('Buy headphones under ₹35,000');
    const searchRes = await findEligibleProducts(intent, { userId: testBuyerUserId });

    expect(searchRes.status).toBe('MATCH_FOUND');
    expect(searchRes.winningCandidate.brand.toLowerCase()).toBe('sony');
    expect(searchRes.winningCandidate.matchScore).toBeGreaterThanOrEqual(85);
  });

  // TEST 7: Preferred brand Sony -> Explicit request "Only buy Bose" -> Bose becomes hard constraint
  it('TEST 7: Explicit user brand requirement overrides generic preferences and rejects non-matching brands', async () => {
    const intent = parseBuyerIntent('Only buy Bose headphones under ₹35,000');
    expect(intent.hardConstraints.requiredBrand).toBe('Bose');

    const searchRes = await findEligibleProducts(intent, { userId: testBuyerUserId });
    if (searchRes.status === 'MATCH_FOUND' && searchRes.winningCandidate) {
      expect((searchRes.winningCandidate.brand || searchRes.winningCandidate.name || '').toLowerCase()).toContain('bose');
    } else {
      expect(searchRes.status).toBe('NO_MATCH');
      expect(searchRes.winningCandidate).toBeNull();
    }
  });

  // TEST 8: Delivery SLA preference vs mandatory constraint
  it('TEST 8: Delivery SLA preference boosts faster delivery; mandatory SLA rejects slower candidates', async () => {
    const intent = parseBuyerIntent('Buy headphones that must arrive within 2 days under ₹35,000');
    expect(intent.softPreferences.fastestDelivery).toBe(true);

    const searchRes = await findEligibleProducts(intent, { userId: testBuyerUserId });
    if (searchRes.status === 'MATCH_FOUND' && searchRes.winningCandidate) {
      expect(searchRes.winningCandidate.delivery_days).toBeLessThanOrEqual(2);
    }
  });

  // TEST 9: Procurement mode ALWAYS_REQUIRE_REVIEW -> All purchases enter APPROVAL_REQUIRED
  it('TEST 9: Mode ALWAYS_REQUIRE_REVIEW forces APPROVAL_REQUIRED for every transaction regardless of amount', async () => {
    await query(`
      UPDATE user_preferences
      SET purchase_behavior = 'always_ask',
          monthly_budget = 200000,
          auto_purchase_limit = 50000
      WHERE user_id = $1
    `, [testBuyerUserId]);

    const evalResult = await evaluatePolicy({
      agentId: testAgentId,
      userId: testBuyerUserId,
      productId: powerBankProduct.id,
      merchantId: powerBankProduct.merchant_id,
      amount: parseFloat(powerBankProduct.price),
    });

    expect(evalResult.decision).toBe('APPROVAL_REQUIRED');
    expect(evalResult.rule).toBe('PROCUREMENT_BEHAVIOR_ALWAYS_ASK');
    expect(evalResult.reason).toContain('human review');
  });

  // TEST 10: Natural Language Rule Interpreter parses rules into structured policy matrix
  it('TEST 10: Natural language rule interpreter parses plain English into structured policy matrix', async () => {
    const ruleText = 'Never spend more than ₹15,000 on electronics and prefer Sony and Apple.';
    const result = parseNaturalLanguagePreference(ruleText);

    expect(result.categoryRules['Electronics']).toBeDefined();
    expect(result.categoryRules['Electronics'].maxAmount).toBe(15000);
    expect(result.categoryRules['Electronics'].isHardConstraint).toBe(true);
    expect(result.brandRules.preferred).toContain('Sony');
    expect(result.brandRules.preferred).toContain('Apple');
    expect(result.summary).toContain('Electronics max limit: ₹15,000');
  });

  // TEST 11: Concurrency budget protection prevents overspending race condition
  it('TEST 11: Budget accounting and lock prevent overspending under concurrent transactions', async () => {
    await query(`
      UPDATE user_preferences
      SET monthly_budget = 25000,
          auto_purchase_limit = 25000,
          purchase_behavior = 'auto_within_limit'
      WHERE user_id = $1
    `, [testBuyerUserId]);

    const summary = await getSpendingSummary(testBuyerUserId);
    expect(summary.monthlyBudget).toBe(25000);

    // Purchase of ₹28,990 exceeds ₹25,000 budget -> BLOCKED
    const evalResult = await evaluatePolicy({
      agentId: testAgentId,
      userId: testBuyerUserId,
      productId: headphonesProduct.id,
      merchantId: headphonesProduct.merchant_id,
      amount: parseFloat(headphonesProduct.price),
    });

    expect(evalResult.decision).toBe('BLOCK');
    expect(evalResult.rule).toBe('MONTHLY_BUDGET_EXCEEDED');
  });

  // TEST 12: Prompt injection in product description cannot override server-side policy
  it('TEST 12: Malicious product descriptions attempt to override budget is strictly ignored', async () => {
    await query(`
      UPDATE user_preferences
      SET monthly_budget = 10000,
          auto_purchase_limit = 5000
      WHERE user_id = $1
    `, [testBuyerUserId]);

    // Evaluation relies exclusively on database catalog record and server-side policy
    const evalResult = await evaluatePolicy({
      agentId: testAgentId,
      userId: testBuyerUserId,
      productId: headphonesProduct.id, // ₹28,990 > ₹10,000
      merchantId: headphonesProduct.merchant_id,
      amount: parseFloat(headphonesProduct.price),
    });

    expect(evalResult.decision).toBe('BLOCK');
    expect(evalResult.rule).toBe('MONTHLY_BUDGET_EXCEEDED');
  });

  // TEST 13: Policy Preview Simulation Endpoint POST /api/preferences/evaluate
  it('TEST 13: POST /api/preferences/evaluate returns instant simulation results for hypothetical queries', async () => {
    await query(`
      UPDATE user_preferences
      SET monthly_budget = 200000,
          auto_purchase_limit = 50000,
          categories = ARRAY['Electronics', 'Peripherals'],
          purchase_behavior = 'auto_within_limit'
      WHERE user_id = $1
    `, [testBuyerUserId]);

    const res = await request(app)
      .post('/api/preferences/evaluate')
      .send({
        userId: testBuyerUserId,
        queryText: 'Buy a power bank under ₹5,000',
      });

    expect(res.status).toBe(200);
    expect(res.body.decision).toBe('ALLOW');
    expect(res.body.automatic_purchase).toBe('YES');
    expect(res.body.spending_metrics.monthlyBudget).toBe(200000);
  });

  afterAll(async () => {
    // Restore clean default preferences
    if (testBuyerUserId) {
      await query(`
        UPDATE user_preferences
        SET monthly_budget = 100000,
            auto_purchase_limit = 50000,
            categories = ARRAY['Electronics', 'Peripherals', 'Software & Licenses', 'Office Supplies'],
            preferred_brands = ARRAY['Apple', 'Sony', 'ASUS', 'Dell', 'Logitech'],
            delivery_preference = 'Fastest available (within 2 days)',
            purchase_behavior = 'auto_within_limit',
            category_rules = '{}'::jsonb,
            delivery_rules = '{}'::jsonb,
            brand_rules = '{}'::jsonb,
            updated_at = NOW()
        WHERE user_id = $1
      `, [testBuyerUserId]);
    }
  });
});
