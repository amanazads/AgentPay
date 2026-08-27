import { Router } from 'express';
import { query } from '../config/database.js';
import { generateIdempotencyKey } from '../utils/helpers.js';
import { evaluatePurchaseIntent } from '../services/decisionEngine.js';
import { recordAuditEvent } from '../services/auditService.js';
import { getUserIdFromRequest } from '../utils/authUtils.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = Router();

router.use(requireAuth);

// POST /api/purchase-intents — Create purchase intent & automatically evaluate
router.post('/', async (req, res, next) => {
  try {
    const {
      agent_id, product_id, merchant_id,
      amount, quantity = 1, ai_reasoning, ai_recommendation,
      auto_evaluate = true,
    } = req.body;

    if (!agent_id || !product_id || amount == null) {
      return res.status(400).json({ error: 'agent_id, product_id, and amount are required' });
    }

    const userId = getUserIdFromRequest(req);

    // Lookup merchant_id from product if not provided
    let finalMerchantId = merchant_id;
    if (!finalMerchantId) {
      const prodRes = await query('SELECT merchant_id FROM products WHERE id = $1', [product_id]);
      finalMerchantId = prodRes.rows[0]?.merchant_id;
    }

    // Generate idempotency key
    const idempotencyKey = generateIdempotencyKey(agent_id, product_id, amount.toString(), Date.now().toString());

    const result = await query(`
      INSERT INTO purchase_intents
        (agent_id, user_id, product_id, merchant_id, amount, quantity, ai_reasoning, ai_recommendation, idempotency_key, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')
      RETURNING *
    `, [agent_id, userId, product_id, finalMerchantId, amount, quantity, ai_reasoning, ai_recommendation, idempotencyKey]);

    const createdIntent = result.rows[0];
    const io = req.app.get('io');

    // Record creation audit event
    await recordAuditEvent({
      eventType: 'PURCHASE_INTENT_CREATED',
      actor: 'agent',
      agentId: agent_id,
      userId,
      purchaseIntentId: createdIntent.id,
      action: 'CREATE_PURCHASE_INTENT',
      decision: 'PENDING',
      reasoning: ai_reasoning || 'AI Agent proposed purchase intent',
      outcome: 'Intent recorded, evaluating guardrails',
      metadata: { amount, quantity, productId: product_id },
      io,
    });

    if (io) {
      io.to('dashboard').emit('intent:created', createdIntent);
    }

    // Auto evaluate through Decision Engine if requested (default true)
    if (auto_evaluate) {
      const evalResult = await evaluatePurchaseIntent(createdIntent.id, io);
      return res.status(201).json({
        purchaseIntent: createdIntent,
        evaluation: evalResult,
      });
    }

    res.status(201).json({ purchaseIntent: createdIntent });
  } catch (err) { next(err); }
});

// GET /api/purchase-intents — List intents scoped by tenant
router.get('/', async (req, res, next) => {
  try {
    const { agent_id, status, limit = 50, offset = 0 } = req.query;
    const userId = getUserIdFromRequest(req);
    const uRes = await query('SELECT role, merchant_id FROM users WHERE id::text = $1', [userId]);
    const user = uRes.rows[0] || {};
    const role = (user.role || '').toUpperCase();
    const merchantId = user.merchant_id;

    const conditions = [];
    const values = [];
    let idx = 1;

    if (role === 'MERCHANT' && merchantId) {
      conditions.push(`pi.merchant_id = $${idx++}`);
      values.push(merchantId);
    } else if (role !== 'ADMIN') {
      conditions.push(`pi.user_id::text = $${idx++}`);
      values.push(userId);
    }

    if (agent_id) { conditions.push(`pi.agent_id = $${idx++}`); values.push(agent_id); }
    if (status) { conditions.push(`pi.status = $${idx++}`); values.push(status); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    values.push(parseInt(limit), parseInt(offset));

    const result = await query(`
      SELECT pi.*, p.name as product_name, p.price as product_price,
             m.name as merchant_name, a.name as agent_name
      FROM purchase_intents pi
      LEFT JOIN products p ON pi.product_id = p.id
      LEFT JOIN merchants m ON pi.merchant_id = m.id
      LEFT JOIN agents a ON pi.agent_id = a.id
      ${where}
      ORDER BY pi.created_at DESC
      LIMIT $${idx++} OFFSET $${idx++}
    `, values);

    res.json({ purchaseIntents: result.rows });
  } catch (err) { next(err); }
});

// GET /api/purchase-intents/:id — Get intent detail with ownership enforcement
router.get('/:id', async (req, res, next) => {
  try {
    const userId = getUserIdFromRequest(req);
    const uRes = await query('SELECT role, merchant_id FROM users WHERE id::text = $1', [userId]);
    const user = uRes.rows[0] || {};
    const role = (user.role || '').toUpperCase();
    const merchantId = user.merchant_id;

    const result = await query(`
      SELECT pi.*, p.name as product_name, p.price as product_price,
             p.description as product_description, p.specifications,
             m.name as merchant_name, m.is_verified as merchant_verified,
             a.name as agent_name, a.status as agent_status
      FROM purchase_intents pi
      LEFT JOIN products p ON pi.product_id = p.id
      LEFT JOIN merchants m ON pi.merchant_id = m.id
      LEFT JOIN agents a ON pi.agent_id = a.id
      WHERE pi.id = $1
    `, [req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Purchase intent not found' });
    }

    const intent = result.rows[0];
    if (role === 'MERCHANT' && intent.merchant_id !== merchantId) {
      return res.status(404).json({ error: 'Purchase intent not found' });
    }
    if (role !== 'ADMIN' && role !== 'MERCHANT' && intent.user_id !== userId) {
      return res.status(404).json({ error: 'Purchase intent not found' });
    }

    res.json({ purchaseIntent: intent });
  } catch (err) { next(err); }
});

// POST /api/purchase-intents/:id/evaluate — Explicit evaluate
router.post('/:id/evaluate', async (req, res, next) => {
  try {
    const io = req.app.get('io');
    const evaluation = await evaluatePurchaseIntent(req.params.id, io);
    res.json({ evaluation });
  } catch (err) { next(err); }
});

export default router;
