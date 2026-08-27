import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

/**
 * Generate a new UUID v4
 */
export function generateId() {
  return uuidv4();
}

/**
 * Format currency in INR
 */
export function formatINR(amount) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Generate an idempotency key from components
 */
export function generateIdempotencyKey(...parts) {
  const input = parts.join(':');
  return crypto.createHash('sha256').update(input).digest('hex');
}

/**
 * Safely parse JSON, returning null on failure
 */
export function safeParseJSON(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

/**
 * Create an error with a status code
 */
export function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

export default {
  generateId,
  formatINR,
  generateIdempotencyKey,
  safeParseJSON,
  httpError,
};
