import React, { useState, useEffect } from 'react';
import { api } from '../../services/api';
import { Icons } from '../../components/ui/Icons';
import StatusBadge from '../../components/ui/StatusBadge';
import Button from '../../components/ui/Button';
import Dialog from '../../components/ui/Dialog';
import EmptyState from '../../components/ui/EmptyState';
import { TableRowSkeleton } from '../../components/ui/Skeleton';
import './MerchantPortal.css';

export default function MerchantOrders() {
  const [orders, setOrders] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [fulfilling, setFulfilling] = useState(false);
  const [activeFilter, setActiveFilter] = useState('ALL');
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('MERCHANT_OUT_OF_STOCK');

  useEffect(() => {
    fetchOrders();
    const interval = setInterval(fetchOrders, 4000);
    return () => clearInterval(interval);
  }, []);

  const fetchOrders = async () => {
    try {
      const res = await api.getMerchantOrders();
      setOrders(res.orders || []);
      setSummary(res.summary || null);
    } catch (e) {
      console.error('Failed to load merchant orders', e);
    } finally {
      setLoading(false);
    }
  };

  const handleAdvanceFulfillment = async (orderId, targetStatus) => {
    try {
      setFulfilling(true);
      await api.fulfillMerchantOrder(orderId, {
        targetStatus,
        carrier: 'AgentPay Test Logistics (Simulated Courier)',
      });
      await fetchOrders();
      if (selectedOrder && selectedOrder.id === orderId) {
        setSelectedOrder((prev) => ({
          ...prev,
          orderStatus: targetStatus,
          fulfillmentStatus: targetStatus,
          status: targetStatus,
        }));
      }
    } catch (err) {
      alert('Failed to advance fulfillment: ' + (err.message || 'Server error'));
    } finally {
      setFulfilling(false);
    }
  };

  const handleCancelOrder = async (orderId) => {
    try {
      setFulfilling(true);
      await api.cancelMerchantOrder(orderId, { reason: cancelReason });
      await fetchOrders();
      setShowCancelModal(false);
      setSelectedOrder(null);
    } catch (err) {
      alert('Failed to cancel order: ' + (err.message || 'Server error'));
    } finally {
      setFulfilling(false);
    }
  };

  const formatCurrency = (amt) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amt || 0);

  const formatDate = (d) => {
    if (!d) return 'Just now';
    return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const filteredOrders = orders.filter((o) => {
    if (activeFilter === 'ALL') return true;
    if (activeFilter === 'CONFIRMED') return o.fulfillmentStatus === 'CONFIRMED' || o.orderStatus === 'CONFIRMED';
    if (activeFilter === 'PROCESSING') return o.fulfillmentStatus === 'PROCESSING';
    if (activeFilter === 'PACKED') return o.fulfillmentStatus === 'PACKED';
    if (activeFilter === 'SHIPPED') return o.fulfillmentStatus === 'SHIPPED' || o.fulfillmentStatus === 'OUT_FOR_DELIVERY';
    if (activeFilter === 'DELIVERED') return o.fulfillmentStatus === 'DELIVERED' || o.fulfillmentStatus === 'COMPLETED';
    if (activeFilter === 'CANCELLED') return o.fulfillmentStatus === 'CANCELLED' || o.orderStatus === 'BLOCKED_INTEGRITY_EXCEPTION';
    return true;
  });

  const totalOrdersCount = summary?.totalOrders ?? orders.length;
  const confirmedCount = summary?.confirmedCount ?? orders.filter((o) => o.fulfillmentStatus === 'CONFIRMED').length;
  const inFulfillmentCount = (summary?.processingCount ?? 0) + (summary?.packedCount ?? 0);
  const shippedCount = (summary?.shippedCount ?? 0) + (summary?.deliveredCount ?? 0) + (summary?.completedCount ?? 0);
  const cancelledCount = (summary?.cancelledCount ?? 0) + (summary?.blockedCount ?? 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="text-h1">AI-Originated Orders & Fulfillment</h1>
          <p className="text-body" style={{ marginTop: 2 }}>
            Authoritative order ledger of autonomous AI purchases with two-phase inventory locking and fulfillment tracking.
          </p>
        </div>


      </div>

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
        <div className="card-panel" style={{ padding: '1rem 1.25rem' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-subtle)', textTransform: 'uppercase' }}>Total Orders</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-main)', marginTop: 4 }}>{totalOrdersCount}</div>
          <div style={{ fontSize: '0.6875rem', color: 'var(--text-subtle)', marginTop: 2 }}>AI-initiated purchases</div>
        </div>

        <div className="card-panel" style={{ padding: '1rem 1.25rem' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#16a34a', textTransform: 'uppercase' }}>Confirmed</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#16a34a', marginTop: 4 }}>{confirmedCount}</div>
          <div style={{ fontSize: '0.6875rem', color: 'var(--text-subtle)', marginTop: 2 }}>Payment captured & locked</div>
        </div>

        <div className="card-panel" style={{ padding: '1rem 1.25rem' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#2563eb', textTransform: 'uppercase' }}>In Fulfillment</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#2563eb', marginTop: 4 }}>{inFulfillmentCount}</div>
          <div style={{ fontSize: '0.6875rem', color: 'var(--text-subtle)', marginTop: 2 }}>Processing & packing</div>
        </div>

        <div className="card-panel" style={{ padding: '1rem 1.25rem' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#7c3aed', textTransform: 'uppercase' }}>Shipped / Delivered</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#7c3aed', marginTop: 4 }}>{shippedCount}</div>
          <div style={{ fontSize: '0.6875rem', color: 'var(--text-subtle)', marginTop: 2 }}>Handed to carrier</div>
        </div>

        <div className="card-panel" style={{ padding: '1rem 1.25rem' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#dc2626', textTransform: 'uppercase' }}>Cancelled / Voided</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#dc2626', marginTop: 4 }}>{cancelledCount}</div>
          <div style={{ fontSize: '0.6875rem', color: 'var(--text-subtle)', marginTop: 2 }}>Stock released</div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {[
          { key: 'ALL', label: `All Orders (${orders.length})` },
          { key: 'CONFIRMED', label: `Confirmed (${confirmedCount})` },
          { key: 'PROCESSING', label: 'Processing' },
          { key: 'PACKED', label: 'Packed' },
          { key: 'SHIPPED', label: 'Shipped' },
          { key: 'DELIVERED', label: 'Delivered' },
          { key: 'CANCELLED', label: `Cancelled (${cancelledCount})` },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`btn-filter-pill ${activeFilter === tab.key ? 'active' : ''}`}
            onClick={() => setActiveFilter(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Orders Table */}
      <div className="card-panel">
        {loading ? (
          <div className="table-scroll">
            <table className="table-clean">
              <thead>
                <tr>
                  <th>Product & Order Ref</th>
                  <th>Buyer Agent</th>
                  <th>Pricing</th>
                  <th>Payment State</th>
                  <th>Fulfillment Status</th>
                  <th style={{ textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                <TableRowSkeleton cols={6} />
                <TableRowSkeleton cols={6} />
              </tbody>
            </table>
          </div>
        ) : filteredOrders.length === 0 ? (
          <EmptyState
            icon={<Icons.Receipt size={24} />}
            title="No orders found"
            description="There are no orders matching the selected filter criteria."
          />
        ) : (
          <div className="table-scroll">
            <table className="table-clean">
              <thead>
                <tr>
                  <th>Product & Order Ref</th>
                  <th>Buyer Agent</th>
                  <th>Pricing</th>
                  <th>Payment State</th>
                  <th>Fulfillment Status</th>
                  <th style={{ textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map((o) => (
                  <tr key={o.orderId || o.id}>
                    <td>
                      <div style={{ fontWeight: 600, color: 'var(--text-main)' }}>{o.productName || 'Catalog Product'}</div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 2 }}>
                        <span className="mono" style={{ fontSize: '0.75rem', fontWeight: 600, color: '#2563eb' }}>
                          {o.orderNumber || o.merchantOrderId}
                        </span>
                        {o.sku && (
                          <span style={{ fontSize: '0.6875rem', color: 'var(--text-subtle)', backgroundColor: '#f1f5f9', padding: '1px 5px', borderRadius: 3 }}>
                            {o.sku}
                          </span>
                        )}
                      </div>
                    </td>

                    <td>
                      <span style={{ fontSize: '0.6875rem', fontWeight: 600, backgroundColor: 'var(--accent-subtle)', color: 'var(--accent-text)', padding: '2px 6px', borderRadius: 4, display: 'inline-block', marginBottom: 2 }}>
                        {o.buyerType || 'Autonomous Buyer'}
                      </span>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-subtle)' }}>{o.buyerMasked || 'Masked Buyer'}</div>
                    </td>

                    <td>
                      <div style={{ fontWeight: 700, color: 'var(--text-main)' }}>
                        {formatCurrency(o.amount)}
                      </div>
                      <div style={{ fontSize: '0.6875rem', color: 'var(--text-subtle)' }}>
                        Qty: {o.quantity || 1}
                      </div>
                    </td>

                    <td>
                      <span style={{ fontSize: '0.75rem', color: o.paymentStatus === 'VERIFIED' ? 'var(--success-text)' : '#d97706', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Icons.Check size={13} /> {o.paymentStatus === 'VERIFIED' ? 'Verified (Test Rails)' : o.paymentStatus}
                      </span>
                    </td>

                    <td>
                      <StatusBadge status={o.fulfillmentStatus || o.orderStatus || 'CONFIRMED'} label={o.fulfillmentStatus || o.orderStatus || 'Confirmed'} />
                      <div style={{ fontSize: '0.6875rem', color: 'var(--text-subtle)', marginTop: 2 }}>
                        {formatDate(o.createdAt)}
                      </div>
                    </td>

                    <td style={{ textAlign: 'right' }}>
                      <Button size="sm" variant="outline" onClick={() => setSelectedOrder(o)}>
                        Manage & Details
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Order Detail & Fulfillment Dialog */}
      {selectedOrder && (
        <Dialog
          isOpen={Boolean(selectedOrder)}
          onClose={() => setSelectedOrder(null)}
          title={`Order: ${selectedOrder.orderNumber || selectedOrder.merchantOrderId || selectedOrder.id}`}
          subtitle="Autonomous order ledger and fulfillment management"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: '1rem', borderBottom: '1px solid var(--border-subtle)' }}>
              <div>
                <h3 className="text-h3">{selectedOrder.productName}</h3>
                <p className="text-small" style={{ color: 'var(--text-subtle)' }}>
                  SKU: <strong>{selectedOrder.sku || 'N/A'}</strong> • Buyer: <strong>{selectedOrder.buyerName || selectedOrder.buyerMasked}</strong>
                </p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#2563eb' }}>{formatCurrency(selectedOrder.amount)}</div>
                <StatusBadge status={selectedOrder.fulfillmentStatus || selectedOrder.orderStatus || 'CONFIRMED'} label={selectedOrder.fulfillmentStatus || selectedOrder.orderStatus || 'Confirmed'} />
              </div>
            </div>

            {/* Fulfillment Progression Controller */}
            {selectedOrder.fulfillmentStatus !== 'CANCELLED' && selectedOrder.orderStatus !== 'BLOCKED_INTEGRITY_EXCEPTION' && (
              <div style={{ padding: '1rem', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div style={{ fontWeight: 700, fontSize: '0.8125rem', color: '#0f172a' }}>Advance Fulfillment State:</div>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {selectedOrder.fulfillmentStatus === 'CONFIRMED' && (
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={fulfilling}
                      onClick={() => handleAdvanceFulfillment(selectedOrder.id, 'PROCESSING')}
                      icon={<Icons.Activity size={14} />}
                    >
                      Mark as Processing
                    </Button>
                  )}

                  {selectedOrder.fulfillmentStatus === 'PROCESSING' && (
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={fulfilling}
                      onClick={() => handleAdvanceFulfillment(selectedOrder.id, 'PACKED')}
                      icon={<Icons.Package size={14} />}
                    >
                      Mark as Packed
                    </Button>
                  )}

                  {selectedOrder.fulfillmentStatus === 'PACKED' && (
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={fulfilling}
                      onClick={() => handleAdvanceFulfillment(selectedOrder.id, 'SHIPPED')}
                      icon={<Icons.Layers size={14} />}
                    >
                      Dispatch & Ship (Assign Courier Tracking)
                    </Button>
                  )}

                  {selectedOrder.fulfillmentStatus === 'SHIPPED' && (
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={fulfilling}
                      onClick={() => handleAdvanceFulfillment(selectedOrder.id, 'OUT_FOR_DELIVERY')}
                      icon={<Icons.Activity size={14} />}
                    >
                      Mark Out for Delivery
                    </Button>
                  )}

                  {selectedOrder.fulfillmentStatus === 'OUT_FOR_DELIVERY' && (
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={fulfilling}
                      onClick={() => handleAdvanceFulfillment(selectedOrder.id, 'DELIVERED')}
                      icon={<Icons.Check size={14} />}
                    >
                      Confirm Delivery
                    </Button>
                  )}

                  {selectedOrder.fulfillmentStatus === 'DELIVERED' && (
                    <span style={{ fontSize: '0.8125rem', color: '#059669', fontWeight: 700 }}>
                      ✓ Order completely fulfilled and delivered to buyer.
                    </span>
                  )}

                  {['CONFIRMED', 'PROCESSING', 'PACKED'].includes(selectedOrder.fulfillmentStatus) && (
                    <Button
                      size="sm"
                      variant="outline"
                      style={{ color: '#dc2626', borderColor: '#fca5a5' }}
                      onClick={() => setShowCancelModal(true)}
                    >
                      Cancel Order
                    </Button>
                  )}
                </div>
              </div>
            )}

            {/* Canonical Technical Metadata */}
            <div className="mono" style={{ padding: '0.875rem', backgroundColor: 'var(--bg-subtle)', borderRadius: 'var(--radius-md)', fontSize: '0.75rem', lineHeight: 1.6, color: 'var(--text-muted)' }}>
              <div><strong>Order Number:</strong> {selectedOrder.orderNumber}</div>
              <div><strong>Purchase Intent ID:</strong> {selectedOrder.purchaseIntentId || 'N/A'}</div>
              <div><strong>Transaction ID:</strong> {selectedOrder.transactionId || selectedOrder.paymentId || 'N/A'}</div>
              <div><strong>Quote ID:</strong> {selectedOrder.quoteId || 'QUOTE-SNAPSHOT-ACTIVE'}</div>
              <div><strong>Tracking Number:</strong> {selectedOrder.trackingNumber || (['SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(selectedOrder.fulfillmentStatus) ? selectedOrder.trackingNumber : 'Assigned upon courier dispatch')}</div>
              <div><strong>Carrier:</strong> {selectedOrder.carrier || 'AgentPay Express Logistics'}</div>
              <div><strong>Payment Rails:</strong> Razorpay (HMAC-SHA256 Cryptographically Verified)</div>
              <div><strong>Inventory Accounting:</strong> Atomic reservation committed (Stock decremented)</div>
              {selectedOrder.cancellationReason && (
                <div style={{ color: '#dc2626', marginTop: 4 }}><strong>Cancellation Reason:</strong> {selectedOrder.cancellationReason}</div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <Button variant="secondary" onClick={() => setSelectedOrder(null)}>
                Close
              </Button>
            </div>
          </div>
        </Dialog>
      )}

      {/* Cancel Reason Modal */}
      {showCancelModal && (
        <Dialog
          isOpen={showCancelModal}
          onClose={() => setShowCancelModal(false)}
          title="Cancel Order & Release Inventory"
          subtitle="Select cancellation reason for audit log and inventory release"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-main)', display: 'block', marginBottom: 4 }}>
                Cancellation Reason:
              </label>
              <select
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: '0.875rem' }}
              >
                <option value="MERCHANT_OUT_OF_STOCK">Inventory Unavailable / Out of Stock</option>
                <option value="PRICE_DISCREPANCY">Price Discrepancy / Stale Quote</option>
                <option value="BUYER_REQUESTED_CANCEL">Buyer Requested Cancellation</option>
                <option value="SYSTEM_RECONCILIATION">Administrative Reconciliation</option>
              </select>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
              <Button variant="secondary" onClick={() => setShowCancelModal(false)}>
                Back
              </Button>
              <Button
                variant="primary"
                style={{ backgroundColor: '#dc2626', borderColor: '#dc2626' }}
                disabled={fulfilling}
                onClick={() => handleCancelOrder(selectedOrder.id)}
              >
                Confirm Cancellation
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
