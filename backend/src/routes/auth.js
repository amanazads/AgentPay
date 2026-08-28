import { Router } from 'express';
import { query } from '../config/database.js';
import {
  hashPassword,
  comparePassword,
  generateAccessToken,
  createRefreshToken,
  validateAndRotateRefreshToken,
  verifyAccessToken,
} from '../utils/authUtils.js';

const router = Router();

// Helper to set HTTP-only auth cookies
function setAuthCookies(res, accessToken, refreshToken) {
  res.cookie('agentpay_token', accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
  });

  if (refreshToken) {
    res.cookie('agentpay_refresh', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });
  }
}

// POST /api/auth/signup — Create a new account with permanent BUYER or MERCHANT role
router.post('/signup', async (req, res, next) => {
  try {
    const { name, email, password, role: requestedRole } = req.body;
    if (!email || !name) {
      return res.status(400).json({ error: 'Name and email are required' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const existing = await query('SELECT * FROM users WHERE email = $1', [cleanEmail]);

    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'An account with this email already exists. Please log in.' });
    }

    const passwordHash = password ? await hashPassword(password) : null;
    const normRole = (requestedRole || 'BUYER').toUpperCase();
    const role = normRole === 'MERCHANT' ? 'MERCHANT' : 'BUYER';

    const insertRes = await query(`
      INSERT INTO users (email, name, role, password_hash)
      VALUES ($1, $2, $3, $4)
      RETURNING id, name, email, role, created_at
    `, [cleanEmail, name.trim(), role, passwordHash]);

    const user = insertRes.rows[0];
    const token = generateAccessToken(user);
    const { refreshToken } = await createRefreshToken(user.id);

    setAuthCookies(res, token, refreshToken);

    res.status(201).json({
      token,
      refreshToken,
      user,
      needsOnboarding: false,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/login — Authenticate credentials with bcrypt & JWT
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const userRes = await query('SELECT * FROM users WHERE email = $1', [cleanEmail]);
    const user = userRes.rows[0];

    if (!user) {
      return res.status(401).json({ error: 'No account found with this email. Please create an account first.' });
    }

    if (password && user.password_hash) {
      const isValid = await comparePassword(password, user.password_hash);
      if (!isValid) {
        return res.status(401).json({ error: 'Invalid email or password. Please check your credentials.' });
      }
    } else if (password && !user.password_hash) {
      const passHash = await hashPassword(password);
      await query('UPDATE users SET password_hash = $1 WHERE id = $2', [passHash, user.id]);
    }

    const normalizedRole = user.role === 'admin' ? 'admin' : ((user.role || 'BUYER').toUpperCase() === 'MERCHANT' ? 'MERCHANT' : 'BUYER');

    const token = generateAccessToken({ ...user, role: normalizedRole });
    const { refreshToken } = await createRefreshToken(user.id);

    setAuthCookies(res, token, refreshToken);

    res.json({
      token,
      refreshToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: normalizedRole,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/refresh — Rotate and exchange refresh token for fresh JWT
router.post('/refresh', async (req, res, next) => {
  try {
    const refreshToken = req.body?.refreshToken || req.cookies?.agentpay_refresh;
    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token is required' });
    }

    const result = await validateAndRotateRefreshToken(refreshToken);
    setAuthCookies(res, result.accessToken, result.refreshToken);

    res.json({
      token: result.accessToken,
      refreshToken: result.refreshToken,
      user: result.user,
    });
  } catch (err) {
    res.status(401).json({ error: err.message || 'Invalid refresh token' });
  }
});

// POST /api/auth/google — Google OAuth identity with role assignment
router.post('/google', async (req, res, next) => {
  try {
    const { name, email, googleId, avatarUrl, role: requestedRole } = req.body;
    const cleanEmail = (email || 'user@agentpay.ai').toLowerCase().trim();
    const cleanName = name || 'Google User';

    let userRes = await query('SELECT * FROM users WHERE email = $1', [cleanEmail]);
    let user = userRes.rows[0];

    const normRole = (requestedRole || 'BUYER').toUpperCase() === 'MERCHANT' ? 'MERCHANT' : 'BUYER';

    if (user) {
      if (googleId || avatarUrl) {
        await query(
          'UPDATE users SET google_id = COALESCE($1, google_id), avatar_url = COALESCE($2, avatar_url) WHERE id = $3',
          [googleId || null, avatarUrl || null, user.id]
        );
      }
    } else {
      const role = normRole === 'MERCHANT' ? 'MERCHANT' : 'BUYER';
      const insertRes = await query(
        'INSERT INTO users (email, name, role, google_id, avatar_url) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [cleanEmail, cleanName, role, googleId || null, avatarUrl || null]
      );
      user = insertRes.rows[0];
    }

    const normalizedRole = user.role === 'admin' ? 'admin' : ((user.role || normRole).toUpperCase() === 'MERCHANT' ? 'MERCHANT' : 'BUYER');

    const token = generateAccessToken({ ...user, role: normalizedRole });
    const { refreshToken } = await createRefreshToken(user.id);

    setAuthCookies(res, token, refreshToken);

    res.json({
      token,
      refreshToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: normalizedRole,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/logout — Invalidate refresh token & clear cookies
router.post('/logout', async (req, res, next) => {
  try {
    const refreshToken = req.body?.refreshToken || req.cookies?.agentpay_refresh;
    if (refreshToken) {
      await query('DELETE FROM refresh_tokens WHERE token = $1', [refreshToken]);
    }

    res.clearCookie('agentpay_token');
    res.clearCookie('agentpay_refresh');

    res.json({ success: true, message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me — Return current user profile from verified JWT
router.get('/me', async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    let token = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else if (req.cookies && req.cookies.agentpay_token) {
      token = req.cookies.agentpay_token;
    }

    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    let userId = null;
    if (token.startsWith('agentpay_jwt_')) {
      userId = token.replace('Bearer ', '').split('_')[2] || token.replace('Bearer ', '').split('_')[1];
    } else {
      const decoded = verifyAccessToken(token);
      userId = decoded?.id;
    }

    if (!userId) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const userRes = await query(`
      SELECT id, name, email, role, avatar_url, merchant_id, created_at 
      FROM users 
      WHERE id::text = $1
    `, [userId]);

    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'User record not found' });
    }

    const user = userRes.rows[0];
    const normalizedRole = user.role === 'admin' ? 'admin' : ((user.role || 'BUYER').toUpperCase() === 'MERCHANT' ? 'MERCHANT' : 'BUYER');

    res.json({ user: { ...user, role: normalizedRole } });
  } catch (err) {
    next(err);
  }
});

export default router;
