import React, { useState, useEffect } from 'react';
import { api } from '../../services/api';
import { Icons } from '../../components/ui/Icons';
import Button from '../../components/ui/Button';
import './MerchantPortal.css';

export default function MerchantProducts() {
  const [products, setProducts] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState('ALL');

  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [activeEditTab, setActiveEditTab] = useState('general'); // 'general' | 'specs' | 'ai' | 'controls'
  const [aiPrompt, setAiPrompt] = useState('');
  const [autofilling, setAutofilling] = useState(false);

  // New Product Form State
  const [newProduct, setNewProduct] = useState({
    name: '',
    sku: '',
    brand: '',
    category: 'Electronics',
    price: '',
    inventory: '50',
    aiSummary: '',
    targetAudience: 'Developers & Professionals',
    keywords: '',
    isPromoted: false,
    marginTier: 'medium',
    specifications: {},
  });

  // Edit Product Form State
  const [editForm, setEditForm] = useState({
    name: '',
    sku: '',
    brand: '',
    category: 'Electronics',
    price: '',
    inventory: '50',
    status: 'ACTIVE',
    aiSummary: '',
    targetAudience: '',
    useCases: '',
    keywords: '',
    isPromoted: false,
    marginTier: 'medium',
    specifications: {},
  });

  const [specKey, setSpecKey] = useState('');
  const [specVal, setSpecVal] = useState('');

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  // Server errors were previously only console.error'd, so a failed save, status
  // change or archive looked exactly like a successful one to the merchant.
  const [errorMessage, setErrorMessage] = useState(null);
  const [loadError, setLoadError] = useState(null);

  /** Surfaces a server failure to the merchant instead of swallowing it. */
  const reportFailure = (action, err) => {
    const detail = err?.message || 'The server did not respond.';
    console.error(`${action} failed`, err);
    setMessage(null);
    setErrorMessage(`${action} failed: ${detail}`);
  };

  const beginMutation = () => {
    setErrorMessage(null);
    setMessage(null);
  };

  useEffect(() => {
    fetchProducts();
  }, []);

  const fetchProducts = async () => {
    try {
      const res = await api.getMerchantProducts();
      setProducts(res.products || []);
      setSummary(res.summary || null);
      setLoadError(null);
    } catch (e) {
      console.error('Failed to load products', e);
      // Do not leave a stale catalog on screen implying everything is fine.
      setLoadError(e?.message || 'Unable to load your catalog.');
    } finally {
      setLoading(false);
    }
  };

  const handleAiAutofill = async (promptText) => {
    if (autofilling) return;
    beginMutation();
    setAutofilling(true);
    try {
      const res = await api.aiAutofillProduct(promptText);
      if (res?.data) {
        setNewProduct({
          name: res.data.name || '',
          sku: res.data.sku || '',
          brand: res.data.brand || '',
          category: res.data.category || 'Electronics',
          price: res.data.price !== undefined ? res.data.price.toString() : '19990',
          inventory: res.data.inventory !== undefined ? res.data.inventory.toString() : '50',
          aiSummary: res.data.aiSummary || '',
          targetAudience: res.data.targetAudience || 'Developers & Professionals',
          keywords: res.data.keywords || '',
          isPromoted: res.data.isPromoted !== false,
          marginTier: res.data.marginTier || 'medium',
          specifications: res.data.specifications || {},
        });
        setMessage(`AI Auto-Filled structured specifications for "${res.data.name}".`);
        setTimeout(() => setMessage(null), 4000);
      }
    } catch (err) {
      reportFailure('AI autofill', err);
    } finally {
      setAutofilling(false);
    }
  };

  const handleCreateProduct = async (e) => {
    e.preventDefault();
    if (saving) return; // guard against duplicate submission
    beginMutation();
    setSaving(true);
    try {
      await api.createMerchantProduct({
        ...newProduct,
        price: parseFloat(newProduct.price),
        inventory: parseInt(newProduct.inventory) || 25,
        keywords: typeof newProduct.keywords === 'string' ? newProduct.keywords.split(',').map((s) => s.trim()).filter(Boolean) : newProduct.keywords,
        useCases: [newProduct.category, 'General Use'],
      });
      setShowAddModal(false);
      setNewProduct({
        name: '',
        sku: '',
        brand: '',
        category: 'Electronics',
        price: '',
        inventory: '50',
        aiSummary: '',
        targetAudience: 'Developers & Professionals',
        keywords: '',
        isPromoted: false,
        marginTier: 'medium',
        specifications: {},
      });
      setMessage('New product published with structured specifications.');
      setTimeout(() => setMessage(null), 3000);
      fetchProducts();
    } catch (err) {
      // The modal deliberately stays open so the merchant does not lose their
      // input and can correct and retry.
      reportFailure('Creating the product', err);
    } finally {
      setSaving(false);
    }
  };

  const handleOpenEdit = (p) => {
    setSelectedProduct(p);
    setActiveEditTab('general');
    setEditForm({
      name: p.name || '',
      sku: p.sku || '',
      brand: p.brand || '',
      category: p.category || 'Electronics',
      price: p.price !== undefined ? p.price.toString() : '',
      inventory: p.inventory !== undefined ? p.inventory.toString() : '50',
      status: p.status || 'ACTIVE',
      aiSummary: p.aiSummary || '',
      targetAudience: p.targetAudience || '',
      useCases: Array.isArray(p.useCases) ? p.useCases.join(', ') : '',
      keywords: Array.isArray(p.keywords) ? p.keywords.join(', ') : '',
      isPromoted: Boolean(p.isPromoted),
      marginTier: p.marginTier || 'medium',
      specifications: p.specifications && typeof p.specifications === 'object' ? { ...p.specifications } : {},
    });
  };

  const handleAddSpecToEdit = () => {
    if (!specKey.trim() || !specVal.trim()) return;
    setEditForm({
      ...editForm,
      specifications: {
        ...editForm.specifications,
        [specKey.trim().toLowerCase().replace(/\s+/g, '_')]: specVal.trim(),
      },
    });
    setSpecKey('');
    setSpecVal('');
  };

  const handleRemoveSpecFromEdit = (k) => {
    const updated = { ...editForm.specifications };
    delete updated[k];
    setEditForm({ ...editForm, specifications: updated });
  };

  const handleSaveProductEdit = async (e) => {
    e.preventDefault();
    if (!selectedProduct) return;
    if (saving) return; // guard against duplicate submission
    beginMutation();
    setSaving(true);
    try {
      await api.updateMerchantProduct(selectedProduct.id, {
        name: editForm.name,
        brand: editForm.brand,
        category: editForm.category,
        price: parseFloat(editForm.price),
        inventory: parseInt(editForm.inventory) || 0,
        inStock: (parseInt(editForm.inventory) || 0) > 0 && editForm.status === 'ACTIVE',
        status: editForm.status,
        specifications: editForm.specifications,
        aiSummary: editForm.aiSummary,
        targetAudience: editForm.targetAudience,
        useCases: editForm.useCases.split(',').map((s) => s.trim()).filter(Boolean),
        keywords: editForm.keywords.split(',').map((s) => s.trim()).filter(Boolean),
        isPromoted: editForm.isPromoted,
        marginTier: editForm.marginTier,
      });
      setSelectedProduct(null);
      setMessage(`Product "${editForm.name}" updated successfully (Price: ₹${parseFloat(editForm.price).toLocaleString('en-IN')}).`);
      setTimeout(() => setMessage(null), 3000);
      fetchProducts();
    } catch (err) {
      reportFailure('Updating the product', err);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (id, currentStatus) => {
    const targetStatus = currentStatus === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    if (saving) return;
    beginMutation();
    setSaving(true);
    try {
      await api.updateProductStatus(id, targetStatus);
      setMessage(`Product status changed to ${targetStatus}.`);
      setTimeout(() => setMessage(null), 3000);
      fetchProducts();
    } catch (err) {
      reportFailure(`Changing status to ${targetStatus}`, err);
      // Re-read authoritative state: the product may or may not have changed.
      fetchProducts();
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteProduct = async (id, name) => {
    if (!window.confirm(`Are you sure you want to archive "${name}" from your AI catalog?`)) return;
    if (saving) return;
    beginMutation();
    setSaving(true);
    try {
      await api.deleteMerchantProduct(id);
      setMessage(`Archived "${name}".`);
      setTimeout(() => setMessage(null), 3000);
      fetchProducts();
    } catch (err) {
      reportFailure(`Archiving "${name}"`, err);
      fetchProducts();
    } finally {
      setSaving(false);
    }
  };

  const formatCurrency = (amt) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amt || 0);

  // Filtered Products
  const filteredProducts = products.filter((p) => {
    const matchesSearch =
      searchQuery === '' ||
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.brand.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesCategory = selectedCategory === 'ALL' || p.category === selectedCategory;

    let matchesStatus = true;
    if (selectedStatusFilter === 'TRANSACTABLE') matchesStatus = p.aiTransactable;
    else if (selectedStatusFilter === 'DISCOVERABLE_ONLY') matchesStatus = p.aiDiscoverable && !p.aiTransactable;
    else if (selectedStatusFilter === 'OUT_OF_STOCK') matchesStatus = !p.inStock || p.inventory === 0;
    else if (selectedStatusFilter === 'PAUSED') matchesStatus = p.status === 'PAUSED';

    return matchesSearch && matchesCategory && matchesStatus;
  });

  const categories = ['ALL', ...new Set(products.map((p) => p.category).filter(Boolean))];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* 1. Header & Store Actions */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="text-h1">AI-Readable Products Catalog</h1>
          <p className="text-body" style={{ marginTop: 2 }}>
            Manage catalog specifications, atomic stock counts, price locks, and AI purchasing controls.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <Button
            variant="secondary"
            onClick={() => {
              setShowAddModal(true);
              if (!aiPrompt) setAiPrompt('Apple MacBook Air M4 16GB 512GB Midnight');
            }}
            icon={<Icons.Sparkles size={15} />}
          >
            AI Auto-Fill SKU
          </Button>
          <Button variant="primary" onClick={() => setShowAddModal(true)} icon={<Icons.Plus size={15} />}>
            Add Product
          </Button>
        </div>
      </div>

      {message && (
        <div style={{ padding: '0.75rem 1rem', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 'var(--radius-md)', color: '#166534', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Icons.Check size={16} />
          {message}
        </div>
      )}

      {errorMessage && (
        <div role="alert" style={{ padding: '0.75rem 1rem', backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: 'var(--radius-md)', color: '#991b1b', fontSize: '0.875rem', display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
          <Icons.ShieldAlert size={16} />
          <div style={{ flex: 1 }}>
            {errorMessage}
            <div style={{ fontSize: '0.75rem', marginTop: 4, color: '#7f1d1d' }}>
              Your catalog was not changed by this action.
            </div>
          </div>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            style={{ background: 'none', border: 'none', color: '#991b1b', cursor: 'pointer', fontWeight: 700, fontSize: '1rem', lineHeight: 1 }}
            aria-label="Dismiss error"
          >
            ×
          </button>
        </div>
      )}

      {loadError && (
        <div role="alert" style={{ padding: '0.75rem 1rem', backgroundColor: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 'var(--radius-md)', color: '#92400e', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'space-between' }}>
          <span>Unable to load your catalog: {loadError}</span>
          <Button variant="secondary" size="sm" onClick={fetchProducts}>Retry</Button>
        </div>
      )}

      {/* 2. Catalog Health Summary KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '1rem' }}>
        <div className="card-panel" style={{ padding: '1.15rem' }}>
          <div className="text-caption" style={{ textTransform: 'uppercase', fontWeight: 600, color: 'var(--text-subtle)', marginBottom: 2 }}>
            Total SKUs
          </div>
          <div className="text-h1" style={{ fontSize: '1.65rem', color: 'var(--text-main)' }}>
            {summary?.totalProducts ?? products.length}
          </div>
          <div className="text-caption" style={{ marginTop: 2, color: 'var(--text-subtle)' }}>
            Active catalog v{summary?.catalogVersion || 1}
          </div>
        </div>

        <div className="card-panel" style={{ padding: '1.15rem' }}>
          <div className="text-caption" style={{ textTransform: 'uppercase', fontWeight: 600, color: 'var(--text-subtle)', marginBottom: 2 }}>
            AI Discoverable
          </div>
          <div className="text-h1" style={{ fontSize: '1.65rem', color: '#1e3a8a' }}>
            {summary?.discoverableCount ?? products.filter((p) => p.aiDiscoverable).length} / {products.length}
          </div>
          <div className="text-caption" style={{ marginTop: 2, color: '#1e3a8a' }}>
            Schema & specs validated
          </div>
        </div>

        <div className="card-panel" style={{ padding: '1.15rem' }}>
          <div className="text-caption" style={{ textTransform: 'uppercase', fontWeight: 600, color: 'var(--text-subtle)', marginBottom: 2 }}>
            AI Transactable
          </div>
          <div className="text-h1" style={{ fontSize: '1.65rem', color: '#065f46' }}>
            {summary?.transactableCount ?? products.filter((p) => p.aiTransactable).length} / {products.length}
          </div>
          <div className="text-caption" style={{ marginTop: 2, color: '#166534' }}>
            In-stock & checkout verified
          </div>
        </div>

        <div className="card-panel" style={{ padding: '1.15rem' }}>
          <div className="text-caption" style={{ textTransform: 'uppercase', fontWeight: 600, color: 'var(--text-subtle)', marginBottom: 2 }}>
            Inventory Units
          </div>
          <div className="text-h1" style={{ fontSize: '1.65rem', color: 'var(--text-main)' }}>
            {summary?.totalStockUnits ?? products.reduce((sum, p) => sum + (p.inventory || 0), 0)}
          </div>
          <div className="text-caption" style={{ marginTop: 2, color: (summary?.outOfStockCount || 0) > 0 ? '#b91c1c' : 'var(--text-subtle)' }}>
            {summary?.outOfStockCount ? `${summary.outOfStockCount} SKUs out of stock` : 'All SKUs in stock'}
          </div>
        </div>
      </div>

      {/* 3. Filter & Search Bar */}
      <div className="card-panel" style={{ padding: '0.875rem 1.25rem' }}>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flex: 1, minWidth: 260 }}>
            <div style={{ position: 'relative', width: '100%', maxWidth: 360 }}>
              <input
                type="text"
                placeholder="Search products by title, brand, or SKU..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.5rem 0.75rem 0.5rem 2rem',
                  fontSize: '0.84375rem',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid #cbd5e1',
                  outline: 'none',
                }}
              />
              <div style={{ position: 'absolute', left: '0.65rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }}>
                <Icons.Search size={14} />
              </div>
            </div>

            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              style={{ padding: '0.5rem 0.75rem', fontSize: '0.84375rem', borderRadius: 'var(--radius-md)', border: '1px solid #cbd5e1', backgroundColor: '#ffffff' }}
            >
              {categories.map((c) => (
                <option key={c} value={c}>{c === 'ALL' ? 'All Categories' : c}</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <span style={{ fontSize: '0.78125rem', color: 'var(--text-subtle)', fontWeight: 600 }}>Filter:</span>
            {['ALL', 'TRANSACTABLE', 'DISCOVERABLE_ONLY', 'OUT_OF_STOCK', 'PAUSED'].map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setSelectedStatusFilter(f)}
                style={{
                  fontSize: '0.75rem',
                  fontWeight: selectedStatusFilter === f ? 700 : 500,
                  padding: '4px 10px',
                  borderRadius: 4,
                  border: selectedStatusFilter === f ? '1px solid #0f172a' : '1px solid #e2e8f0',
                  backgroundColor: selectedStatusFilter === f ? '#0f172a' : '#ffffff',
                  color: selectedStatusFilter === f ? '#ffffff' : '#475569',
                  cursor: 'pointer',
                }}
              >
                {f === 'ALL' && 'All SKUs'}
                {f === 'TRANSACTABLE' && 'Transactable'}
                {f === 'DISCOVERABLE_ONLY' && 'Discoverable Only'}
                {f === 'OUT_OF_STOCK' && 'Out of Stock'}
                {f === 'PAUSED' && 'Paused'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 4. Products Table */}
      <div className="card-panel">
        <div className="card-panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 className="card-panel-title">Active Store Catalog ({filteredProducts.length})</h2>
            <p className="card-panel-sub">
              Structured catalog data indexed for AI buyer evaluation and automated checkout execution.
            </p>
          </div>
        </div>

        <div className="card-panel-body" style={{ padding: 0 }}>
          {filteredProducts.length === 0 ? (
            <div style={{ padding: '3rem 1.5rem', textAlign: 'center', color: 'var(--text-subtle)' }}>
              No products found matching the selected filter criteria.
            </div>
          ) : (
            <div className="table-scroll">
              <table className="table-clean">
                <thead>
                  <tr>
                    <th>Product & SKU</th>
                    <th>Category & Specifications</th>
                    <th>Price & Stock</th>
                    <th>AI Discoverable</th>
                    <th>AI Transactable</th>
                    <th>Promotion & Margin</th>
                    <th>Status & Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProducts.map((p) => {
                    const specs = p.specifications && typeof p.specifications === 'object' ? Object.entries(p.specifications) : [];

                    return (
                      <tr key={p.id}>
                        <td>
                          <div style={{ fontWeight: 600, color: 'var(--text-main)', fontSize: '0.875rem' }}>
                            {p.name}
                          </div>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 3 }}>
                            <span style={{ fontSize: '0.71875rem', color: 'var(--text-subtle)', fontFamily: 'var(--font-mono)' }}>
                              {p.sku}
                            </span>
                            <span style={{ fontSize: '0.71875rem', color: '#64748b', backgroundColor: '#f1f5f9', padding: '1px 5px', borderRadius: 3 }}>
                              {p.brand}
                            </span>
                          </div>
                        </td>

                        <td>
                          <span className="badge-tag" style={{ marginBottom: 4, display: 'inline-block' }}>
                            {p.category}
                          </span>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxWidth: 220 }}>
                            {specs.slice(0, 3).map(([k, v]) => (
                              <span key={k} style={{ fontSize: '0.6875rem', background: '#f8fafc', border: '1px solid #e2e8f0', padding: '1px 4px', borderRadius: 3, color: '#334155' }}>
                                <strong>{k}:</strong> {String(v)}
                              </span>
                            ))}
                            {specs.length > 3 && (
                              <span style={{ fontSize: '0.6875rem', color: 'var(--text-subtle)' }}>+{specs.length - 3} more</span>
                            )}
                          </div>
                        </td>

                        <td>
                          <div style={{ fontWeight: 700, fontSize: '0.9375rem', color: 'var(--text-main)' }}>
                            {formatCurrency(p.price)}
                          </div>
                          <div style={{ fontSize: '0.75rem', marginTop: 2, color: p.inventory > 0 ? '#166534' : '#dc2626', fontWeight: 600 }}>
                            {p.inventory > 0 ? `${p.inventory} available` : 'Out of stock (0)'}
                          </div>
                        </td>

                        <td>
                          {p.aiDiscoverable ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#16a34a', fontSize: '0.8125rem', fontWeight: 600 }}>
                              <Icons.Check size={13} /> Active
                            </span>
                          ) : (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#dc2626', fontSize: '0.8125rem', fontWeight: 600 }}>
                              <Icons.X size={13} /> Incomplete
                            </span>
                          )}
                        </td>

                        <td>
                          {p.aiTransactable ? (
                            <div>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#16a34a', fontSize: '0.8125rem', fontWeight: 600 }}>
                                <Icons.Check size={13} /> Ready
                              </span>
                              <div style={{ fontSize: '0.6875rem', color: 'var(--text-subtle)' }}>Instant checkout active</div>
                            </div>
                          ) : (
                            <div>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#d97706', fontSize: '0.8125rem', fontWeight: 600 }}>
                                <Icons.AlertTriangle size={13} /> {p.status === 'PAUSED' ? 'Paused' : 'Unavailable'}
                              </span>
                              <div style={{ fontSize: '0.6875rem', color: '#b45309' }}>{p.readinessReason}</div>
                            </div>
                          )}
                        </td>

                        <td>
                          {p.isPromoted ? (
                            <span style={{ fontSize: '0.6875rem', fontWeight: 700, backgroundColor: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', padding: '2px 6px', borderRadius: 4 }}>
                              ★ Priority Promoted
                            </span>
                          ) : (
                            <span style={{ fontSize: '0.6875rem', color: 'var(--text-subtle)' }}>Standard</span>
                          )}
                          <div style={{ fontSize: '0.6875rem', color: 'var(--text-subtle)', marginTop: 3 }}>
                            Margin: <span style={{ textTransform: 'uppercase', fontWeight: 600 }}>{p.marginTier}</span> <span style={{ color: '#94a3b8' }}>(Private)</span>
                          </div>
                        </td>

                        <td>
                          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                            <Button size="sm" variant="outline" onClick={() => handleOpenEdit(p)}>
                              Edit Specs
                            </Button>
                            <button
                              type="button"
                              onClick={() => handleToggleStatus(p.id, p.status)}
                              style={{
                                fontSize: '0.75rem',
                                padding: '4px 8px',
                                borderRadius: 4,
                                border: '1px solid #cbd5e1',
                                background: '#f8fafc',
                                color: p.status === 'ACTIVE' ? '#475569' : '#166534',
                                cursor: 'pointer',
                                fontWeight: 600,
                              }}
                            >
                              {p.status === 'ACTIVE' ? 'Pause' : 'Activate'}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteProduct(p.id, p.name)}
                              style={{ border: 'none', background: 'transparent', color: '#94a3b8', cursor: 'pointer', padding: 4 }}
                              title="Archive product"
                            >
                              <Icons.Trash size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* 5. Product Detail & Edit Modal */}
      {selectedProduct && (
        <div className="modal-overlay" style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div style={{ backgroundColor: '#ffffff', borderRadius: 'var(--radius-lg, 12px)', width: '100%', maxWidth: 680, maxHeight: '90vh', overflowY: 'auto', padding: '1.75rem', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: '#0f172a' }}>
                  Edit Product & Structured Specifications
                </h3>
                <p style={{ margin: '2px 0 0 0', fontSize: '0.8125rem', color: 'var(--text-subtle)' }}>
                  SKU: <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{selectedProduct.sku}</span> | Catalog v{selectedProduct.catalogVersion || 1}
                </p>
              </div>
              <button type="button" onClick={() => setSelectedProduct(null)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#64748b' }}>
                <Icons.X size={20} />
              </button>
            </div>

            {/* Edit Tabs */}
            <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid #e2e8f0', marginBottom: '1.25rem' }}>
              {[
                { id: 'general', label: 'Identity & Price' },
                { id: 'specs', label: 'Structured Specifications' },
                { id: 'ai', label: 'AI Discovery' },
                { id: 'controls', label: 'Selling Controls' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveEditTab(tab.id)}
                  style={{
                    padding: '0.5rem 0.875rem',
                    fontSize: '0.8125rem',
                    fontWeight: activeEditTab === tab.id ? 700 : 500,
                    color: activeEditTab === tab.id ? '#0f172a' : '#64748b',
                    borderBottom: activeEditTab === tab.id ? '2px solid #0f172a' : '2px solid transparent',
                    background: 'transparent',
                    borderTop: 'none',
                    borderLeft: 'none',
                    borderRight: 'none',
                    cursor: 'pointer',
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <form onSubmit={handleSaveProductEdit}>
              {/* Tab 1: General & Pricing */}
              {activeEditTab === 'general' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div>
                    <label className="text-caption" style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Product Title</label>
                    <input
                      type="text"
                      className="input-field"
                      value={editForm.name}
                      onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      required
                    />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <div>
                      <label className="text-caption" style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Brand</label>
                      <input
                        type="text"
                        className="input-field"
                        value={editForm.brand}
                        onChange={(e) => setEditForm({ ...editForm, brand: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="text-caption" style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Category</label>
                      <select
                        className="input-field"
                        value={editForm.category}
                        onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                      >
                        <option value="Electronics">Electronics</option>
                        <option value="Peripherals">Peripherals</option>
                        <option value="Furniture">Furniture</option>
                        <option value="Software & Licenses">Software & Licenses</option>
                      </select>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <div>
                      <label className="text-caption" style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Catalog Price (₹)</label>
                      <input
                        type="number"
                        className="input-field"
                        value={editForm.price}
                        onChange={(e) => setEditForm({ ...editForm, price: e.target.value })}
                        required
                        min="1"
                      />
                      <span style={{ fontSize: '0.6875rem', color: 'var(--text-subtle)' }}>Immutable quote lock price</span>
                    </div>
                    <div>
                      <label className="text-caption" style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Available Stock Units</label>
                      <input
                        type="number"
                        className="input-field"
                        value={editForm.inventory}
                        onChange={(e) => setEditForm({ ...editForm, inventory: e.target.value })}
                        required
                        min="0"
                      />
                      <span style={{ fontSize: '0.6875rem', color: 'var(--text-subtle)' }}>Atomic reservation pool</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Tab 2: Structured Technical Specifications */}
              {activeEditTab === 'specs' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div style={{ padding: '0.75rem', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8 }}>
                    <div style={{ fontSize: '0.78125rem', fontWeight: 700, color: '#1e293b', marginBottom: 4 }}>
                      Add Machine-Readable Specification
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <input
                        type="text"
                        placeholder="Attribute (e.g. capacity)"
                        value={specKey}
                        onChange={(e) => setSpecKey(e.target.value)}
                        style={{ flex: 1, padding: '0.4rem 0.6rem', fontSize: '0.8125rem', border: '1px solid #cbd5e1', borderRadius: 4 }}
                      />
                      <input
                        type="text"
                        placeholder="Value (e.g. 20000mAh)"
                        value={specVal}
                        onChange={(e) => setSpecVal(e.target.value)}
                        style={{ flex: 1, padding: '0.4rem 0.6rem', fontSize: '0.8125rem', border: '1px solid #cbd5e1', borderRadius: 4 }}
                      />
                      <Button size="sm" variant="secondary" type="button" onClick={handleAddSpecToEdit}>
                        Add
                      </Button>
                    </div>
                  </div>

                  <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '0.75rem' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-subtle)', marginBottom: '0.5rem' }}>
                      Current Structured Attributes
                    </div>
                    {Object.entries(editForm.specifications).length === 0 ? (
                      <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--text-subtle)' }}>
                        No structured specifications added yet. Add attributes above so AI buyers can filter on technical requirements.
                      </p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                        {Object.entries(editForm.specifications).map(([k, v]) => (
                          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.35rem 0.6rem', backgroundColor: '#f1f5f9', borderRadius: 4, fontSize: '0.8125rem' }}>
                            <div>
                              <strong style={{ color: '#0f172a' }}>{k}:</strong> <span style={{ color: '#334155' }}>{String(v)}</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleRemoveSpecFromEdit(k)}
                              style={{ border: 'none', background: 'transparent', color: '#dc2626', cursor: 'pointer', padding: 2 }}
                            >
                              <Icons.X size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Tab 3: AI Discovery Metadata */}
              {activeEditTab === 'ai' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div>
                    <label className="text-caption" style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Factual AI Summary</label>
                    <textarea
                      className="input-field"
                      rows={3}
                      value={editForm.aiSummary}
                      onChange={(e) => setEditForm({ ...editForm, aiSummary: e.target.value })}
                      placeholder="Factual description grounded in product specifications..."
                    />
                  </div>

                  <div>
                    <label className="text-caption" style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Target Audience</label>
                    <input
                      type="text"
                      className="input-field"
                      value={editForm.targetAudience}
                      onChange={(e) => setEditForm({ ...editForm, targetAudience: e.target.value })}
                    />
                  </div>

                  <div>
                    <label className="text-caption" style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Search Keywords (Comma-separated)</label>
                    <input
                      type="text"
                      className="input-field"
                      value={editForm.keywords}
                      onChange={(e) => setEditForm({ ...editForm, keywords: e.target.value })}
                    />
                  </div>
                </div>
              )}

              {/* Tab 4: Selling Controls */}
              {activeEditTab === 'controls' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                  <div style={{ padding: '1rem', border: '1px solid #e2e8f0', borderRadius: 8, backgroundColor: '#f8fafc' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '0.875rem', color: '#0f172a' }}>Priority Promotion</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-subtle)' }}>
                          Merchant ranking boost. Does not override buyer budget, category, or spec constraints.
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={editForm.isPromoted}
                        onChange={(e) => setEditForm({ ...editForm, isPromoted: e.target.checked })}
                        style={{ width: 18, height: 18, cursor: 'pointer' }}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <div>
                      <label className="text-caption" style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Margin Tier (Merchant Private)</label>
                      <select
                        className="input-field"
                        value={editForm.marginTier}
                        onChange={(e) => setEditForm({ ...editForm, marginTier: e.target.value })}
                      >
                        <option value="high">High Margin</option>
                        <option value="medium">Medium Margin</option>
                        <option value="low">Low Margin</option>
                      </select>
                      <span style={{ fontSize: '0.6875rem', color: '#94a3b8' }}>Never exposed to buyers or LLM explanations</span>
                    </div>

                    <div>
                      <label className="text-caption" style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Product Lifecycle Status</label>
                      <select
                        className="input-field"
                        value={editForm.status}
                        onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                      >
                        <option value="ACTIVE">Active (Purchasable)</option>
                        <option value="PAUSED">Paused (Non-Purchasable)</option>
                        <option value="ARCHIVED">Archived (Hidden)</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {/* Modal Footer Actions */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.75rem', borderTop: '1px solid #e2e8f0', paddingTop: '1rem' }}>
                <Button variant="secondary" type="button" onClick={() => setSelectedProduct(null)}>
                  Cancel
                </Button>
                <Button variant="primary" type="submit" loading={saving}>
                  Save Product & Specs
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 6. Add Product Modal */}
      {showAddModal && (
        <div className="modal-overlay" style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div style={{ backgroundColor: '#ffffff', borderRadius: 'var(--radius-lg, 12px)', width: '100%', maxWidth: 600, maxHeight: '90vh', overflowY: 'auto', padding: '1.75rem', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: '#0f172a' }}>
                  Add Product to AI Catalog
                </h3>
                <p style={{ margin: '2px 0 0 0', fontSize: '0.8125rem', color: 'var(--text-subtle)' }}>
                  Index a new item with structured specifications and real-time inventory locking.
                </p>
              </div>
              <button type="button" onClick={() => setShowAddModal(false)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#64748b' }}>
                <Icons.X size={20} />
              </button>
            </div>

            {/* AI Auto-Fill Helper */}
            <div style={{ padding: '0.875rem 1rem', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, marginBottom: '1.25rem' }}>
              <div style={{ fontSize: '0.78125rem', fontWeight: 700, color: '#166534', marginBottom: 4 }}>
                Instant AI Specification Auto-Fill
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  type="text"
                  placeholder="e.g. Sony WH-1000XM5 ANC Headphones or Ambrane 20000mAh Power Bank"
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  style={{ flex: 1, padding: '0.45rem 0.65rem', fontSize: '0.8125rem', border: '1px solid #86efac', borderRadius: 4, outline: 'none' }}
                />
                <Button size="sm" variant="primary" type="button" onClick={() => handleAiAutofill(aiPrompt)} loading={autofilling}>
                  Auto-Fill
                </Button>
              </div>
            </div>

            <form onSubmit={handleCreateProduct} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.8fr', gap: '1rem', alignItems: 'flex-start' }}>
                <div>
                  <label className="text-caption" style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>
                    SKU / Catalog Identifier
                  </label>
                  <div style={{ display: 'flex', gap: '0.4rem' }}>
                    <input
                      type="text"
                      className="input-field"
                      value={newProduct.sku}
                      onChange={(e) => setNewProduct({ ...newProduct, sku: e.target.value })}
                      placeholder="e.g. SKU-APL-MBA-M4-512"
                      style={{ flex: 1, fontFamily: 'monospace', fontWeight: 600 }}
                      required
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        const brandCode = (newProduct.brand || 'GEN').replace(/[^a-zA-Z0-9]/g, '').slice(0, 3).toUpperCase() || 'GEN';
                        const nameCode = (newProduct.name || 'ITEM').split(/\s+/).slice(0, 2).map((w) => w.replace(/[^a-zA-Z0-9]/g, '').slice(0, 3).toUpperCase()).filter(Boolean).join('-') || 'ITEM';
                        const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
                        setNewProduct({ ...newProduct, sku: `SKU-${brandCode}-${nameCode}-${rand}` });
                      }}
                    >
                      Gen
                    </Button>
                  </div>
                </div>

                <div>
                  <label className="text-caption" style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Product Name</label>
                  <input
                    type="text"
                    className="input-field"
                    value={newProduct.name}
                    onChange={(e) => setNewProduct({ ...newProduct, name: e.target.value })}
                    placeholder="e.g. Apple MacBook Air M4 (16GB, 512GB)"
                    required
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label className="text-caption" style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Brand</label>
                  <input
                    type="text"
                    className="input-field"
                    value={newProduct.brand}
                    onChange={(e) => setNewProduct({ ...newProduct, brand: e.target.value })}
                    placeholder="e.g. Ambrane"
                    required
                  />
                </div>
                <div>
                  <label className="text-caption" style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Category</label>
                  <select
                    className="input-field"
                    value={newProduct.category}
                    onChange={(e) => setNewProduct({ ...newProduct, category: e.target.value })}
                  >
                    <option value="Electronics">Electronics</option>
                    <option value="Peripherals">Peripherals</option>
                    <option value="Furniture">Furniture</option>
                    <option value="Software & Licenses">Software & Licenses</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label className="text-caption" style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Price (₹)</label>
                  <input
                    type="number"
                    className="input-field"
                    value={newProduct.price}
                    onChange={(e) => setNewProduct({ ...newProduct, price: e.target.value })}
                    placeholder="1899"
                    required
                    min="1"
                  />
                </div>
                <div>
                  <label className="text-caption" style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>Initial Stock</label>
                  <input
                    type="number"
                    className="input-field"
                    value={newProduct.inventory}
                    onChange={(e) => setNewProduct({ ...newProduct, inventory: e.target.value })}
                    placeholder="50"
                    required
                    min="1"
                  />
                </div>
              </div>

              <div>
                <label className="text-caption" style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>AI Summary</label>
                <textarea
                  className="input-field"
                  rows={2}
                  value={newProduct.aiSummary}
                  onChange={(e) => setNewProduct({ ...newProduct, aiSummary: e.target.value })}
                  placeholder="20,000mAh high-density power bank with 22.5W fast charging..."
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem', borderTop: '1px solid #e2e8f0', paddingTop: '1rem' }}>
                <Button variant="secondary" type="button" onClick={() => setShowAddModal(false)}>
                  Cancel
                </Button>
                <Button variant="primary" type="submit" loading={saving}>
                  Publish to Catalog
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
