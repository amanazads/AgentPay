import crypto from 'crypto';
import Razorpay from 'razorpay';
import env from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * Base Payment Provider Interface
 */
export class PaymentProvider {
  constructor(config = {}) {
    this.environment = config.environment || 'TEST'; // 'TEST' | 'LIVE'
    this.keyId = config.keyId || '';
    this.keySecret = config.keySecret || '';
    this.webhookSecret = config.webhookSecret || '';
  }

  async createOrder(params) {
    throw new Error('createOrder() must be implemented by payment provider');
  }

  async verifyPayment(params) {
    throw new Error('verifyPayment() must be implemented by payment provider');
  }

  async capturePayment(params) {
    throw new Error('capturePayment() must be implemented by payment provider');
  }

  async refundPayment(params) {
    throw new Error('refundPayment() must be implemented by payment provider');
  }

  async fetchPayment(paymentId) {
    throw new Error('fetchPayment() must be implemented by payment provider');
  }

  async fetchOrder(orderId) {
    throw new Error('fetchOrder() must be implemented by payment provider');
  }

  verifyWebhookSignature({ rawBody, signature }) {
    if (!this.webhookSecret) {
      throw new Error(`Webhook secret not configured for ${this.environment} mode`);
    }
    if (!signature || typeof signature !== 'string') {
      return false;
    }
    const expectedSignature = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody))
      .digest('hex');

    const expectedBuf = Buffer.from(expectedSignature, 'utf8');
    const sigBuf = Buffer.from(signature, 'utf8');
    if (expectedBuf.length !== sigBuf.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuf, sigBuf);
  }
}

/**
 * Razorpay Test Provider (Isolated Sandbox Payment Rails)
 */
export class RazorpayTestProvider extends PaymentProvider {
  constructor(customConfig = null) {
    const keyId = customConfig?.keyId || env.RAZORPAY_TEST_KEY_ID;
    const keySecret = customConfig?.keySecret || env.RAZORPAY_TEST_KEY_SECRET;
    const webhookSecret = customConfig?.webhookSecret || env.RAZORPAY_TEST_WEBHOOK_SECRET;

    super({
      environment: 'TEST',
      keyId,
      keySecret,
      webhookSecret,
    });

    this.client = null;

    // Reject live keys in test provider to prevent accidental cross-rail execution
    if (this.keyId && this.keyId.startsWith('rzp_live_')) {
      logger.error('Payment', 'SECURITY ALERT: Live credentials passed to RazorpayTestProvider. Refusing to initialize live key in test provider.');
      throw new Error('SECURITY VIOLATION: Live credentials (rzp_live_*) cannot be passed to RazorpayTestProvider.');
    }

    if (this.keyId && this.keySecret && !this.keyId.startsWith('rzp_live_')) {
      try {
        this.client = new Razorpay({
          key_id: this.keyId,
          key_secret: this.keySecret,
        });
      } catch (err) {
        logger.warn('Payment', 'Razorpay Test client initialization failed, using local order simulator:', err.message);
      }
    }
  }

  async createOrder({ amount, currency = 'INR', receipt, notes = {}, environment = 'TEST' }) {
    if (environment === 'LIVE' || notes?.environment === 'LIVE') {
      throw new Error('SECURITY VIOLATION: Attempted to process a LIVE payment through Razorpay TEST provider. Execution halted.');
    }

    const amountInPaise = Math.round(amount * 100);

    if (this.client) {
      try {
        const order = await this.client.orders.create({
          amount: amountInPaise,
          currency,
          receipt: receipt || `rcpt_test_${Date.now()}`,
          notes: { ...notes, environment: 'TEST', payment_mode: 'TEST' },
        });
        return {
          orderId: order.id,
          amount: amount,
          amountInPaise,
          currency,
          environment: 'TEST',
          keyId: this.keyId,
        };
      } catch (e) {
        logger.warn('Payment', 'Razorpay test API failed, falling back to deterministic test order:', e.message);
      }
    }

    const localOrderId = `order_${crypto.randomBytes(8).toString('hex')}`;
    return {
      orderId: localOrderId,
      amount,
      amountInPaise,
      currency,
      environment: 'TEST',
      keyId: this.keyId,
    };
  }

  async verifyPayment({ orderId, paymentId, signature }) {
    if (!this.keySecret) {
      logger.warn('Payment', 'No key secret configured for test provider — skipping HMAC verification.');
      return { verified: true, environment: 'TEST' };
    }

    if (!signature || typeof signature !== 'string') {
      return { verified: false, environment: 'TEST', error: 'Missing or invalid signature' };
    }

    const body = `${orderId}|${paymentId}`;
    const expectedSignature = crypto
      .createHmac('sha256', this.keySecret)
      .update(body)
      .digest('hex');

    const expectedBuf = Buffer.from(expectedSignature, 'utf8');
    const sigBuf = Buffer.from(signature, 'utf8');
    const isValid = expectedBuf.length === sigBuf.length && crypto.timingSafeEqual(expectedBuf, sigBuf);

    return { verified: isValid, environment: 'TEST' };
  }

  async capturePayment({ paymentId, amount, currency = 'INR' }) {
    if (this.client && paymentId && !paymentId.startsWith('pay_test_')) {
      try {
        const res = await this.client.payments.capture(paymentId, Math.round(amount * 100), currency);
        return { success: true, captureId: res.id, status: 'CAPTURED', environment: 'TEST' };
      } catch (err) {
        logger.warn('Payment', 'Razorpay test capture warning:', err.message);
      }
    }
    return { success: true, captureId: `cap_test_${paymentId}`, status: 'CAPTURED', environment: 'TEST' };
  }

  async refundPayment({ paymentId, amount, notes = {} }) {
    if (this.client && paymentId && !paymentId.startsWith('pay_test_')) {
      try {
        const res = await this.client.payments.refund(paymentId, {
          amount: amount ? Math.round(amount * 100) : undefined,
          notes: { ...notes, environment: 'TEST' },
        });
        return { refundId: res.id, status: 'REFUNDED', amount, environment: 'TEST' };
      } catch (err) {
        logger.warn('Payment', 'Razorpay test refund API warning:', err.message);
      }
    }
    return {
      refundId: `rfnd_test_${crypto.randomBytes(8).toString('hex')}`,
      status: 'REFUNDED',
      amount,
      environment: 'TEST',
    };
  }

  async fetchPayment(paymentId) {
    if (this.client && paymentId && !paymentId.startsWith('pay_test_')) {
      try {
        const res = await this.client.payments.fetch(paymentId);
        return { ...res, environment: 'TEST' };
      } catch (err) {
        // Return structured test object
      }
    }
    return {
      id: paymentId,
      status: 'captured',
      amount: 100000,
      currency: 'INR',
      method: 'card',
      environment: 'TEST',
    };
  }

  async fetchOrder(orderId) {
    if (this.client && orderId && !orderId.startsWith('order_test_')) {
      try {
        const res = await this.client.orders.fetch(orderId);
        return { ...res, environment: 'TEST' };
      } catch (err) {
        // Return fallback
      }
    }
    return { id: orderId, status: 'paid', environment: 'TEST' };
  }
}

/**
 * Razorpay Live Production Provider (Governed Real-Money Rails)
 */
export class RazorpayLiveProvider extends PaymentProvider {
  constructor(customConfig = null) {
    const keyId = customConfig?.keyId || env.RAZORPAY_LIVE_KEY_ID;
    const keySecret = customConfig?.keySecret || env.RAZORPAY_LIVE_KEY_SECRET;
    const webhookSecret = customConfig?.webhookSecret || env.RAZORPAY_LIVE_WEBHOOK_SECRET;

    super({
      environment: 'LIVE',
      keyId,
      keySecret,
      webhookSecret,
    });

    if (!this.keyId || !this.keySecret || !this.keyId.startsWith('rzp_live_') || this.keyId.startsWith('rzp_test_')) {
      if (env.isLiveMode) {
        logger.error('Payment', 'SECURITY ALERT: Razorpay LIVE credentials missing or invalid key format provided for LIVE mode.');
      }
      this.client = null;
    } else {
      this.client = new Razorpay({
        key_id: this.keyId,
        key_secret: this.keySecret,
      });
    }
  }

  assertLiveConfigured() {
    if (!this.client || !this.keyId || !this.keyId.startsWith('rzp_live_')) {
      throw new Error('FATAL SECURITY LOCK: Razorpay LIVE mode is active but valid LIVE API credentials (starting with rzp_live_) are not configured. Fail closed.');
    }
  }

  async createOrder({ amount, currency = 'INR', receipt, notes = {}, environment = 'LIVE' }) {
    this.assertLiveConfigured();

    if (environment === 'TEST' || notes?.environment === 'TEST') {
      throw new Error('SECURITY VIOLATION: Attempted to process a TEST payment through Razorpay LIVE provider. Execution halted.');
    }

    const amountInPaise = Math.round(amount * 100);

    const order = await this.client.orders.create({
      amount: amountInPaise,
      currency,
      receipt: receipt || `rcpt_live_${Date.now()}`,
      notes: { ...notes, environment: 'LIVE', payment_mode: 'LIVE' },
    });

    return {
      orderId: order.id,
      amount,
      amountInPaise,
      currency,
      environment: 'LIVE',
      keyId: this.keyId,
    };
  }

  async verifyPayment({ orderId, paymentId, signature }) {
    this.assertLiveConfigured();

    if (!signature) {
      return { verified: false, error: 'Signature missing from live payment callback', environment: 'LIVE' };
    }

    const body = `${orderId}|${paymentId}`;
    const expectedSignature = crypto
      .createHmac('sha256', this.keySecret)
      .update(body)
      .digest('hex');

    const expectedBuf = Buffer.from(expectedSignature, 'utf8');
    const sigBuf = Buffer.from(signature, 'utf8');
    const isValid = expectedBuf.length === sigBuf.length && crypto.timingSafeEqual(expectedBuf, sigBuf);

    return { verified: isValid, environment: 'LIVE' };
  }

  async capturePayment({ paymentId, amount, currency = 'INR' }) {
    this.assertLiveConfigured();
    const res = await this.client.payments.capture(paymentId, Math.round(amount * 100), currency);
    return { success: true, captureId: res.id, status: 'CAPTURED', environment: 'LIVE' };
  }

  async refundPayment({ paymentId, amount, notes = {}, speed = 'normal' }) {
    this.assertLiveConfigured();
    const res = await this.client.payments.refund(paymentId, {
      amount: amount ? Math.round(amount * 100) : undefined,
      notes: { ...notes, environment: 'LIVE' },
      speed,
    });
    return { refundId: res.id, status: 'REFUNDED', amount, environment: 'LIVE' };
  }

  async fetchPayment(paymentId) {
    this.assertLiveConfigured();
    const res = await this.client.payments.fetch(paymentId);
    return { ...res, environment: 'LIVE' };
  }

  async fetchOrder(orderId) {
    this.assertLiveConfigured();
    const res = await this.client.orders.fetch(orderId);
    return { ...res, environment: 'LIVE' };
  }
}

// Singleton instances
export const razorpayTestProvider = new RazorpayTestProvider();
export const razorpayLiveProvider = new RazorpayLiveProvider();

/**
 * Returns the authoritative payment provider based on backend configuration or target mode
 */
export function getPaymentProvider(mode = env.PAYMENT_MODE) {
  if (mode === 'live' || (env.isLiveMode && mode !== 'test')) {
    return razorpayLiveProvider;
  }
  return razorpayTestProvider;
}

export default {
  PaymentProvider,
  RazorpayTestProvider,
  RazorpayLiveProvider,
  razorpayTestProvider,
  razorpayLiveProvider,
  getPaymentProvider,
};
