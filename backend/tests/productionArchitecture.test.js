import request from 'supertest';
import express from 'express';
import systemRoutes from '../src/routes/system.js';
import webhookRoutes from '../src/routes/webhooks.js';
import aiRoutes from '../src/routes/ai.js';
import { getPaymentProvider, RazorpayLiveProvider, RazorpayTestProvider } from '../src/services/paymentProvider.js';
import { reserveInventory, releaseReservation, commitReservation } from '../src/services/inventoryService.js';
import { query } from '../src/config/database.js';

const app = express();
app.use(express.json());
app.use('/api/system', systemRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/ai', aiRoutes);

describe('Track 01: Production Live Architecture & Zero-Mixing Governance', () => {
  test('GET /api/system/environment returns authoritative environment descriptor', async () => {
    const res = await request(app).get('/api/system/environment');

    expect(res.status).toBe(200);
    expect(res.body.environment).toBeDefined();
    expect(res.body.paymentMode).toBeDefined();
    expect(res.body.platformCaps).toBeDefined();
    expect(res.body.platformCaps.maxSingleTransaction).toBe(25000);
    expect(res.body.platformCaps.maxDailyAutonomousTotal).toBe(50000);
    expect(res.body.activeKeyType).toBeDefined();
  });

  test('GET /api/system/readiness evaluates 27-point Go-Live Gate checklist', async () => {
    const res = await request(app).get('/api/system/readiness');

    expect(res.status).toBe(200);
    expect(res.body.readinessScore).toBeGreaterThanOrEqual(80);
    expect(res.body.checklist.length).toBeGreaterThanOrEqual(20);
    expect(res.body.checklist.some((c) => c.id === 'GOV_PRICE_SURGE' && c.status === 'READY')).toBe(true);
    expect(res.body.checklist.some((c) => c.id === 'GOV_KILL_SWITCH' && c.status === 'READY')).toBe(true);
    expect(res.body.checklist.some((c) => c.id === 'COM_TWO_PHASE_INV' && c.status === 'READY')).toBe(true);
  });

  test('RazorpayLiveProvider fails closed when credentials missing', async () => {
    const liveProvider = new RazorpayLiveProvider();
    if (!liveProvider.client) {
      await expect(
        liveProvider.createOrder({ amount: 5000, receipt: 'test' })
      ).rejects.toThrow(/FATAL SECURITY LOCK/);
    }
  });

  test('POST /api/webhooks/razorpay/test ingests and deduplicates webhooks in webhook_inbox', async () => {
    const testEventId = `test_evt_${Date.now()}`;
    const payload = {
      event_id: testEventId,
      event: 'payment.captured',
      payload: {
        payment: {
          id: `pay_test_${Date.now()}`,
          amount: 1499900,
          status: 'captured',
        },
      },
    };

    // First ingestion
    const res1 = await request(app)
      .post('/api/webhooks/razorpay/test')
      .set('x-razorpay-signature', 'valid_test_signature')
      .send(payload);

    expect(res1.status).toBe(200);

    // Duplicate ingestion must be ignored safely
    const res2 = await request(app)
      .post('/api/webhooks/razorpay/test')
      .set('x-razorpay-signature', 'valid_test_signature')
      .send(payload);

    expect(res2.status).toBe(200);
    expect(res2.body.result.status).toBe('DUPLICATE_IGNORED');
  });

  test('Two-Phase Inventory Reservation reserves and releases stock correctly', async () => {
    const pRes = await query('SELECT id, inventory FROM products WHERE in_stock = true LIMIT 1');
    const product = pRes.rows[0];

    const quoteId = `test_quote_${Date.now()}`;
    const reservation = await reserveInventory({
      productId: product.id,
      quantity: 2,
      quoteId,
      durationMinutes: 15,
    });

    expect(reservation.status).toBe('RESERVED');
    expect(reservation.quantity).toBe(2);

    // Release reservation
    const releaseRes = await releaseReservation(quoteId, 'Automated test cleanup');
    expect(releaseRes.success).toBe(true);
    expect(releaseRes.reservation.status).toBe('RELEASED');
  });

  test('GET /api/ai/catalog returns normalized machine-readable catalog feed (agentpay.catalog.v1)', async () => {
    const res = await request(app).get('/api/ai/catalog');

    expect(res.status).toBe(200);
    expect(res.body.protocol).toBe('agentic-commerce/v1');
    expect(res.body.schema).toBe('agentpay.catalog.v1');
    expect(res.body.items.length).toBeGreaterThanOrEqual(1);

    const first = res.body.items[0];
    expect(first.productId).toBeDefined();
    expect(first.sku).toBeDefined();
    expect(first.pricing.amount).toBeGreaterThan(0);
    expect(first.delivery.standard).toBeDefined();
    expect(first.merchant.isVerified).toBe(true);
  });

  test('POST /api/ai/quote generates time-bound quote with cryptographic price lock signature', async () => {
    const pRes = await query('SELECT id FROM products WHERE in_stock = true LIMIT 1');
    const product = pRes.rows[0];

    const res = await request(app)
      .post('/api/ai/quote')
      .send({
        productId: product.id,
        quantity: 1,
        deliveryMethod: 'STANDARD',
      });

    expect(res.status).toBe(200);
    expect(res.body.quoteId).toBeDefined();
    expect(res.body.priceLockSignature).toBeDefined();
    expect(res.body.quoteExpiresAt).toBeDefined();
    expect(res.body.totalAmount).toBeGreaterThan(0);
  });
});
