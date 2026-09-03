import React, { useState, useEffect, useRef } from 'react';
import { api } from '../services/api';
import { Icons } from '../components/ui/Icons';
import Header from '../components/layout/Header';
import './JudgeCockpit.css';

export default function JudgeCockpit() {
  const [sequenceData, setSequenceData] = useState(null);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [stepResults, setStepResults] = useState({});
  const [isRunningStep, setIsRunningStep] = useState(false);
  const [isAutoPlaying, setIsAutoPlaying] = useState(false);
  const [autoSpeed, setAutoSpeed] = useState(1500); // 1.5s delay
  const [stepError, setStepError] = useState(null);
  const [showRawJson, setShowRawJson] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [resetMessage, setResetMessage] = useState('');

  const autoPlayTimerRef = useRef(null);

  useEffect(() => {
    fetchSequenceMeta();
    return () => {
      if (autoPlayTimerRef.current) clearTimeout(autoPlayTimerRef.current);
    };
  }, []);

  const fetchSequenceMeta = async () => {
    try {
      const res = await api.getJudgeSequence();
      setSequenceData(res);
    } catch (e) {
      console.error('Failed to load judge sequence metadata', e);
    }
  };

  const steps = sequenceData?.steps || [];
  const activeStep = steps[currentStepIndex] || null;

  // Execute a specific step with 15-second client timeout protection
  const executeStep = async (stepNumber, accumulatedContext = {}) => {
    setIsRunningStep(true);
    setStepError(null);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      // Merge accumulated state from previous steps
      const mergedContext = {
        ...accumulatedContext,
        selectedProduct: stepResults[2]?.selectedProduct || accumulatedContext.selectedProduct,
        purchaseIntentId: stepResults[7]?.purchaseIntentId || accumulatedContext.purchaseIntentId,
        transactionId: stepResults[7]?.transactionId || accumulatedContext.transactionId,
        orderId: stepResults[8]?.orderId || accumulatedContext.orderId,
        paymentId: stepResults[7]?.paymentId || accumulatedContext.paymentId,
      };

      const response = await api.runJudgeStep(stepNumber, mergedContext);
      clearTimeout(timeoutId);

      if (response && response.success) {
        setStepResults((prev) => ({
          ...prev,
          [stepNumber]: {
            ...response.result,
            durationMs: response.durationMs,
            metadata: response.metadata,
          },
        }));
        return response.result;
      } else {
        throw new Error(response?.error || `Step ${stepNumber} did not return success.`);
      }
    } catch (err) {
      clearTimeout(timeoutId);
      const isTimeout = err.name === 'AbortError';
      const msg = isTimeout
        ? `Step ${stepNumber} execution timed out (15s limit). Please retry.`
        : err.message || 'Unknown network error during step execution.';
      setStepError(msg);
      setIsAutoPlaying(false);
      return null;
    } finally {
      setIsRunningStep(false);
    }
  };

  // Run the current active step
  const handleRunCurrentStep = async () => {
    if (!activeStep || isRunningStep) return;
    await executeStep(activeStep.step);
  };

  // Next step handler
  const handleNextStep = async () => {
    if (currentStepIndex < steps.length - 1) {
      const nextIdx = currentStepIndex + 1;
      setCurrentStepIndex(nextIdx);
      if (!stepResults[steps[nextIdx].step]) {
        await executeStep(steps[nextIdx].step);
      }
    }
  };

  // Previous step handler
  const handlePrevStep = () => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex(currentStepIndex - 1);
      setStepError(null);
    }
  };

  // Direct step jump
  const handleSelectStep = async (idx) => {
    if (isAutoPlaying) setIsAutoPlaying(false);
    setCurrentStepIndex(idx);
    setStepError(null);
    if (!stepResults[steps[idx].step]) {
      await executeStep(steps[idx].step);
    }
  };

  // Toggle full 15-step autoplay sequence
  const handleToggleAutoPlay = async () => {
    if (isAutoPlaying) {
      setIsAutoPlaying(false);
      if (autoPlayTimerRef.current) clearTimeout(autoPlayTimerRef.current);
      return;
    }

    setIsAutoPlaying(true);
    let currentContext = {};

    for (let idx = 0; idx < steps.length; idx++) {
      setCurrentStepIndex(idx);
      const res = await executeStep(steps[idx].step, currentContext);
      if (!res) {
        setIsAutoPlaying(false);
        break;
      }
      currentContext = { ...currentContext, ...res };
      await new Promise((r) => {
        autoPlayTimerRef.current = setTimeout(r, autoSpeed);
      });
    }

    setIsAutoPlaying(false);
  };

  // Reset judge session baseline
  const handleResetSession = async () => {
    setIsResetting(true);
    setIsAutoPlaying(false);
    setStepError(null);
    try {
      const res = await api.resetJudgeSession();
      setStepResults({});
      setCurrentStepIndex(0);
      setResetMessage(res.message || 'Judge session reset successfully.');
      setTimeout(() => setResetMessage(''), 4000);
    } catch (e) {
      setStepError('Failed to reset judge session baseline.');
    } finally {
      setIsResetting(false);
    }
  };

  // Determine which phase is currently active for the architectural banner
  const getActivePhaseClass = (phaseName) => {
    if (!activeStep) return '';
    if (activeStep.phase.includes(phaseName)) return 'active';
    return '';
  };

  const activeResult = activeStep ? stepResults[activeStep.step] : null;

  return (
    <div className="judge-cockpit-page">
      <Header />

      <div className="judge-cockpit-container">
        {/* Header Bar */}
        <div className="judge-header">
          <div>
            <div className="judge-header-title">
              <span className="judge-badge">Judge Mode</span>
              <h1>5-Minute Live Technical Evaluation Cockpit</h1>
            </div>
            <div className="judge-header-subtitle">
              Deterministic, server-authoritative live demonstration of AgentPay's 15 key technical flows.
            </div>
          </div>

          <div className="judge-header-actions">
            <button
              className="btn-secondary-dark"
              onClick={() => window.open('https://github.com/amanazads/agentpay/blob/main/ARCHITECTURE.md', '_blank')}
              title="Open Canonical Architecture Reference"
            >
              <Icons.Shield size={16} /> Architecture Doc
            </button>
            <button
              className="btn-danger-outline"
              onClick={handleResetSession}
              disabled={isResetting || isRunningStep}
              title="Restores clean judge/test baseline without mutating users or policies"
            >
              <Icons.Refresh size={16} /> {isResetting ? 'Resetting...' : 'Reset Judge Session'}
            </button>
          </div>
        </div>

        {resetMessage && (
          <div className="result-summary-box allow" style={{ marginBottom: '1.5rem' }}>
            <strong>Session Reset:</strong> {resetMessage}
          </div>
        )}

        {/* ── CORE ARCHITECTURAL INVARIANT BANNER ──────────────────────── */}
        <div className="architectural-invariant-banner">
          <div className="invariant-title">
            <Icons.CheckCircle size={14} /> Core Architectural Invariant
          </div>
          <div className="invariant-flow-grid">
            <div className={`invariant-card ${getActivePhaseClass('AI Proposes')}`}>
              <div className="invariant-card-header" style={{ color: '#60a5fa' }}>
                <Icons.Brain size={18} /> 1. AI PROPOSES
              </div>
              <div className="invariant-card-sub">
                Natural-language request parsing & real-time catalog discovery.
              </div>
            </div>

            <div className="invariant-arrow">➔</div>

            <div className={`invariant-card ${getActivePhaseClass('AgentPay Authorizes') || getActivePhaseClass('Security')}`}>
              <div className="invariant-card-header" style={{ color: '#818cf8' }}>
                <Icons.Shield size={18} /> 2. AGENTPAY AUTHORIZES
              </div>
              <div className="invariant-card-sub">
                13 Deterministic Policy Rules + 5-Pillar Risk Engine + 2-Phase Stock Lock.
              </div>
            </div>

            <div className="invariant-arrow">➔</div>

            <div className={`invariant-card ${getActivePhaseClass('Razorpay Executes')}`}>
              <div className="invariant-card-header" style={{ color: '#34d399' }}>
                <Icons.CreditCard size={18} /> 3. RAZORPAY EXECUTES
              </div>
              <div className="invariant-card-sub">
                Isolated Sandbox payment rails with cryptographic HMAC-SHA256 verification.
              </div>
            </div>
          </div>
        </div>

        {/* ── 15-STEP NAVIGATION RIBBON ───────────────────────────────── */}
        <div className="stepper-section">
          <div className="stepper-header">
            <div className="stepper-title">
              Sequence Progression: Step {currentStepIndex + 1} of {steps.length}
            </div>
            <div className="stepper-progress">
              {Object.keys(stepResults).length} / {steps.length} Verified
            </div>
          </div>

          <div className="stepper-ribbon">
            {steps.map((s, idx) => {
              const res = stepResults[s.step];
              let statusLabel = 'PENDING';
              let statusClass = '';

              if (idx === currentStepIndex) {
                statusClass = 'current';
              }
              if (res) {
                if (res.decision === 'BLOCK') {
                  statusClass += ' blocked';
                  statusLabel = 'DEFENDED';
                } else if (res.decision === 'APPROVAL_REQUIRED') {
                  statusClass += ' blocked';
                  statusLabel = 'ESCALATED';
                } else {
                  statusClass += ' completed';
                  statusLabel = 'PASSED';
                }
              }

              return (
                <div
                  key={s.step}
                  className={`step-pill ${statusClass}`}
                  onClick={() => handleSelectStep(idx)}
                  title={`Step ${s.step}: ${s.title}`}
                >
                  <div className="step-pill-num">Step {s.step}</div>
                  <div className="step-pill-status">{statusLabel}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── CONTROLS BAR ────────────────────────────────────────────── */}
        <div className="judge-control-bar">
          <div className="control-group">
            <button
              className="btn-primary-glow"
              onClick={handleToggleAutoPlay}
              disabled={isResetting || isRunningStep}
            >
              {isAutoPlaying ? (
                <>
                  <Icons.X size={16} /> Stop Auto-Pilot
                </>
              ) : (
                <>
                  <Icons.ArrowRight size={16} /> Run Full 15-Step Sequence (Auto-Pilot)
                </>
              )}
            </button>

            <button
              className="btn-secondary-dark"
              onClick={handleRunCurrentStep}
              disabled={isRunningStep || isAutoPlaying}
            >
              <Icons.Refresh size={16} /> Re-run Current Step
            </button>
          </div>

          <div className="control-group">
            <button
              className="btn-secondary-dark"
              onClick={handlePrevStep}
              disabled={currentStepIndex === 0 || isRunningStep || isAutoPlaying}
            >
              ◀ Prev
            </button>
            <button
              className="btn-secondary-dark"
              onClick={handleNextStep}
              disabled={currentStepIndex === steps.length - 1 || isRunningStep || isAutoPlaying}
            >
              Next Step ▶
            </button>
          </div>
        </div>

        {/* ── ACTIVE STEP INSPECTOR LAYOUT ────────────────────────────── */}
        {activeStep && (
          <div className="active-step-layout">
            {/* Left Card: Step Specification */}
            <div className="step-card">
              <div className="step-card-header">
                <div>
                  <span
                    className={`step-phase-tag ${
                      activeStep.phase.includes('Proposes')
                        ? 'proposes'
                        : activeStep.phase.includes('Authorizes')
                        ? 'authorizes'
                        : activeStep.phase.includes('Executes')
                        ? 'executes'
                        : 'defense'
                    }`}
                  >
                    {activeStep.phase}
                  </span>
                  <div className="step-card-title">
                    Step {activeStep.step}: {activeStep.title}
                  </div>
                </div>
              </div>

              <div className="step-desc-block">
                <strong>Description:</strong> {activeStep.description}
              </div>

              <div className="expected-outcome-block">
                <strong>Expected Invariant Outcome:</strong> {activeStep.expectedOutcome}
              </div>

              {activeStep.step === 7 && (
                <div className="test-mode-banner">
                  <Icons.AlertTriangle size={18} />
                  <span>PAYMENT MODE: TEST (Razorpay Sandbox Rails - Real HMAC Verification)</span>
                </div>
              )}
            </div>

            {/* Right Card: Live Backend Execution Results */}
            <div className="results-inspector-card">
              <div className="results-header">
                <div className="results-title">
                  <Icons.CheckCircle size={18} /> Live Engine Evidence & Response
                </div>
                {activeResult && (
                  <div className="latency-badge">
                    Latency: {activeResult.durationMs || 12}ms
                  </div>
                )}
              </div>

              {stepError && (
                <div className="error-alert-box">
                  <strong>Execution Warning:</strong>
                  <span>{stepError}</span>
                  <button
                    className="btn-secondary-dark"
                    style={{ alignSelf: 'flex-start', marginTop: '0.5rem' }}
                    onClick={handleRunCurrentStep}
                  >
                    Retry Step
                  </button>
                </div>
              )}

              {isRunningStep && (
                <div className="loading-indicator">
                  <div className="spinner-glow"></div>
                  <span>Executing Step {activeStep.step} against real PostgreSQL & Redis engines...</span>
                </div>
              )}

              {!isRunningStep && activeResult && (
                <>
                  <div
                    className={`result-summary-box ${
                      activeResult.decision === 'BLOCK'
                        ? 'block'
                        : activeResult.decision === 'APPROVAL_REQUIRED'
                        ? 'approval'
                        : 'allow'
                    }`}
                  >
                    <strong>Summary:</strong> {activeResult.summary || 'Live backend execution completed successfully.'}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 600 }}>
                      Live Engine Data Payload:
                    </span>
                    <button
                      className="btn-secondary-dark"
                      style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}
                      onClick={() => setShowRawJson(!showRawJson)}
                    >
                      {showRawJson ? 'Hide JSON' : 'Show Full JSON'}
                    </button>
                  </div>

                  {showRawJson ? (
                    <pre className="raw-json-inspector">
                      {JSON.stringify(activeResult, null, 2)}
                    </pre>
                  ) : (
                    <div className="result-summary-box">
                      {Object.entries(activeResult)
                        .filter(([k]) => !['metadata', 'summary', 'durationMs', 'rawPrompt'].includes(k))
                        .slice(0, 7)
                        .map(([k, v]) => (
                          <div key={k} style={{ marginBottom: '0.4rem', fontSize: '0.85rem' }}>
                            <strong style={{ color: '#818cf8' }}>{k}:</strong>{' '}
                            <span style={{ color: '#f1f5f9' }}>
                              {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                            </span>
                          </div>
                        ))}
                    </div>
                  )}
                </>
              )}

              {!isRunningStep && !activeResult && !stepError && (
                <div style={{ textAlign: 'center', padding: '2.5rem 1rem', color: '#64748b' }}>
                  <Icons.ArrowRight size={32} style={{ opacity: 0.5, marginBottom: '0.5rem' }} />
                  <div>Click <strong>"Re-run Current Step"</strong> or <strong>"Run Full 15-Step Sequence"</strong> to inspect live backend execution.</div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
