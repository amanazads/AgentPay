import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icons } from '../components/ui/Icons';
import './Landing.css';

export default function Landing() {
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeBuyerStep, setActiveBuyerStep] = useState(0);
  const [activeMerchantTab, setActiveMerchantTab] = useState('catalog');

  // Prevent background scroll when mobile menu is open
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [mobileMenuOpen]);

  const handleSelectRole = (role) => {
    localStorage.setItem('agentpay_initial_role', role);
    navigate(`/signup?role=${role}`);
  };

  const scrollToSection = (id) => {
    setMobileMenuOpen(false);
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };

  // Buyer 9-Stage Pipeline Data
  const buyerSteps = [
    {
      num: '01',
      title: 'Natural language intent',
      label: 'Intent Capture',
      desc: 'Buyer expresses procurement criteria in plain text ("Find wireless ergonomic mouse under ₹9,000 with silent switches").',
      badge: 'LLM Parser',
      details: 'Deterministic extraction of product category, brand preference, price ceilings, and mandatory hardware specs.',
    },
    {
      num: '02',
      title: 'AI product discovery',
      label: 'Candidate Search',
      desc: 'Autonomous agent queries connected AI-ready merchant catalogs for structured matching products.',
      badge: 'Catalog API',
      details: 'High-performance vector and attribute filtering across verified merchant catalogs.',
    },
    {
      num: '03',
      title: 'Product comparison',
      label: 'Constraint Ranking',
      desc: 'Multi-merchant comparison based on user constraints: price, delivery timeframe, merchant rating, and stock.',
      badge: 'Ranking Engine',
      details: 'Scores candidates objectively against user constraints without advertising bias.',
    },
    {
      num: '04',
      title: 'Buyer policy evaluation',
      label: 'Deterministic Gate',
      desc: 'Server-side policy engine verifies single-order caps, daily limits, category rules, and risk score thresholds.',
      badge: 'Policy Engine',
      details: 'Strict mathematical bounding: if amount > user limit, escalates to human approval instead of executing.',
    },
    {
      num: '05',
      title: 'Price & inventory verification',
      label: 'Pre-flight Gate',
      desc: 'Revalidates live catalog pricing against surge limits (max 5% drift) and locks real-time stock reservations.',
      badge: 'Price & Stock Gate',
      details: 'Prevents checkout on out-of-stock items or price spikes during agent discovery.',
    },
    {
      num: '06',
      title: 'Authorized checkout',
      label: 'Idempotent Token',
      desc: 'Server creates an authorized checkout session with an idempotent cryptographic transaction key.',
      badge: 'Idempotency Lock',
      details: 'SHA-256 idempotency locking prevents double-charging on network retries.',
    },
    {
      num: '07',
      title: 'Payment',
      label: 'Payment Rails',
      desc: 'Razorpay sandbox rails execute transaction with HMAC-SHA256 signature verification.',
      badge: 'Razorpay Rails',
      details: 'Cryptographic signature verification proves genuine authorization before state progression.',
    },
    {
      num: '08',
      title: 'Merchant order',
      label: 'Order Dispatch',
      desc: 'Confirmed order injected directly into merchant fulfillment ledger with verified payment status.',
      badge: 'Order Ledger',
      details: 'Fulfillment record generated with line items, tax breakdown, and shipping address.',
    },
    {
      num: '09',
      title: 'Fulfillment',
      label: 'Delivery & Invoice',
      desc: 'Automated invoice generation, carrier tracking assignment, and live buyer status notifications.',
      badge: 'Invoice & Tracking',
      details: 'End-to-end receipt generation with complete immutable audit timeline.',
    },
  ];

  // Merchant 8-Stage Pipeline Data
  const merchantSteps = [
    {
      num: '01',
      title: 'Your Catalog',
      desc: 'Connect your existing store inventory via REST API or CSV catalog import.',
    },
    {
      num: '02',
      title: 'Structured Product Data',
      desc: 'AgentPay transforms products into machine-readable JSON-LD specifications with semantic tags.',
    },
    {
      num: '03',
      title: 'AI Discovery',
      desc: 'Autonomous buyer agents discover your products through high-speed structured search endpoints.',
    },
    {
      num: '04',
      title: 'Real-time Inventory',
      desc: 'Atomic stock verification prevents overselling with temporary quote reservation locks.',
    },
    {
      num: '05',
      title: 'Verified Quotes',
      desc: 'Deterministic price quotes guarantee exact checkout amounts with zero unexpected surge.',
    },
    {
      num: '06',
      title: 'Machine Checkout',
      desc: 'AI buyers execute direct API checkouts without human browser friction or cart abandonment.',
    },
    {
      num: '07',
      title: 'AI-originated Orders',
      desc: 'Orders arrive pre-paid with verified payment status directly into your fulfillment pipeline.',
    },
    {
      num: '08',
      title: 'Revenue',
      desc: 'Grow merchant GMV by tapping directly into autonomous AI procurement budgets.',
    },
  ];

  return (
    <div className="ap-landing-root">
      {/* =========================================================================
          1. NAVIGATION BAR
         ========================================================================= */}
      <header className="ap-nav-header">
        <div className="ap-nav-inner">
          {/* Brand Mark */}
          <div className="ap-nav-brand" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
            <div className="ap-brand-badge">AP</div>
            <span className="ap-brand-name">AgentPay</span>
            <span className="ap-track-pill">Track 01 • Agentic Commerce</span>
          </div>

          {/* Desktop Navigation Links */}
          <nav className="ap-nav-links">
            <button className="ap-nav-link" onClick={() => scrollToSection('roles')}>
              Role Selection
            </button>
            <button className="ap-nav-link" onClick={() => scrollToSection('buyer-workflow')}>
              Buyer Agent
            </button>
            <button className="ap-nav-link" onClick={() => scrollToSection('merchant-solution')}>
              Merchant Store
            </button>
            <button className="ap-nav-link" onClick={() => scrollToSection('architecture')}>
              Architecture
            </button>
            <button className="ap-nav-link" onClick={() => scrollToSection('trust-safety')}>
              Trust & Safety
            </button>
          </nav>

          {/* Header Action Buttons */}
          <div className="ap-nav-actions">
            <button
              className="ap-btn ap-btn-subtle"
              onClick={() => navigate('/login')}
            >
              Sign in
            </button>
            <button
              className="ap-btn ap-btn-primary"
              onClick={() => scrollToSection('roles')}
            >
              Get Started
            </button>
            {/* Mobile Hamburger Toggle */}
            <button
              className="ap-hamburger-btn"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label="Toggle navigation menu"
            >
              {mobileMenuOpen ? <Icons.X size={20} /> : <Icons.Menu size={20} />}
            </button>
          </div>
        </div>

        {/* Mobile Navigation Drawer */}
        {mobileMenuOpen && (
          <div className="ap-mobile-drawer">
            <div className="ap-mobile-drawer-links">
              <button className="ap-mobile-nav-link" onClick={() => scrollToSection('roles')}>
                <Icons.User size={16} /> Role Selection
              </button>
              <button className="ap-mobile-nav-link" onClick={() => scrollToSection('buyer-workflow')}>
                <Icons.Sparkles size={16} /> Buyer Agent Workflow
              </button>
              <button className="ap-mobile-nav-link" onClick={() => scrollToSection('merchant-solution')}>
                <Icons.Store size={16} /> Merchant Enablement (Track 01)
              </button>
              <button className="ap-mobile-nav-link" onClick={() => scrollToSection('architecture')}>
                <Icons.Layers size={16} /> Two-Sided Architecture
              </button>
              <button className="ap-mobile-nav-link" onClick={() => scrollToSection('trust-safety')}>
                <Icons.ShieldCheck size={16} /> Trust & Safety Principles
              </button>
            </div>
            <div className="ap-mobile-drawer-actions">
              <button
                className="ap-btn ap-btn-outline"
                style={{ width: '100%' }}
                onClick={() => {
                  setMobileMenuOpen(false);
                  navigate('/login');
                }}
              >
                Sign In
              </button>
              <button
                className="ap-btn ap-btn-primary"
                style={{ width: '100%' }}
                onClick={() => scrollToSection('roles')}
              >
                Get Started
              </button>
            </div>
          </div>
        )}
      </header>

      {/* =========================================================================
          2. HERO SECTION (First Viewport)
         ========================================================================= */}
      <section className="ap-hero-section">
        <div className="ap-hero-container">
          {/* Overline Tag */}
          <div className="ap-hero-badge">
            <span className="ap-badge-dot" />
            <span className="ap-badge-text">THE COMMERCE LAYER FOR AI AGENTS</span>
          </div>

          {/* Main Headline */}
          <h1 className="ap-hero-title">
            Buy what you need.<br />
            <span className="ap-hero-highlight">Sell to AI buyers.</span>
          </h1>

          {/* Supporting Subheading */}
          <p className="ap-hero-subtitle">
            AgentPay connects AI buyers with AI-ready merchants, enabling product discovery,
            policy-bounded purchasing, secure checkout and verified order execution.
          </p>

          {/* Primary & Secondary CTAs */}
          <div className="ap-hero-cta-group">
            <button
              className="ap-btn ap-btn-primary ap-btn-lg"
              onClick={() => scrollToSection('roles')}
            >
              Get Started
            </button>
            <button
              className="ap-btn ap-btn-outline ap-btn-lg"
              onClick={() => scrollToSection('architecture')}
            >
              Explore how it works
            </button>
          </div>

          {/* First-Viewport Dual-Role Summary Cards */}
          <div className="ap-hero-quick-roles">
            <div className="ap-quick-role-card" onClick={() => handleSelectRole('BUYER')}>
              <div className="ap-quick-role-icon buyer-icon">
                <Icons.Sparkles size={18} />
              </div>
              <div className="ap-quick-role-content">
                <div className="ap-quick-role-title">Buy with AI</div>
                <div className="ap-quick-role-desc">
                  Tell AgentPay what you need. Your AI agent finds, evaluates and purchases it within your rules.
                </div>
              </div>
              <div className="ap-quick-role-arrow">
                <Icons.ChevronRight size={16} />
              </div>
            </div>

            <div className="ap-quick-role-card" onClick={() => handleSelectRole('MERCHANT')}>
              <div className="ap-quick-role-icon merchant-icon">
                <Icons.Store size={18} />
              </div>
              <div className="ap-quick-role-content">
                <div className="ap-quick-role-title">Sell to AI</div>
                <div className="ap-quick-role-desc">
                  Make your catalog AI-readable and transactable so autonomous buyers can discover and purchase your products.
                </div>
              </div>
              <div className="ap-quick-role-arrow">
                <Icons.ChevronRight size={16} />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* =========================================================================
          3. ROLE SELECTION SECTION ("WHAT ARE YOU HERE TO DO?")
         ========================================================================= */}
      <section id="roles" className="ap-section ap-roles-section">
        <div className="ap-container">
          <div className="ap-section-header">
            <div className="ap-section-overline">ROLE SELECTION</div>
            <h2 className="ap-section-title">WHAT ARE YOU HERE TO DO?</h2>
            <p className="ap-section-desc">
              AgentPay strictly isolates buyer agent controls and merchant store operations into dedicated, secure environments.
            </p>
          </div>

          <div className="ap-roles-grid">
            {/* BUYER CARD */}
            <div className="ap-role-card ap-role-buyer">
              <div className="ap-role-card-header">
                <div className="ap-role-icon-box buyer-box">
                  <Icons.Sparkles size={24} />
                </div>
                <span className="ap-role-pill">BUYER AGENT WORKFLOW</span>
              </div>

              <div className="ap-role-body">
                <h3 className="ap-role-headline">BUY WITH AI</h3>
                <p className="ap-role-text">
                  "Tell AgentPay what you need. Your AI agent finds, evaluates and purchases it within your rules."
                </p>

                <div className="ap-role-features">
                  <div className="ap-feature-item">
                    <span className="ap-check-icon"><Icons.Check size={14} /></span>
                    <span>Natural language requirement matching</span>
                  </div>
                  <div className="ap-feature-item">
                    <span className="ap-check-icon"><Icons.Check size={14} /></span>
                    <span>Server-side deterministic spending limits</span>
                  </div>
                  <div className="ap-feature-item">
                    <span className="ap-check-icon"><Icons.Check size={14} /></span>
                    <span>Automated price surge & stock protection</span>
                  </div>
                  <div className="ap-feature-item">
                    <span className="ap-check-icon"><Icons.Check size={14} /></span>
                    <span>One-click human review for edge cases</span>
                  </div>
                </div>
              </div>

              <div className="ap-role-footer">
                <button
                  className="ap-btn ap-btn-primary ap-btn-block"
                  onClick={() => handleSelectRole('BUYER')}
                >
                  Continue as Buyer →
                </button>
                <div className="ap-role-login-hint">
                  Already have a buyer account? <button onClick={() => navigate('/login')}>Sign in</button>
                </div>
              </div>
            </div>

            {/* MERCHANT CARD */}
            <div className="ap-role-card ap-role-merchant">
              <div className="ap-role-card-header">
                <div className="ap-role-icon-box merchant-box">
                  <Icons.Store size={24} />
                </div>
                <span className="ap-role-pill merchant-pill">MERCHANT STORE • TRACK 01</span>
              </div>

              <div className="ap-role-body">
                <h3 className="ap-role-headline">SELL TO AI</h3>
                <p className="ap-role-text">
                  "Make your catalog AI-readable and transactable so autonomous buyers can discover and purchase your products."
                </p>

                <div className="ap-role-features">
                  <div className="ap-feature-item">
                    <span className="ap-check-icon"><Icons.Check size={14} /></span>
                    <span>Structured JSON-LD catalog transformation</span>
                  </div>
                  <div className="ap-feature-item">
                    <span className="ap-check-icon"><Icons.Check size={14} /></span>
                    <span>Real-time inventory reservation quote locks</span>
                  </div>
                  <div className="ap-feature-item">
                    <span className="ap-check-icon"><Icons.Check size={14} /></span>
                    <span>Direct machine-to-machine checkout API</span>
                  </div>
                  <div className="ap-feature-item">
                    <span className="ap-check-icon"><Icons.Check size={14} /></span>
                    <span>AI-originated revenue & conversion analytics</span>
                  </div>
                </div>
              </div>

              <div className="ap-role-footer">
                <button
                  className="ap-btn ap-btn-primary ap-btn-block"
                  onClick={() => handleSelectRole('MERCHANT')}
                >
                  Continue as Merchant →
                </button>
                <div className="ap-role-login-hint">
                  Already have a merchant store? <button onClick={() => navigate('/login')}>Sign in</button>
                </div>
              </div>
            </div>
          </div>

          {/* Tenant Isolation Security Guarantee */}
          <div className="ap-tenant-guarantee">
            <div className="ap-guarantee-icon">
              <Icons.ShieldCheck size={18} />
            </div>
            <div className="ap-guarantee-text">
              <strong>Strict Role-Based Tenant Isolation:</strong> Buyer accounts cannot access merchant store settings or order fulfillment ledgers. Merchant accounts cannot access private buyer agent policies or user payment methods. Role boundaries are validated at every API request.
            </div>
          </div>
        </div>
      </section>

      {/* =========================================================================
          4. BUYER VALUE SECTION ("YOUR AI PURCHASING AGENT")
         ========================================================================= */}
      <section id="buyer-workflow" className="ap-section ap-buyer-section">
        <div className="ap-container">
          <div className="ap-section-header">
            <div className="ap-section-overline">BUYER CAPABILITY</div>
            <h2 className="ap-section-title">YOUR AI PURCHASING AGENT</h2>
            <p className="ap-section-desc">
              "One request. Your rules. The agent handles the commerce workflow."
            </p>
          </div>

          {/* 9-Step Pipeline Interactive Viewer */}
          <div className="ap-pipeline-card">
            <div className="ap-pipeline-header">
              <div className="ap-pipeline-title-group">
                <span className="ap-tag">9-STAGE VERIFIED LIFECYCLE</span>
                <span className="ap-pipeline-caption">
                  Every stage is evaluated deterministically before proceeding to execution.
                </span>
              </div>
              <div className="ap-step-counter">
                Stage {activeBuyerStep + 1} of {buyerSteps.length}
              </div>
            </div>

            {/* Step Navigation Ribbon */}
            <div className="ap-step-ribbon">
              {buyerSteps.map((step, idx) => (
                <button
                  key={step.num}
                  className={`ap-ribbon-item ${idx === activeBuyerStep ? 'active' : ''} ${idx < activeBuyerStep ? 'completed' : ''}`}
                  onClick={() => setActiveBuyerStep(idx)}
                >
                  <span className="ap-ribbon-num">{step.num}</span>
                  <span className="ap-ribbon-title">{step.title}</span>
                </button>
              ))}
            </div>

            {/* Active Step Deep Dive Card */}
            <div className="ap-step-detail-card">
              <div className="ap-step-detail-main">
                <div className="ap-step-meta">
                  <span className="ap-step-badge">{buyerSteps[activeBuyerStep].badge}</span>
                  <span className="ap-step-phase">Stage {buyerSteps[activeBuyerStep].num}</span>
                </div>
                <h4 className="ap-step-heading">{buyerSteps[activeBuyerStep].title}</h4>
                <p className="ap-step-description">{buyerSteps[activeBuyerStep].desc}</p>
                <div className="ap-step-subdetails">
                  <Icons.Info size={14} />
                  <span>{buyerSteps[activeBuyerStep].details}</span>
                </div>
              </div>

              {/* Step Navigation Controls */}
              <div className="ap-step-nav-controls">
                <button
                  className="ap-btn ap-btn-sm ap-btn-outline"
                  disabled={activeBuyerStep === 0}
                  onClick={() => setActiveBuyerStep((prev) => Math.max(0, prev - 1))}
                >
                  Previous Stage
                </button>
                <button
                  className="ap-btn ap-btn-sm ap-btn-primary"
                  disabled={activeBuyerStep === buyerSteps.length - 1}
                  onClick={() => setActiveBuyerStep((prev) => Math.min(buyerSteps.length - 1, prev + 1))}
                >
                  Next Stage →
                </button>
              </div>
            </div>

            {/* Complete 9-Stage Flow List (Mobile & Scannable View) */}
            <div className="ap-flow-grid">
              {buyerSteps.map((step, idx) => (
                <div
                  key={step.num}
                  className={`ap-flow-node ${idx === activeBuyerStep ? 'active-node' : ''}`}
                  onClick={() => setActiveBuyerStep(idx)}
                >
                  <div className="ap-node-top">
                    <span className="ap-node-idx">{step.num}</span>
                    <span className="ap-node-name">{step.title}</span>
                  </div>
                  {idx < buyerSteps.length - 1 && (
                    <div className="ap-node-connector">↓</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* =========================================================================
          5. MERCHANT VALUE SECTION ("MAKE YOUR STORE READY FOR AI BUYERS")
             PROMINENT TRACK 01 DEMONSTRATION
         ========================================================================= */}
      <section id="merchant-solution" className="ap-section ap-merchant-section">
        <div className="ap-container">
          <div className="ap-track-banner">
            <span className="ap-track-badge">TRACK 01 CORE OBJECTIVE</span>
            <h3 className="ap-track-headline">
              "Grow the merchant's revenue, and make them sellable to AI buyers."
            </h3>
          </div>

          <div className="ap-section-header">
            <div className="ap-section-overline">MERCHANT INFRASTRUCTURE</div>
            <h2 className="ap-section-title">MAKE YOUR STORE READY FOR AI BUYERS</h2>
            <p className="ap-section-desc">
              "AgentPay turns your existing product catalog into an AI-readable and AI-transactable commerce experience."
            </p>
          </div>

          {/* 8-Stage Merchant Enablement Flow */}
          <div className="ap-merchant-lifecycle-grid">
            {merchantSteps.map((st, idx) => (
              <div key={st.num} className="ap-merchant-step-card">
                <div className="ap-merchant-step-num">{st.num}</div>
                <h4 className="ap-merchant-step-title">{st.title}</h4>
                <p className="ap-merchant-step-desc">{st.desc}</p>
                {idx < merchantSteps.length - 1 && (
                  <div className="ap-merchant-step-arrow">→</div>
                )}
              </div>
            ))}
          </div>

          {/* Merchant Features Showcase Tabs */}
          <div className="ap-merchant-tabs-container">
            <div className="ap-tab-buttons">
              <button
                className={`ap-tab-btn ${activeMerchantTab === 'catalog' ? 'active' : ''}`}
                onClick={() => setActiveMerchantTab('catalog')}
              >
                <Icons.Code size={16} /> Structured AI Product Data
              </button>
              <button
                className={`ap-tab-btn ${activeMerchantTab === 'inventory' ? 'active' : ''}`}
                onClick={() => setActiveMerchantTab('inventory')}
              >
                <Icons.Package size={16} /> Real-Time Inventory Locks
              </button>
              <button
                className={`ap-tab-btn ${activeMerchantTab === 'checkout' ? 'active' : ''}`}
                onClick={() => setActiveMerchantTab('checkout')}
              >
                <Icons.Zap size={16} /> Machine-to-Machine Checkout
              </button>
              <button
                className={`ap-tab-btn ${activeMerchantTab === 'analytics' ? 'active' : ''}`}
                onClick={() => setActiveMerchantTab('analytics')}
              >
                <Icons.Analytics size={16} /> AI Growth Analytics
              </button>
            </div>

            <div className="ap-tab-content-panel">
              {activeMerchantTab === 'catalog' && (
                <div className="ap-tab-pane">
                  <div className="ap-tab-text">
                    <h4>Structured Machine-Readable Catalog Specification</h4>
                    <p>
                      Autonomous agents do not scrape messy HTML. AgentPay exposes clean, verified JSON-LD product specifications with strict SKU tags, pricing, specifications, and live stock flags.
                    </p>
                    <ul className="ap-bullet-list">
                      <li>Semantic taxonomy matching across categories</li>
                      <li>Deterministic attribute extraction (brand, model, specs)</li>
                      <li>Zero scraping overhead for connected merchants</li>
                    </ul>
                  </div>
                  <div className="ap-code-preview">
                    <div className="ap-code-header">
                      <span>GET /api/catalog/v1/products/logitech-mx3s</span>
                      <span className="ap-code-lang">JSON</span>
                    </div>
                    <pre className="ap-code-body">
{`{
  "id": "prod_logitech_mx3s",
  "sku": "LOGI-MX3S-GRY",
  "name": "Logitech MX Master 3S",
  "brand": "Logitech",
  "category": "Electronics > Peripherals",
  "price": 8495.00,
  "currency": "INR",
  "inventory_status": "IN_STOCK",
  "stock_quantity": 42,
  "ai_transactable": true,
  "specifications": {
    "connectivity": "Bluetooth / 2.4GHz",
    "sensor_dpi": 8000,
    "quiet_clicks": true
  }
}`}
                    </pre>
                  </div>
                </div>
              )}

              {activeMerchantTab === 'inventory' && (
                <div className="ap-tab-pane">
                  <div className="ap-tab-text">
                    <h4>Atomic Inventory Reservation Locks</h4>
                    <p>
                      When an AI agent evaluates a purchase, AgentPay acquires an atomic reservation quote lock with a 15-minute TTL. Out-of-stock products can never be purchased, paid for, or shipped.
                    </p>
                    <ul className="ap-bullet-list">
                      <li>Prevents double-booking across concurrent AI agents</li>
                      <li>Auto-releases inventory if policy fails or transaction expires</li>
                      <li>Guarantees 100% accurate fulfillment execution</li>
                    </ul>
                  </div>
                  <div className="ap-code-preview">
                    <div className="ap-code-header">
                      <span>POST /api/connector/quote/reserve</span>
                      <span className="ap-code-lang">JSON</span>
                    </div>
                    <pre className="ap-code-body">
{`{
  "quote_id": "qte_9f8a2b3c4d5e",
  "product_id": "prod_logitech_mx3s",
  "quantity": 1,
  "unit_price": 8495.00,
  "lock_status": "RESERVED",
  "expires_in_seconds": 900,
  "idempotency_key": "res_8495_user_10492",
  "merchant_verified": true
}`}
                    </pre>
                  </div>
                </div>
              )}

              {activeMerchantTab === 'checkout' && (
                <div className="ap-tab-pane">
                  <div className="ap-tab-text">
                    <h4>Direct Machine Checkout & Webhooks</h4>
                    <p>
                      Eliminate shopping cart abandonment. AI buyers authorize and complete checkouts via authenticated API rails, with webhook notifications delivered to your order management system.
                    </p>
                    <ul className="ap-bullet-list">
                      <li>HMAC-SHA256 signature verification on all events</li>
                      <li>Masked API credentials & zero-plaintext secret exposure</li>
                      <li>Standardized order payload matching canonical schemas</li>
                    </ul>
                  </div>
                  <div className="ap-code-preview">
                    <div className="ap-code-header">
                      <span>WEBHOOK event: order.created</span>
                      <span className="ap-code-lang">JSON</span>
                    </div>
                    <pre className="ap-code-body">
{`{
  "event": "order.created",
  "order_id": "ord_AGP_849201",
  "origin": "AUTONOMOUS_AI_BUYER",
  "payment_status": "VERIFIED",
  "amount_paid": 8495.00,
  "currency": "INR",
  "shipping_address": {
    "recipient": "Enterprise Buyer #104",
    "city": "Bengaluru",
    "postal_code": "560001"
  }
}`}
                    </pre>
                  </div>
                </div>
              )}

              {activeMerchantTab === 'analytics' && (
                <div className="ap-tab-pane">
                  <div className="ap-tab-text">
                    <h4>Single Source of Truth AI Growth Analytics</h4>
                    <p>
                      Track real revenue generated by autonomous AI buyers. Metrics are computed directly from the canonical database ledger—never fake counters or estimated projections.
                    </p>
                    <ul className="ap-bullet-list">
                      <li>AI-Originated GMV & average order value (AOV)</li>
                      <li>AI Discovery to Conversion rate tracking</li>
                      <li>Agent procurement volume & top purchasing agents</li>
                    </ul>
                  </div>
                  <div className="ap-metric-preview-grid">
                    <div className="ap-metric-card">
                      <span className="ap-metric-label">AI-Originated Revenue</span>
                      <span className="ap-metric-value">₹3,42,850</span>
                      <span className="ap-metric-sub">From 48 verified orders</span>
                    </div>
                    <div className="ap-metric-card">
                      <span className="ap-metric-label">AI Conversion Rate</span>
                      <span className="ap-metric-value">84.2%</span>
                      <span className="ap-metric-sub">Discovery to Checkout</span>
                    </div>
                    <div className="ap-metric-card">
                      <span className="ap-metric-label">Avg Order Value (AOV)</span>
                      <span className="ap-metric-value">₹7,142</span>
                      <span className="ap-metric-sub">Policy-bounded carts</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* =========================================================================
          6. TWO-SIDED ARCHITECTURE SECTION
         ========================================================================= */}
      <section id="architecture" className="ap-section ap-architecture-section">
        <div className="ap-container">
          <div className="ap-section-header">
            <div className="ap-section-overline">SYSTEM ARCHITECTURE</div>
            <h2 className="ap-section-title">TWO-SIDED COMMERCE ARCHITECTURE</h2>
            <p className="ap-section-desc">
              How AgentPay bridges autonomous buyer agents and AI-ready merchant infrastructure.
            </p>
          </div>

          {/* Visual Architecture Diagram */}
          <div className="ap-architecture-diagram">
            {/* Top Tier: AI BUYER */}
            <div className="ap-arch-tier ap-arch-buyer">
              <div className="ap-arch-tier-header">
                <div className="ap-arch-tier-icon"><Icons.User size={18} /></div>
                <div className="ap-arch-tier-title">AI BUYER DOMAIN</div>
              </div>
              <div className="ap-arch-steps-row">
                <div className="ap-arch-step-box">Intent</div>
                <div className="ap-arch-arrow">→</div>
                <div className="ap-arch-step-box">Discovery</div>
                <div className="ap-arch-arrow">→</div>
                <div className="ap-arch-step-box">Evaluation</div>
                <div className="ap-arch-arrow">→</div>
                <div className="ap-arch-step-box">Policy</div>
                <div className="ap-arch-arrow">→</div>
                <div className="ap-arch-step-box">Purchase</div>
              </div>
            </div>

            {/* Middle Hub: AGENTPAY COMMERCE LAYER */}
            <div className="ap-arch-middle-hub">
              <div className="ap-arch-connector-line">
                <span>↕ AgentPay Commerce Layer ↕</span>
              </div>
              <div className="ap-hub-grid">
                <div className="ap-hub-item">
                  <Icons.Cpu size={16} />
                  <span>Intent Parser & Orchestrator</span>
                </div>
                <div className="ap-hub-item">
                  <Icons.Shield size={16} />
                  <span>Deterministic Policy & Risk Engine</span>
                </div>
                <div className="ap-hub-item">
                  <Icons.Package size={16} />
                  <span>Price & Inventory Protection Gate</span>
                </div>
                <div className="ap-hub-item">
                  <Icons.CreditCard size={16} />
                  <span>Razorpay Test Rails Adapter</span>
                </div>
                <div className="ap-hub-item">
                  <Icons.Lock size={16} />
                  <span>Cryptographic Idempotency Engine</span>
                </div>
                <div className="ap-hub-item">
                  <Icons.FileText size={16} />
                  <span>Immutable Audit Ledger</span>
                </div>
              </div>
              <div className="ap-arch-connector-line">
                <span>↕ AgentPay Commerce Layer ↕</span>
              </div>
            </div>

            {/* Bottom Tier: MERCHANT */}
            <div className="ap-arch-tier ap-arch-merchant">
              <div className="ap-arch-tier-header">
                <div className="ap-arch-tier-icon"><Icons.Store size={18} /></div>
                <div className="ap-arch-tier-title">MERCHANT STORE DOMAIN</div>
              </div>
              <div className="ap-arch-steps-row">
                <div className="ap-arch-step-box">Catalog</div>
                <div className="ap-arch-arrow">→</div>
                <div className="ap-arch-step-box">Inventory</div>
                <div className="ap-arch-arrow">→</div>
                <div className="ap-arch-step-box">Quote</div>
                <div className="ap-arch-arrow">→</div>
                <div className="ap-arch-step-box">Checkout</div>
                <div className="ap-arch-arrow">→</div>
                <div className="ap-arch-step-box">Order</div>
                <div className="ap-arch-arrow">→</div>
                <div className="ap-arch-step-box">Fulfillment</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* =========================================================================
          7. TRUST & SAFETY SECTION
         ========================================================================= */}
      <section id="trust-safety" className="ap-section ap-trust-section">
        <div className="ap-container">
          <div className="ap-section-header">
            <div className="ap-section-overline">FINANCIAL & TRANSACTION INTEGRITY</div>
            <h2 className="ap-section-title">BUILT FOR CONTROLLED AUTONOMOUS COMMERCE</h2>
            <p className="ap-section-desc">
              AI recommendations are not payment authorization. AgentPay enforces deterministic server-side guards at every stage.
            </p>
          </div>

          {/* 4 Core Pillars */}
          <div className="ap-principles-grid">
            <div className="ap-principle-card">
              <div className="ap-principle-number">01</div>
              <h4 className="ap-principle-title">AI proposes.</h4>
              <p className="ap-principle-desc">
                LLMs parse procurement intent and recommend candidate products. The AI agent never possesses direct payment authority, bank credentials, or unconstrained spending ability.
              </p>
            </div>

            <div className="ap-principle-card">
              <div className="ap-principle-number">02</div>
              <h4 className="ap-principle-title">Your policies decide.</h4>
              <p className="ap-principle-desc">
                Deterministic spending limits, per-transaction ceilings, category constraints, and risk score thresholds evaluate strictly server-side before any checkout session begins.
              </p>
            </div>

            <div className="ap-principle-card">
              <div className="ap-principle-number">03</div>
              <h4 className="ap-principle-title">AgentPay verifies.</h4>
              <p className="ap-principle-desc">
                Live catalog pricing is revalidated against surge thresholds (max 5% drift), and real-time inventory reservation locks verify physical stock availability before execution.
              </p>
            </div>

            <div className="ap-principle-card">
              <div className="ap-principle-number">04</div>
              <h4 className="ap-principle-title">Payment executes only after authorization.</h4>
              <p className="ap-principle-desc">
                Payment orders run through Razorpay rails with cryptographic HMAC-SHA256 signature verification. State machine transitions lock each state irrevocably.
              </p>
            </div>
          </div>

          {/* 8 Verified Platform Capabilities */}
          <div className="ap-capabilities-panel">
            <h4 className="ap-capabilities-title">Active Backend Capabilities</h4>
            <div className="ap-capabilities-grid">
              <div className="ap-cap-item">
                <Icons.ShieldCheck size={16} />
                <div>
                  <strong>Price Revalidation</strong>
                  <span>Max 5% surge tolerance before mandatory block</span>
                </div>
              </div>
              <div className="ap-cap-item">
                <Icons.Package size={16} />
                <div>
                  <strong>Inventory Locks</strong>
                  <span>Atomic quote reservations with TTL expiry</span>
                </div>
              </div>
              <div className="ap-cap-item">
                <Icons.Sliders size={16} />
                <div>
                  <strong>Server-Side Policy Gate</strong>
                  <span>Deterministic budget caps & category rules</span>
                </div>
              </div>
              <div className="ap-cap-item">
                <Icons.Lock size={16} />
                <div>
                  <strong>Cryptographic Verification</strong>
                  <span>HMAC-SHA256 signatures on payment callbacks</span>
                </div>
              </div>
              <div className="ap-cap-item">
                <Icons.Key size={16} />
                <div>
                  <strong>Webhook Security</strong>
                  <span>Masked credentials & timing-safe signature check</span>
                </div>
              </div>
              <div className="ap-cap-item">
                <Icons.RefreshCw size={16} />
                <div>
                  <strong>Transaction Idempotency</strong>
                  <span>Redis & DB SHA-256 idempotency locks</span>
                </div>
              </div>
              <div className="ap-cap-item">
                <Icons.FileText size={16} />
                <div>
                  <strong>Immutable Audit Trail</strong>
                  <span>Event-sourced audit logs for every state change</span>
                </div>
              </div>
              <div className="ap-cap-item">
                <Icons.AlertTriangle size={16} />
                <div>
                  <strong>Emergency Kill Switch</strong>
                  <span>Platform-wide instant freeze for autonomous flows</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* =========================================================================
          8. TRACK 01 CONNECTION & DISCLOSURE
         ========================================================================= */}
      <section className="ap-section ap-track-section">
        <div className="ap-container">
          <div className="ap-track-box">
            <div className="ap-track-box-header">
              <span className="ap-tag">TRACK 01: AI GROWTH & AGENTIC COMMERCE</span>
              <h3 className="ap-track-box-title">BUILT FOR THE NEXT ERA OF COMMERCE</h3>
            </div>
            <p className="ap-track-box-text">
              "AgentPay makes merchants discoverable and transactable by autonomous AI buyers while giving buyers bounded, auditable control over every purchase."
            </p>
            <div className="ap-environment-disclosure">
              <Icons.Info size={16} />
              <span>
                <strong>Sandbox Demonstration Environment:</strong> AgentPay currently operates on Razorpay Test Rails with isolated test merchant catalogs for Track 01 evaluation. Live production money settlement is disabled by default to ensure safe, repeatable demonstrations.
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* =========================================================================
          9. BOTTOM CALL TO ACTION
         ========================================================================= */}
      <section className="ap-bottom-cta">
        <div className="ap-container">
          <div className="ap-bottom-cta-card">
            <h2 className="ap-bottom-cta-title">Ready to experience agentic commerce?</h2>
            <p className="ap-bottom-cta-desc">
              Choose your role and explore autonomous procurement with deterministic spending controls.
            </p>
            <div className="ap-bottom-cta-buttons">
              <button
                className="ap-btn ap-btn-primary ap-btn-lg"
                onClick={() => handleSelectRole('BUYER')}
              >
                Get Started as Buyer →
              </button>
              <button
                className="ap-btn ap-btn-outline ap-btn-lg"
                onClick={() => handleSelectRole('MERCHANT')}
              >
                Get Started as Merchant →
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* =========================================================================
          10. FOOTER
         ========================================================================= */}
      <footer className="ap-footer">
        <div className="ap-container ap-footer-inner">
          <div className="ap-footer-brand">
            <div className="ap-brand-badge">AP</div>
            <span className="ap-brand-name">AgentPay</span>
            <p className="ap-footer-tagline">
              The commerce layer for AI agents. Grow merchant revenue, and make them sellable to AI buyers.
            </p>
            <div className="ap-footer-status">
              <span className="ap-status-dot" />
              <span>Razorpay Test Sandbox Rails Active</span>
            </div>
          </div>

          <div className="ap-footer-nav-col">
            <h5 className="ap-footer-col-title">Buyer Interface</h5>
            <button className="ap-footer-link" onClick={() => handleSelectRole('BUYER')}>
              Buyer Registration
            </button>
            <button className="ap-footer-link" onClick={() => navigate('/login')}>
              Buyer Sign In
            </button>
            <button className="ap-footer-link" onClick={() => scrollToSection('buyer-workflow')}>
              9-Stage Workflow
            </button>
          </div>

          <div className="ap-footer-nav-col">
            <h5 className="ap-footer-col-title">Merchant Store</h5>
            <button className="ap-footer-link" onClick={() => handleSelectRole('MERCHANT')}>
              Merchant Registration
            </button>
            <button className="ap-footer-link" onClick={() => navigate('/login')}>
              Merchant Sign In
            </button>
            <button className="ap-footer-link" onClick={() => scrollToSection('merchant-solution')}>
              Track 01 Enablement
            </button>
          </div>

          <div className="ap-footer-nav-col">
            <h5 className="ap-footer-col-title">Architecture & Security</h5>
            <button className="ap-footer-link" onClick={() => scrollToSection('architecture')}>
              Two-Sided Architecture
            </button>
            <button className="ap-footer-link" onClick={() => scrollToSection('trust-safety')}>
              Trust & Safety
            </button>
            <button className="ap-footer-link" onClick={() => navigate('/login')}>
              System Status
            </button>
          </div>
        </div>

        <div className="ap-footer-bottom">
          <div className="ap-container ap-footer-bottom-inner">
            <span>© {new Date().getFullYear()} AgentPay. Track 01: AI Growth & Agentic Commerce.</span>
            <span>Deterministic AI Commerce Infrastructure</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
