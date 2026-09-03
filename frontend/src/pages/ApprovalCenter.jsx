import { useState, useEffect } from 'react';
import { api } from '../services/api';
import { io } from 'socket.io-client';
import './ApprovalCenter.css';

export default function ApprovalCenter() {
  const [approvals, setApprovals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState(null);
  const [actionMessage, setActionMessage] = useState(null);

  useEffect(() => {
    fetchApprovals();

    const socketUrl = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5050';
    const socket = io(socketUrl, { transports: ['websocket', 'polling'] });

    socket.on('approval:created', () => fetchApprovals());
    socket.on('approval:decided', () => fetchApprovals());

    return () => socket.disconnect();
  }, []);

  const fetchApprovals = async () => {
    try {
      const res = await api.getApprovals('pending');
      setApprovals(res.approvals || []);
    } catch (e) {
      console.error('Failed to load approvals', e);
    } finally {
      setLoading(false);
    }
  };

  const handleDecision = async (approvalId, decision) => {
    setProcessingId(approvalId);
    setActionMessage(null);
    try {
      const res = await api.decideApproval(approvalId, decision, `Supervisor ${decision.toLowerCase()}d this procurement request.`);
      let messageText = 'Request rejected. Purchase blocked.';
      if (decision === 'APPROVE') {
        if (res.order?.order_status === 'CONFIRMED' || (res.transaction?.status === 'completed' && res.transaction?.payment_verified)) {
          messageText = `Approval granted. Payment verified and order confirmed (${res.order?.order_number || res.transaction?.payment_id}).`;
        } else {
          messageText = 'Approval granted. Purchase authorized and routed for payment execution.';
        }
      }
      setActionMessage({
        type: 'success',
        text: messageText,
      });
      fetchApprovals();
    } catch (e) {
      setActionMessage({
        type: 'error',
        text: e.message || 'Action failed. Please retry.',
      });
    } finally {
      setProcessingId(null);
    }
  };

  const formatCurrency = (val) => {
    const num = parseFloat(val) || 0;
    return `₹${num.toLocaleString('en-IN')}`;
  };

  return (
    <div>
      {/* Banner */}
      <div className="card-panel mb-6" style={{ marginBottom: '1.5rem' }}>
        <div style={{ padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <div style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-subtle)', marginBottom: '2px' }}>
              Human Authorization Gate
            </div>
            <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-main)' }}>
              Transactions exceeding autonomous agent limits require supervisor sign-off before payment execution.
            </div>
          </div>
          <div className="badge-status warning">
            {approvals.length} Pending Review
          </div>
        </div>
      </div>

      {actionMessage && (
        <div
          style={{
            padding: '0.75rem 1rem',
            backgroundColor: actionMessage.type === 'success' ? 'var(--success-bg)' : 'var(--danger-bg)',
            border: `1px solid ${actionMessage.type === 'success' ? 'var(--success-border)' : 'var(--danger-border)'}`,
            borderRadius: 'var(--radius-md)',
            color: actionMessage.type === 'success' ? 'var(--success-text)' : 'var(--danger-text)',
            fontSize: '0.875rem',
            marginBottom: '1rem',
          }}
        >
          {actionMessage.text}
        </div>
      )}

      {loading ? (
        <div className="card-panel">
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-subtle)', fontSize: '0.875rem' }}>
            Loading pending approvals...
          </div>
        </div>
      ) : approvals.length === 0 ? (
        <div className="card-panel">
          <div style={{ textAlign: 'center', padding: '3rem 1.5rem' }}>
            <div style={{ fontSize: '28px', marginBottom: '0.5rem' }}>✓</div>
            <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-main)' }}>
              No Pending Approvals
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-subtle)', maxWidth: '360px', margin: '0.5rem auto 0' }}>
              All autonomous purchase requests have been authorized or reviewed. New requests exceeding limits will appear here in real time.
            </p>
          </div>
        </div>
      ) : (
        <div className="approval-queue-list">
          {approvals.map((app) => {
            const amount = parseFloat(app.amount) || 0;
            const riskLevel = app.risk_score >= 70 ? 'HIGH' : app.risk_score >= 40 ? 'MEDIUM' : 'LOW';

            return (
              <div key={app.id} className="approval-card-unit">
                <div className="approval-card-top">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-main)' }}>
                      {app.product_name || 'Procurement Item'}
                    </span>
                    <span className="badge-status warning">Approval Required</span>
                  </div>
                  <div className="mono" style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-main)' }}>
                    {formatCurrency(amount)}
                  </div>
                </div>

                <div className="approval-card-main">
                  <div className="approval-grid-facts">
                    <div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-subtle)' }}>Agent</div>
                      <div style={{ fontSize: '0.875rem', fontWeight: 500 }}>{app.agent_name || 'Procurement Agent'}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-subtle)' }}>Merchant</div>
                      <div style={{ fontSize: '0.875rem', fontWeight: 500 }}>{app.merchant_name || 'Verified Merchant'}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-subtle)' }}>Risk Assessment</div>
                      <div style={{ marginTop: '2px' }}>
                        <span className={`badge-status ${riskLevel === 'LOW' ? 'success' : riskLevel === 'MEDIUM' ? 'warning' : 'danger'}`}>
                          {riskLevel} • {app.risk_score || 9}/100
                        </span>
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-subtle)' }}>Policy Invariant</div>
                      <div style={{ fontSize: '0.875rem', fontWeight: 500 }}>Approval threshold: ₹25,000</div>
                    </div>
                  </div>

                  {app.ai_reasoning && (
                    <div className="approval-ai-box">
                      <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '2px' }}>
                        AI Agent Intent & Rationale
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                        {app.ai_reasoning}
                      </div>
                    </div>
                  )}

                  <div className="approval-action-bar">
                    <button
                      className="btn-ui btn-ui-outline"
                      onClick={() => handleDecision(app.id, 'REJECT')}
                      disabled={processingId === app.id}
                      style={{ minWidth: '120px' }}
                    >
                      Reject
                    </button>
                    <button
                      className="btn-ui btn-ui-primary"
                      onClick={() => handleDecision(app.id, 'APPROVE')}
                      disabled={processingId === app.id}
                      style={{ minWidth: '220px' }}
                    >
                      {processingId === app.id ? 'Processing...' : 'Approve & Pay (Test Mode)'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
