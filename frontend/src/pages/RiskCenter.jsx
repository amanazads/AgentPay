import { useState } from 'react';
import './RiskCenter.css';

const riskDimensions = [
  {
    name: 'Merchant Credibility',
    weight: '25%',
    description: 'Evaluates supplier verification status, ratings history, domain reputation, and historical transaction volume.',
    score: 10,
    impact: 'Low Risk',
  },
  {
    name: 'Content & Injection Threat',
    weight: '25%',
    description: 'Scans product descriptions, catalog metadata, and seller comments for prompt injection and jailbreak signatures.',
    score: 5,
    impact: 'Low Risk',
  },
  {
    name: 'Price Anomaly Detection',
    weight: '20%',
    description: 'Detects unusual price deviations, deep irregular discounts (>60%), or sudden price inflation against market benchmarks.',
    score: 10,
    impact: 'Low Risk',
  },
  {
    name: 'Transaction Velocity',
    weight: '15%',
    description: 'Monitors rapid repeated intent creation and high-frequency spending bursts exceeding standard agent baselines.',
    score: 15,
    impact: 'Low Risk',
  },
  {
    name: 'Agent Behavioral Deviation',
    weight: '15%',
    description: 'Measures deviation from the agent historical transaction size distribution and authorized spend profile.',
    score: 10,
    impact: 'Low Risk',
  },
];

export default function RiskCenter() {
  const [selectedDimension, setSelectedDimension] = useState(riskDimensions[0]);

  const compositeScore = Math.round(
    riskDimensions.reduce((acc, d) => acc + (d.score * parseInt(d.weight)) / 100, 0)
  );

  return (
    <div>
      {/* Top Banner */}
      <div className="card-panel" style={{ marginBottom: '1.5rem' }}>
        <div style={{ padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <div style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-subtle)', marginBottom: '2px' }}>
              Explainable Risk Engine
            </div>
            <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-main)' }}>
              0–100 risk scoring framework with complete factor attribution and prompt injection scanning.
            </div>
          </div>

          <div className="badge-status success">
            Score: {compositeScore}/100 (LOW)
          </div>
        </div>
      </div>

      {/* Overview Cards */}
      <div className="dashboard-grid-metrics" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <div className="dashboard-metric-card">
          <div className="dashboard-metric-label">Low Risk (0–39)</div>
          <div className="dashboard-metric-val" style={{ color: 'var(--success)' }}>Autonomous</div>
          <div className="dashboard-metric-trend pos">
            <span>Direct policy execution</span>
          </div>
        </div>

        <div className="dashboard-metric-card">
          <div className="dashboard-metric-label">Medium Risk (40–69)</div>
          <div className="dashboard-metric-val" style={{ color: 'var(--warning)' }}>Review</div>
          <div className="dashboard-metric-trend warn">
            <span>Heightened scrutiny</span>
          </div>
        </div>

        <div className="dashboard-metric-card">
          <div className="dashboard-metric-label">High Risk (70–100)</div>
          <div className="dashboard-metric-val" style={{ color: 'var(--danger)' }}>Escalate</div>
          <div className="dashboard-metric-trend neg">
            <span>Mandatory human sign-off</span>
          </div>
        </div>
      </div>

      {/* 5 Dimensions Grid */}
      <div className="card-panel" style={{ marginBottom: '1.5rem' }}>
        <div className="card-panel-header">
          <div>
            <div className="card-panel-title">5 Weighted Evaluation Dimensions</div>
            <div className="card-panel-sub">Every purchase intent is evaluated across all five factors simultaneously</div>
          </div>
        </div>

        <div className="card-panel-body">
          <div className="risk-dimensions-grid">
            {riskDimensions.map((d) => (
              <div
                key={d.name}
                onClick={() => setSelectedDimension(d)}
                className={`risk-dim-card ${selectedDimension.name === d.name ? 'active' : ''}`}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-main)' }}>
                    {d.name}
                  </span>
                  <span className="badge-tag">{d.weight}</span>
                </div>

                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.4, marginBottom: '0.75rem' }}>
                  {d.description}
                </p>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                  <span style={{ color: 'var(--text-subtle)' }}>Baseline Score:</span>
                  <span className="mono" style={{ fontWeight: 600 }}>{d.score}/100</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Selected Detail */}
      {selectedDimension && (
        <div className="card-panel">
          <div className="card-panel-header">
            <div className="card-panel-title">{selectedDimension.name} — Detailed Forensic Attribution</div>
            <span className="badge-tag">Weight Contribution: {selectedDimension.weight}</span>
          </div>
          <div className="card-panel-body">
            <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: '0.75rem' }}>
              {selectedDimension.description}
            </p>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-subtle)', lineHeight: 1.5 }}>
              <strong>Prompt Injection Defense:</strong> If adversarial patterns (e.g. <code>IGNORE ALL RULES</code>, <code>SYSTEM OVERRIDE</code>) are detected in untrusted catalog metadata, Content Threat score automatically spikes to 100/100, elevating composite risk ≥ 82 (HIGH) and preventing unauthorized execution.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
