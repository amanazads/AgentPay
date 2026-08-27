import { Router } from 'express';
import { query } from '../config/database.js';

const router = Router();

// GET /api/products — Search/list products
router.get('/', async (req, res, next) => {
  try {
    const { search, category, min_price, max_price, merchant_id, in_stock, limit = 50, offset = 0 } = req.query;
    const conditions = [];
    const values = [];
    let idx = 1;

    if (search) {
      conditions.push(`(p.name ILIKE $${idx} OR p.description ILIKE $${idx} OR p.brand ILIKE $${idx} OR p.category ILIKE $${idx})`);
      values.push(`%${search}%`);
      idx++;
    }
    if (category) {
      conditions.push(`p.category ILIKE $${idx++}`);
      values.push(category);
    }
    if (min_price) {
      conditions.push(`p.price >= $${idx++}`);
      values.push(min_price);
    }
    if (max_price) {
      conditions.push(`p.price <= $${idx++}`);
      values.push(max_price);
    }
    if (merchant_id) {
      conditions.push(`p.merchant_id = $${idx++}`);
      values.push(merchant_id);
    }
    if (in_stock !== undefined) {
      conditions.push(`p.in_stock = $${idx++}`);
      values.push(in_stock === 'true');
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    values.push(parseInt(limit), parseInt(offset));
    const result = await query(`
      SELECT p.*, 
             m.name as merchant_name, 
             m.is_verified as merchant_verified,
             m.risk_level as merchant_risk_level,
             pam.ai_summary,
             pam.keywords as ai_keywords,
             pam.is_promoted
      FROM products p
      LEFT JOIN merchants m ON p.merchant_id = m.id
      LEFT JOIN product_ai_metadata pam ON pam.product_id = p.id
      ${where}
      ORDER BY pam.is_promoted DESC NULLS LAST, p.created_at DESC
      LIMIT $${idx++} OFFSET $${idx++}
    `, values);

    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) FROM products p ${where}`,
      values.slice(0, -2)
    );

    res.json({
      products: result.rows,
      total: parseInt(countResult.rows[0].count),
      limit: parseInt(limit),
      offset: parseInt(offset),
    });
  } catch (err) { next(err); }
});

// GET /api/products/:id — Get product detail
router.get('/:id', async (req, res, next) => {
  try {
    const result = await query(`
      SELECT p.*, m.name as merchant_name, m.is_verified as merchant_verified,
             m.risk_level as merchant_risk_level, m.rating as merchant_rating
      FROM products p
      LEFT JOIN merchants m ON p.merchant_id = m.id
      WHERE p.id = $1
    `, [req.params.id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.json({ product: result.rows[0] });
  } catch (err) { next(err); }
});

// GET /api/products/compare — Compare multiple products
router.get('/compare', async (req, res, next) => {
  try {
    const { ids } = req.query;
    if (!ids) {
      return res.status(400).json({ error: 'Product IDs required (comma-separated)' });
    }
    const idArray = ids.split(',');
    const placeholders = idArray.map((_, i) => `$${i + 1}`).join(',');
    
    const result = await query(`
      SELECT p.*, m.name as merchant_name, m.is_verified as merchant_verified,
             m.risk_level as merchant_risk_level
      FROM products p
      LEFT JOIN merchants m ON p.merchant_id = m.id
      WHERE p.id IN (${placeholders})
    `, idArray);

    res.json({ products: result.rows });
  } catch (err) { next(err); }
});

// GET /api/products/categories/list — Get unique categories
router.get('/categories/list', async (req, res, next) => {
  try {
    const result = await query('SELECT DISTINCT category FROM products ORDER BY category');
    res.json({ categories: result.rows.map(r => r.category) });
  } catch (err) { next(err); }
});

export default router;
