import { useCallback, useEffect, useState } from 'react';
import './dashboard.css';

/* ─── helpers ─────────────────────────────────────────────────────────────── */
const baseUrl = () =>
  (import.meta.env.VITE_FINANCE_API_URL || '').trim().replace(/\/$/, '');

async function fetchJson(path) {
  const root = baseUrl();
  if (!root) throw new Error('Set VITE_FINANCE_API_URL to your Railway matriya-finance URL');
  const res = await fetch(`${root}${path}`, { credentials: 'omit' });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json();
}

function decisionBadge(decision) {
  const d = (decision || '').toLowerCase();
  if (d === 'act')     return <span className="fd-badge fd-badge-act">Act</span>;
  if (d === 'hold')    return <span className="fd-badge fd-badge-hold">Hold</span>;
  if (d === 'observe') return <span className="fd-badge fd-badge-observe">Observe</span>;
  return <span className="fd-badge fd-badge-default">{decision || '—'}</span>;
}

function StatusDot({ ok }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: ok ? 'var(--success)' : 'var(--danger)',
        marginRight: 6,
        verticalAlign: 'middle',
      }}
    />
  );
}

/* ─── Main component ──────────────────────────────────────────────────────── */
export default function MatriyaFinanceDashboard() {
  const [status, setStatus]           = useState(null);
  const [signalsPayload, setPayload]  = useState(null);
  const [loading, setLoading]         = useState(true);
  const [err, setErr]                 = useState('');
  const [lastRefresh, setLastRefresh] = useState(null);

  const load = useCallback(async () => {
    setErr('');
    setLoading(true);
    try {
      const [st, sig] = await Promise.all([
        fetchJson('/api/finance/status'),
        fetchJson('/api/finance/signals'),
      ]);
      setStatus(st);
      setPayload(sig);
      setLastRefresh(new Date());
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  const signals = signalsPayload?.signals || [];
  const actCount = signals.filter(s => (s.decision || '').toLowerCase() === 'act').length;
  const holdCount = signals.filter(s => (s.decision || '').toLowerCase() === 'hold').length;
  const latest = signals.length > 0 ? signals[signals.length - 1] : null;

  return (
    <div className="fd-shell">
      {/* ─── Topbar ────────────────────────────────────────────────────────── */}
      <header className="fd-topbar">
        <div className="fd-topbar-brand">
          <div className="fd-logo">MF</div>
          <div className="fd-brand-text">
            <span className="fd-brand-name">Matriya Finance</span>
            <span className="fd-brand-sub">Signal Monitor</span>
          </div>
        </div>

        <div className="fd-topbar-actions">
          {!loading && !err && (
            <div className="fd-live-pill">
              <span className="fd-live-dot" />
              LIVE
            </div>
          )}
          {baseUrl() && (
            <span className="fd-api-url" title={baseUrl()}>{baseUrl()}</span>
          )}
          <button
            className="fd-btn fd-btn-primary"
            type="button"
            onClick={load}
            disabled={loading}
          >
            {loading ? (
              <>
                <span
                  style={{
                    width: 13,
                    height: 13,
                    border: '2px solid rgba(255,255,255,0.4)',
                    borderTopColor: '#fff',
                    borderRadius: '50%',
                    display: 'inline-block',
                    animation: 'fd-spin 0.7s linear infinite',
                  }}
                />
                Loading…
              </>
            ) : (
              'Refresh'
            )}
          </button>
        </div>
      </header>

      {/* ─── Main ──────────────────────────────────────────────────────────── */}
      <main className="fd-main">
        {/* Error */}
        {err && (
          <div className="fd-alert fd-alert-error" role="alert">
            <span style={{ fontSize: 18 }}>⚠️</span>
            <div>
              <strong>Error</strong>
              <div style={{ marginTop: 2, opacity: 0.85 }}>{err}</div>
            </div>
          </div>
        )}

        {/* Stat cards */}
        <div className="fd-stats-grid">
          <div className="fd-stat-card fd-accent-cyan">
            <span className="fd-stat-icon">📊</span>
            <div className="fd-stat-value">{signals.length}</div>
            <div className="fd-stat-label">Total Signals</div>
            <div className="fd-stat-sub">{signalsPayload?.line_count ?? '—'} lines in file</div>
          </div>

          <div className="fd-stat-card fd-accent-danger">
            <span className="fd-stat-icon">🔴</span>
            <div className="fd-stat-value">{actCount}</div>
            <div className="fd-stat-label">Act Signals</div>
            <div className="fd-stat-sub">Requires action</div>
          </div>

          <div className="fd-stat-card fd-accent-success">
            <span className="fd-stat-icon">🟢</span>
            <div className="fd-stat-value">{holdCount}</div>
            <div className="fd-stat-label">Hold / Observe</div>
            <div className="fd-stat-sub">Monitoring</div>
          </div>

          <div className="fd-stat-card fd-accent-purple">
            <span className="fd-stat-icon">⏱️</span>
            <div className="fd-stat-value" style={{ fontSize: '1.1rem' }}>
              {latest
                ? (latest.signal_timestamp || '').slice(0, 10)
                : '—'}
            </div>
            <div className="fd-stat-label">Last Signal</div>
            <div className="fd-stat-sub">
              {lastRefresh ? `Refreshed ${lastRefresh.toLocaleTimeString()}` : '—'}
            </div>
          </div>
        </div>

        {/* Service status card */}
        <div className="fd-card">
          <div className="fd-card-header">
            <span className="fd-card-title">Service Status</span>
            {status && (
              <div style={{ display: 'flex', gap: 8 }}>
                <span className={`fd-badge ${status.twilio_ready ? 'fd-badge-hold' : 'fd-badge-default'}`}>
                  {status.twilio_ready ? '✓ Twilio' : '✗ Twilio'}
                </span>
                <span className={`fd-badge ${status.fred_configured ? 'fd-badge-hold' : 'fd-badge-default'}`}>
                  {status.fred_configured ? '✓ FRED' : '✗ FRED'}
                </span>
                <span className={`fd-badge ${status.ndjson_exists ? 'fd-badge-act' : 'fd-badge-default'}`} style={status.ndjson_exists ? { background: 'rgba(16,185,129,0.15)', color: 'var(--success)', borderColor: 'rgba(16,185,129,0.3)' } : {}}>
                  {status.ndjson_exists ? '✓ NDJSON' : '✗ NDJSON'}
                </span>
              </div>
            )}
          </div>

          {loading && !status ? (
            <div className="fd-loading">
              <div className="fd-spinner" />
              <span className="fd-loading-text">Loading status…</span>
            </div>
          ) : status ? (
            <>
              <div className="fd-card-body">
                <dl className="fd-status-grid">
                  <div className="fd-status-item">
                    <dt>Service</dt>
                    <dd>{status.service}</dd>
                  </div>
                  <div className="fd-status-item">
                    <dt>File Exists</dt>
                    <dd>
                      <StatusDot ok={status.ndjson_exists} />
                      {status.ndjson_exists ? 'Yes' : 'No'}
                    </dd>
                  </div>
                  <div className="fd-status-item">
                    <dt>File Size</dt>
                    <dd>{status.ndjson_bytes != null ? `${(status.ndjson_bytes / 1024).toFixed(1)} KB` : '—'}</dd>
                  </div>
                  <div className="fd-status-item">
                    <dt>Last Modified</dt>
                    <dd>{status.ndjson_mtime_iso ? status.ndjson_mtime_iso.slice(0, 19).replace('T', ' ') : '—'}</dd>
                  </div>
                  <div className="fd-status-item">
                    <dt>Twilio</dt>
                    <dd className={status.twilio_ready ? 'fd-status-ok' : 'fd-status-warn'}>
                      {status.twilio_ready ? 'Ready' : 'Missing SID/Token'}
                    </dd>
                  </div>
                  <div className="fd-status-item">
                    <dt>FRED API</dt>
                    <dd className={status.fred_configured ? 'fd-status-ok' : 'fd-status-warn'}>
                      {status.fred_configured ? 'Configured' : 'Not set'}
                    </dd>
                  </div>
                  <div className="fd-status-item">
                    <dt>SEC User-Agent</dt>
                    <dd className={status.sec_user_agent_set ? 'fd-status-ok' : 'fd-status-warn'}>
                      {status.sec_user_agent_set ? 'Set' : 'Not set'}
                    </dd>
                  </div>
                </dl>
              </div>
              <div className="fd-card-meta">
                Path: {status.ndjson_path}
                {!status.ndjson_exists && (
                  <span className="fd-status-err"> — file missing, run POST /run on Railway</span>
                )}
              </div>
            </>
          ) : null}
        </div>

        {/* Signals table card */}
        <div className="fd-card">
          <div className="fd-card-header">
            <span className="fd-card-title">
              Shadow Signals
              <span style={{ marginLeft: 10, fontSize: 12, color: 'var(--text-muted)', fontWeight: 400 }}>
                {signals.length} loaded
              </span>
            </span>
            {signalsPayload?.mtime_iso && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Updated: {signalsPayload.mtime_iso.slice(0, 19).replace('T', ' ')}
              </span>
            )}
          </div>

          {loading && signals.length === 0 ? (
            <div className="fd-loading">
              <div className="fd-spinner" />
              <span className="fd-loading-text">Loading signals…</span>
            </div>
          ) : signals.length === 0 ? (
            <div className="fd-empty">
              No signals yet. Trigger the monitor on Railway (<code>POST /run</code>) or wait for cron.
            </div>
          ) : (
            <div className="fd-table-wrap">
              <table className="fd-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Instrument</th>
                    <th>A Value</th>
                    <th>Decision</th>
                    <th>Source / Trigger</th>
                  </tr>
                </thead>
                <tbody>
                  {[...signals].reverse().map((row, i) => (
                    <tr key={row.signal_id || i}>
                      <td className="muted" style={{ whiteSpace: 'nowrap' }}>
                        {(row.signal_timestamp || '').slice(0, 19).replace('T', ' ')}
                      </td>
                      <td>
                        <strong className="mono">{row.instrument ?? '—'}</strong>
                      </td>
                      <td className="mono">{row.A != null ? row.A : '—'}</td>
                      <td>{decisionBadge(row.decision)}</td>
                      <td className="muted">
                        {[row.source, row.trigger_type].filter(Boolean).join(' · ') || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
