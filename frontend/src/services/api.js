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
  // Authentication
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

  // AI Conversational Procurement
  sendChatMessage: (data) => request('/api/ai/chat', { method: 'POST', body: data }),

  // Approvals
  getApprovals: (status = 'pending') => request(`/api/approvals?status=${status}`),
  decideApproval: (id, decision, notes) =>
    request(`/api/approvals/${id}/decide`, {
      method: 'POST',
      body: { decision, notes, auto_create_payment: decision === 'APPROVE' },
    }),

  // Purchase Intents & Settlements
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

  // Catalog Products
  getProducts: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/api/products?${qs}`);
  },

  // Merchant Connections & Capability Matrix
  getConnectedMerchants: () => request('/api/connections/merchants'),
  getMerchantHealth: (id) => request(`/api/connections/merchants/${id}/health`),
  connectMerchant: (id, data) => request(`/api/connections/merchants/${id}/connect`, { method: 'POST', body: data }),
  disconnectMerchant: (id) => request(`/api/connections/merchants/${id}/disconnect`, { method: 'POST' }),

  // Payment Authorizations & Mandates
  getPaymentMethods: () => request('/api/connections/payment-methods'),
  addPaymentMethod: (data) => request('/api/connections/payment-methods', { method: 'POST', body: data }),
  revokePaymentMethod: (id) => request(`/api/connections/payment-methods/${id}/revoke`, { method: 'POST' }),

  // Profile Switching
  switchProfile: (activeProfile) => request('/api/auth/switch-profile', { method: 'POST', body: { activeProfile } }),

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

  // Security & Simulation & Audit for Technical Judges
  getEnvironment: () => request('/api/system/environment'),
  getAuditEvents: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/api/audit?${qs}`);
  },
  runSimulation: (cases = 1000) =>
    request('/api/simulations/run', { method: 'POST', body: { cases } }),
  runSecurityScenario: (scenarioId) =>
    request(`/api/security-tests/${scenarioId}`, { method: 'POST' }),
  resetDemo: () => request('/api/system/reset-demo', { method: 'POST' }),
  // AI Commerce Interactive Demonstration Suite
  getDemoCommerceData: () => request('/api/ai-commerce/demo-data'),
  executeAICommerceDemo: (params = {}) =>
    request('/api/ai-commerce/execute-happy-path', {
      method: 'POST',
      body: typeof params === 'string' ? { prompt: params } : params,
    }),
  simulatePriceChangeFailure: (params = {}) =>
    request('/api/ai-commerce/simulate-price-change', {
      method: 'POST',
      body: typeof params === 'string' ? { productId: params } : params,
    }),
  simulatePaymentFailure: (params = {}) =>
    request('/api/ai-commerce/simulate-payment-failure', { method: 'POST', body: params }),
  simulateReconciliation: (params = {}) =>
    request('/api/ai-commerce/simulate-reconciliation', { method: 'POST', body: params }),
  resetAICommerceDemo: () => request('/api/ai-commerce/reset-demo', { method: 'POST' }),

  // Addresses & Invoicing
  getAddresses: () => request('/api/buyer/addresses'),
  addAddress: (data) => request('/api/buyer/addresses', { method: 'POST', body: data }),
  getBuyerOrders: () => request('/api/buyer/orders'),
  getBuyerOrderDetail: (id) => request(`/api/buyer/orders/${id}`),
  getInvoice: (orderId) => request(`/api/buyer/invoices/${orderId}`),
  fulfillMerchantOrder: (id, data) => request(`/api/merchant/orders/${id}/fulfill`, { method: 'POST', body: data }),
  cancelMerchantOrder: (id, data) => request(`/api/merchant/orders/${id}/cancel`, { method: 'POST', body: data }),
};


