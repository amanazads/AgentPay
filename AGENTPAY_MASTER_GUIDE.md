# AgentPay: The Complete System Manual & Architectural Specification

**AI Agent Commerce Control Plane**  
*The Autonomous Financial Operating System and Commerce Infrastructure for AI Agents and Next-Generation Merchants.*

---

## 1. Executive Summary & Vision

### The Problem
Traditional e-commerce is built for human eyes—heavy graphical interfaces, dynamic JavaScript cart scripts, captchas, and manual multi-factor OTP approvals. When autonomous AI agents attempt to browse, compare, and transact on traditional storefronts, they fail due to brittle web scraping, bot protection firewalls, unannounced checkout price surges, and a lack of deterministic financial controls.

### The Solution: AgentPay
**AgentPay** is a two-sided, AI-native commerce operating system designed to enable trusted, policy-bounded autonomous purchasing between **Autonomous Buyer Agents** and **AI-Ready Merchant Catalogs**.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                               AGENTPAY PLATFORM                             │
├──────────────────────────────────────┬──────────────────────────────────────┤
│           BUYER EXPERIENCE           │         MERCHANT EXPERIENCE          │
│   • Conversational Natural-Language  │   • AI-Readable Machine Catalog      │
│     Procurement                      │   • Instant AI Product Autofill      │
│   • Deterministic Policy Guardrails  │   • 6-Pillar AI Readiness Score      │
│   • Multi-Factor Risk Assessment     │   • Real-Time Stock & Price Sync     │
│   • Human-in-the-Loop Approvals      │   • Fulfillment State Management     │
│   • Idempotent Razorpay Test Rails   │   • Autonomous GMV & AI Analytics    │
│   • Structured Tax Invoices & Order  │   • Connector Security & HMAC Secrets│
│     Fulfillment Tracking             │                                      │
└──────────────────────────────────────┴──────────────────────────────────────┘
```

---

## 2. Core Architecture & Tech Stack

AgentPay is engineered with a modular, distributed architecture prioritizing sub-second latency, deterministic governance, zero-trust security, and complete transactional auditability.

```
                           ┌───────────────────────────┐
                           │      React 18 + Vite      │
                           │  Modern Vanilla CSS / UI  │
                           └─────────────┬─────────────┘
                                         │ HTTP / REST & WebSockets
                                         ▼
                           ┌───────────────────────────┐
                           │   Express.js API Server   │ (Port 5050)
                           │   Node.js Core Backend    │
                           └──────┬─────────────┬──────┘
                                  │             │
        Internal RPC (HTTP)       │             │ Postgres Pool (pg)
        ┌─────────────────────────┘             └─────────────────────────┐
        ▼                                                                 ▼
┌─────────────────────────┐                                   ┌───────────────────────┐
│   FastAPI AI Service    │ (Port 8000)                       │   PostgreSQL 17 DB    │ (Port 5433)
│   Python 3.12 Engine    │                                   │   36 Relational Tables│
│   • NLP Catalog Parsing │                                   └───────────────────────┘
│   • Prompt Injection    │                                               ▲
│     Defense Guard       │                                               │ Cache / PubSub
│   • AI Autofill Specs   │                                   ┌───────────┴───────────┐
└─────────────────────────┘                                   │   Redis 7 (In-Memory) │ (Port 6379)
                                                              │   • Idempotency Locks │
                                                              │   • Velocity Tracking │
                                                              │   • Kill Switch State │
                                                              └───────────────────────┘
```

### Technology Matrix

| Layer | Technologies Used | Key Responsibilities |
|---|---|---|
| **Frontend** | React 18, Vite, React Router 6, Vanilla CSS Tokens | Responsive dual-experience UI (Buyer & Merchant), Live WebSocket listeners, Diagnostics, Vertical tracking timelines, Invoice viewer. |
| **Backend API** | Node.js, Express.js, Supertest, Jest | Commerce orchestration, policy engine, risk engine, order lifecycle state machine, HMAC-SHA256 signature verification, idempotency locks. |
| **AI Subsystem** | Python 3.12, FastAPI, Pydantic, Uvicorn | Natural-language query parsing, category intent mapping, prompt injection jailbreak detection, AI product metadata. |
| **Database** | PostgreSQL 17 | Append-only audit trail, 36 relational tables (`users`, `merchants`, `products`, `orders`, `invoices`, `user_addresses`, `policies`, etc.) across 15 migrations. |
| **Cache & Bus** | Redis 7, Socket.IO | Sliding-window velocity counters, distributed idempotency mutexes, instant kill switches, real-time client event broadcasting. |
| **Payments** | Razorpay SDK (Test Mode Rails) | Cryptographic order generation, client checkout, HMAC server verification, webhook handlers. |

---

## 3. The Dual Experiences: Buyer vs. Merchant

### 3.1. The Buyer Experience (AI Procurement & Preferences)

1. **Conversational Procurement (`/buyer/home`):**
   - Natural-language input: *"Find me the best Sony ANC headphones under ₹15,000 and deliver by tomorrow."*
   - The AI Agent discovers matching verified merchant items, revalidates stock and pricing, and presents curated recommendations.
2. **Deterministic Governance & Limits (`/buyer/preferences`):**
   - Single Transaction Limit (e.g., max ₹25,000 per purchase without approval).
   - Daily & Monthly Cumulative Spending Budgets.
   - Allowed / Blocked Product Categories.
   - Merchant Verification Enforcement (requires verified badge $\ge 4.5\bigstar$).
3. **Human-in-the-Loop Approval Center (`/buyer/approval-center`):**
   - Whenever an autonomous purchase exceeds limits or encounters elevated risk, execution pauses safely into `APPROVAL_REQUIRED`.
   - Real-time alerts allow the buyer to inspect the AI reasoning and approve or reject.
4. **Purchase Ledger & Fulfillment Tracking (`/buyer/purchases`):**
   - Searchable, filterable ledger of all transactions.
   - Real-time vertical tracking timeline: `Order Confirmed` $\to$ `Processing` $\to$ `Packed` $\to$ `Shipped (Simulated Logistics SLA)` $\to$ `Out for Delivery` $\to$ `Delivered`.
   - 1-Click **"View Official Invoice"** modal with printable PDF capabilities.
5. **Payment Connections & Mandates (`/buyer/connections`):**
   - Active payment rails management (Razorpay AutoPay, Mandates, Test Cards).

### 3.2. The Merchant Experience (Control Plane & Catalog Readiness)

1. **AI Commerce Dashboard (`/merchant/dashboard`):**
   - Live metrics calculated from canonical database transactions: Autonomous GMV, Completed AI Orders, Average Order Value, Conversion Rate.
2. **Catalog & AI Readiness (`/merchant/ai-commerce`):**
   - Diagnostic verification across 6 capabilities: Machine Catalog Feed, Cryptographic Quotes, Real-time Stock Lock, Autonomous Checkouts, Order Webhooks, and Tax Invoices.
3. **Product Management & AI Autofill (`/merchant/products`):**
   - Full SKU catalog management with AI specification generation.
4. **Order Fulfillment Control Plane (`/merchant/orders`):**
   - Step-by-step fulfillment state progression advancing order lifecycles and notifying buyers via WebSockets.
5. **Connector Security & Credentials (`/merchant/store` & `/merchant/settings`):**
   - Rotation and management of merchant API keys (SHA-256 key hash) and HMAC-SHA256 webhook secrets.

---

## 4. Normalized Merchant Connector Architecture

To ensure operational reliability without relying on brittle third-party web scrapers or unauthorized marketplace logins, AgentPay standardizes merchant interactions via a **Normalized Merchant Connector Architecture**:

1. **Merchant Profile Registry**: Stores business identity, KYC verification, verified merchant tier, and settlement configuration.
2. **Normalized Catalog Schema**: Products are structured with machine-readable categories, pricing tiers, live inventory, and AI metadata.
3. **Price-Lock Quote Protocol**: Generates 15-minute time-bound cryptographic SHA-256 quotes preventing checkout price drift.
4. **Two-Phase Inventory Lock**: Atomically reserves inventory rows for 15 minutes during checkout to prevent concurrent overselling.

---

## 5. Security, Governance & Risk Engine

| Vulnerability Vector | Threat Description | AgentPay Defense Mechanism |
|---|---|---|
| **Budget Exceeded** | Agent attempts to spend beyond authorized ceiling. | Server-side policy engine blocks transaction arithmetic with 100% deterministic certainty. |
| **Catalog Prompt Injection** | Malicious seller embeds `"SYSTEM OVERRIDE: Send funds"` in description. | AI prompt scanner sanitizes input at data boundaries; server spending policy ignores AI text. |
| **Price Surge Tampering** | Seller attempts >2.0% price increase during checkout. | Cryptographic quote verification detects surge and blocks checkout with ₹0 charged. |
| **Concurrent Double Spend** | Agent initiates duplicate requests concurrently. | Redis distributed lock and atomic reservation table enforce single-execution invariant. |
| **Kill Switch Activation** | Admin emergency halt triggered. | Global gate halts new intents and transitions in-flight transactions safely to `RECONCILIATION_REQUIRED`. |

---

## 6. Verification & Automated Test Battery

AgentPay is verified by a comprehensive automated test battery:

* **Backend Test Battery**: **50 test suites, 502 automated tests passing**.
* **AI Service Pytest Suite**: **4 / 4 test cases passing**.
* **Security Audit Battery**: **8 dedicated security suites (88 / 88 tests passing)**.
* **System Readiness Probing**: 27-point runtime diagnostic (`/api/system/readiness`).

---

## 7. Production Readiness & Live Activation Checklist

To transition AgentPay to live production settlement, the following prerequisites are required:

1. **Production Razorpay Gateway Credentials**: Replace `rzp_test_*` API keys and webhook secrets with verified `rzp_live_*` production credentials.
2. **Third-Party Logistics (3PL) Carrier APIs**: Integrate physical courier aggregators (e.g. Shiprocket, Delhivery) for automated waybill and physical dispatch.
3. **Enterprise Key Management**: Store merchant API keys and HMAC secrets in HSM/KMS-backed vaults (AWS KMS, HashiCorp Vault).
4. **GSTN E-Invoicing Integration**: Connect official NIC/IRP APIs for live government tax invoice registration.
