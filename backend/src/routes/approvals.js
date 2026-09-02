import { Router } from 'express';
import { getApprovalsList, processApproval } from '../services/approvalService.js';
import { getUserIdFromRequest } from '../utils/authUtils.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = Router();

router.use(requireAuth);

// GET /api/approvals — List pending approvals strictly scoped to authenticated user
router.get('/', async (req, res, next) => {
  try {
    const { status = 'pending' } = req.query;
    const userId = getUserIdFromRequest(req);
    const approvals = await getApprovalsList(status, userId);
    res.json({ approvals });
  } catch (err) {
    next(err);
  }
});

// POST /api/approvals/:id/decide — Unified decision endpoint
router.post('/:id/decide', async (req, res, next) => {
  try {
    const { decision = 'APPROVE', notes, auto_create_payment = true } = req.body || {};
    const reviewerId = getUserIdFromRequest(req);
    const io = req.app.get('io');
    const result = await processApproval({
      approvalId: req.params.id,
      decision: decision.toUpperCase(),
      reviewerId,
      notes,
      autoCreatePayment: decision.toUpperCase() === 'APPROVE' ? auto_create_payment : false,
      io,
    });
    res.json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

// POST /api/approvals/:id/approve — Human approve
router.post('/:id/approve', async (req, res, next) => {
  try {
    const { notes, auto_create_payment = true } = req.body || {};
    const reviewerId = getUserIdFromRequest(req);
    const io = req.app.get('io');
    const result = await processApproval({
      approvalId: req.params.id,
      decision: 'APPROVE',
      reviewerId,
      notes,
      autoCreatePayment: auto_create_payment,
      io,
    });
    res.json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

// POST /api/approvals/:id/reject — Human reject
router.post('/:id/reject', async (req, res, next) => {
  try {
    const { notes } = req.body || {};
    const reviewerId = getUserIdFromRequest(req);
    const io = req.app.get('io');
    const result = await processApproval({
      approvalId: req.params.id,
      decision: 'REJECT',
      reviewerId,
      notes,
      io,
    });
    res.json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

export default router;
