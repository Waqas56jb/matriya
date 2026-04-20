import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../utils/api.js';
import { t } from '../i18n/i18n.js';

export default function ManagementUsers() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/api/admin/management-users')
      .then((d) => setUsers(d.users || []))
      .catch((e) => setError(e.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading"><div className="spinner" /></div>;

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1>{t('pages.managementUsers')}</h1>
          <p>{t('mgmtUsers.subtitle')}</p>
        </div>
        <Link to="/management-users/new" className="btn btn-primary">{t('mgmtUsers.createCta')}</Link>
      </div>

      {error && <div className="auth-error" style={{ marginBottom: 16 }}>{error}</div>}

      <div className="section-card" style={{ padding: 0, overflow: 'hidden' }}>
        {users.length === 0 ? (
          <div className="empty-state"><div className="icon">👤</div><p>{t('mgmtUsers.empty')}</p></div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>{t('mgmtUsers.thUsername')}</th>
                  <th>{t('mgmtUsers.thEmail')}</th>
                  <th>{t('mgmtUsers.thPassword')}</th>
                  <th>{t('mgmtUsers.thPwUpdated')}</th>
                  <th>{t('mgmtUsers.thCreated')}</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td style={{ fontWeight: 600 }}>{u.username}</td>
                    <td>{u.email}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{u.password}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      {u.password_updated_at ? new Date(u.password_updated_at).toLocaleString() : '—'}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {u.created_at ? new Date(u.created_at).toLocaleString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
