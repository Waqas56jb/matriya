import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { api } from '../utils/api.js';
import './Dashboard.css';

const DECISION_COLORS = { GO: '#10b981', ITERATE: '#f59e0b', STOP: '#ef4444', OTHER: '#4d6a88' };

export default function Dashboard() {
  const [overview,   setOverview]   = useState(null);
  const [decisions,  setDecisions]  = useState(null);
  const [msgVolume,  setMsgVolume]  = useState([]);
  const [health,     setHealth]     = useState(null);
  const [loading,    setLoading]    = useState(true);

  useEffect(() => {
    Promise.allSettled([
      api.get('/api/admin/analytics/overview'),
      api.get('/api/admin/analytics/decisions?days=7'),
      api.get('/api/admin/analytics/whatsapp?days=7'),
      api.get('/api/admin/system/health'),
    ]).then(([ov, dec, vol, h]) => {
      if (ov.status  === 'fulfilled') setOverview(ov.value);
      if (dec.status === 'fulfilled') setDecisions(dec.value);
      if (vol.status === 'fulfilled') setMsgVolume(vol.value.daily || []);
      if (h.status   === 'fulfilled') setHealth(h.value);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading"><div className="spinner" /></div>;

  const decisionPie = decisions?.counts
    ? Object.entries(decisions.counts).filter(([,v]) => v > 0).map(([name, value]) => ({ name, value }))
    : [];

  const STATS = [
    { icon: '👥', color: 'cyan',   label: 'Total Users',       value: overview?.total_users ?? '—'       },
    { icon: '💬', color: 'purple', label: 'Total Messages',     value: overview?.total_messages ?? '—'    },
    { icon: '🧪', color: 'green',  label: 'Experiments',        value: overview?.total_experiments ?? '—' },
    { icon: '⏳', color: 'orange', label: 'Pending Approvals',  value: overview?.pending_approvals ?? '—' },
  ];

  return (
    <div>
      <div className="page-header">
        <h1>Dashboard</h1>
        <p>MATRIYA system overview — live data</p>
      </div>

      {/* Stats */}
      <div className="stats-grid">
        {STATS.map(s => (
          <div className="stat-card" key={s.label}>
            <div className={`stat-icon ${s.color}`}>{s.icon}</div>
            <div className="stat-info">
              <div className="stat-value">{s.value}</div>
              <div className="stat-label">{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="dashboard-charts">
        {/* Message volume chart */}
        <div className="section-card">
          <div className="section-title">📈 WhatsApp Messages (Last 7 days)</div>
          {msgVolume.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={msgVolume} margin={{ left: -10 }}>
                <XAxis dataKey="date" tick={{ fill: '#8baac8', fontSize: 11 }} />
                <YAxis tick={{ fill: '#8baac8', fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ background: '#0b1630', border: '1px solid #1e3a5f', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: '#f0f6ff' }}
                />
                <Bar dataKey="count" fill="url(#barGrad)" radius={[4,4,0,0]} />
                <defs>
                  <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#00d4ff" />
                    <stop offset="100%" stopColor="#7c3aed" />
                  </linearGradient>
                </defs>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="empty-state"><div className="icon">📊</div><p>No message data yet</p></div>
          )}
        </div>

        {/* Decision breakdown */}
        <div className="section-card">
          <div className="section-title">🎯 Decision Breakdown (7 days)</div>
          {decisionPie.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={decisionPie} cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={3} dataKey="value">
                  {decisionPie.map(entry => (
                    <Cell key={entry.name} fill={DECISION_COLORS[entry.name] || '#4d6a88'} />
                  ))}
                </Pie>
                <Legend iconType="circle" iconSize={10} formatter={v => <span style={{ color: '#8baac8', fontSize: 12 }}>{v}</span>} />
                <Tooltip
                  contentStyle={{ background: '#0b1630', border: '1px solid #1e3a5f', borderRadius: 8, fontSize: 12 }}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="empty-state"><div className="icon">🎯</div><p>No decisions recorded yet</p></div>
          )}
        </div>
      </div>

      {/* Service Health */}
      <div className="section-card">
        <div className="section-title">🖥 Service Health</div>
        <div className="health-grid">
          {(health?.services || []).map(s => (
            <div className="health-item" key={s.service}>
              <div className={`health-dot ${s.status}`} />
              <div className="health-name">{s.service}</div>
              <div className={`health-status ${s.status}`}>{s.status}</div>
              {s.latency_ms && <div className="health-latency">{s.latency_ms}ms</div>}
            </div>
          ))}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="section-card">
        <div className="section-title">⚡ Quick Actions</div>
        <div className="quick-actions">
          {[
            { to: '/users?status=pending', icon: '✅', label: 'Approve Users',    color: 'success' },
            { to: '/whatsapp',             icon: '💬', label: 'View Queue',       color: 'info'    },
            { to: '/sessions',             icon: '👁', label: 'Live Sessions',    color: 'cyan'    },
            { to: '/experiments',          icon: '🧪', label: 'Experiments',      color: 'purple'  },
            { to: '/audit',                icon: '🔍', label: 'Audit Log',        color: 'warning' },
            { to: '/system',               icon: '🖥', label: 'System Health',   color: 'green'   },
          ].map(a => (
            <Link key={a.to} to={a.to} className={`quick-action quick-action-${a.color}`}>
              <span className="quick-action-icon">{a.icon}</span>
              <span>{a.label}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
