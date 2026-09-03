import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Icons } from '../components/ui/Icons';
import './Login.css';

export default function Login({ defaultMode = 'login' }) {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const initialRoleParam = params.get('role');
  const storedRole = localStorage.getItem('agentpay_initial_role');
  const initialRole = (initialRoleParam || storedRole || 'BUYER').toUpperCase();

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

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      if (mode === 'signup') {
        const res = await signup(
          name || (isMerchant ? 'Merchant Store' : 'AI Buyer'),
          email,
          password,
          selectedRole
        );
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
      setError(err.message || 'Authentication failed. Please verify credentials.');
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
      {/* =========================================================================
          LEFT / INFRASTRUCTURE SHOWCASE PANE
         ========================================================================= */}
      <div className="auth-hero-pane">
        <div className="hero-pane-content">
          {/* Brand Header */}
          <div className="hero-brand-header">
            <div className="hero-logo-icon">AP</div>
            <span className="hero-logo-text">AgentPay</span>
          </div>

          {/* Core Positioning */}
          <div className="hero-headline-block">
            <span className="hero-overline">THE COMMERCE LAYER FOR AI AGENTS</span>
            <h1 className="hero-main-title">
              {isMerchant ? 'Sell to AI buyers.' : 'Buy with AI.'}
            </h1>
            <p className="hero-main-sub">
              "AgentPay connects autonomous AI buyers with AI-ready merchants, enabling product discovery, intelligent matching, policy-controlled checkout, payment authorization and verified order execution."
            </p>
          </div>

          {/* Role-Specific Lifecycle Flow Diagram */}
          <div className="auth-lifecycle-box">
            <div className="auth-lifecycle-header">
              <span className="auth-lifecycle-tag">
                {isMerchant ? 'MERCHANT COMMERCE LIFECYCLE' : 'BUYER PROCUREMENT LIFECYCLE'}
              </span>
            </div>

            {isMerchant ? (
              <div className="auth-flow-stages">
                <div className="auth-flow-item">Merchant Catalog</div>
                <div className="auth-flow-arrow">↓</div>
                <div className="auth-flow-item">Structured Product Data</div>
                <div className="auth-flow-arrow">↓</div>
                <div className="auth-flow-item">AI Discoverability</div>
                <div className="auth-flow-arrow">↓</div>
                <div className="auth-flow-item">Inventory Availability</div>
                <div className="auth-flow-arrow">↓</div>
                <div className="auth-flow-item">Price Quotes</div>
                <div className="auth-flow-arrow">↓</div>
                <div className="auth-flow-item">Machine Checkout</div>
                <div className="auth-flow-arrow">↓</div>
                <div className="auth-flow-item">AI-Originated Order</div>
                <div className="auth-flow-arrow">↓</div>
                <div className="auth-flow-item">Payment Verification</div>
                <div className="auth-flow-arrow">↓</div>
                <div className="auth-flow-item">Fulfillment</div>
              </div>
            ) : (
              <div className="auth-flow-stages">
                <div className="auth-flow-item">Natural Language Intent</div>
                <div className="auth-flow-arrow">↓</div>
                <div className="auth-flow-item">AI Product Discovery</div>
                <div className="auth-flow-arrow">↓</div>
                <div className="auth-flow-item">Product Matching</div>
                <div className="auth-flow-arrow">↓</div>
                <div className="auth-flow-item">Buyer Preferences</div>
                <div className="auth-flow-arrow">↓</div>
                <div className="auth-flow-item">Policy Evaluation</div>
                <div className="auth-flow-arrow">↓</div>
                <div className="auth-flow-item">Price & Inventory Validation</div>
                <div className="auth-flow-arrow">↓</div>
                <div className="auth-flow-item">Authorized Checkout</div>
                <div className="auth-flow-arrow">↓</div>
                <div className="auth-flow-item">Payment</div>
                <div className="auth-flow-arrow">↓</div>
                <div className="auth-flow-item">Merchant Order</div>
                <div className="auth-flow-arrow">↓</div>
                <div className="auth-flow-item">Fulfillment</div>
              </div>
            )}
          </div>

          {/* Controlled Autonomous Commerce Principles */}
          <div className="auth-trust-box">
            <div className="auth-trust-title">CONTROLLED AUTONOMOUS COMMERCE</div>
            <div className="auth-trust-pillars">
              <div className="auth-pillar-row">
                <span className="auth-pillar-dot" />
                <span><strong>AI proposes.</strong> Natural language requirement parsing.</span>
              </div>
              <div className="auth-pillar-row">
                <span className="auth-pillar-dot" />
                <span><strong>Policies constrain.</strong> Server-side spending & category limits.</span>
              </div>
              <div className="auth-pillar-row">
                <span className="auth-pillar-dot" />
                <span><strong>AgentPay verifies.</strong> Price surge & inventory lock validation.</span>
              </div>
              <div className="auth-pillar-row">
                <span className="auth-pillar-dot" />
                <span><strong>Payment executes.</strong> Cryptographic signature verification.</span>
              </div>
              <div className="auth-pillar-row">
                <span className="auth-pillar-dot" />
                <span><strong>Merchants fulfill.</strong> Direct order dispatch & settlement.</span>
              </div>
            </div>

            {/* Price Protection Guarantee Callout */}
            <div className="auth-surge-callout">
              <Icons.ShieldCheck size={15} />
              <div>
                <strong>PRICE CHANGE PROTECTION:</strong> Final checkout price must remain within buyer authorization.
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* =========================================================================
          RIGHT / AUTHENTICATION FORM CONTAINER
         ========================================================================= */}
      <div className="auth-form-pane">
        <div className="auth-card-modern">
          {/* Back to Home Link */}
          <div className="auth-top-nav">
            <button
              type="button"
              className="auth-back-btn"
              onClick={() => navigate('/')}
            >
              <Icons.ChevronRight size={14} style={{ transform: 'rotate(180deg)' }} /> Back to Home
            </button>
            <span className="auth-env-badge">
              <span className="auth-env-dot" /> Test Rails Active
            </span>
          </div>

          {/* Role Selection Question: HOW WILL YOU USE AGENTPAY? */}
          <div className="auth-role-gate">
            <div className="auth-gate-label">HOW WILL YOU USE AGENTPAY?</div>
            <div className="auth-role-tabs">
              <button
                type="button"
                className={`auth-role-tab ${!isMerchant ? 'active' : ''}`}
                onClick={() => handleRoleSelect('BUYER')}
              >
                <Icons.Sparkles size={15} />
                <span>Buy with AI</span>
              </button>

              <button
                type="button"
                className={`auth-role-tab ${isMerchant ? 'active' : ''}`}
                onClick={() => handleRoleSelect('MERCHANT')}
              >
                <Icons.Store size={15} />
                <span>Sell to AI</span>
              </button>
            </div>
          </div>

          {/* Header Title & Subtext */}
          <div className="auth-form-header">
            <h2 className="auth-form-title">
              {mode === 'signup'
                ? isMerchant
                  ? 'Create Merchant Account'
                  : 'Create Buyer Account'
                : isMerchant
                ? 'Merchant Sign In'
                : 'Buyer Sign In'}
            </h2>
            <p className="auth-form-sub">
              {isMerchant
                ? 'Manage catalog readiness, monitor autonomous AI orders, and inspect settlement.'
                : 'Configure spending limits and delegate procurement to your AI purchasing agent.'}
            </p>
          </div>

          {/* Error Banner */}
          {error && (
            <div className="auth-error-banner" role="alert">
              <Icons.AlertTriangle size={16} />
              <span>{error}</span>
            </div>
          )}

          {/* Google OAuth */}
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
            <span>or sign in with demo credentials</span>
          </div>

          {/* Quick Demo Credentials Autofill */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '1rem' }}>
            <button
              type="button"
              className="btn-ui btn-ui-secondary btn-ui-sm"
              style={{ flex: 1, fontSize: '12px', padding: '6px 8px', justifyContent: 'center' }}
              onClick={() => {
                setEmail('buyer@agentpay.ai');
                setPassword('password123');
                setSelectedRole('BUYER');
                setError(null);
              }}
            >
              Demo Buyer (buyer@agentpay.ai)
            </button>
            <button
              type="button"
              className="btn-ui btn-ui-secondary btn-ui-sm"
              style={{ flex: 1, fontSize: '12px', padding: '6px 8px', justifyContent: 'center' }}
              onClick={() => {
                setEmail('merchant@agentpay.ai');
                setPassword('password123');
                setSelectedRole('MERCHANT');
                setError(null);
              }}
            >
              Demo Merchant (merchant@agentpay.ai)
            </button>
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
                    placeholder={isMerchant ? 'Acme Electronics' : 'Alex Kumar'}
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
                  placeholder={isMerchant ? 'merchant@yourstore.com' : 'buyer@yourdomain.com'}
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
                  aria-label="Toggle password visibility"
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
                isMerchant ? 'Continue as Merchant →' : 'Continue as Buyer →'
              ) : (
                isMerchant ? 'Sign In as Merchant →' : 'Sign In as Buyer →'
              )}
            </button>
          </form>

          {/* Mode Switcher Link */}
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
