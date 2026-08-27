import React, { useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { Icons } from '../ui/Icons';

export default function MobileNavDrawer({
  isOpen,
  onClose,
  role = 'BUYER',
  user = null,
  onLogout = () => {},
}) {
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const buyerLinks = [
    { to: '/buyer/home', label: 'Home', icon: Icons.Home, end: true },
    { to: '/buyer/purchases', label: 'Purchases', icon: Icons.Receipt },
    { to: '/buyer/preferences', label: 'Preferences', icon: Icons.Sliders },
    { to: '/buyer/connections', label: 'Connections', icon: Icons.Store },
    { to: '/buyer/settings', label: 'Settings', icon: Icons.Settings },
  ];

  const merchantLinks = [
    { to: '/merchant/dashboard', label: 'Dashboard', icon: Icons.Dashboard, end: true },
    { to: '/merchant/products', label: 'Products', icon: Icons.Package },
    { to: '/merchant/ai-commerce', label: 'AI Commerce', icon: Icons.Sparkles },
    { to: '/merchant/orders', label: 'Orders', icon: Icons.Receipt },
    { to: '/merchant/analytics', label: 'Analytics', icon: Icons.Analytics },
    { to: '/merchant/store', label: 'Store Profile', icon: Icons.Store },
    { to: '/merchant/settings', label: 'Settings', icon: Icons.Settings },
  ];

  const links = role === 'MERCHANT' ? merchantLinks : buyerLinks;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Mobile Navigation"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
      }}
    >
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'absolute',
          inset: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.5)',
          backdropFilter: 'blur(3px)',
        }}
      />

      {/* Sliding Sheet Surface */}
      <div
        style={{
          position: 'relative',
          width: '82%',
          maxWidth: 320,
          height: '100%',
          backgroundColor: 'var(--bg-surface)',
          boxShadow: 'var(--shadow-modal)',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 1,
          animation: 'slide-right 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {/* Header */}
        <div
          style={{
            height: 'var(--header-h)',
            padding: '0 1.25rem',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={{
                width: 26,
                height: 26,
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--primary)',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                fontSize: '0.75rem',
              }}
            >
              AP
            </span>
            <strong style={{ fontSize: '1rem', color: 'var(--text-main)' }}>AgentPay</strong>
            <span
              style={{
                fontSize: '0.6875rem',
                fontWeight: 600,
                padding: '2px 6px',
                borderRadius: 4,
                backgroundColor: role === 'MERCHANT' ? '#ecfdf5' : '#f1f5f9',
                color: role === 'MERCHANT' ? '#065f46' : '#0f172a',
              }}
            >
              {role === 'MERCHANT' ? 'Merchant' : 'Buyer'}
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            style={{
              padding: '6px',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-subtle)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <Icons.X size={16} />
          </button>
        </div>

        {/* Links Navigation */}
        <nav
          style={{
            flex: 1,
            padding: '1rem 0.75rem',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
          }}
        >
          {links.map((link) => {
            const Icon = link.icon;
            return (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                onClick={onClose}
                style={({ isActive }) => ({
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  padding: '0.65rem 0.875rem',
                  borderRadius: 'var(--radius-md)',
                  fontSize: '0.875rem',
                  fontWeight: isActive ? 600 : 500,
                  color: isActive ? 'var(--primary)' : 'var(--text-muted)',
                  backgroundColor: isActive ? 'var(--bg-subtle)' : 'transparent',
                  border: isActive ? '1px solid var(--border-color)' : '1px solid transparent',
                  transition: 'background-color 0.15s ease',
                })}
              >
                <Icon size={16} />
                <span>{link.label}</span>
              </NavLink>
            );
          })}
        </nav>

        {/* Footer & User Profile */}
        <div
          style={{
            padding: '1rem 1.25rem',
            borderTop: '1px solid var(--border-color)',
            backgroundColor: 'var(--bg-subtle)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
            <div style={{ overflow: 'hidden' }}>
              <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-main)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                {user?.name || user?.email?.split('@')[0] || 'User Account'}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-subtle)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                {user?.email}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              onClose();
              onLogout();
            }}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              padding: '0.5rem',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-color)',
              backgroundColor: 'var(--bg-surface)',
              color: 'var(--danger-text)',
              fontSize: '0.8125rem',
              fontWeight: 500,
            }}
          >
            <Icons.LogOut size={14} />
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}
