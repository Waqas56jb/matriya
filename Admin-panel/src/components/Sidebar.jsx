import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import LanguageSwitcher from './LanguageSwitcher.jsx';
import { t } from '../i18n/i18n.js';
import './Sidebar.css';

const NAV = [
  { to: '/dashboard',    icon: '◈', labelKey: 'nav.dashboard'   },
  { to: '/users',        icon: '👥', labelKey: 'nav.users'       },
  { to: '/management-users', icon: '🏢', labelKey: 'nav.managementUsers' },
  { to: '/sessions',     icon: '⚡', labelKey: 'nav.sessions'    },
  { to: '/analytics',    icon: '📊', labelKey: 'nav.analytics'   },
  { to: '/whatsapp',     icon: '💬', labelKey: 'nav.whatsapp'    },
  { to: '/experiments',  icon: '🧪', labelKey: 'nav.experiments' },
  { to: '/system',       icon: '🖥', labelKey: 'nav.system'      },
  { to: '/audit',        icon: '🔍', labelKey: 'nav.audit'       },
  { to: '/config',       icon: '⚙', labelKey: 'nav.config'      },
];

export default function Sidebar({ mobile, onClose }) {
  const { admin, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <aside className={`sidebar ${mobile ? 'sidebar-mobile' : ''}`}>
      <div className="sidebar-header">
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">M</div>
          <div>
            <div className="sidebar-logo-name">MATRIYA</div>
            <div className="sidebar-logo-sub">{t('nav.adminPanel')}</div>
          </div>
        </div>
        {mobile && (
          <button className="sidebar-close" onClick={onClose}>✕</button>
        )}
      </div>

      <div className="sidebar-lang">
        <LanguageSwitcher />
      </div>

      <nav className="sidebar-nav">
        {NAV.map(({ to, icon, labelKey }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
            onClick={mobile ? onClose : undefined}
          >
            <span className="sidebar-link-icon">{icon}</span>
            <span className="sidebar-link-label">{t(labelKey)}</span>
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-admin-info">
          <div className="sidebar-admin-avatar">
            {admin?.email?.[0]?.toUpperCase() || 'A'}
          </div>
          <div className="sidebar-admin-details">
            <div className="sidebar-admin-email">{admin?.email || 'Admin'}</div>
            <div className="sidebar-admin-role">{t('nav.administrator')}</div>
          </div>
        </div>
        <button className="sidebar-logout" onClick={handleLogout} title={t('nav.signOut')}>
          ⎋
        </button>
      </div>
    </aside>
  );
}
