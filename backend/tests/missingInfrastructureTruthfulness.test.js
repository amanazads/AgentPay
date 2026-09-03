import { jest } from '@jest/globals';
import request from 'supertest';
import crypto from 'crypto';
import { app } from '../src/index.js';
import { query } from '../src/config/database.js';
import env from '../src/config/env.js';
import { generateAccessToken } from '../src/utils/authUtils.js';
import {
  RazorpayTestProvider,
  RazorpayLiveProvider,
  getPaymentProvider,
} from '../src/services/paymentProvider.js';
import { createPaymentOrder, verifyPayment } from '../src/services/paymentService.js';
import { processRazorpayWebhook, WebhookProcessingStates } from '../src/services/webhookService.js';
import { generateQuote } from '../src/services/quoteService.js';
import { merchantConnectionService } from '../src/services/merchantConnectionService.js';
import { paymentMethodService } from '../src/services/paymentMethodService.js';
import { PurchaseStates } from '../src/services/purchaseStateMachine.js';

jest.setTimeout(30000);

describe('Track 04: Missing Infrastructure & Demo Truthfulness Audit Suite', () => {
  let buyerUser, buyerToken;
  let merchantId;
  let verifiedProduct;

  beforeAll(async () => {
    // 1. Setup buyer
    const uRes = await query(`
      INSERT INTO users (email, name, role)
      VALUES ('truthfulness_buyer_' || floor(random()*1000000) || '@agentpay.com', 'Demo Truthfulness Buyer', 'BUYER')
      RETURNING *
    `);
    buyerUser = uRes.rows[0];
    buyerToken = generateAccessToken(buyerUser);

    // 2. Setup verified merchant
    const mRes = await query(`
      INSERT INTO merchants (name, category, description, is_verified, rating, tier)
      VALUES ('Truthful Hardware Store ' || floor(random()*100000), 'Electronics', 'Verified Hardware', true, 4.9, 'tier_1')
      RETURNING id
    `);
    merchantId = mRes.rows[0].id;

    // 3. Setup verified in-stock product
    const pRes = await query(`
      INSERT INTO products (merchant_id, name, description, brand, category, product_type, price, inventory, in_stock, is_test_lab, commerce_eligible)
      VALUES ($1, 'Truthful NVMe SSD 2TB', 'High speed SSD', 'Samsung', 'Electronics', 'storage', 14500.00, 25, true, false, true)
      RETURNING *
    `, [merchantId]);
    verifiedProduct = pRes.rows[0];
  });

  afterAll(async () => {
    // Ensure kill switch is turned OFF
    await query('UPDATE system_state SET kill_switch_active = false WHERE id = 1');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // CASE A: New buyer with no merchant configuration
  // ──────────────────────────────────────────────────────────────────────────
  describe('Case A: New buyer with no merchant configuration', () => {
    let unconfiguredBuyer, unconfiguredToken;

    beforeAll(async () => {
      const uRes = await query(`
        INSERT INTO users (email, name, role)
        VALUES ('unconf_buyer_' || floor(random()*1000000) || '@agentpay.com', 'Unconfigured Buyer', 'BUYER')
        RETURNING *
      `);
      unconfiguredBuyer = uRes.rows[0];
      unconfiguredToken = generateAccessToken(unconfiguredBuyer);
    });

    test('getUserConnections returns NOT_CONNECTED with checkoutStatus UNAVAILABLE for unconfigured buyer', async () => {
      const connections = await merchantConnectionService.getUserConnections(unconfiguredBuyer.id);
      const targetStore = connections.find(c => c.merchantId === merchantId);

      expect(targetStore).toBeDefined();
      expect(targetStore.isConnected).toBe(false);
      expect(targetStore.connectionState).toBe('NOT_CONNECTED');
      expect(targetStore.checkoutStatus).toBe('UNAVAILABLE');
      expect(targetStore.accountIdentifier).toBeNull();
      expect(targetStore.credentialsRef).toBeNull();
      expect(targetStore.capabilities.checkout_api).toBe(false);
    });

    test('validateMerchantForCheckout returns allowed=false with code MERCHANT_NOT_CONFIGURED when requireConnection is set', async () => {
      const validation = await merchantConnectionService.validateMerchantForCheckout(
        unconfiguredBuyer.id,
        merchantId,
        { requireConnection: true }
      );

      expect(validation.allowed).toBe(false);
      expect(validation.code).toBe('MERCHANT_NOT_CONFIGURED');
      expect(validation.reason).toContain('is not configured or connected');
    });

    test('validateMerchantForCheckout returns allowed=false when merchant connection is explicitly disconnected', async () => {
      await merchantConnectionService.disconnectMerchant(unconfiguredBuyer.id, merchantId, 'Store disabled');
      const validation = await merchantConnectionService.validateMerchantForCheckout(
        unconfiguredBuyer.id,
        merchantId
      );

      expect(validation.allowed).toBe(false);
      expect(validation.code).toBe('MERCHANT_DISCONNECTED');
      expect(validation.reason).toContain('disconnected');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // CASE B: No connected payment credentials
  // ──────────────────────────────────────────────────────────────────────────
  describe('Case B: No connected payment credentials', () => {
    let noPaymentBuyer;

    beforeAll(async () => {
      const uRes = await query(`
        INSERT INTO users (email, name, role)
        VALUES ('nopay_buyer_' || floor(random()*1000000) || '@agentpay.com', 'No Payment Buyer', 'BUYER')
        RETURNING *
      `);
      noPaymentBuyer = uRes.rows[0];
      // Ensure zero records in user_payment_methods
      await query('DELETE FROM user_payment_methods WHERE user_id = $1', [noPaymentBuyer.id]);
    });

    test('getUserPaymentMethods returns empty array and does NOT auto-fabricate fake payment mandates', async () => {
      const methods = await paymentMethodService.getUserPaymentMethods(noPaymentBuyer.id, { skipAutoSeed: true });
      expect(Array.isArray(methods)).toBe(true);
      expect(methods.length).toBe(0);
    });

    test('verifyPaymentAuthorization returns authorized=false with PAYMENT_AUTHORIZATION_REQUIRED', async () => {
      const auth = await paymentMethodService.verifyPaymentAuthorization(noPaymentBuyer.id, 5000, { skipAutoSeed: true });
      expect(auth.authorized).toBe(false);
      expect(auth.rule).toBe('PAYMENT_AUTHORIZATION_REQUIRED');
      expect(auth.reason).toContain('No active payment mandate or payment authorization connected');
    });

    test('createPaymentOrder fails closed when buyer has no connected payment credentials', async () => {
      // Connect merchant so merchant gate passes
      await merchantConnectionService.connectMerchant(noPaymentBuyer.id, merchantId);

      const piRes = await query(`
        INSERT INTO purchase_intents (user_id, product_id, merchant_id, amount, quantity, status, state)
        VALUES ($1, $2, $3, 14500.00, 1, 'allowed', 'ALLOWED')
        RETURNING *
      `, [noPaymentBuyer.id, verifiedProduct.id, merchantId]);
      const intent = piRes.rows[0];

      await expect(
        createPaymentOrder({ purchaseIntentId: intent.id, skipAutoSeed: true })
      ).rejects.toThrow(/No active payment mandate or payment authorization connected/i);

      // Verify zero transactions created
      const txCheck = await query('SELECT * FROM transactions WHERE purchase_intent_id = $1', [intent.id]);
      expect(txCheck.rows.length).toBe(0);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // CASE C: Invalid Razorpay Test credentials
  // ──────────────────────────────────────────────────────────────────────────
  describe('Case C: Invalid Razorpay Test credentials', () => {
    test('RazorpayTestProvider rejects invalid test key format fail-closed with PAYMENT_GATEWAY_AUTH_FAILED', async () => {
      const provider = new RazorpayTestProvider({
        keyId: 'invalid_key_format_123',
        keySecret: 'valid_secret_123',
      });

      await expect(
        provider.createOrder({ amount: 1000, currency: 'INR' })
      ).rejects.toThrow(/Payment provider authentication failed/i);
    });

    test('RazorpayTestProvider rejects keys not starting with rzp_test_ in sandbox rails', async () => {
      const provider = new RazorpayTestProvider({
        keyId: 'other_test_key_12345',
        keySecret: 'secret_12345',
      });

      await expect(
        provider.createOrder({ amount: 1000, currency: 'INR' })
      ).rejects.toThrow(/Must be a valid test key starting with 'rzp_test_'/i);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // CASE D: Missing Razorpay credentials
  // ──────────────────────────────────────────────────────────────────────────
  describe('Case D: Missing Razorpay credentials', () => {
    test('createOrder throws PAYMENT_CREDENTIALS_MISSING when keyId or keySecret is missing', async () => {
      const providerNoKey = new RazorpayTestProvider({ keyId: null, keySecret: 'secret' });
      await expect(
        providerNoKey.createOrder({ amount: 1000 })
      ).rejects.toThrow(/Payment infrastructure unavailable: Razorpay Test credentials/i);

      const providerNoSecret = new RazorpayTestProvider({ keyId: 'rzp_test_12345678', keySecret: null });
      await expect(
        providerNoSecret.createOrder({ amount: 1000 })
      ).rejects.toThrow(/Payment infrastructure unavailable: Razorpay Test credentials/i);
    });

    test('verifyPayment throws PAYMENT_CREDENTIALS_MISSING and refuses to skip HMAC check when keySecret is missing', async () => {
      const provider = new RazorpayTestProvider({ keyId: 'rzp_test_12345678', keySecret: null });
      await expect(
        provider.verifyPayment({ orderId: 'order_123', paymentId: 'pay_123', signature: 'some_sig' })
      ).rejects.toThrow(/Payment verification unavailable: RAZORPAY_TEST_KEY_SECRET is not configured/i);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // CASE E: Missing webhook secret
  // ──────────────────────────────────────────────────────────────────────────
  describe('Case E: Missing webhook secret and signature validation', () => {
    test('processRazorpayWebhook throws WEBHOOK_SECRET_MISSING when webhook secret is empty or missing', async () => {
      // Temporarily unset env.RAZORPAY_TEST_WEBHOOK_SECRET
      const origSecret = env.RAZORPAY_TEST_WEBHOOK_SECRET;
      env.RAZORPAY_TEST_WEBHOOK_SECRET = '';

      try {
        await expect(
          processRazorpayWebhook({
            environment: 'TEST',
            signature: 'sig_123',
            rawBody: '{}',
            payload: { event: 'payment.captured' },
          })
        ).rejects.toThrow(/Webhook infrastructure unavailable: Razorpay TEST webhook secret is not configured/i);
      } finally {
        env.RAZORPAY_TEST_WEBHOOK_SECRET = origSecret;
      }
    });

    test('processRazorpayWebhook rejects webhook with missing signature header fail-closed', async () => {
      await expect(
        processRazorpayWebhook({
          environment: 'TEST',
          signature: null,
          rawBody: '{}',
          payload: { event: 'payment.captured' },
          requireSignature: true,
        })
      ).rejects.toThrow(/Missing x-razorpay-signature header/i);
    });

    test('processRazorpayWebhook rejects invalid / tampered HMAC signature fail-closed', async () => {
      await expect(
        processRazorpayWebhook({
          environment: 'TEST',
          signature: 'invalid_tampered_hmac_hex_string_1234567890',
          rawBody: '{"event":"payment.captured"}',
          payload: { event: 'payment.captured' },
        })
      ).rejects.toThrow(/HMAC signature verification failed/i);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // CASE F: Razorpay API failure
  // ──────────────────────────────────────────────────────────────────────────
  describe('Case F: Razorpay API failure', () => {
    test('RazorpayTestProvider throws PAYMENT_GATEWAY_UNAVAILABLE when mockApiFailure is active', async () => {
      const provider = new RazorpayTestProvider({
        keyId: 'rzp_test_12345678',
        keySecret: 'secret_12345678',
        mockApiFailure: true,
      });

      await expect(
        provider.createOrder({ amount: 2500 })
      ).rejects.toThrow(/Razorpay Test API failure: Gateway connection timeout/i);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // CASE G: Payment verification failure
  // ──────────────────────────────────────────────────────────────────────────
  describe('Case G: Payment verification failure', () => {
    test('Payment verification failure marks transaction failed, state PAYMENT_FAILED, and releases inventory', async () => {
      // 1. Buyer with connected store and mandate
      await merchantConnectionService.connectMerchant(buyerUser.id, merchantId);
      await paymentMethodService.addPaymentMethod(buyerUser.id, {
        single_transaction_limit: 100000.00,
        monthly_limit: 500000.00,
        is_default: true,
      });

      // 2. Generate valid quote
      const quote = await generateQuote({
        productId: verifiedProduct.id,
        quantity: 1,
        userId: buyerUser.id,
        reserveStock: true,
      });

      // 3. Create purchase intent and order
      const piRes = await query(`
        INSERT INTO purchase_intents (user_id, product_id, merchant_id, amount, quantity, status, state, quote_id)
        VALUES ($1, $2, $3, $4, 1, 'allowed', 'ALLOWED', $5)
        RETURNING *
      `, [buyerUser.id, verifiedProduct.id, merchantId, quote.totalAmount, quote.quoteId]);
      const intent = piRes.rows[0];

      const paymentOrder = await createPaymentOrder({
        purchaseIntentId: intent.id,
        quoteId: quote.quoteId,
      });

      // 4. Verification with tampered signature
      await expect(
        verifyPayment({
          transactionId: paymentOrder.transactionId,
          razorpayOrderId: paymentOrder.orderId,
          razorpayPaymentId: 'pay_test_tampered_123',
          razorpaySignature: 'tampered_bad_signature_hex_00000000000000000000000000000000',
          quoteId: quote.quoteId,
        })
      ).rejects.toThrow(/Payment signature verification failed/i);

      // 5. Verify database state is PAYMENT_FAILED and transaction is failed
      const txRes = await query('SELECT * FROM transactions WHERE id = $1', [paymentOrder.transactionId]);
      expect(txRes.rows[0].status).toBe('failed');
      expect(txRes.rows[0].payment_verified).toBe(false);

      const piCheck = await query('SELECT * FROM purchase_intents WHERE id = $1', [intent.id]);
      expect(piCheck.rows[0].status).toBe('payment_failed');
      expect(piCheck.rows[0].state).toBe(PurchaseStates.PAYMENT_FAILED);

      // 6. Verify inventory reservation is RELEASED
      const resCheck = await query('SELECT * FROM inventory_reservations WHERE quote_id = $1', [quote.quoteId]);
      expect(resCheck.rows[0].status).toBe('RELEASED');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // CASE H: Merchant product unavailable
  // ──────────────────────────────────────────────────────────────────────────
  describe('Case H: Merchant product unavailable', () => {
    test('generateQuote rejects out-of-stock product with OUT_OF_STOCK error', async () => {
      // Create out-of-stock product
      const pRes = await query(`
        INSERT INTO products (merchant_id, name, description, brand, category, price, inventory, in_stock, is_test_lab, commerce_eligible)
        VALUES ($1, 'Sold Out GPU', 'High power GPU', 'Nvidia', 'Electronics', 85000.00, 0, false, false, true)
        RETURNING *
      `, [merchantId]);
      const soldOutProduct = pRes.rows[0];

      await expect(
        generateQuote({
          productId: soldOutProduct.id,
          quantity: 1,
          userId: buyerUser.id,
        })
      ).rejects.toThrow(/Insufficient stock for product/i);
    });

    test('generateQuote rejects commerce_eligible=false product with PRODUCT_INELIGIBLE error', async () => {
      const pRes = await query(`
        INSERT INTO products (merchant_id, name, description, brand, category, price, inventory, in_stock, is_test_lab, commerce_eligible)
        VALUES ($1, 'Internal Lab Sensor', 'Lab hardware', 'Bosch', 'Electronics', 5000.00, 10, true, false, false)
        RETURNING *
      `, [merchantId]);
      const ineligibleProduct = pRes.rows[0];

      await expect(
        generateQuote({
          productId: ineligibleProduct.id,
          quantity: 1,
          userId: buyerUser.id,
        })
      ).rejects.toThrow(/is ineligible for commerce/i);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // CASE I: Backend payment service unavailable
  // ──────────────────────────────────────────────────────────────────────────
  describe('Case I: Backend payment service unavailable', () => {
    test('createPaymentOrder returns HTTP 503 when emergency kill switch is active', async () => {
      // Activate kill switch
      await query('UPDATE system_state SET kill_switch_active = true WHERE id = 1');

      try {
        const piRes = await query(`
          INSERT INTO purchase_intents (user_id, product_id, merchant_id, amount, quantity, status, state)
          VALUES ($1, $2, $3, 14500.00, 1, 'allowed', 'ALLOWED')
          RETURNING *
        `, [buyerUser.id, verifiedProduct.id, merchantId]);
        const intent = piRes.rows[0];

        try {
          await createPaymentOrder({ purchaseIntentId: intent.id });
          throw new Error('Should have thrown 503');
        } catch (err) {
          expect(err.status).toBe(503);
          expect(err.message).toContain('Emergency kill switch is active');
        }
      } finally {
        // Reset kill switch
        await query('UPDATE system_state SET kill_switch_active = false WHERE id = 1');
      }
    });

    test('API endpoint returns HTTP 503 when kill switch is active', async () => {
      await query('UPDATE system_state SET kill_switch_active = true WHERE id = 1');

      try {
        const piRes = await query(`
          INSERT INTO purchase_intents (user_id, product_id, merchant_id, amount, quantity, status, state)
          VALUES ($1, $2, $3, 14500.00, 1, 'allowed', 'ALLOWED')
          RETURNING *
        `, [buyerUser.id, verifiedProduct.id, merchantId]);
        const intent = piRes.rows[0];

        const res = await request(app)
          .post('/api/payments/create-order')
          .set('Authorization', `Bearer ${buyerToken}`)
          .send({ purchase_intent_id: intent.id });

        expect(res.status).toBe(503);
        expect(res.body.error === 'KILL_SWITCH_ACTIVE' || res.body.message?.includes('Emergency kill switch')).toBe(true);
      } finally {
        await query('UPDATE system_state SET kill_switch_active = false WHERE id = 1');
      }
    });
  });
});
