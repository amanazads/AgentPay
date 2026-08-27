import React from 'react';

export function Skeleton({ width = '100%', height = '1rem', borderRadius = 'var(--radius-sm)', style = {} }) {
  return (
    <div
      className="skeleton"
      style={{
        width,
        height,
        borderRadius,
        ...style,
      }}
    />
  );
}

export function MetricCardSkeleton() {
  return (
    <div className="card-panel" style={{ padding: '1.25rem' }}>
      <Skeleton width="40%" height="0.75rem" style={{ marginBottom: '0.75rem' }} />
      <Skeleton width="60%" height="1.75rem" style={{ marginBottom: '0.5rem' }} />
      <Skeleton width="80%" height="0.75rem" />
    </div>
  );
}

export function TableRowSkeleton({ cols = 5 }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, idx) => (
        <td key={idx} style={{ padding: '1rem' }}>
          <Skeleton width="80%" height="1rem" />
        </td>
      ))}
    </tr>
  );
}
