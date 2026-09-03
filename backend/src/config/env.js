import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from backend directory if present
dotenv.config({ path: join(__dirname, '..', '..', '.env') });

const APP_ENV = (process.env.APP_ENV || process.env.NODE_ENV || 'development').toLowerCase();
const isProduction = APP_ENV === 'production';
const isTest = APP_ENV === 'test' || process.env.NODE_ENV === 'test';
const isDevelopment = !isProduction && !isTest;

// Environments and Payment Modes
export const Environments = {
  DEVELOPMENT: 'DEVELOPMENT',
  TEST: 'TEST',
  PRODUCTION: 'PRODUCTION',
};

export const PaymentModes = {
  TEST: 'TEST',
  LIVE: 'LIVE',
};

// Live Razorpay credentials (strictly NO fallback defaults)
const RAZORPAY_LIVE_KEY_ID = process.env.RAZORPAY_LIVE_KEY_ID || '';
const RAZORPAY_LIVE_KEY_SECRET = process.env.RAZORPAY_LIVE_KEY_SECRET || '';
const RAZORPAY_LIVE_WEBHOOK_SECRET = process.env.RAZORPAY_LIVE_WEBHOOK_SECRET || '';

// Test / Sandbox Razorpay credentials (strictly from environment variables)
const RAZORPAY_TEST_KEY_ID = process.env.RAZORPAY_TEST_KEY_ID || process.env.RAZORPAY_KEY_ID || '';
const RAZORPAY_TEST_KEY_SECRET = process.env.RAZORPAY_TEST_KEY_SECRET || process.env.RAZORPAY_KEY_SECRET || '';
const RAZORPAY_TEST_WEBHOOK_SECRET = process.env.RAZORPAY_TEST_WEBHOOK_SECRET || process.env.RAZORPAY_WEBHOOK_SECRET || '';

// Live key validation (must start with rzp_live_ and cannot be test keys)
const hasLiveRazorpayKeys = Boolean(
  RAZORPAY_LIVE_KEY_ID &&
  RAZORPAY_LIVE_KEY_SECRET &&
  RAZORPAY_LIVE_KEY_ID.startsWith('rzp_live_') &&
  !RAZORPAY_LIVE_KEY_ID.startsWith('rzp_test_')
);

const PAYMENT_MODE = (process.env.PAYMENT_MODE || 'test').toLowerCase(); // 'test' | 'live'
const LIVE_AUTONOMOUS_COMMERCE_MODE = (process.env.LIVE_AUTONOMOUS_COMMERCE_MODE || 'disabled').toLowerCase();

// Fail-Closed Validation: If configured as LIVE mode but missing valid live keys, enforce security lock
const isLiveConfigured = PAYMENT_MODE === 'live';
const livePaymentsActive = isLiveConfigured && hasLiveRazorpayKeys && LIVE_AUTONOMOUS_COMMERCE_MODE === 'enabled';

// Insecure development fallbacks and patterns that must NEVER be used
const INSECURE_PATTERNS = [
  /super_secret/i,
  /demo_secret/i,
  /production_grade_secret/i,
  /agentpay_production_grade_jwt_secret_key_2026_secure/i,
  /agentpay_dev_local_jwt_secret_do_not_use_in_prod/i,
  /^secret$/i,
  /dev-secret-key-12345/i,
  /123456/i,
  /^password$/i,
  /change_me/i,
];

// Secrets and URLs resolved strictly from process.env (zero hardcoded fallbacks)
const resolvedJwtSecret = process.env.JWT_SECRET || '';
const resolvedDatabaseUrl = process.env.DATABASE_URL || '';
const resolvedRedisUrl = process.env.REDIS_URL || '';

/**
 * Validates the runtime configuration against security invariants.
 * Returns diagnostic errors without exposing secret values.
 */
export function validateEnvironment(config = null) {
  const cfg = config || env;
  const errors = [];

  const isInsecure = (val) => {
    if (!val || typeof val !== 'string') return false;
    return INSECURE_PATTERNS.some(pat => pat.test(val));
  };

  // 1. JWT Secret Validation
  if (!cfg.JWT_SECRET) {
    errors.push('JWT_SECRET is required.');
  } else {
    if (isInsecure(cfg.JWT_SECRET)) {
      errors.push('Insecure development fallback JWT_SECRET detected. You must set a strong, unique JWT_SECRET from environment variables.');
    }
    if (cfg.isProduction && cfg.JWT_SECRET.length < 32) {
      errors.push('JWT_SECRET must be at least 32 characters in production.');
    }
  }

  // 2. Database URL Validation
  if (!cfg.DATABASE_URL) {
    errors.push('DATABASE_URL is required.');
  } else if (!cfg.DATABASE_URL.startsWith('postgresql://') && !cfg.DATABASE_URL.startsWith('postgres://')) {
    errors.push('DATABASE_URL must be a valid PostgreSQL connection URL starting with postgresql:// or postgres://');
  }

  // 3. Redis URL Validation
  if (!cfg.REDIS_URL) {
    errors.push('REDIS_URL is required.');
  } else if (!cfg.REDIS_URL.startsWith('redis://') && !cfg.REDIS_URL.startsWith('rediss://')) {
    errors.push('REDIS_URL must be a valid Redis connection URL starting with redis:// or rediss://');
  }

  // 4. Live Payment Rails Validation (if live mode requested)
  if (cfg.PAYMENT_MODE === 'live') {
    if (!cfg.RAZORPAY_LIVE_KEY_ID || !cfg.RAZORPAY_LIVE_KEY_SECRET) {
      errors.push('RAZORPAY_LIVE_KEY_ID and RAZORPAY_LIVE_KEY_SECRET are required when PAYMENT_MODE is set to live.');
    }
    if (cfg.RAZORPAY_LIVE_KEY_ID) {
      if (cfg.RAZORPAY_LIVE_KEY_ID.startsWith('rzp_test_')) {
        errors.push('RAZORPAY_LIVE_KEY_ID cannot be a test sandbox key (rzp_test_*) in live production mode.');
      } else if (!cfg.RAZORPAY_LIVE_KEY_ID.startsWith('rzp_live_')) {
        errors.push('RAZORPAY_LIVE_KEY_ID must have the live prefix (rzp_live_*) in live production mode.');
      }
    }
    if (!cfg.RAZORPAY_LIVE_WEBHOOK_SECRET) {
      errors.push('RAZORPAY_LIVE_WEBHOOK_SECRET is required when PAYMENT_MODE is set to live.');
    }
  }

  // 5. Test Payment Rails Key Format Validation (when test keys provided)
  if (cfg.RAZORPAY_TEST_KEY_ID && cfg.RAZORPAY_TEST_KEY_ID.startsWith('rzp_live_')) {
    errors.push('RAZORPAY_TEST_KEY_ID cannot use live credentials (rzp_live_*).');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Returns a sanitized clone of the configuration with all secrets and credentials redacted.
 */
export function getSanitizedConfig(config = null) {
  const cfg = config || env;
  const redact = (val) => (val && typeof val === 'string' ? `[REDACTED:${val.slice(-4)}]` : '[NOT_SET]');

  return {
    APP_ENV: cfg.APP_ENV,
    NODE_ENV: cfg.NODE_ENV,
    PORT: cfg.PORT,
    DATABASE_URL: cfg.DATABASE_URL ? cfg.DATABASE_URL.replace(/:[^:@]+@/, ':***@') : '[NOT_SET]',
    REDIS_URL: cfg.REDIS_URL ? cfg.REDIS_URL.replace(/:[^:@]+@/, ':***@') : '[NOT_SET]',
    JWT_SECRET: redact(cfg.JWT_SECRET),
    JWT_EXPIRES_IN: cfg.JWT_EXPIRES_IN,
    PAYMENT_MODE: cfg.PAYMENT_MODE,
    isLiveMode: cfg.isLiveMode,
    isTestMode: cfg.isTestMode,
    livePaymentsActive: cfg.livePaymentsActive,
    LIVE_AUTONOMOUS_COMMERCE_MODE: cfg.LIVE_AUTONOMOUS_COMMERCE_MODE,
    RAZORPAY_LIVE_KEY_ID: cfg.RAZORPAY_LIVE_KEY_ID ? `${cfg.RAZORPAY_LIVE_KEY_ID.substring(0, 8)}...` : '[NOT_SET]',
    RAZORPAY_LIVE_KEY_SECRET: redact(cfg.RAZORPAY_LIVE_KEY_SECRET),
    RAZORPAY_LIVE_WEBHOOK_SECRET: redact(cfg.RAZORPAY_LIVE_WEBHOOK_SECRET),
    RAZORPAY_TEST_KEY_ID: cfg.RAZORPAY_TEST_KEY_ID ? `${cfg.RAZORPAY_TEST_KEY_ID.substring(0, 8)}...` : '[NOT_SET]',
    RAZORPAY_TEST_KEY_SECRET: redact(cfg.RAZORPAY_TEST_KEY_SECRET),
    RAZORPAY_TEST_WEBHOOK_SECRET: redact(cfg.RAZORPAY_TEST_WEBHOOK_SECRET),
    GEMINI_API_KEY: redact(cfg.GEMINI_API_KEY),
    GOOGLE_CLIENT_ID: cfg.GOOGLE_CLIENT_ID ? `${cfg.GOOGLE_CLIENT_ID.substring(0, 10)}...` : '[NOT_SET]',
    GOOGLE_CLIENT_SECRET: redact(cfg.GOOGLE_CLIENT_SECRET),
    isProduction: cfg.isProduction,
    isDevelopment: cfg.isDevelopment,
    hasLiveRazorpayKeys: cfg.hasLiveRazorpayKeys,
  };
}

const env = {
  APP_ENV,
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '5050', 10),
  DATABASE_URL: resolvedDatabaseUrl,
  REDIS_URL: resolvedRedisUrl,

  // Authentication & Cryptography (strictly from environment)
  JWT_SECRET: resolvedJwtSecret,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '24h',
  REFRESH_TOKEN_EXPIRES_DAYS: parseInt(process.env.REFRESH_TOKEN_EXPIRES_DAYS || '30', 10),
  QUOTE_SIGNING_SECRET: process.env.QUOTE_SIGNING_SECRET || resolvedJwtSecret,

  // Google OAuth 2.0
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',

  // Environment & Payment Mode
  PAYMENT_MODE: livePaymentsActive ? 'live' : 'test',
  isLiveMode: livePaymentsActive,
  isTestMode: !livePaymentsActive,
  livePaymentsActive,
  LIVE_AUTONOMOUS_COMMERCE_MODE,

  // Platform Safeguards & Caps
  PLATFORM_MAX_TRANSACTION_LIMIT: parseFloat(process.env.PLATFORM_MAX_TRANSACTION_LIMIT || '25000'),
  PLATFORM_MAX_DAILY_LIMIT: parseFloat(process.env.PLATFORM_MAX_DAILY_LIMIT || '50000'),
  PRICE_SURGE_TOLERANCE_PERCENT: parseFloat(process.env.PRICE_SURGE_TOLERANCE_PERCENT || '2.0'),

  // Razorpay Test Credentials (strictly from environment)
  RAZORPAY_TEST_KEY_ID,
  RAZORPAY_TEST_KEY_SECRET,
  RAZORPAY_TEST_WEBHOOK_SECRET,

  // Razorpay Live Credentials
  RAZORPAY_LIVE_KEY_ID,
  RAZORPAY_LIVE_KEY_SECRET,
  RAZORPAY_LIVE_WEBHOOK_SECRET,

  // Active Key Selector (Dependent on current authoritative mode)
  RAZORPAY_KEY_ID: livePaymentsActive ? RAZORPAY_LIVE_KEY_ID : RAZORPAY_TEST_KEY_ID,
  RAZORPAY_KEY_SECRET: livePaymentsActive ? RAZORPAY_LIVE_KEY_SECRET : RAZORPAY_TEST_KEY_SECRET,

  // AI Service
  AI_SERVICE_URL: process.env.AI_SERVICE_URL || 'http://localhost:8000',
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '',
  GEMINI_MODEL: (process.env.GEMINI_MODEL || '').trim(),

  // Flags & Descriptors
  isProduction,
  isDevelopment,
  isTest,
  hasGeminiKey: Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
  hasRazorpayKeys: Boolean(livePaymentsActive ? hasLiveRazorpayKeys : (RAZORPAY_TEST_KEY_ID && RAZORPAY_TEST_KEY_SECRET)),
  hasGoogleOAuth: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
  hasLiveRazorpayKeys,
};

// If booted in production mode, immediately validate environment fail-closed
if (isProduction) {
  const validation = validateEnvironment(env);
  if (!validation.valid) {
    throw new Error(`Production environment startup validation failed:\n- ${validation.errors.join('\n- ')}`);
  }
}

export { env };
export default env;
