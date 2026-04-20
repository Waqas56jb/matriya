import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import LanguageSwitcher from '../components/LanguageSwitcher.jsx';
import { t } from '../i18n/i18n.js';
import './Auth.css';

export default function Login() {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw]     = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const { login }               = useAuth();
  const navigate                = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/dashboard');
    } catch (err) {
      setError(err.message || t('login.loginFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-bg">
        <div className="auth-orb auth-orb-1" />
        <div className="auth-orb auth-orb-2" />
        <div className="auth-orb auth-orb-3" />
      </div>

      <div className="auth-card">
        <div className="auth-card-top">
          <LanguageSwitcher className="lang-switcher--auth" />
        </div>
        <div className="auth-logo">
          <div className="auth-logo-icon">M</div>
          <div>
            <div className="auth-logo-name">MATRIYA</div>
            <div className="auth-logo-sub">{t('login.commandCenter')}</div>
          </div>
        </div>

        <div className="auth-tabs">
          <div className="auth-tab active">{t('login.signInTab')}</div>
          <Link to="/reset-password" className="auth-tab">{t('login.resetTab')}</Link>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="input-group">
            <label className="input-label">{t('login.email')}</label>
            <div className="input-icon-wrap">
              <span className="input-icon">✉</span>
              <input
                type="email"
                className="input-field"
                placeholder="admin@matriya.io"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
          </div>

          <div className="input-group">
            <label className="input-label">{t('login.password')}</label>
            <div className="input-icon-wrap">
              <span className="input-icon">🔒</span>
              <input
                type={showPw ? 'text' : 'password'}
                className="input-field"
                placeholder="••••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
              <button type="button" className="pw-toggle" onClick={() => setShowPw(p => !p)}>
                {showPw ? '🙈' : '👁'}
              </button>
            </div>
          </div>

          {error && <div className="auth-error">⚠ {error}</div>}

          <button type="submit" className="btn btn-primary btn-lg auth-submit" disabled={loading}>
            {loading ? <><span className="btn-spinner" /> {t('login.signingIn')}</> : t('login.signInCta')}
          </button>
        </form>

        <div className="auth-footer-link">
          {t('login.forgot')}{' '}
          <Link to="/reset-password">{t('login.resetHere')}</Link>
        </div>
      </div>
    </div>
  );
}
