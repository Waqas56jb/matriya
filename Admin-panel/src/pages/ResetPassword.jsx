import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ADMIN_API_BASE } from '../config.js';
import LanguageSwitcher from '../components/LanguageSwitcher.jsx';
import { t } from '../i18n/i18n.js';
import './Auth.css';

export default function ResetPassword() {
  const [step, setStep]         = useState(1); // 1=email, 2=success
  const [email, setEmail]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res  = await fetch(`${ADMIN_API_BASE}/api/admin/auth/reset-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || t('reset.requestFailed'));
      }
      setStep(2);
    } catch (err) {
      setError(err.message);
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
          <Link to="/login" className="auth-tab">{t('login.signInTab')}</Link>
          <div className="auth-tab active">{t('reset.title')}</div>
        </div>

        {step === 1 ? (
          <form onSubmit={handleSubmit}>
            <p className="auth-description">
              {t('reset.description')}
            </p>

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
                />
              </div>
            </div>

            {error && <div className="auth-error">⚠ {error}</div>}

            <button type="submit" className="btn btn-primary btn-lg auth-submit" disabled={loading}>
              {loading ? <><span className="btn-spinner" /> {t('reset.sending')}</> : t('reset.sendLink')}
            </button>
          </form>
        ) : (
          <div className="auth-success-state">
            <div className="auth-success-icon">✓</div>
            <h3>{t('reset.successTitle')}</h3>
            <p>
              {t('reset.successBody')} <strong>{email}</strong>. {t('reset.successExpire')}
            </p>
          </div>
        )}

        <div className="auth-footer-link">
          {t('reset.remember')}{' '}
          <Link to="/login">{t('reset.signInHere')}</Link>
        </div>
      </div>
    </div>
  );
}
