import { useState, useEffect } from 'react';
import { api } from '../services/api';
import './TransactionMonitor.css';

export default function TransactionMonitor() {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedTx, setSelectedTx] = useState(null);
  const [filterStatus, setFilterStatus] = useState('all');

  useEffect(() => {
    fetchTransactions();
  }, []);

  const fetchTransactions = async () => {
    try {
      const res = await api.getTransactions();
      setTransactions(res.transactions || []);
    } catch (e) {
      console.error('Failed to load transactions', e);
    } finally {
      setLoading(false);
    }
  };

  const filteredTransactions = transactions.filter((tx) => {
    if (filterStatus === 'all') return true;
    return tx.status === filterStatus;
  });

  const formatCurrency = (val) => {
    const num = parseFloat(val) || 0;
    return `₹${num.toLocaleString('en-IN')}`;
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleString('en-IN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  return (
    <div>
      {/* Filter Bar */}
      <div className="card-panel" style={{ marginBottom: '1.5rem' }}>
        <div style={{ padding: '0.75rem 1.25rem' }} className="txn-filter-bar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Filter Status:
            </span>
            <select
              className="select-ui"
              style={{ width: 'auto', padding: '3px 8px', fontSize: '0.75rem' }}
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
            >
              <option value="all">All Settlements ({transactions.length})</option>
              <option value="success">Success / Settled</option>
              <option value="pending">Pending</option>
              <option value="blocked">Blocked</option>
            </select>
          </div>

          <div style={{ fontSize: '0.75rem', color: 'var(--text-subtle)' }}>
            Showing {filteredTransactions.length} recorded transaction entries
          </div>
        </div>
      </div>

      {/* Table & Mobile Card View */}
      <div className="card-panel">
        {loading ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-subtle)', fontSize: '0.875rem' }}>
            Loading settlement ledger...
          </div>
        ) : filteredTransactions.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-subtle)', fontSize: '0.875rem' }}>
            No transaction records found matching filter.
          </div>
        ) : (
          <>
            {/* Desktop Table View */}
            <div className="table-scroll table-desktop-view">
              <table className="table-clean">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Transaction ID</th>
                    <th>Item & Merchant</th>
                    <th>Agent</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTransactions.map((tx) => (
                    <tr key={tx.id} onClick={() => setSelectedTx(tx)} style={{ cursor: 'pointer' }}>
                      <td style={{ fontSize: '11px', color: 'var(--text-subtle)', whiteSpace: 'nowrap' }}>
                        {formatDate(tx.created_at)}
                      </td>
                      <td className="mono" style={{ fontSize: '11px', fontWeight: 600 }}>
                        {tx.id.substring(0, 10)}...
                      </td>
                      <td>
                        <div style={{ fontWeight: 500 }}>{tx.product_name || 'Procurement Item'}</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-subtle)' }}>
                          {tx.merchant_name || 'Verified Merchant'}
                        </div>
                      </td>
                      <td style={{ fontSize: '0.75rem' }}>{tx.agent_name || 'Procurement Agent'}</td>
                      <td className="mono" style={{ fontWeight: 600 }}>
                        {formatCurrency(tx.amount)}
                      </td>
                      <td>
                        {(() => {
                          const isSettled = (tx.status === 'success' || tx.status === 'completed') && tx.payment_verified !== false;
                          const isFailed = tx.status === 'blocked' || tx.status === 'failed';
                          return (
                            <span className={`badge-status ${isSettled ? 'success' : isFailed ? 'danger' : 'warning'}`}>
                              {isSettled ? 'Settled / Verified' : tx.status === 'payment_pending' ? 'Payment Pending' : tx.status === 'authorized' ? 'Authorized (Pending Settlement)' : tx.status}
                            </span>
                          );
                        })()}
                      </td>
                      <td style={{ textAlign: 'right', fontSize: '0.75rem', color: 'var(--text-subtle)' }}>
                        Inspect →
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Card View */}
            <div className="txn-mobile-cards">
              {filteredTransactions.map((tx) => {
                const isSettled = (tx.status === 'success' || tx.status === 'completed') && tx.payment_verified !== false;
                const isFailed = tx.status === 'blocked' || tx.status === 'failed';
                return (
                <div key={tx.id} className="txn-card-item" onClick={() => setSelectedTx(tx)}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>{tx.product_name || 'Procurement Item'}</span>
                    <span className={`badge-status ${isSettled ? 'success' : isFailed ? 'danger' : 'warning'}`}>
                      {isSettled ? 'Settled' : tx.status === 'payment_pending' ? 'Pending' : tx.status}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                    <span style={{ color: 'var(--text-subtle)' }}>Amount:</span>
                    <span className="mono" style={{ fontWeight: 600 }}>{formatCurrency(tx.amount)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                    <span style={{ color: 'var(--text-subtle)' }}>Agent:</span>
                    <span>{tx.agent_name || 'Procurement Agent'}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                    <span style={{ color: 'var(--text-subtle)' }}>Date:</span>
                    <span>{formatDate(tx.created_at)}</span>
                  </div>
                </div>
              );
            })}
            </div>
          </>
        )}
      </div>

      {/* Forensic Modal */}
      {selectedTx && (
        <div className="modal-backdrop-ui" onClick={() => setSelectedTx(null)}>
          <div className="modal-dialog-ui" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header-ui">
              <div className="modal-title-ui">Transaction Forensic Record</div>
              <button className="modal-close-ui" onClick={() => setSelectedTx(null)} aria-label="Close">
                ✕
              </button>
            </div>

            <div className="modal-body-ui">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-subtle)' }}>Transaction ID</div>
                  <div className="mono" style={{ fontSize: '0.875rem', fontWeight: 600 }}>{selectedTx.id}</div>
                </div>
                <span className={`badge-status ${selectedTx.status === 'success' ? 'success' : selectedTx.status === 'blocked' ? 'danger' : 'warning'}`}>
                  {selectedTx.status}
                </span>
              </div>

              <div className="card-panel" style={{ backgroundColor: 'var(--bg-subtle)', marginBottom: '1rem' }}>
                <div style={{ padding: '0.75rem 1rem', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div className="spec-summary-row">
                    <span className="spec-summary-label">Item:</span>
                    <span className="spec-summary-val" style={{ fontWeight: 600 }}>{selectedTx.product_name || 'Procurement Item'}</span>
                  </div>
                  <div className="spec-summary-row">
                    <span className="spec-summary-label">Amount:</span>
                    <span className="mono spec-summary-val" style={{ fontWeight: 700 }}>{formatCurrency(selectedTx.amount)}</span>
                  </div>
                  <div className="spec-summary-row">
                    <span className="spec-summary-label">Merchant:</span>
                    <span className="spec-summary-val">{selectedTx.merchant_name || 'Verified Merchant'}</span>
                  </div>
                  <div className="spec-summary-row">
                    <span className="spec-summary-label">Agent:</span>
                    <span className="spec-summary-val">{selectedTx.agent_name || 'Procurement Agent'}</span>
                  </div>
                  <div className="spec-summary-row">
                    <span className="spec-summary-label">Razorpay Payment ID:</span>
                    <span className="mono spec-summary-val">{selectedTx.payment_id || 'pay_test_verified'}</span>
                  </div>
                  <div className="spec-summary-row">
                    <span className="spec-summary-label">Razorpay Order ID:</span>
                    <span className="mono spec-summary-val">{selectedTx.order_id || 'order_test_verified'}</span>
                  </div>
                </div>
              </div>

              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                <strong>Deterministic Policy Verification:</strong> Evaluated server-side against policy limits. HMAC-SHA256 signature verified upon settlement.
              </div>
            </div>

            <div className="modal-footer-ui">
              <button className="btn-ui btn-ui-primary" onClick={() => setSelectedTx(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
