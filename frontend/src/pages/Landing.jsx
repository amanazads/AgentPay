import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Icons } from '../components/ui/Icons';
import './Landing.css';

export default function Landing() {
  const navigate = useNavigate();

  const handleSelectRole = (role) => {
    localStorage.setItem('agentpay_initial_role', role);
    navigate(`/signup?role=${role}`);
  };

  return (
    <div className="landing-root">
      <header className="landing-nav">
        <div className="landing-brand">
          <span style={{ width: 22, height: 22, backgroundColor: '#0f172a', color: '#fff', borderRadius: 4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>
            AP
          </span>
          <span>AgentPay</span>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn-ui btn-ui-outline btn-ui-sm" onClick={() => navigate('/login')}>
            Sign in
          </button>
        </div>
      </header>

      <main className="landing-hero" style={{ paddingBottom: '3rem' }}>
        <div className="landing-badge">
          <Icons.Shield size={14} />
          <span>The Autonomous Commerce Platform</span>
        </div>

        <h1 className="landing-title">
          Welcome to AgentPay
        </h1>

        <p className="landing-subtitle">
          Autonomous commerce for buyers and merchants.
        </p>

        {/* 2 Clear Role Selection Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem', maxWidth: '780px', margin: '2.5rem auto 1rem', width: '100%', textAlign: 'left' }}>
          {/* Card 1: Buyer */}
          <div
            style={{
              backgroundColor: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: 14,
              padding: '2rem',
              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <div style={{ width: 36, height: 36, borderRadius: 8, backgroundColor: '#eff6ff', color: '#1e40af', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1rem' }}>
                <Icons.Sparkles size={20} />
              </div>
              <h2 style={{ fontSize: '1.35rem', fontWeight: 700, color: '#0f172a', margin: '0 0 0.5rem 0' }}>
                I'm a Buyer
              </h2>
              <p style={{ fontSize: '0.875rem', color: '#64748b', lineHeight: 1.5, margin: '0 0 2rem 0' }}>
                Find and purchase products with AI.
              </p>
            </div>
            <button
              className="btn-ui btn-ui-primary"
              style={{ width: '100%', padding: '0.8rem', fontSize: '0.9375rem', fontWeight: 600 }}
              onClick={() => handleSelectRole('BUYER')}
            >
              Continue as Buyer →
            </button>
          </div>

          {/* Card 2: Merchant */}
          <div
            style={{
              backgroundColor: '#ffffff',
              border: '1px solid #e4e4e7',
              borderRadius: 14,
              padding: '2rem',
              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <div style={{ width: 36, height: 36, borderRadius: 8, backgroundColor: '#f4f4f5', color: '#18181b', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1rem' }}>
                <Icons.Store size={20} />
              </div>
              <h2 style={{ fontSize: '1.35rem', fontWeight: 700, color: '#18181b', margin: '0 0 0.5rem 0' }}>
                I'm a Merchant
              </h2>
              <p style={{ fontSize: '0.875rem', color: '#71717a', lineHeight: 1.5, margin: '0 0 2rem 0' }}>
                Make my products discoverable by AI buyers.
              </p>
            </div>
            <button
              className="btn-ui"
              style={{ width: '100%', padding: '0.8rem', fontSize: '0.9375rem', fontWeight: 600, backgroundColor: '#18181b', color: '#ffffff', border: 'none', borderRadius: 8, cursor: 'pointer' }}
              onClick={() => handleSelectRole('MERCHANT')}
            >
              Continue as Merchant →
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
