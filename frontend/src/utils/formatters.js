/**
 * Format currency in INR with Indian numbering system
 */
export function formatINR(amount) {
  if (amount == null) return '₹0';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Format a large number compactly (e.g., 1.2L, 45K)
 */
export function formatCompact(num) {
  if (num >= 10000000) return `${(num / 10000000).toFixed(1)}Cr`;
  if (num >= 100000) return `${(num / 100000).toFixed(1)}L`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}

/**
 * Format a timestamp to human-readable form
 */
export function formatTime(timestamp) {
  if (!timestamp) return '—';
  const d = new Date(timestamp);
  return d.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Format relative time (e.g., "2 minutes ago")
 */
export function formatRelativeTime(timestamp) {
  if (!timestamp) return '—';
  const seconds = Math.floor((Date.now() - new Date(timestamp)) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/**
 * Get the status badge class for a decision
 */
export function getDecisionBadge(decision) {
  switch (decision?.toUpperCase()) {
    case 'ALLOW':
    case 'ALLOWED':
    case 'APPROVED':
    case 'COMPLETED':
    case 'VERIFIED':
    case 'PAYMENT_COMPLETED':
      return 'badge-success';
    case 'APPROVAL_REQUIRED':
    case 'PENDING':
    case 'EVALUATING':
      return 'badge-warning';
    case 'BLOCK':
    case 'BLOCKED':
    case 'REJECTED':
    case 'PAYMENT_FAILED':
    case 'CANCELLED':
      return 'badge-danger';
    default:
      return 'badge-neutral';
  }
}

/**
 * Get the status emoji for a decision
 */
export function getDecisionIcon(decision) {
  switch (decision?.toUpperCase()) {
    case 'ALLOW':
    case 'ALLOWED':
    case 'APPROVED':
    case 'COMPLETED':
      return '✓';
    case 'APPROVAL_REQUIRED':
    case 'PENDING':
      return '⏳';
    case 'BLOCK':
    case 'BLOCKED':
    case 'REJECTED':
      return '✕';
    default:
      return '•';
  }
}

/**
 * Truncate text to a max length
 */
export function truncate(text, maxLength = 50) {
  if (!text || text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '…';
}
