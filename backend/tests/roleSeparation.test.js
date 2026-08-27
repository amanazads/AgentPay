import request from 'supertest';
import { app } from '../src/index.js';
import { generateAccessToken } from '../src/utils/authUtils.js';

describe('Role Separation & Data Isolation Security Tests', () => {
  const buyerUser = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'buyer_security_test@agentpay.ai',
    name: 'Buyer Tester',
    role: 'BUYER',
  };

  const merchantUser = {
    id: '22222222-2222-4222-8222-222222222222',
    email: 'merchant_security_test@agentpay.ai',
    name: 'Merchant Tester',
    role: 'MERCHANT',
  };

  const buyerToken = generateAccessToken(buyerUser);
  const merchantToken = generateAccessToken(merchantUser);

  describe('Buyer Access Enforcement', () => {
    test('BUYER accessing merchant endpoints returns 403 Forbidden', async () => {
      const res = await request(app)
        .get('/api/merchant/overview')
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code || res.body.error).toMatch(/FORBIDDEN|Access denied/i);
    });

    test('BUYER accessing merchant products management returns 403 Forbidden', async () => {
      const res = await request(app)
        .get('/api/merchant/products')
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(403);
    });

    test('BUYER accessing merchant analytics returns 403 Forbidden', async () => {
      const res = await request(app)
        .get('/api/merchant/analytics')
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(403);
    });
  });

  describe('Merchant Access Enforcement', () => {
    test('MERCHANT accessing buyer search without role returns 200/403 properly', async () => {
      const res = await request(app)
        .get('/api/buyer/purchases')
        .set('Authorization', `Bearer ${merchantToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toBeDefined();
    });

    test('Unauthenticated request to protected endpoints returns 401 Unauthorized', async () => {
      const res = await request(app).get('/api/merchant/overview');
      expect(res.status).toBe(401);
    });
  });
});
