import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../services/api';
import { Icons } from '../../components/ui/Icons';
import StatusBadge from '../../components/ui/StatusBadge';
import Button from '../../components/ui/Button';
import { MetricCardSkeleton } from '../../components/ui/Skeleton';
import './MerchantPortal.css';

export default function MerchantOverview() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchOverview();
    const interval = setInterval(fetchOverview, 4000);
    return () => clearInterval(interval);
  }, []);

  const fetchOverview = async () => {
    try {
      const res = await api.getMerchantOverview();
      setData(res);
    } catch (e) {
      console.error('Failed to load merchant overview', e);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amt) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amt || 0);

  const m = data?.metrics || {};
  const orders = data?.recentOrders || [];
  const catalog = data?.catalogPreview || [];
  const pillars = data?.readinessPillars || [];
  const funnel = data?.funnel || [];
  const safety = data?.safetyBlocks || m.safetyBlocks || {};

  const verifiedPillars = pillars.filter((p) => p.verified || p.status === 'READY' || p.status === 'ACTIVE' || p.status === 'CONNECTED').length;
  const totalPillars = pillars.length || 6;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* 1. Header & Store Environment */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="text-h1">Grow your business with AI buyers</h1>
          <p className="text-body" style={{ marginTop: 2 }}>
            Make your catalog discoverable and transactable by autonomous AI agents.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="environment-badge">
            SANDBOX TEST ENVIRONMENT (RAZORPAY TEST RAILS)
          </span>
          <Button variant="secondary" onClick={() => navigate('/merchant/ai-commerce')} icon={<Icons.Sparkles size={15} />}>
            Preview AI Buyer
          </Button>
          <Button variant="primary" onClick={() => navigate('/merchant/products')} icon={<Icons.Plus size={15} />}>
            Add Product
          </Button>
        </div>
      </div>

      {/* 2. Top 4 Database Metric Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
        {loading ? (
          <>
            <MetricCardSkeleton />
            <MetricCardSkeleton />
            <MetricCardSkeleton />
            <MetricCardSkeleton />
          </>
        ) : (
          <>
            {/* Card 1: AI-Attributed Sandbox GMV */}
            <div className="card-panel" style={{ padding: '1.25rem' }}>
              <div className="text-caption" style={{ textTransform: 'uppercase', fontWeight: 600, color: 'var(--text-subtle)', marginBottom: 4 }}>
                AI-Attributed Sandbox GMV
              </div>
              <div className="text-h1" style={{ fontSize: '1.75rem', color: 'var(--text-main)' }}>
                {formatCurrency(m.totalRevenue ?? m.aiRevenue ?? 0)}
              </div>
              <div className="text-caption" style={{ marginTop: 4, color: (m.totalOrders || 0) > 0 ? 'var(--success-text)' : 'var(--text-subtle)' }}>
                {(m.totalOrders || 0) > 0 ? `Across ${m.totalOrders} verified AI orders` : 'No completed orders in current cycle'}
              </div>
            </div>

            {/* Card 2: Completed AI Orders */}
            <div className="card-panel" style={{ padding: '1.25rem' }}>
              <div className="text-caption" style={{ textTransform: 'uppercase', fontWeight: 600, color: 'var(--text-subtle)', marginBottom: 4 }}>
                Completed AI Orders
              </div>
              <div className="text-h1" style={{ fontSize: '1.75rem', color: 'var(--text-main)' }}>
                {m.totalOrders ?? m.aiOrdersCount ?? 0}
              </div>
              <div className="text-caption" style={{ marginTop: 4, color: 'var(--text-subtle)' }}>
                Direct machine agent checkouts
              </div>
            </div>

            {/* Card 3: AI Conversion Rate */}
            <div className="card-panel" style={{ padding: '1.25rem' }}>
              <div className="text-caption" style={{ textTransform: 'uppercase', fontWeight: 600, color: 'var(--text-subtle)', marginBottom: 4 }}>
                AI Conversion Rate
              </div>
              <div className="text-h1" style={{ fontSize: '1.75rem', color: 'var(--text-main)' }}>
                {(m.conversionRate ?? m.aiConversionRate ?? 0)}%
              </div>
              <div className="text-caption" style={{ marginTop: 4, color: 'var(--text-subtle)' }}>
                {m.totalIntents ? `Across ${m.totalIntents} evaluated purchase intents` : 'Direct machine evaluations'}
              </div>
            </div>

            {/* Card 4: AI Commerce Readiness */}
            <div className="card-panel" style={{ padding: '1.25rem', cursor: 'pointer' }} onClick={() => navigate('/merchant/ai-commerce')}>
              <div className="text-caption" style={{ textTransform: 'uppercase', fontWeight: 600, color: 'var(--text-subtle)', marginBottom: 4 }}>
                AI Commerce Readiness
              </div>
              <div className="text-h1" style={{ fontSize: '1.75rem', color: '#065f46' }}>
                {verifiedPillars} / {totalPillars} Verified
              </div>
              <div className="text-caption" style={{ marginTop: 4, color: 'var(--accent)' }}>
                View 6-pillar evidence breakdown →
              </div>
            </div>
          </>
        )}
      </div>

      {/* 3. AI Transaction Safety & Blocked Transactions Panel */}
      <div className="card-panel" style={{ padding: '1.25rem 1.5rem', background: '#f8fafc', border: '1px solid #e2e8f0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Icons.ShieldCheck size={18} />
              <h2 className="card-panel-title" style={{ fontSize: '1rem', margin: 0 }}>AI Transaction Safety & Policy Enforcements</h2>
            </div>
            <p className="card-panel-sub" style={{ margin: '2px 0 0 0' }}>
              AgentPay prevents unauthorized orders, price tampering, and inventory overselling before payment is captured.
            </p>
          </div>
          <span className="control-badge-active" style={{ background: '#e0f2fe', color: '#0369a1' }}>
            Deterministic Protection Active
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', marginTop: '0.75rem' }}>
          <div className="safety-stat-card">
            <div className="safety-stat-label">Price Surges Blocked (&gt;2%)</div>
            <div className="safety-stat-value">{safety.priceSurges || 0}</div>
            <div className="safety-stat-hint">Quote revalidation halted surge</div>
          </div>
          <div className="safety-stat-card">
            <div className="safety-stat-label">Budget Limit Blocks</div>
            <div className="safety-stat-value">{safety.budgetLimits || 0}</div>
            <div className="safety-stat-hint">Escalated to human review</div>
          </div>
          <div className="safety-stat-card">
            <div className="safety-stat-label">Stock Unavailability Blocks</div>
            <div className="safety-stat-value">{safety.inventoryUnavailable || 0}</div>
            <div className="safety-stat-hint">Zero phantom cart checkouts</div>
          </div>
          <div className="safety-stat-card">
            <div className="safety-stat-label">Category / Risk Exclusions</div>
            <div className="safety-stat-value">{(safety.categoryRestricted || 0) + (safety.paymentAuthUnavailable || 0)}</div>
            <div className="safety-stat-hint">Unpermitted requests filtered</div>
          </div>
        </div>
      </div>

      {/* 4. AI Commerce Readiness 6-Pillar Diagnostic */}
      <div className="card-panel" style={{ padding: '1.25rem 1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div>
            <h2 className="card-panel-title" style={{ fontSize: '1.05rem', margin: 0 }}>AI Commerce Readiness Health</h2>
            <p className="card-panel-sub" style={{ margin: '2px 0 0 0' }}>
              Live diagnostic of store attributes required for autonomous agent discovery, quote locking, and execution.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => navigate('/merchant/ai-commerce')}>
            Detailed Diagnostic →
          </Button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0.75rem' }}>
          {pillars.map((p, idx) => (
            <div key={idx} style={{ padding: '0.875rem 1rem', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 'var(--radius-md)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: '0.78125rem', fontWeight: 700, color: '#334155' }}>{p.name}</span>
                <span style={{ fontSize: '0.71875rem', fontWeight: 700, color: p.verified || p.score >= 90 ? '#16a34a' : '#d97706' }}>
                  {p.verified || p.score >= 90 ? '✓ Verified' : `${p.score}%`}
                </span>
              </div>
              <div style={{ fontSize: '0.71875rem', color: 'var(--text-subtle)', lineHeight: 1.35 }}>
                {p.description}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 5. AI Commerce Funnel */}
      {funnel.length > 0 && (
        <div className="card-panel" style={{ padding: '1.25rem 1.5rem' }}>
          <div style={{ marginBottom: '1rem' }}>
            <h2 className="card-panel-title" style={{ fontSize: '1.05rem', margin: 0 }}>AI Commerce Conversion Funnel</h2>
            <p className="card-panel-sub" style={{ margin: '2px 0 0 0' }}>
              Direct machine interaction pipeline from autonomous search queries to confirmed order fulfillment.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.625rem' }}>
            {funnel.map((step, idx) => (
              <div key={idx} className="funnel-step-card">
                <div style={{ fontSize: '0.6875rem', textTransform: 'uppercase', color: 'var(--text-subtle)', fontWeight: 600, marginBottom: 2 }}>
                  Step {idx + 1}
                </div>
                <div style={{ fontSize: '0.78125rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: 4 }}>
                  {step.stage}
                </div>
                <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#1e3a8a' }}>
                  {step.count}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 6. Authoritative Catalog Overview Panel */}
      <div className="card-panel">
        <div className="card-panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <h2 className="card-panel-title">Catalog AI Discoverability & Transactability</h2>
            <p className="card-panel-sub">
              Your store products indexed with machine-readable specifications and real-time inventory locking.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => navigate('/merchant/products')}>
            Manage All Products ({m.aiReadableProducts || catalog.length}) →
          </Button>
        </div>

        <div className="card-panel-body" style={{ padding: 0 }}>
          {catalog.length === 0 ? (
            <div style={{ padding: '2.5rem 1.5rem', textAlign: 'center', color: 'var(--text-subtle)', fontSize: '0.875rem' }}>
              No products found in your catalog. Click "Add Product" to make your inventory discoverable by AI buyers.
            </div>
          ) : (
            <div className="table-scroll">
              <table className="table-clean">
                <thead>
                  <tr>
                    <th>Product & SKU</th>
                    <th>Category</th>
                    <th>Price</th>
                    <th>Inventory</th>
                    <th>AI Discoverable</th>
                    <th>AI Transactable</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {catalog.map((prod) => (
                    <tr key={prod.id}>
                      <td>
                        <div style={{ fontWeight: 600, color: 'var(--text-main)' }}>{prod.name}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-subtle)', fontFamily: 'var(--font-mono)' }}>
                          {prod.sku}
                        </div>
                      </td>
                      <td>
                        <span className="badge-tag">{prod.category}</span>
                      </td>
                      <td>
                        <span style={{ fontWeight: 700 }}>{formatCurrency(prod.price)}</span>
                      </td>
                      <td>
                        <span style={{ fontSize: '0.8125rem', color: prod.inventory > 0 ? '#166534' : '#dc2626', fontWeight: 600 }}>
                          {prod.inventory > 0 ? `${prod.inventory} in stock` : 'Out of stock'}
                        </span>
                      </td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#16a34a', fontSize: '0.8125rem', fontWeight: 600 }}>
                          <Icons.Check size={13} /> Active
                        </span>
                      </td>
                      <td>
                        {prod.aiPurchasable ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#16a34a', fontSize: '0.8125rem', fontWeight: 600 }}>
                            <Icons.Check size={13} /> Ready
                          </span>
                        ) : (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#d97706', fontSize: '0.8125rem', fontWeight: 600 }}>
                            <Icons.AlertTriangle size={13} /> Inactive
                          </span>
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn-ui btn-ui-outline btn-ui-sm"
                          onClick={() => navigate('/merchant/products')}
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* 7. Recent Autonomous AI Orders */}
      <div className="card-panel">
        <div className="card-panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <h2 className="card-panel-title">Recent Autonomous AI Orders</h2>
            <p className="card-panel-sub">
              Verified purchases discovered, evaluated, and settled by AI buyer agents.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => navigate('/merchant/orders')}>
            View All Orders ({orders.length}) →
          </Button>
        </div>

        <div className="card-panel-body" style={{ padding: 0 }}>
          {orders.length === 0 ? (
            <div style={{ padding: '3rem 1.5rem', textAlign: 'center' }}>
              <div style={{ width: 40, height: 40, borderRadius: '50%', backgroundColor: '#f1f5f9', color: '#64748b', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: '0.75rem' }}>
                <Icons.Receipt size={20} />
              </div>
              <h3 style={{ margin: '0 0 0.25rem 0', fontSize: '1rem', color: 'var(--text-main)', fontWeight: 600 }}>No AI orders received yet</h3>
              <p style={{ margin: 0, color: 'var(--text-subtle)', fontSize: '0.875rem' }}>
                Once an AI buyer purchases from your store, test-mode orders and payment verification events will stream here.
              </p>
              <div style={{ marginTop: '1rem' }}>
                <Button size="sm" variant="primary" onClick={() => navigate('/merchant/ai-commerce')} icon={<Icons.Sparkles size={14} />}>
                  Preview AI Buyer Purchase
                </Button>
              </div>
            </div>
          ) : (
            <div className="table-scroll">
              <table className="table-clean">
                <thead>
                  <tr>
                    <th>Product & Order Ref</th>
                    <th>Buyer</th>
                    <th>Amount</th>
                    <th>Payment</th>
                    <th>Order Status</th>
                    <th>Fulfillment</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((ord) => {
                    const rawDate = ord.created_at || ord.createdAt;
                    const parsedDate = rawDate && !isNaN(new Date(rawDate).getTime()) ? new Date(rawDate) : new Date();
                    const dateFormatted = parsedDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

                    return (
                      <tr key={ord.id}>
                        <td>
                          <div style={{ fontWeight: 600, color: 'var(--text-main)' }}>
                            {ord.product_name || ord.productName || 'Verified Catalog SKU'}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-subtle)', fontFamily: 'var(--font-mono)' }}>
                            {ord.order_number || ord.orderNumber}
                          </div>
                        </td>
                        <td>
                          <div style={{ fontSize: '0.8125rem', color: 'var(--text-main)' }}>
                            {ord.buyer_masked || ord.buyerMasked}
                          </div>
                          <div style={{ fontSize: '0.6875rem', color: 'var(--text-subtle)' }}>
                            {ord.buyerType || 'AI Buyer Agent'}
                          </div>
                        </td>
                        <td>
                          <span style={{ fontWeight: 700 }}>{formatCurrency(ord.amount)}</span>
                        </td>
                        <td>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#16a34a', fontSize: '0.8125rem', fontWeight: 600 }}>
                            <Icons.Check size={13} /> {ord.payment_status || 'Verified'}
                          </span>
                        </td>
                        <td>
                          <StatusBadge status={ord.order_status || 'CONFIRMED'} label="Confirmed" />
                        </td>
                        <td>
                          <span style={{ fontSize: '0.8125rem', color: '#475569', fontWeight: 500, backgroundColor: '#f1f5f9', padding: '0.2rem 0.5rem', borderRadius: 4 }}>
                            {ord.fulfillment_status || 'Awaiting Merchant Processing'}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontSize: '0.8125rem', color: 'var(--text-subtle)' }}>
                            {dateFormatted}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
