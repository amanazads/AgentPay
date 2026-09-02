# AgentPay — Complete Project Documentation

**Project Name:** AgentPay  
**Documentation Version:** 3.0.0 (Production-Grade Architecture Specification)  
**Current Implementation Status:** Operational / Full-Stack Integrated (Express 5.x + React 18 + FastAPI + PostgreSQL 17 + Redis 7 + Socket.IO + Razorpay Test Rails)

---

## Table of Contents
1. [Executive Summary](#1-executive-summary)
2. [Project Vision & Strategic Thesis](#2-project-vision--strategic-thesis)
3. [Problem Statement](#3-problem-statement)
4. [Solution Architecture](#4-solution-architecture)
5. [Target Users & Role Models](#5-target-users--role-models)
6. [Product Modes & Environments](#6-product-modes--environments)
7. [Buyer Experience & Lifecycle](#7-buyer-experience--lifecycle)
8. [Merchant Experience & Lifecycle](#8-merchant-experience--lifecycle)
9. [Comprehensive Feature Inventory](#9-comprehensive-feature-inventory)
10. [Buyer Suite Capabilities](#10-buyer-suite-capabilities)
11. [Merchant Suite & AI Commerce Engine](#11-merchant-suite--ai-commerce-engine)
12. [AI Agent Architecture & Reasoning Pipeline](#12-ai-agent-architecture--reasoning-pipeline)
13. [End-to-End AI Agent Execution Flow](#13-end-to-end-ai-agent-execution-flow)
14. [Merchant AI Commerce Readiness & Ingestion](#14-merchant-ai-commerce-readiness--ingestion)
15. [System Architecture & Network Topology](#15-system-architecture--network-topology)
16. [Deterministic Policy Engine & Decision Matrix](#16-deterministic-policy-engine--decision-matrix)
17. [Explainable Risk Scoring Engine](#17-explainable-risk-scoring-engine)
18. [24-State Purchase State Machine](#18-24-state-purchase-state-machine)
19. [Payment Rails, Price Protection & Settlements](#19-payment-rails-price-protection--settlements)
20. [Database Schema & Data Model](#20-database-schema--data-model)
21. [Redis Caching, Idempotency & Concurrency Controls](#21-redis-caching-idempotency--concurrency-controls)
22. [Real-time WebSockets & Telemetry](#22-real-time-websockets--telemetry)
23. [Application Security, RBAC & Prompt Injection Defense](#23-application-security-rbac--prompt-injection-defense)
24. [Testing Suite, Simulation Lab & Security Attack Lab](#24-testing-suite-simulation-lab--security-attack-lab)
25. [Configuration, Deployment & Environment Variables](#25-configuration-deployment--environment-variables)
26. [Implementation Status, Known Limitations & Production Readiness](#26-implementation-status-known-limitations--production-readiness)

---

## 1. Executive Summary

### One-Line Description
**AgentPay is the autonomous commerce control plane and settlement infrastructure that enables AI agents to discover, evaluate, and purchase products within deterministic financial guardrails.**

### Short Description
AgentPay bridges autonomous Large Language Model (LLM) agents and verified digital merchants. It gives buyers an AI procurement agent that searches catalogs, compares specifications, and structures purchases under strict policy limits, while providing merchants with the APIs, metadata schemas, and analytics needed to sell directly to AI buyers without human UI friction.

### Core Value Proposition
- **For Buyers:** *"Tell AgentPay what you need, and your agent procures it across verified stores with zero checkout fatigue, automatic price surge protection, and strict budget caps."*
- **For Merchants:** *"Transform your product catalog into an AI-readable, high-conversion autonomous sales channel with automated order intake and instant settlement verification."*
- **Key Differentiator:** **Zero Financial Authority for LLMs**. The AI Agent reasons and discovers, but never touches private keys or directly authorizes payments. Every transaction is deterministically validated server-side by a mathematical Policy Engine, evaluated by an Explainable Risk Engine, tracked across a 24-state state machine, and audited in an append-only ledger.

---

## 2. Project Vision & Strategic Thesis

### Vision
To serve as the default transaction and trust layer for the agentic economy—where autonomous software agents transact safely, transparently, and predictably on behalf of humans and enterprises.

### Mission
To eliminate the friction of human checkout forms, fragmented shopping carts, and manual approvals by establishing open protocols for agent-to-merchant commerce backed by cryptographic and policy safety rails.

---

## 3. Problem Statement

### Buyer Inefficiencies
- **Discovery Friction:** Searching across multiple tabs to compare technical specifications, RAM, CPU tiers, warranties, and delivery times is manual and time-consuming.
- **Checkout Repetition:** Entering shipping addresses, payment details, and OTPs for routine office and developer supplies wastes hours every month.
- **Budget Leakage & Rogue Spend:** Companies lack automated real-time spending controls over automated scripts and team purchase requests.

### Merchant Bottlenecks
- **Invisibility to AI Agents:** Products lack semantic embeddings, AI keywords, and structured margin metadata needed for AI agent evaluation algorithms.
- **Lost Conversion from Drop-off:** Multi-step checkout flows lose up to 70% of potential buyers; AI agents cannot complete captchas or dynamic human forms.
- **Lack of Autonomous Channel Analytics:** Merchants have no visibility into how many AI agents queried their catalog, evaluated their products, or completed purchases.

---

## 4. Solution Architecture

AgentPay delivers a comprehensive 3-part solution:
1. **Buyer Procurement Suite:** A natural-language portal where buyers state intents. The AI agent parses constraints, queries connected stores, and structures a cryptographically bound `PurchaseIntent`.
2. **Merchant Control Plane:** A merchant dashboard to manage AI catalog readiness, configure HMAC connector credentials, track autonomous orders, and advance fulfillment states.
3. **Deterministic Governance & Settlement Rail:** Server-side engine evaluating 13 policy rules, 5-pillar risk scoring, two-phase inventory locking, cryptographic quote validation, and Razorpay test payment execution with HMAC-SHA256 signature verification.

---

## 5. Normalized Merchant Connector Architecture

Rather than relying on brittle third-party web scrapers or unauthorized marketplace logins, AgentPay implements a **Normalized Merchant Connector Architecture**:

1. **Structured Merchant Registry (`merchants`, `merchant_profiles`)**: Stores merchant business profiles, KYC verification status, verified tier levels, and commission schedules.
2. **Standardized Product Catalog (`products`, `product_ai_metadata`)**: Normalizes product specifications, technical attributes, inventory stock levels, price tiers, and AI search embeddings.
3. **Cryptographic Connector Credentials**: Each merchant is provisioned with a rotatable API Key (`SHA-256` key hash) and a Webhook Secret (`HMAC-SHA256`) for outbound order dispatch.
4. **Two-Phase Inventory Lock**: Row-level reservation (`inventory_reservations`) locks inventory for 15 minutes during checkout to prevent overselling.
5. **Deterministic Price Quotes (`quotes`)**: 15-minute time-bound cryptographic quotes prevent price drift and checkout surge tampering.

---

## 6. Deterministic Policy Engine & 13 Security Rules

Evaluates every purchase intent server-side prior to financial execution:
1. **Global Emergency Kill Switch Check** (`system_state.kill_switch_active`)
2. **Agent Operational Status Verification** (`active` vs `disabled`/`suspended`)
3. **Product Inventory & In-Stock Availability**
4. **Authorized Category Whitelist Validation** (`allowed_categories`)
5. **Restricted Category Blacklist Enforcement** (`blocked_categories`)
6. **Merchant Authenticity & Verification Tier** (`verified_merchants_only`)
7. **Price Tampering Tolerance Guard** (`price_tolerance_pct` max 2.0%)
8. **Single-Transaction Hard Spending Ceiling** (`max_transaction`)
9. **Daily Spending Limit & Active Intent Reservation** (`daily_budget`)
10. **5-Minute Sliding Window Duplicate Prevention**
11. **Maximum Retry Limit Enforcement**
12. **Autonomous Spending Threshold Gate** (`approval_threshold`)
13. **Deterministic Output Synthesis**: Exactly one of `ALLOW`, `APPROVAL_REQUIRED`, or `BLOCK`.

---

## 7. Database Schema (36 Relational Tables)

The persistent database contains **36 relational tables** managed across 15 migration files:

1. `users`: Multi-role identity (Buyer, Merchant, Admin).
2. `user_addresses`: Structured shipping and billing address records.
3. `user_preferences`: Buyer natural language directives and autonomous limits.
4. `user_payment_methods`: Stored test card and mandate authorizations.
5. `user_merchant_connections`: Per-merchant buyer authorization tokens.
6. `merchants`: Core merchant business identity and verification badges.
7. `merchant_profiles`: Extended business registration, tax IDs, and settlement configs.
8. `merchant_analytics`: Daily aggregated revenue and AI discovery metrics.
9. `merchant_settlements`: Settlement batch records and payout statuses.
10. `products`: Active catalog SKUs, inventory counts, and base prices.
11. `product_ai_metadata`: Machine-readable semantic summaries and search tokens.
12. `quotes`: 15-minute cryptographic price lock quotes with SHA-256 signatures.
13. `inventory_reservations`: Two-phase stock locks with expiration TTLs.
14. `agents`: Autonomous buyer agent instances and policy associations.
15. `agent_memory`: Safe contextual preferences (brands, typical sizes).
16. `policies`: Deterministic spending limits and category whitelists/blacklists.
17. `policy_change_history`: Historical audit trail of policy modifications.
18. `purchase_intents`: Core purchase intent lifecycle and state machine tracking.
19. `transactions`: Payment ledger records, Razorpay order/payment IDs, and settlement flags.
20. `approvals`: Human-in-the-loop review queue and supervisor decisions.
21. `orders`: Canonical store order ledger and fulfillment status progression.
22. `invoices`: Idempotent GST tax invoices with IRN hashes.
23. `refunds`: Payment reversal records and provider reference numbers.
24. `payment_authorizations`: Active pre-authorizations and mandate limits.
25. `payment_disputes`: Chargeback and dispute tracking records.
26. `authorization_reservations`: Atomic budget lock reservations.
27. `risk_assessments`: 5-pillar composite risk score records and factor attributions.
28. `audit_events`: Append-only immutable forensic log with database mutation block trigger.
29. `event_notifications`: Delivery records for transactional notifications.
30. `in_app_notifications`: User and merchant UI notification inbox.
31. `webhook_inbox`: Deduplicated inbound webhook log with idempotency tracking.
32. `refresh_tokens`: Cryptographic refresh token storage for authentication.
33. `simulation_runs`: Benchmark execution run metadata.
34. `simulation_cases`: Synthetic benchmark test cases and decision assertions.
35. `system_state`: Global platform singleton tracking kill switch and operational state.
36. `migrations`: Applied database migration log.

---

## 8. Testing Suite & Security Verification

AgentPay features a comprehensive automated testing battery:

* **Backend Test Battery**: **50 test suites, 502 automated tests passing**.
* **AI Service Pytest Suite**: **4 / 4 test cases passing**.
* **Security Audit Battery**: **8 dedicated security suites (88 / 88 tests passing)**:
  1. `financialSafetyAudit.test.js`: Daily budget accounting, budget locks, kill switch gates.
  2. `humanApprovalWorkflowAudit.test.js`: Threshold escalations, approval decisions, timeouts.
  3. `aiBuyerPipelineSecurityAudit.test.js`: Prompt injection scanning, data boundaries.
  4. `razorpayPaymentSecurityAudit.test.js`: HMAC signature checks, test rail execution.
  5. `adversarialPriceIntegrity.test.js`: Surge detection, price tampering rejection.
  6. `concurrencyDoubleSpendAudit.test.js`: Concurrent purchase lock and single execution.
  7. `environmentIsolationPaymentRails.test.js`: Environment separation and test badges.
  8. `secretCredentialHardening.test.js`: Redaction of secrets and credential rotation.

---

## 9. Production Readiness & Live Activation Checklist

To transition AgentPay from the test rail environment to live production settlement, the following prerequisites are required:

1. **Production Razorpay Gateway Credentials**: Configure verified `rzp_live_*` API keys and live webhook secrets.
2. **Third-Party Logistics (3PL) Carrier APIs**: Integrate physical shipping aggregators (e.g. Shiprocket, Delhivery, Bluedart) for automated physical dispatch and live tracking.
3. **Enterprise Key Management (KMS)**: Transition merchant HMAC secrets to AWS KMS, Google Cloud KMS, or HashiCorp Vault.
4. **External Webhook Ingestion Hardening**: Configure IP whitelisting and mutual TLS (mTLS) for inbound gateway webhooks.
5. **Distributed Redis Sentinel / Cluster**: Deploy a high-availability Redis cluster for production-grade distributed mutex locking under high concurrency.
6. **Regulatory Compliance & Tax E-Invoicing**: Connect live GSTN e-invoicing APIs (NIC/IRP) for official B2B IRN generation and signed QR codes.

---

*AgentPay — The Autonomous Commerce Control Plane.*  
*Canonical Architecture & Engineering Documentation.*
