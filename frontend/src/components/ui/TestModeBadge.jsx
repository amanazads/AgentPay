import React from 'react';
import { Icons } from './Icons';

export default function TestModeBadge({ compact = false }) {
  if (compact) {
    return (
      <span
        title="AgentPay is operating on Razorpay Test Rails. No real financial charges occur."
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '2px 6px',
          backgroundColor: '#fffbeb',
          border: '1px solid #fde68a',
          color: '#92400e',
          borderRadius: 'var(--radius-xs)',
          fontSize: '0.6875rem',
          fontWeight: 700,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
        }}
      >
        <Icons.Shield size={10} />
        Test Mode
      </span>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        padding: '0.35rem 0.75rem',
        backgroundColor: '#fffbeb',
        borderBottom: '1px solid #fde68a',
        color: '#92400e',
        fontSize: '0.75rem',
        fontWeight: 500,
        justifyContent: 'center',
      }}
    >
      <Icons.Shield size={13} />
      <span>
        <strong>DEMO ENVIRONMENT:</strong> Autonomous transactions run via Razorpay test rails with simulated settlements.
      </span>
    </div>
  );
}
