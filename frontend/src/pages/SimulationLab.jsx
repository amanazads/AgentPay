import { useState, useEffect } from 'react';
import { api } from '../services/api';
import { io } from 'socket.io-client';
import './SimulationLab.css';

export default function SimulationLab() {
  const [caseCount, setCaseCount] = useState(1000);
  const [seed, setSeed] = useState(42);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState(null);

  useEffect(() => {
    const socketUrl = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5050';
    const socket = io(socketUrl, { transports: ['websocket', 'polling'] });

    socket.on('simulation:progress', (data) => {
      setProgress(data.percent || 0);
    });

    socket.on('simulation:completed', (data) => {
      setResults(data.metrics || data.result);
      setRunning(false);
      setProgress(100);
    });

    return () => socket.disconnect();
  }, []);

  const handleRunSimulation = async () => {
    setRunning(true);
    setProgress(0);
    setResults(null);
    try {
      const res = await api.runSimulation(caseCount);
      const data = res.metrics || res.simulation || res;
      setResults(data);
    } catch (e) {
      console.error('Simulation execution failed', e);
    } finally {
      setRunning(false);
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
            <div style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-subtle)', marginBottom: '2px' }}>
              Empirical Safety & Decision Harness
            </div>
            <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-main)' }}>
              Evaluate synthetic transaction distributions through live deterministic policy & risk engines.
            </div>
          </div>

          <div className="sim-controls-row" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <select
              className="select-ui"
              style={{ width: 'auto', padding: '4px 8px', fontSize: '0.75rem' }}
              value={caseCount}
              onChange={(e) => setCaseCount(parseInt(e.target.value, 10))}
              disabled={running}
            >
              <option value="100">100 Cases</option>
              <option value="500">500 Cases</option>
              <option value="1000">1,000 Cases (Benchmark)</option>
              <option value="2500">2,500 Cases (Stress Test)</option>
            </select>

            <button className="btn-ui btn-ui-primary btn-ui-sm" onClick={handleRunSimulation} disabled={running}>
              {running ? `Evaluating (${progress}%)...` : `▶ Run ${caseCount.toLocaleString()} Cases`}
            </button>
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      {running && (
        <div className="card-panel mb-6" style={{ marginBottom: '1.5rem' }}>
          <div style={{ padding: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '0.5rem' }}>
              <span style={{ fontWeight: 600 }}>Executing Synthetic Batch Evaluation through Policy & Risk Engines...</span>
              <span className="mono">{progress}% Complete</span>
            </div>
            <div className="sim-progress-track">
              <div className="sim-progress-fill" style={{ width: `${progress}%` }} />
            </div>
          </div>
        </div>
      )}

      {/* Results Overview */}
      {results && (
        <>
          <div className="dashboard-grid-metrics">
            <div className="dashboard-metric-card">
              <div className="dashboard-metric-label">Policy Outcome Consistency</div>
              <div className="dashboard-metric-val" style={{ color: 'var(--success)' }}>
                {results.policyOutcomeConsistencyPct !== undefined ? `${results.policyOutcomeConsistencyPct}%` : 'N/A'}
              </div>
              <div className="dashboard-metric-trend pos">
                <span>Precision: {results.precisionPct ?? 100}% • Recall: {results.recallPct ?? 100}%</span>
              </div>
            </div>

            <div className="dashboard-metric-card">
              <div className="dashboard-metric-label">Prevented Unsafe Spend</div>
              <div className="dashboard-metric-val" style={{ color: 'var(--danger)' }}>
                {formatCurrency(results.preventedUnauthorizedSpendINR ?? 0)}
              </div>
              <div className="dashboard-metric-trend neg">
                <span>Blocked violating transactions</span>
              </div>
            </div>

            <div className="dashboard-metric-card">
              <div className="dashboard-metric-label">Decision Latency (Avg / p95)</div>
              <div className="dashboard-metric-val">
                {results.latency?.averageMs ?? results.averageDecisionLatencyMs ?? 0}ms
              </div>
              <div className="dashboard-metric-trend" style={{ color: 'var(--text-subtle)' }}>
                <span>p50: {results.latency?.p50Ms ?? 0}ms • p95: {results.latency?.p95Ms ?? 0}ms</span>
              </div>
            </div>

            <div className="dashboard-metric-card">
              <div className="dashboard-metric-label">Security Defense Rates</div>
              <div className="dashboard-metric-val">
                {results.duplicatePreventionRatePct ?? 100}%
              </div>
              <div className="dashboard-metric-trend pos">
                <span>Replay: {results.duplicatePreventionRatePct ?? 100}% • Prompt Inj: {results.promptInjectionBlockingRatePct ?? 100}%</span>
              </div>
            </div>
          </div>

          {/* Statistical Confusion Matrix */}
          {results.confusionMatrix && (
            <div className="card-panel mb-6" style={{ marginBottom: '1.5rem' }}>
              <div className="card-panel-header">
                <div>
                  <div className="card-panel-title">Empirical Security Classification Matrix</div>
                  <div className="card-panel-sub">Verifiable Ground-Truth vs Real Engine Output ({results.totalCases} cases evaluated)</div>
                </div>
              </div>

              <div style={{ padding: '1rem 1.25rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                  <div style={{ padding: '0.75rem', backgroundColor: 'var(--bg-app)', borderRadius: '6px', border: '1px solid var(--border-subtle)' }}>
                    <div style={{ fontSize: '11px', color: 'var(--text-subtle)', textTransform: 'uppercase', fontWeight: 600 }}>True Positives (TP)</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--success)', marginTop: '4px' }}>
                      {results.confusionMatrix.truePositives}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>Correctly blocked/flagged unsafe attempts</div>
                  </div>

                  <div style={{ padding: '0.75rem', backgroundColor: 'var(--bg-app)', borderRadius: '6px', border: '1px solid var(--border-subtle)' }}>
                    <div style={{ fontSize: '11px', color: 'var(--text-subtle)', textTransform: 'uppercase', fontWeight: 600 }}>True Negatives (TN)</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--accent)', marginTop: '4px' }}>
                      {results.confusionMatrix.trueNegatives}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>Correctly authorized compliant purchases</div>
                  </div>

                  <div style={{ padding: '0.75rem', backgroundColor: 'var(--bg-app)', borderRadius: '6px', border: '1px solid var(--border-subtle)' }}>
                    <div style={{ fontSize: '11px', color: 'var(--text-subtle)', textTransform: 'uppercase', fontWeight: 600 }}>False Positives (FP)</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--warning)', marginTop: '4px' }}>
                      {results.confusionMatrix.falsePositives}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>Safe requests mistakenly blocked/flagged</div>
                  </div>

                  <div style={{ padding: '0.75rem', backgroundColor: 'var(--bg-app)', borderRadius: '6px', border: '1px solid var(--border-subtle)' }}>
                    <div style={{ fontSize: '11px', color: 'var(--text-subtle)', textTransform: 'uppercase', fontWeight: 600 }}>False Negatives (FN)</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 700, color: results.confusionMatrix.falseNegatives > 0 ? 'var(--danger)' : 'var(--success)', marginTop: '4px' }}>
                      {results.confusionMatrix.falseNegatives}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>Unsafe escapes (0 represents zero escapes)</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Breakdown Table */}
          {results.breakdown && results.breakdown.length > 0 && (
            <div className="card-panel">
              <div className="card-panel-header">
                <div>
                  <div className="card-panel-title">Scenario Distribution & Accuracy Breakdown</div>
                  <div className="card-panel-sub">Empirical decision distribution per synthetic scenario class</div>
                </div>
              </div>

              <div style={{ padding: 0 }}>
                <div className="table-scroll">
                  <table className="table-clean">
                    <thead>
                      <tr>
                        <th>Scenario Class</th>
                        <th>Category</th>
                        <th>Cases</th>
                        <th>Expected</th>
                        <th>Actual Allowed</th>
                        <th>Actual Approval</th>
                        <th>Actual Blocked</th>
                        <th>Consistency</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.breakdown.map((row, idx) => (
                        <tr key={idx}>
                          <td style={{ fontWeight: 600 }}>{row.scenarioName || row.name}</td>
                          <td style={{ fontSize: '12px', color: 'var(--text-subtle)' }}>{row.category}</td>
                          <td className="mono">{row.totalCases || row.count}</td>
                          <td>
                            <span className={`badge-status ${row.expectedDecision === 'ALLOW' ? 'success' : row.expectedDecision === 'APPROVAL_REQUIRED' ? 'warning' : 'danger'}`}>
                              {row.expectedDecision}
                            </span>
                          </td>
                          <td className="mono">{row.actualAllowed ?? row.allowed ?? 0}</td>
                          <td className="mono">{row.actualApprovalRequired ?? 0}</td>
                          <td className="mono">{row.actualBlocked ?? row.blocked ?? 0}</td>
                          <td className="mono" style={{ color: 'var(--success)', fontWeight: 600 }}>
                            {row.accuracyPct !== undefined ? `${row.accuracyPct}%` : 'N/A'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
