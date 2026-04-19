import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar.jsx';
import './Layout.css';

const PAGE_TITLES = {
  '/dashboard':   'Dashboard',
  '/users':       'User Management',
  '/sessions':    'Active Sessions',
  '/analytics':   'Analytics',
  '/whatsapp':    'WhatsApp',
  '/experiments': 'Experiments',
  '/system':      'System Health',
  '/audit':       'Audit Log',
  '/config':      'Configuration',
};

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const title = PAGE_TITLES[location.pathname] || 'Admin Panel';

  return (
    <div className="layout">
      {/* Desktop sidebar */}
      <Sidebar />

      {/* Mobile sidebar overlay */}
      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}
      <div className={`sidebar sidebar-mobile ${sidebarOpen ? 'open' : ''}`}
        style={{ position: 'fixed', top: 0, left: 0, zIndex: 200 }}>
        <Sidebar mobile onClose={() => setSidebarOpen(false)} />
      </div>

      <div className="layout-main">
        {/* Top bar */}
        <header className="topbar">
          <button className="topbar-menu" onClick={() => setSidebarOpen(true)} aria-label="Menu">
            ☰
          </button>
          <div className="topbar-title">{title}</div>
          <div className="topbar-right">
            <div className="topbar-status">
              <span className="status-dot" />
              <span>Live</span>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="layout-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
