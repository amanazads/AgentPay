import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { Icons } from '../components/ui/Icons';
import './Onboarding.css';

const CATEGORIES = [
  'Electronics',
  'Peripherals & Accessories',
  'Software & SaaS Licenses',
  'Office Supplies',
  'Furniture & Setup',
];

const POPULAR_BRANDS = [
  'Sony',
  'Apple',
  'Asus',
  'Dell',
  'Logitech',
  'Bose',
  'Samsung',
  'Keychron',
];

export default function Onboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [categories, setCategories] = useState(['Electronics', 'Peripherals & Accessories']);
  const [preferredBrands, setPreferredBrands] = useState(['Sony', 'Logitech', 'Apple']);
  const [customBrand, setCustomBrand] = useState('');
  const [monthlyBudget, setMonthlyBudget] = useState('100000');
  const [autoLimit, setAutoLimit] = useState('25000');
  const [purchaseBehavior, setPurchaseBehavior] = useState('auto_within_limit');
  const [deliveryPreference, setDeliveryPreference] = useState('Fastest available (2-day SLA)');
  const [paymentMandateLinked, setPaymentMandateLinked] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const toggleCategory = (cat) => {
    setCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  };

  const toggleBrand = (b) => {
    setPreferredBrands((prev) =>
      prev.includes(b) ? prev.filter((item) => item !== b) : [...prev, b]
    );
  };

  const handleAddCustomBrand = (e) => {
    e.preventDefault();
    if (customBrand.trim() && !preferredBrands.includes(customBrand.trim())) {
      setPreferredBrands([...preferredBrands, customBrand.trim()]);
      setCustomBrand('');
    }
  };

  const handleFinish = async () => {
    setSaving(true);
    setError(null);
    try {
      // 1. Save preferences
      await api.updatePreferences({
        categories,
        preferredBrands,
        monthlyBudget: parseFloat(monthlyBudget) || 100000,
        automaticPurchaseLimit: parseFloat(autoLimit) || 25000,
        purchaseBehavior,
        deliveryPreference,
        customCriteria: [],
      });

      // 2. Link payment method if enabled
      if (paymentMandateLinked) {
        await api.addPaymentMethod({
          provider: 'razorpay',
          method_type: 'upi_mandate',
          identifier_masked: 'user@okaxis (UPI Auto-Pay)',
          max_limit: parseFloat(autoLimit) || 25000,
          is_default: true,
        }).catch(() => null);
      }

      navigate('/buyer/home');
    } catch (e) {
      console.error('Failed to save onboarding preferences', e);
      setError('Could not save your preferences. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const formatCurrency = (amt) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(parseFloat(amt) || 0);

  return (
    <div className="onboarding-wrapper">
      <div className="onboarding-card">
        {/* Brand Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '1.25rem' }}>
          <span style={{ width: 22, height: 22, backgroundColor: '#0f172a', color: '#fff', borderRadius: 4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>
            AP
          </span>
          <span style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#0f172a' }}>AgentPay</span>
          <span style={{ fontSize: '0.75rem', color: '#64748b', marginLeft: 'auto' }}>
            Step {step} of 3
          </span>
        </div>

        {/* Progress Bar */}
        <div className="onboarding-progress-row">
          {[1, 2, 3].map((i) => (
            <div key={i} className={`onboarding-progress-dot ${step >= i ? 'active' : ''}`} />
          ))}
        </div>

        {error && (
          <div style={{ padding: '0.75rem', backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, color: '#991b1b', fontSize: '0.8125rem', marginBottom: '1rem' }}>
            {error}
          </div>
        )}

        {/* Step 1: Categories & Brands */}
        {step === 1 && (
          <div>
            <h1 className="onboarding-title">What should AgentPay buy for you?</h1>
            <p className="onboarding-sub">
              Select product categories and brands you prefer. Your AI purchasing agent will prioritize these during product discovery.
            </p>

            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#0f172a', display: 'block', marginBottom: '6px' }}>
                Preferred Categories
              </label>
              <div className="onboarding-options-grid">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    className={`onboarding-chip-option ${categories.includes(cat) ? 'selected' : ''}`}
                    onClick={() => toggleCategory(cat)}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#0f172a', display: 'block', marginBottom: '6px' }}>
                Preferred Brands
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
                {POPULAR_BRANDS.map((b) => (
                  <button
                    key={b}
                    type="button"
                    style={{
                      padding: '4px 10px',
                      borderRadius: 16,
                      fontSize: '0.75rem',
                      fontWeight: 500,
                      cursor: 'pointer',
                      border: preferredBrands.includes(b) ? '1.5px solid #0f172a' : '1px solid #e2e8f0',
                      backgroundColor: preferredBrands.includes(b) ? '#0f172a' : '#f8fafc',
                      color: preferredBrands.includes(b) ? '#ffffff' : '#475569',
                    }}
                    onClick={() => toggleBrand(b)}
                  >
                    {b}
                  </button>
                ))}
              </div>

              <div style={{ display: 'flex', gap: '6px' }}>
                <input
                  type="text"
                  className="input-ui"
                  placeholder="Add another brand (e.g. Sennheiser)"
                  value={customBrand}
                  onChange={(e) => setCustomBrand(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddCustomBrand(e))}
                  style={{ fontSize: '0.8125rem' }}
                />
                <button
                  type="button"
                  className="btn-ui btn-ui-outline btn-ui-sm"
                  onClick={handleAddCustomBrand}
                >
                  Add
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
              <button className="btn-ui btn-ui-primary" onClick={() => setStep(2)}>
                Continue <Icons.ArrowRight size={16} />
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Spending Ceilings & Auto-Purchase Limits */}
        {step === 2 && (
          <div>
            <h1 className="onboarding-title">Set your spending boundaries</h1>
            <p className="onboarding-sub">
              Define your monthly spending ceiling and the maximum amount AgentPay can complete automatically without requiring human confirmation.
            </p>

            <div className="onboarding-slider-group" style={{ marginBottom: '1.25rem' }}>
              <div className="onboarding-slider-header">
                <span className="slider-label">Monthly Spending Ceiling</span>
                <span className="slider-value">{formatCurrency(monthlyBudget)}</span>
              </div>
              <input
                type="range"
                min="10000"
                max="500000"
                step="5000"
                value={monthlyBudget}
                onChange={(e) => setMonthlyBudget(e.target.value)}
                className="onboarding-slider"
              />
              <div className="slider-ticks">
                <span>₹10,000</span>
                <span>₹2,50,000</span>
                <span>₹5,00,000</span>
              </div>
            </div>

            <div className="onboarding-slider-group">
              <div className="onboarding-slider-header">
                <span className="slider-label">Automatic Purchase Limit</span>
                <span className="slider-value">{formatCurrency(autoLimit)}</span>
              </div>
              <input
                type="range"
                min="1000"
                max="100000"
                step="1000"
                value={autoLimit}
                onChange={(e) => setAutoLimit(e.target.value)}
                className="onboarding-slider"
              />
              <div className="slider-ticks">
                <span>₹1,000</span>
                <span>₹50,000</span>
                <span>₹1,00,000</span>
              </div>
              <p style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '6px' }}>
                Purchases up to {formatCurrency(autoLimit)} are completed autonomously. Purchases above {formatCurrency(autoLimit)} will pause and request your approval.
              </p>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1.5rem' }}>
              <button className="btn-ui btn-ui-outline" onClick={() => setStep(1)}>
                Back
              </button>
              <button className="btn-ui btn-ui-primary" onClick={() => setStep(3)}>
                Continue <Icons.ArrowRight size={16} />
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Purchase Behavior & Payment Rail */}
        {step === 3 && (
          <div>
            <h1 className="onboarding-title">Purchase Behavior & Auto-Pay</h1>
            <p className="onboarding-sub">
              Authorize payment rails and confirm your autonomous execution rules.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <div
                style={{
                  padding: '1rem',
                  borderRadius: 8,
                  border: `2px solid ${purchaseBehavior === 'auto_within_limit' ? '#0f172a' : '#e2e8f0'}`,
                  backgroundColor: purchaseBehavior === 'auto_within_limit' ? '#f8fafc' : '#ffffff',
                  cursor: 'pointer',
                }}
                onClick={() => setPurchaseBehavior('auto_within_limit')}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                  <Icons.CheckCircle size={16} style={{ color: purchaseBehavior === 'auto_within_limit' ? '#0f172a' : '#94a3b8' }} />
                  <strong style={{ fontSize: '0.875rem', color: '#0f172a' }}>Autonomous Purchasing (Recommended)</strong>
                </div>
                <p style={{ fontSize: '0.75rem', color: '#64748b', margin: 0, paddingLeft: '24px' }}>
                  Automatically complete purchases within your {formatCurrency(autoLimit)} limit.
                </p>
              </div>

              <div
                style={{
                  padding: '1rem',
                  borderRadius: 8,
                  border: `2px solid ${purchaseBehavior === 'always_ask' ? '#0f172a' : '#e2e8f0'}`,
                  backgroundColor: purchaseBehavior === 'always_ask' ? '#f8fafc' : '#ffffff',
                  cursor: 'pointer',
                }}
                onClick={() => setPurchaseBehavior('always_ask')}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                  <Icons.CheckCircle size={16} style={{ color: purchaseBehavior === 'always_ask' ? '#0f172a' : '#94a3b8' }} />
                  <strong style={{ fontSize: '0.875rem', color: '#0f172a' }}>Always Request Confirmation</strong>
                </div>
                <p style={{ fontSize: '0.75rem', color: '#64748b', margin: 0, paddingLeft: '24px' }}>
                  Ask for one-click approval before every single purchase, regardless of price.
                </p>
              </div>
            </div>

            {/* Auto-Pay Settlement Rail */}
            <div style={{ padding: '1rem', backgroundColor: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <strong style={{ fontSize: '0.875rem', color: '#0f172a', display: 'block' }}>UPI Auto-Pay Mandate</strong>
                  <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Razorpay Payment Mandate • Single Tx Limit: {formatCurrency(autoLimit)}</span>
                </div>
                <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#065f46', backgroundColor: '#ecfdf5', padding: '2px 8px', borderRadius: 4 }}>
                  PRE-CONFIGURED
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1.5rem' }}>
              <button className="btn-ui btn-ui-outline" onClick={() => setStep(2)} disabled={saving}>
                Back
              </button>
              <button
                className="btn-ui btn-ui-primary"
                onClick={handleFinish}
                disabled={saving}
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                {saving ? 'Saving Preferences...' : 'Start Shopping with AI'} <Icons.ArrowRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
