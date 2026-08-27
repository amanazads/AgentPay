import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { BuyerRoute, MerchantRoute } from './routes/Guards';

// Core Public Pages
import Landing from './pages/Landing';
import Login from './pages/Login';

// Buyer Suite Pages
import Home from './pages/Home';
import Purchases from './pages/Purchases';
import Preferences from './pages/Preferences';
import Connections from './pages/Connections';
import Settings from './pages/Settings';
import Onboarding from './pages/Onboarding';

// Merchant Suite Pages
import MerchantOverview from './pages/merchant/MerchantOverview';
import MerchantProducts from './pages/merchant/MerchantProducts';
import MerchantAICommerce from './pages/merchant/MerchantAICommerce';
import MerchantOrders from './pages/merchant/MerchantOrders';
import MerchantAnalytics from './pages/merchant/MerchantAnalytics';
import MerchantStore from './pages/merchant/MerchantStore';
import MerchantSettings from './pages/merchant/MerchantSettings';

// Admin / Technical Console
import Console from './pages/Console';

function RootRoute() {
  const { isAuthenticated, user, loading } = useAuth();
  if (loading) {
    return <div style={{ padding: '4rem', textAlign: 'center', color: '#64748b' }}>Loading AgentPay...</div>;
  }
  if (isAuthenticated && user) {
    if (user.role === 'MERCHANT') {
      return <Navigate to="/merchant/dashboard" replace />;
    }
    return <Navigate to="/buyer/home" replace />;
  }
  return <Landing />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public Landing & Authentication */}
          <Route path="/" element={<RootRoute />} />
          <Route path="/welcome" element={<Navigate to="/" replace />} />
          <Route path="/login" element={<Login defaultMode="login" />} />
          <Route path="/signup" element={<Login defaultMode="signup" />} />
          <Route path="/onboarding" element={<Navigate to="/buyer/onboarding" replace />} />

          {/* Legacy Redirects */}
          <Route path="/home" element={<Navigate to="/buyer/home" replace />} />
          <Route path="/purchases" element={<Navigate to="/buyer/purchases" replace />} />
          <Route path="/preferences" element={<Navigate to="/buyer/preferences" replace />} />

          {/* ========================================================= */}
          {/* 1. SEPARATE BUYER APPLICATION (/buyer/*)                  */}
          {/* ========================================================= */}
          <Route
            path="/buyer"
            element={
              <BuyerRoute>
                <Navigate to="/buyer/home" replace />
              </BuyerRoute>
            }
          />
          <Route
            path="/buyer/onboarding"
            element={
              <BuyerRoute>
                <Onboarding />
              </BuyerRoute>
            }
          />
          <Route
            path="/buyer/home"
            element={
              <BuyerRoute>
                <Home />
              </BuyerRoute>
            }
          />
          <Route
            path="/buyer/purchases"
            element={
              <BuyerRoute>
                <Purchases />
              </BuyerRoute>
            }
          />
          <Route
            path="/buyer/preferences"
            element={
              <BuyerRoute>
                <Preferences />
              </BuyerRoute>
            }
          />
          <Route
            path="/buyer/connections"
            element={
              <BuyerRoute>
                <Connections />
              </BuyerRoute>
            }
          />
          <Route
            path="/buyer/settings"
            element={
              <BuyerRoute>
                <Settings />
              </BuyerRoute>
            }
          />

          {/* ========================================================= */}
          {/* 2. SEPARATE MERCHANT APPLICATION (/merchant/*)           */}
          {/* ========================================================= */}
          <Route
            path="/merchant"
            element={
              <MerchantRoute>
                <Navigate to="/merchant/dashboard" replace />
              </MerchantRoute>
            }
          />
          <Route
            path="/merchant/dashboard"
            element={
              <MerchantRoute>
                <MerchantOverview />
              </MerchantRoute>
            }
          />
          <Route
            path="/merchant/overview"
            element={
              <MerchantRoute>
                <Navigate to="/merchant/dashboard" replace />
              </MerchantRoute>
            }
          />
          <Route
            path="/merchant/products"
            element={
              <MerchantRoute>
                <MerchantProducts />
              </MerchantRoute>
            }
          />
          <Route
            path="/merchant/ai-commerce"
            element={
              <MerchantRoute>
                <MerchantAICommerce />
              </MerchantRoute>
            }
          />
          <Route
            path="/merchant/orders"
            element={
              <MerchantRoute>
                <MerchantOrders />
              </MerchantRoute>
            }
          />
          <Route
            path="/merchant/analytics"
            element={
              <MerchantRoute>
                <MerchantAnalytics />
              </MerchantRoute>
            }
          />
          <Route
            path="/merchant/store"
            element={
              <MerchantRoute>
                <MerchantStore />
              </MerchantRoute>
            }
          />
          <Route
            path="/merchant/settings"
            element={
              <MerchantRoute>
                <MerchantSettings />
              </MerchantRoute>
            }
          />

          {/* Admin / Technical Evaluator Console */}
          <Route
            path="/admin"
            element={
              <BuyerRoute>
                <Console />
              </BuyerRoute>
            }
          />

          {/* Catch-all */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
