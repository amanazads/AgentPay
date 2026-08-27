import React from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Icons } from '../ui/Icons';
import './MobileNav.css';

export default function MobileNav({ pendingCount = 0 }) {
  const { isAdmin } = useAuth();

  return (
    <nav className="bottom-nav-root">
      <NavLink to="/home" end className={({ isActive }) => `bottom-nav-tab ${isActive ? 'active' : ''}`}>
        <Icons.Home size={18} />
        <span>Home</span>
      </NavLink>

      <NavLink to="/purchases" className={({ isActive }) => `bottom-nav-tab ${isActive ? 'active' : ''}`}>
        <Icons.Purchases size={18} />
        <span>Purchases</span>
        {pendingCount > 0 && <span className="bottom-tab-badge">{pendingCount}</span>}
      </NavLink>

      <NavLink to="/preferences" className={({ isActive }) => `bottom-nav-tab ${isActive ? 'active' : ''}`}>
        <Icons.Preferences size={18} />
        <span>Preferences</span>
      </NavLink>

      {isAdmin && (
        <NavLink to="/admin" className={({ isActive }) => `bottom-nav-tab ${isActive ? 'active' : ''}`}>
          <Icons.Shield size={18} />
          <span>Admin</span>
        </NavLink>
      )}

      <NavLink to="/settings" className={({ isActive }) => `bottom-nav-tab ${isActive ? 'active' : ''}`}>
        <Icons.Settings size={18} />
        <span>Settings</span>
      </NavLink>
    </nav>
  );
}
