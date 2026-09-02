import { NavLink } from 'react-router-dom';
import './MobileNav.css';

const allSections = [
  {
    label: 'Overview',
    links: [
      { to: '/', icon: '◈', label: 'Command Center' },
      { to: '/ai-buyer', icon: '⚡', label: 'AI Buyer Agent' },
    ],
  },
  {
    label: 'Governance',
    links: [
      { to: '/agents', icon: '⛊', label: 'Agents' },
      { to: '/policies', icon: '⚖', label: 'Policies' },
      { to: '/approvals', icon: '✋', label: 'Approvals' },
      { to: '/transactions', icon: '↕', label: 'Transactions' },
    ],
  },
  {
    label: 'Assurance',
    links: [
      { to: '/risk', icon: '🛡', label: 'Risk Center' },
      { to: '/audit', icon: '📋', label: 'Audit Trail' },
      { to: '/security-lab', icon: '🔒', label: 'Security Lab' },
    ],
  },
  {
    label: 'System',
    links: [
      { to: '/products', icon: '📦', label: 'Catalog' },
      { to: '/settings', icon: '⚙', label: 'Settings' },
    ],
  },
];

export default function MobileDrawer({ isOpen, onClose }) {
  if (!isOpen) return null;

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className={`drawer-content ${isOpen ? 'open' : ''}`}>
        <div style={{ height: 'var(--header-h)', padding: '0 1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700, fontSize: '0.95rem' }}>
            <span style={{ width: '24px', height: '24px', backgroundColor: 'var(--primary)', color: '#fff', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px' }}>AP</span>
            <span>AgentPay</span>
          </div>
          <button
            onClick={onClose}
            className="btn-ui btn-ui-sm btn-ui-outline"
            aria-label="Close menu"
          >
            ✕
          </button>
        </div>

        <div style={{ flex: 1, padding: '0.75rem 0.5rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {allSections.map((section) => (
            <div key={section.label}>
              <div style={{ padding: '0.25rem 0.5rem', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-subtle)' }}>
                {section.label}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                {section.links.map((link) => (
                  <NavLink
                    key={link.to}
                    to={link.to}
                    end={link.to === '/'}
                    onClick={onClose}
                    className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
                  >
                    <span className="sidebar-link-icon">{link.icon}</span>
                    <span>{link.label}</span>
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
