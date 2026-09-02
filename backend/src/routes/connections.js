import { Router } from 'express';
import { merchantConnectionService } from '../services/merchantConnectionService.js';
import { paymentMethodService } from '../services/paymentMethodService.js';
import { getUserIdFromRequest } from '../utils/authUtils.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = Router();

router.use(requireAuth);

function resolveUserId(req) {
  const id = getUserIdFromRequest(req);
  if (!id) {
    throw new Error('Authentication required');
  }
  return id;
}

// GET /api/connections/merchants — List connected & available merchants with capabilities
router.get('/merchants', async (req, res, next) => {
  try {
    const userId = await resolveUserId(req);
    const merchants = await merchantConnectionService.getUserConnections(userId);
    res.json({ merchants });
  } catch (err) {
    next(err);
  }
});

// GET /api/connections/merchants/:id/health — Live health diagnostics for merchant connector
router.get('/merchants/:id/health', async (req, res, next) => {
  try {
    const health = await merchantConnectionService.getMerchantHealth(req.params.id);
    res.json({ merchantId: req.params.id, health });
  } catch (err) {
    next(err);
  }
});

// POST /api/connections/merchants/:id/connect — Connect a merchant with user credentials / OAuth token
router.post('/merchants/:id/connect', async (req, res, next) => {
  try {
    const userId = await resolveUserId(req);
    const connection = await merchantConnectionService.connectMerchant(userId, req.params.id, req.body);
    res.json({ connection, message: 'Merchant account connected and authorized' });
  } catch (err) {
    next(err);
  }
});

// POST /api/connections/merchants/:id/disconnect — Disconnect a merchant
router.post('/merchants/:id/disconnect', async (req, res, next) => {
  try {
    const userId = await resolveUserId(req);
    const result = await merchantConnectionService.disconnectMerchant(userId, req.params.id, req.body?.reason);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/connections/payment-methods — List user authorized payment methods & mandates
router.get('/payment-methods', async (req, res, next) => {
  try {
    const userId = await resolveUserId(req);
    const paymentMethods = await paymentMethodService.getUserPaymentMethods(userId);
    res.json({ paymentMethods });
  } catch (err) {
    next(err);
  }
});

// POST /api/connections/payment-methods — Authorize a new payment method/mandate
router.post('/payment-methods', async (req, res, next) => {
  try {
    const userId = await resolveUserId(req);
    const method = await paymentMethodService.addPaymentMethod(userId, req.body);
    res.json({ paymentMethod: method, message: 'Payment authorization established' });
  } catch (err) {
    next(err);
  }
});

// POST /api/connections/payment-methods/:id/revoke — Revoke a payment authorization
router.post('/payment-methods/:id/revoke', async (req, res, next) => {
  try {
    const userId = await resolveUserId(req);
    const result = await paymentMethodService.revokePaymentMethod(userId, req.params.id, req.body?.reason);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/connections/payment-methods/:id — Revoke a payment authorization
router.delete('/payment-methods/:id', async (req, res, next) => {
  try {
    const userId = await resolveUserId(req);
    const result = await paymentMethodService.revokePaymentMethod(userId, req.params.id, req.body?.reason);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
