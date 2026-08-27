import React from 'react';
import Button from './Button';

export default function EmptyState({
  icon = null,
  title = 'No items found',
  description = 'There is nothing here yet.',
  actionLabel = null,
  onAction = null,
  secondaryActionLabel = null,
  onSecondaryAction = null,
  style = {},
}) {
  return (
    <div
      style={{
        padding: '3rem 1.5rem',
        textAlign: 'center',
        backgroundColor: 'var(--bg-surface)',
        border: '1px dashed var(--border-strong)',
        borderRadius: 'var(--radius-lg)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        ...style,
      }}
    >
      {icon && (
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: '50%',
            backgroundColor: 'var(--bg-subtle)',
            color: 'var(--text-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '1rem',
          }}
        >
          {icon}
        </div>
      )}

      <h3 className="text-h3" style={{ marginBottom: '0.25rem', color: 'var(--text-main)' }}>
        {title}
      </h3>

      <p className="text-body" style={{ maxWidth: 420, marginBottom: actionLabel ? '1.25rem' : 0 }}>
        {description}
      </p>

      {(actionLabel || secondaryActionLabel) && (
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'center' }}>
          {secondaryActionLabel && (
            <Button variant="secondary" onClick={onSecondaryAction}>
              {secondaryActionLabel}
            </Button>
          )}
          {actionLabel && (
            <Button variant="primary" onClick={onAction}>
              {actionLabel}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
