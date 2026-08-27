import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Icons } from '../ui/Icons';
import MobileNavDrawer from './MobileNavDrawer';
import './BuyerLayout.css';

export default function BuyerLayout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const handleSignOut = async () => {
    await logout();
    navigate('/', { replace: true });
  };

  return (
    <div className="buyer-layout-root">
      {/* Main Header */}
      <header className="buyer-nav-header">
        <div className="buyer-nav-content">
          <div className="buyer-brand-group">
            {/* Mobile Hamburger Toggle */}
            <button
              type="button"
              onClick={() => setIsMobileMenuOpen(true)}
              className="buyer-mobile-toggle"
              aria-label="Open mobile navigation"
            >
              <Icons.Menu size={20} />
            </button>

            {/* Logo */}
            <NavLink to="/buyer/home" className="buyer-logo">
              <span className="buyer-logo-badge">AP</span>
              <span className="buyer-logo-text">AgentPay</span>
              <span className="buyer-role-chip">Buyer</span>
            </NavLink>

            {/* Desktop Navigation Links */}
            <nav className="buyer-nav-links" aria-label="Buyer Navigation">
              <NavLink to="/buyer/home" end className={({ isActive }) => `buyer-tab-link ${isActive ? 'active' : ''}`}>
                <Icons.Home size={15} />
                <span>Home</span>
              </NavLink>

              <NavLink to="/buyer/purchases" className={({ isActive }) => `buyer-tab-link ${isActive ? 'active' : ''}`}>
                <Icons.Receipt size={15} />
                <span>Purchases</span>
              </NavLink>

              <NavLink to="/buyer/preferences" className={({ isActive }) => `buyer-tab-link ${isActive ? 'active' : ''}`}>
                <Icons.Sliders size={15} />
                <span>Preferences</span>
              </NavLink>

              <NavLink to="/buyer/connections" className={({ isActive }) => `buyer-tab-link ${isActive ? 'active' : ''}`}>
                <Icons.Store size={15} />
                <span>Connections</span>
              </NavLink>

              <NavLink to="/buyer/settings" className={({ isActive }) => `buyer-tab-link ${isActive ? 'active' : ''}`}>
                <Icons.Settings size={15} />
                <span>Settings</span>
              </NavLink>
            </nav>
          </div>

          {/* User Profile & Sign Out */}
          <div className="buyer-user-controls">
            <span className="buyer-user-pill">
              {user?.name || user?.email || 'Buyer Account'}
            </span>
            <button
              type="button"
              onClick={handleSignOut}
              className="buyer-signout-btn"
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
      <main className="buyer-main-content">
        <div className="buyer-page-container">
          {children}
        </div>
      </main>

      {/* Responsive Mobile Drawer */}
      <MobileNavDrawer
        isOpen={isMobileMenuOpen}
        onClose={() => setIsMobileMenuOpen(false)}
        role="BUYER"
        user={user}
        onLogout={handleSignOut}
      />
    </div>
  );
}
