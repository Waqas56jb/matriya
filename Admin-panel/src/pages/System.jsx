import { useState, useEffect } from 'react';
import { api } from '../utils/api.js';

export default function System() {
  const [health,  setHealth]  = useState(null);
  const [logs,    setLogs]    = useState([]);
  const [env,     setEnv]     = useState({});
  const [loading, setLoading] = useState(true);
  const [tab,     setTab]     = useState('Health');
  const [logLevel,setLogLevel]= useState('error');

  const loadHealth = () => api.get('/api/admin/system/health').then(d => setHealth(d)).catch(console.error);
  const loadEnv    = () => api.get('/api/admin/system/env').then(d => setEnv(d.env || {})).catch(console.error);
  const loadLogs   = (lv) => api.get(`/api/admin/system/logs?level=${lv}&limit=100`).then(d => setLogs(d.logs || [])).catch(console.error);

  useEffect(() => {
    setLoading(true);
    Promise.allSettled([loadHealth(), loadEnv()]).finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadLogs(logLevel); }, [logLevel]);

  const overall = health?.overall || 'unknown';
  const overallColor = { healthy: '#10b981', degraded: '#f59e0b', unknown: '#4d6a88' };

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div><h1>System Health</h1><p>Service status and infrastructure</p></div>
        <button className="btn btn-secondary" onClick={loadHealth}>↺ Refresh</button>
      </div>

      {/* Overall status */}
      <div className="section-card" style={{ marginBottom: 24, background: 'var(--bg-card2)', border: `1px solid ${overallColor[overall]}40`, padding: '20px 24px', display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ width: 14, height: 14, background: overallColor[overall], borderRadius: '50%', boxShadow: `0 0 10px ${overallColor[overall]}`, flexShrink: 0 }} />
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>System status: <span style={{ color: overallColor[overall], textTransform: 'capitalize' }}>{overall}</span></div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>Checked at {health?.checked_at ? new Date(health.checked_at).toLocaleString() : '—'}</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: 'var(--bg-card2)', padding: 4, borderRadius: 10, border: '1px solid var(--border)', width: 'fit-content' }}>
        {['Health', 'Logs', 'Env Vars'].map(t => (
          <button key={t} className={`btn btn-sm ${tab === t ? 'btn-primary' : 'btn-secondary'}`} style={{ border: 'none' }} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      {loading ? <div className="loading"><div className="spinner" /></div> : (
        <>
          {tab === 'Health' && (
            <div className="section-card" style={{ padding: 0, overflow: 'hidden' }}>
              <table>
                <thead><tr><th>Service</th><th>Status</th><th>Latency</th></tr></thead>
                <tbody>
                  {(health?.services || []).map(s => (
                    <tr key={s.service}>
                      <td style={{ fontWeight: 600, fontSize: 13 }}>{s.service}</td>
                      <td>
                        <span className={`badge badge-${s.status === 'up' ? 'success' : s.status === 'degraded' ? 'warning' : 'danger'}`}>
                          {s.status}
                        </span>
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                        {s.latency_ms ? `${s.latency_ms}ms` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'Logs' && (
            <div className="section-card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8 }}>
                {['error', 'warn', 'info'].map(l => (
                  <button key={l} className={`btn btn-sm ${logLevel === l ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setLogLevel(l)}>{l}</button>
                ))}
              </div>
              {logs.length === 0 ? (
                <div className="empty-state"><div className="icon">📋</div><p>No {logLevel} logs</p></div>
              ) : (
                <div style={{ maxHeight: 500, overflowY: 'auto' }}>
                  {logs.map(l => (
                    <div key={l.id} style={{ padding: '12px 20px', borderBottom: '1px solid rgba(30,58,95,0.4)', display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                        {l.created_at ? new Date(l.created_at).toLocaleTimeString() : '—'}
                      </div>
                      <div style={{ fontSize: 12, fontFamily: 'monospace', color: logLevel === 'error' ? '#fca5a5' : logLevel === 'warn' ? '#fcd34d' : 'var(--text-secondary)', wordBreak: 'break-all' }}>
                        {l.message}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'Env Vars' && (
            <div className="section-card" style={{ padding: 0, overflow: 'hidden' }}>
              <table>
                <thead><tr><th>Variable</th><th>Value</th></tr></thead>
                <tbody>
                  {Object.entries(env).map(([k, v]) => (
                    <tr key={k}>
                      <td style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--accent-cyan)', fontWeight: 600 }}>{k}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-secondary)' }}>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
