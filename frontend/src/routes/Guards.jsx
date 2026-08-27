import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import BuyerLayout from '../components/layout/BuyerLayout';
import MerchantLayout from '../components/layout/MerchantLayout';
import { Icons } from '../components/ui/Icons';

export function ForbiddenPage({ requiredRole, userRole, redirectPath }) {
  return (
    <div style={{ minHeight: '80vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem', textAlign: 'center' }}>
      <div style={{ width: 48, height: 48, borderRadius: 9999, backgroundColor: '#fef2f2', color: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1rem' }}>
        <Icons.Shield size={24} />
      </div>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0f172a', margin: '0 0 0.5rem 0' }}>
        403 — Access Restricted
      </h1>
      <p style={{ fontSize: '0.875rem', color: '#64748b', maxWidth: '420px', lineHeight: 1.5, margin: '0 0 1.5rem 0' }}>
        This section is reserved exclusively for {requiredRole.toUpperCase()} accounts. Your current profile is registered as a {userRole.toUpperCase()}.
      </p>
      <a
        href={redirectPath}
        className="btn-ui btn-ui-primary"
        style={{ padding: '0.65rem 1.5rem', textDecoration: 'none' }}
      >
        Go to your {userRole === 'MERCHANT' ? 'Merchant Dashboard' : 'Buyer Home'} →
      </a>
    </div>
  );
}

export function BuyerRoute({ children }) {
  const { user, loading, isAuthenticated } = useAuth();

  if (loading) {
    return <div style={{ padding: '4rem', textAlign: 'center', color: '#64748b' }}>Loading Buyer session...</div>;
  }

  if (!isAuthenticated || !user) {
    return <Navigate to="/login" replace />;
  }

  const role = (user.role || 'BUYER').toUpperCase();
  if (role === 'MERCHANT') {
    return (
      <MerchantLayout>
        <ForbiddenPage requiredRole="BUYER" userRole="MERCHANT" redirectPath="/merchant/dashboard" />
      </MerchantLayout>
    );
  }

  return <BuyerLayout>{children}</BuyerLayout>;
}

export function MerchantRoute({ children }) {
  const { user, loading, isAuthenticated } = useAuth();

  if (loading) {
    return <div style={{ padding: '4rem', textAlign: 'center', color: '#64748b' }}>Loading Merchant session...</div>;
  }

  if (!isAuthenticated || !user) {
    return <Navigate to="/login" replace />;
  }

  const role = (user.role || '').toUpperCase();
  if (role !== 'MERCHANT' && role !== 'ADMIN') {
    return (
      <BuyerLayout>
        <ForbiddenPage requiredRole="MERCHANT" userRole={role || 'BUYER'} redirectPath="/buyer/home" />
      </BuyerLayout>
    );
  }

  return <MerchantLayout>{children}</MerchantLayout>;
}
