# AgentPay — Autonomous AI Commerce Control Plane

[![Platform](https://img.shields.io/badge/Platform-AI%20Agent%20Commerce-blue.svg)]()
[![Track](https://img.shields.io/badge/Razorpay%20Buildathon-Track%2001-green.svg)]()
[![Architecture](https://img.shields.io/badge/Architecture-Specification-blueviolet.svg)](./ARCHITECTURE.md)
[![Security](https://img.shields.io/badge/Security-Threat%20Model-red.svg)](./SECURITY.md)
[![License](https://img.shields.io/badge/license-MIT-purple.svg)]()

> **"AI decides what to buy. AgentPay decides whether the AI is allowed to spend."**

AgentPay is a deterministic financial authorization, policy enforcement, explainable risk assessment, and payment execution control plane built specifically for autonomous AI buyer agents.

📖 Documentation Links:
* **[System Architecture & Dataflow (ARCHITECTURE.md)](./ARCHITECTURE.md)**
* **[Security Model & Threat Defense (SECURITY.md)](./SECURITY.md)**

---

## 1. Executive Summary & Problem Thesis

As autonomous AI agents evolve into independent procurement systems capable of sourcing equipment, cloud infrastructure, and software subscriptions, the fundamental vulnerability is **unbounded financial authority**.

Granting Large Language Models (LLMs) direct payment credentials or autonomous checkout authority introduces critical failure modes:
1. **Probabilistic Arithmetic**: LLMs cannot provide mathematical guarantees on budget ceilings or cumulative spending.
2. **Prompt Injection & Catalog Poisoning**: Adversarial text embedded in merchant descriptions can hijack model instructions to exfiltrate funds or alter order amounts.
3. **Price Tampering**: Unverified checkout payloads can inflate prices after intent creation.
4. **Concurrency & Double Charges**: Unsynchronized agent retry loops can cause race-condition double spending.

### The Core Architectural Invariant

```
LLM (AI Buyer Agent)
  ↓ [Natural Language Request]
Product Discovery & Comparison
  ↓ [Structured Purchase Intent (Zero Financial Authority)]
Server-Side Request Validation
  ↓
Deterministic Policy Engine (13 Rules)
  ↓
Explainable Risk Engine (0–100 Scoring, 5 Pillars)
  ↓
Transaction Decision Engine [ALLOW / APPROVAL_REQUIRED / BLOCK]
  ↓
Human-in-the-Loop Approval Center (When Thresholds Exceeded)
  ↓
Distributed Idempotency & Budget Lock (Redis Mutex)
  ↓
Razorpay Payment Service (Test Rails with HMAC-SHA256 Verification)
  ↓
Immutable Append-Only Audit Trail (PostgreSQL Trigger Protected)
```

**The AI model is strictly a reasoning and discovery assistant. All financial authorization, risk scoring, idempotency enforcement, and payment settlement occur deterministically server-side.**

---

## 2. Implementation Scope & Truthful Disclosure

To maintain complete transparency under technical review, AgentPay clearly distinguishes between the target production design and the current evaluation implementation:

| Dimension | Target Production Architecture | Current Evaluation Implementation |
|---|---|---|
| **Payment Gateway** | Production Razorpay Live Rails (`rzp_live_*`) with live financial settlement | **Razorpay Test Rails (`rzp_test_*`)** with server-side HMAC-SHA256 verification (real backend processing against the Razorpay sandbox/test environment, not live financial settlement) |
| **Merchant Integration** | Multi-tenant ERP/Store connectors & external webhooks | **Normalized In-Database Merchant Connector** (verified catalog, rotatable HMAC secrets) |
| **Fulfillment & Logistics** | Physical 3PL carrier integrations (e.g. Shiprocket, Delhivery) | **Simulated Fulfillment Lifecycle** (deterministic state machine with generated tracking tokens; physical 3PL integrations are future production targets) |
| **AI Intent Parsing** | Live Google Gemini 1.5 Pro with structured function calling | **Gemini 1.5 Pro** with deterministic rule-based offline fallback |
| **Idempotency & Locks** | Multi-node Redis 7 cluster with SetNX distributed locks | **Redis 7** mutex locking with automatic local in-memory fallback |
| **Audit Trail** | Append-only PostgreSQL with trigger protection & external sync | **PostgreSQL 17** with `trg_prevent_audit_events_mutation` trigger |

---

## 3. System Architecture & Component Dataflow

```mermaid
graph TB
    subgraph "Frontend — React + Vite (Port 5173)"
        BuyerUI[Buyer Portal & Preferences]
        MerchUI[Merchant Control Plane & Storefront]
        ApprovalUI[Human Approval Center]
        AuditUI[Audit Trail Explorer]
        AdminUI[Admin Console & Security Lab]
    end

    subgraph "Backend — Node.js + Express (Port 5050)"
        API[REST API Gateway & RBAC]
        PolicyEngine[Deterministic Policy Engine]
        RiskEngine[Explainable Risk Engine]
        DecisionEngine[Transaction Decision Engine]
        ApprovalSvc[Approval Workflow Service]
        PaymentSvc[Razorpay Payment Service]
        AuditSvc[Append-Only Audit Service]
        SpendingSvc[Atomic Spending & Budget Service]
        IdempotencyGuard[Redis Distributed Lock Guard]
        KillSwitch[Global Emergency Stop Guard]
    end

    subgraph "AI Service — Python + FastAPI (Port 8000)"
        AIAgent[AI Buyer Intent Parser]
        Tools[Catalog Discovery Tools]
        PromptGuard[Prompt Injection Scanner]
    end

    subgraph "Data & Persistence Layer"
        PG[(PostgreSQL 17 — 36 Relational Tables)]
        RD[(Redis 7 — Distributed Mutex & Idempotency)]
    end

    subgraph "Payment Processor"
        RZP[Razorpay Test Gateway Rails]
    end

    BuyerUI --> API
    MerchUI --> API
    ApprovalUI --> API
    AdminUI --> API
    API <-->|Socket.IO Real-Time Telemetry| BuyerUI

    API --> PolicyEngine
    API --> RiskEngine
    API --> DecisionEngine
    API --> ApprovalSvc
    API --> PaymentSvc
    API --> AuditSvc
    API --> SpendingSvc
    API --> KillSwitch

    API -->|HTTP REST| AIAgent
    AIAgent --> Tools
    AIAgent --> PromptGuard

    PolicyEngine --> PG
    RiskEngine --> PG
    DecisionEngine --> PolicyEngine
    DecisionEngine --> RiskEngine
    SpendingSvc --> RD
    SpendingSvc --> PG
    PaymentSvc --> IdempotencyGuard
    IdempotencyGuard --> RD
    PaymentSvc --> RZP
    AuditSvc --> PG
```

---

## 4. Normalized Merchant Connector Architecture

Rather than relying on brittle third-party web scrapers or unauthorized marketplace logins, AgentPay implements a **Normalized Merchant Connector Architecture**:

1. **Structured Merchant Registry (`merchants`)**: Stores merchant business profiles, KYC verification status, verified tier levels, and commission schedules.
2. **Standardized Product Catalog (`products`, `product_ai_metadata`)**: Normalizes product specifications, technical attributes, inventory stock levels, price tiers, and AI search embeddings.
3. **Cryptographic Connector Credentials**: Each merchant is provisioned with a rotatable API Key (`SHA-256` key hash) and a Webhook Secret (`HMAC-SHA256`) for outbound order dispatch.
4. **Two-Phase Inventory Lock**: Row-level reservation (`inventory_reservations`) locks inventory for 15 minutes during checkout to prevent overselling.
5. **Deterministic Price Quotes (`quotes`)**: 15-minute time-bound cryptographic quotes prevent price drift and checkout surge tampering.

---

## 5. Core Governance & Payment Engines

### 1. Deterministic Policy Engine (13 Rules)
Evaluates every purchase intent server-side prior to financial execution:
1. **Global Emergency Kill Switch Check** (`system_state.kill_switch_active`)
2. **Agent Operational Status Verification** (`active` vs `disabled`/`suspended`)
3. **Product Inventory & In-Stock Availability**
4. **Authorized Category Whitelist Validation** (`allowed_categories`)
5. **Restricted Category Blacklist Enforcement** (`blocked_categories`)
6. **Merchant Authenticity & Verification Tier** (`verified_merchants_only`)
7. **Price Tampering Tolerance Guard** (`price_tolerance_pct` max 2.0%)
8. **Single-Transaction Hard Spending Ceiling** (`max_transaction`)
9. **Daily & Monthly Spending Limits + Active Intent Reservation** (`daily_budget` & `monthly_budget`)
10. **5-Minute Sliding Window Duplicate Prevention**
11. **Maximum Retry Limit Enforcement**
12. **Autonomous Spending Threshold Gate** (`approval_threshold`)
13. **Deterministic Output Synthesis**: Exactly one of `ALLOW`, `APPROVAL_REQUIRED`, or `BLOCK`.

### 2. Explainable 0–100 Risk Engine
Calculates an explainable numerical risk score with granular factor weights:
* **Merchant Credibility (25% Weight)**: Verified status, historical fulfillment consistency.
* **Content Threat & Injection Detection (25% Weight)**: Adversarial pattern scanner on catalog descriptions.
* **Price Anomaly & Deep Discount Flagging (20% Weight)**: Outlier detection against historical baselines.
* **Transaction Velocity (15% Weight)**: Frequency bursts exceeding normal agent cadence.
* **Agent Behavioral Deviation (15% Weight)**: Deviation from historical mean transaction value.
* **Tiers**: `LOW` (0–39), `MEDIUM` (40–69), `HIGH` (70–100). High risk automatically escalates compliant intents to human review.

### 3. Razorpay Payment Service (Test Rails with HMAC-SHA256 Verification)
* Real backend payment-processing flow against the Razorpay sandbox/test environment.
* Creates Razorpay test orders server-side only after positive policy authorization.
* Verifies `razorpay_signature` via HMAC-SHA256 (`crypto.createHmac('sha256', secret)`).
* Validates inbound webhook events against `RAZORPAY_TEST_WEBHOOK_SECRET` with signature verification.
* Enforces distributed Redis idempotency locks (`idempotency_key = hash(intent_id + amount + policy_version)`).
* Transitions in-flight transactions safely to `RECONCILIATION_REQUIRED` if emergency stops trigger during execution.

### 4. Human-in-the-Loop Approval Center
* Intercepts purchases exceeding autonomous limits (e.g. > ₹25,000) or high-risk scores.
* Provides supervisor approval or rejection with transparent AI reasoning and policy diffs.

### 5. Immutable Append-Only Audit Trail
* Protected by PostgreSQL database trigger `trg_prevent_audit_events_mutation` blocking `UPDATE` and `DELETE` operations.
* Records actor, agent, policy version, decision, risk score, and settled transaction ID.

---

## 6. Tech Stack & Environment

| Layer | Technology | Version / Notes |
|---|---|---|
| **Frontend** | React, Vite, Modern Vanilla CSS Design System | React 18, React Router 6, Socket.IO Client |
| **Backend** | Node.js, Express.js, Socket.IO | ES Modules, Joi validation, pg pool |
| **AI Service** | Python, FastAPI, Uvicorn, Pydantic | Python 3.12, Prompt Guard, Gemini 1.5 Pro |
| **Database** | PostgreSQL | **36 Relational Tables**, 15 Migrations (`001`–`014` + `006_strict`) |
| **Cache & Locks** | Redis | Redis 7 mutex locking with local in-memory fallback |
| **Payments** | Razorpay Gateway | **Test Sandbox Rails** (`rzp_test_*`), HMAC-SHA256 verification (live backend processing against Razorpay test environment, not live financial settlement) |
| **Fulfillment** | Order State Machine | Simulated order fulfillment lifecycle with generated tracking tokens (physical 3PL carrier integrations are future production targets) |

---

## 7. Installation & Quick Start

### Prerequisites
* Node.js >= 18
* Python >= 3.11
* PostgreSQL 16/17 (Port 5433 or 5432)
* Redis (Port 6379)

### 1. Environment Configuration

#### Backend (`backend/.env`):
```env
PORT=5050
NODE_ENV=development
DATABASE_URL=postgresql://aman@localhost:5433/agentpay
REDIS_URL=redis://localhost:6379
RAZORPAY_TEST_KEY_ID=rzp_test_xxxxxxxxxxxxx
RAZORPAY_TEST_KEY_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
RAZORPAY_TEST_WEBHOOK_SECRET=whsec_test_xxxxxxxxxxxxxxxx
AI_SERVICE_URL=http://localhost:8000
GEMINI_API_KEY=your_google_gemini_api_key_here
```

#### Frontend (`frontend/.env`):
```env
VITE_API_URL=http://localhost:5050
VITE_SOCKET_URL=http://localhost:5050
VITE_RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxxx
```

#### AI Service (`ai-service/.env`):
```env
AI_SERVICE_PORT=8000
BACKEND_API_URL=http://localhost:5050/api
GEMINI_API_KEY=your_google_gemini_api_key_here
```

### 2. Database Migration & Seeding
```bash
cd backend
npm install
npm run migrate
npm run seed
```

### 3. Start Backend Service (Port 5050)
```bash
npm run dev
```

### 4. Start AI Service (Port 8000)
```bash
cd ../ai-service
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python main.py
```

### 5. Start Frontend Application (Port 5173)
```bash
cd ../frontend
npm install
npm run dev
```

Application URL: **`http://localhost:5173`**

---

## 8. Interactive Demo & User Walkthrough

1. **Buyer Natural-Language Procurement**:
   * Log into the Buyer Portal (`buyer@agentpay.ai` / `password123`).
   * Type procurement prompts (e.g. *"Buy a 20,000mAh fast-charging power bank under ₹2,500"*).
   * AgentPay's AI Intent Parser discovers matching products, validates catalog availability, and structures a purchase intent.
2. **Autonomous Policy Enforcement**:
   * Small purchases within limits (e.g. ₹1,919) are authorized automatically via Razorpay Test Rails.
   * Purchases exceeding the auto-spend limit (e.g. ₹34,990 monitor) transition to `APPROVAL_REQUIRED` and appear in the Approval Center.
3. **Emergency Kill Switch**:
   * Activate the global or agent-level kill switch from the buyer settings or admin panel to halt all autonomous purchasing immediately.
4. **Merchant Control Plane**:
   * Log into the Merchant Portal (`merchant@agentpay.ai` / `password123`).
   * Manage live product catalogs, view real-time incoming orders, review settlement status, and monitor AI buyer traffic.

---

## 9. Automated Test Battery

AgentPay includes an automated test battery verifying financial safety, concurrency locks, price integrity, payment verification, search relevance, and prompt-injection defence.

Counts below are what the suites actually contain and what they actually report.

* **Backend (Jest)**: 9 test suites, 189 tests — **188 passing, 1 environment-dependent** (see note).
  * `promptSecurityGuard.test.js` — prompt-injection matrix (user input + merchant content, encodings, obfuscation)
  * `securityInvariant.test.js` — proves the backend refuses a compromised AI verdict on every guard independently
  * `searchRelevance.test.js` — search relevance matrix, NO_MATCH behaviour, untrusted-LLM-intent merging
  * `merchantProductValidator.test.js` — merchant input validation
  * `candidateFilter.test.js`, `policyEngine.test.js`, `pricingService.test.js`, `riskEngine.test.js`, `e2e.test.js`
* **AI Service (pytest)**: 21 tests passing (`test_prompt_guard.py`, `test_buyer_agent.py`, `test_search_and_ranking.py`).

> **Environment note.** One `e2e.test.js` case (the approval-flow settlement) creates two
> Razorpay orders. Where `api.razorpay.com` is unreachable, the SDK spends ~21s per call
> timing out and the test exceeds the 30s Jest limit. It passes on a machine with normal
> outbound internet access. This is a network dependency, not a code defect — but it is
> listed here rather than described as passing.

**Prerequisite:** the backend suite requires a running PostgreSQL instance matching
`DATABASE_URL`, with migrations applied (`npm run migrate`).

```bash
# Run backend test battery
cd backend
npm test -- --runInBand

# Run AI service pytest suite
cd ../ai-service
source .venv/bin/activate
pytest -v
```

---

## 10. License

MIT License — Built for the Razorpay AI Buildathon 2026 under **Track 01: AI Growth & Agentic Commerce**.
