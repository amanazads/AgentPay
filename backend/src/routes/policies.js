import { Router } from 'express';
import { query } from '../config/database.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = Router();
router.use(requireAuth);

// GET /api/policies — List all policies
router.get('/', async (req, res, next) => {
  try {
    const result = await query('SELECT * FROM policies ORDER BY created_at DESC');
    res.json({ policies: result.rows });
  } catch (err) {
    next(err);
  }
});

// GET /api/policies/:id — Get single policy
router.get('/:id', async (req, res, next) => {
  try {
    const result = await query('SELECT * FROM policies WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Policy not found' });
    }
    res.json({ policy: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

export default router;
