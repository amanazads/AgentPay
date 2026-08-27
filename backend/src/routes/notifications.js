import { Router } from 'express';
import { notificationService } from '../services/notificationService.js';
import { query } from '../config/database.js';

const router = Router();

// GET /api/notifications — Retrieve user notifications
router.get('/', async (req, res, next) => {
  try {
    let userId = req.user?.id;
    if (!userId) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer agentpay_jwt_')) {
        userId = authHeader.replace('Bearer agentpay_jwt_', '').split('_')[0];
      }
    }
    if (!userId) {
      const defaultUser = await query('SELECT id FROM users LIMIT 1');
      userId = defaultUser.rows[0]?.id;
    }

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
    let userId = req.user?.id;
    if (!userId) {
      const defaultUser = await query('SELECT id FROM users LIMIT 1');
      userId = defaultUser.rows[0]?.id;
    }

    await notificationService.markAsRead(id, userId);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
