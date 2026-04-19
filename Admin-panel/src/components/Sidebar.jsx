import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import './Sidebar.css';

const NAV = [
  { to: '/dashboard',    icon: '◈', label: 'Dashboard'   },
  { to: '/users',        icon: '👥', label: 'Users'       },
  { to: '/sessions',     icon: '⚡', label: 'Sessions'    },
  { to: '/analytics',    icon: '📊', label: 'Analytics'   },
  { to: '/whatsapp',     icon: '💬', label: 'WhatsApp'    },
  { to: '/experiments',  icon: '🧪', label: 'Experiments' },
  { to: '/system',       icon: '🖥', label: 'System'      },
  { to: '/audit',        icon: '🔍', label: 'Audit Log'   },
  { to: '/config',       icon: '⚙', label: 'Config'      },
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
            <div className="sidebar-logo-sub">Admin Panel</div>
          </div>
        </div>
        {mobile && (
          <button className="sidebar-close" onClick={onClose}>✕</button>
        )}
      </div>

      <nav className="sidebar-nav">
        {NAV.map(({ to, icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
            onClick={mobile ? onClose : undefined}
          >
            <span className="sidebar-link-icon">{icon}</span>
            <span className="sidebar-link-label">{label}</span>
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
            <div className="sidebar-admin-role">Administrator</div>
          </div>
        </div>
        <button className="sidebar-logout" onClick={handleLogout} title="Sign out">
          ⎋
        </button>
      </div>
    </aside>
  );
}
