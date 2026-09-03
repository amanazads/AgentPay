import React, { useState, useEffect } from 'react';
import { api } from '../../services/api';
import { Icons } from '../ui/Icons';
import Button from '../ui/Button';
import StatusBadge from '../ui/StatusBadge';
import Dialog from '../ui/Dialog';
import './AICommerceDemoRunner.css';

export default function AICommerceDemoRunner({ initialProductId = null, initialScenario = 'happy_path', onBackToReadiness }) {
  const [loading, setLoading] = useState(false);
  const [demoData, setDemoData] = useState(null);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [customPrompt, setCustomPrompt] = useState('Find me the best Sony WH-1000XM5 headphones under ₹15,000');
  const [activeTab, setActiveTab] = useState(initialScenario); // 'happy_path' | 'failure_demo' | 'payment_fail' | 'reconcile'
  const [interactionMode, setInteractionMode] = useState('AI_SHOPPING'); // 'AI_SHOPPING' | 'JUDGE_MODE'
  const [deliveryMethod, setDeliveryMethod] = useState('STANDARD'); // 'STANDARD' | 'EXPRESS'
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isExecuting, setIsExecuting] = useState(false);
  const [execResult, setExecResult] = useState(null);
  const [selectedAuditLog, setSelectedAuditLog] = useState(null);
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);

  useEffect(() => {
    loadDemoData();
  }, []);

  const loadDemoData = async () => {
    try {
      setLoading(true);
      const res = await api.getAICommerceReadinessData();
      setDemoData(res);

      if (res?.products?.length > 0) {
        let initial = null;
        if (initialProductId) {
          initial = res.products.find((p) => p.id === initialProductId);
        }
        if (!initial) {
          initial = res.products.find((p) => p.name.includes('Sony')) || res.products[0];
        }
        handleSelectProduct(initial);
      }
    } catch (e) {
      console.error('Failed to load readiness data', e);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectProduct = (product) => {
    if (!product) return;
    setSelectedProduct(product);
    setExecResult(null);
    setCurrentStepIndex(0);

    const price = parseFloat(product.price) || 10000;
    const maxBudget = Math.ceil((price * 1.15) / 1000) * 1000;
    setCustomPrompt(`Find me the best ${product.name} under ₹${maxBudget.toLocaleString('en-IN')}`);
  };

  const handleRunHappyPath = async () => {
    setIsExecuting(true);
    setCurrentStepIndex(1);
    setExecResult(null);

    try {
      // Step progression for visual clarity
      for (let s = 1; s <= 6; s++) {
        setCurrentStepIndex(s);
        await new Promise((r) => setTimeout(r, 200));
      }

      const result = await api.executeAutonomousCommercePreview({
        productId: selectedProduct?.id,
        prompt: customPrompt,
        deliveryMethod,
      });
      setExecResult(result);
      setCurrentStepIndex(15);
    } catch (err) {
      console.error('Execution error', err);
      alert('Execution failed: ' + (err.message || 'Server error'));
    } finally {
      setIsExecuting(false);
    }
  };

  const handleRunFailureDemo = async () => {
    setIsExecuting(true);
    setCurrentStepIndex(1);
    setExecResult(null);

    try {
      for (let s = 1; s <= 3; s++) {
        setCurrentStepIndex(s);
        await new Promise((r) => setTimeout(r, 200));
      }

      const result = await api.testPriceSurgeProtection({
        productId: selectedProduct?.id,
      });
      setExecResult(result);
      setCurrentStepIndex(8);
    } catch (err) {
      console.error('Surge protection error', err);
      alert('Protection error: ' + (err.message || 'Server error'));
    } finally {
      setIsExecuting(false);
    }
  };

  const handleRunPaymentFailure = async () => {
    setIsExecuting(true);
    setExecResult(null);
    try {
      const result = await api.testSignatureVerification({ productId: selectedProduct?.id });
      setExecResult(result);
    } catch (err) {
      alert('Signature verification test error: ' + err.message);
    } finally {
      setIsExecuting(false);
    }
  };

  const handleRunReconciliation = async () => {
    setIsExecuting(true);
    setExecResult(null);
    try {
      const result = await api.testLedgerReconciliation({ productId: selectedProduct?.id });
      setExecResult(result);
    } catch (err) {
      alert('Reconciliation test error: ' + err.message);
    } finally {
      setIsExecuting(false);
    }
  };

  const handleReset = async () => {
    await api.resetAICommerceState();
    setExecResult(null);
    setCurrentStepIndex(0);
    loadDemoData();
  };

  const categories = ['ALL', 'Electronics', 'Peripherals', 'Furniture', 'Software & Licenses'];
  const filteredProducts = demoData?.products?.filter((p) => {
    if (categoryFilter === 'ALL') return true;
    return p.category?.toLowerCase() === categoryFilter.toLowerCase() || p.category?.toLowerCase().includes(categoryFilter.toLowerCase());
  }) || [];

  return (
    <div className="demo-runner-container">
      {/* Demo Header */}
      <div className="demo-runner-header">
        <div className="demo-header-title-row">
          <div className="demo-badge-wrap">
            <span className="demo-env-badge">AI AGENT COMMERCE</span>
            <span className="demo-mode-badge">AI BUYER COMMERCE ENGINE</span>
          </div>
          <h1 className="demo-main-title">AI Buyer Commerce Engine</h1>
          <p className="demo-main-sub">
            Preview how autonomous AI buyers discover your catalog, compare products, evaluate spending policies, and execute verified orders against your store.
          </p>
        </div>

        <div className="demo-header-actions">
          <Button variant="secondary" size="sm" onClick={handleReset} icon={<Icons.RefreshCw size={14} />}>
            Reset State
          </Button>

          {onBackToReadiness && (
            <Button variant="outline" size="sm" onClick={onBackToReadiness}>
              ← Back to Readiness
            </Button>
          )}
        </div>
      </div>

      {/* Simulated AI Buyer Request Input */}
      <div className="ai-shopping-bar-card">
        <div className="shopping-bar-header">
          <div className="shopping-bar-title">
            <Icons.Sparkles size={16} />
            <span>AI Buyer Request Preview:</span>
          </div>
          <span className="shopping-bar-hint">Autonomous agent natural language intent</span>
        </div>
        <div className="shopping-bar-input-wrap">
          <input
            type="text"
            className="shopping-bar-input"
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            placeholder="e.g. Find me a 20000mAh power bank under ₹5,000"
          />
          <Button
            variant="primary"
            onClick={handleRunHappyPath}
            disabled={isExecuting}
            icon={isExecuting ? <Icons.Clock size={15} /> : <Icons.Sparkles size={15} />}
          >
            {isExecuting ? 'Agent Evaluating...' : 'Run Autonomous Purchase Flow'}
          </Button>
        </div>
      </div>

      {/* Product Catalog Picker */}
      <div className="product-selector-section">
        <div className="product-selector-header">
          <div className="selector-title-wrap">
            <span className="selector-title">Your Store Catalog ({demoData?.catalogCount || filteredProducts.length} Active SKUs)</span>
          </div>

          <div className="category-filter-tabs">
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                className={`cat-tab-btn ${categoryFilter === cat ? 'active' : ''}`}
                onClick={() => setCategoryFilter(cat)}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Scrollable Product Strip */}
        <div className="product-carousel-strip">
          {filteredProducts.map((prod) => {
            const isSelected = selectedProduct?.id === prod.id;
            return (
              <div
                key={prod.id}
                className={`product-select-card ${isSelected ? 'selected' : ''}`}
                onClick={() => handleSelectProduct(prod)}
              >
                <div className="prod-card-top">
                  <span className="prod-cat-pill">{prod.category}</span>
                  <span className="prod-stock-pill">In Stock ({prod.inventory})</span>
                </div>
                <div className="prod-card-name" title={prod.name}>
                  {prod.name}
                </div>
                <div className="prod-card-footer">
                  <div className="prod-price-text">₹{parseFloat(prod.price).toLocaleString('en-IN')}</div>
                  {isSelected && <span className="prod-selected-badge">✓ Selected</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Scenario Action Tabs */}
      <div className="scenario-action-bar">
        <div className="scenario-tab-buttons">
          <button
            type="button"
            className={`scenario-tab-btn ${activeTab === 'happy_path' ? 'active-happy' : ''}`}
            onClick={() => setActiveTab('happy_path')}
          >
            End-to-End Commerce Flow
          </button>
          <button
            type="button"
            className={`scenario-tab-btn ${activeTab === 'failure_demo' ? 'active-fail' : ''}`}
            onClick={() => setActiveTab('failure_demo')}
          >
            Price Surge Protection (+28.5%)
          </button>
          <button
            type="button"
            className={`scenario-tab-btn ${activeTab === 'payment_fail' ? 'active-fail' : ''}`}
            onClick={() => setActiveTab('payment_fail')}
          >
            Invalid Payment Signature Block
          </button>
          <button
            type="button"
            className={`scenario-tab-btn ${activeTab === 'reconcile' ? 'active-happy' : ''}`}
            onClick={() => setActiveTab('reconcile')}
          >
            Webhook Order Reconciliation
          </button>
        </div>

        {/* Delivery Option Selector */}
        <div className="delivery-option-selector">
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-subtle)' }}>Delivery:</span>
          <button
            type="button"
            className={`delivery-btn ${deliveryMethod === 'STANDARD' ? 'selected' : ''}`}
            onClick={() => setDeliveryMethod('STANDARD')}
          >
            Standard (₹0 • 2-3 Days)
          </button>
          <button
            type="button"
            className={`delivery-btn ${deliveryMethod === 'EXPRESS' ? 'selected' : ''}`}
            onClick={() => setDeliveryMethod('EXPRESS')}
          >
            Express (₹199 • Next Day)
          </button>
        </div>

        {/* Execute Button */}
        <div className="scenario-run-btn-wrap">
          {activeTab === 'happy_path' && (
            <Button
              variant="primary"
              size="md"
              onClick={handleRunHappyPath}
              disabled={isExecuting}
              icon={isExecuting ? <Icons.Clock size={15} /> : <Icons.Sparkles size={15} />}
            >
              {isExecuting ? 'Executing Flow...' : `Execute Purchase for ${selectedProduct?.name?.slice(0, 20)}...`}
            </Button>
          )}

          {activeTab === 'failure_demo' && (
            <Button
              variant="danger"
              size="md"
              onClick={handleRunFailureDemo}
              disabled={isExecuting}
              icon={<Icons.ShieldAlert size={15} />}
            >
              {isExecuting ? 'Simulating Surge...' : `Simulate Surge Block for ${selectedProduct?.name?.slice(0, 20)}...`}
            </Button>
          )}

          {activeTab === 'payment_fail' && (
            <Button
              variant="danger"
              size="md"
              onClick={handleRunPaymentFailure}
              disabled={isExecuting}
              icon={<Icons.AlertTriangle size={15} />}
            >
              Simulate Gateway Signature Failure
            </Button>
          )}

          {activeTab === 'reconcile' && (
            <Button
              variant="secondary"
              size="md"
              onClick={handleRunReconciliation}
              disabled={isExecuting}
              icon={<Icons.Clock size={15} />}
            >
              Simulate Webhook Timeout & Recovery
            </Button>
          )}
        </div>
      </div>

      {/* Execution Results & Pipeline Display */}
      {execResult && (
        <div className="demo-result-card">
          {/* Result Banner */}
          <div className={`result-status-banner ${execResult.success ? 'banner-success' : 'banner-blocked'}`}>
            <div className="banner-icon-wrap">
              {execResult.success ? <Icons.CheckCircle size={28} /> : <Icons.ShieldAlert size={28} />}
            </div>
            <div>
              <div className="banner-title">
                {execResult.status === 'PURCHASE_CONFIRMED'
                  ? 'AI Order Confirmed'
                  : execResult.scenario === 'PRICE_SURGE_AND_LIMIT_VIOLATION'
                  ? 'Price Surge Blocked by Policy Engine'
                  : execResult.scenario === 'PAYMENT_SIGNATURE_FAILURE'
                  ? 'Payment Rejected: Cryptographic Verification Failed'
                  : 'Reconciled: Payment Verified with Merchant Webhook'}
              </div>
              <div className="banner-sub">
                {execResult.success
                  ? 'Order sent to merchant. Invoice generated and queued for fulfillment.'
                  : execResult.reason}
              </div>
            </div>

            {execResult.invoice && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowInvoiceModal(true)}
                style={{ marginLeft: 'auto', background: '#ffffff', color: '#0f172a' }}
                icon={<Icons.FileText size={13} />}
              >
                View Official Invoice
              </Button>
            )}
          </div>

          {/* Itemized Order & Financial Breakdown */}
          {execResult.financialSummary && (
            <div className="order-summary-grid">
              <div className="summary-col">
                <div className="summary-lbl">Product & SKU</div>
                <div className="summary-val">{execResult.product?.name} (₹{execResult.financialSummary.subtotal?.toLocaleString('en-IN')})</div>
              </div>
              <div className="summary-col">
                <div className="summary-lbl">Delivery SLA</div>
                <div className="summary-val">{deliveryMethod === 'EXPRESS' ? 'Next-Day Express (₹199)' : 'Standard Delivery (₹0)'}</div>
              </div>
              <div className="summary-col">
                <div className="summary-lbl">Order Total</div>
                <div className="summary-val highlighted">
                  ₹{(execResult.financialSummary.totalDemoGMV ?? execResult.financialSummary.totalGMV ?? execResult.financialSummary.totalAmount ?? execResult.financialSummary.subtotal ?? 0).toLocaleString('en-IN')}
                </div>
              </div>
              <div className="summary-col">
                <div className="summary-lbl">Payment Status</div>
                <div className="summary-val status-verified">✓ Verified</div>
              </div>
              <div className="summary-col">
                <div className="summary-lbl">Order Status</div>
                <div className="summary-val" style={{ color: '#0369a1', fontWeight: 600 }}>Confirmed</div>
              </div>
              <div className="summary-col">
                <div className="summary-lbl">Fulfillment State</div>
                <div className="summary-val status-processing">● Awaiting Merchant Processing</div>
              </div>
            </div>
          )}

          {/* Explainable AI ("Why this product?") Section */}
          {execResult.interpretation && (
            <div style={{ marginTop: '1.25rem', border: '1px solid #e2e8f0', borderRadius: 'var(--radius-md)', padding: '1.25rem', backgroundColor: '#f8fafc' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Icons.Sparkles size={16} />
                  <span style={{ fontWeight: 700, fontSize: '0.9375rem', color: '#0f172a' }}>
                    Explainable AI Recommendation ("Why this product?")
                  </span>
                </div>
                <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#16a34a', backgroundColor: '#dcfce7', padding: '0.2rem 0.5rem', borderRadius: 4 }}>
                  100% Constraints Satisfied
                </span>
              </div>

              {/* Interpretation Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem', marginBottom: '0.75rem', backgroundColor: '#ffffff', padding: '0.75rem 1rem', borderRadius: 6, border: '1px solid #e2e8f0' }}>
                <div>
                  <div style={{ fontSize: '0.6875rem', color: 'var(--text-subtle)', textTransform: 'uppercase', fontWeight: 600 }}>Product Type</div>
                  <div style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#0f172a', textTransform: 'capitalize' }}>{execResult.interpretation.productType}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.6875rem', color: 'var(--text-subtle)', textTransform: 'uppercase', fontWeight: 600 }}>Target Brand</div>
                  <div style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#0f172a' }}>{execResult.interpretation.brand || 'Any Verified'}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.6875rem', color: 'var(--text-subtle)', textTransform: 'uppercase', fontWeight: 600 }}>Category</div>
                  <div style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#0f172a' }}>{execResult.interpretation.category}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.6875rem', color: 'var(--text-subtle)', textTransform: 'uppercase', fontWeight: 600 }}>Max Budget</div>
                  <div style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#0f172a' }}>₹{execResult.interpretation.maxBudget?.toLocaleString('en-IN')}</div>
                </div>
              </div>

              {/* Matched Constraints Checklist */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginBottom: '0.75rem' }}>
                {execResult.interpretation.matchedConstraints?.map((c, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8125rem', color: '#166534' }}>
                    <span style={{ color: '#16a34a', fontWeight: 800 }}>✓</span>
                    <span>{c}</span>
                  </div>
                ))}
              </div>

              {/* AI Decision Rationale */}
              <div style={{ fontSize: '0.8125rem', color: '#334155', fontStyle: 'italic', backgroundColor: '#f1f5f9', padding: '0.5rem 0.75rem', borderRadius: 4 }}>
                <strong>Decision Rationale:</strong> "{execResult.interpretation.decision}"
              </div>
            </div>
          )}

          {/* Candidate Evaluation Section */}
          {execResult.candidateEvaluation && (
            <div style={{ marginTop: '1rem', border: '1px solid #e2e8f0', borderRadius: 'var(--radius-md)', padding: '1rem 1.25rem', backgroundColor: '#ffffff' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <span style={{ fontWeight: 700, fontSize: '0.875rem', color: '#0f172a' }}>
                  Candidate Evaluation Matrix ({execResult.candidateEvaluation.totalEvaluated} Store SKUs Evaluated)
                </span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-subtle)' }}>
                  {execResult.candidateEvaluation.eligibleCandidates?.length || 1} Eligible • {execResult.candidateEvaluation.rejectedCandidates?.length || 0} Filtered Out
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.5rem' }}>
                {execResult.candidateEvaluation.rejectedCandidates?.slice(0, 3).map((rej, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', padding: '0.35rem 0.5rem', backgroundColor: '#f8fafc', borderRadius: 4, border: '1px solid #f1f5f9' }}>
                    <span style={{ color: '#475569', fontWeight: 500 }}>{rej.name} (₹{rej.price?.toLocaleString('en-IN')})</span>
                    <span style={{ color: '#dc2626', fontWeight: 600, backgroundColor: '#fee2e2', padding: '1px 6px', borderRadius: 3 }}>
                      {Array.isArray(rej.reasons) ? rej.reasons[0] : (rej.reason || 'Specification mismatch')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Technical Details Panel */}
          {execResult.technicalDetails && (
            <div style={{ marginTop: '1rem', border: '1px solid #e2e8f0', borderRadius: 'var(--radius-md)', padding: '1rem 1.25rem', backgroundColor: '#f8fafc' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <span style={{ fontWeight: 700, fontSize: '0.875rem', color: '#0f172a' }}>
                  Traceable Technical IDs & Verification Metadata
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.5rem', fontSize: '0.75rem', fontFamily: 'var(--font-mono)' }}>
                <div style={{ backgroundColor: '#ffffff', padding: '0.4rem 0.6rem', borderRadius: 4, border: '1px solid #e2e8f0' }}>
                  <div style={{ color: 'var(--text-subtle)', fontSize: '0.6875rem' }}>Intent ID</div>
                  <div style={{ color: '#0f172a', fontWeight: 600 }}>{execResult.technicalDetails.intentId?.slice(0, 16)}...</div>
                </div>
                <div style={{ backgroundColor: '#ffffff', padding: '0.4rem 0.6rem', borderRadius: 4, border: '1px solid #e2e8f0' }}>
                  <div style={{ color: 'var(--text-subtle)', fontSize: '0.6875rem' }}>SKU Reference</div>
                  <div style={{ color: '#0f172a', fontWeight: 600 }}>{execResult.technicalDetails.sku}</div>
                </div>
                <div style={{ backgroundColor: '#ffffff', padding: '0.4rem 0.6rem', borderRadius: 4, border: '1px solid #e2e8f0' }}>
                  <div style={{ color: 'var(--text-subtle)', fontSize: '0.6875rem' }}>Payment Order ID</div>
                  <div style={{ color: '#0f172a', fontWeight: 600 }}>{execResult.technicalDetails.paymentOrderId}</div>
                </div>
                <div style={{ backgroundColor: '#ffffff', padding: '0.4rem 0.6rem', borderRadius: 4, border: '1px solid #e2e8f0' }}>
                  <div style={{ color: 'var(--text-subtle)', fontSize: '0.6875rem' }}>Merchant Order ID</div>
                  <div style={{ color: '#0f172a', fontWeight: 600 }}>{execResult.technicalDetails.merchantOrderId}</div>
                </div>
              </div>
            </div>
          )}

          {/* 5-Group 14-Stage Execution Trace */}
          {execResult.trace && (
            <div className="trace-section" style={{ marginTop: '1.5rem' }}>
              <div className="trace-header">
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Icons.Receipt size={16} />
                    <span style={{ fontWeight: 700, fontSize: '0.9375rem', color: '#0f172a' }}>Transaction Audit Trail</span>
                  </div>
                  <p style={{ margin: '2px 0 0 24px', fontSize: '0.75rem', color: 'var(--text-subtle)' }}>
                    Every decision and transaction stage is recorded and traceable.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-toggle-details"
                  onClick={() => setShowTechnicalDetails(!showTechnicalDetails)}
                >
                  {showTechnicalDetails ? 'Hide JSON Details' : 'Show Technical Details'}
                </button>
              </div>

              {/* Logical Groups */}
              {[
                { id: 'AI_DECISION', label: '1. AI DECISION', color: '#2563eb', steps: execResult.trace.filter(s => s.group === 'AI_DECISION' || s.step <= 5) },
                { id: 'COMMERCE', label: '2. COMMERCE', color: '#0891b2', steps: execResult.trace.filter(s => s.group === 'COMMERCE' || (s.step >= 6 && s.step <= 8)) },
                { id: 'SAFETY', label: '3. SAFETY', color: '#7c3aed', steps: execResult.trace.filter(s => s.group === 'SAFETY' || (s.step >= 9 && s.step <= 10)) },
                { id: 'PAYMENT', label: '4. PAYMENT', color: '#059669', steps: execResult.trace.filter(s => s.group === 'PAYMENT' || (s.step >= 11 && s.step <= 12)) },
                { id: 'MERCHANT', label: '5. MERCHANT', color: '#d97706', steps: execResult.trace.filter(s => s.group === 'MERCHANT' || s.step >= 13) },
              ].filter(g => g.steps.length > 0).map((grp) => (
                <div key={grp.id} style={{ marginBottom: '1.25rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                    <span style={{ fontSize: '0.6875rem', fontWeight: 800, letterSpacing: '0.05em', color: grp.color, backgroundColor: `${grp.color}15`, padding: '0.2rem 0.6rem', borderRadius: 4, textTransform: 'uppercase' }}>
                      {grp.label}
                    </span>
                    <span style={{ height: 1, flex: 1, backgroundColor: '#e2e8f0' }} />
                  </div>

                  <div className="trace-steps-list">
                    {grp.steps.map((step, idx) => (
                      <div key={idx} className="trace-step-item">
                        <div className="step-num-pill" style={{ backgroundColor: `${grp.color}20`, color: grp.color }}>
                          {step.step}
                        </div>
                        <div className="step-content">
                          <div className="step-title-row">
                            <span className="step-title">{step.title}</span>
                            <span className="step-actor-badge">{step.actor}</span>
                            <span className="step-status-pill">{step.status}</span>
                            <span className="step-time-text">{step.timestamp?.slice(11, 23)}</span>
                          </div>
                          {showTechnicalDetails && (
                            <pre className="step-json-block">{JSON.stringify(step.data, null, 2)}</pre>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Invoice Viewer Modal */}
      {showInvoiceModal && execResult?.invoice && (
        <Dialog
          isOpen={showInvoiceModal}
          onClose={() => setShowInvoiceModal(false)}
          title={`Official Invoice: ${execResult.invoice.invoice_number}`}
        >
          <div className="invoice-modal-content">
            <div className="invoice-modal-header">
              <div>
                <div style={{ fontWeight: 800, fontSize: '1.25rem' }}>AgentPay Autonomous Commerce</div>
                <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Official Order Tax Invoice</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 700 }}>Invoice #: {execResult.invoice.invoice_number}</div>
                <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Date: {new Date().toLocaleDateString()}</div>
              </div>
            </div>

            <div className="invoice-billing-row">
              <div>
                <div className="inv-sec-title">Billed To:</div>
                <div>{execResult.invoice.billing_address?.name || 'AgentPay Buyer'}</div>
                <div style={{ fontSize: '0.8125rem', color: '#64748b' }}>{execResult.invoice.billing_address?.address_line1}</div>
                <div style={{ fontSize: '0.8125rem', color: '#64748b' }}>{execResult.invoice.billing_address?.city}, {execResult.invoice.billing_address?.state} {execResult.invoice.billing_address?.pincode}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="inv-sec-title">Payment Reference:</div>
                <div style={{ fontFamily: 'monospace', fontSize: '0.8125rem' }}>{execResult.invoice.payment_reference}</div>
                <div style={{ fontSize: '0.8125rem', color: '#059669', fontWeight: 700 }}>Status: PAID (Verified)</div>
              </div>
            </div>

            <table className="invoice-table">
              <thead>
                <tr>
                  <th>Item Description</th>
                  <th>Qty</th>
                  <th>Unit Price</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{execResult.product?.name}</td>
                  <td>1</td>
                  <td>₹{parseFloat(execResult.invoice.subtotal).toLocaleString('en-IN')}</td>
                  <td>₹{parseFloat(execResult.invoice.subtotal).toLocaleString('en-IN')}</td>
                </tr>
                <tr>
                  <td colSpan={3} style={{ textAlign: 'right', fontWeight: 600 }}>Delivery Fee ({deliveryMethod}):</td>
                  <td>₹{parseFloat(execResult.invoice.delivery_fee || 0).toLocaleString('en-IN')}</td>
                </tr>
                <tr>
                  <td colSpan={3} style={{ textAlign: 'right', fontWeight: 700 }}>Total Order Amount:</td>
                  <td style={{ fontWeight: 800, color: '#2563eb' }}>₹{parseFloat(execResult.invoice.total_amount).toLocaleString('en-IN')}</td>
                </tr>
              </tbody>
            </table>

            <div style={{ textAlign: 'right', marginTop: '1.25rem' }}>
              <Button variant="primary" size="sm" onClick={() => window.print()} icon={<Icons.FileText size={13} />}>
                Print / Save PDF
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
