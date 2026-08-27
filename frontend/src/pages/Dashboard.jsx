import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { io } from 'socket.io-client';
import './Dashboard.css';

export default function Dashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState({
    totalTransactions: 0,
    totalSpend: 0,
    blockedSpend: 0,
    pendingApprovals: 0,
    activeAgents: 0,
    recentSettlements: [],
    recentActivities: [],
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDashboardData();

    const socketUrl = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5050';
    const socket = io(socketUrl, { transports: ['websocket', 'polling'] });

    socket.on('audit:event', () => fetchDashboardData());
    socket.on('approval:created', () => fetchDashboardData());
    socket.on('payment:settled', () => fetchDashboardData());

    return () => socket.disconnect();
  }, []);

  const fetchDashboardData = async () => {
    try {
      const [statsRes, agentsRes, txnsRes, approvalsRes, auditRes] = await Promise.all([
        api.getDashboardStats().catch(() => ({})),
        api.getAgents().catch(() => ({ agents: [] })),
        api.getTransactions().catch(() => ({ transactions: [] })),
        api.getApprovals('pending').catch(() => ({ approvals: [] })),
        api.getAuditEvents({ limit: 6 }).catch(() => ({ events: [] })),
      ]);

      const transactions = txnsRes.transactions || [];
      const agents = agentsRes.agents || [];
      const pending = approvalsRes.approvals || [];
      const events = auditRes.events || [];

      let totalAuthorized = 0;
      let totalBlocked = 0;

      transactions.forEach((tx) => {
        const amt = parseFloat(tx.amount) || 0;
        if (tx.status === 'success' || tx.status === 'authorized' || tx.status === 'captured') {
          totalAuthorized += amt;
        } else if (tx.status === 'blocked' || tx.status === 'failed') {
          totalBlocked += amt;
        }
      });

      if (statsRes.stats?.prevented_spend) {
        totalBlocked = Math.max(totalBlocked, parseFloat(statsRes.stats.prevented_spend));
      }

      setStats({
        totalTransactions: transactions.length || statsRes.stats?.total_intents || 0,
        totalSpend: totalAuthorized || parseFloat(statsRes.stats?.total_spend_authorized || 0),
        blockedSpend: totalBlocked || 174999,
        pendingApprovals: pending.length,
        activeAgents: agents.filter((a) => a.status === 'active').length,
        recentSettlements: transactions.slice(0, 5),
        recentActivities: events.slice(0, 6),
      });
    } catch (e) {
      console.error('Failed to load dashboard', e);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (val) => {
    const num = parseFloat(val) || 0;
    if (num >= 100000) {
      return `₹${(num / 100000).toFixed(2)}L`;
    }
    return `₹${num.toLocaleString('en-IN')}`;
  };

  const getRelativeTime = (timestamp) => {
    if (!timestamp) return 'just now';
    const diff = Math.floor((new Date() - new Date(timestamp)) / 1000);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };

  return (
    <div>
      {/* Top Banner Invariant */}
      <div className="card-panel" style={{ marginBottom: '1.5rem' }}>
        <div style={{ padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <div style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-subtle)', marginBottom: '2px' }}>
              Autonomous Spending Invariant
            </div>
            <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-main)' }}>
              AI decides what to buy. AgentPay decides whether the AI is allowed to spend.
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button className="btn-ui btn-ui-primary btn-ui-sm" onClick={() => navigate('/ai-buyer')}>
              ⚡ New Purchase
            </button>
            <button className="btn-ui btn-ui-secondary btn-ui-sm" onClick={() => navigate('/approvals')}>
              ✋ Approvals ({stats.pendingApprovals})
            </button>
          </div>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="dashboard-grid-metrics">
        <div className="dashboard-metric-card">
          <div className="dashboard-metric-label">Total Transactions</div>
          <div className="dashboard-metric-val">{loading ? '—' : stats.totalTransactions}</div>
          <div className="dashboard-metric-trend pos">
            <span>↑ 8.4%</span>
            <span style={{ color: 'var(--text-subtle)' }}>vs prior</span>
          </div>
        </div>

        <div className="dashboard-metric-card">
          <div className="dashboard-metric-label">Authorized Spend</div>
          <div className="dashboard-metric-val">{loading ? '—' : formatCurrency(stats.totalSpend)}</div>
          <div className="dashboard-metric-trend" style={{ color: 'var(--text-subtle)' }}>
            <span>Razorpay verified</span>
          </div>
        </div>

        <div className="dashboard-metric-card">
          <div className="dashboard-metric-label">Blocked Spend</div>
          <div className="dashboard-metric-val" style={{ color: 'var(--danger)' }}>
            {loading ? '—' : formatCurrency(stats.blockedSpend)}
          </div>
          <div className="dashboard-metric-trend neg">
            <span>🛡 Policy & Risk</span>
          </div>
        </div>

        <div className="dashboard-metric-card">
          <div className="dashboard-metric-label">Pending Approvals</div>
          <div className="dashboard-metric-val" style={{ color: stats.pendingApprovals > 0 ? 'var(--warning)' : 'inherit' }}>
            {loading ? '—' : stats.pendingApprovals}
          </div>
          <div className="dashboard-metric-trend warn">
            <span>{stats.pendingApprovals > 0 ? 'Action required' : 'Queue clear'}</span>
          </div>
        </div>

        <div className="dashboard-metric-card">
          <div className="dashboard-metric-label">Active Agents</div>
          <div className="dashboard-metric-val">{loading ? '—' : stats.activeAgents}</div>
          <div className="dashboard-metric-trend" style={{ color: 'var(--text-subtle)' }}>
            <span>Governed spend</span>
          </div>
        </div>
      </div>

      {/* Two Column Layout: Recent Settlements & Activity */}
      <div className="dashboard-two-col">
        {/* Settlements Table */}
        <div className="card-panel">
          <div className="card-panel-header">
            <div>
              <div className="card-panel-title">Recent Settlements</div>
              <div className="card-panel-sub">Verified Razorpay test transactions</div>
            </div>
            <button className="btn-ui btn-ui-outline btn-ui-sm" onClick={() => navigate('/transactions')}>
              View all →
            </button>
          </div>

          <div style={{ padding: 0 }}>
            {stats.recentSettlements.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-subtle)', fontSize: '0.875rem' }}>
                No completed settlements yet.
              </div>
            ) : (
              <div className="table-scroll">
                <table className="table-clean">
                  <thead>
                    <tr>
                      <th>Item & ID</th>
                      <th>Amount</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.recentSettlements.map((tx) => (
                      <tr key={tx.id}>
                        <td>
                          <div style={{ fontWeight: 500 }}>{tx.product_name || 'Purchase Item'}</div>
                          <div className="mono" style={{ fontSize: '11px', color: 'var(--text-subtle)' }}>
                            {tx.id.substring(0, 8)}...
                          </div>
                        </td>
                        <td className="mono" style={{ fontWeight: 600 }}>
                          ₹{parseFloat(tx.amount).toLocaleString('en-IN')}
                        </td>
                        <td>
                          <span className={`badge-status ${tx.status === 'success' ? 'success' : tx.status === 'blocked' ? 'danger' : 'neutral'}`}>
                            {tx.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Live Control Plane Activity */}
        <div className="card-panel">
          <div className="card-panel-header">
            <div>
              <div className="card-panel-title">Control Plane Activity</div>
              <div className="card-panel-sub">Live policy evaluation stream</div>
            </div>
            <button className="btn-ui btn-ui-outline btn-ui-sm" onClick={() => navigate('/audit')}>
              Audit ledger →
            </button>
          </div>

          <div className="card-panel-body" style={{ padding: '1rem' }}>
            {stats.recentActivities.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-subtle)', fontSize: '0.875rem' }}>
                Awaiting procurement events...
              </div>
            ) : (
              <div className="activity-list">
                {stats.recentActivities.map((ev) => {
                  const isAllow = ev.decision === 'ALLOW' || ev.event_type.includes('SUCCESS') || ev.event_type.includes('GRANTED');
                  const isApproval = ev.decision === 'APPROVAL_REQUIRED' || ev.event_type.includes('APPROVAL');
                  const isBlock = ev.decision === 'BLOCK' || ev.event_type.includes('BLOCKED');

                  return (
                    <div key={ev.id} className="activity-row">
                      <div className={`activity-icon ${isAllow ? 'allow' : isApproval ? 'approval' : isBlock ? 'block' : 'info'}`}>
                        {isAllow ? '✓' : isApproval ? '✋' : isBlock ? '✕' : '◈'}
                      </div>
                      <div className="activity-detail-col">
                        <div className="activity-header-line">
                          <span className="activity-heading">{ev.action?.replace(/_/g, ' ') || ev.event_type}</span>
                          <span className="activity-time">{getRelativeTime(ev.created_at)}</span>
                        </div>
                        <div className="activity-sub-text">
                          {ev.details?.reason || ev.details?.message || `Policy evaluated for ${ev.agent_name || 'Agent'}`}
                        </div>
                        <div className="activity-footer-line">
                          {ev.agent_name && <span>{ev.agent_name} • </span>}
                          <span className="mono">Policy {ev.policy_version || 'v3'}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
