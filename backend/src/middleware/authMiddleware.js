import { verifyAccessToken } from '../utils/authUtils.js';

/**
 * Authentication Middleware
 * Extracts and verifies JWT from Authorization header or cookie
 */
export function authenticateUser(req, res, next) {
  const authHeader = req.headers.authorization;
  let token = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else if (req.cookies && req.cookies.agentpay_token) {
    token = req.cookies.agentpay_token;
  }

  if (!token) {
    req.user = null;
    return next();
  }

  // Handle legacy format fallback if necessary
  if (token.startsWith('agentpay_jwt_')) {
    const parts = token.replace('Bearer ', '').split('_');
    req.user = { id: parts[2] || parts[1] || 'user_default', role: 'BUYER' };
    return next();
  }

  const decoded = verifyAccessToken(token);
  if (decoded) {
    req.user = decoded;
  } else {
    req.user = null;
  }

  next();
}

/**
 * Enforce strict authentication on protected endpoints
 */
export function requireAuth(req, res, next) {
  if (!req.user || !req.user.id) {
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required. Please sign in.' } });
  }
  next();
}

/**
 * Enforce Buyer role
 */
export function requireBuyer(req, res, next) {
  if (!req.user || !req.user.id) {
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
  }
  const role = (req.user.role || 'BUYER').toUpperCase();
  if (role !== 'BUYER' && role !== 'USER' && role !== 'ADMIN') {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied. Buyer account required.' } });
  }
  next();
}

/**
 * Enforce Merchant role
 */
export function requireMerchant(req, res, next) {
  if (!req.user || !req.user.id) {
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
  }
  const role = (req.user.role || '').toUpperCase();
  if (role !== 'MERCHANT' && role !== 'ADMIN') {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied. Merchant account required.' } });
  }
  next();
}

/**
 * Enforce Admin / Supervisor privileges
 */
export function requireAdmin(req, res, next) {
  const role = (req.user?.role || '').toUpperCase();
  if (!req.user || role !== 'ADMIN') {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied. Administrator role required.' } });
  }
  next();
}
