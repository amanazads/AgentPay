import request from 'supertest';
import express from 'express';
import aiCommerceDemoRoutes from '../src/routes/aiCommerceDemo.js';

const app = express();
app.use(express.json());
app.use('/api/ai-commerce', aiCommerceDemoRoutes);

describe('Track 01: AI Commerce Interactive Demonstration Suite', () => {
  test('GET /api/ai-commerce/demo-data returns unified verified catalog and dynamic readiness', async () => {
    const res = await request(app).get('/api/ai-commerce/demo-data');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.demoMerchant.name).toBe('Merchant Test Store');
    expect(res.body.demoMerchant.mode).toBeDefined();
    expect(res.body.catalogCount).toBeGreaterThanOrEqual(1);
    expect(res.body.products.length).toBe(res.body.catalogCount);
    expect(res.body.readiness.overallScore).toBeGreaterThanOrEqual(90);
    expect(res.body.readiness.pillars.length).toBe(6);
    expect(res.body.deliveryOptions.length).toBe(2);
  });

  test('POST /api/ai-commerce/execute-happy-path completes full autonomous commerce flow with invoice and order', async () => {
    const demoData = await request(app).get('/api/ai-commerce/demo-data');
    const product = demoData.body.products[0];

    const res = await request(app)
      .post('/api/ai-commerce/execute-happy-path')
      .send({
        productId: product.id,
        prompt: `Find me the best ${product.name} under ₹${Math.round(product.price * 1.2)}`,
        deliveryMethod: 'STANDARD',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.mode).toBeDefined();
    expect(res.body.status).toBe('PURCHASE_CONFIRMED');
    expect(res.body.financialSummary.paymentStatus).toBe('VERIFIED');
    expect(res.body.financialSummary.orderStatus).toBe('CONFIRMED');
    expect(res.body.order).toBeDefined();
    expect(res.body.order.order_number).toMatch(/^AGP-ORD-/);
    expect(res.body.invoice).toBeDefined();
    expect(res.body.invoice.invoice_number).toMatch(/^INV-/);
    expect(res.body.trace.length).toBeGreaterThanOrEqual(10);
    expect(res.body.executionTimeMs).toBeGreaterThan(0);
  });

  test('POST /api/ai-commerce/simulate-price-change safely blocks purchase upon price surge with zero charges', async () => {
    const demoData = await request(app).get('/api/ai-commerce/demo-data');
    const product = demoData.body.products[0];

    const res = await request(app)
      .post('/api/ai-commerce/simulate-price-change')
      .send({ productId: product.id });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.scenario).toBe('PRICE_SURGE_AND_LIMIT_VIOLATION');
    expect(res.body.decision).toBe('BLOCK');
    expect(res.body.paymentStatus).toContain('NOT ATTEMPTED');
    expect(res.body.orderStatus).toBe('NOT CREATED');
    expect(res.body.auditLogged).toBe(true);
  });

  test('POST /api/ai-commerce/simulate-payment-failure handles gateway rejection', async () => {
    const res = await request(app)
      .post('/api/ai-commerce/simulate-payment-failure')
      .send();

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.scenario).toBe('PAYMENT_SIGNATURE_FAILURE');
    expect(res.body.paymentStatus).toContain('FAILED');
    expect(res.body.orderStatus).toBe('NOT CONFIRMED');
    expect(res.body.decision).toBe('STOPPED_AT_PAYMENT_GATE');
  });

  test('POST /api/ai-commerce/simulate-reconciliation demonstrates recovery without double charge', async () => {
    const res = await request(app)
      .post('/api/ai-commerce/simulate-reconciliation')
      .send();

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.scenario).toBe('PAYMENT_SUCCESS_WEBHOOK_TIMEOUT');
    expect(res.body.initialOrderStatus).toBe('RECONCILIATION_REQUIRED');
    expect(res.body.finalOrderStatus).toBe('CONFIRMED');
  });

  test('POST /api/ai-commerce/reset-demo safely resets demo test records', async () => {
    const res = await request(app)
      .post('/api/ai-commerce/reset-demo')
      .send();

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
