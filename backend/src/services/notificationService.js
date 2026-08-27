import { query } from '../config/database.js';

/**
 * Enterprise Notification Service
 * Dispatches real-time in-app alerts and webhook notifications on verified backend events.
 */
export class NotificationService {
  async sendNotification(userId, eventType, title, message, metadata = {}, io = null) {
    if (!userId) return;

    const res = await query(`
      INSERT INTO in_app_notifications (user_id, event_type, title, message, metadata)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [userId, eventType, title, message, JSON.stringify(metadata)]);

    const notif = res.rows[0];

    if (io) {
      io.to(`user:${userId}`).emit('notification:new', notif);
      io.emit('notification:broadcast', notif);
    }

    return notif;
  }

  async getUserNotifications(userId, limit = 20) {
    const res = await query(`
      SELECT * FROM in_app_notifications
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `, [userId, limit]);
    return res.rows;
  }

  async markAsRead(notificationId, userId) {
    await query(`
      UPDATE in_app_notifications
      SET is_read = true
      WHERE id = $1 AND user_id = $2
    `, [notificationId, userId]);
  }
}

export const notificationService = new NotificationService();
