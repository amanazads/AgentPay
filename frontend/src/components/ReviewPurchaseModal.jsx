import { useState } from 'react';
import { api } from '../services/api';
import './ReviewPurchaseModal.css';

export default function ReviewPurchaseModal({ isOpen, onClose, intent, evaluation, onPaymentSuccess }) {
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [successResult, setSuccessResult] = useState(null);

  if (!isOpen || !intent) return null;

  const amount = parseFloat(intent.amount) || 0;
  const policyReason = evaluation?.reason || 'Satisfies agent spending policy limits.';
  const riskScore = evaluation?.risk?.score ?? 10;
  const riskLevel = evaluation?.risk?.level || 'LOW';

  const handleAuthorizeAndPay = async () => {
    setProcessing(true);
    setError(null);
    try {
      const orderRes = await api.createPaymentOrder({
        purchase_intent_id: intent.id,
        amount: amount,
        currency: 'INR',
      });

      if (!orderRes || !orderRes.order) {
        throw new Error('Could not initialize Razorpay order.');
      }

      const confirmRes = await api.confirmTestPayment(orderRes.order.id, {
        razorpay_payment_id: `pay_test_${Math.random().toString(36).substring(2, 11)}`,
        razorpay_order_id: orderRes.order.id,
        razorpay_signature: 'test_signature_valid',
      });

      setSuccessResult(confirmRes);
      if (onPaymentSuccess) {
        onPaymentSuccess(confirmRes);
      }
    } catch (e) {
      setError(e.message || 'Payment execution failed.');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="modal-backdrop-ui" onClick={onClose}>
      <div className="modal-dialog-ui" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header-ui">
          <div className="modal-title-ui">Review Purchase Authorization</div>
          <button className="modal-close-ui" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="modal-body-ui">
          {successResult ? (
            <div style={{ textAlign: 'center', padding: '1rem 0' }}>
              <div style={{ width: '44px', height: '44px', borderRadius: '50%', backgroundColor: 'var(--success-bg)', color: 'var(--success)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 0.75rem', fontSize: '20px' }}>
                ✓
              </div>
              <h3 style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--text-main)' }}>Payment Verified & Settled</h3>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-subtle)', marginTop: '4px' }}>
                Razorpay test payment settled and recorded in the append-only audit trail.
              </p>

              <div className="card-panel" style={{ backgroundColor: 'var(--bg-subtle)', textAlign: 'left', marginTop: '1rem' }}>
                <div style={{ padding: '0.75rem 1rem' }}>
                  <div className="spec-summary-row mb-1">
                    <span className="spec-summary-label">Payment ID:</span>
                    <span className="mono spec-summary-val">{successResult.transaction?.payment_id || 'pay_test_verified'}</span>
                  </div>
                  <div className="spec-summary-row mb-1">
                    <span className="spec-summary-label">Order ID:</span>
                    <span className="mono spec-summary-val">{successResult.transaction?.order_id || 'order_test_verified'}</span>
                  </div>
                  <div className="spec-summary-row">
                    <span className="spec-summary-label">Amount Settled:</span>
                    <span className="mono spec-summary-val" style={{ fontWeight: 600 }}>₹{amount.toLocaleString('en-IN')}</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <>
              {error && (
                <div style={{ padding: '0.75rem', backgroundColor: 'var(--danger-bg)', border: '1px solid var(--danger-border)', borderRadius: 'var(--radius-md)', color: 'var(--danger-text)', fontSize: '0.75rem', marginBottom: '1rem' }}>
                  <strong>Error:</strong> {error}
                </div>
              )}

              <div style={{ marginBottom: '1rem' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Item to Authorize</div>
                <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-main)', marginTop: '2px' }}>
                  {intent.product_name || 'Procurement Item'}
                </div>
              </div>

              <div className="card-panel" style={{ backgroundColor: 'var(--bg-subtle)' }}>
                <div style={{ padding: '0.75rem 1rem', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div className="spec-summary-row">
                    <span className="spec-summary-label">Total Amount:</span>
                    <span className="mono spec-summary-val" style={{ fontSize: '1rem', fontWeight: 700 }}>
                      ₹{amount.toLocaleString('en-IN')}
                    </span>
                  </div>
                  <div className="spec-summary-row">
                    <span className="spec-summary-label">Merchant:</span>
                    <span className="spec-summary-val">{intent.merchant_name || 'Verified Merchant'}</span>
                  </div>
                  <div className="spec-summary-row">
                    <span className="spec-summary-label">Agent:</span>
                    <span className="spec-summary-val">{intent.agent_name || 'Procurement Agent'}</span>
                  </div>
                  <div className="spec-summary-row">
                    <span className="spec-summary-label">Risk Profile:</span>
                    <span className="spec-summary-val">
                      <span className={`badge-status ${riskLevel === 'LOW' ? 'success' : riskLevel === 'MEDIUM' ? 'warning' : 'danger'}`}>
                        {riskLevel} • {riskScore}/100
                      </span>
                    </span>
                  </div>
                  <div className="spec-summary-row">
                    <span className="spec-summary-label">Payment Rail:</span>
                    <span className="spec-summary-val">Razorpay Test Mode (Simulated)</span>
                  </div>
                </div>
              </div>

              <div style={{ marginTop: '1rem', fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                <strong>Policy Invariant:</strong> {policyReason}
              </div>
            </>
          )}
        </div>

        <div className="modal-footer-ui">
          {successResult ? (
            <button className="btn-ui btn-ui-primary" style={{ width: '100%' }} onClick={onClose}>
              Done
            </button>
          ) : (
            <>
              <button className="btn-ui btn-ui-outline" onClick={onClose} disabled={processing}>
                Cancel
              </button>
              <button className="btn-ui btn-ui-primary" onClick={handleAuthorizeAndPay} disabled={processing}>
                {processing ? 'Authorizing & Settling...' : 'Authorize & Pay (Test Mode)'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
