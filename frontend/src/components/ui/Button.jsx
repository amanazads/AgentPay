import React from 'react';

export default function Button({
  children,
  variant = 'primary', // primary | secondary | accent | outline | danger
  size = 'md', // sm | md | lg
  type = 'button',
  disabled = false,
  loading = false,
  icon = null,
  onClick,
  className = '',
  style = {},
  ...props
}) {
  const variantClass = `btn-ui-${variant}`;
  const sizeClass = size === 'sm' ? 'btn-ui-sm' : size === 'lg' ? 'btn-ui-lg' : '';

  const renderIcon = () => {
    if (!icon) return null;
    if (React.isValidElement(icon)) {
      return <span style={{ display: 'inline-flex', alignItems: 'center' }}>{icon}</span>;
    }
    if (typeof icon === 'function') {
      const IconComponent = icon;
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center' }}>
          <IconComponent size={size === 'sm' ? 14 : 16} />
        </span>
      );
    }
    return null;
  };

  return (
    <button
      type={type}
      disabled={disabled || loading}
      onClick={onClick}
      className={`btn-ui ${variantClass} ${sizeClass} ${className}`}
      style={style}
      {...props}
    >
      {loading ? (
        <span
          style={{
            width: 14,
            height: 14,
            border: '2px solid currentColor',
            borderRightColor: 'transparent',
            borderRadius: '50%',
            display: 'inline-block',
            animation: 'spin 0.6s linear infinite',
          }}
        />
      ) : (
        renderIcon()
      )}
      {children && <span>{children}</span>}
    </button>
  );
}
