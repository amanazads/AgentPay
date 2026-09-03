import React, { useState, useEffect } from 'react';
import { api } from '../../services/api';
import { Icons } from '../../components/ui/Icons';
import { MetricCardSkeleton } from '../../components/ui/Skeleton';
import './MerchantPortal.css';

export default function MerchantAnalytics() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState('all');

  useEffect(() => {
    fetchAnalytics(timeRange);
  }, [timeRange]);

  const fetchAnalytics = async (range) => {
    try {
      setLoading(true);
      const res = await api.getMerchantAnalytics({ timeRange: range });
      setData(res);
    } catch (e) {
      console.error('Failed to load analytics', e);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amt) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amt || 0);

  const s = data?.summary || {};
  const funnel = data?.funnel || [];
  const outcomes = data?.outcomes || {};
  const revenueByBrand = data?.revenueByBrand || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="text-h1">AI Growth & Conversion Analytics</h1>
          <p className="text-body" style={{ marginTop: 2 }}>
            Authoritative performance metrics and purchase funnel calculated directly from canonical order and intent ledgers.
          </p>
        </div>

        {/* Time Range Selector */}
        <div style={{ display: 'flex', gap: '0.375rem', backgroundColor: '#f1f5f9', padding: 4, borderRadius: 8 }}>
          {[
            { key: 'today', label: 'Today' },
            { key: '7d', label: '7 Days' },
            { key: '30d', label: '30 Days' },
            { key: '90d', label: '90 Days' },
            { key: 'all', label: 'All Time' },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setTimeRange(tab.key)}
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                border: 'none',
                fontSize: '0.75rem',
                fontWeight: 600,
                cursor: 'pointer',
                backgroundColor: timeRange === tab.key ? '#ffffff' : 'transparent',
                color: timeRange === tab.key ? '#0f172a' : '#64748b',
                boxShadow: timeRange === tab.key ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                transition: 'all 0.15s ease',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Grid */}
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
            <div className="card-panel" style={{ padding: '1.25rem' }}>
              <div className="text-caption" style={{ textTransform: 'uppercase', fontWeight: 600, color: 'var(--text-subtle)', marginBottom: 4 }}>
                AI-Originated Revenue
              </div>
              <div className="text-h1" style={{ fontSize: '1.75rem', color: 'var(--text-main)' }}>
                {formatCurrency(s.aiOriginatedRevenue || 0)}
              </div>
              <div className="text-caption" style={{ marginTop: 4, color: 'var(--text-subtle)' }}>
                Across {s.aiOriginatedOrders || 0} valid completed orders
              </div>
            </div>

            <div className="card-panel" style={{ padding: '1.25rem' }}>
              <div className="text-caption" style={{ textTransform: 'uppercase', fontWeight: 600, color: 'var(--text-subtle)', marginBottom: 4 }}>
                Average Order Value (AOV)
              </div>
              <div className="text-h1" style={{ fontSize: '1.75rem', color: 'var(--text-main)' }}>
                {formatCurrency(s.averageOrderValue || 0)}
              </div>
              <div className="text-caption" style={{ marginTop: 4, color: '#2563eb', fontWeight: 500 }}>
                Revenue ÷ Completed orders
              </div>
            </div>

            <div className="card-panel" style={{ padding: '1.25rem' }}>
              <div className="text-caption" style={{ textTransform: 'uppercase', fontWeight: 600, color: 'var(--text-subtle)', marginBottom: 4 }}>
                AI Conversion Rate
              </div>
              <div className="text-h1" style={{ fontSize: '1.75rem', color: 'var(--text-main)' }}>
                {s.conversionRate ?? 0}%
              </div>
              <div className="text-caption" style={{ marginTop: 4, color: '#16a34a', fontWeight: 600 }}>
                {s.conversionFraction ? `${s.conversionFraction} (Orders ÷ Eligible intents)` : 'Calculated from eligible intents'}
              </div>
            </div>

            <div className="card-panel" style={{ padding: '1.25rem' }}>
              <div className="text-caption" style={{ textTransform: 'uppercase', fontWeight: 600, color: 'var(--text-subtle)', marginBottom: 4 }}>
                Upsell / Bundle Revenue
              </div>
              <div className="text-h1" style={{ fontSize: '1.75rem', color: 'var(--text-main)' }}>
                {formatCurrency(s.upsellRevenueContribution || 0)}
              </div>
              <div className="text-caption" style={{ marginTop: 4, color: 'var(--text-subtle)' }}>
                {s.upsellStatus || 'Not yet measured'} (0%)
              </div>
            </div>
          </>
        )}
      </div>

      {/* Discovery-to-Purchase Funnel */}
      <div className="card-panel">
        <div className="card-panel-header">
          <div>
            <h2 className="card-panel-title">AI Discovery-to-Purchase Funnel</h2>
            <p className="card-panel-sub">
              Deterministic progression of autonomous buyer interactions from catalog search to confirmed test-mode order.
            </p>
          </div>
        </div>

        <div className="card-panel-body" style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
          {funnel.length === 0 ? (
            <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-subtle)', fontSize: '0.875rem' }}>
              No funnel activity recorded for the selected time range.
            </div>
          ) : (
            funnel.map((stage, idx) => (
              <div
                key={idx}
                style={{
                  backgroundColor: '#f8fafc',
                  padding: '0.875rem 1.25rem',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid #e2e8f0',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontWeight: 600, fontSize: '0.875rem', color: '#0f172a' }}>{stage.stage}</span>
                  <span className="mono" style={{ fontWeight: 700, fontSize: '0.875rem', color: '#2563eb' }}>
                    {stage.count} events ({stage.percentage}%)
                  </span>
                </div>
                <div style={{ height: 8, backgroundColor: '#e2e8f0', borderRadius: 9999, overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${Math.max(4, Math.min(100, Number(stage.percentage) || 0))}%`,
                      backgroundColor: '#2563eb',
                      borderRadius: 9999,
                      transition: 'width 0.4s ease-in-out',
                    }}
                  />
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Order Outcomes & Brand Revenue Breakdown */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem' }}>
        {/* Order Outcome Breakdown */}
        <div className="card-panel">
          <div className="card-panel-header">
            <div>
              <h2 className="card-panel-title">Order Lifecycle Outcomes</h2>
              <p className="card-panel-sub">Breakdown of order resolution states across all purchase attempts.</p>
            </div>
          </div>

          <div className="card-panel-body" style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}>
              <span style={{ fontSize: '0.8125rem', color: '#0f172a', fontWeight: 500 }}>Confirmed & Paid</span>
              <span className="mono" style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#16a34a' }}>{outcomes.confirmed || 0}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}>
              <span style={{ fontSize: '0.8125rem', color: '#0f172a', fontWeight: 500 }}>In Fulfillment (Processing / Packed)</span>
              <span className="mono" style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#2563eb' }}>{(outcomes.processing || 0) + (outcomes.packed || 0)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}>
              <span style={{ fontSize: '0.8125rem', color: '#0f172a', fontWeight: 500 }}>Shipped / Delivered</span>
              <span className="mono" style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#7c3aed' }}>{(outcomes.shipped || 0) + (outcomes.delivered || 0)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}>
              <span style={{ fontSize: '0.8125rem', color: '#0f172a', fontWeight: 500 }}>Cancelled / Stock Released</span>
              <span className="mono" style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#dc2626' }}>{outcomes.cancelled || 0}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0' }}>
              <span style={{ fontSize: '0.8125rem', color: '#0f172a', fontWeight: 500 }}>Blocked by Policy / Surge</span>
              <span className="mono" style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#d97706' }}>{outcomes.blocked || 0}</span>
            </div>
          </div>
        </div>

        {/* Revenue by Brand */}
        <div className="card-panel">
          <div className="card-panel-header">
            <div>
              <h2 className="card-panel-title">AI Revenue by Brand</h2>
              <p className="card-panel-sub">Volume of AI purchasing distributed across catalog brands.</p>
            </div>
          </div>

          <div className="card-panel-body" style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
            {revenueByBrand.length === 0 ? (
              <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-subtle)', fontSize: '0.8125rem' }}>
                No brand revenue recorded yet.
              </div>
            ) : (
              revenueByBrand.map((b, idx) => (
                <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}>
                  <span style={{ fontSize: '0.8125rem', color: '#0f172a', fontWeight: 600 }}>{b.brand}</span>
                  <span className="mono" style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#2563eb' }}>
                    {formatCurrency(b.revenue)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
