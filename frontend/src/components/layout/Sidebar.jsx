import { NavLink } from 'react-router-dom';
import './Sidebar.css';

const navSections = [
  {
    label: 'Overview',
    links: [
      { to: '/', icon: '◈', label: 'Command Center' },
      { to: '/ai-buyer', icon: '⚡', label: 'AI Buyer' },
    ],
  },
  {
    label: 'Governance',
    links: [
      { to: '/agents', icon: '⛊', label: 'Agents' },
      { to: '/policies', icon: '⚖', label: 'Policies' },
      { to: '/approvals', icon: '✋', label: 'Approvals', badgeKey: 'pendingApprovals' },
      { to: '/transactions', icon: '↕', label: 'Transactions' },
    ],
  },
  {
    label: 'Assurance',
    links: [
      { to: '/risk', icon: '🛡', label: 'Risk Center' },
      { to: '/audit', icon: '📋', label: 'Audit Trail' },
      { to: '/security-lab', icon: '🔒', label: 'Security Lab' },
      { to: '/simulation', icon: '▶', label: 'Simulation' },
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

export default function Sidebar({ pendingApprovals = 0 }) {
  return (
    <aside className="sidebar-root">
      <div className="sidebar-brand">
        <span className="sidebar-brand-badge">AP</span>
        <span>AgentPay</span>
      </div>

      <div className="sidebar-nav-container">
        {navSections.map((section) => (
          <div key={section.label}>
            <div className="sidebar-group-title">{section.label}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {section.links.map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  end={link.to === '/'}
                  className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
                >
                  <span className="sidebar-link-icon">{link.icon}</span>
                  <span>{link.label}</span>
                  {link.badgeKey === 'pendingApprovals' && pendingApprovals > 0 && (
                    <span className="sidebar-counter-badge">{pendingApprovals}</span>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="sidebar-status-bar">
        <span className="mono">v1.0.0</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: 'var(--success)' }}></span>
          <span>Online</span>
        </span>
      </div>
    </aside>
  );
}
