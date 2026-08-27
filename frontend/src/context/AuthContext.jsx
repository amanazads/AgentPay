import React, { createContext, useContext, useState, useEffect } from 'react';
import { api } from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    validateSession();
  }, []);

  const validateSession = async () => {
    const token = localStorage.getItem('agentpay_token');

    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }

    try {
      // Validate against live database
      const res = await api.getMe();
      if (res?.user) {
        const normalizedRole = (res.user.role || 'BUYER').toUpperCase();
        const liveUserData = { ...res.user, role: normalizedRole };
        setUser(liveUserData);
        localStorage.setItem('agentpay_user', JSON.stringify(liveUserData));
      } else {
        throw new Error('User not found in database');
      }
    } catch (err) {
      console.warn('Session invalid or user deleted from database. Clearing local session.');
      localStorage.removeItem('agentpay_token');
      localStorage.removeItem('agentpay_user');
      localStorage.removeItem('agentpay_initial_role');
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  const login = async (email, password) => {
    try {
      const res = await api.login({ email, password });
      const normalizedRole = (res.user?.role || 'BUYER').toUpperCase();
      const userData = { ...res.user, role: normalizedRole };
      setUser(userData);
      localStorage.setItem('agentpay_token', res.token);
      localStorage.setItem('agentpay_user', JSON.stringify(userData));
      return { ...res, user: userData };
    } catch (e) {
      throw e;
    }
  };

  const signup = async (name, email, password, role = 'BUYER') => {
    try {
      const res = await api.signup({ name, email, password, role: role.toUpperCase() });
      const normalizedRole = (res.user?.role || role).toUpperCase();
      const userData = { ...res.user, role: normalizedRole };
      setUser(userData);
      localStorage.setItem('agentpay_token', res.token);
      localStorage.setItem('agentpay_user', JSON.stringify(userData));
      return { ...res, user: userData };
    } catch (e) {
      throw e;
    }
  };

  const loginWithGoogle = async (role = 'BUYER') => {
    try {
      const res = await api.loginWithGoogle({
        name: 'Aman Kumar (Google)',
        email: 'aman@agentpay.ai',
        role: role.toUpperCase(),
      });
      const normalizedRole = (res.user?.role || role).toUpperCase();
      const userData = { ...res.user, role: normalizedRole };
      setUser(userData);
      localStorage.setItem('agentpay_token', res.token);
      localStorage.setItem('agentpay_user', JSON.stringify(userData));
      return { ...res, user: userData };
    } catch (e) {
      throw e;
    }
  };

  const logout = async () => {
    try {
      await api.logout().catch(() => null);
    } catch {
      // Ignore network errors on logout
    }
    setUser(null);
    localStorage.removeItem('agentpay_token');
    localStorage.removeItem('agentpay_user');
    localStorage.removeItem('agentpay_initial_role');
  };

  const isMerchant = (user?.role || '').toUpperCase() === 'MERCHANT';
  const isBuyer = (user?.role || 'BUYER').toUpperCase() === 'BUYER';

  return (
    <AuthContext.Provider
      value={{
        user,
        role: user?.role || 'BUYER',
        isMerchant,
        isBuyer,
        loading,
        isAuthenticated: !!user,
        isAdmin: user?.role === 'admin',
        login,
        signup,
        loginWithGoogle,
        logout,
        validateSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
