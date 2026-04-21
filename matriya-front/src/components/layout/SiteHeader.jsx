import React from 'react';
import { HiOutlineSparkles } from 'react-icons/hi2';
import './SiteHeader.css';

export default function SiteHeader({ user, onLogout, children }) {
  return (
    <header className="site-header">
      <div className="site-header__inner">
        <div className="site-header__brand">
          <span className="site-header__logo" aria-hidden>
            <HiOutlineSparkles />
          </span>
          <div className="site-header__titles">
            <span className="site-header__name">Matriya</span>
            <span className="site-header__tagline">Research · Evidence · Decisions</span>
          </div>
        </div>
        {user ? (
          <div className="site-header__actions">
            <span className="site-header__welcome">
              <span className="site-header__welcome-hi">Hello,</span>
              <span className="site-header__welcome-who">{user.full_name || user.username || ''}</span>
            </span>
            <button type="button" className="site-header__logout" onClick={onLogout}>
              Sign Out
            </button>
          </div>
        ) : null}
      </div>
      {children ? <div className="site-header__slot">{children}</div> : null}
    </header>
  );
}
