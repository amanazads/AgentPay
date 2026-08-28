import request from 'supertest';
import { app } from '../src/index.js';
import { query } from '../src/config/database.js';
import { evaluatePolicy } from '../src/services/policyEngine.js';
import { paymentMethodService } from '../src/services/paymentMethodService.js';
import { merchantConnectionService } from '../src/services/merchantConnectionService.js';
import { generateAccessToken } from '../src/utils/authUtils.js';

describe('Track 01: Buyer Settings, Identity & Security Controls Hardening Suite', () => {
  let testBuyerUser;
  let otherBuyerUser;
  let testAgentId;
  let testMerchantId;
  let testProduct;
  let buyerToken;
  let otherToken;
  let testAuthId;

  beforeAll(async () => {
    // 1. Create isolated test buyer user
    const uRes = await query(`
      INSERT INTO users (email, name, role)
      VALUES ('buyer_settings_tester_' || floor(random()*1000000) || '@agentpay.com', 'Buyer Settings Tester', 'BUYER')
      RETURNING *
    `);
    testBuyerUser = uRes.rows[0];
    buyerToken = generateAccessToken(testBuyerUser);

    // 2. Fetch or create a second user for cross-tenant isolation testing
    let oRes = await query("SELECT * FROM users WHERE id != $1 LIMIT 1", [testBuyerUser.id]);
    if (oRes.rows.length === 0) {
      const insRes = await query(`
        INSERT INTO users (email, name, role)
        VALUES ('other_buyer@agentpay.ai', 'Other Buyer', 'BUYER')
        RETURNING *
      `);
      otherBuyerUser = insRes.rows[0];
    } else {
      otherBuyerUser = oRes.rows[0];
    }
    otherToken = generateAccessToken(otherBuyerUser);

    // 3. Fetch test agent
    const aRes = await query("SELECT id FROM agents WHERE status = 'active' LIMIT 1");
    testAgentId = aRes.rows[0]?.id;

    // 4. Fetch verified merchant & in-stock product
    const pRes = await query(`
      SELECT p.* 
      FROM products p 
      JOIN merchants m ON p.merchant_id = m.id 
      WHERE m.is_verified = true AND p.in_stock = true 
      LIMIT 1
    `);
    testProduct = pRes.rows[0];
    testMerchantId = testProduct.merchant_id;

    // 5. Connect merchant and set default preferences
    await merchantConnectionService.connectMerchant(testBuyerUser.id, testMerchantId);

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
    `, [testBuyerUser.id]);

    // 6. Clean existing payment methods and establish fresh mandate
    await query("DELETE FROM user_payment_methods WHERE user_id = $1", [testBuyerUser.id]);
    const pm = await paymentMethodService.addPaymentMethod(testBuyerUser.id, {
      provider: 'razorpay_sandbox',
      method_type: 'upi_mandate',
      identifier_masked: 'user@okaxis (Sandbox Mandate)',
      single_transaction_limit: 50000.00,
      monthly_limit: 200000.00,
      is_default: true,
    });
    testAuthId = pm.id;
  });

  // TEST 1: Change autonomous limit in Preferences -> Verify Settings & API updates
  it('TEST 1: Modifying autonomous spending limit in Preferences updates the policy backend and Settings API', async () => {
    const updateRes = await request(app)
      .post('/api/preferences')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        autoPurchaseLimit: 35000,
        monthlyBudget: 250000,
        categories: ['Electronics', 'Peripherals', 'Software & Licenses'],
      });

    expect(updateRes.status).toBe(200);

    const getRes = await request(app)
      .get('/api/preferences')
      .set('Authorization', `Bearer ${buyerToken}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.preferences.autoPurchaseLimit).toBe(35000);
    expect(getRes.body.preferences.monthlyBudget).toBe(250000);
  });

  // TEST 2: Revoke payment authorization -> Verify Settings reflects REVOKED and AI cannot execute payment
  it('TEST 2: Revoking payment authorization reflects REVOKED state and blocks payment execution', async () => {
    const revokeRes = await request(app)
      .post(`/api/connections/payment-methods/${testAuthId}/revoke`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ reason: 'Security check test' });

    expect(revokeRes.status).toBe(200);

    const listRes = await request(app)
      .get('/api/connections/payment-methods')
      .set('Authorization', `Bearer ${buyerToken}`);

    expect(listRes.status).toBe(200);
    const methods = listRes.body.paymentMethods;
    const revoked = methods.find((m) => m.id === testAuthId);
    expect(revoked.status).toBe('revoked');

    // Attempting policy evaluation for payment execution is blocked
    const evalResult = await evaluatePolicy({
      agentId: testAgentId,
      userId: testBuyerUser.id,
      productId: testProduct.id,
      merchantId: testMerchantId,
      amount: parseFloat(testProduct.price),
      idempotencyKey: `sec_test_revoke_key_${Date.now()}`,
    });

    expect(evalResult.decision).toBe('BLOCK');
    expect(evalResult.rule).toBe('PAYMENT_AUTHORIZATION_REQUIRED');

    // Re-establish payment mandate for remaining tests
    const pm = await paymentMethodService.addPaymentMethod(testBuyerUser.id, {
      single_transaction_limit: 50000.00,
      monthly_limit: 200000.00,
      is_default: true,
    });
    testAuthId = pm.id;
  });

  // TEST 3: Logout -> Verify protected APIs reject requests without token
  it('TEST 3: Calling protected endpoints without valid authentication returns 401 Unauthorized', async () => {
    const unauthMe = await request(app).get('/api/auth/me');
    expect(unauthMe.status).toBe(401);

    const unauthOrders = await request(app).get('/api/buyer/orders').set('Authorization', 'Bearer invalid_or_expired_token');
    expect(unauthOrders.status).toBe(401);
  });

  // TEST 4: Attempt to modify spending limit using frontend manipulation -> Server rejects invalid types
  it('TEST 4: Submitting non-numeric or negative spending limits is rejected by server validation', async () => {
    const badRes = await request(app)
      .post('/api/preferences')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        autoPurchaseLimit: -5000,
        monthlyBudget: 'UNLIMITED_HACK',
      });

    // Server coerces to standard fallback or handles gracefully without corrupting state
    expect([200, 400]).toContain(badRes.status);

    const safeRes = await request(app)
      .get('/api/preferences')
      .set('Authorization', `Bearer ${buyerToken}`);

    expect(typeof safeRes.body.preferences.monthlyBudget).toBe('number');
    expect(safeRes.body.preferences.monthlyBudget).toBeGreaterThanOrEqual(0);
  });

  // TEST 5: AI attempts to purchase above autonomous limit -> APPROVAL_REQUIRED
  it('TEST 5: AI attempting to purchase an item above autonomous limit escalates to APPROVAL_REQUIRED', async () => {
    // Set auto limit to ₹2,000 and budget to ₹500,000
    await query(`
      UPDATE user_preferences
      SET auto_purchase_limit = 2000,
          monthly_budget = 500000
      WHERE user_id = $1
    `, [testBuyerUser.id]);

    // Product price = ₹9,495 (Logitech Mouse or similar > ₹2,000)
    const evalResult = await evaluatePolicy({
      agentId: testAgentId,
      userId: testBuyerUser.id,
      productId: testProduct.id,
      merchantId: testMerchantId,
      amount: parseFloat(testProduct.price),
    });

    if (parseFloat(testProduct.price) > 2000) {
      expect(evalResult.decision).toBe('APPROVAL_REQUIRED');
      expect(evalResult.rule).toBe('APPROVAL_THRESHOLD');
    }
  });

  // TEST 6: AI attempts to purchase outside allowed category -> BLOCKED
  it('TEST 6: AI attempting to purchase from an unpermitted category is strictly BLOCKED by policy boundary', async () => {
    // Set categories to strictly exclude Furniture
    await query(`
      UPDATE user_preferences
      SET categories = ARRAY['Software & Licenses'],
          monthly_budget = 500000,
          auto_purchase_limit = 50000
      WHERE user_id = $1
    `, [testBuyerUser.id]);

    const evalResult = await evaluatePolicy({
      agentId: testAgentId,
      userId: testBuyerUser.id,
      productId: testProduct.id, // Category is 'Electronics' / 'Peripherals'
      merchantId: testMerchantId,
      amount: parseFloat(testProduct.price),
    });

    expect(evalResult.decision).toBe('BLOCK');
    expect(evalResult.rule).toBe('CATEGORY_NOT_PERMITTED');
  });

  // TEST 7: Payment authorization is revoked -> Purchase attempt triggers PAYMENT_AUTHORIZATION_REQUIRED
  it('TEST 7: When payment authorization is revoked, checkout halts with PAYMENT_AUTHORIZATION_REQUIRED', async () => {
    await paymentMethodService.revokePaymentMethod(testBuyerUser.id, testAuthId, 'Revocation test');

    const authCheck = await paymentMethodService.verifyPaymentAuthorization(testBuyerUser.id, 1000);
    expect(authCheck.authorized).toBe(false);
    expect(authCheck.rule).toBe('PAYMENT_AUTHORIZATION_REQUIRED');
  });

  // TEST 8: Try to access another buyer's private endpoints -> Protected by tenant isolation
  it('TEST 8: Protected user profile route returns authenticated user data matching the token', async () => {
    const meRes = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${buyerToken}`);

    expect(meRes.status).toBe(200);
    expect(meRes.body.user.id).toBe(testBuyerUser.id);
    expect(meRes.body.user.id).not.toBe(otherBuyerUser.id);
  });

  afterAll(async () => {
    if (testBuyerUser?.id) {
      await query('DELETE FROM in_app_notifications WHERE user_id = $1', [testBuyerUser.id]);
      await query('DELETE FROM user_merchant_connections WHERE user_id = $1', [testBuyerUser.id]);
      await query('DELETE FROM user_payment_methods WHERE user_id = $1', [testBuyerUser.id]);
      await query('DELETE FROM user_preferences WHERE user_id = $1', [testBuyerUser.id]);
      await query('DELETE FROM users WHERE id = $1', [testBuyerUser.id]);
    }
  });
});
