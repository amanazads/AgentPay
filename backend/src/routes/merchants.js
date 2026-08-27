import { Router } from 'express';
import { query } from '../config/database.js';

const router = Router();

// GET /api/merchants — List merchants
router.get('/', async (req, res, next) => {
  try {
    const result = await query(`
      SELECT m.*, COUNT(p.id) as product_count
      FROM merchants m
      LEFT JOIN products p ON m.id = p.merchant_id
      GROUP BY m.id
      ORDER BY m.name
    `);
    res.json({ merchants: result.rows });
  } catch (err) { next(err); }
});

// GET /api/merchants/:id — Get merchant detail
router.get('/:id', async (req, res, next) => {
  try {
    const result = await query('SELECT * FROM merchants WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Merchant not found' });
    }
    res.json({ merchant: result.rows[0] });
  } catch (err) { next(err); }
});

export default router;
