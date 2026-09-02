import { Router } from 'express';
import { notificationService } from '../services/notificationService.js';
import { getUserIdFromRequest } from '../utils/authUtils.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = Router();

router.use(requireAuth);

// GET /api/notifications — Retrieve user notifications strictly for authenticated user
router.get('/', async (req, res, next) => {
  try {
    const userId = getUserIdFromRequest(req);
    const notifications = await notificationService.getUserNotifications(userId);
    res.json({ notifications });
  } catch (err) {
    next(err);
  }
});

// POST /api/notifications/:id/read — Mark notification as read
router.post('/:id/read', async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = getUserIdFromRequest(req);

    await notificationService.markAsRead(id, userId);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
