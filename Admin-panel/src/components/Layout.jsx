import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar.jsx';
import LanguageSwitcher from './LanguageSwitcher.jsx';
import { t } from '../i18n/i18n.js';
import './Layout.css';

const PATH_PAGE = {
  '/dashboard':   'dashboard',
  '/users':       'users',
  '/sessions':    'sessions',
  '/analytics':   'analytics',
  '/whatsapp':    'whatsapp',
  '/experiments': 'experiments',
  '/system':      'system',
  '/audit':       'audit',
  '/config':      'config',
  '/management-users':     'managementUsers',
  '/management-users/new': 'managementUserNew',
};

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const pageKey = PATH_PAGE[location.pathname];
  const title = pageKey ? t(`pages.${pageKey}`) : t('layout.defaultTitle');

  return (
    <div className="layout">
      {/* Desktop sidebar */}
      <Sidebar />

      {/* Mobile sidebar overlay */}
      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}
      <div className={`sidebar sidebar-mobile ${sidebarOpen ? 'open' : ''}`}
        style={{ position: 'fixed', top: 0, insetInlineStart: 0, zIndex: 200 }}>
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
            <div className="topbar-lang-mobile">
              <LanguageSwitcher />
            </div>
            <div className="topbar-status">
              <span className="status-dot" />
              <span>{t('layout.live')}</span>
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
