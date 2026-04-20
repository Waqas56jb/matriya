import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../utils/api.js';
import { t } from '../i18n/i18n.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ManagementUserCreate() {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!username.trim() || !email.trim() || !password) {
      setError(t('mgmtUsers.valRequired'));
      return;
    }
    if (!EMAIL_RE.test(email.trim())) {
      setError(t('mgmtUsers.valEmail'));
      return;
    }
    if (password.length < 6) {
      setError(t('mgmtUsers.valPasswordLen'));
      return;
    }
    setLoading(true);
    try {
      await api.post('/api/admin/management-users', {
        username: username.trim(),
        email: email.trim(),
        password
      });
      navigate('/management-users');
    } catch (err) {
      setError(err.message || t('mgmtUsers.createFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1>{t('pages.managementUserNew')}</h1>
        <p>{t('mgmtUsers.createLead')}</p>
      </div>

      <div className="section-card" style={{ maxWidth: 480 }}>
        {error && <div className="auth-error" style={{ marginBottom: 16 }}>{error}</div>}
        <form onSubmit={submit}>
          <div className="input-group">
            <label className="input-label">{t('mgmtUsers.fieldUsername')}</label>
            <input className="input-field" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" required />
          </div>
          <div className="input-group">
            <label className="input-label">{t('mgmtUsers.fieldEmail')}</label>
            <input className="input-field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" required />
          </div>
          <div className="input-group">
            <label className="input-label">{t('mgmtUsers.fieldPassword')}</label>
            <input className="input-field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required />
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? t('mgmtUsers.saving') : t('mgmtUsers.submitCreate')}
            </button>
            <Link to="/management-users" className="btn btn-secondary">{t('experiments.cancel')}</Link>
          </div>
        </form>
      </div>
    </div>
  );
}
