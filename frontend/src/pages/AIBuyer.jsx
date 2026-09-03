import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import ReviewPurchaseModal from '../components/ReviewPurchaseModal';
import './AIBuyer.css';

export default function AIBuyer() {
  const navigate = useNavigate();
  const [agents, setAgents] = useState([]);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [messages, setMessages] = useState([
    {
      id: 'welcome',
      sender: 'agent',
      text: "Hello. I'm your autonomous procurement assistant. Tell me what equipment, licenses, or supplies you need. I'll discover matching products and submit a structured purchase intent to the AgentPay control plane for deterministic policy evaluation.",
      timestamp: new Date(),
    },
  ]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [reviewModalData, setReviewModalData] = useState({ isOpen: false, intent: null, evaluation: null });

  const messagesEndRef = useRef(null);

  useEffect(() => {
    fetchAgents();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const fetchAgents = async () => {
    try {
      const res = await api.getAgents();
      if (res && res.agents && res.agents.length > 0) {
        setAgents(res.agents);
        const proc = res.agents.find((a) => a.name.includes('Procurement')) || res.agents[0];
        setSelectedAgent(proc);
      }
    } catch (e) {
      console.error('Failed to load agents', e);
    }
  };

  const handleSendMessage = async (textToSend) => {
    const query = typeof textToSend === 'string' && textToSend.trim() ? textToSend.trim() : inputText.trim();
    if (!query || loading) return;

    const userMessageId = `user_${Date.now()}`;
    const newMessages = [
      ...messages,
      { id: userMessageId, sender: 'user', text: query, timestamp: new Date() },
    ];
    setMessages(newMessages);
    setInputText('');
    setLoading(true);

    try {
      const chatRes = await api.sendChatMessage({
        message: query,
        agent_id: selectedAgent?.id,
      });

      const agentMessageId = `agent_${Date.now()}`;
      setMessages([
        ...newMessages,
        {
          id: agentMessageId,
          sender: 'agent',
          text: chatRes.reply,
          recommendation: chatRes.recommendation,
          proposedAction: chatRes.proposed_action,
          authStatus: chatRes.authorization_status,
          purchaseIntent: chatRes.purchase_intent,
          evaluation: chatRes.evaluation,
          order: chatRes.order,
          invoice: chatRes.invoice,
          executionStatus: chatRes.execution_status,
          timestamp: new Date(),
        },
      ]);
    } catch (e) {
      setMessages([
        ...newMessages,
        {
          id: `error_${Date.now()}`,
          sender: 'agent',
          text: `Unable to process request: ${e.message || 'Network error'}. Please verify backend status.`,
          timestamp: new Date(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (val) => {
    const num = parseFloat(val) || 0;
    return `₹${num.toLocaleString('en-IN')}`;
  };

  const quickPrompts = [
    'Find a 4K monitor under ₹40,000 for our design team',
    'Find me a laptop for software development under ₹80,000 with 16GB RAM',
    'Purchase MacBook Air M3 for ₹1,14,900',
    'Order 5 ergonomic office chairs under ₹15,000 each',
  ];

  return (
    <div>
      {/* Policy Selector Banner */}
      <div className="card-panel" style={{ marginBottom: '1rem' }}>
        <div style={{ padding: '0.75rem 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Active Agent:
            </span>
            <select
              className="select-ui"
              style={{ width: 'auto', padding: '3px 8px', fontSize: '0.75rem', fontWeight: 600 }}
              value={selectedAgent?.id || ''}
              onChange={(e) => {
                const found = agents.find((a) => a.id === e.target.value);
                setSelectedAgent(found);
              }}
            >
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.policy_name || 'Standard'})
                </option>
              ))}
            </select>
          </div>

          {selectedAgent && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', fontSize: '0.75rem', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
              <span>Single-Tx Limit: <strong>{formatCurrency(selectedAgent.max_transaction)}</strong></span>
              <span>Approval Ceiling: <strong>{formatCurrency(selectedAgent.approval_threshold)}</strong></span>
              <span>Daily Budget: <strong>{formatCurrency(selectedAgent.daily_budget)}</strong></span>
            </div>
          )}
        </div>
      </div>

      {/* Chat Container Card */}
      <div className="chat-container-card">
        <div className="chat-message-list">
          {messages.map((m) => (
            <div key={m.id} className={`chat-bubble-unit ${m.sender}`}>
              <div className="bubble-text-box">
                <div style={{ whiteSpace: 'pre-line' }}>{m.text}</div>

                {/* Structured Recommendation & Decision Box */}
                {m.recommendation && (
                  <div className="chat-recommend-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px', marginBottom: '0.25rem' }}>
                      <div>
                        <div style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-main)' }}>
                          {m.recommendation.name}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-subtle)' }}>
                          Merchant: <strong>{m.recommendation.merchant_name}</strong> (Verified)
                        </div>
                      </div>
                      <div className="mono" style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-main)' }}>
                        {formatCurrency(m.recommendation.price)}
                      </div>
                    </div>

                    {/* Specs */}
                    {m.recommendation.specifications && Object.keys(m.recommendation.specifications).length > 0 && (
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', margin: '0.25rem 0' }}>
                        {Object.entries(m.recommendation.specifications).map(([k, v]) => (
                          <span key={k} className="badge-tag">
                            {k}: {String(v)}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* AgentPay Deterministic Decision Box */}
                    <div className="chat-decision-box">
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                        <span style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-subtle)' }}>
                          AgentPay Control Plane Decision
                        </span>
                        {m.evaluation?.decision && (
                          <span className={`badge-status ${m.evaluation.decision === 'ALLOW' ? 'success' : m.evaluation.decision === 'APPROVAL_REQUIRED' ? 'warning' : 'danger'}`}>
                            {m.evaluation.decision === 'ALLOW' ? '✓ ALLOWED' : m.evaluation.decision === 'APPROVAL_REQUIRED' ? '✋ APPROVAL REQUIRED' : '✕ BLOCKED'}
                          </span>
                        )}
                      </div>

                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                        {m.evaluation?.reason || m.authStatus?.explanation || 'Evaluated against active policy constraints.'}
                      </div>

                      {m.evaluation?.risk && (
                        <div style={{ fontSize: '11px', color: 'var(--text-subtle)', marginTop: '4px' }}>
                          Risk Level: <strong>{m.evaluation.risk.level}</strong> ({m.evaluation.risk.score}/100)
                        </div>
                      )}
                    </div>

                    {/* Action Button */}
                    <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                      {m.evaluation?.decision === 'ALLOW' && (
                        m.order && m.order.order_number ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <span style={{ fontSize: '0.75rem', color: 'var(--success)', fontWeight: 600 }}>
                              ✓ Confirmed Order: {m.order.order_number}
                            </span>
                            <button
                              className="btn-ui btn-ui-secondary btn-ui-sm"
                              onClick={() => navigate('/purchases')}
                            >
                              View in Purchases Ledger →
                            </button>
                          </div>
                        ) : (
                          <button
                            className="btn-ui btn-ui-primary btn-ui-sm"
                            onClick={() =>
                              setReviewModalData({
                                isOpen: true,
                                intent: m.purchaseIntent || {
                                  id: m.intentId || m.purchaseIntentId || `pi_${Date.now()}`,
                                  product_name: m.recommendation.name,
                                  amount: m.recommendation.price,
                                  merchant_name: m.recommendation.merchant_name,
                                  agent_name: selectedAgent?.name,
                                },
                                evaluation: m.evaluation,
                              })
                            }
                          >
                            Review & Authorize Purchase →
                          </button>
                        )
                      )}

                      {m.evaluation?.decision === 'APPROVAL_REQUIRED' && (
                        <button className="btn-ui btn-ui-secondary btn-ui-sm" onClick={() => navigate('/approvals')}>
                          ✋ Open in Approval Center →
                        </button>
                      )}

                      {m.evaluation?.decision === 'BLOCK' && (
                        <span style={{ fontSize: '0.75rem', color: 'var(--danger)', fontWeight: 500, alignSelf: 'center' }}>
                          Transaction prohibited by policy rules.
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="chat-bubble-unit agent">
              <div className="bubble-text-box" style={{ color: 'var(--text-subtle)', fontSize: '0.75rem' }}>
                Discovering catalog products & evaluating spending policy rules...
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Composer Bar */}
        <div className="chat-footer-composer">
          <div className="quick-chips-row">
            {quickPrompts.map((p) => (
              <button key={p} className="quick-chip" onClick={() => handleSendMessage(p)}>
                {p}
              </button>
            ))}
          </div>

          <div className="input-send-row">
            <input
              type="text"
              className="input-ui"
              placeholder="E.g., Find me a development laptop under ₹80,000..."
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
              disabled={loading}
            />
            <button className="btn-ui btn-ui-primary" onClick={() => handleSendMessage()} disabled={loading || !inputText.trim()}>
              Send
            </button>
          </div>
        </div>
      </div>

      {/* Review Purchase Modal */}
      <ReviewPurchaseModal
        isOpen={reviewModalData.isOpen}
        onClose={() => setReviewModalData({ isOpen: false, intent: null, evaluation: null })}
        intent={reviewModalData.intent}
        evaluation={reviewModalData.evaluation}
      />
    </div>
  );
}
