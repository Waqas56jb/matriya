import { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { api } from '../utils/api.js';
import { t } from '../i18n/i18n.js';

const TT_STYLE = { background: '#0b1630', border: '1px solid #1e3a5f', borderRadius: 8, fontSize: 12 };

export default function Analytics() {
  const [days,      setDays]      = useState(14);
  const [overview,  setOverview]  = useState(null);
  const [decisions, setDecisions] = useState(null);
  const [volume,    setVolume]    = useState([]);
  const [topUsers,  setTopUsers]  = useState([]);
  const [times,     setTimes]     = useState(null);
  const [loading,   setLoading]   = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.allSettled([
      api.get('/api/admin/analytics/overview'),
      api.get(`/api/admin/analytics/decisions?days=${days}`),
      api.get(`/api/admin/analytics/whatsapp?days=${days}`),
      api.get('/api/admin/analytics/top-users?limit=8'),
      api.get(`/api/admin/analytics/response-times?days=${days}`),
    ]).then(([ov, dec, vol, top, rt]) => {
      if (ov.status  === 'fulfilled') setOverview(ov.value);
      if (dec.status === 'fulfilled') setDecisions(dec.value);
      if (vol.status === 'fulfilled') setVolume(vol.value.daily || []);
      if (top.status === 'fulfilled') setTopUsers(top.value.top_users || []);
      if (rt.status  === 'fulfilled') setTimes(rt.value);
    }).finally(() => setLoading(false));
  }, [days]);

  const decCounts = decisions?.counts || {};

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div><h1>{t('pages.analytics')}</h1><p>{t('analytics.subtitle')}</p></div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {loading && <div className="spinner" style={{ width: 16, height: 16, marginInlineEnd: 4 }} />}
          {[7, 14, 30].map(d => (
            <button key={d} className={`btn btn-sm ${days === d ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setDays(d)} disabled={loading}>
              {d}d
            </button>
          ))}
        </div>
      </div>

      <div className="stats-grid">
        {[
          { icon: '👥', color: 'cyan',   label: t('analytics.totalUsers'),     value: overview?.total_users ?? '—'      },
          { icon: '💬', color: 'purple', label: t('analytics.totalMessages'),   value: overview?.total_messages ?? '—'  },
          { icon: '✅', color: 'green',  label: t('analytics.goDecisions'),     value: decCounts.GO ?? 0                 },
          { icon: '⚠',  color: 'orange', label: t('analytics.iterateDecisions'),value: decCounts.ITERATE ?? 0           },
          { icon: '🛑', color: 'red',    label: t('analytics.stopDecisions'),   value: decCounts.STOP ?? 0              },
          { icon: '⏱',  color: 'cyan',  label: t('analytics.avgResponse'),     value: times ? `${(times.avg_ms / 1000).toFixed(1)}s` : '—' },
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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 24, marginBottom: 24 }}>
        <div className="section-card">
          <div className="section-title">📈 {t('analytics.msgVolume')}</div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={volume} margin={{ left: -10 }}>
              <XAxis dataKey="date" tick={{ fill: '#8baac8', fontSize: 10 }} />
              <YAxis tick={{ fill: '#8baac8', fontSize: 10 }} />
              <Tooltip contentStyle={TT_STYLE} labelStyle={{ color: '#f0f6ff' }} />
              <defs><linearGradient id="vg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#00d4ff" /><stop offset="100%" stopColor="#7c3aed" /></linearGradient></defs>
              <Bar dataKey="count" fill="url(#vg)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="section-card">
          <div className="section-title">🎯 {t('analytics.decisionDist')}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginTop: 8 }}>
            {[
              { label: 'GO',      color: '#10b981', count: decCounts.GO      || 0 },
              { label: 'ITERATE', color: '#f59e0b', count: decCounts.ITERATE || 0 },
              { label: 'STOP',    color: '#ef4444', count: decCounts.STOP    || 0 },
            ].map(d => {
              const total = (decCounts.GO || 0) + (decCounts.ITERATE || 0) + (decCounts.STOP || 0);
              const pct   = total ? Math.round((d.count / total) * 100) : 0;
              return (
                <div key={d.label} style={{ background: 'var(--bg-card2)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 14px', textAlign: 'center' }}>
                  <div style={{ fontSize: 28, fontWeight: 800, color: d.color }}>{d.count}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '4px 0' }}>{d.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{pct}%</div>
                  <div style={{ marginTop: 8, height: 4, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: d.color, borderRadius: 4 }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="section-card">
        <div className="section-title">🏆 {t('analytics.topUsers')}</div>
        {topUsers.length === 0 ? (
          <div className="empty-state"><div className="icon">📊</div><p>{t('analytics.noData')}</p></div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {topUsers.map((u, i) => {
              const max = topUsers[0]?.count || 1;
              const pct = Math.round((u.count / max) * 100);
              return (
                <div key={u.phone} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{ width: 24, fontSize: 12, color: 'var(--text-muted)', textAlign: 'end', flexShrink: 0 }}>#{i + 1}</div>
                  <div style={{ flex: 1, fontSize: 13, fontFamily: 'monospace', color: 'var(--text-primary)' }}>{u.phone}</div>
                  <div style={{ flex: 2, background: 'var(--border)', borderRadius: 4, height: 8, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: 'var(--accent-grad)', borderRadius: 4 }} />
                  </div>
                  <div style={{ width: 40, textAlign: 'end', fontSize: 13, fontWeight: 700, color: 'var(--accent-cyan)' }}>{u.count}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
