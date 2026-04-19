import { useState, useEffect } from 'react';
import { api } from '../utils/api.js';

export default function Sessions() {
  const [sessions, setSessions] = useState([]);
  const [live,     setLive]     = useState(0);
  const [loading,  setLoading]  = useState(true);
  const [toast,    setToast]    = useState(null);

  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };

  const load = () => {
    setLoading(true);
    Promise.allSettled([
      api.get('/api/admin/sessions'),
      api.get('/api/admin/sessions/live'),
    ]).then(([all, lv]) => {
      if (all.status === 'fulfilled') setSessions(all.value.sessions || []);
      if (lv.status  === 'fulfilled') setLive(lv.value.live_count || 0);
    }).finally(() => setLoading(false));
  };

  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, []);

  const revokeAll = async () => {
    if (!confirm('Revoke ALL active sessions? All users will be logged out.')) return;
    try {
      await api.post('/api/admin/sessions/revoke-all', { confirm: 'REVOKE_ALL' });
      showToast('All sessions revoked');
      load();
    } catch (e) { showToast(e.message, 'error'); }
  };

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1>Active Sessions</h1>
          <p><span style={{ color: 'var(--success)', fontWeight: 700 }}>{live}</span> users active in last 15 min</p>
        </div>
        <button className="btn btn-danger" onClick={revokeAll}>⚠ Revoke All Sessions</button>
      </div>

      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(3,1fr)', marginBottom: 24 }}>
        {[
          { icon: '⚡', color: 'cyan',  label: 'Live Now',       value: live },
          { icon: '👥', color: 'purple', label: 'Total Active',  value: sessions.length },
          { icon: '🕐', color: 'green',  label: 'Auto-refresh',  value: '30s' },
        ].map(s => (
          <div className="stat-card" key={s.label}>
            <div className={`stat-icon ${s.color}`}>{s.icon}</div>
            <div className="stat-info">
              <div className="stat-value">{s.value}</div>
              <div className="stat-label">{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="section-card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div className="loading"><div className="spinner" /></div>
        ) : sessions.length === 0 ? (
          <div className="empty-state"><div className="icon">⚡</div><p>No active sessions</p></div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr><th>User</th><th>IP Address</th><th>Device</th><th>Logged In</th><th>Last Active</th></tr>
              </thead>
              <tbody>
                {sessions.map(s => (
                  <tr key={s.id}>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{s.users?.username || '—'}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{s.users?.email}</div>
                    </td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{s.ip_address || '—'}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{s.device || '—'}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      {s.logged_in_at ? new Date(s.logged_in_at).toLocaleString() : '—'}
                    </td>
                    <td>
                      <span style={{ fontSize: 12, color: 'var(--accent-cyan)' }}>
                        {s.last_active_at ? new Date(s.last_active_at).toLocaleString() : '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {toast && <div className={`toast ${toast.type}`}><span>{toast.type === 'success' ? '✓' : '⚠'}</span>{toast.msg}</div>}
    </div>
  );
}
