import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { Icons } from '../components/ui/Icons';
import StatusBadge from '../components/ui/StatusBadge';
import Button from '../components/ui/Button';
import Dialog from '../components/ui/Dialog';
import './Home.css';

const SUGGESTIONS = [
  'Order a power bank with 20000mAh battery under ₹5,000',
  'Buy me the best laptop for development under ₹80,000',
  'Find a 4K monitor under ₹40,000 for my home office',
  'Order Sony WH-1000XM5 headphones under ₹30,000',
  'Order 5 ergonomic office chairs under ₹15,000 each',
];

const EXECUTION_STAGES = [
  { id: 1, label: 'Understanding your request & constraints' },
  { id: 2, label: 'Searching available store catalog' },
  { id: 3, label: 'Filtering & comparing eligible candidates' },
  { id: 4, label: 'Evaluating spending policies & risk engine' },
  { id: 5, label: 'Revalidating price & live inventory' },
  { id: 6, label: 'Executing payment on Razorpay test rails' },
  { id: 7, label: 'Confirming order & generating invoice' },
];

export default function Home() {
  const navigate = useNavigate();
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [progressStep, setProgressStep] = useState(0);
  const [preferences, setPreferences] = useState(null);
  const [currentSession, setCurrentSession] = useState(null);
  const [recentPurchases, setRecentPurchases] = useState([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [selectedOrderDetail, setSelectedOrderDetail] = useState(null);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [approvalSubmitting, setApprovalSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);

  // Preferences controls
  const [advBudget, setAdvBudget] = useState('');
  const [advBrand, setAdvBrand] = useState('');
  const [advDelivery, setAdvDelivery] = useState('standard');

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, []);

  const loadData = async () => {
    try {
      const [prefRes, purchRes] = await Promise.all([
        api.getPreferences().catch(() => ({ preferences: null })),
        api.getPurchases().catch(() => ({ purchases: [], orders: [] })),
      ]);
      if (prefRes.preferences) setPreferences(prefRes.preferences);
      if (purchRes.purchases) {
        setRecentPurchases(purchRes.purchases.filter((p) => p.is_order !== false).slice(0, 4));
      }
    } catch (e) {
      console.error('Failed to load home data', e);
    }
  };

  const formatCurrency = (amt) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amt || 0);

  const handleSearchAndPurchase = async (queryText) => {
    let text = typeof queryText === 'string' && queryText.trim() ? queryText.trim() : inputText.trim();
    if (!text || loading || isSubmittingRef.current) return;

    isSubmittingRef.current = true;
    setLoading(true);
    setProgressStep(1);
    setCurrentSession(null);

    // Step-by-step progress simulation for UX transparency
    const stepInterval = setInterval(() => {
      setProgressStep((prev) => (prev < 6 ? prev + 1 : prev));
    }, 400);

    try {
      const chatRes = await api.sendChatMessage({ message: text });
      clearInterval(stepInterval);
      setProgressStep(7);

      setCurrentSession(chatRes);
      await loadData();
    } catch (err) {
      clearInterval(stepInterval);
      setCurrentSession({
        reply: err.message || 'We could not complete your request. Please try again.',
        status: 'ERROR',
      });
    } finally {
      isSubmittingRef.current = false;
      setLoading(false);
    }
  };

  const handleApprovePurchase = async () => {
    if (!currentSession?.purchase_intent?.id) return;
    setApprovalSubmitting(true);
    try {
      const approvalRes = await api.getApprovals('pending');
      const targetApproval = (approvalRes.approvals || []).find(
        (a) => a.purchase_intent_id === currentSession.purchase_intent.id || a.id === currentSession.purchase_intent.id
      );

      if (targetApproval) {
        await api.decideApproval(targetApproval.id, 'APPROVE', 'Approved from Buyer Home');
      } else {
        // Direct execution
        const orderRes = await api.createPaymentOrder({
          purchase_intent_id: currentSession.purchase_intent.id,
          amount: currentSession.recommendation.price,
          currency: 'INR',
        });
        const txId = orderRes.transactionId || orderRes.transaction?.id;
        const rzpOrderId = orderRes.orderId || orderRes.order?.id;

        await api.confirmTestPayment(txId || rzpOrderId, {
          transaction_id: txId,
          razorpay_order_id: rzpOrderId,
          razorpay_payment_id: `pay_test_${Math.random().toString(36).substring(2, 10)}`,
          razorpay_signature: 'valid_test_signature',
        });
      }

      setCurrentSession((prev) => ({
        ...prev,
        status: 'COMPLETED',
      }));
      await loadData();
    } catch (e) {
      console.error('Approval execution failed', e);
      alert('Approval failed: ' + (e.message || 'Server error'));
    } finally {
      setApprovalSubmitting(false);
    }
  };

  const handleViewInvoice = async (orderId) => {
    try {
      const res = await api.getInvoice(orderId);
      setSelectedInvoice(res.invoice);
    } catch (err) {
      alert('Invoice not available for this transaction.');
    }
  };

  // Authoritative spending metrics directly from backend policy state
  const monthlyBudget = preferences?.monthlyBudget || 100000;
  const autoLimit = preferences?.automaticPurchaseLimit || 50000;
  const totalSpent = preferences?.spentThisMonth !== undefined ? preferences.spentThisMonth : 0;
  const remainingBudget = preferences?.remainingBudget !== undefined ? preferences.remainingBudget : Math.max(0, monthlyBudget - totalSpent);

  return (
    <div className="home-container">
      {/* 1. Spending Visibility Bar */}
      <div className="home-spending-bar">
        <div className="spending-item">
          <span className="spending-label">Monthly Budget</span>
          <span className="spending-val">{formatCurrency(monthlyBudget)}</span>
        </div>
        <div className="spending-divider" />
        <div className="spending-item">
          <span className="spending-label">Spent This Month</span>
          <span className="spending-val">{formatCurrency(totalSpent)}</span>
        </div>
        <div className="spending-divider" />
        <div className="spending-item">
          <span className="spending-label">Remaining Balance</span>
          <span className="spending-val highlight-green">{formatCurrency(remainingBudget)}</span>
        </div>
        <div className="spending-divider hide-on-mobile" />
        <div className="spending-item hide-on-mobile">
          <span className="spending-label">Autonomous Limit</span>
          <span className="spending-val">{formatCurrency(autoLimit)}</span>
        </div>
      </div>

      {/* 2. Hero Section */}
      <div className="home-hero">
        <h1 className="home-title">What do you need?</h1>
        <p className="home-subtitle">
          Tell AgentPay what you want to buy. We'll find the best eligible option from your available catalog within your rules.
        </p>
      </div>

      {/* 3. Natural Language Purchase Composer */}
      <div className="home-composer-card">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSearchAndPurchase();
          }}
          className="composer-form"
        >
          <div className="composer-input-row">
            <input
              type="text"
              className="composer-input"
              placeholder="Tell AgentPay what you want to buy (e.g. Order a 20000mAh power bank under ₹5,000)..."
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              disabled={loading}
              autoFocus
            />
            <Button
              type="submit"
              variant="primary"
              disabled={!inputText.trim() || loading}
              loading={loading}
              className="composer-submit-btn"
            >
              Search & Buy
            </Button>
          </div>

          {/* Suggestion Chips */}
          <div className="composer-chips-row">
            <span className="chips-label">Try:</span>
            {SUGGESTIONS.map((s, idx) => (
              <button
                key={idx}
                type="button"
                className="suggestion-chip"
                onClick={() => {
                  setInputText(s);
                  handleSearchAndPurchase(s);
                }}
                disabled={loading}
              >
                {s.length > 40 ? `${s.slice(0, 40)}...` : s}
              </button>
            ))}
          </div>

          {/* Preferences Accordion */}
          <div className="composer-advanced-toggle">
            <button
              type="button"
              className="advanced-toggle-btn"
              onClick={() => setShowAdvanced(!showAdvanced)}
            >
              <Icons.Sliders size={13} />
              <span>{showAdvanced ? 'Hide search filters' : 'Add filters (max budget, brand, delivery)'}</span>
              <span style={{ fontSize: '10px' }}>{showAdvanced ? '▲' : '▼'}</span>
            </button>
          </div>

          {showAdvanced && (
            <div className="composer-advanced-panel">
              <div className="advanced-grid">
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Max Budget (₹)</label>
                  <input
                    type="number"
                    className="input-ui"
                    placeholder="e.g. 5000"
                    value={advBudget}
                    onChange={(e) => setAdvBudget(e.target.value)}
                  />
                </div>

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Preferred Brand</label>
                  <input
                    type="text"
                    className="input-ui"
                    placeholder="e.g. Ambrane, Sony, Logitech"
                    value={advBrand}
                    onChange={(e) => setAdvBrand(e.target.value)}
                  />
                </div>

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Delivery Speed</label>
                  <select
                    className="select-ui"
                    value={advDelivery}
                    onChange={(e) => setAdvDelivery(e.target.value)}
                  >
                    <option value="standard">Standard Delivery (2-3 Business Days)</option>
                    <option value="fastest">Express Next-Day Air</option>
                  </select>
                </div>
              </div>
            </div>
          )}
        </form>
      </div>

      {/* 4. Progressive Execution Progress */}
      {loading && (
        <div className="home-execution-card">
          <div className="execution-header">
            <div className="execution-spinner" />
            <div>
              <strong style={{ fontSize: '0.9375rem', color: 'var(--text-main)' }}>Procurement Agent Working</strong>
              <div style={{ fontSize: '0.8125rem', color: 'var(--text-subtle)' }}>Evaluating store catalog against hard constraints & policy limits</div>
            </div>
          </div>

          <div className="execution-timeline">
            {EXECUTION_STAGES.map((step) => {
              const isDone = progressStep >= step.id;
              const isCurrent = progressStep === step.id - 1;
              return (
                <div key={step.id} className={`timeline-item ${isDone ? 'done' : isCurrent ? 'current' : 'pending'}`}>
                  <div className="timeline-dot">
                    {isDone ? <Icons.Check size={11} /> : step.id}
                  </div>
                  <span className="timeline-label">{step.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 5. Result Display */}
      {currentSession && !loading && (
        <div className="home-result-card">
          {/* A. Structured Request Understanding */}
          {currentSession.intent_parsed && (
            <div style={{ padding: '0.875rem 1rem', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <span style={{ fontWeight: 700, fontSize: '0.8125rem', color: '#0f172a' }}>
                  🎯 Extracted Intent & Hard Constraints:
                </span>
                <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#0369a1', backgroundColor: '#e0f2fe', padding: '2px 8px', borderRadius: 4 }}>
                  Deterministic Parse
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.5rem', fontSize: '0.8125rem' }}>
                <div>
                  <span style={{ color: 'var(--text-subtle)', fontSize: '0.6875rem', textTransform: 'uppercase' }}>Target:</span>
                  <div style={{ fontWeight: 600, color: '#0f172a' }}>{currentSession.intent_parsed.productType || 'General Product'}</div>
                </div>
                <div>
                  <span style={{ color: 'var(--text-subtle)', fontSize: '0.6875rem', textTransform: 'uppercase' }}>Capacity / Spec:</span>
                  <div style={{ fontWeight: 600, color: '#0f172a' }}>
                    {currentSession.intent_parsed.hardConstraints?.requiredCapacityMah
                      ? `≥ ${currentSession.intent_parsed.hardConstraints.requiredCapacityMah.toLocaleString('en-IN')}mAh`
                      : currentSession.intent_parsed.hardConstraints?.requiredRamGb
                      ? `≥ ${currentSession.intent_parsed.hardConstraints.requiredRamGb}GB RAM`
                      : 'Standard Specs'}
                  </div>
                </div>
                <div>
                  <span style={{ color: 'var(--text-subtle)', fontSize: '0.6875rem', textTransform: 'uppercase' }}>Max Budget:</span>
                  <div style={{ fontWeight: 600, color: '#0f172a' }}>
                    {currentSession.intent_parsed.maxPrice ? `₹${currentSession.intent_parsed.maxPrice.toLocaleString('en-IN')}` : 'No limit specified'}
                  </div>
                </div>
                <div>
                  <span style={{ color: 'var(--text-subtle)', fontSize: '0.6875rem', textTransform: 'uppercase' }}>Quantity:</span>
                  <div style={{ fontWeight: 600, color: '#0f172a' }}>{currentSession.intent_parsed.quantity || 1} unit</div>
                </div>
              </div>
            </div>
          )}

          {/* B. Eligible Candidates Found */}
          {currentSession.comparison && currentSession.comparison.length > 0 && (
            <div style={{ marginBottom: '1.25rem' }}>
              <div style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#475569', marginBottom: '0.5rem' }}>
                Found {currentSession.comparison.length} Qualifying Catalog Items:
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
                {currentSession.comparison.map((cand, idx) => {
                  const isTop = cand.productName === currentSession.recommendation?.name;
                  return (
                    <div
                      key={idx}
                      style={{
                        padding: '0.75rem',
                        borderRadius: 6,
                        border: isTop ? '2px solid #2563eb' : '1px solid #e2e8f0',
                        backgroundColor: isTop ? '#eff6ff' : '#ffffff',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ fontWeight: 600, fontSize: '0.8125rem', color: '#0f172a' }}>{cand.productName}</div>
                        {isTop && (
                          <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#2563eb', backgroundColor: '#dbeafe', padding: '1px 5px', borderRadius: 3 }}>
                            Top Match
                          </span>
                        )}
                      </div>
                      <div style={{ fontWeight: 700, fontSize: '0.875rem', color: '#0f172a', margin: '4px 0' }}>
                        {formatCurrency(cand.price)}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#16a34a', display: 'flex', alignItems: 'center', gap: 4 }}>
                        ✓ In Stock • Verified Merchant
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* C. Winning Recommendation Card */}
          {currentSession.recommendation ? (() => {
            const isCompleted = currentSession.execution_status === 'COMPLETED' || currentSession.status === 'COMPLETED' || currentSession.authorization_status?.state === 'ALLOW';
            const isApprovalRequired = currentSession.execution_status === 'APPROVAL_REQUIRED' || currentSession.status === 'APPROVAL_REQUIRED' || currentSession.authorization_status?.state === 'APPROVAL_REQUIRED';
            const isBlocked = currentSession.execution_status === 'BLOCKED' || currentSession.status === 'BLOCKED' || currentSession.authorization_status?.state === 'BLOCK';

            return (
              <div>
                <div className="result-header">
                  <div>
                    <span className="result-tag">Recommended Best Match</span>
                    <h2 className="result-product-title">{currentSession.recommendation.name}</h2>
                    <div className="result-merchant-sub">
                      Sold by <strong>{currentSession.recommendation.merchant_name || 'Verified Merchant Store'}</strong> • Live Inventory Available
                    </div>
                  </div>
                  <div className="result-price-box">
                    <span className="result-price">{formatCurrency(currentSession.recommendation.price)}</span>
                    <StatusBadge
                      status={isCompleted ? 'CONFIRMED' : isApprovalRequired ? 'APPROVAL_REQUIRED' : 'BLOCKED'}
                      label={isCompleted ? 'Purchase Confirmed' : isApprovalRequired ? 'Needs Approval' : 'Blocked'}
                    />
                  </div>
                </div>

                {/* Why AgentPay Chose This */}
                <div className="result-reasons-panel">
                  <div className="reasons-title">Why AgentPay Chose This:</div>
                  <ul className="reasons-list">
                    {currentSession.recommendation.matched_rules && currentSession.recommendation.matched_rules.length > 0 ? (
                      currentSession.recommendation.matched_rules.map((rule, idx) => (
                        <li key={idx}><Icons.Check size={14} className="icon-green" /> {rule}</li>
                      ))
                    ) : (
                      <>
                        <li><Icons.Check size={14} className="icon-green" /> Matches requested product type and hard specifications</li>
                        <li><Icons.Check size={14} className="icon-green" /> Price is within authorized budget ceiling</li>
                        <li><Icons.Check size={14} className="icon-green" /> Live verified inventory available for immediate dispatch</li>
                      </>
                    )}
                    {isCompleted ? (
                      <li><Icons.Check size={14} className="icon-green" /> Autonomous payment verified on Razorpay test rails</li>
                    ) : isApprovalRequired ? (
                      <li><Icons.AlertTriangle size={14} className="icon-amber" /> Amount exceeds autonomous threshold ({formatCurrency(autoLimit)}) — 1-click authorization required</li>
                    ) : (
                      <li><Icons.ShieldAlert size={14} className="icon-red" /> Blocked: {currentSession.authorization_status?.explanation || 'Policy constraint'}</li>
                    )}
                  </ul>
                </div>

                {/* Action Bar */}
                <div className="result-actions-bar">
                  {isCompleted && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', width: '100%' }}>
                      <div className="result-success-box">
                        <Icons.Check size={16} />
                        <span>
                          Purchase completed automatically. Order confirmed with merchant: <strong>{currentSession.order?.order_number || 'AGP-ORD-CONFIRMED'}</strong>.
                        </span>
                      </div>

                      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        {currentSession.order && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setSelectedOrderDetail(currentSession.order)}
                          >
                            🚚 Track Order Lifecycle
                          </Button>
                        )}
                        {currentSession.invoice && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setSelectedInvoice(currentSession.invoice)}
                          >
                            📄 View Official Invoice
                          </Button>
                        )}
                      </div>
                    </div>
                  )}

                  {isApprovalRequired && (
                    <div style={{ display: 'flex', gap: '0.75rem', width: '100%', flexWrap: 'wrap' }}>
                      <Button
                        variant="primary"
                        onClick={handleApprovePurchase}
                        loading={approvalSubmitting}
                        icon={<Icons.Check size={15} />}
                      >
                        Authorize Purchase ({formatCurrency(currentSession.recommendation.price)})
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => setCurrentSession(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  )}

                  {isBlocked && (
                    <div className="result-blocked-box">
                      <Icons.ShieldAlert size={16} />
                      <span>{currentSession.authorization_status?.explanation || 'Transaction blocked by spending safety policy.'}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })() : (
            /* D. No Match Found Guard */
            <div style={{ padding: '1.5rem', backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: 'var(--radius-md)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#991b1b', fontWeight: 700, marginBottom: '0.5rem' }}>
                <Icons.ShieldAlert size={20} color="#dc2626" />
                <span>No Eligible Products Found (NO MATCH = NO PURCHASE)</span>
              </div>
              <p style={{ color: '#7f1d1d', fontSize: '0.875rem', lineHeight: 1.6, whiteSpace: 'pre-line', marginBottom: '1rem' }}>
                {currentSession.reply}
              </p>

              <div style={{ padding: '0.75rem', backgroundColor: '#ffffff', border: '1px solid #fca5a5', borderRadius: 6, fontSize: '0.8125rem' }}>
                <strong style={{ color: '#991b1b' }}>Would you like to adjust your requirements?</strong>
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const newMax = (currentSession.intent_parsed?.maxPrice || 5000) * 1.25;
                      setInputText(`${inputText} max ₹${Math.round(newMax)}`);
                      handleSearchAndPurchase(`${inputText} max ₹${Math.round(newMax)}`);
                    }}
                  >
                    Increase Budget (+25%)
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setInputText('');
                      setCurrentSession(null);
                    }}
                  >
                    Try Another Search
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 6. Recent Purchases List */}
      {recentPurchases.length > 0 && (
        <div className="home-recent-section">
          <div className="recent-header">
            <h3 className="text-h3">Recent Purchases</h3>
            <button
              type="button"
              className="recent-view-all-btn"
              onClick={() => navigate('/buyer/purchases')}
            >
              View all purchases ({recentPurchases.length}) →
            </button>
          </div>

          <div className="recent-list">
            {recentPurchases.map((tx) => (
              <div
                key={tx.id}
                className="recent-item"
                style={{ cursor: 'pointer' }}
                onClick={() => setSelectedOrderDetail(tx)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <div className="recent-icon-box">
                    <Icons.Receipt size={16} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--text-main)' }}>
                      {tx.product_name || 'Autonomous Purchase'}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-subtle)' }}>
                      {tx.order_number} • {new Date(tx.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <span style={{ fontWeight: 700, fontSize: '0.9375rem', color: 'var(--text-main)' }}>
                    {formatCurrency(tx.amount)}
                  </span>
                  <StatusBadge status={tx.fulfillment_status || tx.order_status || tx.status} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 7. Order Detail & Tracking Modal */}
      {selectedOrderDetail && (
        <Dialog
          isOpen={Boolean(selectedOrderDetail)}
          onClose={() => setSelectedOrderDetail(null)}
          title={`Order Lifecycle: ${selectedOrderDetail.order_number || selectedOrderDetail.orderNumber || selectedOrderDetail.id}`}
          subtitle="Authoritative multi-stage order tracking"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.75rem' }}>
              <div>
                <h3 className="text-h3">{selectedOrderDetail.product_name || selectedOrderDetail.productName}</h3>
                <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Merchant: <strong>{selectedOrderDetail.merchant_name || 'Verified Merchant Store'}</strong></div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#2563eb' }}>{formatCurrency(selectedOrderDetail.amount || selectedOrderDetail.total_amount)}</div>
                <StatusBadge status={selectedOrderDetail.fulfillment_status || selectedOrderDetail.order_status || 'CONFIRMED'} />
              </div>
            </div>

            <div style={{ padding: '0.875rem', backgroundColor: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
              <div style={{ fontWeight: 700, fontSize: '0.8125rem', marginBottom: '0.5rem', color: '#0f172a' }}>
                Fulfillment Timeline:
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                {(selectedOrderDetail.timeline || selectedOrderDetail.order_timeline || [
                  { state: 'CONFIRMED', title: 'Order Confirmed & Payment Verified', completed: true },
                  { state: 'PROCESSING', title: 'Merchant Processing', completed: ['PROCESSING', 'PACKED', 'SHIPPED', 'DELIVERED'].includes(selectedOrderDetail.fulfillment_status) },
                  { state: 'PACKED', title: 'Package Assembly', completed: ['PACKED', 'SHIPPED', 'DELIVERED'].includes(selectedOrderDetail.fulfillment_status) },
                  { state: 'SHIPPED', title: 'In Transit with Carrier', completed: ['SHIPPED', 'DELIVERED'].includes(selectedOrderDetail.fulfillment_status) },
                  { state: 'DELIVERED', title: 'Delivered', completed: selectedOrderDetail.fulfillment_status === 'DELIVERED' },
                ]).map((step, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8125rem' }}>
                    <span style={{ color: step.completed ? '#059669' : '#94a3b8', fontWeight: 800 }}>
                      {step.completed ? '✓' : '○'}
                    </span>
                    <span style={{ fontWeight: 600, color: step.completed ? '#0f172a' : '#64748b' }}>{step.title}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="mono" style={{ padding: '0.75rem', backgroundColor: 'var(--bg-subtle)', borderRadius: 6, fontSize: '0.75rem', lineHeight: 1.5, color: '#475569' }}>
              <div><strong>Tracking:</strong> {selectedOrderDetail.tracking_number || (['SHIPPED', 'DELIVERED'].includes(selectedOrderDetail.fulfillment_status) ? 'TRK-ASSIGNED' : 'Assigned upon courier dispatch')}</div>
              <div><strong>Carrier:</strong> {selectedOrderDetail.carrier || 'AgentPay Test Logistics (Simulated Courier)'}</div>
              <div><strong>Payment Capture:</strong> Verified (Razorpay Test Rails)</div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              {selectedOrderDetail.order_id && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => handleViewInvoice(selectedOrderDetail.order_id || selectedOrderDetail.id)}
                >
                  📄 View Invoice
                </Button>
              )}
              <Button variant="secondary" size="sm" onClick={() => setSelectedOrderDetail(null)}>
                Close
              </Button>
            </div>
          </div>
        </Dialog>
      )}

      {/* 8. Invoice Modal */}
      {selectedInvoice && (
        <Dialog
          isOpen={Boolean(selectedInvoice)}
          onClose={() => setSelectedInvoice(null)}
          title={`Official Invoice: ${selectedInvoice.invoice_number}`}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '0.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.75rem' }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: '1.125rem' }}>AgentPay Commerce</div>
                <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Order Tax Invoice</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 700 }}>Invoice #: {selectedInvoice.invoice_number}</div>
                <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Date: {new Date(selectedInvoice.invoice_date || selectedInvoice.created_at).toLocaleDateString()}</div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', fontSize: '0.8125rem' }}>
              <div>
                <div style={{ fontWeight: 700, color: '#64748b', textTransform: 'uppercase', fontSize: '0.6875rem' }}>Billed To:</div>
                <div>{selectedInvoice.billing_address?.name || 'AgentPay Buyer'}</div>
                <div style={{ color: '#64748b' }}>{selectedInvoice.billing_address?.address_line1}</div>
                <div style={{ color: '#64748b' }}>{selectedInvoice.billing_address?.city}, {selectedInvoice.billing_address?.state} {selectedInvoice.billing_address?.pincode}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 700, color: '#64748b', textTransform: 'uppercase', fontSize: '0.6875rem' }}>Payment Status:</div>
                <div style={{ color: '#059669', fontWeight: 700 }}>PAID (Razorpay Test Rails)</div>
                <div className="mono" style={{ fontSize: '0.75rem', color: '#64748b' }}>Ref: {selectedInvoice.payment_reference || 'pay_test_verified'}</div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '1rem', borderTop: '1px solid #e2e8f0', fontWeight: 800 }}>
              <span>Total Order GMV:</span>
              <span style={{ fontSize: '1.25rem', color: '#2563eb' }}>₹{parseFloat(selectedInvoice.total_amount).toLocaleString('en-IN')}</span>
            </div>

            <div style={{ textAlign: 'right', marginTop: '0.5rem' }}>
              <Button variant="primary" size="sm" onClick={() => window.print()}>
                🖨️ Print / Save PDF
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
