# AgentPay Architecture & Technical Specification

## 1. System Overview
AgentPay is an enterprise autonomous AI commerce infrastructure platform. It transforms a single natural-language buyer instruction into an authorized, cryptographically verified purchase across connected ecommerce merchants and payment providers.

```
+-------------------------------------------------------------------------+
|                               USER LAYER                                |
|  Web Client (React SPA) • Mobile-First Responsive • WebSocket Updates   |
+------------------------------------+------------------------------------+
                                     | (JWT Bearer Token / HTTPS)
                                     v
+------------------------------------+------------------------------------+
|                         GATEWAY & AUTH LAYER                            |
|  Express Gateway • Rate Limiter • RBAC Guard • Bcrypt/JWT Auth Server   |
+------------------------------------+------------------------------------+
                                     |
                                     v
+------------------------------------+------------------------------------+
|                 COMMERCE ORCHESTRATION & STATE MACHINE                  |
|  PurchaseStateMachine (24 States) • Atomic Reservation Engine           |
+------------------+-----------------------------+------------------------+
                   |                             |
                   v                             v
+------------------+---------+     +-------------+------------------------+
|   MULTI-MERCHANT ADAPTERS  |     |  13-RULE POLICY & RISK ENGINE        |
|  • Flipkart India (Assured)|     |  • Deterministic Security Engine     |
|  • TechZone India          |     |  • Prompt Injection Threat Guard     |
|  • GadgetWorld             |     |  • Price Manipulation Tolerance Check|
|  • PrimeOffice Supplies    |     |  • Velocity & Duplicate Locks        |
+------------------+---------+     +-------------+------------------------+
                   |                             |
                   +--------------+--------------+
                                  |
                                  v
+---------------------------------+---------------------------------------+
|                    PAYMENT PROVIDER ABSTRACTION                         |
|  • Razorpay Standard / Test Sandbox Engine                              |
|  • HMAC-SHA256 Cryptographic Signature Verification                    |
|  • Automated Reconciliation & Refund Subsystem                          |
+---------------------------------+---------------------------------------+
                                  |
                                  v
+---------------------------------+---------------------------------------+
|                      PERSISTENCE & COMPLIANCE                           |
|  PostgreSQL 17 (Ledger) • Redis 8 (Idempotency & Locks) • Audit Trails  |
+-------------------------------------------------------------------------+
```

---

## 2. Core Bounded Services

| Service | Responsibility |
|---|---|
| **`PurchaseStateMachine`** | Governs the 24-state explicit lifecycle from intent creation to verified settlement and reconciliation. |
| **`AuthorizationService`** | Manages user limits, spending ceilings, and handles atomic limit reservations to prevent concurrent race-condition overspending. |
| **`CommerceOrchestrator`** | Coordinates cross-merchant discovery, product normalization, ranking, and cart/checkout automation. |
| **`MerchantAdapter Layer`** | Standardized adapter contract (`search`, `cart`, `checkout`, `order`, `refund`) for Flipkart, TechZone, GadgetWorld, PrimeOffice. |
| **`PolicyEngine`** | Server-side deterministic 13-rule spending guard (0% LLM payment authority). |
| **`RiskEngine`** | Multidimensional heuristic & threat scanner (prompt injection, velocity anomaly, content scanning). |
| **`PaymentProvider`** | Abstract interface for payment intent creation, order settlement, HMAC-SHA256 signature verification, and refunds. |
| **`ReconciliationService`** | Audits and resolves split-brain financial states (e.g. `PAYMENT_SUCCESS + ORDER_FAILED`). |
| **`AuditService`** | Append-only immutable compliance log with decision hashes. |

---

## 3. Purchase State Machine (24 States)

```
CREATED -> UNDERSTANDING -> SEARCHING -> PRODUCT_SELECTED 
        -> AUTHORIZATION_PENDING -> AUTHORIZED 
        -> CART_CREATING -> CART_CREATED -> CHECKOUT_PENDING 
        -> PRICE_REVALIDATION -> PAYMENT_PENDING 
        -> PAYMENT_PROCESSING -> PAYMENT_SUCCESS 
        -> ORDER_PENDING -> ORDER_CONFIRMED (Terminal Success)
```

* **Human Review State**: `USER_AUTHENTICATION_REQUIRED` (triggered if threshold exceeded, 3DS needed, or bank OTP required).
* **Safe Terminal Failures**: `BLOCKED` (policy violation), `RECONCILIATION_REQUIRED` (order mismatch), `REFUND_PENDING` -> `REFUND_COMPLETED`.
