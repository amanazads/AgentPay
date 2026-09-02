import { validateEnvironment, getSanitizedConfig } from '../src/config/env.js';
import { sanitizeLogContext } from '../src/utils/logger.js';
import { RazorpayTestProvider } from '../src/services/paymentProvider.js';
import request from 'supertest';
import app from '../src/index.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Track 01: Secret & Credential Hardening Suite', () => {
  // ── TEST 1: Production Startup Validation — Missing JWT_SECRET ─────────────
  test('TEST 1: Production validation fails closed when JWT_SECRET is missing or empty', () => {
    const invalidConfig = {
      isProduction: true,
      APP_ENV: 'production',
      JWT_SECRET: '',
      DATABASE_URL: 'postgresql://prod_user:strong_password@db.prod.internal:5432/agentpay_prod',
      REDIS_URL: 'redis://:strong_redis_pass@redis.prod.internal:6379',
      PAYMENT_MODE: 'test',
    };

    const result = validateEnvironment(invalidConfig);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('JWT_SECRET is required'))).toBe(true);
  });

  // ── TEST 2: Production Startup Validation — Insecure Fallback Secret ─────────
  test('TEST 2: Production validation rejects known development fallback secrets', () => {
    const fallbacks = [
      'agentpay_production_grade_jwt_secret_key_2026_secure',
      'agentpay_dev_local_jwt_secret_do_not_use_in_prod',
      'super_secret_jwt_key_agentpay_dev_environment_32chars',
      'demo_secret_token_1234567890',
      'production_grade_secret_fallback',
      'dev-secret-key-12345',
    ];

    for (const fb of fallbacks) {
      const insecureConfig = {
        isProduction: true,
        APP_ENV: 'production',
        JWT_SECRET: fb,
        DATABASE_URL: 'postgresql://prod_user:strong_password@db.prod.internal:5432/agentpay_prod',
        REDIS_URL: 'redis://:strong_redis_pass@redis.prod.internal:6379',
        PAYMENT_MODE: 'test',
      };

      const result = validateEnvironment(insecureConfig);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Insecure development fallback JWT_SECRET detected'))).toBe(true);
    }
  });

  // ── TEST 3: Production Startup Validation — Short JWT Secret (< 32 chars) ───
  test('TEST 3: Production validation rejects JWT_SECRET shorter than 32 characters', () => {
    const shortConfig = {
      isProduction: true,
      APP_ENV: 'production',
      JWT_SECRET: 'too_short_secret_key',
      DATABASE_URL: 'postgresql://prod_user:strong_password@db.prod.internal:5432/agentpay_prod',
      REDIS_URL: 'redis://:strong_redis_pass@redis.prod.internal:6379',
      PAYMENT_MODE: 'test',
    };

    const result = validateEnvironment(shortConfig);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('at least 32 characters'))).toBe(true);
  });

  // ── TEST 4: Production Startup Validation — Missing Database / Redis URL ────
  test('TEST 4: Production validation fails when DATABASE_URL or REDIS_URL is absent or malformed', () => {
    const noDbConfig = {
      isProduction: true,
      APP_ENV: 'production',
      JWT_SECRET: 'a_very_strong_production_random_secret_string_987654321',
      DATABASE_URL: '',
      REDIS_URL: '',
      PAYMENT_MODE: 'test',
    };

    const result = validateEnvironment(noDbConfig);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('DATABASE_URL is required'))).toBe(true);
    expect(result.errors.some(e => e.includes('REDIS_URL is required'))).toBe(true);

    const badPrefixConfig = {
      isProduction: true,
      APP_ENV: 'production',
      JWT_SECRET: 'a_very_strong_production_random_secret_string_987654321',
      DATABASE_URL: 'mysql://root:pass@localhost:3306/db',
      REDIS_URL: 'http://localhost:6379',
      PAYMENT_MODE: 'test',
    };

    const resBad = validateEnvironment(badPrefixConfig);
    expect(resBad.valid).toBe(false);
    expect(resBad.errors.some(e => e.includes('postgresql:// or postgres://'))).toBe(true);
    expect(resBad.errors.some(e => e.includes('redis:// or rediss://'))).toBe(true);
  });

  // ── TEST 5: Live Payment Rails Startup Validation ───────────────────────────
  test('TEST 5: Live payment mode strictly requires rzp_live_ keys and webhook secret without fallback', () => {
    // Missing live keys
    const noLiveKeys = {
      isProduction: true,
      APP_ENV: 'production',
      JWT_SECRET: 'a_very_strong_production_random_secret_string_987654321',
      DATABASE_URL: 'postgresql://prod_user:strong_password@db.prod.internal:5432/agentpay_prod',
      REDIS_URL: 'redis://:strong_redis_pass@redis.prod.internal:6379',
      PAYMENT_MODE: 'live',
      RAZORPAY_LIVE_KEY_ID: '',
      RAZORPAY_LIVE_KEY_SECRET: '',
      RAZORPAY_LIVE_WEBHOOK_SECRET: '',
    };

    const res1 = validateEnvironment(noLiveKeys);
    expect(res1.valid).toBe(false);
    expect(res1.errors.some(e => e.includes('RAZORPAY_LIVE_KEY_ID and RAZORPAY_LIVE_KEY_SECRET are required'))).toBe(true);

    // Using test key in live mode
    const testKeyInLive = {
      isProduction: true,
      APP_ENV: 'production',
      JWT_SECRET: 'a_very_strong_production_random_secret_string_987654321',
      DATABASE_URL: 'postgresql://prod_user:strong_password@db.prod.internal:5432/agentpay_prod',
      REDIS_URL: 'redis://:strong_redis_pass@redis.prod.internal:6379',
      PAYMENT_MODE: 'live',
      RAZORPAY_LIVE_KEY_ID: 'rzp_test_invalid_for_live',
      RAZORPAY_LIVE_KEY_SECRET: 'test_secret',
      RAZORPAY_LIVE_WEBHOOK_SECRET: 'whsec_test',
    };

    const res2 = validateEnvironment(testKeyInLive);
    expect(res2.valid).toBe(false);
    expect(res2.errors.some(e => e.includes('cannot be a test sandbox key (rzp_test_*)'))).toBe(true);
  });

  // ── TEST 6: RazorpayTestProvider Rejects Live Key Fail-Closed ─────────────────
  test('TEST 6: RazorpayTestProvider throws SECURITY VIOLATION if passed live credentials', () => {
    expect(() => {
      new RazorpayTestProvider({
        keyId: 'rzp_live_dangerous_attempt_in_test_provider',
        keySecret: 'sec_test_secret',
      });
    }).toThrow(/SECURITY VIOLATION/);
  });

  // ── TEST 7: Valid Production Configuration ──────────────────────────────────
  test('TEST 7: Valid production configuration passes all startup assertions', () => {
    const validConfig = {
      isProduction: true,
      APP_ENV: 'production',
      JWT_SECRET: 'strong_entropy_cryptographic_key_production_2026_x99_secure',
      DATABASE_URL: 'postgresql://prod_user:strong_password@db.prod.internal:5432/agentpay_prod',
      REDIS_URL: 'redis://:strong_redis_pass@redis.prod.internal:6379',
      PAYMENT_MODE: 'live',
      RAZORPAY_LIVE_KEY_ID: 'rzp_live_production_key_id_99',
      RAZORPAY_LIVE_KEY_SECRET: 'production_secret_live_entropy_99',
      RAZORPAY_LIVE_WEBHOOK_SECRET: 'whsec_live_webhook_secret_99',
    };

    const result = validateEnvironment(validConfig);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  // ── TEST 8: Telemetry & Config Redaction ─────────────────────────────────────
  test('TEST 8: getSanitizedConfig masks all sensitive credentials and secrets', () => {
    const rawConfig = {
      APP_ENV: 'production',
      NODE_ENV: 'production',
      PORT: 5050,
      DATABASE_URL: 'postgresql://dbadmin:super_secret_db_pass@db.internal:5432/agentpay',
      REDIS_URL: 'redis://:redis_secret_pass@redis.internal:6379',
      JWT_SECRET: 'super_secret_jwt_token_entropy_998877665544',
      JWT_EXPIRES_IN: '24h',
      PAYMENT_MODE: 'live',
      isLiveMode: true,
      isTestMode: false,
      livePaymentsActive: true,
      LIVE_AUTONOMOUS_COMMERCE_MODE: 'limited',
      RAZORPAY_LIVE_KEY_ID: 'rzp_live_abcdef123456',
      RAZORPAY_LIVE_KEY_SECRET: 'super_secret_razorpay_key_secret',
      RAZORPAY_LIVE_WEBHOOK_SECRET: 'super_secret_webhook_signature_secret',
      RAZORPAY_TEST_KEY_ID: 'rzp_test_abcdef123456',
      RAZORPAY_TEST_KEY_SECRET: 'test_key_secret',
      RAZORPAY_TEST_WEBHOOK_SECRET: 'test_whsec',
      GEMINI_API_KEY: 'AIzaSySecretApiKey1234567890',
      GOOGLE_CLIENT_ID: 'client_id_12345.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'google_oauth_secret_abc123',
      isProduction: true,
      isDevelopment: false,
      hasLiveRazorpayKeys: true,
    };

    const sanitized = getSanitizedConfig(rawConfig);

    // Verify secrets are redacted
    expect(sanitized.JWT_SECRET).toContain('[REDACTED:');
    expect(sanitized.JWT_SECRET).not.toContain('super_secret_jwt_token');
    expect(sanitized.DATABASE_URL).toContain(':***@');
    expect(sanitized.DATABASE_URL).not.toContain('super_secret_db_pass');
    expect(sanitized.REDIS_URL).toContain(':***@');
    expect(sanitized.REDIS_URL).not.toContain('redis_secret_pass');
    expect(sanitized.RAZORPAY_LIVE_KEY_SECRET).toContain('[REDACTED:');
    expect(sanitized.RAZORPAY_LIVE_WEBHOOK_SECRET).toContain('[REDACTED:');
    expect(sanitized.GOOGLE_CLIENT_SECRET).toContain('[REDACTED:');
    expect(sanitized.GEMINI_API_KEY).toContain('[REDACTED:');
  });

  // ── TEST 9: Logger Context Sanitization ──────────────────────────────────────
  test('TEST 9: sanitizeLogContext redacts passwords, tokens, and secrets from log objects', () => {
    const rawContext = {
      userId: 'usr_123',
      action: 'LOGIN',
      password: 'plain_user_password_123',
      token: 'jwt_bearer_token_abc_xyz',
      authorization: 'Bearer secret_token_data',
      razorpay_key_secret: 'rzp_secret_998877',
      nested: {
        api_key_hash: 'hash_secret_123',
        safeProperty: 'safeValue',
      },
    };

    const cleanContext = sanitizeLogContext(rawContext);

    expect(cleanContext.userId).toBe('usr_123');
    expect(cleanContext.password).toBe('[REDACTED]');
    expect(cleanContext.token).toBe('[REDACTED]');
    expect(cleanContext.authorization).toBe('[REDACTED]');
    expect(cleanContext.razorpay_key_secret).toBe('[REDACTED]');
    expect(cleanContext.nested.api_key_hash).toBe('[REDACTED]');
    expect(cleanContext.nested.safeProperty).toBe('safeValue');
  });

  // ── TEST 10: Public API Endpoints Never Expose Private Secrets ──────────────
  test('TEST 10: Public API endpoints (/api/merchants, /api/system/environment) never expose secret keys', async () => {
    const envRes = await request(app).get('/api/system/environment');
    expect(envRes.status).toBe(200);
    expect(envRes.body.RAZORPAY_KEY_SECRET).toBeUndefined();
    expect(envRes.body.JWT_SECRET).toBeUndefined();
    expect(envRes.body.DATABASE_URL).toBeUndefined();

    const merchRes = await request(app).get('/api/merchants');
    expect(merchRes.status).toBe(200);
    if (merchRes.body.merchants && merchRes.body.merchants.length > 0) {
      for (const m of merchRes.body.merchants) {
        expect(m.api_key_hash).toBeUndefined();
        expect(m.webhook_secret_hash).toBeUndefined();
        expect(m.api_key_secret).toBeUndefined();
      }
    }
  });

  // ── TEST 11: Gitignore Verification for Secrets ─────────────────────────────
  test('TEST 11: .gitignore explicitly ignores .env and secret files across all subdirectories', () => {
    const gitignorePath = path.join(__dirname, '..', '..', '.gitignore');
    const content = fs.readFileSync(gitignorePath, 'utf8');

    expect(content).toMatch(/\.env/);
    expect(content).toMatch(/\*\.key/);
    expect(content).toMatch(/secrets\//);
  });
});

