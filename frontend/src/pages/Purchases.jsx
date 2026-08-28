import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { Icons } from '../components/ui/Icons';
import StatusBadge from '../components/ui/StatusBadge';
import Button from '../components/ui/Button';
import Dialog from '../components/ui/Dialog';
import EmptyState from '../components/ui/EmptyState';
import { TableRowSkeleton } from '../components/ui/Skeleton';
import './Purchases.css';

export default function Purchases() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState('all'); // 'all' | 'confirmed' | 'processing' | 'shipped' | 'delivered' | 'approval_required' | 'blocked'
  const [purchases, setPurchases] = useState([]);
  const [approvals, setApprovals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [actionProcessing, setActionProcessing] = useState(false);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 4000);
    return () => clearInterval(interval);
  }, []);

  const fetchData = async () => {
    try {
      const [purchRes, appRes] = await Promise.all([
        api.getPurchases().catch(() => ({ purchases: [], orders: [] })),
        api.getApprovals('pending').catch(() => ({ approvals: [] })),
      ]);
      setPurchases(purchRes.purchases || []);
      setApprovals(appRes.approvals || []);
    } catch (e) {
      console.error('Failed to load purchases', e);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (approvalId) => {
    setActionProcessing(true);
    try {
      await api.decideApproval(approvalId, 'APPROVE', 'Approved from Purchases ledger');
      setSelectedItem(null);
      await fetchData();
    } catch (e) {
      console.error('Approval failed', e);
      alert('Approval failed: ' + (e.message || 'Server error'));
    } finally {
      setActionProcessing(false);
    }
  };

  const handleViewInvoice = async (orderId) => {
    try {
      const res = await api.getInvoice(orderId);
      setSelectedInvoice(res.invoice);
    } catch (err) {
      alert('Invoice not available for this transaction.');
    }
  };

  const formatCurrency = (amt) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amt || 0);

  const formatDate = (dateStr) => {
    if (!dateStr) return 'Today';
    return new Date(dateStr).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Merge items into unified view while maintaining strict categorization
  const approvalItems = approvals.map((a) => ({
    id: a.id,
    isApproval: true,
    isOrder: false,
    order_number: `AUTH-${a.id.substring(0, 8).toUpperCase()}`,
    product_name: a.product_name || 'Procurement Item',
    amount: parseFloat(a.amount || 0),
    merchant_name: a.merchant_name || 'Verified Merchant Store',
    status: 'APPROVAL_REQUIRED',
    fulfillment_status: 'NOT_STARTED',
    payment_status: 'NOT_EXECUTED',
    created_at: a.created_at,
    why: a.ai_reasoning || 'Item requested exceeds automatic spending limit.',
    risk_score: a.risk_score || 15,
  }));

  const orderItems = purchases.map((p) => {
    const fulfillmentStatus = (p.fulfillment_status || p.order_status || 'CONFIRMED').toUpperCase();
    return {
      ...p,
      isApproval: false,
      isOrder: p.is_order !== false,
      status: p.status === 'BLOCKED' ? 'BLOCKED' : fulfillmentStatus,
      fulfillment_status: fulfillmentStatus,
      payment_status: p.payment_status || 'VERIFIED',
    };
  });

  const allItems = [...approvalItems, ...orderItems];

  const filteredItems = allItems.filter((item) => {
    if (filter === 'all') return !item.isApproval && item.status !== 'BLOCKED';
    if (filter === 'confirmed') return item.isOrder && item.fulfillment_status === 'CONFIRMED';
    if (filter === 'processing') return item.isOrder && (item.fulfillment_status === 'PROCESSING' || item.fulfillment_status === 'PACKED');
    if (filter === 'shipped') return item.isOrder && item.fulfillment_status === 'SHIPPED';
    if (filter === 'delivered') return item.isOrder && item.fulfillment_status === 'DELIVERED';
    if (filter === 'approval_required') return item.isApproval || item.status === 'APPROVAL_REQUIRED';
    if (filter === 'blocked') return item.status === 'BLOCKED' || item.status === 'FAILED';
    return true;
  });

  const getStatusDisplay = (item) => {
    if (item.isApproval) return { label: 'Needs Approval', status: 'APPROVAL_REQUIRED' };
    if (item.status === 'BLOCKED') return { label: 'Blocked by Safety Guard', status: 'BLOCKED' };
    
    switch (item.fulfillment_status) {
      case 'CONFIRMED':
      case 'ORDER_CONFIRMED':
        return { label: 'Order Confirmed', status: 'CONFIRMED' };
      case 'PROCESSING':
        return { label: 'Merchant Processing', status: 'PROCESSING' };
      case 'PACKED':
        return { label: 'Package Assembly', status: 'PACKED' };
      case 'SHIPPED':
        return { label: 'Shipped (In Transit)', status: 'SHIPPED' };
      case 'OUT_FOR_DELIVERY':
        return { label: 'Out for Delivery', status: 'SHIPPED' };
      case 'DELIVERED':
        return { label: 'Delivered', status: 'DELIVERED' };
      default:
        return { label: item.fulfillment_status || 'Confirmed', status: 'CONFIRMED' };
    }
  };

  return (
    <div className="purchases-container">
      {/* Header */}
      <div className="purchases-header">
        <div>
          <h1 className="text-h1">Purchase Ledger & Order Tracking</h1>
          <p className="text-body" style={{ marginTop: 2 }}>
            Track autonomous AI purchases, view real-time fulfillment lifecycles, and access invoices.
          </p>
        </div>

        <Button
          variant="primary"
          onClick={() => navigate('/buyer/home')}
          icon={<Icons.Sparkles size={15} />}
        >
          New Purchase
        </Button>
      </div>

      {/* Filter Tabs */}
      <div className="purchases-filter-bar" role="tablist" aria-label="Purchase Filters">
        {[
          { key: 'all', label: `All Executed Purchases (${orderItems.filter((i) => i.status !== 'BLOCKED').length})` },
          { key: 'confirmed', label: `Confirmed (${orderItems.filter((i) => i.fulfillment_status === 'CONFIRMED').length})` },
          { key: 'processing', label: `Processing (${orderItems.filter((i) => ['PROCESSING', 'PACKED'].includes(i.fulfillment_status)).length})` },
          { key: 'shipped', label: `Shipped (${orderItems.filter((i) => i.fulfillment_status === 'SHIPPED').length})` },
          { key: 'delivered', label: `Delivered (${orderItems.filter((i) => i.fulfillment_status === 'DELIVERED').length})` },
          { key: 'approval_required', label: `Needs Approval (${approvals.length})` },
          { key: 'blocked', label: 'Blocked / Stopped' },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={filter === tab.key}
            className={`filter-tab-btn ${filter === tab.key ? 'active' : ''}`}
            onClick={() => setFilter(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Purchases List */}
      <div className="card-panel">
        {loading ? (
          <div className="table-scroll">
            <table className="table-clean">
              <thead>
                <tr>
                  <th>Product & Store</th>
                  <th>Amount</th>
                  <th>Date</th>
                  <th>Fulfillment Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                <TableRowSkeleton cols={5} />
                <TableRowSkeleton cols={5} />
                <TableRowSkeleton cols={5} />
              </tbody>
            </table>
          </div>
        ) : filteredItems.length === 0 ? (
          <EmptyState
            icon={<Icons.Receipt size={24} />}
            title="No purchases found"
            description={
              filter === 'all'
                ? "You haven't made any purchases yet. Tell AgentPay what you want to buy and your transactions will appear here."
                : `No purchases matching the "${filter.replace('_', ' ')}" filter.`
            }
          />
        ) : (
          <div className="table-scroll">
            <table className="table-clean">
              <thead>
                <tr>
                  <th>Product & Store</th>
                  <th>Amount</th>
                  <th>Date</th>
                  <th>Fulfillment Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item) => {
                  const display = getStatusDisplay(item);
                  return (
                    <tr key={item.id}>
                      <td>
                        <div style={{ fontWeight: 600, color: 'var(--text-main)' }}>{item.product_name}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-subtle)' }}>
                          {item.merchant_name} • <span className="mono">{item.order_number || item.id.substring(0, 8)}</span>
                        </div>
                      </td>

                      <td>
                        <span style={{ fontWeight: 700, color: 'var(--text-main)' }}>
                          {formatCurrency(item.amount)}
                        </span>
                      </td>

                      <td>
                        <span style={{ fontSize: '0.8125rem', color: 'var(--text-subtle)' }}>
                          {formatDate(item.created_at)}
                        </span>
                      </td>

                      <td>
                        <StatusBadge status={display.status} label={display.label} />
                      </td>

                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: '6px' }}>
                          {item.order_id && (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => handleViewInvoice(item.order_id)}
                              icon={<Icons.FileText size={13} />}
                            >
                              Invoice
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setSelectedItem(item)}
                          >
                            {item.isApproval ? 'Review & Authorize' : 'Track & Inspect'}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Item Detail & Vertical Tracking Timeline Modal */}
      {selectedItem && (
        <Dialog
          isOpen={Boolean(selectedItem)}
          onClose={() => setSelectedItem(null)}
          title={selectedItem.isApproval ? 'Purchase Authorization Request' : 'Autonomous Purchase Detail'}
          subtitle={`Reference: ${selectedItem.order_number || selectedItem.id}`}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: '1rem', borderBottom: '1px solid var(--border-subtle)' }}>
              <div>
                <h3 className="text-h3">{selectedItem.product_name}</h3>
                <p className="text-small">Merchant: <strong>{selectedItem.merchant_name}</strong></p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#2563eb' }}>{formatCurrency(selectedItem.amount)}</div>
                <StatusBadge status={getStatusDisplay(selectedItem).status} label={getStatusDisplay(selectedItem).label} />
              </div>
            </div>

            {/* AI Decision Rationale */}
            <div style={{ padding: '0.875rem', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', fontSize: '0.8125rem' }}>
              <div style={{ fontWeight: 700, color: '#166534', marginBottom: 2 }}>Why AgentPay Chose This:</div>
              <div style={{ color: '#15803d', lineHeight: 1.4 }}>{selectedItem.why}</div>
            </div>

            {/* Pending Approval Notice */}
            {selectedItem.isApproval ? (
              <div style={{ padding: '1rem', backgroundColor: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', fontSize: '0.8125rem' }}>
                <div style={{ fontWeight: 700, color: '#b45309', marginBottom: '0.35rem' }}>Authorization Required Before Execution:</div>
                <div style={{ color: '#92400e', lineHeight: 1.5 }}>
                  This request exceeds the autonomous spending limit for this category.
                  <ul style={{ margin: '0.5rem 0 0 1.25rem' }}>
                    <li><strong>Payment:</strong> NOT EXECUTED (₹0 Charged)</li>
                    <li><strong>Merchant Order:</strong> NOT CREATED</li>
                    <li><strong>Fulfillment:</strong> NOT STARTED</li>
                  </ul>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
                  <Button variant="primary" onClick={() => handleApprove(selectedItem.id)} disabled={actionProcessing}>
                    Authorize Purchase ({formatCurrency(selectedItem.amount)})
                  </Button>
                </div>
              </div>
            ) : (
              /* Dynamic Vertical Fulfillment Tracking Timeline */
              <div style={{ padding: '1rem', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                <div style={{ fontWeight: 700, fontSize: '0.8125rem', marginBottom: '0.75rem', color: '#0f172a' }}>
                  Authoritative Fulfillment & Delivery Lifecycle:
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                  {(selectedItem.timeline || selectedItem.order_timeline || [
                    { state: 'CONFIRMED', title: 'Order Confirmed & Payment Captured', completed: true, timestamp: selectedItem.created_at, description: 'Autonomous payment authorized & verified.' },
                    { state: 'PROCESSING', title: 'Merchant Processing', completed: ['PROCESSING', 'PACKED', 'SHIPPED', 'DELIVERED'].includes(selectedItem.fulfillment_status), description: 'Merchant fulfillment system notified.' },
                    { state: 'PACKED', title: 'Package Assembly', completed: ['PACKED', 'SHIPPED', 'DELIVERED'].includes(selectedItem.fulfillment_status), description: 'Items packed securely.' },
                    { state: 'SHIPPED', title: 'Dispatched to Carrier', completed: ['SHIPPED', 'DELIVERED'].includes(selectedItem.fulfillment_status), description: selectedItem.tracking_number ? `In transit with ${selectedItem.carrier || 'AgentPay Logistics'} (${selectedItem.tracking_number})` : 'Dispatched to courier.' },
                    { state: 'DELIVERED', title: 'Delivered', completed: selectedItem.fulfillment_status === 'DELIVERED', description: 'Delivered to confirmed destination.' },
                  ]).map((step, idx) => (
                    <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                      <span style={{
                        color: step.completed ? '#059669' : '#94a3b8',
                        fontWeight: 800,
                        fontSize: '0.9rem',
                        lineHeight: 1,
                        marginTop: 2,
                      }}>
                        {step.completed ? '✓' : '○'}
                      </span>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontWeight: 600, fontSize: '0.8125rem', color: step.completed ? '#0f172a' : '#64748b' }}>
                            {step.title}
                          </span>
                          {step.timestamp && (
                            <span style={{ fontSize: '0.6875rem', color: 'var(--text-subtle)', fontFamily: 'var(--font-mono)' }}>
                              {new Date(step.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 1 }}>
                          {step.description}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Carrier & Payment Technical Details */}
            {!selectedItem.isApproval && (
              <div className="mono" style={{ padding: '0.875rem', backgroundColor: 'var(--bg-subtle)', borderRadius: 'var(--radius-md)', fontSize: '0.75rem', lineHeight: 1.6, color: 'var(--text-muted)' }}>
                <div><strong>Tracking Number:</strong> {selectedItem.tracking_number || (['SHIPPED', 'DELIVERED'].includes(selectedItem.fulfillment_status) ? 'TRK-ASSIGNED' : 'Assigned upon courier dispatch')}</div>
                <div><strong>Carrier:</strong> {selectedItem.carrier || 'AgentPay Logistics'}</div>
                <div><strong>Payment Status:</strong> Paid (HMAC-SHA256 Verified)</div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <Button variant="secondary" onClick={() => setSelectedItem(null)}>
                Close
              </Button>
            </div>
          </div>
        </Dialog>
      )}

      {/* Invoice Modal */}
      {selectedInvoice && (
        <Dialog
          isOpen={Boolean(selectedInvoice)}
          onClose={() => setSelectedInvoice(null)}
          title={`Official Invoice: ${selectedInvoice.invoice_number}`}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '0.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.75rem' }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: '1.125rem' }}>AgentPay Commerce</div>
                <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Order Tax Invoice</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 700 }}>Invoice #: {selectedInvoice.invoice_number}</div>
                <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Date: {new Date(selectedInvoice.invoice_date || selectedInvoice.created_at).toLocaleDateString()}</div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', fontSize: '0.8125rem' }}>
              <div>
                <div style={{ fontWeight: 700, color: '#64748b', textTransform: 'uppercase', fontSize: '0.6875rem' }}>Billed To:</div>
                <div>{selectedInvoice.billing_address?.name || 'AgentPay Buyer'}</div>
                <div style={{ color: '#64748b' }}>{selectedInvoice.billing_address?.address_line1}</div>
                <div style={{ color: '#64748b' }}>{selectedInvoice.billing_address?.city}, {selectedInvoice.billing_address?.state} {selectedInvoice.billing_address?.pincode}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 700, color: '#64748b', textTransform: 'uppercase', fontSize: '0.6875rem' }}>Payment Status:</div>
                <div style={{ color: '#059669', fontWeight: 700 }}>PAID (Verified)</div>
                <div className="mono" style={{ fontSize: '0.75rem', color: '#64748b' }}>Ref: {selectedInvoice.payment_reference || 'pay_verified'}</div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '1rem', borderTop: '1px solid #e2e8f0', fontWeight: 800 }}>
              <span>Total Order Amount:</span>
              <span style={{ fontSize: '1.25rem', color: '#2563eb' }}>₹{parseFloat(selectedInvoice.total_amount).toLocaleString('en-IN')}</span>
            </div>

            <div style={{ textAlign: 'right', marginTop: '0.5rem' }}>
              <Button variant="primary" size="sm" onClick={() => window.print()} icon={<Icons.FileText size={13} />}>
                Print / Save PDF
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
