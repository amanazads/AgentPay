import { useState, useEffect } from 'react';
import { api } from '../services/api';
import './AuditExplorer.css';

export default function AuditExplorer() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState('all');
  const [selectedEvent, setSelectedEvent] = useState(null);

  useEffect(() => {
    fetchAuditEvents();
  }, []);

  const fetchAuditEvents = async () => {
    try {
      const res = await api.getAuditEvents({ limit: 50 });
      setEvents(res.events || []);
    } catch (e) {
      console.error('Failed to load audit events', e);
    } finally {
      setLoading(false);
    }
  };

  const filteredEvents = events.filter((ev) => {
    if (filterType === 'all') return true;
    if (filterType === 'policy') return ev.event_type?.includes('INTENT') || ev.event_type?.includes('POLICY');
    if (filterType === 'payment') return ev.event_type?.includes('PAYMENT');
    if (filterType === 'approval') return ev.event_type?.includes('APPROVAL');
    return true;
  });

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
      {/* Top Filter Bar */}
      <div className="card-panel" style={{ marginBottom: '1.5rem' }}>
        <div style={{ padding: '0.75rem 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Filter Events:
            </span>
            <select
              className="select-ui"
              style={{ width: 'auto', padding: '3px 8px', fontSize: '0.75rem' }}
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
            >
              <option value="all">All Events ({events.length})</option>
              <option value="policy">Policy Evaluations</option>
              <option value="payment">Razorpay Payments</option>
              <option value="approval">Human Approvals</option>
            </select>
          </div>

          <div className="badge-status neutral">
            Append-Only Compliance Ledger
          </div>
        </div>
      </div>

      {loading ? (
        <div className="card-panel">
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-subtle)', fontSize: '0.875rem' }}>
            Loading immutable audit trail...
          </div>
        </div>
      ) : filteredEvents.length === 0 ? (
        <div className="card-panel">
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-subtle)', fontSize: '0.875rem' }}>
            No audit events recorded matching current filter.
          </div>
        </div>
      ) : (
        <div className="audit-event-list">
          {filteredEvents.map((ev) => {
            const isAllow = ev.decision === 'ALLOW' || ev.event_type?.includes('SUCCESS') || ev.event_type?.includes('GRANTED');
            const isApproval = ev.decision === 'APPROVAL_REQUIRED' || ev.event_type?.includes('APPROVAL');
            const isBlock = ev.decision === 'BLOCK' || ev.event_type?.includes('BLOCKED');

            return (
              <div
                key={ev.id}
                className="audit-item-row"
                onClick={() => setSelectedEvent(ev)}
              >
                <div className="audit-event-left">
                  <div
                    className={`activity-icon ${isAllow ? 'allow' : isApproval ? 'approval' : isBlock ? 'block' : 'info'}`}
                    style={{ width: '26px', height: '26px', fontSize: '11px' }}
                  >
                    {isAllow ? '✓' : isApproval ? '!' : isBlock ? '✕' : '◈'}
                  </div>

                  <div>
                    <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-main)' }}>
                      {ev.action?.replace(/_/g, ' ') || ev.event_type}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-subtle)' }}>
                      {ev.agent_name && <span>{ev.agent_name} • </span>}
                      <span>{formatDate(ev.created_at)}</span>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  {ev.decision && (
                    <span className={`badge-status ${isAllow ? 'success' : isApproval ? 'warning' : 'danger'}`}>
                      {ev.decision}
                    </span>
                  )}
                  <span className="mono" style={{ fontSize: '11px', color: 'var(--text-subtle)' }}>
                    Policy {ev.policy_version || 'v3'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Selected Audit Event Modal */}
      {selectedEvent && (
        <div className="modal-backdrop-ui" onClick={() => setSelectedEvent(null)}>
          <div className="modal-dialog-ui" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header-ui">
              <div className="modal-title-ui">Audit Event Details</div>
              <button className="modal-close-ui" onClick={() => setSelectedEvent(null)} aria-label="Close">
                ✕
              </button>
            </div>

            <div className="modal-body-ui">
              <div className="card-panel mb-4" style={{ backgroundColor: 'var(--bg-subtle)' }}>
                <div style={{ padding: '0.75rem 1rem', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div className="spec-summary-row">
                    <span className="spec-summary-label">Event Type:</span>
                    <span className="spec-summary-val" style={{ fontWeight: 600 }}>{selectedEvent.event_type}</span>
                  </div>
                  <div className="spec-summary-row">
                    <span className="spec-summary-label">Action:</span>
                    <span className="spec-summary-val">{selectedEvent.action}</span>
                  </div>
                  <div className="spec-summary-row">
                    <span className="spec-summary-label">Timestamp:</span>
                    <span className="spec-summary-val">{formatDate(selectedEvent.created_at)}</span>
                  </div>
                  <div className="spec-summary-row">
                    <span className="spec-summary-label">Agent:</span>
                    <span className="spec-summary-val">{selectedEvent.agent_name || 'Procurement Agent'}</span>
                  </div>
                  <div className="spec-summary-row">
                    <span className="spec-summary-label">Policy Version:</span>
                    <span className="mono spec-summary-val">{selectedEvent.policy_version || 'v3'}</span>
                  </div>
                </div>
              </div>

              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '4px' }}>
                Event Metadata Payload
              </div>
              <pre className="mono" style={{ backgroundColor: 'var(--bg-subtle)', padding: '0.75rem', borderRadius: 'var(--radius-md)', fontSize: '11px', overflowX: 'auto', maxHeight: '180px' }}>
                {JSON.stringify(selectedEvent.details, null, 2)}
              </pre>
            </div>

            <div className="modal-footer-ui">
              <button className="btn-ui btn-ui-primary" onClick={() => setSelectedEvent(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
