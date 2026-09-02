import { Router } from 'express';
import { query } from '../config/database.js';

const router = Router();

// GET /api/merchants — List public verified merchants (secrets excluded)
router.get('/', async (req, res, next) => {
  try {
    const result = await query(`
      SELECT m.id, m.name, m.category, m.rating, m.risk_level, m.description, 
             m.tier, m.is_verified, m.is_test_lab, m.verification_status, 
             m.connector_status, m.created_at,
             COUNT(p.id) as product_count
      FROM merchants m
      LEFT JOIN products p ON m.id = p.merchant_id
      GROUP BY m.id
      ORDER BY m.name
    `);
    res.json({ merchants: result.rows });
  } catch (err) {
    next(err);
  }
});

// GET /api/merchants/:id — Get public merchant detail (secrets excluded)
router.get('/:id', async (req, res, next) => {
  try {
    const result = await query(`
      SELECT id, name, category, rating, risk_level, description, 
             tier, is_verified, is_test_lab, verification_status, 
             connector_status, created_at
      FROM merchants 
      WHERE id = $1
    `, [req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Merchant not found' });
    }
    res.json({ merchant: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

export default router;
