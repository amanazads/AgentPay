import { Router } from 'express';
import { getApprovalsList, processApproval } from '../services/approvalService.js';
import { getUserIdFromRequest } from '../utils/authUtils.js';

const router = Router();

// GET /api/approvals — List pending approvals
router.get('/', async (req, res, next) => {
  try {
    const { status = 'pending' } = req.query;
    const userId = getUserIdFromRequest(req);
    const approvals = await getApprovalsList(status, userId);
    res.json({ approvals });
  } catch (err) { next(err); }
});

// POST /api/approvals/:id/decide — Unified decision endpoint
router.post('/:id/decide', async (req, res, next) => {
  try {
    const { decision = 'APPROVE', reviewer_id, notes, auto_create_payment = true } = req.body;
    const io = req.app.get('io');
    const result = await processApproval({
      approvalId: req.params.id,
      decision: decision.toUpperCase(),
      reviewerId: reviewer_id,
      notes,
      autoCreatePayment: decision.toUpperCase() === 'APPROVE' ? auto_create_payment : false,
      io,
    });
    res.json(result);
  } catch (err) { next(err); }
});

// POST /api/approvals/:id/approve — Human approve
router.post('/:id/approve', async (req, res, next) => {
  try {
    const { reviewer_id, notes, auto_create_payment = true } = req.body;
    const io = req.app.get('io');
    const result = await processApproval({
      approvalId: req.params.id,
      decision: 'APPROVE',
      reviewerId: reviewer_id,
      notes,
      autoCreatePayment: auto_create_payment,
      io,
    });
    res.json(result);
  } catch (err) { next(err); }
});

// POST /api/approvals/:id/reject — Human reject
router.post('/:id/reject', async (req, res, next) => {
  try {
    const { reviewer_id, notes } = req.body;
    const io = req.app.get('io');
    const result = await processApproval({
      approvalId: req.params.id,
      decision: 'REJECT',
      reviewerId: reviewer_id,
      notes,
      io,
    });
    res.json(result);
  } catch (err) { next(err); }
});

export default router;
