import { useState, useEffect } from 'react';
import { api } from '../utils/api.js';

const TABS = ['Requests', 'Queue', 'Whitelist', 'Blocked'];

export default function WhatsApp() {
  const [tab,       setTab]       = useState('Requests');
  const [requests,  setRequests]  = useState([]);
  const [reqFilter, setReqFilter] = useState('pending');
  const [queue,     setQueue]     = useState([]);
  const [whitelist, setWhitelist] = useState([]);
  const [blocked,   setBlocked]   = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [search,    setSearch]    = useState('');
  const [newPhone,  setNewPhone]  = useState('');
  const [newLabel,  setNewLabel]  = useState('');
  const [toast,     setToast]     = useState(null);

  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };

  const load = () => {
    setLoading(true);
    Promise.allSettled([
      api.get(`/api/admin/whatsapp/requests?status=${reqFilter}`),
      api.get('/api/admin/whatsapp/queue?limit=50'),
      api.get('/api/admin/whatsapp/whitelist'),
      api.get('/api/admin/whatsapp/blocked'),
    ]).then(([rq, q, wl, bl]) => {
      if (rq.status === 'fulfilled') setRequests(rq.value.requests || []);
      if (q.status  === 'fulfilled') setQueue(q.value.tasks || []);
      if (wl.status === 'fulfilled') setWhitelist(wl.value.whitelist || []);
      if (bl.status === 'fulfilled') setBlocked(bl.value.blocked || []);
    }).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [reqFilter]);

  const approveRequest = async (id, phone) => {
    try {
      await api.post(`/api/admin/whatsapp/requests/${id}/approve`);
      showToast(`✓ ${phone} approved — they can now message MATRIYA`);
      load();
    } catch (e) { showToast(e.message, 'error'); }
  };

  const denyRequest = async (id, phone) => {
    try {
      await api.post(`/api/admin/whatsapp/requests/${id}/deny`);
      showToast(`${phone} denied`);
      load();
    } catch (e) { showToast(e.message, 'error'); }
  };

  const resend = async (id) => {
    try { await api.post(`/api/admin/whatsapp/resend/${id}`); showToast('Message resent'); load(); }
    catch (e) { showToast(e.message, 'error'); }
  };

  const addToWhitelist = async (e) => {
    e.preventDefault();
    if (!newPhone) return;
    try {
      await api.post('/api/admin/whatsapp/whitelist', { phone_number: newPhone, label: newLabel });
      showToast('Number added to whitelist');
      setNewPhone(''); setNewLabel(''); load();
    } catch (e) { showToast(e.message, 'error'); }
  };

  const removeFromWhitelist = async (phone) => {
    if (!confirm(`Remove ${phone} from whitelist?`)) return;
    try { await api.delete(`/api/admin/whatsapp/whitelist/${encodeURIComponent(phone)}`); showToast('Removed'); load(); }
    catch (e) { showToast(e.message, 'error'); }
  };

  const decisionIcon = (d) => ({ GO: '✅', ITERATE: '⚠️', STOP: '🛑' }[d] || '❓');

  const filteredQueue = queue.filter(t =>
    !search || (t.from_number || '').includes(search) || (t.message || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div className="page-header">
        <h1>WhatsApp Management</h1>
        <p>Task queue, whitelist, and blocked numbers</p>
      </div>

      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)', marginBottom: 24 }}>
        {[
          { icon: '🔔', color: 'orange', label: 'Access Requests', value: requests.filter(r => r.status === 'pending').length },
          { icon: '📨', color: 'cyan',   label: 'Queue Tasks',     value: queue.length     },
          { icon: '✅', color: 'green',  label: 'Whitelisted',     value: whitelist.length },
          { icon: '🚫', color: 'red',    label: 'Blocked Numbers', value: blocked.length   },
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

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: 'var(--bg-card2)', padding: 4, borderRadius: 10, border: '1px solid var(--border)', width: 'fit-content' }}>
        {TABS.map(t => (
          <button key={t} className={`btn btn-sm ${tab === t ? 'btn-primary' : 'btn-secondary'}`}
            style={{ border: 'none' }} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      {loading ? <div className="loading"><div className="spinner" /></div> : (
        <>
          {/* Access Requests */}
          {tab === 'Requests' && (
            <>
              <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)', marginRight: 4 }}>Show:</span>
                {['pending', 'approved', 'denied', 'all'].map(f => (
                  <button key={f} className={`btn btn-sm ${reqFilter === f ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setReqFilter(f)} style={{ textTransform: 'capitalize' }}>{f}</button>
                ))}
              </div>

              <div className="section-card" style={{ padding: 0, overflow: 'hidden' }}>
                {requests.length === 0 ? (
                  <div className="empty-state">
                    <div className="icon">🔔</div>
                    <p>{reqFilter === 'pending' ? 'No pending access requests' : `No ${reqFilter} requests`}</p>
                  </div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table>
                      <thead>
                        <tr>
                          <th>Phone Number</th>
                          <th>First Message</th>
                          <th>Attempts</th>
                          <th>First Seen</th>
                          <th>Last Seen</th>
                          <th>Status</th>
                          <th style={{ minWidth: 160 }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {requests.map(r => (
                          <tr key={r.id}>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--accent-grad)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                                  {(r.phone_number || '?').replace('whatsapp:+', '').slice(-2)}
                                </div>
                                <div>
                                  <div style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                                    {(r.phone_number || '').replace('whatsapp:', '')}
                                  </div>
                                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>WhatsApp</div>
                                </div>
                              </div>
                            </td>
                            <td style={{ maxWidth: 200, fontSize: 12, color: 'var(--text-secondary)' }}>
                              <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                "{r.first_message || '—'}"
                              </div>
                            </td>
                            <td>
                              <span style={{ background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.3)', color: 'var(--warning)', borderRadius: 20, padding: '2px 10px', fontSize: 12, fontWeight: 700 }}>
                                {r.request_count || 1}×
                              </span>
                            </td>
                            <td style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                              {r.first_seen ? new Date(r.first_seen).toLocaleString() : '—'}
                            </td>
                            <td style={{ fontSize: 11, color: 'var(--accent-cyan)', whiteSpace: 'nowrap' }}>
                              {r.last_seen ? new Date(r.last_seen).toLocaleString() : '—'}
                            </td>
                            <td>
                              <span className={`badge badge-${r.status === 'approved' ? 'success' : r.status === 'denied' ? 'danger' : 'warning'}`}>
                                {r.status}
                              </span>
                              {r.reviewed_by && (
                                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>by {r.reviewed_by}</div>
                              )}
                            </td>
                            <td>
                              {r.status === 'pending' && (
                                <div style={{ display: 'flex', gap: 6 }}>
                                  <button className="btn btn-success btn-sm"
                                    onClick={() => approveRequest(r.id, r.phone_number)}>
                                    ✓ Approve
                                  </button>
                                  <button className="btn btn-danger btn-sm"
                                    onClick={() => denyRequest(r.id, r.phone_number)}>
                                    ✕ Deny
                                  </button>
                                </div>
                              )}
                              {r.status === 'approved' && (
                                <span style={{ fontSize: 12, color: 'var(--success)' }}>✓ Access granted</span>
                              )}
                              {r.status === 'denied' && (
                                <span style={{ fontSize: 12, color: 'var(--danger)' }}>✕ Access denied</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Queue */}
          {tab === 'Queue' && (
            <div className="section-card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
                <div className="search-bar">
                  <span className="search-icon">🔍</span>
                  <input className="input-field" placeholder="Search by number or message…" value={search} onChange={e => setSearch(e.target.value)} />
                </div>
              </div>
              {filteredQueue.length === 0 ? (
                <div className="empty-state"><div className="icon">💬</div><p>No messages in queue</p></div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table>
                    <thead><tr><th>From</th><th>Message</th><th>Decision</th><th>Status</th><th>Time</th><th>Action</th></tr></thead>
                    <tbody>
                      {filteredQueue.map(t => (
                        <tr key={t.id}>
                          <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{(t.from_number || '').replace('whatsapp:', '')}</td>
                          <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>{t.message || '—'}</td>
                          <td>{t.decision ? <>{decisionIcon(t.decision)} <span style={{ fontSize: 12 }}>{t.decision}</span></> : '—'}</td>
                          <td><span className={`badge badge-${t.status === 'completed' ? 'success' : t.status === 'failed' ? 'danger' : 'warning'}`}>{t.status || 'pending'}</span></td>
                          <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t.received_at ? new Date(t.received_at).toLocaleString() : '—'}</td>
                          <td><button className="btn btn-secondary btn-sm" onClick={() => resend(t.id)}>↺ Resend</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Whitelist */}
          {tab === 'Whitelist' && (
            <>
              <div className="section-card" style={{ marginBottom: 20 }}>
                <div className="section-title">➕ Add to Whitelist</div>
                <form onSubmit={addToWhitelist} style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <input className="input-field" style={{ flex: 1, minWidth: 160 }} placeholder="+972501234567" value={newPhone} onChange={e => setNewPhone(e.target.value)} required />
                  <input className="input-field" style={{ flex: 1, minWidth: 160 }} placeholder="Label (optional)" value={newLabel} onChange={e => setNewLabel(e.target.value)} />
                  <button type="submit" className="btn btn-primary">Add Number</button>
                </form>
              </div>
              <div className="section-card" style={{ padding: 0, overflow: 'hidden' }}>
                {whitelist.length === 0 ? (
                  <div className="empty-state"><div className="icon">✅</div><p>No whitelisted numbers</p></div>
                ) : (
                  <table>
                    <thead><tr><th>Phone Number</th><th>Label</th><th>Added</th><th>Action</th></tr></thead>
                    <tbody>
                      {whitelist.map(w => (
                        <tr key={w.phone}>
                          <td style={{ fontFamily: 'monospace' }}>{w.phone}</td>
                          <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{w.label || '—'}</td>
                          <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{w.added_at ? new Date(w.added_at).toLocaleDateString() : '—'}</td>
                          <td><button className="btn btn-danger btn-sm" onClick={() => removeFromWhitelist(w.phone)}>Remove</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}

          {/* Blocked */}
          {tab === 'Blocked' && (
            <div className="section-card" style={{ padding: 0, overflow: 'hidden' }}>
              {blocked.length === 0 ? (
                <div className="empty-state"><div className="icon">🚫</div><p>No blocked numbers</p></div>
              ) : (
                  <table>
                    <thead><tr><th>Phone Number</th><th>Label</th><th>Added At</th></tr></thead>
                    <tbody>
                      {blocked.map(b => (
                        <tr key={b.phone}>
                          <td style={{ fontFamily: 'monospace' }}>{b.phone}</td>
                          <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{b.label || '—'}</td>
                          <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{b.added_at ? new Date(b.added_at).toLocaleString() : '—'}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </>
      )}

      {toast && <div className={`toast ${toast.type}`}><span>{toast.type === 'success' ? '✓' : '⚠'}</span>{toast.msg}</div>}
    </div>
  );
}
