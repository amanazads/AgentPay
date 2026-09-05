import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../services/api';
import { Icons } from '../../components/ui/Icons';
import Button from '../../components/ui/Button';
import AICommerceDemoRunner from '../../components/demo/AICommerceDemoRunner';
import './MerchantPortal.css';

export default function MerchantAICommerce() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [merchantProducts, setMerchantProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [selectedProductId, setSelectedProductId] = useState(null);
  const [selectedScenario, setSelectedScenario] = useState('happy_path');
  const [showDemo, setShowDemo] = useState(searchParams.get('runDemo') === 'true');
  const [catalogCategory, setCatalogCategory] = useState('ALL');

  useEffect(() => {
    fetchAICommerce();
  }, []);

  const fetchAICommerce = async () => {
    // Both sources are MERCHANT-SCOPED. This previously also called
    // api.getAICommerceReadinessData(), which is
    // /api/simulation/commerce/catalog-readiness — global demo data belonging to
    // the simulation lab, not to this merchant. Mixing it into the real merchant
    // dashboard leaked other merchants' catalog into this store's view.
    //
    // Failures are no longer swallowed with .catch(() => null): a failed request
    // must surface as "unable to verify", never as a fabricated perfect score.
    setLoading(true);
    setLoadError(null);
    try {
      const [readinessRes, productsRes] = await Promise.all([
        api.getMerchantAICommerce(),
        api.getMerchantProducts(),
      ]);
      setData(readinessRes);
      setMerchantProducts(productsRes?.products || []);
    } catch (e) {
      console.error('Failed to load AI commerce data', e);
      setData(null);
      setMerchantProducts([]);
      setLoadError(e?.message || 'The server did not respond.');
    } finally {
      setLoading(false);
    }
  };

  const handleLaunchProductDemo = (productId, scenario = 'happy_path') => {
    setSelectedProductId(productId);
    setSelectedScenario(scenario);
    setShowDemo(true);
  };

  // NOTHING here defaults to a verified value. Every figure comes from the
  // backend response or is not shown at all. The previous fallbacks (`?? 6` and
  // a hardcoded six-pillar array claiming "27/27 products") rendered a perfect
  // 6/6 scorecard whenever the API call failed — a false-positive readiness
  // claim that a merchant could reasonably act on.
  const verifiedPillars = data?.verifiedPillarsCount ?? null;
  const totalPillars = data?.totalPillarsCount ?? null;
  const pillars = data?.pillars || [];
  const readinessPercent =
    verifiedPillars !== null && totalPillars ? Math.round((verifiedPillars / totalPillars) * 100) : null;

  const products = merchantProducts;
  const categories = ['ALL', ...new Set(products.map((p) => p.category || 'Electronics'))];
  const filteredProducts = catalogCategory === 'ALL'
    ? products
    : products.filter((p) => (p.category || '').toUpperCase() === catalogCategory.toUpperCase());

  const formatCurrency = (val) => {
    const num = parseFloat(val) || 0;
    return `₹${num.toLocaleString('en-IN')}`;
  };

  if (loading) {
    return (
      <div className="card-panel" style={{ padding: '3rem', textAlign: 'center' }}>
        <div style={{ fontSize: '1rem', fontWeight: 600, color: '#1e293b' }}>
          Checking merchant readiness...
        </div>
        <p className="text-small" style={{ color: 'var(--text-subtle)', marginTop: 6 }}>
          Reading your store's live catalog, inventory and payment configuration.
        </p>
      </div>
    );
  }

  if (loadError || !data) {
    // Explicitly NOT a scorecard. We do not know this store's readiness, so we
    // say so rather than showing numbers we did not receive.
    return (
      <div className="card-panel" style={{ padding: '2rem', border: '1px solid #fecaca', backgroundColor: '#fef2f2' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#991b1b', fontWeight: 700, marginBottom: 8 }}>
          <Icons.ShieldAlert size={20} color="#dc2626" />
          <span>Unable to verify merchant readiness</span>
        </div>
        <p className="text-small" style={{ color: '#7f1d1d', lineHeight: 1.6, marginBottom: '1rem' }}>
          We could not reach your store's readiness data{loadError ? `: ${loadError}` : '.'} No readiness
          score is shown, because we do not have one — this is not a report that your store is unready,
          only that we could not check.
        </p>
        <Button variant="primary" onClick={fetchAICommerce} icon={<Icons.Activity size={15} />}>
          Retry
        </Button>
      </div>
    );
  }

  if (showDemo) {
    return (
      <AICommerceDemoRunner
        initialProductId={selectedProductId}
        initialScenario={selectedScenario}
        onBackToReadiness={() => {
          setShowDemo(false);
          setSearchParams({});
        }}
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Header & Store Environment */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="text-h1">Make your store ready for AI buyers</h1>
          <p className="text-body" style={{ marginTop: 2 }}>
            AgentPay turns your catalog into an AI-readable and AI-transactable commerce experience.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <Button
            variant="primary"
            onClick={() => handleLaunchProductDemo(products[0]?.id || null, 'happy_path')}
            icon={<Icons.Sparkles size={16} />}
          >
            Preview Autonomous Purchase
          </Button>
        </div>
      </div>

      {/* Main Scorecard Banner & Global Demo Launcher */}
      <div className="card-panel" style={{ padding: '1.75rem', background: '#f8fafc', border: '1px solid #e2e8f0' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1.5rem' }}>
          <div>
            <span className="text-caption" style={{ textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.05em', color: 'var(--text-subtle)' }}>
              AI Commerce Readiness
            </span>
            <div style={{ fontSize: '2.5rem', fontWeight: 800, color: readinessPercent === 100 ? '#065f46' : '#92400e', letterSpacing: '-0.03em', lineHeight: 1.1, marginTop: 4 }}>
              {verifiedPillars} / {totalPillars} Capabilities Verified
            </div>
            <p className="text-small" style={{ color: '#334155', marginTop: 6, fontWeight: 500 }}>
              {/* No invented catalog counts. If the backend did not send a
                  health summary, we say nothing rather than claiming 27 products. */}
              {data.catalogHealthText || 'Catalog summary unavailable for this store.'}
            </p>
          </div>

          <div style={{ width: '100%', maxWidth: 360 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-subtle)', marginBottom: 6 }}>
              <span>Readiness Diagnostic</span>
              {/* Reports the actual computed percentage. This was hardcoded to
                  "100% Operational" regardless of the real score. */}
              <span style={{ color: readinessPercent === 100 ? '#166534' : '#92400e', fontWeight: 700 }}>
                {readinessPercent}% {readinessPercent === 100 ? 'Operational' : 'Ready'}
              </span>
            </div>
            <div style={{ width: '100%', height: 8, backgroundColor: '#e2e8f0', borderRadius: 'var(--radius-full)', overflow: 'hidden' }}>
              <div style={{ width: `${readinessPercent ?? 0}%`, height: '100%', backgroundColor: readinessPercent === 100 ? '#16a34a' : '#d97706', borderRadius: 'var(--radius-full)' }} />
            </div>

            <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
              <Button
                variant="primary"
                size="sm"
                style={{ width: '100%' }}
                onClick={() => handleLaunchProductDemo(products[0]?.id || null, 'happy_path')}
                icon={<Icons.Sparkles size={14} />}
              >
                Preview Autonomous Purchase Flow
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* 6 Real Evidence-Based Capabilities Grid */}
      <div className="card-panel" style={{ padding: '1.25rem 1.5rem' }}>
        <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-subtle)', marginBottom: '0.75rem' }}>
          Six-Pillar Commerce Capability Verification
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0.75rem' }}>
          {pillars.map((p, idx) => (
            <div key={idx} style={{ padding: '0.875rem 1rem', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 'var(--radius-md)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#1e293b' }}>{p.name}</span>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: p.verified ? '#16a34a' : '#d97706' }}>
                  {p.verified ? '✓ Verified' : p.status}
                </span>
              </div>
              <div style={{ fontSize: '0.71875rem', color: 'var(--text-subtle)', lineHeight: 1.35 }}>
                {p.description}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* AI-Transactable Catalog Section */}
      <div className="card-panel">
        <div className="card-panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h2 className="card-panel-title">AI-Readable Products Catalog</h2>
            <p className="card-panel-sub">
              Every product in your catalog is indexed with machine-readable specifications and real-time inventory locking.
            </p>
          </div>

          {/* Category Filter Pills */}
          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                className={`btn-filter-pill ${catalogCategory === cat ? 'active' : ''}`}
                onClick={() => setCatalogCategory(cat)}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        <div className="card-panel-body">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem' }}>
            {filteredProducts.length === 0 && (
              <div style={{ gridColumn: '1 / -1', padding: '2rem', textAlign: 'center', color: 'var(--text-subtle)', fontSize: '0.875rem' }}>
                {products.length === 0
                  ? 'No products in your catalog yet. Add products to become discoverable by AI buyers.'
                  : `No products in the "${catalogCategory}" category.`}
              </div>
            )}
            {filteredProducts.map((prod) => {
              const isOutOfStock = !prod.inStock || prod.inventory === 0;

              return (
                <div
                  key={prod.id}
                  style={{
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-md)',
                    padding: '1.25rem',
                    backgroundColor: '#ffffff',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.5rem' }}>
                      <span className="badge-tag">{prod.category}</span>
                      {/* Badges report the backend's own per-product verdict.
                          "Discoverable ✓" used to be printed unconditionally,
                          and transactability was inferred from stock alone —
                          both claimed more than the server had verified. */}
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: prod.aiDiscoverable ? '#16a34a' : '#92400e', backgroundColor: prod.aiDiscoverable ? '#dcfce7' : '#fef3c7', padding: '2px 6px', borderRadius: 4 }}>
                          {prod.aiDiscoverable ? 'Discoverable ✓' : 'Not discoverable'}
                        </span>
                        <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: prod.aiTransactable ? '#16a34a' : '#dc2626', backgroundColor: prod.aiTransactable ? '#dcfce7' : '#fee2e2', padding: '2px 6px', borderRadius: 4 }}>
                          {prod.aiTransactable ? 'Transactable ✓' : (isOutOfStock ? 'Out of Stock ✕' : 'Not transactable ✕')}
                        </span>
                      </div>
                    </div>

                    <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-main)', margin: '0 0 0.25rem 0' }}>
                      {prod.name}
                    </h3>
                    <p style={{ fontSize: '0.78125rem', color: 'var(--text-subtle)', margin: '0 0 0.75rem 0', lineHeight: 1.4 }}>
                      {prod.aiSummary || prod.description}
                    </p>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.5rem 0.75rem', backgroundColor: '#f8fafc', borderRadius: 6, marginBottom: '0.75rem' }}>
                      <div>
                        <div style={{ fontSize: '0.6875rem', color: 'var(--text-subtle)' }}>Catalog Price</div>
                        <div style={{ fontWeight: 700, fontSize: '0.9375rem', color: 'var(--text-main)' }}>
                          {formatCurrency(prod.price)}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '0.6875rem', color: 'var(--text-subtle)' }}>Available Stock</div>
                        <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: !isOutOfStock ? '#166534' : '#dc2626' }}>
                          {/* Real stock only. `prod.inventory || 25` reported
                              25 units for any product whose stock was 0. */}
                          {!isOutOfStock ? `${prod.inventory} in stock` : '0 available'}
                        </div>
                      </div>
                    </div>

                    {!prod.aiTransactable && prod.readinessReason && (
                      <div style={{ fontSize: '0.71875rem', color: '#92400e', backgroundColor: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 6, padding: '0.4rem 0.6rem', marginBottom: '0.75rem' }}>
                        {prod.readinessReason}
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                    <Button
                      variant="primary"
                      size="sm"
                      style={{ flex: 1 }}
                      disabled={isOutOfStock}
                      onClick={() => handleLaunchProductDemo(prod.id, 'happy_path')}
                      icon={<Icons.Sparkles size={13} />}
                    >
                      {isOutOfStock ? 'Out of Stock' : 'Preview AI Purchase'}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleLaunchProductDemo(prod.id, 'price_surge_blocked')}
                      title="Test Price Surge Block Guard"
                    >
                      Test Guard
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
