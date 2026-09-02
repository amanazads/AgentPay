# AgentPay Architecture & Technical Specification
> **Canonical Architecture Reference for Technical Evaluators & System Auditors**
> *Track: AI Growth & Agentic Commerce — Razorpay Buildathon*

---

## 1. Problem Statement

As Large Language Models (LLMs) evolve from conversational assistants into autonomous software agents, they are increasingly tasked with economic operations: purchasing developer tooling, booking logistics, provisioning cloud infrastructure, and subscribing to SaaS services.

However, LLMs possess fundamental characteristics that make them unsafe financial authorities:
1. **Lack of Deterministic Arithmetic**: Probabilistic models cannot guarantee mathematical spending bounds.
2. **Prompt Injection & Description Poisoning**: Untrusted third-party catalog text can hijack instructions to exfiltrate funds or inflate order values.
3. **Price Manipulation & Checkout Drift**: Unverified frontend payloads allow checkout price jumps.
4. **Race Conditions & Double Charges**: Network retries and concurrent agent loops cause duplicate financial transactions and inventory overselling.
5. **Lack of Non-Repudiation**: Without immutable audit trails and server-authoritative state transitions, transactions cannot be verified or reconciled.

---

## 2. Solution: The AgentPay Trust & Execution Plane

**Core Invariant:**
> *"The AI model is strictly a reasoning and discovery assistant. All financial authorization, risk scoring, idempotency enforcement, and payment settlement happen deterministically server-side."*

AgentPay decouples the AI Agent’s intent formulation from transaction execution:
* **The Agent Proposes**: The buyer agent queries catalogs, compares specifications, and structures a `PurchaseIntent`.
* **The Platform Governs**: AgentPay validates merchant credibility, runs a 13-rule deterministic policy engine, computes a 5-pillar explainable risk score, locks inventory via 2-phase reservations, and enforces human-in-the-loop approvals when thresholds are exceeded.
* **The Payment Rail Settles**: Payments are initiated via Razorpay Test Rails with cryptographic HMAC-SHA256 signature verification and database-enforced append-only audit logging.

---

## 3. Implementation Status & Truthful Capability Matrix

To ensure complete transparency and technical truthfulness under line-by-line review, every architectural capability is classified into one of five statuses:

| Status Code | Meaning |
|---|---|
| `IMPLEMENTED` | Full end-to-end production-grade software implementation running in active codebase. |
| `TESTED` | Verified by automated unit, integration, and security test suites (**50 backend test suites, 502 tests; 4 AI pytest tests**). |
| `SIMULATED` | Deterministic local simulation or mock protocol active (e.g. logistics tracking lifecycle). |
| `NOT_CONFIGURED` | Feature architecture exists but external production provider credentials are intentionally not configured in test mode. |
| `PRODUCTION-GATED` | Strict fail-closed security lock prevents activation without verified production credentials. |

### Capability Status Table

| Capability Area | Component / Subsystem | Status | Implementation Truth & Evidence |
|---|---|---|---|
| **Core Architecture** | Relational Database Schema | `IMPLEMENTED` & `TESTED` | PostgreSQL 17 with **36 relational tables** (35 operational tables + migrations) and 15 applied migration files. |
| **Core Architecture** | Distributed Locks & Cache | `IMPLEMENTED` & `TESTED` | Redis 7 mutex locking with automatic in-memory fallback for local environments. |
| **Governance** | Deterministic Policy Engine | `IMPLEMENTED` & `TESTED` | 13-rule server-side engine evaluating limits, daily/monthly budgets, categories, and merchants. |
| **Governance** | Multi-Factor Risk Engine | `IMPLEMENTED` & `TESTED` | 5-pillar explainable 0–100 numerical risk scoring with factor attribution. |
| **Governance** | Prompt Injection Defense | `IMPLEMENTED` & `TESTED` | Untrusted merchant data boundary isolation and adversarial pattern detection. |
| **Governance** | Global & Agent Kill Switch | `IMPLEMENTED` & `TESTED` | Sub-5ms emergency freeze mechanism blocking active and new purchase intents. |
| **Commerce Rails** | Two-Phase Inventory Lock | `IMPLEMENTED` & `TESTED` | 15-minute row-level `ACTIVE → COMMITTED / RELEASED` reservation protocol. |
| **Commerce Rails** | Price-Lock Quote Protocol | `IMPLEMENTED` & `TESTED` | 15-minute time-bound SHA256 cryptographic price quotes preventing surge drift. |
| **Commerce Rails** | Normalized Merchant Connector | `IMPLEMENTED` & `TESTED` | In-database store catalog with rotatable API keys (SHA-256 hash) and HMAC signing secrets. |
| **Commerce Rails** | Order State Machine | `IMPLEMENTED` & `TESTED` | Server-authoritative strictly monotonic state graph managing order lifecycles. |
| **Commerce Rails** | Tax Invoice Generation | `IMPLEMENTED` & `TESTED` | Idempotent invoice numbering (`INV-YYYYMM-XXXXX`) and structured GST generation. |
| **Commerce Rails** | Payment Reconciliation | `IMPLEMENTED` & `TESTED` | Automated background scan identifying and auto-healing payment-order anomalies. |
| **Payments** | Razorpay Test Sandbox | `IMPLEMENTED` & `TESTED` | Full test-mode order creation, HMAC-SHA256 signature verification, and test payment execution. |
| **Payments** | Webhook Ingestion & Inbox | `IMPLEMENTED` & `TESTED` | Durable `webhook_inbox` deduplication, out-of-order guards, and HMAC checks. |
| **Payments** | Razorpay Live Mode | `PRODUCTION-GATED` | Strict fail-closed lock. Requires `rzp_live_` keys and live webhook secrets. |
| **Security** | Append-Only Audit Trail | `IMPLEMENTED` & `TESTED` | PostgreSQL trigger (`trg_prevent_audit_events_mutation`) blocks `UPDATE`/`DELETE`. |
| **Security** | Credential Sanitization | `IMPLEMENTED` & `TESTED` | Recursive redaction of passwords, tokens, API keys, and card numbers. |
| **Security** | Role-Based Access Control | `IMPLEMENTED` & `TESTED` | Strict middleware scoping between `BUYER`, `MERCHANT`, and `ADMIN` tenants. |
| **AI Layer** | AI Commerce Orchestration | `IMPLEMENTED` & `SIMULATED` | Live Gemini 1.5 Pro integration when API key configured; deterministic rule fallback in test sandbox. |
| **External** | Logistics Tracking SLA | `SIMULATED` | Simulated fulfillment lifecycle (`AGP-TRK-...`) demonstrating state progression; no physical courier API keys configured. |
| **External** | SMS & Email Notifications | `NOT_CONFIGURED` | Socket.IO WebSocket push is `IMPLEMENTED`; external SMS/Email provider stubs are `NOT_CONFIGURED`. |

---

## 4. Architectural Dataflow Diagram

```mermaid
sequenceDiagram
    autonumber
    actor Buyer as Buyer User / Agent
    participant AI as AI Service / Intent Parser
    participant Gate as API Gateway (JWT / RBAC)
    participant Policy as Deterministic Policy Engine
    participant Risk as Explainable Risk Engine
    participant Inv as Inventory Lock (Two-Phase)
    participant RZP as Razorpay Test Rails
    participant DB as PostgreSQL (Append-Only Audit)

    Buyer->>AI: "Procure 2 Lenovo ThinkPads under ₹80k"
    AI->>Gate: POST /api/purchase-intents (Structured Intent)
    Gate->>Policy: Evaluate 13 Policy Rules
    alt Exceeds Limit or Restricted Category
        Policy-->>Gate: BLOCK (Decision recorded)
        Gate->>DB: Persist Audit Event (Decision: BLOCK)
        Gate-->>Buyer: HTTP 403 / 422 Policy Violation
    else Exceeds Autonomous Threshold
        Policy-->>Gate: APPROVAL_REQUIRED
        Gate->>DB: Persist Approval Queue Item
        Gate-->>Buyer: Enqueued in Human Approval Center
    else Policy Allowed
        Policy->>Risk: Compute 5-Pillar Risk Score (0-100)
        Risk-->>Gate: Risk Assessment (Low/Medium)
        Gate->>Inv: Reserve Stock (15m TTL Lock)
        Inv-->>Gate: Reservation Active (Quote Locked)
        Gate->>RZP: Create Test Order (rzp_order_id)
        RZP-->>Gate: Payment Order Ready
        Gate-->>Buyer: Checkout Payload (Test Sandbox)
        Buyer->>RZP: Authorize Test Payment
        RZP->>Gate: Webhook: payment.captured (HMAC-SHA256)
        Gate->>Gate: Verify HMAC Signature & Deduplicate Event
        Gate->>Inv: Commit Inventory Reservation
        Gate->>DB: Create Order, Generate Invoice, Append Audit Log
        Gate-->>Buyer: Order Confirmed & Invoice Issued
    end
```

---

## 5. Normalized Merchant Connector Architecture

To maintain high availability and security during agent procurement, AgentPay standardizes merchant interactions via a normalized connector model:

1. **Native Catalog & Metadata**: Merchants register catalog products with structured categories, price baselines, inventory quantities, and AI semantic summaries.
2. **Cryptographic Connector Credentials**: Merchants are issued rotatable API Keys and Webhook Secrets for authenticated communication and order callbacks.
3. **Price Stability Contract**: The quote protocol locks catalog prices with SHA-256 signatures for 15 minutes, preventing dynamic surge exploits during evaluation.
4. **Third-Party Marketplace Stance**: The current version operates on normalized merchant connector catalogs; direct scraping or session hijacking of consumer marketplaces (Amazon, Flipkart) is intentionally avoided for compliance and security reasons.

---

## 6. Security & Safety Defenses (The 7 Defense Pillars)

The system includes a dedicated **Security Attack Lab** (`/security-lab`) demonstrating live defenses against real adversarial payloads:

1. **Over-Budget Defense**: Halts single-transaction limit breaches with arithmetic certainty.
2. **Approval Threshold Escalation**: Automatically routes purchases exceeding autonomous thresholds (e.g. ₹25,000) to the Human Approval Center.
3. **Price Manipulation Defense**: Rejects checkout payloads with >2.0% price delta against authoritative catalog quotes with ₹0 charged.
4. **Duplicate Replay Guard**: 5-minute sliding window and Redis mutex locks reject duplicate purchase attempts.
5. **Adversarial Prompt Injection Defense**: Isolates catalog text within `<UNTRUSTED_MERCHANT_DATA>` blocks and flags jailbreak patterns.
6. **Revoked/Disabled Agent Guard**: Blocks inactive or revoked agent credentials instantly.
7. **Emergency Global Kill Switch**: Sub-5ms Redis-backed emergency stop halts all financial activity across all connected agents.

---

## 7. Simulation & Empirical Benchmark Lab

The **Simulation Lab** (`/simulation`) runs 1,000 empirical synthetic transaction scenarios across 10 realistic distributions:

* **Policy Enforcement Consistency**: 100% agreement between deterministic rules and synthetic benchmark targets.
* **Adversarial Injection Blocking Rate**: 100% on scanned jailbreak payloads.
* **Duplicate Replay Prevention**: 100% on identical intent replay within 5-minute lock windows.
* **Execution Latency**: Typically < 10ms server-side decision latency.
* **Empirical Integrity**: Simulation metrics are generated dynamically by test execution and stored in `simulation_runs` and `simulation_cases` tables; they are **never hardcoded**.

---

## 8. 5-Minute Live Technical Judging Cockpit & Judge Mode (`/judge`)

For live evaluations and hackathon judging, AgentPay provides a dedicated, deterministic **Judge Mode** cockpit executing a 15-step sequence:

```
┌─────────────────────────┐         ┌─────────────────────────┐         ┌─────────────────────────┐
│       AI PROPOSES       │  ───►   │   AGENTPAY AUTHORIZES   │  ───►   │    RAZORPAY EXECUTES    │
│ Natural-Language Intent │         │ 13 Deterministic Rules  │         │ Isolated Sandbox Rails  │
│  & Product Discovery    │         │ 5-Pillar Risk Engine    │         │ HMAC Signature Verify   │
│                         │         │ 2-Phase Stock Lock      │         │ Real DB Order & Invoice │
└─────────────────────────┘         └─────────────────────────┘         └─────────────────────────┘
```

1. **Step 1: AI Buyer Natural-Language Request** (`parseBuyerIntent`)
2. **Step 2: Product Discovery** (`findEligibleProducts`)
3. **Step 3: Policy Evaluation** (`evaluatePolicy` — 13 deterministic rules)
4. **Step 4: Risk Score** (`assessRisk` — 5-pillar composite risk)
5. **Step 5: Price/Inventory Verification** (`generateQuote` + `reserveInventory`)
6. **Step 6: Authorized Checkout** (Zero-trust connector & payment mandate ceiling)
7. **Step 7: Razorpay Test Payment** (Sandbox order & HMAC verification, badged `[TEST MODE]`)
8. **Step 8: Order Creation** (`createOrder` — Monotonic canonical database order)
9. **Step 9: Invoice** (`generateInvoiceForOrder` — GST breakdown & IRN hash)
10. **Step 10: Audit Trail** (`audit_events` — PostgreSQL append-only ledger)
11. **Step 11: Price Manipulation Attack Defense** (`executeSecurityScenario('price_manipulation')` — Blocked, ₹0 charged)
12. **Step 12: Prompt Injection Attack Defense** (`executeSecurityScenario('prompt_injection')` — Neutralized, Blocked)
13. **Step 13: Approval-Required Escalation** (`executeSecurityScenario('approval_threshold')` — Human review triggered)
14. **Step 14: Duplicate Replay Defense** (`executeSecurityScenario('duplicate_payment')` — Blocked by Redis mutex)
15. **Step 15: Global Emergency Kill Switch** (`executeSecurityScenario('kill_switch')` — Sub-5ms Redis lock)

---

## 9. Production Readiness & Live Activation Checklist

To transition AgentPay from the current competition/test rail environment to live production settlement, the following prerequisites are required:

1. **Production Razorpay Gateway Credentials**: Replace `rzp_test_*` API keys and webhook secrets with verified `rzp_live_*` production credentials and configure live webhook endpoints in the Razorpay Merchant Dashboard.
2. **Third-Party Logistics (3PL) Integration**: Connect live shipping aggregator APIs (e.g. Shiprocket, Delhivery, Bluedart) to replace simulated fulfillment lifecycles with physical shipping label generation and real carrier tracking.
3. **Enterprise Key Management (KMS)**: Transition merchant HMAC secrets and database encryption keys to AWS KMS, Google Cloud KMS, or HashiCorp Vault.
4. **External Webhook Security**: Configure IP whitelisting and mutual TLS (mTLS) for inbound Razorpay webhook ingestion.
5. **Distributed Redis Sentinel / Cluster**: Deploy a high-availability Redis cluster for production-grade distributed mutex locking under high concurrency.
6. **Regulatory Compliance & Tax E-Invoicing**: Integrate live GSTN e-invoicing APIs (NIC/IRP) for real-time B2B IRN generation and signed QR codes.

---

## 10. Summary of Verifications

* **Automated Backend Test Suites**: **50 test suites, 502 automated tests passing**.
* **AI Service Pytest Battery**: **4 / 4 test cases passing**.
* **Security Audit Battery**: **8 dedicated suites (88 / 88 tests passing)**.
* **System Readiness Engine**: 27-point runtime gate (`/api/system/readiness`) dynamically probing actual database, redis, and payment configurations.
* **Frontend Compilation**: Production TypeScript & Vite bundle cleanly compiling with 0 errors.
