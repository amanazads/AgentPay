import { useState, useEffect } from 'react';
import { api } from '../services/api';
import './ProductCatalog.css';

export default function ProductCatalog() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');

  useEffect(() => {
    fetchProducts();
  }, [categoryFilter]);

  const fetchProducts = async () => {
    setLoading(true);
    try {
      const res = await api.getProducts({
        category: categoryFilter !== 'all' ? categoryFilter : undefined,
        search: searchQuery || undefined,
        limit: 50,
      });
      setProducts(res.products || []);
    } catch (e) {
      console.error('Failed to load products', e);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (val) => {
    const num = parseFloat(val) || 0;
    return `₹${num.toLocaleString('en-IN')}`;
  };

  return (
    <div>
      {/* Search & Filter Bar */}
      <div className="card-panel" style={{ marginBottom: '1.5rem' }}>
        <div style={{ padding: '0.75rem 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div className="catalog-search-bar">
            <input
              type="text"
              className="input-ui"
              placeholder="Search products, brands, or specs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && fetchProducts()}
              style={{ maxWidth: '320px' }}
            />
            <select
              className="select-ui"
              style={{ width: 'auto', padding: '5px 10px', fontSize: '0.75rem' }}
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
            >
              <option value="all">All Categories</option>
              <option value="electronics">Electronics</option>
              <option value="software">Software & Licenses</option>
              <option value="office_supplies">Office Supplies</option>
              <option value="peripherals">Peripherals</option>
              <option value="furniture">Furniture</option>
            </select>
          </div>

          <div style={{ fontSize: '0.75rem', color: 'var(--text-subtle)' }}>
            Showing {products.length} catalog items
          </div>
        </div>
      </div>

      {/* Products Table & Mobile Cards */}
      <div className="card-panel">
        {loading ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-subtle)', fontSize: '0.875rem' }}>
            Loading verified catalog...
          </div>
        ) : products.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-subtle)', fontSize: '0.875rem' }}>
            No products found matching your search.
          </div>
        ) : (
          <>
            <div className="table-scroll catalog-table-view">
              <table className="table-clean">
                <thead>
                  <tr>
                    <th>Product Name</th>
                    <th>Category</th>
                    <th>Merchant</th>
                    <th>Price</th>
                    <th>Inventory</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <div style={{ fontWeight: 500 }}>{p.name}</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-subtle)' }}>
                          {p.description ? p.description.substring(0, 70) + '...' : ''}
                        </div>
                      </td>
                      <td>
                        <span className="badge-tag">{p.category}</span>
                      </td>
                      <td>
                        <div style={{ fontSize: '0.75rem', fontWeight: 500 }}>{p.merchant_name}</div>
                        <span className={`badge-status ${p.merchant_verified ? 'success' : 'danger'}`} style={{ fontSize: '9px', padding: '1px 5px' }}>
                          {p.merchant_verified ? 'Verified' : 'Untrusted'}
                        </span>
                      </td>
                      <td className="mono" style={{ fontWeight: 600 }}>
                        {formatCurrency(p.price)}
                      </td>
                      <td>
                        <span className={`badge-status ${p.in_stock ? 'neutral' : 'danger'}`}>
                          {p.in_stock ? 'In Stock' : 'Out of Stock'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards */}
            <div className="catalog-mobile-cards">
              {products.map((p) => (
                <div key={p.id} className="catalog-card-item">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>{p.name}</span>
                    <span className="mono" style={{ fontWeight: 700 }}>{formatCurrency(p.price)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                    <span style={{ color: 'var(--text-subtle)' }}>Merchant:</span>
                    <span>{p.merchant_name} ({p.merchant_verified ? 'Verified' : 'Untrusted'})</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                    <span style={{ color: 'var(--text-subtle)' }}>Category:</span>
                    <span className="badge-tag">{p.category}</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
