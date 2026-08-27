import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Icons } from '../components/ui/Icons';
import './Login.css';

export default function Login({ defaultMode = 'login' }) {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const initialRole = (params.get('role') || localStorage.getItem('agentpay_initial_role') || 'BUYER').toUpperCase();

  const [mode, setMode] = useState(defaultMode); // 'login' | 'signup'
  const [selectedRole, setSelectedRole] = useState(initialRole === 'MERCHANT' ? 'MERCHANT' : 'BUYER');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const { login, signup, loginWithGoogle } = useAuth();
  const navigate = useNavigate();

  const isMerchant = selectedRole === 'MERCHANT';

  const handleRoleSelect = (role) => {
    setSelectedRole(role);
    localStorage.setItem('agentpay_initial_role', role);
    setError(null);
  };

  const handleQuickFill = (role) => {
    handleRoleSelect(role);
    if (role === 'MERCHANT') {
      setEmail('merchant@agentpay.com');
      setPassword('merchant123');
    } else {
      setEmail('buyer@agentpay.com');
      setPassword('buyer123');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      if (mode === 'signup') {
        const res = await signup(name || (isMerchant ? 'Merchant Store' : 'AI Buyer'), email, password, selectedRole);
        if (res.user?.role === 'MERCHANT' || isMerchant) {
          navigate('/merchant/dashboard');
        } else {
          navigate('/buyer/onboarding');
        }
      } else {
        const res = await login(email, password);
        if (res.user?.role === 'MERCHANT') {
          navigate('/merchant/dashboard');
        } else {
          navigate('/buyer/home');
        }
      }
    } catch (err) {
      setError(err.message || 'Authentication failed. Please check your credentials.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleAuth = async () => {
    try {
      setSubmitting(true);
      const res = await loginWithGoogle(selectedRole);
      if (res.user?.role === 'MERCHANT') {
        navigate('/merchant/dashboard');
      } else {
        navigate('/buyer/onboarding');
      }
    } catch (err) {
      setError(err.message || 'Google sign-in failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-page-container">
      {/* ===================================================
          LEFT / SHOWCASE HERO PANEL
         =================================================== */}
      <div className="auth-hero-pane">
        <div className="hero-pane-content">
          {/* Logo Badge */}
          <div className="hero-brand-header">
            <div className="hero-logo-icon">AP</div>
            <span className="hero-logo-text">AgentPay</span>
            <span className="hero-track-pill">Track 01 • Agentic Commerce</span>
          </div>

          <div className="hero-headline-block">
            <h1 className="hero-main-title">
              The AI-Native Commerce Infrastructure
            </h1>
            <p className="hero-main-sub">
              Empowering autonomous AI agents to discover, evaluate, and purchase products within deterministic policy gates while giving merchants instant checkout rails.
            </p>
          </div>

          {/* Value Prop Cards */}
          <div className="hero-feature-cards">
            <div className={`hero-feature-card ${!isMerchant ? 'highlighted' : ''}`}>
              <div className="feature-card-icon">🛒</div>
              <div>
                <div className="feature-card-title">Autonomous AI Buyer</div>
                <div className="feature-card-desc">
                  Conversational procurement with budget bounds, multi-store comparison, and zero unauthorized charges.
                </div>
              </div>
            </div>

            <div className={`hero-feature-card ${isMerchant ? 'highlighted' : ''}`}>
              <div className="feature-card-icon">🏪</div>
              <div>
                <div className="feature-card-title">AI Commerce Merchant</div>
                <div className="feature-card-desc">
                  Turn your catalog into AI-readable schemas with live stock sync and Razorpay test rails settlement.
                </div>
              </div>
            </div>

            <div className="hero-feature-card">
              <div className="feature-card-icon">🛡️</div>
              <div>
                <div className="feature-card-title">Deterministic Governance</div>
                <div className="feature-card-desc">
                  10-rule policy hierarchy, 5-factor explainable risk scoring, and microsecond-stamped audit ledger.
                </div>
              </div>
            </div>
          </div>

          {/* Real-time stats footer */}
          <div className="hero-stats-row">
            <div>
              <div className="hero-stat-num">94/100</div>
              <div className="hero-stat-lbl">AI Readiness Score</div>
            </div>
            <div>
              <div className="hero-stat-num">10-Rule</div>
              <div className="hero-stat-lbl">Policy Hierarchy</div>
            </div>
            <div>
              <div className="hero-stat-num">₹0</div>
              <div className="hero-stat-lbl">Surge Tolerance</div>
            </div>
          </div>
        </div>
      </div>

      {/* ===================================================
          RIGHT / FORM CONTAINER
         =================================================== */}
      <div className="auth-form-pane">
        <div className="auth-card-modern">
          {/* Mobile Top Brand Bar (Visible on mobile/tablet) */}
          <div className="auth-mobile-brand">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div className="hero-logo-icon" style={{ width: 28, height: 28, fontSize: '0.75rem' }}>AP</div>
              <span style={{ fontWeight: 800, fontSize: '1.125rem', color: 'var(--text-main)' }}>AgentPay</span>
            </div>
          </div>

          {/* Role Switcher Tabs */}
          <div className="auth-role-tabs-wrapper">
            <div className="auth-role-tabs">
              <button
                type="button"
                className={`auth-role-tab ${!isMerchant ? 'active' : ''}`}
                onClick={() => handleRoleSelect('BUYER')}
              >
                <Icons.ShoppingBag size={15} />
                <span>AI Buyer</span>
              </button>

              <button
                type="button"
                className={`auth-role-tab ${isMerchant ? 'active' : ''}`}
                onClick={() => handleRoleSelect('MERCHANT')}
              >
                <Icons.Store size={15} />
                <span>AI Merchant</span>
              </button>
            </div>
          </div>

          {/* Header Title & Subtext */}
          <div className="auth-title-section">
            <h2 className="auth-title-text">
              {mode === 'signup'
                ? (isMerchant ? 'Create Merchant Account' : 'Create Buyer Account')
                : (isMerchant ? 'Merchant Sign In' : 'Buyer Sign In')}
            </h2>
            <p className="auth-sub-text">
              {isMerchant
                ? 'Manage your AI-readable catalog and track autonomous agent sales.'
                : 'Configure spending limits and delegate shopping to your AI agent.'}
            </p>
          </div>

          {/* Error Message */}
          {error && (
            <div className="auth-error-banner" role="alert">
              <Icons.AlertTriangle size={16} />
              <span>{error}</span>
            </div>
          )}

          {/* Quick 1-Click Demo Fill Bar */}
          <div className="quick-demo-fill-card">
            <div className="quick-demo-fill-header">
              <span style={{ fontWeight: 600 }}>Quick Demo Fill:</span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-subtle)' }}>1-click test credentials</span>
            </div>
            <div className="quick-demo-fill-buttons">
              <button
                type="button"
                className={`quick-fill-btn ${!isMerchant ? 'btn-selected' : ''}`}
                onClick={() => handleQuickFill('BUYER')}
              >
                🛒 Buyer: buyer@agentpay.com
              </button>
              <button
                type="button"
                className={`quick-fill-btn ${isMerchant ? 'btn-selected' : ''}`}
                onClick={() => handleQuickFill('MERCHANT')}
              >
                🏪 Merchant: merchant@agentpay.com
              </button>
            </div>
          </div>

          {/* Google OAuth (Simulated Test Mode) */}
          <button
            type="button"
            className="auth-btn-google"
            onClick={handleGoogleAuth}
            disabled={submitting}
          >
            <Icons.Google size={18} />
            <span>Continue with Google</span>
          </button>

          <div className="auth-divider-line">
            <span>or continue with email</span>
          </div>

          {/* Email / Password Form */}
          <form onSubmit={handleSubmit} className="auth-form-body">
            {mode === 'signup' && (
              <div className="auth-field-group">
                <label className="auth-label">
                  {isMerchant ? 'Store / Business Name' : 'Full Name'}
                </label>
                <div className="auth-input-container">
                  <div className="auth-input-icon">
                    <Icons.User size={16} />
                  </div>
                  <input
                    type="text"
                    required
                    className="auth-input-modern"
                    placeholder={isMerchant ? 'e.g. Acme Tech Electronics' : 'e.g. Alex Kumar'}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
              </div>
            )}

            <div className="auth-field-group">
              <label className="auth-label">Email address</label>
              <div className="auth-input-container">
                <div className="auth-input-icon">
                  <Icons.Mail size={16} />
                </div>
                <input
                  type="email"
                  required
                  className="auth-input-modern"
                  placeholder={isMerchant ? 'merchant@agentpay.com' : 'buyer@agentpay.com'}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>

            <div className="auth-field-group">
              <label className="auth-label">Password</label>
              <div className="auth-input-container">
                <div className="auth-input-icon">
                  <Icons.Lock size={16} />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  className="auth-input-modern"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="auth-password-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                  tabIndex={-1}
                >
                  {showPassword ? <Icons.EyeOff size={16} /> : <Icons.Eye size={16} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              className="auth-btn-submit"
              disabled={submitting}
            >
              {submitting ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                  <Icons.Clock size={16} /> Authenticating...
                </span>
              ) : mode === 'signup' ? (
                isMerchant ? 'Create Merchant Account →' : 'Create Buyer Account →'
              ) : (
                isMerchant ? 'Sign In to Merchant Hub →' : 'Sign In to Buyer Portal →'
              )}
            </button>
          </form>

          {/* Mode Switcher Footer */}
          <div className="auth-card-footer">
            {mode === 'signup' ? (
              <p>
                Already have an account?{' '}
                <button
                  type="button"
                  className="auth-switch-link"
                  onClick={() => {
                    setMode('login');
                    setError(null);
                  }}
                >
                  Sign In
                </button>
              </p>
            ) : (
              <p>
                Don't have an account?{' '}
                <button
                  type="button"
                  className="auth-switch-link"
                  onClick={() => {
                    setMode('signup');
                    setError(null);
                  }}
                >
                  Create an account
                </button>
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
