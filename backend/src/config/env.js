import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from backend directory
dotenv.config({ path: join(__dirname, '..', '..', '.env') });

const APP_ENV = (process.env.APP_ENV || process.env.NODE_ENV || 'development').toLowerCase();
const PAYMENT_MODE = (process.env.PAYMENT_MODE || 'test').toLowerCase(); // 'test' | 'live'
const LIVE_AUTONOMOUS_COMMERCE_MODE = (process.env.LIVE_AUTONOMOUS_COMMERCE_MODE || 'disabled').toLowerCase(); // 'disabled' | 'internal' | 'allowlist' | 'limited' | 'general'

// Check live key availability
const RAZORPAY_LIVE_KEY_ID = process.env.RAZORPAY_LIVE_KEY_ID || '';
const RAZORPAY_LIVE_KEY_SECRET = process.env.RAZORPAY_LIVE_KEY_SECRET || '';
const RAZORPAY_LIVE_WEBHOOK_SECRET = process.env.RAZORPAY_LIVE_WEBHOOK_SECRET || '';

const RAZORPAY_TEST_KEY_ID = process.env.RAZORPAY_TEST_KEY_ID || process.env.RAZORPAY_KEY_ID || 'rzp_test_demo_5174';
const RAZORPAY_TEST_KEY_SECRET = process.env.RAZORPAY_TEST_KEY_SECRET || process.env.RAZORPAY_KEY_SECRET || 'rzp_test_secret_demo';
const RAZORPAY_TEST_WEBHOOK_SECRET = process.env.RAZORPAY_TEST_WEBHOOK_SECRET || 'whsec_test_demo_secret';

const hasLiveRazorpayKeys = Boolean(RAZORPAY_LIVE_KEY_ID && RAZORPAY_LIVE_KEY_SECRET && !RAZORPAY_LIVE_KEY_ID.startsWith('rzp_test_'));

// Fail-Closed Validation: If configured as LIVE mode but missing valid live keys, enforce security lock
const isLiveConfigured = PAYMENT_MODE === 'live';
const livePaymentsActive = isLiveConfigured && hasLiveRazorpayKeys;

const env = {
  APP_ENV,
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '5050', 10),
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://aman@localhost:5433/agentpay',
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',

  // Authentication & Cryptography
  JWT_SECRET: process.env.JWT_SECRET || 'agentpay_production_grade_jwt_secret_key_2026_secure',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '24h',
  REFRESH_TOKEN_EXPIRES_DAYS: parseInt(process.env.REFRESH_TOKEN_EXPIRES_DAYS || '30', 10),

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

  // Razorpay Test Credentials
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

  // Flags & Descriptors
  isProduction: APP_ENV === 'production',
  isDevelopment: APP_ENV !== 'production',
  hasGeminiKey: Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
  hasRazorpayKeys: Boolean(livePaymentsActive ? hasLiveRazorpayKeys : (RAZORPAY_TEST_KEY_ID && RAZORPAY_TEST_KEY_SECRET)),
  hasGoogleOAuth: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
  hasLiveRazorpayKeys,
};

export default env;
