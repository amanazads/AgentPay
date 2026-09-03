import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { Icons } from '../components/ui/Icons';
import StatusBadge from '../components/ui/StatusBadge';
import Button from '../components/ui/Button';
import './Settings.css';

export default function Settings({ isMerchant = false }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [preferences, setPreferences] = useState(null);
  const [paymentMethods, setPaymentMethods] = useState([]);
  const [envInfo, setEnvInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showHowItWorks, setShowHowItWorks] = useState(false);

  const isMerchantUser = isMerchant || (user?.role || '').toUpperCase() === 'MERCHANT';

  useEffect(() => {
    fetchSettingsData();
  }, []);

  const fetchSettingsData = async () => {
    try {
      const [prefRes, pmRes, envRes] = await Promise.all([
        api.getPreferences().catch(() => ({ preferences: null })),
        api.getPaymentMethods().catch(() => ({ paymentMethods: [] })),
        api.getEnvironment().catch(() => null),
      ]);
      if (prefRes.preferences) setPreferences(prefRes.preferences);
      setPaymentMethods(pmRes.paymentMethods || []);
      setEnvInfo(envRes);
    } catch (e) {
      console.error('Failed to load settings data', e);
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = () => {
    logout();
    navigate('/login');
  };

  const formatCurrency = (val) => {
    const num = parseFloat(val) || 0;
    return `₹${num.toLocaleString('en-IN')}`;
  };

  const activeMandate = paymentMethods.find((pm) => pm.isActive && !pm.isRevoked);

  return (
    <div className="settings-container">
      {/* Header */}
      <div className="settings-header">
        <div>
          <h1 className="text-h1">Account & System Settings</h1>
          <p className="text-body" style={{ marginTop: 2 }}>
            Manage your account identity, security posture, and autonomous purchasing controls.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <StatusBadge status="ACTIVE" label={envInfo?.activeKeyType === 'RAZORPAY_LIVE' ? 'Live Rails' : 'Active'} />
        </div>
      </div>

      {/* 1. Account & Authenticated Identity */}
      <div className="card-panel">
        <div className="card-panel-header">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Icons.Shield size={18} />
              <h2 className="card-panel-title">Authenticated Identity</h2>
            </div>
            <p className="card-panel-sub">Your verified account identity and active session.</p>
          </div>
          <StatusBadge status="ACTIVE" label="Session Active" />
        </div>

        <div className="card-panel-body">
          <div className="settings-grid">
            <div className="settings-field">
              <div className="settings-label">User Name</div>
              <div className="settings-value-strong">{user?.name || 'Authenticated Buyer'}</div>
            </div>

            <div className="settings-field">
              <div className="settings-label">Email Address</div>
              <div className="settings-value">{user?.email || 'buyer@agentpay.ai'}</div>
            </div>

            <div className="settings-field">
              <div className="settings-label">Role & Account Type</div>
              <div className="settings-value">
                {isMerchantUser ? 'Verified Merchant' : 'Individual Buyer'} ({user?.role || 'BUYER'})
              </div>
            </div>

            <div className="settings-field">
              <div className="settings-label">Authentication Status</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#16a34a', fontWeight: 600, fontSize: '0.875rem' }}>
                <Icons.Check size={16} />
                <span>ACTIVE (Tokenized Session)</span>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '1rem', borderTop: '1px solid var(--border-subtle)', flexWrap: 'wrap', gap: '0.75rem' }}>
            <span style={{ fontSize: '0.78125rem', color: 'var(--text-subtle)' }}>
              Session protected by JSON Web Token with HMAC verification.
            </span>
            <Button variant="danger" size="sm" onClick={handleSignOut} icon={<Icons.LogOut size={14} />}>
              Sign Out
            </Button>
          </div>
        </div>
      </div>

      {/* 2. Purchasing Policy Status (Summary) */}
      {!isMerchantUser && (
        <div className="card-panel">
          <div className="card-panel-header">
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Icons.Sliders size={18} />
                <h2 className="card-panel-title">Purchasing Policy Status</h2>
              </div>
              <p className="card-panel-sub">Authoritative spending rules enforced server-side for all autonomous transactions.</p>
            </div>
            <StatusBadge status="ACTIVE" label="Enforcing Limits" />
          </div>

          <div className="card-panel-body">
            <div className="settings-grid">
              <div className="settings-field">
                <div className="settings-label">Monthly Spending Budget</div>
                <div className="settings-value-strong">{formatCurrency(preferences?.monthlyBudget || 1000000)}</div>
                <div className="settings-hint">Hard monthly spend ceiling</div>
              </div>

              <div className="settings-field">
                <div className="settings-label">Autonomous Single-Purchase Limit</div>
                <div className="settings-value-strong">{formatCurrency(preferences?.automaticPurchaseLimit || preferences?.autoPurchaseLimit || 200000)}</div>
                <div className="settings-hint">Purchases above this require approval</div>
              </div>

              <div className="settings-field">
                <div className="settings-label">Permitted Categories</div>
                <div className="settings-value-strong">
                  {preferences?.categories?.length ? `${preferences.categories.length} Categories Permitted` : 'All Standard Categories'}
                </div>
                <div className="settings-hint">
                  {preferences?.categories?.slice(0, 3).join(', ') || 'Electronics, Peripherals'}
                  {preferences?.categories?.length > 3 ? ` +${preferences.categories.length - 3} more` : ''}
                </div>
              </div>

              <div className="settings-field">
                <div className="settings-label">Procurement Behavior</div>
                <div className="settings-value-strong">
                  {preferences?.purchaseBehavior === 'always_require_review'
                    ? 'Human Review Required'
                    : 'Autonomous (Within Policy)'}
                </div>
                <div className="settings-hint">Deterministic evaluation</div>
              </div>
            </div>

            <div style={{ paddingTop: '1rem', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'flex-end' }}>
              <Link to="/buyer/preferences" className="settings-action-link">
                Manage purchasing rules <Icons.ArrowRight size={14} />
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* 3. Payment Authorization Status */}
      {!isMerchantUser && (
        <div className="card-panel">
          <div className="card-panel-header">
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Icons.CreditCard size={18} />
                <h2 className="card-panel-title">Payment Authorization Status</h2>
              </div>
              <p className="card-panel-sub">Bounded payment mandate configuration linked to your account.</p>
            </div>
            <StatusBadge
              status={activeMandate ? 'ACTIVE' : 'INACTIVE'}
              label={activeMandate ? 'Mandate Active' : 'Authorization Required'}
            />
          </div>

          <div className="card-panel-body">
            <div className="settings-grid">
              <div className="settings-field">
                <div className="settings-label">Authorization Status</div>
                <div style={{ fontWeight: 600, color: activeMandate ? '#16a34a' : '#dc2626', fontSize: '0.9375rem' }}>
                  {activeMandate ? 'ACTIVE' : 'REVOKED / UNLINKED'}
                </div>
                <div className="settings-hint">
                  {activeMandate ? activeMandate.identifier_masked : 'No active mandate'}
                </div>
              </div>

              <div className="settings-field">
                <div className="settings-label">Payment Rails Provider</div>
                <div className="settings-value-strong">Razorpay Integration</div>
                <div className="settings-hint">Cryptographically verified gateway</div>
              </div>

              <div className="settings-field">
                <div className="settings-label">Mandate Single-Tx Ceiling</div>
                <div className="settings-value-strong">
                  {formatCurrency(activeMandate?.single_transaction_limit || 50000)}
                </div>
                <div className="settings-hint">Max amount chargeable per transaction</div>
              </div>

              <div className="settings-field">
                <div className="settings-label">Authorization Expiry</div>
                <div className="settings-value">
                  {activeMandate?.expires_at ? new Date(activeMandate.expires_at).toLocaleDateString() : 'Active 1 Year'}
                </div>
                <div className="settings-hint">Auto-renews or revokes on demand</div>
              </div>
            </div>

            <div style={{ paddingTop: '1rem', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'flex-end' }}>
              <Link to="/buyer/connections" className="settings-action-link">
                Manage payment authorization <Icons.ArrowRight size={14} />
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* 4. Active Security Controls */}
      <div className="card-panel">
        <div className="card-panel-header">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Icons.ShieldCheck size={18} />
              <h2 className="card-panel-title">Security & Safety Controls</h2>
            </div>
            <p className="card-panel-sub">Verified server-side defenses actively safeguarding your transactions.</p>
          </div>
        </div>

        <div className="card-panel-body">
          <div className="security-controls-list">
            <div className="security-control-item">
              <div>
                <div className="security-control-name">Payment Verification</div>
                <div className="security-control-sub">
                  Cryptographic verification and server-side authorization before confirming orders.
                </div>
              </div>
              <span className="control-badge-active">ACTIVE</span>
            </div>

            <div className="security-control-item">
              <div>
                <div className="security-control-name">Server-Side Authorization</div>
                <div className="security-control-sub">
                  AI recommendations do not authorize payments; all decisions happen on the backend.
                </div>
              </div>
              <span className="control-badge-active">ACTIVE</span>
            </div>

            <div className="security-control-item">
              <div>
                <div className="security-control-name">Deterministic Spending Rules</div>
                <div className="security-control-sub">
                  AI recommendations cannot override server-side spending limits or monthly budget caps.
                </div>
              </div>
              <span className="control-badge-active">ACTIVE</span>
            </div>

            <div className="security-control-item">
              <div>
                <div className="security-control-name">Transaction Idempotency</div>
                <div className="security-control-sub">
                  Distributed locks guarantee zero duplicate orders or payments across all purchase channels.
                </div>
              </div>
              <span className="control-badge-active">ACTIVE</span>
            </div>

            <div className="security-control-item">
              <div>
                <div className="security-control-name">Transaction Audit Trail</div>
                <div className="security-control-sub">
                  Every evaluation, price revalidation, and payment event is immutably logged for traceability.
                </div>
              </div>
              <span className="control-badge-active">ACTIVE</span>
            </div>

            <div className="security-control-item">
              <div>
                <div className="security-control-name">Webhook Signature Verification</div>
                <div className="security-control-sub">
                  HMAC-SHA256 signature verification validates all incoming payment provider event payloads.
                </div>
              </div>
              <span className="control-badge-active">ACTIVE</span>
            </div>
          </div>
        </div>
      </div>

      {/* 5. How AgentPay Protects Autonomous Purchases (Architecture & Authorization Boundary) */}
      <div className="card-panel">
        <div className="card-panel-header" style={{ cursor: 'pointer' }} onClick={() => setShowHowItWorks(!showHowItWorks)}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Icons.Lock size={18} />
              <h2 className="card-panel-title">How AgentPay Protects Autonomous Purchases</h2>
            </div>
            <p className="card-panel-sub">
              Architectural model and strict authorization boundary governing AI agents.
            </p>
          </div>
          <button
            type="button"
            className="toggle-button"
            onClick={(e) => {
              e.stopPropagation();
              setShowHowItWorks(!showHowItWorks);
            }}
          >
            {showHowItWorks ? 'Hide Details' : 'View Architecture'}
          </button>
        </div>

        <div className="card-panel-body">
          {/* Summary callout */}
          <div className="architecture-banner">
            <div style={{ fontWeight: 600, color: '#1e3a8a', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icons.ShieldCheck size={16} /> Zero-Trust Autonomous Commerce Architecture
            </div>
            <p style={{ margin: 0, color: '#1e40af', fontSize: '0.8125rem', lineHeight: 1.4 }}>
              AgentPay treats all AI recommendations as untrusted proposals. Every purchase request is sequentially revalidated against Buyer Policy, Risk Evaluation, Price Freshness, and Payment Authorization before execution.
            </p>
          </div>

          {showHowItWorks && (
            <div style={{ marginTop: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {/* Pipeline Breakdown */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
                <div className="pipeline-step-card">
                  <div className="pipeline-step-title">1. AI Agent</div>
                  <div className="pipeline-step-desc">Discovers, parses, and ranks eligible product matches.</div>
                </div>
                <div className="pipeline-step-card">
                  <div className="pipeline-step-title">2. Policy Engine</div>
                  <div className="pipeline-step-desc">Determines whether purchase complies with budget & rules.</div>
                </div>
                <div className="pipeline-step-card">
                  <div className="pipeline-step-title">3. Risk Engine</div>
                  <div className="pipeline-step-desc">Evaluates merchant trust, anomaly score, and injection threat.</div>
                </div>
                <div className="pipeline-step-card">
                  <div className="pipeline-step-title">4. Payment Service</div>
                  <div className="pipeline-step-desc">Executes authorized payment over tokenized rails.</div>
                </div>
                <div className="pipeline-step-card">
                  <div className="pipeline-step-title">5. Audit Service</div>
                  <div className="pipeline-step-desc">Records immutable audit log for complete accountability.</div>
                </div>
              </div>

              {/* Authorization Boundary Matrix */}
              <div className="boundary-matrix">
                <div className="boundary-column boundary-allowed">
                  <div className="boundary-title" style={{ color: '#15803d' }}>
                    ✓ Your AI Agent Can
                  </div>
                  <ul className="boundary-list">
                    <li>Search connected merchant stores</li>
                    <li>Compare real-time prices & delivery SLAs</li>
                    <li>Recommend optimal products based on intent</li>
                    <li>Submit structured purchase requests</li>
                  </ul>
                </div>

                <div className="boundary-column boundary-prohibited">
                  <div className="boundary-title" style={{ color: '#b91c1c' }}>
                    ✕ Your AI Agent Cannot
                  </div>
                  <ul className="boundary-list">
                    <li>Increase spending limits or monthly budget</li>
                    <li>Bypass human approval thresholds</li>
                    <li>Purchase from unpermitted product categories</li>
                    <li>Override price surge tolerance (&gt;2%)</li>
                    <li>Execute payments using revoked authorization</li>
                  </ul>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 6. Environment & Zero-Credential Assurance */}
      <div className="card-panel" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}>
        <div className="card-panel-header">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Icons.Shield size={18} />
              <h2 className="card-panel-title">Environment & Credential Isolation</h2>
            </div>
            <p className="card-panel-sub">Truthful disclosure on platform execution environment and data privacy.</p>
          </div>
        </div>

        <div className="card-panel-body">
          <div className="settings-grid">
            <div className="environment-info-card">
              <div style={{ fontWeight: 600, fontSize: '0.84375rem', color: '#1e293b', marginBottom: 4 }}>
                Payment Environment
              </div>
              <div style={{ fontSize: '0.78125rem', color: '#475569', lineHeight: 1.4 }}>
                <strong>Payment Infrastructure Safeguards</strong>: Autonomous transactions execute under pre-authorized cryptographic token mandates with fail-closed HMAC-SHA256 signature verification.
              </div>
            </div>

            <div className="environment-info-card">
              <div style={{ fontWeight: 600, fontSize: '0.84375rem', color: '#1e293b', marginBottom: 4 }}>
                Zero Credential Storage
              </div>
              <div style={{ fontSize: '0.78125rem', color: '#475569', lineHeight: 1.4 }}>
                AgentPay never requests, handles, or stores your <strong>UPI PIN</strong>, <strong>OTP</strong>, <strong>CVV</strong>, or <strong>bank passwords</strong>.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
