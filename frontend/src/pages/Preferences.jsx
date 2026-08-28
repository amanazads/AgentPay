import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { Icons } from '../components/ui/Icons';
import Button from '../components/ui/Button';
import './Preferences.css';

const AVAILABLE_BRANDS = ['Apple', 'Sony', 'ASUS', 'Dell', 'Lenovo', 'Logitech', 'HP', 'BenQ', 'Samsung', 'Anker', 'Ambrane', 'Keychron', 'Bose'];
const AVAILABLE_CATEGORIES = ['Electronics', 'Peripherals', 'Office Supplies', 'Furniture', 'Software & Licenses'];

export default function Preferences() {
  const [prefs, setPrefs] = useState({
    monthlyBudget: 100000,
    spentThisMonth: 0,
    remainingBudget: 100000,
    automaticPurchaseLimit: 50000,
    categories: ['Electronics', 'Peripherals'],
    preferredBrands: ['Apple', 'Sony', 'Logitech'],
    deliveryPreference: 'Fastest available (within 2 days)',
    purchaseBehavior: 'auto_within_limit',
    customCriteria: [
      { id: 'crit_1', label: 'Condition', value: 'New only' },
      { id: 'crit_2', label: 'Minimum Rating', value: '4.0+ stars' },
    ],
    policyVersion: 1,
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState(null);
  const [saveError, setSaveError] = useState(null);

  // Natural Language Interpreter State
  const [naturalText, setNaturalText] = useState('');
  const [interpreting, setInterpreting] = useState(false);
  const [interpretedResult, setInterpretedResult] = useState(null);

  // Policy Preview / Test My Rules State
  const [testQuery, setTestQuery] = useState('');
  const [testingPolicy, setTestingPolicy] = useState(false);
  const [previewResult, setPreviewResult] = useState(null);

  useEffect(() => {
    loadPreferences();
  }, []);

  const loadPreferences = async () => {
    try {
      const res = await api.getPreferences();
      if (res.preferences) {
        setPrefs((prev) => ({ ...prev, ...res.preferences }));
      }
    } catch (e) {
      console.error('Failed to load preferences', e);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveMessage(null);
    setSaveError(null);

    // Client-side quick check before submitting to server
    if (prefs.automaticPurchaseLimit > prefs.monthlyBudget) {
      setSaveError(`Autonomous single-purchase limit (₹${prefs.automaticPurchaseLimit.toLocaleString('en-IN')}) cannot exceed total monthly budget (₹${prefs.monthlyBudget.toLocaleString('en-IN')}).`);
      setSaving(false);
      return;
    }

    try {
      const res = await api.updatePreferences(prefs);
      if (res.preferences) {
        setPrefs((prev) => ({ ...prev, ...res.preferences }));
      }
      setSaveMessage('Purchasing preferences and spending boundaries updated successfully.');
      setTimeout(() => setSaveMessage(null), 4000);
    } catch (e) {
      setSaveError(e.message || 'Failed to save preferences. Please check your inputs.');
      setTimeout(() => setSaveError(null), 5000);
    } finally {
      setSaving(false);
    }
  };

  const toggleBrand = (brand) => {
    const list = prefs.preferredBrands || [];
    if (list.includes(brand)) {
      setPrefs({ ...prefs, preferredBrands: list.filter((b) => b !== brand) });
    } else {
      setPrefs({ ...prefs, preferredBrands: [...list, brand] });
    }
  };

  const toggleCategory = (cat) => {
    const list = prefs.categories || [];
    if (list.includes(cat)) {
      if (list.length <= 1) {
        alert('You must permit at least one product category.');
        return;
      }
      setPrefs({ ...prefs, categories: list.filter((c) => c !== cat) });
    } else {
      setPrefs({ ...prefs, categories: [...list, cat] });
    }
  };

  const handleInterpretNatural = async () => {
    if (!naturalText.trim()) return;
    setInterpreting(true);
    try {
      const res = await api.interpretPreferences(naturalText);
      if (res.extracted) {
        setInterpretedResult(res);
      }
    } catch (e) {
      console.error('Interpret failed', e);
    } finally {
      setInterpreting(false);
    }
  };

  const applyInterpreted = () => {
    if (!interpretedResult?.extracted) return;
    const ext = interpretedResult.extracted;
    setPrefs((prev) => ({
      ...prev,
      ...ext,
      monthlyBudget: ext.monthlyBudget || prev.monthlyBudget,
      automaticPurchaseLimit: ext.automaticPurchaseLimit || prev.automaticPurchaseLimit,
      preferredBrands: ext.preferredBrands || prev.preferredBrands,
      categories: ext.categories || prev.categories,
      deliveryPreference: ext.deliveryPreference || prev.deliveryPreference,
      purchaseBehavior: ext.purchaseBehavior || prev.purchaseBehavior,
      categoryRules: interpretedResult.categoryRules || prev.categoryRules,
      deliveryRules: interpretedResult.deliveryRules || prev.deliveryRules,
      brandRules: interpretedResult.brandRules || prev.brandRules,
    }));
    setInterpretedResult(null);
    setNaturalText('');
    setSaveMessage('Parsed natural rules applied to draft. Click "Save Changes" to commit.');
    setTimeout(() => setSaveMessage(null), 4000);
  };

  const handleTestPolicy = async (customText) => {
    const textToTest = customText || testQuery;
    if (!textToTest.trim()) return;

    setTestingPolicy(true);
    setPreviewResult(null);

    try {
      const res = await api.evaluatePolicyPreview({ queryText: textToTest });
      setPreviewResult(res);
    } catch (e) {
      setPreviewResult({
        decision: 'BLOCK',
        automatic_purchase: 'NO',
        reason: e.message || 'Simulation error',
      });
    } finally {
      setTestingPolicy(false);
    }
  };

  const formatCurrency = (amt) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amt || 0);

  return (
    <div className="prefs-container">
      {/* Header */}
      <div className="prefs-header">
        <div>
          <h1 className="text-h1">Procurement Policy & Purchasing Preferences</h1>
          <p className="text-body" style={{ marginTop: 2 }}>
            Define authoritative spending boundaries, allowed categories, and procurement rules for your autonomous buyer agent.
          </p>
        </div>

        <Button
          variant="primary"
          onClick={handleSave}
          loading={saving}
          icon={<Icons.Check size={15} />}
        >
          Save Changes
        </Button>
      </div>

      {/* Live Spending Summary Banner */}
      <div className="home-spending-bar" style={{ marginBottom: '1.25rem' }}>
        <div className="spending-item">
          <span className="spending-label">Monthly Budget</span>
          <span className="spending-val">{formatCurrency(prefs.monthlyBudget)}</span>
        </div>
        <div className="spending-divider" />
        <div className="spending-item">
          <span className="spending-label">Spent This Month</span>
          <span className="spending-val">{formatCurrency(prefs.spentThisMonth)}</span>
        </div>
        <div className="spending-divider" />
        <div className="spending-item">
          <span className="spending-label">Remaining Budget</span>
          <span className="spending-val highlight-green">{formatCurrency(prefs.remainingBudget)}</span>
        </div>
        <div className="spending-divider" />
        <div className="spending-item">
          <span className="spending-label">Autonomous Limit</span>
          <span className="spending-val">{formatCurrency(prefs.automaticPurchaseLimit)}</span>
        </div>
        <div className="spending-divider hide-on-mobile" />
        <div className="spending-item hide-on-mobile">
          <span className="spending-label">Policy Version</span>
          <span className="spending-val" style={{ fontSize: '0.875rem' }}>v{prefs.policyVersion || 1}</span>
        </div>
      </div>

      {saveMessage && (
        <div className="prefs-toast-msg" role="status" style={{ background: '#ecfdf5', color: '#065f46', borderColor: '#a7f3d0' }}>
          <Icons.Check size={16} />
          <span>{saveMessage}</span>
        </div>
      )}

      {saveError && (
        <div className="prefs-toast-msg" role="alert" style={{ background: '#fef2f2', color: '#991b1b', borderColor: '#fecaca' }}>
          <Icons.AlertCircle size={16} />
          <span>{saveError}</span>
        </div>
      )}

      {/* Section 1: Financial Spending Limits */}
      <div className="card-panel">
        <div className="card-panel-header">
          <div>
            <h2 className="card-panel-title">Spending Limits & Autonomous Ceiling</h2>
            <p className="card-panel-sub">
              Deterministic limits enforced on all AI purchase intents. Values are verified server-side.
            </p>
          </div>
        </div>

        <div className="card-panel-body">
          <div className="prefs-grid-2">
            <div className="form-group">
              <label className="form-label">Autonomous Single-Purchase Limit (₹)</label>
              <input
                type="number"
                className="input-ui"
                value={prefs.automaticPurchaseLimit}
                onChange={(e) =>
                  setPrefs({ ...prefs, automaticPurchaseLimit: parseFloat(e.target.value) || 0 })
                }
              />
              <span className="text-caption">
                AI can purchase up to this amount automatically. Higher amounts escalate to human 1-click review.
              </span>
            </div>

            <div className="form-group">
              <label className="form-label">Monthly Spending Budget (₹)</label>
              <input
                type="number"
                className="input-ui"
                value={prefs.monthlyBudget}
                onChange={(e) =>
                  setPrefs({ ...prefs, monthlyBudget: parseFloat(e.target.value) || 0 })
                }
              />
              <span className="text-caption">
                Maximum qualifying spend per calendar month across all agent purchases. Deterministically blocked if exceeded.
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Section 2: Preferred Brands & Allowed Categories */}
      <div className="card-panel">
        <div className="card-panel-header">
          <div>
            <h2 className="card-panel-title">Brand & Category Policy</h2>
            <p className="card-panel-sub">
              Preferred brands receive ranking priority. Categories define hard boundaries where purchasing is authorized.
            </p>
          </div>
        </div>

        <div className="card-panel-body">
          {/* Preferred Brands */}
          <div style={{ marginBottom: '1.5rem' }}>
            <label className="form-label" style={{ marginBottom: '0.25rem', display: 'block' }}>
              Preferred Brands (Click to toggle)
            </label>
            <span className="text-caption" style={{ display: 'block', marginBottom: '0.5rem' }}>
              Used to rank eligible products (+15 rank score); not mandatory unless explicitly stated in your request.
            </span>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {AVAILABLE_BRANDS.map((brand) => {
                const isSelected = (prefs.preferredBrands || []).includes(brand);
                return (
                  <button
                    key={brand}
                    type="button"
                    className={`tag-toggle-btn ${isSelected ? 'selected' : ''}`}
                    onClick={() => toggleBrand(brand)}
                  >
                    {isSelected && <Icons.Check size={12} />}
                    <span>{brand}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Permitted Categories */}
          <div>
            <label className="form-label" style={{ marginBottom: '0.25rem', display: 'block' }}>
              Permitted Product Categories (Hard Policy Boundary)
            </label>
            <span className="text-caption" style={{ display: 'block', marginBottom: '0.5rem' }}>
              Products outside these categories cannot be purchased by the autonomous agent under any circumstances.
            </span>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {AVAILABLE_CATEGORIES.map((cat) => {
                const isSelected = (prefs.categories || []).includes(cat);
                return (
                  <button
                    key={cat}
                    type="button"
                    className={`tag-toggle-btn ${isSelected ? 'selected' : ''}`}
                    onClick={() => toggleCategory(cat)}
                  >
                    {isSelected && <Icons.Check size={12} />}
                    <span>{cat}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Section 3: Delivery SLA & Procurement Behavior */}
      <div className="card-panel">
        <div className="card-panel-header">
          <div>
            <h2 className="card-panel-title">Shopping & Delivery Rules</h2>
            <p className="card-panel-sub">
              SLA preferences and human oversight controls.
            </p>
          </div>
        </div>

        <div className="card-panel-body">
          <div className="prefs-grid-2">
            <div className="form-group">
              <label className="form-label">Delivery SLA Preference</label>
              <select
                className="select-ui"
                value={prefs.deliveryPreference || 'Fastest available (within 2 days)'}
                onChange={(e) => setPrefs({ ...prefs, deliveryPreference: e.target.value })}
              >
                <option value="Fastest available (within 2 days)">Fastest available (within 2 days)</option>
                <option value="Standard delivery (3-5 days)">Standard delivery (3-5 days)</option>
                <option value="Lowest shipping cost">Lowest shipping cost</option>
              </select>
              <span className="text-caption">
                Prioritizes faster delivery options during product comparison.
              </span>
            </div>

            <div className="form-group">
              <label className="form-label">Procurement Behavior</label>
              <select
                className="select-ui"
                value={prefs.purchaseBehavior || 'auto_within_limit'}
                onChange={(e) => setPrefs({ ...prefs, purchaseBehavior: e.target.value })}
              >
                <option value="auto_within_limit">Autonomous execution within spending limit</option>
                <option value="always_ask">Always require human review before payment</option>
              </select>
              <span className="text-caption">
                Choose whether eligible purchases execute automatically or always request your 1-click confirmation.
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Section 4: Interactive Policy Preview / Test My Rules */}
      <div className="card-panel" style={{ border: '1px solid #e0e7ff', background: '#fafbff' }}>
        <div className="card-panel-header">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Icons.Cpu size={18} />
              <h2 className="card-panel-title">Test My Rules & Policy Simulator</h2>
            </div>
            <p className="card-panel-sub">
              Simulate hypothetical purchase queries against your live server-side policy to preview outcomes.
            </p>
          </div>
        </div>

        <div className="card-panel-body">
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
            <input
              type="text"
              className="input-ui"
              style={{ flex: 1, minWidth: 260, background: '#ffffff' }}
              placeholder="e.g. Buy a ₹64,990 laptop, or Order a ₹12,999 power bank..."
              value={testQuery}
              onChange={(e) => setTestQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleTestPolicy()}
            />
            <Button
              variant="primary"
              onClick={() => handleTestPolicy()}
              loading={testingPolicy}
              disabled={!testQuery.trim()}
            >
              Simulate Policy
            </Button>
          </div>

          {/* Quick Test Chips */}
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '1rem' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', alignSelf: 'center' }}>Try sample:</span>
            <button
              type="button"
              className="tag-toggle-btn"
              style={{ fontSize: '0.75rem', padding: '3px 8px' }}
              onClick={() => {
                setTestQuery('Buy a power bank under ₹5,000');
                handleTestPolicy('Buy a power bank under ₹5,000');
              }}
            >
              ₹1,899 Power Bank (Under limit)
            </button>
            <button
              type="button"
              className="tag-toggle-btn"
              style={{ fontSize: '0.75rem', padding: '3px 8px' }}
              onClick={() => {
                setTestQuery('Buy ASUS ROG Zephyrus laptop under ₹1,50,000');
                handleTestPolicy('Buy ASUS ROG Zephyrus laptop under ₹1,50,000');
              }}
            >
              ₹1,44,990 Laptop (Over auto limit)
            </button>
            <button
              type="button"
              className="tag-toggle-btn"
              style={{ fontSize: '0.75rem', padding: '3px 8px' }}
              onClick={() => {
                setTestQuery('Buy ergonomic office chair under ₹25,000');
                handleTestPolicy('Buy ergonomic office chair under ₹25,000');
              }}
            >
              Office Chair (Furniture category)
            </button>
          </div>

          {previewResult && (
            <div style={{
              background: '#ffffff',
              borderRadius: 'var(--radius-md)',
              border: `1px solid ${previewResult.decision === 'ALLOW' ? '#86efac' : previewResult.decision === 'APPROVAL_REQUIRED' ? '#fde047' : '#fca5a5'}`,
              padding: '1rem',
              marginTop: '0.75rem',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: '4px',
                    background: previewResult.decision === 'ALLOW' ? '#dcfce7' : previewResult.decision === 'APPROVAL_REQUIRED' ? '#fef9c3' : '#fee2e2',
                    color: previewResult.decision === 'ALLOW' ? '#166534' : previewResult.decision === 'APPROVAL_REQUIRED' ? '#854d0e' : '#991b1b',
                  }}>
                    DECISION: {previewResult.decision}
                  </span>
                  <span style={{ fontSize: '0.8125rem', fontWeight: 600 }}>
                    Automatic Purchase: {previewResult.automatic_purchase}
                  </span>
                </div>
                {previewResult.amount && (
                  <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-main)' }}>
                    Total: {formatCurrency(previewResult.amount)}
                  </span>
                )}
              </div>

              <p style={{ fontSize: '0.8125rem', color: 'var(--text-main)', marginBottom: '0.5rem', lineHeight: 1.4 }}>
                <strong>Reason:</strong> {previewResult.reason}
              </p>

              {previewResult.rules_evaluated && previewResult.rules_evaluated.length > 0 && (
                <div style={{ marginTop: '0.5rem', borderTop: '1px solid #f1f5f9', paddingTop: '0.5rem' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                    Evaluated Rules:
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    {previewResult.rules_evaluated.map((r, idx) => (
                      <div key={idx} style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ color: r.passed ? '#16a34a' : '#dc2626' }}>{r.passed ? '✓' : '✗'}</span>
                        <span style={{ fontWeight: 500 }}>{r.rule}:</span>
                        <span style={{ color: 'var(--text-muted)' }}>{r.details}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Section 5: Natural Language Rule Interpreter */}
      <div className="card-panel">
        <div className="card-panel-header">
          <div>
            <h2 className="card-panel-title">Natural Language Rule Interpreter</h2>
            <p className="card-panel-sub">
              State rules in plain English and AgentPay will automatically convert them into structured policy rules.
            </p>
          </div>
        </div>

        <div className="card-panel-body">
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <input
              type="text"
              className="input-ui"
              style={{ flex: 1, minWidth: 260 }}
              placeholder="e.g. Never spend more than ₹15,000 on electronics and prefer Sony and Apple..."
              value={naturalText}
              onChange={(e) => setNaturalText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleInterpretNatural()}
            />
            <Button
              variant="secondary"
              onClick={handleInterpretNatural}
              loading={interpreting}
              disabled={!naturalText.trim()}
            >
              Parse Rules
            </Button>
          </div>

          {interpretedResult && (
            <div className="interpreted-preview-box" style={{ marginTop: '1rem' }}>
              <div style={{ fontWeight: 600, fontSize: '0.8125rem', marginBottom: '0.5rem', color: 'var(--text-main)' }}>
                Interpreted Structured Policy:
              </div>
              <div style={{ fontSize: '0.8125rem', color: 'var(--text-main)', marginBottom: '0.5rem' }}>
                <strong>Summary:</strong> {interpretedResult.summary}
              </div>
              <pre className="mono" style={{ fontSize: '0.75rem', background: '#ffffff', padding: '0.75rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}>
                {JSON.stringify({
                  extracted: interpretedResult.extracted,
                  categoryRules: interpretedResult.categoryRules,
                  deliveryRules: interpretedResult.deliveryRules,
                  brandRules: interpretedResult.brandRules,
                }, null, 2)}
              </pre>
              <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem' }}>
                <Button size="sm" variant="primary" onClick={applyInterpreted}>
                  Apply to Preferences
                </Button>
                <Button size="sm" variant="outline" onClick={() => setInterpretedResult(null)}>
                  Discard
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
