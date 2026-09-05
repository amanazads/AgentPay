# AgentPay Security Model & Threat Defense

## 1. Zero Trust AI Model (LLM Isolation)
* **Zero Direct Payment Authority**: The LLM / AI buyer agent possesses **0% direct execution authority** over payments, limits, or financial transactions.
* **Propose-and-Authorize Architecture**: The AI generates a structured `PurchaseIntent`. All approvals, limits, authorizations, cart validations, and payment executions occur strictly server-side within deterministic code gates.
* **Prompt Injection Defense (two independent layers)**: External merchant content (descriptions, reviews, titles, specifications, AI metadata) and buyer input are both treated as **untrusted data**.
  * **Backend guard** (`backend/src/services/promptSecurityGuard.js`) runs inside `POST /api/ai/chat` *before* the AI service is called, so the same policy applies whether the AI service is available or the request falls through to the deterministic orchestrator. It normalizes Unicode, zero-width and homoglyph obfuscation, folds separator- and leetspeak-obfuscated text, and decodes base64, hex and percent-encoded payloads before matching ~30 named rules.
  * **AI service guard** (`ai-service/agent/prompt_guard.py`) is a second, in-process check on the model side.
  * A blocked request returns `status: BLOCKED` with **no** purchase intent, quote, inventory reservation, approval or payment order, and records an audit event.
* **Detection is not the safety property.** The guard is defence in depth. Even if a novel payload evades detection, no free text anywhere in the system can move price, policy, inventory, approval state or payment authority — those are decided by deterministic code from authoritative database columns. The `securityInvariant.test.js` suite proves each of those guards refuses a compromised AI verdict *independently*.
* **LLM intent is untrusted data.** Model-proposed intent is merged, not applied: it may fill a gap or tighten a bound, but it can never raise a budget, change a quantity, relax a deterministic constraint, or introduce unrecognised keys (`mergeAiIntent`).

---

## 2. Cryptographic & Payment Security
* **Zero Raw Payment Credentials**: AgentPay never collects, stores, or logs raw PAN, CVV, OTP, UPI PIN, or banking passwords.
* **Razorpay Test Rails & HMAC-SHA256 Verification**: Payment execution runs against Razorpay Test Rails with real server-side HMAC-SHA256 signature verification (live backend processing against the Razorpay sandbox/test environment, not live financial settlement). Callbacks and webhooks are validated cryptographically against canonical test secrets (`RAZORPAY_TEST_KEY_SECRET` and `RAZORPAY_TEST_WEBHOOK_SECRET`).
* **Idempotency & Double-Spend Locks**: Redis `SetNX` distributed locks enforce a 5-minute sliding window per purchase intent, preventing duplicate charges.
* **Atomic Spending Reservation**: Multi-agent concurrent purchases atomically evaluate and reserve limits from persisted successful/pending state, preventing race-condition overspending.
* **In-Flight Kill Switch Safety**: Activation of the emergency stop safely transitions in-flight transactions to `RECONCILIATION_REQUIRED` without silent drops.

---

## 3. Authentication & Session Integrity
* **Password Hashing**: Bcrypt with 10 salt rounds. Plaintext passwords never hit the persistent database.
* **Access Tokens**: Short-lived HS256 signed JSON Web Tokens (24-hour expiry).
* **Refresh Tokens**: 40-byte cryptographically secure random tokens stored in PostgreSQL with automatic rotation.
* **HTTP-Only Cookies**: `SameSite=Lax`, `HttpOnly`, `Secure` flags prevent XSS token theft.

---

## 4. 13 Deterministic Server-Side Security Policies
1. **Emergency Kill Switch Guard**: Halts all autonomous transactions instantly on active signal.
2. **Agent Operational Status Check**: Validates buyer agent is active and not suspended.
3. **Merchant Authenticity Verification**: Rejects unverified merchant tiers.
4. **Real Inventory & Stock Confirmation**: Validates live catalog stock before order creation.
5. **Authorized Category Whitelist**: Blocks unapproved merchant categories.
6. **Restricted Category Blacklist**: Blocks prohibited merchant categories.
7. **Price Tampering Tolerance Guard**: Blocks price inflation > 2.0% against catalog baseline.
8. **Single-Transaction Ceiling Enforcer**: Halts orders exceeding maximum authorized spend.
9. **Daily & Monthly Budget Exhaustion Check**: Blocks purchases exceeding cumulative remaining budget (both daily and monthly budgets enforced server-side).
10. **Sliding-Window Idempotency Lock**: Blocks duplicate submissions within 5 minutes.
11. **Autonomous Spending Threshold Gate**: Routes orders exceeding auto-limit to human review.
12. **Cryptographic Signature Verification**: Validates HMAC-SHA256 payment signature on Razorpay Test Rails.
13. **Append-Only Audit Ledger**: Immutable audit trail protected by database mutation triggers.


---

## 5. Catalog Eligibility Boundary

A single canonical predicate (`backend/src/services/catalogEligibility.js`) decides what an AI
buyer may see and transact. Every AI-facing route uses it — there is no second, slightly
different SQL condition anywhere:

```
is_test_lab = false AND status = 'ACTIVE' AND commerce_eligible = true AND in_stock = true
```

Note the absence of any `OR ... IS NULL` escape. Unknown is not eligible; a merchant must
positively assert eligibility. Migration `017` backfills legacy NULLs to explicit safe values
and adds `NOT NULL`, so the ambiguity cannot return.

---

## 6. Payment Environment Isolation

* Sandbox settlement is only reachable through the explicit TEST-only endpoint
  `POST /api/payments/:id/sandbox-settle`, which refuses when the platform is in LIVE payment
  mode, refuses for any transaction not recorded on TEST rails, and refuses when no test key
  secret is configured. There is no "assume verified" path.
* The browser never constructs a payment signature. Signatures are computed server-side from
  the server's own key secret, or supplied by a genuine Razorpay callback.
* `RazorpayTestProvider` refuses live credentials at construction, and `RazorpayLiveProvider`
  fails closed when live credentials are absent or malformed.

---

## 7. Known Limitations

Stated explicitly rather than implied away:

* **No rate limiting.** There is no request rate limiter on the API. Earlier revisions of the
  architecture document claimed one; it was never implemented and the claim has been removed.
* **Payments are sandbox-only.** `PAYMENT_MODE` defaults to `test` and live autonomous commerce
  is disabled. No real funds move.
* **Merchant fulfilment is simulated.** Carrier and delivery data come from a demo simulation,
  not a real logistics integration.
* **Prompt-injection detection is heuristic.** It is a pattern matcher over normalized text, and
  a sufficiently novel payload may evade it. The deterministic pipeline — not the matcher — is
  what prevents unauthorized spending.
* **The AI service requires an internal token.** In production it refuses to start without
  `AI_SERVICE_INTERNAL_TOKEN`; in development it refuses requests rather than allowing them.
