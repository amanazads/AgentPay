import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { Icons } from '../components/ui/Icons';
import Button from '../components/ui/Button';
import StatusBadge from '../components/ui/StatusBadge';

export default function Connections() {
  const [merchants, setMerchants] = useState([]);
  const [paymentMethods, setPaymentMethods] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);
  const [messageType, setMessageType] = useState('success');
  const [expandedMerchantId, setExpandedMerchantId] = useState(null);
  const [actionLoading, setActionLoading] = useState(null);

  useEffect(() => {
    loadConnections();
  }, []);

  const loadConnections = async () => {
    try {
      const [merchRes, pmRes] = await Promise.all([
        api.getConnectedMerchants().catch(() => ({ merchants: [] })),
        api.getPaymentMethods().catch(() => ({ paymentMethods: [] })),
      ]);
      setMerchants(merchRes.merchants || []);
      setPaymentMethods(pmRes.paymentMethods || []);
    } catch (e) {
      console.error('Failed to load connections', e);
    } finally {
      setLoading(false);
    }
  };

  const showToast = (text, type = 'success') => {
    setMessage(text);
    setMessageType(type);
    setTimeout(() => setMessage(null), 4000);
  };

  const handleToggleConnect = async (merchant) => {
    const isConn = merchant.isConnected || merchant.connectionState === 'CONNECTED';
    setActionLoading(`merchant_${merchant.merchantId}`);
    try {
      if (isConn) {
        await api.disconnectMerchant(merchant.merchantId);
        showToast(`Disconnected ${merchant.merchantName}. AI cannot checkout from this store.`, 'info');
      } else {
        await api.connectMerchant(merchant.merchantId, {
          accountIdentifier: 'sandbox_buyer@agentpay.ai',
          authType: 'oauth2_tokenized',
        });
        showToast(`Connected ${merchant.merchantName} successfully. Autonomous checkout enabled.`, 'success');
      }
      const merchRes = await api.getConnectedMerchants();
      setMerchants(merchRes.merchants || []);
    } catch (e) {
      showToast(e.message || 'Failed to update store connection.', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleAddDefaultMandate = async () => {
    setActionLoading('mandate_add');
    try {
      await api.addPaymentMethod({
        provider: 'razorpay_sandbox',
        method_type: 'upi_mandate',
        identifier_masked: 'user@okaxis (Sandbox Mandate)',
        single_transaction_limit: 50000,
        monthly_limit: 200000,
        is_default: true,
      });
      const pmRes = await api.getPaymentMethods();
      setPaymentMethods(pmRes.paymentMethods || []);
      showToast('Sandbox Payment Authorization established (₹50,000 Limit).', 'success');
    } catch (e) {
      showToast(e.message || 'Failed to link payment mandate.', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRevokeMethod = async (id) => {
    if (!window.confirm('Revoke this payment authorization? Autonomous checkout will be disabled until re-authorized.')) {
      return;
    }
    setActionLoading(`mandate_revoke_${id}`);
    try {
      await api.revokePaymentMethod(id);
      const pmRes = await api.getPaymentMethods();
      setPaymentMethods(pmRes.paymentMethods || []);
      showToast('Payment authorization revoked. Autonomous checkout halted.', 'info');
    } catch (e) {
      showToast(e.message || 'Failed to revoke payment authorization.', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const formatCurrency = (amt) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amt || 0);

  const activeMandate = paymentMethods.find((pm) => pm.isActive && !pm.isRevoked);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="text-h1">Connected Stores & Payment Rails</h1>
          <p className="text-body" style={{ marginTop: 2 }}>
            Manage verified merchant connectors, live catalog status, and autonomous payment authorizations.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span style={{
            fontSize: '0.75rem',
            fontWeight: 600,
            padding: '4px 10px',
            borderRadius: 'var(--radius-sm)',
            background: '#e0e7ff',
            color: '#3730a3',
            border: '1px solid #c7d2fe',
          }}>
            SANDBOX ENVIRONMENT
          </span>
        </div>
      </div>

      {message && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '0.75rem 1rem',
          backgroundColor: messageType === 'error' ? '#fef2f2' : messageType === 'info' ? '#eff6ff' : 'var(--success-bg)',
          border: `1px solid ${messageType === 'error' ? '#fecaca' : messageType === 'info' ? '#bfdbfe' : 'var(--success-border)'}`,
          borderRadius: 'var(--radius-md)',
          color: messageType === 'error' ? '#991b1b' : messageType === 'info' ? '#1e40af' : 'var(--success-text)',
          fontSize: '0.84375rem',
          fontWeight: 500,
        }}>
          {messageType === 'error' ? <Icons.AlertCircle size={16} /> : <Icons.Check size={16} />}
          <span>{message}</span>
        </div>
      )}

      {/* 1. Connected Merchant Stores */}
      <div className="card-panel">
        <div className="card-panel-header">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Icons.Store size={18} />
              <h2 className="card-panel-title">Connected Merchant Stores</h2>
            </div>
            <p className="card-panel-sub">
              Your AI agent discovers products, checks inventory, and executes checkouts via these merchant connectors.
            </p>
          </div>
          <StatusBadge status="ACTIVE" label="Live Connectors" />
        </div>

        <div className="card-panel-body">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
            {merchants.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-subtle)', border: '1px dashed var(--border-color)', borderRadius: 'var(--radius-md)' }}>
                <Icons.Store size={24} style={{ margin: '0 auto 0.5rem', opacity: 0.5 }} />
                <div style={{ fontWeight: 600, color: 'var(--text-main)' }}>No Stores Connected</div>
                <p style={{ fontSize: '0.8125rem', marginTop: '0.25rem' }}>
                  Connect a merchant to let AgentPay discover and purchase products.
                </p>
              </div>
            ) : (
              merchants.map((m) => {
                const isConn = m.isConnected || m.connectionState === 'CONNECTED';
                const isExpanded = expandedMerchantId === m.merchantId;
                const diag = m.healthDiagnostics || {};

                return (
                  <div
                    key={m.merchantId}
                    style={{
                      border: `1px solid ${isConn ? 'var(--border-color)' : '#e2e8f0'}`,
                      borderRadius: 'var(--radius-md)',
                      backgroundColor: isConn ? 'var(--bg-surface)' : '#f8fafc',
                      overflow: 'hidden',
                      transition: 'all 0.2s ease',
                    }}
                  >
                    <div
                      style={{
                        padding: '1rem 1.25rem',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: '1rem',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <div
                          style={{
                            width: 40,
                            height: 40,
                            borderRadius: 'var(--radius-md)',
                            backgroundColor: isConn ? '#f0fdf4' : 'var(--bg-subtle)',
                            color: isConn ? '#166534' : 'var(--text-muted)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            border: `1px solid ${isConn ? '#bbf7d0' : 'var(--border-color)'}`,
                          }}
                        >
                          <Icons.Store size={20} />
                        </div>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{ fontWeight: 600, fontSize: '0.9375rem', color: 'var(--text-main)' }}>
                              {m.merchantName}
                            </span>
                            <span style={{
                              fontSize: '0.6875rem',
                              fontWeight: 600,
                              padding: '2px 6px',
                              borderRadius: '4px',
                              background: '#ecfdf5',
                              color: '#065f46',
                            }}>
                              VERIFIED STORE
                            </span>
                          </div>
                          <div style={{ fontSize: '0.78125rem', color: 'var(--text-subtle)', marginTop: 2 }}>
                            Category: {m.category || 'Technology & Electronics'} • Rating: {m.rating || '4.8'} / 5.0 • {m.productCount || 0} active products
                          </div>
                        </div>
                      </div>

                      {/* Capabilities & Controls */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                          <span className="badge-tag" title="Read products via machine-readable catalog">
                            Catalog API ✓
                          </span>
                          <span className="badge-tag" title="Real-time stock checking">
                            Inventory Check ✓
                          </span>
                          <span className="badge-tag" style={{ opacity: isConn ? 1 : 0.5 }} title="Autonomous order execution">
                            Auto Checkout {isConn ? '✓' : '✗'}
                          </span>
                          <span className="badge-tag">
                            Razorpay Rails ✓
                          </span>
                        </div>

                        <StatusBadge
                          status={isConn ? 'ACTIVE' : 'INACTIVE'}
                          label={isConn ? 'CONNECTED' : 'DISCONNECTED'}
                        />

                        <Button
                          size="sm"
                          variant={isConn ? 'outline' : 'primary'}
                          onClick={() => handleToggleConnect(m)}
                          loading={actionLoading === `merchant_${m.merchantId}`}
                        >
                          {isConn ? 'Disconnect' : 'Connect'}
                        </Button>

                        <button
                          type="button"
                          onClick={() => setExpandedMerchantId(isExpanded ? null : m.merchantId)}
                          style={{
                            background: 'transparent',
                            border: '1px solid var(--border-color)',
                            borderRadius: 'var(--radius-sm)',
                            padding: '5px 8px',
                            cursor: 'pointer',
                            fontSize: '0.75rem',
                            color: 'var(--text-subtle)',
                          }}
                        >
                          {isExpanded ? 'Hide Diagnostics' : 'Diagnostics'}
                        </button>
                      </div>
                    </div>

                    {/* Diagnostics Drawer */}
                    {isExpanded && (
                      <div style={{
                        padding: '0.875rem 1.25rem',
                        backgroundColor: '#f8fafc',
                        borderTop: '1px solid var(--border-color)',
                        fontSize: '0.78125rem',
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                        gap: '0.75rem',
                      }}>
                        <div>
                          <span style={{ color: 'var(--text-muted)' }}>Catalog Health: </span>
                          <strong style={{ color: '#16a34a' }}>{diag.catalog || 'HEALTHY'}</strong>
                          <div style={{ color: 'var(--text-subtle)', fontSize: '0.71875rem' }}>
                            {m.productCount} products indexed
                          </div>
                        </div>
                        <div>
                          <span style={{ color: 'var(--text-muted)' }}>Inventory Freshness: </span>
                          <strong style={{ color: '#16a34a' }}>{diag.inventory || 'FRESH'}</strong>
                          <div style={{ color: 'var(--text-subtle)', fontSize: '0.71875rem' }}>
                            Live DB stock reservation
                          </div>
                        </div>
                        <div>
                          <span style={{ color: 'var(--text-muted)' }}>Checkout Connector: </span>
                          <strong style={{ color: isConn ? '#16a34a' : '#dc2626' }}>
                            {isConn ? 'AVAILABLE' : 'DISCONNECTED'}
                          </strong>
                          <div style={{ color: 'var(--text-subtle)', fontSize: '0.71875rem' }}>
                            OAuth tokenized auth
                          </div>
                        </div>
                        <div>
                          <span style={{ color: 'var(--text-muted)' }}>Payment Rails: </span>
                          <strong style={{ color: '#2563eb' }}>Razorpay Sandbox</strong>
                          <div style={{ color: 'var(--text-subtle)', fontSize: '0.71875rem' }}>
                            Test merchant gateway
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* 2. Autonomous Payment Mandates */}
      <div className="card-panel">
        <div className="card-panel-header">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Icons.CreditCard size={18} />
              <h2 className="card-panel-title">Autonomous Payment Authorization</h2>
            </div>
            <p className="card-panel-sub">
              Bounded payment authorization token enabling AgentPay to execute policy-approved transactions without manual PIN entry.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '6px' }}>
            <span style={{
              fontSize: '0.75rem',
              fontWeight: 600,
              padding: '3px 8px',
              borderRadius: '4px',
              background: activeMandate ? '#ecfdf5' : '#fee2e2',
              color: activeMandate ? '#065f46' : '#991b1b',
            }}>
              {activeMandate ? 'PAYMENT AUTHORIZED' : 'AUTHORIZATION REQUIRED'}
            </span>
          </div>
        </div>

        <div className="card-panel-body">
          {!activeMandate ? (
            <div style={{ padding: '2rem', textAlign: 'center', border: '1px dashed var(--border-color)', borderRadius: 'var(--radius-md)' }}>
              <Icons.CreditCard size={28} style={{ margin: '0 auto 0.5rem', opacity: 0.5 }} />
              <div style={{ fontWeight: 600, color: 'var(--text-main)', marginBottom: '0.25rem' }}>
                No Active Payment Authorization
              </div>
              <p className="text-body" style={{ marginBottom: '1rem', maxWidth: 460, margin: '0 auto 1rem' }}>
                AgentPay cannot execute autonomous checkout without an authorized payment mandate. Link a sandbox mandate below to enable test purchases.
              </p>
              <Button
                variant="primary"
                onClick={handleAddDefaultMandate}
                loading={actionLoading === 'mandate_add'}
                icon={<Icons.CreditCard size={15} />}
              >
                Establish Sandbox Authorization (₹50,000 Limit)
              </Button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
              <div
                style={{
                  padding: '1.25rem',
                  border: '1px solid #bbf7d0',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: '#f0fdf4',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '1rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 'var(--radius-md)',
                      backgroundColor: '#ffffff',
                      color: '#065f46',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: '1px solid #86efac',
                      boxShadow: 'var(--shadow-sm)',
                    }}
                  >
                    <Icons.CreditCard size={22} />
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontWeight: 600, fontSize: '0.9375rem', color: 'var(--text-main)' }}>
                        {activeMandate.identifier_masked}
                      </span>
                      <span style={{
                        fontSize: '0.6875rem',
                        fontWeight: 700,
                        padding: '2px 6px',
                        borderRadius: '4px',
                        background: '#dcfce7',
                        color: '#15803d',
                      }}>
                        ACTIVE MANDATE
                      </span>
                    </div>
                    <div style={{ fontSize: '0.8125rem', color: 'var(--text-subtle)', marginTop: 2 }}>
                      Provider: Razorpay Sandbox Rails • Single Tx Limit: <strong>{formatCurrency(activeMandate.single_transaction_limit)}</strong> • Monthly Ceiling: {formatCurrency(activeMandate.monthly_limit || 200000)}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
                      Tokenized Ref: {activeMandate.auth_environment || 'SANDBOX'} (Expires {new Date(activeMandate.expires_at || Date.now() + 365*86400000).toLocaleDateString()})
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleRevokeMethod(activeMandate.id)}
                    loading={actionLoading === `mandate_revoke_${activeMandate.id}`}
                  >
                    Revoke Authorization
                  </Button>
                </div>
              </div>

              {/* Historical / Revoked list if any */}
              {paymentMethods.filter((pm) => pm.isRevoked).length > 0 && (
                <div style={{ marginTop: '0.5rem' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.375rem' }}>
                    Revoked Authorizations
                  </div>
                  {paymentMethods.filter((pm) => pm.isRevoked).map((rpm) => (
                    <div
                      key={rpm.id}
                      style={{
                        padding: '0.625rem 0.875rem',
                        border: '1px solid #fee2e2',
                        borderRadius: 'var(--radius-sm)',
                        backgroundColor: '#fff5f5',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        fontSize: '0.78125rem',
                        color: 'var(--text-subtle)',
                        marginBottom: '4px',
                      }}
                    >
                      <div>
                        <span>{rpm.identifier_masked}</span>
                        <span style={{ marginLeft: '0.5rem', color: '#991b1b', fontWeight: 600 }}>REVOKED</span>
                      </div>
                      <span style={{ fontSize: '0.71875rem' }}>
                        Limit: {formatCurrency(rpm.single_transaction_limit)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 3. Security & Governance Architecture */}
      <div className="card-panel" style={{ background: '#fafbff', border: '1px solid #e0e7ff' }}>
        <div className="card-panel-header">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Icons.Shield size={18} />
              <h2 className="card-panel-title">Zero-Trust Security & Policy Boundaries</h2>
            </div>
            <p className="card-panel-sub">
              How AgentPay ensures absolute financial safety during autonomous commerce operations.
            </p>
          </div>
        </div>

        <div className="card-panel-body">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
            <div style={{ padding: '0.875rem', background: '#ffffff', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
              <div style={{ fontWeight: 600, fontSize: '0.8125rem', color: 'var(--text-main)', marginBottom: '0.25rem' }}>
                🔒 Zero Credential Storage
              </div>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-subtle)', lineHeight: 1.4 }}>
                AgentPay never stores or handles your UPI PIN, CVV, OTP, or netbanking passwords. All payment rails use tokenized mandates.
              </p>
            </div>

            <div style={{ padding: '0.875rem', background: '#ffffff', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
              <div style={{ fontWeight: 600, fontSize: '0.8125rem', color: 'var(--text-main)', marginBottom: '0.25rem' }}>
                ⚖️ Dual-Boundary Resolution
              </div>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-subtle)', lineHeight: 1.4 }}>
                Every purchase is evaluated against both your Autonomous Purchase Limit and your Payment Mandate Ceiling. The lowest ceiling wins.
              </p>
            </div>

            <div style={{ padding: '0.875rem', background: '#ffffff', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
              <div style={{ fontWeight: 600, fontSize: '0.8125rem', color: 'var(--text-main)', marginBottom: '0.25rem' }}>
                🛑 Fail-Closed Revocation
              </div>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-subtle)', lineHeight: 1.4 }}>
                Revoking payment authorization immediately blocks all pending and future autonomous payments while keeping product discovery active.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
