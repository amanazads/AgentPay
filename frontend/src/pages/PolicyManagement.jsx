import { useState, useEffect } from 'react';
import { api } from '../services/api';
import './PolicyManagement.css';

export default function PolicyManagement() {
  const [policies, setPolicies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedPolicy, setSelectedPolicy] = useState(null);
  const [viewMode, setViewMode] = useState('visual'); // 'visual' or 'json'

  useEffect(() => {
    fetchPolicies();
  }, []);

  const fetchPolicies = async () => {
    try {
      const res = await api.getPolicies();
      const list = res.policies || [];
      setPolicies(list);
      if (list.length > 0) {
        setSelectedPolicy(list[0]);
      }
    } catch (e) {
      console.error('Failed to load policies', e);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (val) => {
    const num = parseFloat(val) || 0;
    return `₹${num.toLocaleString('en-IN')}`;
  };

  return (
    <div>
      {/* Top Banner */}
      <div className="card-panel mb-6" style={{ marginBottom: '1.5rem' }}>
        <div style={{ padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <div style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-subtle)', marginBottom: '2px' }}>
              Deterministic Spending Rules
            </div>
            <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-main)' }}>
              13 server-side rules evaluating every autonomous purchase intent before payment authorization.
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              className={`btn-ui btn-ui-sm ${viewMode === 'visual' ? 'btn-ui-primary' : 'btn-ui-outline'}`}
              onClick={() => setViewMode('visual')}
            >
              Visual Controls
            </button>
            <button
              className={`btn-ui btn-ui-sm ${viewMode === 'json' ? 'btn-ui-primary' : 'btn-ui-outline'}`}
              onClick={() => setViewMode('json')}
            >
              Raw Schema
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="card-panel">
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-subtle)', fontSize: '0.875rem' }}>
            Loading policy profiles...
          </div>
        </div>
      ) : (
        <div className="policy-layout-grid">
          {/* Policy Profile Selector Sidebar */}
          <div className="card-panel">
            <div className="card-panel-header">
              <div className="card-panel-title">Policy Profiles</div>
            </div>
            <div className="card-panel-body" style={{ padding: '0.5rem' }}>
              <div className="policy-list-sidebar">
                {policies.map((p) => (
                  <button
                    key={p.id}
                    className={`policy-item-btn ${selectedPolicy?.id === p.id ? 'selected' : ''}`}
                    onClick={() => setSelectedPolicy(p)}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: selectedPolicy?.id === p.id ? 600 : 500, fontSize: '0.875rem' }}>
                        {p.name}
                      </span>
                      <span className="mono" style={{ fontSize: '11px', color: 'var(--text-subtle)' }}>
                        v{p.version || 3}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-subtle)', marginTop: '2px' }}>
                      Daily: {formatCurrency(p.daily_budget)}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Policy Rules Configuration Display */}
          {selectedPolicy && (
            <div className="card-panel">
              <div className="card-panel-header">
                <div>
                  <div className="card-panel-title">{selectedPolicy.name}</div>
                  <div className="card-panel-sub">
                    {selectedPolicy.description || 'Enterprise procurement policy governing autonomous purchasing limits.'}
                  </div>
                </div>
                <span className="badge-status success">Active Profile</span>
              </div>

              <div className="card-panel-body">
                {viewMode === 'visual' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                    {/* Financial Thresholds */}
                    <div>
                      <div style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-subtle)', marginBottom: '0.75rem' }}>
                        Financial Constraints & Thresholds
                      </div>

                      <div className="policy-facts-grid">
                        <div className="card-panel" style={{ backgroundColor: 'var(--bg-subtle)' }}>
                          <div style={{ padding: '0.75rem 1rem' }}>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-subtle)' }}>Daily Budget Ceiling</div>
                            <div className="mono" style={{ fontSize: '1.1rem', fontWeight: 700, marginTop: '2px' }}>
                              {formatCurrency(selectedPolicy.daily_budget)}
                            </div>
                            <div style={{ fontSize: '11px', color: 'var(--text-subtle)', marginTop: '2px' }}>
                              Hard limit in 24h window
                            </div>
                          </div>
                        </div>

                        <div className="card-panel" style={{ backgroundColor: 'var(--bg-subtle)' }}>
                          <div style={{ padding: '0.75rem 1rem' }}>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-subtle)' }}>Single-Transaction Limit</div>
                            <div className="mono" style={{ fontSize: '1.1rem', fontWeight: 700, marginTop: '2px' }}>
                              {formatCurrency(selectedPolicy.max_transaction)}
                            </div>
                            <div style={{ fontSize: '11px', color: 'var(--text-subtle)', marginTop: '2px' }}>
                              Maximum single spend
                            </div>
                          </div>
                        </div>

                        <div className="card-panel" style={{ backgroundColor: 'var(--bg-subtle)' }}>
                          <div style={{ padding: '0.75rem 1rem' }}>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-subtle)' }}>Approval Required Above</div>
                            <div className="mono" style={{ fontSize: '1.1rem', fontWeight: 700, marginTop: '2px' }}>
                              {formatCurrency(selectedPolicy.approval_threshold)}
                            </div>
                            <div style={{ fontSize: '11px', color: 'var(--text-subtle)', marginTop: '2px' }}>
                              Human review threshold
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Operational & Merchant Rules */}
                    <div>
                      <div style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-subtle)', marginBottom: '0.75rem' }}>
                        Integrity & Security Rules
                      </div>

                      <div className="policy-facts-grid">
                        <div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-subtle)' }}>Merchant Verification</div>
                          <div style={{ fontSize: '0.875rem', fontWeight: 500, marginTop: '2px' }}>
                            {selectedPolicy.verified_merchants_only ? 'Verified Merchants Only (Strict)' : 'All Merchants Allowed'}
                          </div>
                        </div>

                        <div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-subtle)' }}>Price Manipulation Tolerance</div>
                          <div className="mono" style={{ fontSize: '0.875rem', fontWeight: 600, marginTop: '2px' }}>
                            {selectedPolicy.price_tolerance_pct || 2.0}%
                          </div>
                        </div>

                        <div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-subtle)' }}>Duplicate Spend Guard</div>
                          <div style={{ fontSize: '0.875rem', fontWeight: 500, marginTop: '2px' }}>
                            5-Minute Sliding Window (Redis)
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Categories */}
                    <div>
                      <div style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-subtle)', marginBottom: '0.5rem' }}>
                        Allowed Categories
                      </div>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        {(selectedPolicy.allowed_categories || ['electronics', 'software', 'office_supplies']).map((cat) => (
                          <span key={cat} className="badge-tag">
                            ✓ {cat}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-subtle)', marginBottom: '0.5rem' }}>
                        Blocked Categories
                      </div>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        {(selectedPolicy.blocked_categories || ['gambling', 'financial_products', 'luxury']).map((cat) => (
                          <span key={cat} className="badge-tag" style={{ color: 'var(--danger)', borderColor: 'var(--danger-border)' }}>
                            ✕ {cat}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <pre className="mono" style={{ backgroundColor: 'var(--bg-subtle)', padding: '1rem', borderRadius: 'var(--radius-md)', fontSize: '0.75rem', overflowX: 'auto' }}>
                    {JSON.stringify(selectedPolicy, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
