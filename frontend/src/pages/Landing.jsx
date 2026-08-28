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

  // Buyer 10-Stage Verified Procurement Lifecycle
  const buyerSteps = [
    {
      num: '01',
      title: 'Natural Language Intent',
      badge: 'Intent Parser',
      desc: 'Buyer expresses procurement criteria in natural language ("Find me a 20,000mAh power bank under ₹3,000 with fast charging").',
      details: 'Deterministic extraction of product category, brand preference, price ceilings, and mandatory specifications.',
    },
    {
      num: '02',
      title: 'AI Product Discovery',
      badge: 'Catalog API',
      desc: 'Autonomous agent queries connected AI-ready merchant catalogs for structured matching products.',
      details: 'High-performance vector and attribute search across verified merchant stores.',
    },
    {
      num: '03',
      title: 'Product Matching',
      badge: 'Ranking Engine',
      desc: 'Ranks candidates against buyer constraints: price, delivery timeframe, merchant rating, and stock status.',
      details: 'Objective multi-attribute scoring with zero sponsored bias or dark patterns.',
    },
    {
      num: '04',
      title: 'Buyer Preferences',
      badge: 'User Constraints',
      desc: 'Applies personalized buyer preferences such as preferred shipping carriers and brand priorities.',
      details: 'Configured once, enforced deterministically across all autonomous agent procurement runs.',
    },
    {
      num: '05',
      title: 'Policy Evaluation',
      badge: 'Deterministic Gate',
      desc: 'Server-side policy engine verifies per-transaction limits, daily budgets, category whitelists, and risk score thresholds.',
      details: 'Strict mathematical bounding: if price exceeds limit, transaction halts or escalates to 1-click human review.',
    },
    {
      num: '06',
      title: 'Price & Inventory Validation',
      badge: 'Pre-flight Gate',
      desc: 'Revalidates live catalog price against surge limits and acquires an atomic stock reservation lock.',
      details: 'PRICE CHANGE PROTECTION: Final checkout price must remain within buyer authorization.',
    },
    {
      num: '07',
      title: 'Authorized Checkout',
      badge: 'Idempotent Token',
      desc: 'Creates an authorized checkout session with an idempotent cryptographic transaction key.',
      details: 'SHA-256 idempotency locking guarantees no duplicate charges during network retries.',
    },
    {
      num: '08',
      title: 'Payment',
      badge: 'Payment Rails',
      desc: 'Payment executes with cryptographic HMAC-SHA256 signature verification.',
      details: 'Signature verification proves genuine authorization before state progression.',
    },
    {
      num: '09',
      title: 'Merchant Order',
      badge: 'Order Dispatch',
      desc: 'Verified order injected directly into merchant fulfillment ledger with payment confirmed.',
      details: 'Order created with line items, tax breakdown, and shipping destination.',
    },
    {
      num: '10',
      title: 'Fulfillment',
      badge: 'Invoice & Delivery',
      desc: 'Automated invoice generation, carrier tracking assignment, and complete immutable audit timeline.',
      details: 'Full transaction receipt and immutable audit log available immediately to buyer and merchant.',
    },
  ];

  // Merchant 9-Stage Enablement Lifecycle
  const merchantSteps = [
    {
      num: '01',
      title: 'Merchant Catalog',
      desc: 'Connect your existing store inventory via REST API or structured product feeds.',
    },
    {
      num: '02',
      title: 'Structured Product Data',
      desc: 'AgentPay transforms products into machine-readable JSON-LD specifications with semantic tags.',
    },
    {
      num: '03',
      title: 'AI Discoverability',
      desc: 'Autonomous buyer agents discover your products through high-speed structured search endpoints.',
    },
    {
      num: '04',
      title: 'Inventory Availability',
      desc: 'Atomic stock verification prevents overselling with temporary quote reservation locks.',
    },
    {
      num: '05',
      title: 'Price Quotes',
      desc: 'Deterministic price quotes guarantee exact checkout amounts with zero unexpected drift.',
    },
    {
      num: '06',
      title: 'Machine Checkout',
      desc: 'AI buyers execute direct API checkouts without human browser friction or cart abandonment.',
    },
    {
      num: '07',
      title: 'AI-Originated Order',
      desc: 'Pre-paid orders arrive with verified payment status directly into your fulfillment pipeline.',
    },
    {
      num: '08',
      title: 'Payment Verification',
      desc: 'Cryptographic HMAC-SHA256 verification confirms payment before stock decrement occurs.',
    },
    {
      num: '09',
      title: 'Fulfillment',
      desc: 'Dispatch orders with integrated courier tracking and automated invoice issuance.',
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
          </div>

          {/* Desktop Navigation Links */}
          <nav className="ap-nav-links">
            <button className="ap-nav-link" onClick={() => scrollToSection('roles')}>
              Role Selection
            </button>
            <button className="ap-nav-link" onClick={() => scrollToSection('buyer-workflow')}>
              Buyer Flow
            </button>
            <button className="ap-nav-link" onClick={() => scrollToSection('merchant-solution')}>
              Merchant Flow
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
                <Icons.Store size={16} /> Merchant Flow
              </button>
              <button className="ap-mobile-nav-link" onClick={() => scrollToSection('architecture')}>
                <Icons.Layers size={16} /> Two-Sided Architecture
              </button>
              <button className="ap-mobile-nav-link" onClick={() => scrollToSection('trust-safety')}>
                <Icons.ShieldCheck size={16} /> Controlled Autonomous Commerce
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
            Buy with AI.<br />
            <span className="ap-hero-highlight">Sell to AI buyers.</span>
          </h1>

          {/* Supporting Subheading */}
          <p className="ap-hero-subtitle">
            "AgentPay connects autonomous AI buyers with AI-ready merchants, enabling product discovery, intelligent matching, policy-controlled checkout, payment authorization and verified order execution."
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
                  Tell AgentPay what you need. Your agent finds the right product, evaluates it against your rules, and executes an authorized purchase.
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
                <div className="ap-quick-role-title">Sell to AI buyers</div>
                <div className="ap-quick-role-desc">
                  Make your catalog AI-readable and transactable so autonomous buyers can discover, evaluate and purchase your products.
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
          3. ROLE SELECTION SECTION
         ========================================================================= */}
      <section id="roles" className="ap-section ap-roles-section">
        <div className="ap-container">
          <div className="ap-section-header">
            <div className="ap-section-overline">TWO-SIDED PLATFORM</div>
            <h2 className="ap-section-title">WHAT ARE YOU HERE TO DO?</h2>
            <p className="ap-section-desc">
              AgentPay separates buyer agent controls and merchant store operations into dedicated, secure control planes.
            </p>
          </div>

          <div className="ap-roles-grid">
            {/* BUY WITH AI */}
            <div className="ap-role-card ap-role-buyer">
              <div className="ap-role-card-header">
                <div className="ap-role-icon-box buyer-box">
                  <Icons.Sparkles size={24} />
                </div>
                <span className="ap-role-pill">AI BUYER</span>
              </div>

              <div className="ap-role-body">
                <h3 className="ap-role-headline">BUY WITH AI</h3>
                <p className="ap-role-text">
                  "Tell AgentPay what you need. Your agent finds the right product, evaluates it against your rules, and executes an authorized purchase."
                </p>

                <div className="ap-role-features">
                  <div className="ap-feature-item">
                    <span className="ap-check-icon"><Icons.Check size={14} /></span>
                    <span>Natural language requirement parsing</span>
                  </div>
                  <div className="ap-feature-item">
                    <span className="ap-check-icon"><Icons.Check size={14} /></span>
                    <span>Server-side deterministic spending rules</span>
                  </div>
                  <div className="ap-feature-item">
                    <span className="ap-check-icon"><Icons.Check size={14} /></span>
                    <span>Price change protection & stock validation</span>
                  </div>
                  <div className="ap-feature-item">
                    <span className="ap-check-icon"><Icons.Check size={14} /></span>
                    <span>1-click human review for edge cases</span>
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
                  Already have an AI Buyer account? <button onClick={() => navigate('/login?role=BUYER')}>Sign in</button>
                </div>
              </div>
            </div>

            {/* SELL TO AI */}
            <div className="ap-role-card ap-role-merchant">
              <div className="ap-role-card-header">
                <div className="ap-role-icon-box merchant-box">
                  <Icons.Store size={24} />
                </div>
                <span className="ap-role-pill merchant-pill">AI MERCHANT</span>
              </div>

              <div className="ap-role-body">
                <h3 className="ap-role-headline">SELL TO AI</h3>
                <p className="ap-role-text">
                  "Make your catalog AI-readable and transactable so autonomous buyers can discover, evaluate and purchase your products."
                </p>

                <div className="ap-role-features">
                  <div className="ap-feature-item">
                    <span className="ap-check-icon"><Icons.Check size={14} /></span>
                    <span>Structured JSON-LD catalog transformation</span>
                  </div>
                  <div className="ap-feature-item">
                    <span className="ap-check-icon"><Icons.Check size={14} /></span>
                    <span>Real-time inventory reservation locks</span>
                  </div>
                  <div className="ap-feature-item">
                    <span className="ap-check-icon"><Icons.Check size={14} /></span>
                    <span>Direct machine-to-machine checkout API</span>
                  </div>
                  <div className="ap-feature-item">
                    <span className="ap-check-icon"><Icons.Check size={14} /></span>
                    <span>AI-originated order & revenue attribution</span>
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
                  Already have an AI Merchant store? <button onClick={() => navigate('/login?role=MERCHANT')}>Sign in</button>
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
              <strong>Role-Based Tenant Isolation:</strong> Buyer accounts cannot access merchant store settings or order fulfillment ledgers. Merchant accounts cannot access private buyer agent policies. Role boundaries are validated at every API gateway request.
            </div>
          </div>
        </div>
      </section>

      {/* =========================================================================
          4. BUYER FLOW SECTION
         ========================================================================= */}
      <section id="buyer-workflow" className="ap-section ap-buyer-section">
        <div className="ap-container">
          <div className="ap-section-header">
            <div className="ap-section-overline">BUYER FLOW</div>
            <h2 className="ap-section-title">YOUR AI PURCHASING AGENT</h2>
            <p className="ap-section-desc">
              "One request. Your rules. The agent handles the commerce workflow."
            </p>
          </div>

          {/* 10-Step Interactive Pipeline */}
          <div className="ap-pipeline-card">
            <div className="ap-pipeline-header">
              <div className="ap-pipeline-title-group">
                <span className="ap-tag">10-STAGE VERIFIED LIFECYCLE</span>
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

            {/* Scannable Step Progression Grid */}
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
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* =========================================================================
          5. MERCHANT FLOW SECTION
         ========================================================================= */}
      <section id="merchant-solution" className="ap-section ap-merchant-section">
        <div className="ap-container">
          <div className="ap-section-header">
            <div className="ap-section-overline">MERCHANT FLOW</div>
            <h2 className="ap-section-title">MAKE YOUR STORE READY FOR AI BUYERS</h2>
            <p className="ap-section-desc">
              AgentPay makes merchant catalogs AI-readable AND AI-transactable for autonomous AI buyers.
            </p>
          </div>

          {/* 9-Stage Merchant Enablement Flow */}
          <div className="ap-merchant-lifecycle-grid">
            {merchantSteps.map((st) => (
              <div key={st.num} className="ap-merchant-step-card">
                <div className="ap-merchant-step-num">{st.num}</div>
                <h4 className="ap-merchant-step-title">{st.title}</h4>
                <p className="ap-merchant-step-desc">{st.desc}</p>
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
                <Icons.Code size={16} /> Structured Product Data
              </button>
              <button
                className={`ap-tab-btn ${activeMerchantTab === 'inventory' ? 'active' : ''}`}
                onClick={() => setActiveMerchantTab('inventory')}
              >
                <Icons.Package size={16} /> Inventory Availability
              </button>
              <button
                className={`ap-tab-btn ${activeMerchantTab === 'checkout' ? 'active' : ''}`}
                onClick={() => setActiveMerchantTab('checkout')}
              >
                <Icons.Zap size={16} /> Machine Checkout
              </button>
              <button
                className={`ap-tab-btn ${activeMerchantTab === 'analytics' ? 'active' : ''}`}
                onClick={() => setActiveMerchantTab('analytics')}
              >
                <Icons.Analytics size={16} /> AI Discoverability & Orders
              </button>
            </div>

            <div className="ap-tab-content-panel">
              {activeMerchantTab === 'catalog' && (
                <div className="ap-tab-pane">
                  <div className="ap-tab-text">
                    <h4>Structured Machine-Readable Catalog Specification</h4>
                    <p>
                      Autonomous agents do not scrape unstructured HTML. AgentPay transforms merchant inventories into machine-readable JSON-LD product specifications with strict SKU tags, pricing, specifications, and live stock flags.
                    </p>
                    <ul className="ap-bullet-list">
                      <li>Semantic taxonomy matching across product categories</li>
                      <li>Deterministic attribute extraction (brand, model, hardware specs)</li>
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
                    <h4>Real-Time Inventory Reservation Quote Locks</h4>
                    <p>
                      When an AI agent evaluates a purchase, AgentPay acquires an atomic reservation quote lock. Out-of-stock products can never be purchased, paid for, or shipped.
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
                      AI buyers authorize and complete checkouts via authenticated API rails, with webhook notifications delivered directly into the merchant order fulfillment system.
                    </p>
                    <ul className="ap-bullet-list">
                      <li>HMAC-SHA256 signature verification on all webhook callbacks</li>
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
  "origin": "AI_BUYER",
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
                    <h4>Canonical AI Conversion & Revenue Attribution</h4>
                    <p>
                      Track real revenue generated by autonomous AI buyers. Metrics are computed directly from the canonical database ledger—never fake counters or estimated projections.
                    </p>
                    <ul className="ap-bullet-list">
                      <li>AI-Originated GMV & average order value (AOV)</li>
                      <li>AI Discovery to Conversion rate tracking</li>
                      <li>Agent procurement volume & purchasing agent activity</li>
                    </ul>
                  </div>
                  <div className="ap-code-preview">
                    <div className="ap-code-header">
                      <span>GET /api/merchant/analytics</span>
                      <span className="ap-code-lang">JSON</span>
                    </div>
                    <pre className="ap-code-body">
{`{
  "source_of_truth": "CANONICAL_ORDERS_LEDGER",
  "metrics": {
    "ai_originated_revenue": "Computed dynamically from verified transactions",
    "completed_orders": "Filtered by payment_status = 'VERIFIED'",
    "conversion_rate": "Ratio of intent discovery to confirmed orders",
    "attribution": "Direct AI agent channel tracking"
  }
}`}
                    </pre>
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
                <div className="ap-arch-step-box">Matching</div>
                <div className="ap-arch-arrow">→</div>
                <div className="ap-arch-step-box">Preferences</div>
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
                  <span>Payment Rails & Provider Adapters</span>
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
                <div className="ap-arch-tier-title">AI MERCHANT DOMAIN</div>
              </div>
              <div className="ap-arch-steps-row">
                <div className="ap-arch-step-box">Catalog</div>
                <div className="ap-arch-arrow">→</div>
                <div className="ap-arch-step-box">Structured Data</div>
                <div className="ap-arch-arrow">→</div>
                <div className="ap-arch-step-box">Discoverability</div>
                <div className="ap-arch-arrow">→</div>
                <div className="ap-arch-step-box">Quotes</div>
                <div className="ap-arch-arrow">→</div>
                <div className="ap-arch-step-box">Checkout</div>
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
            <div className="ap-section-overline">GOVERNANCE & SAFETY</div>
            <h2 className="ap-section-title">CONTROLLED AUTONOMOUS COMMERCE</h2>
            <p className="ap-section-desc">
              AI recommendations are not payment authorization. AgentPay enforces deterministic server-side guards at every stage.
            </p>
          </div>

          {/* 5 Core Pillars */}
          <div className="ap-principles-grid ap-5-pillars-grid">
            <div className="ap-principle-card">
              <div className="ap-principle-number">01</div>
              <h4 className="ap-principle-title">AI proposes.</h4>
              <p className="ap-principle-desc">
                LLMs parse procurement intent and recommend candidate products. The AI agent never possesses direct payment authority or credentials.
              </p>
            </div>

            <div className="ap-principle-card">
              <div className="ap-principle-number">02</div>
              <h4 className="ap-principle-title">Policies constrain.</h4>
              <p className="ap-principle-desc">
                Deterministic spending limits, per-transaction ceilings, category constraints, and risk score thresholds evaluate strictly server-side.
              </p>
            </div>

            <div className="ap-principle-card">
              <div className="ap-principle-number">03</div>
              <h4 className="ap-principle-title">AgentPay verifies.</h4>
              <p className="ap-principle-desc">
                Live catalog pricing is revalidated against surge limits and atomic reservation locks verify real physical stock availability.
              </p>
            </div>

            <div className="ap-principle-card">
              <div className="ap-principle-number">04</div>
              <h4 className="ap-principle-title">Payment executes.</h4>
              <p className="ap-principle-desc">
                Payment orders run through secure rails with cryptographic HMAC-SHA256 signature verification and irreversible state machine transitions.
              </p>
            </div>

            <div className="ap-principle-card">
              <div className="ap-principle-number">05</div>
              <h4 className="ap-principle-title">Merchants fulfill.</h4>
              <p className="ap-principle-desc">
                Orders dispatch into merchant fulfillment systems with verified payment status, automated invoice generation, and courier tracking.
              </p>
            </div>
          </div>

          {/* 9 Verified Platform Capabilities Grid */}
          <div className="ap-capabilities-panel">
            <h4 className="ap-capabilities-title">Active Backend Capabilities</h4>
            <div className="ap-capabilities-grid">
              <div className="ap-cap-item">
                <Icons.ShieldCheck size={16} />
                <div>
                  <strong>Server-side authorization</strong>
                  <span>Deterministic spending limits evaluated on server</span>
                </div>
              </div>
              <div className="ap-cap-item">
                <Icons.Sliders size={16} />
                <div>
                  <strong>Deterministic spending rules</strong>
                  <span>Per-transaction caps, daily limits, category rules</span>
                </div>
              </div>
              <div className="ap-cap-item">
                <Icons.Activity size={16} />
                <div>
                  <strong>Price revalidation</strong>
                  <span>PRICE CHANGE PROTECTION before checkout execution</span>
                </div>
              </div>
              <div className="ap-cap-item">
                <Icons.Package size={16} />
                <div>
                  <strong>Inventory validation</strong>
                  <span>Atomic quote reservations with TTL expiry locks</span>
                </div>
              </div>
              <div className="ap-cap-item">
                <Icons.ShieldAlert size={16} />
                <div>
                  <strong>Risk evaluation</strong>
                  <span>Multi-factor explainable risk scoring</span>
                </div>
              </div>
              <div className="ap-cap-item">
                <Icons.Lock size={16} />
                <div>
                  <strong>Payment verification</strong>
                  <span>Cryptographic HMAC-SHA256 signature validation</span>
                </div>
              </div>
              <div className="ap-cap-item">
                <Icons.Key size={16} />
                <div>
                  <strong>Webhook verification</strong>
                  <span>Timing-safe signatures & masked credential storage</span>
                </div>
              </div>
              <div className="ap-cap-item">
                <Icons.RefreshCw size={16} />
                <div>
                  <strong>Idempotency</strong>
                  <span>Redis & DB SHA-256 idempotency locks</span>
                </div>
              </div>
              <div className="ap-cap-item">
                <Icons.FileText size={16} />
                <div>
                  <strong>Audit trail</strong>
                  <span>Event-sourced audit logs for every state transition</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* =========================================================================
          8. PLATFORM POSITIONING
         ========================================================================= */}
      <section className="ap-section ap-track-section">
        <div className="ap-container">
          <div className="ap-track-box">
            <div className="ap-track-box-header">
              <span className="ap-tag">AI COMMERCE INFRASTRUCTURE</span>
              <h3 className="ap-track-box-title">BUILT FOR THE NEXT ERA OF COMMERCE</h3>
            </div>
            <p className="ap-track-box-text">
              "AgentPay connects autonomous AI buyers with AI-ready merchants, enabling product discovery, intelligent matching, policy-controlled checkout, payment authorization and verified order execution."
            </p>
          </div>
        </div>
      </section>

      {/* =========================================================================
          9. BOTTOM CALL TO ACTION
         ========================================================================= */}
      <section className="ap-bottom-cta">
        <div className="ap-container">
          <div className="ap-bottom-cta-card">
            <h2 className="ap-bottom-cta-title">The commerce layer for AI agents.</h2>
            <p className="ap-bottom-cta-desc">
              Choose your role and experience autonomous commerce with deterministic policy gates.
            </p>
            <div className="ap-bottom-cta-buttons">
              <button
                className="ap-btn ap-btn-primary ap-btn-lg"
                onClick={() => handleSelectRole('BUYER')}
              >
                Continue as Buyer →
              </button>
              <button
                className="ap-btn ap-btn-outline ap-btn-lg"
                onClick={() => handleSelectRole('MERCHANT')}
              >
                Continue as Merchant →
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
              The commerce layer for AI agents. Buy with AI. Sell to AI buyers.
            </p>
          </div>

          <div className="ap-footer-nav-col">
            <h5 className="ap-footer-col-title">AI Buyer</h5>
            <button className="ap-footer-link" onClick={() => handleSelectRole('BUYER')}>
              Buyer Registration
            </button>
            <button className="ap-footer-link" onClick={() => navigate('/login?role=BUYER')}>
              Buyer Sign In
            </button>
            <button className="ap-footer-link" onClick={() => scrollToSection('buyer-workflow')}>
              Buyer Procurement Flow
            </button>
          </div>

          <div className="ap-footer-nav-col">
            <h5 className="ap-footer-col-title">AI Merchant</h5>
            <button className="ap-footer-link" onClick={() => handleSelectRole('MERCHANT')}>
              Merchant Registration
            </button>
            <button className="ap-footer-link" onClick={() => navigate('/login?role=MERCHANT')}>
              Merchant Sign In
            </button>
            <button className="ap-footer-link" onClick={() => scrollToSection('merchant-solution')}>
              Merchant Enablement Flow
            </button>
          </div>

          <div className="ap-footer-nav-col">
            <h5 className="ap-footer-col-title">Architecture & Governance</h5>
            <button className="ap-footer-link" onClick={() => scrollToSection('architecture')}>
              Two-Sided Architecture
            </button>
            <button className="ap-footer-link" onClick={() => scrollToSection('trust-safety')}>
              Controlled Autonomous Commerce
            </button>
            <button className="ap-footer-link" onClick={() => navigate('/login')}>
              System Status
            </button>
          </div>
        </div>

        <div className="ap-footer-bottom">
          <div className="ap-container ap-footer-bottom-inner">
            <span>© {new Date().getFullYear()} AgentPay. All rights reserved.</span>
            <span>Deterministic Autonomous Commerce Infrastructure</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
