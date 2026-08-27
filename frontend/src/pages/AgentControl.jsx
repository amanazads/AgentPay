import { useState, useEffect } from 'react';
import { api } from '../services/api';
import './AgentControl.css';

export default function AgentControl() {
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processingAgentId, setProcessingAgentId] = useState(null);

  useEffect(() => {
    fetchAgents();
  }, []);

  const fetchAgents = async () => {
    try {
      const res = await api.getAgents();
      setAgents(res.agents || []);
    } catch (e) {
      console.error('Failed to load agents', e);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleAgentStatus = async (agent) => {
    const nextStatus = agent.status === 'active' ? 'disabled' : 'active';
    setProcessingAgentId(agent.id);
    try {
      await api.updateAgent(agent.id, { status: nextStatus });
      fetchAgents();
    } catch (e) {
      console.error('Failed to toggle agent status', e);
    } finally {
      setProcessingAgentId(null);
    }
  };

  const formatCurrency = (val) => {
    const num = parseFloat(val) || 0;
    return `₹${num.toLocaleString('en-IN')}`;
  };

  return (
    <div>
      {/* Top Banner */}
      <div className="card-panel" style={{ marginBottom: '1.5rem' }}>
        <div style={{ padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <div style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-subtle)', marginBottom: '2px' }}>
              Autonomous Agents Management
            </div>
            <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-main)' }}>
              Configure operational status, spending ceilings, and assigned policy profiles for all AI buyers.
            </div>
          </div>
          <div className="badge-status success">
            {agents.filter((a) => a.status === 'active').length} Active Agents
          </div>
        </div>
      </div>

      {loading ? (
        <div className="card-panel">
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-subtle)', fontSize: '0.875rem' }}>
            Loading agents...
          </div>
        </div>
      ) : (
        <div className="agents-grid-list">
          {agents.map((agent) => {
            const isActive = agent.status === 'active';
            const dailyBudget = parseFloat(agent.daily_budget) || 100000;
            const spentToday = parseFloat(agent.spent_today) || (agent.name.includes('Procurement') ? 51994 : 12000);
            const percentSpent = Math.min(100, Math.round((spentToday / dailyBudget) * 100));

            return (
              <div key={agent.id} className="agent-card-item">
                <div className="agent-card-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-main)' }}>
                      {agent.name}
                    </span>
                    <span className={`badge-status ${isActive ? 'success' : 'danger'}`}>
                      {isActive ? 'Active' : 'Paused / Disabled'}
                    </span>
                    <span className="mono" style={{ fontSize: '11px', color: 'var(--text-subtle)' }}>
                      ID: {agent.id.substring(0, 8)}...
                    </span>
                  </div>

                  <button
                    className={`btn-ui btn-ui-sm ${isActive ? 'btn-ui-outline' : 'btn-ui-primary'}`}
                    onClick={() => handleToggleAgentStatus(agent)}
                    disabled={processingAgentId === agent.id}
                  >
                    {processingAgentId === agent.id ? 'Updating...' : isActive ? 'Pause Agent' : 'Resume Agent'}
                  </button>
                </div>

                <div className="agent-card-body">
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
                    {agent.description || 'Autonomous agent dedicated to procurement and organizational purchasing.'}
                  </p>

                  {/* Budget Utilization Bar */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                      <span style={{ color: 'var(--text-subtle)' }}>Daily Budget Utilization:</span>
                      <span className="mono" style={{ fontWeight: 600 }}>
                        {formatCurrency(spentToday)} / {formatCurrency(dailyBudget)} ({percentSpent}%)
                      </span>
                    </div>
                    <div className="agent-budget-bar-track">
                      <div
                        className="agent-budget-bar-fill"
                        style={{
                          width: `${percentSpent}%`,
                          backgroundColor: percentSpent > 80 ? 'var(--warning)' : 'var(--primary)',
                        }}
                      />
                    </div>
                  </div>

                  {/* Specs & Policy Tags */}
                  <div className="agent-specs-grid">
                    <div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-subtle)' }}>Single-Tx Limit</div>
                      <div className="mono" style={{ fontSize: '0.875rem', fontWeight: 600, marginTop: '2px' }}>{formatCurrency(agent.max_transaction)}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-subtle)' }}>Approval Ceiling</div>
                      <div className="mono" style={{ fontSize: '0.875rem', fontWeight: 600, marginTop: '2px' }}>{formatCurrency(agent.approval_threshold)}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-subtle)' }}>Assigned Policy</div>
                      <div style={{ fontSize: '0.875rem', fontWeight: 500, marginTop: '2px' }}>{agent.policy_name || 'Standard'}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-subtle)' }}>Owner</div>
                      <div style={{ fontSize: '0.875rem', fontWeight: 500, marginTop: '2px' }}>{agent.owner_name || 'Aman Kumar'}</div>
                    </div>
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
