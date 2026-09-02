import request from 'supertest';
import app from '../src/index.js';
import { SCENARIOS, executeSecurityScenario } from '../src/services/securityTestService.js';
import { query } from '../src/config/database.js';

describe('Track 01: Security Attack Lab 7-Scenario Audit & Defensive Controls Suite', () => {
  // ── TEST 1: Scenario A - Over Budget Attack ────────────────────────────────
  test('SCENARIO A (Over Budget): Autonomous transaction exceeding max limit is strictly BLOCKED with zero payment orders', async () => {
    const res = await executeSecurityScenario('over_budget');

    expect(res.passed).toBe(true);
    expect(res.actualDecision).toBe('BLOCK');
    expect(res.expectedDecision).toBe('BLOCK');
    expect(res.negativeAssertions.paymentOrderCreated).toBe(false);
    expect(res.negativeAssertions.transactionCreated).toBe(false);
    expect(res.negativeAssertions.orderConfirmed).toBe(false);
    expect(res.negativeAssertions.unauthorizedSpendPrevented).toBe(true);
    expect(res.steps.detection).toMatch(/exceeds/i);
  });

  // ── TEST 2: Scenario B - Approval Threshold Escalation ─────────────────────
  test('SCENARIO B (Approval Threshold): Transaction between autonomous ceiling and hard limit escalates to APPROVAL_REQUIRED', async () => {
    const res = await executeSecurityScenario('approval_threshold');

    expect(res.passed).toBe(true);
    expect(res.actualDecision).toBe('APPROVAL_REQUIRED');
    expect(res.expectedDecision).toBe('APPROVAL_REQUIRED');
    expect(res.negativeAssertions.autonomousPaymentAuthorized).toBe(false);
    expect(res.negativeAssertions.approvalRequired).toBe(true);
    expect(res.negativeAssertions.humanAuthorizationEscalated).toBe(true);
  });

  // ── TEST 3: Scenario C - Price Manipulation Attack ─────────────────────────
  test('SCENARIO C (Price Manipulation): Price surge beyond 2% tolerance is caught and BLOCKED with zero financial loss', async () => {
    const res = await executeSecurityScenario('price_manipulation');

    expect(res.passed).toBe(true);
    expect(res.actualDecision).toBe('BLOCK');
    expect(res.expectedDecision).toBe('BLOCK');
    expect(res.negativeAssertions.priceTamperAccepted).toBe(false);
    expect(res.negativeAssertions.paymentOrderCreated).toBe(false);
    expect(res.negativeAssertions.financialDeviationBlocked).toBe(true);
    expect(res.steps.detection).toMatch(/tolerance/i);
  });

  // ── TEST 4: Scenario D - Duplicate Payment Replay Attack ───────────────────
  test('SCENARIO D (Duplicate Replay): Replayed purchase intent in 5-minute window is BLOCKED by idempotency boundary', async () => {
    const res = await executeSecurityScenario('duplicate_payment');

    expect(res.passed).toBe(true);
    expect(res.actualDecision).toBe('BLOCK');
    expect(res.expectedDecision).toBe('BLOCK');
    expect(res.negativeAssertions.duplicateFinancialChargeCreated).toBe(false);
    expect(res.negativeAssertions.duplicateOrdersCreated).toBe(0);
    expect(res.negativeAssertions.replayedIntentRejected).toBe(true);
  });

  // ── TEST 5: Scenario E - Prompt Injection Jailbreak Defense ────────────────
  test('SCENARIO E (Prompt Injection): Adversarial merchant instruction is treated as untrusted data and BLOCKED', async () => {
    const res = await executeSecurityScenario('prompt_injection');

    expect(res.passed).toBe(true);
    expect(res.actualDecision).toBe('BLOCK');
    expect(res.expectedDecision).toBe('BLOCK');
    expect(res.negativeAssertions.llmInstructionBypassedPolicy).toBe(false);
    expect(res.negativeAssertions.administrativeOverrideGranted).toBe(false);
    expect(res.negativeAssertions.policyEngineRemainedAuthoritative).toBe(true);
  });

  // ── TEST 6: Scenario F - Disabled Agent Spend Attempt ──────────────────────
  test('SCENARIO F (Disabled Agent): Inactive or revoked agent is strictly BLOCKED from initiating financial operations', async () => {
    const res = await executeSecurityScenario('disabled_agent');

    expect(res.passed).toBe(true);
    expect(res.actualDecision).toBe('BLOCK');
    expect(res.expectedDecision).toBe('BLOCK');
    expect(res.negativeAssertions.revokedAgentAllowed).toBe(false);
    expect(res.negativeAssertions.paymentAuthorized).toBe(false);
    expect(res.negativeAssertions.accessControlEnforced).toBe(true);
    expect(res.policyEvaluation.rule).toBe('AGENT_DISABLED');
  });

  // ── TEST 7: Scenario G - Emergency Kill Switch Interlock ───────────────────
  test('SCENARIO G (Kill Switch): Global emergency halt blocks purchases and cleanly resumes upon deactivation', async () => {
    const res = await executeSecurityScenario('kill_switch');

    expect(res.passed).toBe(true);
    expect(res.actualDecision).toBe('BLOCK');
    expect(res.negativeAssertions.purchasesAllowedDuringKillSwitch).toBe(false);
    expect(res.negativeAssertions.globalEmergencyHaltEnforced).toBe(true);
    expect(res.negativeAssertions.normalCommerceResumedOnDeactivation).toBe(true);

    // Verify kill switch is confirmed deactivated in DB after test
    const sysRes = await query('SELECT kill_switch_active FROM system_state WHERE id = 1');
    expect(sysRes.rows[0].kill_switch_active).toBe(false);
  });

  // ── TEST 8: API Route Endpoint Full Verification ──────────────────────────
  test('TEST 8: Security Lab HTTP endpoints return all 7 scenarios and forensic 5-step traces', async () => {
    const listRes = await request(app).get('/api/security-tests/scenarios');
    expect(listRes.status).toBe(200);
    expect(listRes.body.scenarios.length).toBe(7);

    // Test POST /api/security-tests/:scenarioId
    for (const scenario of SCENARIOS) {
      const execRes = await request(app)
        .post(`/api/security-tests/${scenario.id}`)
        .send();

      expect(execRes.status).toBe(200);
      expect(execRes.body.scenarioId).toBe(scenario.id);
      expect(execRes.body.passed).toBe(true);
      expect(execRes.body.steps).toBeDefined();
      expect(execRes.body.steps.input).toBeDefined();
      expect(execRes.body.steps.detection).toBeDefined();
      expect(execRes.body.steps.policy).toBeDefined();
      expect(execRes.body.steps.action).toBeDefined();
      expect(execRes.body.steps.result).toBeDefined();
      expect(execRes.body.negativeAssertions).toBeDefined();
    }
  });
});
