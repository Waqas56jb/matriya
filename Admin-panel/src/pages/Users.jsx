import { useState, useEffect } from 'react';
import { api } from '../utils/api.js';

function RoleBadge({ is_admin }) {
  return is_admin
    ? <span className="badge badge-danger">Admin</span>
    : <span className="badge badge-info">Operator</span>;
}

function StatusBadge({ is_active, status }) {
  const s = status || (is_active ? 'active' : 'inactive');
  const map = { active: 'success', blocked: 'danger', rejected: 'muted', inactive: 'warning' };
  return <span className={`badge badge-${map[s] || 'muted'}`}>{s}</span>;
}

export default function Users() {
  const [users,   setUsers]   = useState([]);
  const [total,   setTotal]   = useState(0);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState('');
  const [active,  setActive]  = useState('all');
  const [page,    setPage]    = useState(1);
  const [toast,   setToast]   = useState(null);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams({ page, limit: 20 });
    if (search) params.set('search', search);
    if (active !== 'all') params.set('active', active);
    api.get(`/api/admin/users?${params}`)
      .then(d => { setUsers(d.users || []); setTotal(d.total || 0); })
      .catch(e => showToast(e.message, 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [page, active]);
  useEffect(() => { const t = setTimeout(load, 400); return () => clearTimeout(t); }, [search]);

  const action = async (userId, endpoint, body) => {
    try {
      await api.post(`/api/admin/users/${userId}/${endpoint}`, body);
      showToast(`Done — ${endpoint}`);
      load();
    } catch (e) { showToast(e.message, 'error'); }
  };

  const totalPages = Math.ceil(total / 20);

  return (
    <div>
      <div className="page-header">
        <h1>User Management</h1>
        <p>{total} total users registered</p>
      </div>

      <div className="toolbar">
        <div className="search-bar" style={{ flex: 1, minWidth: 200 }}>
          <span className="search-icon">🔍</span>
          <input
            className="input-field"
            placeholder="Search by email or username…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <select className="input-field" style={{ width: 'auto' }}
          value={active} onChange={e => { setActive(e.target.value); setPage(1); }}>
          <option value="all">All Users</option>
          <option value="true">Active</option>
          <option value="false">Inactive / Blocked</option>
        </select>
      </div>

      <div className="section-card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div className="loading"><div className="spinner" /></div>
        ) : users.length === 0 ? (
          <div className="empty-state"><div className="icon">👥</div><p>No users found</p></div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Last Login</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div className="user-avatar">{(u.username || u.email || '?')[0].toUpperCase()}</div>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{u.username || '—'}</div>
                          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{u.email}</div>
                          {u.full_name && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{u.full_name}</div>}
                        </div>
                      </div>
                    </td>
                    <td><RoleBadge is_admin={u.is_admin} /></td>
                    <td><StatusBadge is_active={u.is_active} status={u.status} /></td>
                    <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      {u.last_login ? new Date(u.last_login).toLocaleString() : '—'}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {!u.is_active && (
                          <button className="btn btn-success btn-sm" onClick={() => action(u.id, 'approve')}>✓ Activate</button>
                        )}
                        {u.is_active && (
                          <button className="btn btn-danger btn-sm" onClick={() => action(u.id, 'block', { reason: 'Blocked by admin' })}>🚫 Block</button>
                        )}
                        {!u.is_active && u.status === 'blocked' && (
                          <button className="btn btn-success btn-sm" onClick={() => action(u.id, 'unblock')}>✓ Unblock</button>
                        )}
                        <button className="btn btn-secondary btn-sm" onClick={() => action(u.id, 'revoke')}>⎋ Revoke</button>
                      </div>
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
          <button className="btn btn-secondary btn-sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
          <span style={{ display: 'flex', alignItems: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>{page} / {totalPages}</span>
          <button className="btn btn-secondary btn-sm" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>Next →</button>
        </div>
      )}

      {toast && <div className={`toast ${toast.type}`}><span>{toast.type === 'success' ? '✓' : '⚠'}</span>{toast.msg}</div>}
    </div>
  );
}
