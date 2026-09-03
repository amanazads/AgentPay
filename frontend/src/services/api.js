const API_URL = import.meta.env.VITE_API_URL || '';

async function request(endpoint, options = {}) {
  const { method = 'GET', body, headers = {} } = options;

  const token = localStorage.getItem('agentpay_token');

  const config = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  };

  if (body) {
    config.body = JSON.stringify(body);
  }

  const response = await fetch(`${API_URL}${endpoint}`, config);
  const data = await response.json();

  if (!response.ok) {
    if (response.status === 401 || (response.status === 404 && endpoint.includes('/auth/me'))) {
      localStorage.removeItem('agentpay_token');
      localStorage.removeItem('agentpay_user');
    }
    throw new Error(data.error || data.message || `Request failed: ${response.status}`);
  }

  return data;
}

export const api = {
  // ============================================================================
  // CANONICAL PRODUCTION COMMERCE API
  // ============================================================================

  // Authentication & Profile
  login: (credentials) => request('/api/auth/login', { method: 'POST', body: credentials }),
  signup: (userData) => request('/api/auth/signup', { method: 'POST', body: userData }),
  loginWithGoogle: (data = {}) => request('/api/auth/google', { method: 'POST', body: data }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  getMe: () => request('/api/auth/me'),

  // Purchasing Preferences & Procurement Policy Engine
  getPreferences: () => request('/api/preferences'),
  updatePreferences: (prefs) => request('/api/preferences', { method: 'POST', body: prefs }),
  interpretPreference: (sentence) => request('/api/preferences/interpret', { method: 'POST', body: { sentence } }),
  interpretPreferences: (sentence) => request('/api/preferences/interpret', { method: 'POST', body: { sentence } }),
  evaluatePolicyPreview: (data) => request('/api/preferences/evaluate', { method: 'POST', body: data }),

  // AI Conversational Procurement & Natural-Language Intent
  sendChatMessage: (data) => request('/api/ai/chat', { method: 'POST', body: data }),
  getAgents: () => request('/api/agents'),
  updateAgent: (id, data) => request(`/api/agents/${id}`, { method: 'PATCH', body: data }),
  getDashboardStats: () => request('/api/dashboard/stats'),
  getDashboard: () => request('/api/dashboard'),
  getPolicies: () => request('/api/policies'),

  // Canonical Product Discovery & Catalog
  getProducts: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/api/products?${qs}`);
  },
  getProductById: (id) => request(`/api/products/${id}`),
  searchBuyerProducts: (params = {}) => request('/api/buyer/search', { method: 'POST', body: params }),

  // Canonical Quotes & Cryptographic Price Locks
  getQuote: (data) => request('/api/ai/quote', { method: 'POST', body: data }),
  createCheckout: (data) => request('/api/ai/checkout', { method: 'POST', body: data }),

  // Approvals Workflow
  getApprovals: (status = 'pending') => request(`/api/approvals?status=${status}`),
  decideApproval: (id, decision, notes) =>
    request(`/api/approvals/${id}/decide`, {
      method: 'POST',
      body: { decision, notes, auto_create_payment: decision === 'APPROVE' },
    }),

  // Purchase Intents, Transactions & Payment Verification
  getPurchases: () => request('/api/buyer/purchases'),
  getPurchaseIntents: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/api/purchase-intents?${qs}`);
  },
  getTransactions: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/api/payments/transactions?${qs}`);
  },
  createPaymentOrder: (data) => request('/api/payments/create-order', { method: 'POST', body: data }),
  confirmTestPayment: (orderId, paymentData) =>
    request(`/api/payments/${orderId}/verify`, { method: 'POST', body: paymentData }),

  // Merchant Connections & Capability Matrix
  getConnectedMerchants: () => request('/api/connections/merchants'),
  getMerchantHealth: (id) => request(`/api/connections/merchants/${id}/health`),
  connectMerchant: (id, data) => request(`/api/connections/merchants/${id}/connect`, { method: 'POST', body: data }),
  disconnectMerchant: (id) => request(`/api/connections/merchants/${id}/disconnect`, { method: 'POST' }),

  // Payment Authorizations & Mandates
  getPaymentMethods: () => request('/api/connections/payment-methods'),
  addPaymentMethod: (data) => request('/api/connections/payment-methods', { method: 'POST', body: data }),
  revokePaymentMethod: (id) => request(`/api/connections/payment-methods/${id}/revoke`, { method: 'POST' }),

  // Addresses, Orders & Invoicing
  getAddresses: () => request('/api/buyer/addresses'),
  addAddress: (data) => request('/api/buyer/addresses', { method: 'POST', body: data }),
  getBuyerOrders: () => request('/api/buyer/orders'),
  getBuyerOrderDetail: (id) => request(`/api/buyer/orders/${id}`),
  getInvoice: (orderId) => request(`/api/buyer/invoices/${orderId}`),

  // Merchant Portal Suite
  getMerchantOverview: () => request('/api/merchant/overview'),
  getMerchantProducts: () => request('/api/merchant/products'),
  aiAutofillProduct: (prompt) => request('/api/merchant/products/ai-autofill', { method: 'POST', body: { prompt } }),
  createMerchantProduct: (data) => request('/api/merchant/products', { method: 'POST', body: data }),
  updateMerchantProduct: (id, data) => request(`/api/merchant/products/${id}`, { method: 'PUT', body: data }),
  updateProductStatus: (id, status) => request(`/api/merchant/products/${id}/status`, { method: 'POST', body: { status } }),
  deleteMerchantProduct: (id) => request(`/api/merchant/products/${id}`, { method: 'DELETE' }),
  updateProductAISettings: (id, data) => request(`/api/merchant/products/${id}/ai-settings`, { method: 'POST', body: data }),
  getMerchantAICommerce: () => request('/api/merchant/ai-commerce'),
  getMerchantOrders: () => request('/api/merchant/orders'),
  getMerchantAnalytics: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/api/merchant/analytics?${qs}`);
  },
  getMerchantStore: () => request('/api/merchant/store'),
  updateMerchantStore: (data) => request('/api/merchant/store', { method: 'POST', body: data }),
  connectMerchantStore: (data) => request('/api/merchant/store/connect', { method: 'POST', body: data }),
  rotateMerchantApiKey: () => request('/api/merchant/store/rotate-api-key', { method: 'POST' }),
  rotateMerchantWebhookSecret: () => request('/api/merchant/store/rotate-webhook-secret', { method: 'POST' }),
  runMerchantHealthCheck: () => request('/api/merchant/store/health-check', { method: 'POST' }),
  testMerchantWebhook: () => request('/api/merchant/store/test-webhook', { method: 'POST' }),
  fulfillMerchantOrder: (id, data) => request(`/api/merchant/orders/${id}/fulfill`, { method: 'POST', body: data }),
  cancelMerchantOrder: (id, data) => request(`/api/merchant/orders/${id}/cancel`, { method: 'POST', body: data }),

  // System Status & Audit
  getSystemStatus: () => request('/api/system/status'),
  getEnvironment: () => request('/api/system/environment'),
  getAuditEvents: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/api/audit?${qs}`);
  },

  // ============================================================================
  // ISOLATED DEMO & SIMULATION LAB API
  // ============================================================================

  // 1,000-Case Simulation & Security Attack Labs
  runSimulation: (cases = 1000) => request('/api/simulations/run', { method: 'POST', body: { cases } }),
  runSecurityScenario: (scenarioId) => request(`/api/security-tests/${scenarioId}`, { method: 'POST' }),
  resetDemo: () => request('/api/system/reset-demo', { method: 'POST' }),

  // Isolated Commerce Simulation Suite
  simulation: {
    getReadinessData: () => request('/api/simulation/commerce/catalog-readiness'),
    executePurchaseFlow: (params = {}) =>
      request('/api/simulation/commerce/evaluate-purchase-flow', {
        method: 'POST',
        body: typeof params === 'string' ? { prompt: params } : params,
      }),
    testSurgeProtection: (params = {}) =>
      request('/api/simulation/commerce/test-surge-protection', {
        method: 'POST',
        body: typeof params === 'string' ? { productId: params } : params,
      }),
    testSignatureVerification: (params = {}) =>
      request('/api/simulation/commerce/test-signature-verification', { method: 'POST', body: params }),
    testLedgerReconciliation: (params = {}) =>
      request('/api/simulation/commerce/reconcile-ledger', { method: 'POST', body: params }),
    resetState: () => request('/api/simulation/commerce/reset-state', { method: 'POST' }),
  },

  // Simulation Lab Aliases (for backward compatibility with demo widgets)
  getAICommerceReadinessData: () => request('/api/simulation/commerce/catalog-readiness'),
  getDemoCommerceData: () => request('/api/simulation/commerce/catalog-readiness'),
  executeAutonomousCommercePreview: (params = {}) =>
    request('/api/simulation/commerce/evaluate-purchase-flow', {
      method: 'POST',
      body: typeof params === 'string' ? { prompt: params } : params,
    }),
  executeAICommerceDemo: (params = {}) =>
    request('/api/simulation/commerce/evaluate-purchase-flow', {
      method: 'POST',
      body: typeof params === 'string' ? { prompt: params } : params,
    }),
  testPriceSurgeProtection: (params = {}) =>
    request('/api/simulation/commerce/test-surge-protection', {
      method: 'POST',
      body: typeof params === 'string' ? { productId: params } : params,
    }),
  simulatePriceChangeFailure: (params = {}) =>
    request('/api/simulation/commerce/test-surge-protection', {
      method: 'POST',
      body: typeof params === 'string' ? { productId: params } : params,
    }),
  testSignatureVerification: (params = {}) =>
    request('/api/simulation/commerce/test-signature-verification', { method: 'POST', body: params }),
  simulatePaymentFailure: (params = {}) =>
    request('/api/simulation/commerce/test-signature-verification', { method: 'POST', body: params }),
  testLedgerReconciliation: (params = {}) =>
    request('/api/simulation/commerce/reconcile-ledger', { method: 'POST', body: params }),
  simulateReconciliation: (params = {}) =>
    request('/api/simulation/commerce/reconcile-ledger', { method: 'POST', body: params }),
  resetAICommerceState: () => request('/api/simulation/commerce/reset-state', { method: 'POST' }),
  resetAICommerceDemo: () => request('/api/simulation/commerce/reset-state', { method: 'POST' }),

  // Judge Mode Deterministic Sequence Engine
  getJudgeSequence: () => request('/api/judge/sequence'),
  runJudgeStep: (step, context = {}) => request('/api/judge/run-step', { method: 'POST', body: { step, context } }),
  resetJudgeSession: () => request('/api/judge/reset', { method: 'POST' }),
};
