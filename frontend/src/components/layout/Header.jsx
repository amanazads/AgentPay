import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Icons } from '../ui/Icons';
import './Header.css';

export default function Header({ pendingCount = 0 }) {
  const { isAdmin, activeProfile, switchProfile } = useAuth();
  const navigate = useNavigate();

  const handleSwitchProfile = (profile) => {
    switchProfile(profile);
    if (profile === 'merchant') {
      navigate('/merchant/overview');
    } else {
      navigate('/home');
    }
  };

  const isMerchant = activeProfile === 'merchant';

  return (
    <header className="nav-header-root">
      <div className="nav-header-content">
        <div className="nav-brand-group">
          <NavLink to={isMerchant ? '/merchant/overview' : '/home'} className="nav-brand-logo">
            <span style={{ width: 22, height: 22, backgroundColor: '#0f172a', color: '#fff', borderRadius: 4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>
              AP
            </span>
            <span>AgentPay</span>
          </NavLink>

          {/* Role-Specific Navigation Links */}
          <nav className="nav-links-desktop">
            {!isMerchant ? (
              // BUYER NAVIGATION
              <>
                <NavLink to="/home" end className={({ isActive }) => `nav-tab-link ${isActive ? 'active' : ''}`}>
                  <Icons.Home size={15} />
                  <span>Home</span>
                </NavLink>

                <NavLink to="/purchases" className={({ isActive }) => `nav-tab-link ${isActive ? 'active' : ''}`}>
                  <Icons.Purchases size={15} />
                  <span>Purchases</span>
                  {pendingCount > 0 && (
                    <span style={{ padding: '1px 6px', backgroundColor: '#fef3c7', color: '#92400e', borderRadius: 9999, fontSize: '11px', fontWeight: 700 }}>
                      {pendingCount}
                    </span>
                  )}
                </NavLink>

                <NavLink to="/preferences" className={({ isActive }) => `nav-tab-link ${isActive ? 'active' : ''}`}>
                  <Icons.Preferences size={15} />
                  <span>Preferences</span>
                </NavLink>
              </>
            ) : (
              // MERCHANT NAVIGATION
              <>
                <NavLink to="/merchant/overview" className={({ isActive }) => `nav-tab-link ${isActive ? 'active' : ''}`}>
                  <span>Overview</span>
                </NavLink>

                <NavLink to="/merchant/products" className={({ isActive }) => `nav-tab-link ${isActive ? 'active' : ''}`}>
                  <span>Products</span>
                </NavLink>

                <NavLink to="/merchant/ai-commerce" className={({ isActive }) => `nav-tab-link ${isActive ? 'active' : ''}`}>
                  <span>AI Commerce</span>
                </NavLink>

                <NavLink to="/merchant/orders" className={({ isActive }) => `nav-tab-link ${isActive ? 'active' : ''}`}>
                  <span>Orders</span>
                </NavLink>

                <NavLink to="/merchant/analytics" className={({ isActive }) => `nav-tab-link ${isActive ? 'active' : ''}`}>
                  <span>Analytics</span>
                </NavLink>

                <NavLink to="/merchant/store" className={({ isActive }) => `nav-tab-link ${isActive ? 'active' : ''}`}>
                  <span>Store</span>
                </NavLink>
              </>
            )}

            {isAdmin && (
              <NavLink to="/admin" className={({ isActive }) => `nav-tab-link ${isActive ? 'active' : ''}`}>
                <Icons.Shield size={15} />
                <span>Admin Console</span>
              </NavLink>
            )}
          </nav>
        </div>

        <div className="nav-right-tools">
          {/* Top Profile Switcher Capsule */}
          <div className="profile-switcher-pill">
            <button
              type="button"
              className={`switcher-btn ${!isMerchant ? 'active' : ''}`}
              onClick={() => handleSwitchProfile('buyer')}
            >
              Buyer
            </button>
            <button
              type="button"
              className={`switcher-btn ${isMerchant ? 'active' : ''}`}
              onClick={() => handleSwitchProfile('merchant')}
            >
              Merchant
            </button>
          </div>

          <NavLink to="/settings" className={({ isActive }) => `nav-tab-link ${isActive ? 'active' : ''}`} style={{ padding: '6px 10px' }} aria-label="Settings">
            <Icons.Settings size={16} />
          </NavLink>
        </div>
      </div>
    </header>
  );
}
