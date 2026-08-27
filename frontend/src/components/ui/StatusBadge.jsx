import React from 'react';
import { Icons } from './Icons';

export default function StatusBadge({ status, label = null, className = '' }) {
  if (!status) return null;

  const st = String(status).toUpperCase();
  let variant = 'neutral';
  let IconComponent = null;
  let displayLabel = label || st;

  switch (st) {
    case 'COMPLETED':
    case 'CONFIRMED':
    case 'ALLOWED':
    case 'ACTIVE':
    case 'SUCCESS':
    case 'PAYMENT_COMPLETED':
    case 'VERIFIED':
      variant = 'success';
      IconComponent = Icons.Check;
      if (!label) displayLabel = st === 'PAYMENT_COMPLETED' ? 'Completed' : st;
      break;

    case 'APPROVAL_REQUIRED':
    case 'EVALUATING':
    case 'PENDING':
    case 'AWAITING_POLICY_EVALUATION':
    case 'USER_AUTHENTICATION_REQUIRED':
      variant = 'warning';
      IconComponent = Icons.AlertTriangle;
      if (!label) displayLabel = st === 'USER_AUTHENTICATION_REQUIRED' || st === 'APPROVAL_REQUIRED' ? 'Approval Required' : 'Pending';
      break;

    case 'BLOCKED':
    case 'REJECTED':
    case 'FAILED':
    case 'PAYMENT_FAILED':
    case 'CANCELLED':
      variant = 'danger';
      IconComponent = Icons.ShieldAlert;
      if (!label) displayLabel = st === 'PAYMENT_FAILED' ? 'Failed' : st;
      break;

    case 'PAYMENT_PENDING':
    case 'CREATED':
    case 'CHECKOUT_PENDING':
    case 'CART_CREATED':
      variant = 'info';
      IconComponent = Icons.Clock;
      if (!label) displayLabel = 'Processing';
      break;

    default:
      variant = 'neutral';
      break;
  }

  return (
    <span className={`badge-status ${variant} ${className}`}>
      {IconComponent && <IconComponent size={11} style={{ marginRight: 2 }} />}
      {displayLabel}
    </span>
  );
}
