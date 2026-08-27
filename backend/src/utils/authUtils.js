import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import env from '../config/env.js';
import { query } from '../config/database.js';

const SALT_ROUNDS = 10;

/**
 * Hashes a plaintext password using bcrypt
 */
export async function hashPassword(plainPassword) {
  if (!plainPassword) return null;
  return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

/**
 * Compares plaintext password against stored hash
 */
export async function comparePassword(plainPassword, passwordHash) {
  if (!plainPassword || !passwordHash) return false;
  return bcrypt.compare(plainPassword, passwordHash);
}

/**
 * Generates an industry-standard signed JWT Access Token
 */
export function generateAccessToken(user) {
  const payload = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role || 'user',
  };

  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN || '24h',
    algorithm: 'HS256',
  });
}

/**
 * Creates and persists a cryptographically secure Refresh Token in PostgreSQL
 */
export async function createRefreshToken(userId) {
  const token = crypto.randomBytes(40).toString('hex');
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + (env.REFRESH_TOKEN_EXPIRES_DAYS || 30));

  await query(`
    INSERT INTO refresh_tokens (user_id, token, expires_at)
    VALUES ($1, $2, $3)
  `, [userId, token, expiresAt]);

  return {
    refreshToken: token,
    expiresAt,
  };
}

/**
 * Verifies JWT token signature and returns decoded payload
 */
export function verifyAccessToken(token) {
  try {
    return jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch (err) {
    return null;
  }
}

/**
 * Validates a refresh token against the database and rotates it
 */
export async function validateAndRotateRefreshToken(token) {
  const res = await query(`
    SELECT rt.*, u.id as user_id, u.email, u.name, u.role
    FROM refresh_tokens rt
    JOIN users u ON rt.user_id = u.id
    WHERE rt.token = $1 AND rt.expires_at > NOW()
  `, [token]);

  if (res.rows.length === 0) {
    throw new Error('Invalid or expired refresh token');
  }

  const record = res.rows[0];

  // Rotate: Delete used token and generate a new one
  await query('DELETE FROM refresh_tokens WHERE token = $1', [token]);
  const newRefresh = await createRefreshToken(record.user_id);

  const user = {
    id: record.user_id,
    email: record.email,
    name: record.name,
    role: record.role,
  };

  const newAccessToken = generateAccessToken(user);

  return {
    accessToken: newAccessToken,
    refreshToken: newRefresh.refreshToken,
    user,
  };
}

/**
 * Robust User ID extraction across JWT, Cookie, Header, or Legacy format
 */
export function getUserIdFromRequest(req) {
  if (req?.user?.id) return req.user.id;

  const authHeader = req?.headers?.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    if (token.startsWith('agentpay_jwt_')) {
      const parts = token.replace('agentpay_jwt_', '').split('_');
      return parts[1] || parts[0];
    }
    const decoded = verifyAccessToken(token);
    if (decoded?.id) return decoded.id;
  }

  if (req?.cookies?.agentpay_token) {
    const decoded = verifyAccessToken(req.cookies.agentpay_token);
    if (decoded?.id) return decoded.id;
  }

  return req?.query?.user_id || req?.headers?.['x-user-id'] || null;
}
