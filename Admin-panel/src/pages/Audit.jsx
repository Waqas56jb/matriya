import { useState, useEffect } from 'react';
import { api } from '../utils/api.js';
import { t } from '../i18n/i18n.js';

export default function Audit() {
  const [logs,    setLogs]    = useState([]);
  const [total,   setTotal]   = useState(0);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState('');
  const [page,    setPage]    = useState(1);

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams({ page, limit: 50 });
    if (search) params.set('action', search);
    api.get(`/api/admin/audit?${params}`)
      .then(d => { setLogs(d.logs || []); setTotal(d.total || 0); })
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [page]);
  useEffect(() => { const tm = setTimeout(load, 400); return () => clearTimeout(tm); }, [search]);

  const totalPages = Math.ceil(total / 50);

  const methodColor = (action) => {
    if (action?.startsWith('DELETE')) return 'var(--danger)';
    if (action?.startsWith('POST'))   return 'var(--success)';
    if (action?.startsWith('PATCH') || action?.startsWith('PUT')) return 'var(--warning)';
    return 'var(--text-secondary)';
  };

  return (
    <div>
      <div className="page-header">
        <h1>{t('pages.audit')}</h1>
        <p>{t('audit.subtitleCount', { count: total })}</p>
      </div>

      <div className="toolbar">
        <div className="search-bar" style={{ flex: 1, minWidth: 200 }}>
          <span className="search-icon">🔍</span>
          <input className="input-field" placeholder={t('audit.filterPh')} value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </div>
      </div>

      <div className="section-card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div className="loading"><div className="spinner" /></div>
        ) : logs.length === 0 ? (
          <div className="empty-state"><div className="icon">🔍</div><p>{t('audit.noLogs')}</p></div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr><th>{t('audit.thAdmin')}</th><th>{t('audit.thAction')}</th><th>{t('audit.thIp')}</th><th>{t('audit.thPayload')}</th><th>{t('audit.thTime')}</th></tr></thead>
              <tbody>
                {logs.map(l => (
                  <tr key={l.id}>
                    <td style={{ fontSize: 12, fontWeight: 600 }}>{l.admin_email || '—'}</td>
                    <td>
                      <span style={{ fontFamily: 'monospace', fontSize: 12, color: methodColor(l.action), fontWeight: 600 }}>
                        {l.action}
                      </span>
                    </td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-muted)' }}>{l.ip || '—'}</td>
                    <td style={{ fontSize: 11, color: 'var(--text-muted)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {l.body ? l.body.slice(0, 80) : '—'}
                    </td>
                    <td style={{ fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                      {l.created_at ? new Date(l.created_at).toLocaleString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
          <button className="btn btn-secondary btn-sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>{t('users.prev')}</button>
          <span style={{ display: 'flex', alignItems: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>{page} / {totalPages}</span>
          <button className="btn btn-secondary btn-sm" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>{t('users.next')}</button>
        </div>
      )}
    </div>
  );
}
