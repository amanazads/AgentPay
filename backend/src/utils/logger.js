/**
 * Structured logger utility.
 * Provides consistent log formatting with context for traceability.
 * Automatically sanitizes secrets, tokens, passwords, and sensitive keys from log output.
 */

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = LOG_LEVELS[process.env.LOG_LEVEL || 'info'] || 1;

const SENSITIVE_KEY_PATTERNS = [
  'password',
  'secret',
  'token',
  'authorization',
  'cookie',
  'key_secret',
  'webhook_secret',
  'jwt_secret',
  'gemini_api_key',
  'api_key_hash',
  'signature',
];

export function sanitizeLogContext(obj, depth = 0) {
  if (!obj || depth > 5) return obj;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map((item) => sanitizeLogContext(item, depth + 1));

  const clean = {};
  for (const [k, v] of Object.entries(obj)) {
    const isSensitive = SENSITIVE_KEY_PATTERNS.some((pattern) => k.toLowerCase().includes(pattern));
    if (isSensitive && typeof v === 'string' && v.length > 0) {
      clean[k] = '[REDACTED]';
    } else if (typeof v === 'object' && v !== null) {
      clean[k] = sanitizeLogContext(v, depth + 1);
    } else {
      clean[k] = v;
    }
  }
  return clean;
}

function formatLog(level, component, message, context) {
  const timestamp = new Date().toISOString();
  let contextStr = '';
  if (context) {
    if (context instanceof Error) {
      contextStr = ` ${context.stack || context.message}`;
    } else if (typeof context === 'object') {
      try {
        const sanitized = sanitizeLogContext(context);
        contextStr = Object.keys(sanitized).length > 0 ? ' ' + JSON.stringify(sanitized) : '';
      } catch (e) {
        contextStr = ` ${context}`;
      }
    } else {
      contextStr = ` ${context}`;
    }
  }
  const msgStr = message instanceof Error ? (message.stack || message.message) : (message ?? '');
  return `[${timestamp}] [${level.toUpperCase()}] [${component}] ${msgStr}${contextStr}`;
}

export const logger = {
  debug(component, message, context) {
    if (currentLevel <= LOG_LEVELS.debug) {
      console.log(formatLog('debug', component, message, context));
    }
  },
  info(component, message, context) {
    if (currentLevel <= LOG_LEVELS.info) {
      console.log(formatLog('info', component, message, context));
    }
  },
  warn(component, message, context) {
    if (currentLevel <= LOG_LEVELS.warn) {
      console.warn(formatLog('warn', component, message, context));
    }
  },
  error(component, message, context) {
    if (currentLevel <= LOG_LEVELS.error) {
      console.error(formatLog('error', component, message, context));
    }
  },
};

export default logger;
