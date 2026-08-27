import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { Icons } from '../components/ui/Icons';
import './MerchantOAuth.css';

export default function MerchantOAuth() {
  const { merchantId } = useParams();
  const navigate = useNavigate();

  const [merchant, setMerchant] = useState(null);
  const [loading, setLoading] = useState(true);
  const [emailOrPhone, setEmailOrPhone] = useState('aman@gmail.com');
  const [password, setPassword] = useState('••••••••••••');
  const [authorizing, setAuthorizing] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchMerchantDetails();
  }, [merchantId]);

  const fetchMerchantDetails = async () => {
    try {
      const res = await api.getConnectedMerchants();
      const match = (res.merchants || []).find((m) => m.merchantId === merchantId);
      if (match) {
        setMerchant(match);
      } else {
        setError('Merchant store not found or unsupported.');
      }
    } catch (e) {
      console.error('Failed to load merchant details', e);
      setError('Failed to connect to merchant authentication portal.');
    } finally {
      setLoading(false);
    }
  };

  const handleAuthorizeAndConnect = async (e) => {
    e.preventDefault();
    setAuthorizing(true);
    setError(null);

    try {
      // Simulate real OAuth authorization grant exchange with merchant server
      await new Promise((r) => setTimeout(r, 600));

      await api.connectMerchant(merchantId, {
        accountIdentifier: emailOrPhone.trim(),
        authType: 'oauth2',
        apiKey: `oauth_tok_${Math.random().toString(36).substring(2, 12)}`,
        capabilities: merchant?.capabilities,
      });

      // Redirect back to preferences with success query parameter
      navigate(`/preferences?connected=${encodeURIComponent(merchant?.merchantName || 'Store')}`);
    } catch (err) {
      console.error('Authorization grant error', err);
      setError(err.message || 'Store authorization failed.');
      setAuthorizing(false);
    }
  };

  if (loading) {
    return (
      <div className="oauth-page-container">
        <div className="oauth-card" style={{ textAlign: 'center', padding: '3rem 1.5rem' }}>
          <p style={{ color: '#64748b' }}>Connecting to merchant authentication portal...</p>
        </div>
      </div>
    );
  }

  if (error && !merchant) {
    return (
      <div className="oauth-page-container">
        <div className="oauth-card" style={{ textAlign: 'center' }}>
          <h2 style={{ color: '#ef4444', fontSize: '1.25rem', marginBottom: '0.5rem' }}>Connection Error</h2>
          <p style={{ color: '#64748b', fontSize: '0.875rem', marginBottom: '1.5rem' }}>{error}</p>
          <button className="oauth-btn-cancel" onClick={() => navigate('/preferences')}>
            Return to Preferences
          </button>
        </div>
      </div>
    );
  }

  const isFlipkart = merchant?.merchantName?.toLowerCase().includes('flipkart');
  const badgeColor = isFlipkart ? '#2874f0' : '#0f172a';
  const initial = (merchant?.merchantName || 'S').charAt(0);

  return (
    <div className="oauth-page-container">
      <div className="oauth-card">
        {/* Header Branding */}
        <div className="oauth-header-brand">
          <div className="oauth-store-logo">
            <div className="oauth-store-badge" style={{ backgroundColor: badgeColor }}>
              {initial}
            </div>
            <div>
              <strong style={{ fontSize: '1rem', color: '#0f172a', display: 'block' }}>
                {merchant.merchantName}
              </strong>
              <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Customer OAuth Portal</span>
            </div>
          </div>

          <div className="oauth-agentpay-badge">
            <Icons.Shield size={16} style={{ color: '#0284c7' }} />
            <span>AgentPay</span>
          </div>
        </div>

        {/* Title */}
        <h1 className="oauth-title">
          Connect your {merchant.merchantName} account
        </h1>
        <p className="oauth-desc">
          AgentPay is requesting permission to access your customer account to search inventory, prepare checkout carts, and place authorized orders.
        </p>

        {/* Scopes & Permissions */}
        <div className="oauth-scopes-box">
          <div className="oauth-scopes-title">Permissions Requested:</div>
          <div className="oauth-scope-item">
            <Icons.CheckCircle size={15} style={{ color: '#16a34a', flexShrink: 0, marginTop: '2px' }} />
            <span>View catalog pricing, specifications, and live warehouse inventory</span>
          </div>
          <div className="oauth-scope-item">
            <Icons.CheckCircle size={15} style={{ color: '#16a34a', flexShrink: 0, marginTop: '2px' }} />
            <span>Create and update shopping carts within your authorized spending limit</span>
          </div>
          <div className="oauth-scope-item">
            <Icons.CheckCircle size={15} style={{ color: '#16a34a', flexShrink: 0, marginTop: '2px' }} />
            <span>Place orders automatically when approved by your AgentPay policies</span>
          </div>
          <div className="oauth-scope-item">
            <Icons.CheckCircle size={15} style={{ color: '#16a34a', flexShrink: 0, marginTop: '2px' }} />
            <span>Access order status, delivery tracking, and returns metadata</span>
          </div>
        </div>

        {error && (
          <div style={{ padding: '0.75rem', backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#b91c1c', fontSize: '0.8125rem', marginBottom: '1rem' }}>
            {error}
          </div>
        )}

        {/* Customer Login Form */}
        <form onSubmit={handleAuthorizeAndConnect} className="oauth-form">
          <div className="oauth-input-group">
            <label className="oauth-label">Store Customer Email / Phone</label>
            <input
              type="text"
              required
              className="input-ui"
              value={emailOrPhone}
              onChange={(e) => setEmailOrPhone(e.target.value)}
              placeholder="e.g. yourname@gmail.com"
            />
          </div>

          <div className="oauth-input-group">
            <label className="oauth-label">Password / Security PIN</label>
            <input
              type="password"
              required
              className="input-ui"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your store password"
            />
          </div>

          <div className="oauth-actions">
            <button
              type="button"
              className="oauth-btn-cancel"
              onClick={() => navigate('/preferences')}
              disabled={authorizing}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="oauth-btn-allow"
              disabled={authorizing || !emailOrPhone.trim()}
            >
              {authorizing ? (
                'Granting Access...'
              ) : (
                <>
                  <Icons.Check size={16} /> Allow Access & Connect
                </>
              )}
            </button>
          </div>
        </form>

        {/* Security Note */}
        <div className="oauth-footer-security">
          <Icons.Lock size={12} />
          <span>OAuth 2.0 Encrypted Grant • Revocable anytime from AgentPay</span>
        </div>
      </div>
    </div>
  );
}
