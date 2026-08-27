import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Icons } from '../ui/Icons';
import MobileNavDrawer from './MobileNavDrawer';
import './MerchantLayout.css';

export default function MerchantLayout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const handleSignOut = async () => {
    await logout();
    navigate('/', { replace: true });
  };

  return (
    <div className="merchant-layout-root">
      {/* Main Header */}
      <header className="merchant-nav-header">
        <div className="merchant-nav-content">
          <div className="merchant-brand-group">
            {/* Mobile Hamburger Toggle */}
            <button
              type="button"
              onClick={() => setIsMobileMenuOpen(true)}
              className="merchant-mobile-toggle"
              aria-label="Open mobile navigation"
            >
              <Icons.Menu size={20} />
            </button>

            {/* Logo */}
            <NavLink to="/merchant/dashboard" className="merchant-logo">
              <span className="merchant-logo-badge">AP</span>
              <span className="merchant-logo-text">AgentPay</span>
              <span className="merchant-role-chip">Merchant</span>
            </NavLink>

            {/* Desktop Navigation Links */}
            <nav className="merchant-nav-links" aria-label="Merchant Navigation">
              <NavLink to="/merchant/dashboard" end className={({ isActive }) => `merchant-tab-link ${isActive ? 'active' : ''}`}>
                <Icons.Dashboard size={15} />
                <span>Dashboard</span>
              </NavLink>

              <NavLink to="/merchant/products" className={({ isActive }) => `merchant-tab-link ${isActive ? 'active' : ''}`}>
                <Icons.Package size={15} />
                <span>Products</span>
              </NavLink>

              <NavLink to="/merchant/ai-commerce" className={({ isActive }) => `merchant-tab-link ${isActive ? 'active' : ''}`}>
                <Icons.Sparkles size={15} />
                <span>AI Commerce</span>
              </NavLink>

              <NavLink to="/merchant/orders" className={({ isActive }) => `merchant-tab-link ${isActive ? 'active' : ''}`}>
                <Icons.Receipt size={15} />
                <span>Orders</span>
              </NavLink>

              <NavLink to="/merchant/analytics" className={({ isActive }) => `merchant-tab-link ${isActive ? 'active' : ''}`}>
                <Icons.Analytics size={15} />
                <span>Analytics</span>
              </NavLink>

              <NavLink to="/merchant/store" className={({ isActive }) => `merchant-tab-link ${isActive ? 'active' : ''}`}>
                <Icons.Store size={15} />
                <span>Store</span>
              </NavLink>

              <NavLink to="/merchant/settings" className={({ isActive }) => `merchant-tab-link ${isActive ? 'active' : ''}`}>
                <Icons.Settings size={15} />
                <span>Settings</span>
              </NavLink>
            </nav>
          </div>

          {/* User Profile & Sign Out */}
          <div className="merchant-user-controls">
            <span className="merchant-user-pill">
              {user?.name || user?.email || 'Merchant Account'}
            </span>
            <button
              type="button"
              onClick={handleSignOut}
              className="merchant-signout-btn"
              title="Sign Out"
              aria-label="Sign Out"
            >
              <Icons.LogOut size={15} />
              <span className="hide-on-mobile">Sign out</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="merchant-main-content">
        <div className="merchant-page-container">
          {children}
        </div>
      </main>

      {/* Responsive Mobile Drawer */}
      <MobileNavDrawer
        isOpen={isMobileMenuOpen}
        onClose={() => setIsMobileMenuOpen(false)}
        role="MERCHANT"
        user={user}
        onLogout={handleSignOut}
      />
    </div>
  );
}
