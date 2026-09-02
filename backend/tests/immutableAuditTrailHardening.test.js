import request from 'supertest';
import app from '../src/index.js';
import { query } from '../src/config/database.js';
import {
  recordAuditEvent,
  sanitizeAuditMetadata,
  verifyAuditTrailImmutability,
} from '../src/services/auditService.js';
import { generateAccessToken } from '../src/utils/authUtils.js';

describe('Track 01: Append-Only Immutable Audit Trail & Database Enforcement Suite', () => {
  let adminToken;
  let buyerToken;
  let testEventId;

  beforeAll(async () => {
    adminToken = generateAccessToken({
      id: '00000000-0000-0000-0000-000000000001',
      email: 'admin_audit_test@agentpay.internal',
      role: 'ADMIN',
    });

    buyerToken = generateAccessToken({
      id: '00000000-0000-0000-0000-000000000002',
      email: 'buyer_audit_test@agentpay.internal',
      role: 'BUYER',
    });

    // Create baseline test audit event
    const event = await recordAuditEvent({
      eventType: 'SECURITY_AUDIT_BASELINE',
      actor: 'system_test',
      action: 'INITIALIZE_IMMUTABLE_TEST',
      decision: 'ALLOW',
      reasoning: 'Verifying database trigger constraints on append-only audit trail',
      outcome: 'INITIALIZED',
      metadata: { initial: true },
    });

    testEventId = event.id;
  });

  // ── TEST 1: Database-Level Trigger Blocks Direct UPDATE ─────────────────────
  test('TEST 1: PostgreSQL trigger strictly blocks direct UPDATE operations on audit_events', async () => {
    let updateError = null;

    try {
      await query("UPDATE audit_events SET outcome = 'TAMPERED_OUTCOME' WHERE id = $1", [testEventId]);
    } catch (err) {
      updateError = err;
    }

    expect(updateError).not.toBeNull();
    expect(updateError.message).toMatch(/SECURITY VIOLATION: audit_events table is append-only/i);

    // Verify row was NOT modified
    const checkRes = await query('SELECT outcome FROM audit_events WHERE id = $1', [testEventId]);
    expect(checkRes.rows[0].outcome).toBe('INITIALIZED');
  });

  // ── TEST 2: Database-Level Trigger Blocks Direct DELETE ─────────────────────
  test('TEST 2: PostgreSQL trigger strictly blocks direct DELETE operations on audit_events', async () => {
    let deleteError = null;

    try {
      await query('DELETE FROM audit_events WHERE id = $1', [testEventId]);
    } catch (err) {
      deleteError = err;
    }

    expect(deleteError).not.toBeNull();
    expect(deleteError.message).toMatch(/SECURITY VIOLATION: audit_events table is append-only/i);

    // Verify row still exists
    const checkRes = await query('SELECT id FROM audit_events WHERE id = $1', [testEventId]);
    expect(checkRes.rows.length).toBe(1);
  });

  // ── TEST 3: HTTP API Rejects Mutating Requests with 405 Method Not Allowed ──
  test('TEST 3: Application HTTP API rejects PUT, PATCH, and DELETE operations on audit routes with 405', async () => {
    // Attempt PUT
    const putRes = await request(app)
      .put(`/api/audit/${testEventId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ outcome: 'TAMPERED' });

    expect(putRes.status).toBe(405);
    expect(putRes.body.code).toBe('IMMUTABLE_AUDIT_LOG');

    // Attempt DELETE
    const delRes = await request(app)
      .delete(`/api/audit/${testEventId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(delRes.status).toBe(405);
    expect(delRes.body.code).toBe('IMMUTABLE_AUDIT_LOG');

    // Attempt POST
    const postRes = await request(app)
      .post('/api/audit')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ eventType: 'FORGED_EVENT' });

    expect(postRes.status).toBe(405);
    expect(postRes.body.code).toBe('IMMUTABLE_AUDIT_LOG');
  });

  // ── TEST 4: Normal Financial Operations Produce Complete Audit Records ─────
  test('TEST 4: State machine events record complete compliance metadata on audit_events', async () => {
    const event = await recordAuditEvent({
      eventType: 'PURCHASE_INTENT_AUTHORIZED',
      actor: 'policy_engine',
      agentId: '00000000-0000-0000-0000-000000000003',
      userId: '00000000-0000-0000-0000-000000000002',
      transactionId: '00000000-0000-0000-0000-000000000004',
      purchaseIntentId: '00000000-0000-0000-0000-000000000005',
      action: 'EVALUATE_POLICY_BOUNDARIES',
      decision: 'ALLOW',
      policyVersion: 'v1.2',
      reasoning: 'Requested spend ₹14,999 is within ₹25,000 autonomous ceiling',
      riskScore: 12,
      outcome: 'POLICY_AUTHORIZED',
      environment: 'TEST',
      paymentMode: 'TEST',
      metadata: { category: 'Electronics', item: 'Dell Workstation Display' },
    });

    expect(event.id).toBeDefined();
    expect(event.event_type).toBe('PURCHASE_INTENT_AUTHORIZED');
    expect(event.actor).toBe('policy_engine');
    expect(event.decision).toBe('ALLOW');
    expect(event.policy_version).toBe('v1.2');
    expect(event.environment).toBe('TEST');
    expect(event.payment_mode).toBe('TEST');
    expect(event.risk_score).toBe(12);
  });

  // ── TEST 5: Secret Sanitization Redacts Sensitive Credentials ──────────────
  test('TEST 5: sanitizeAuditMetadata automatically redacts passwords, tokens, API keys, and secrets', () => {
    const payloadWithSecrets = {
      user: 'alice@example.com',
      password: 'SuperSecretPassword123!',
      apiKey: 'rzp_live_secret_api_key_value_9999',
      keySecret: 'top_secret_hmac_key_abcd',
      nested: {
        authorizationToken: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-IDcSemACt8x4iTMCda8Yhe3iZaWbvV5XKSTbuAn0M',
        card_number: '4111222233334444',
        cvv: '999',
        publicNote: 'Clean public order description',
      },
    };

    const sanitized = sanitizeAuditMetadata(payloadWithSecrets);

    expect(sanitized.user).toBe('alice@example.com');
    expect(sanitized.password).toMatch(/\[REDACTED/);
    expect(sanitized.apiKey).toMatch(/\[REDACTED/);
    expect(sanitized.keySecret).toMatch(/\[REDACTED/);
    expect(sanitized.nested.authorizationToken).toMatch(/\[REDACTED/);
    expect(sanitized.nested.card_number).toMatch(/\[REDACTED/);
    expect(sanitized.nested.cvv).toMatch(/\[REDACTED/);
    expect(sanitized.nested.publicNote).toBe('Clean public order description');
  });

  // ── TEST 6: Mandatory Compliance Logging Fails Closed on Error ─────────────
  test('TEST 6: Compliance logging strictly throws on persistence failure when strict mode is active', async () => {
    // Attempt inserting with an invalid column value / non-existent type causing DB error
    await expect(
      recordAuditEvent({
        eventType: null, // NOT NULL column constraint violation
        actor: 'system',
        action: 'TEST_FAILURE',
        strict: true,
      })
    ).rejects.toThrow(/COMPLIANCE AUDIT FAILURE/i);
  });

  // ── TEST 7: verifyAuditTrailImmutability Self-Testing Utility ───────────────
  test('TEST 7: verifyAuditTrailImmutability() confirms database trigger blocks mutation probes', async () => {
    const immutabilityReport = await verifyAuditTrailImmutability();

    expect(immutabilityReport.probeId).toBeDefined();
    expect(immutabilityReport.updateBlocked).toBe(true);
    expect(immutabilityReport.deleteBlocked).toBe(true);
    expect(immutabilityReport.immutable).toBe(true);
  });
});
