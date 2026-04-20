import { useState, useEffect } from 'react';
import { api, apiFetch } from '../utils/api.js';
import { t } from '../i18n/i18n.js';

const FILTER_DEFS = [
  { key: 'status',         opts: ['all', 'PASS', 'FAIL', 'PARTIAL', 'PENDING'], allKey: 'experiments.allStatus' },
  { key: 'validated',      opts: ['all', 'true', 'false'],                   allKey: 'experiments.allValidated' },
  { key: 'breakdown_flag', opts: ['all', 'true', 'false'],                   allKey: 'experiments.allBreakdown' },
];

export default function Experiments() {
  const [data,    setData]    = useState([]);
  const [total,   setTotal]   = useState(0);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState('');
  const [filters, setFilters] = useState({ validated: 'all', breakdown_flag: 'all', status: 'all' });
  const [page,    setPage]    = useState(1);
  const [editing, setEditing] = useState(null);
  const [toast,   setToast]   = useState(null);

  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams({ page, limit: 20 });
    if (search) params.set('search', search);
    Object.entries(filters).forEach(([k, v]) => { if (v !== 'all') params.set(k, v); });
    api.get(`/api/admin/experiments?${params}`)
      .then(d => { setData(d.experiments || []); setTotal(d.total || 0); })
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [page, filters]);
  useEffect(() => { const tm = setTimeout(load, 400); return () => clearTimeout(tm); }, [search]);

  const saveEdit = async () => {
    try {
      await api.patch(`/api/admin/experiments/${editing.id}`, {
        decision_shift:  editing.decision_shift,
        breakdown_flag:  editing.breakdown_flag,
        validated:       editing.validated,
        status:          editing.status,
        notes:           editing.notes,
      });
      showToast(t('experiments.toastUpdated'));
      setEditing(null);
      load();
    } catch (e) { showToast(e.message, 'error'); }
  };

  const exportCSV = async () => {
    try {
      const res = await apiFetch('/api/admin/experiments/export');
      if (!res.ok) throw new Error(t('experiments.toastExportFailed'));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'experiments.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      showToast(e.message || t('experiments.toastExportFailed'), 'error');
    }
  };

  const totalPages = Math.ceil(total / 20);

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div><h1>{t('pages.experiments')}</h1><p>{t('experiments.subtitleCount', { count: total })}</p></div>
        <button className="btn btn-secondary" onClick={exportCSV}>⬇ {t('experiments.exportCsv')}</button>
      </div>

      <div className="toolbar">
        <div className="search-bar" style={{ flex: 1, minWidth: 200 }}>
          <span className="search-icon">🔍</span>
          <input className="input-field" placeholder={t('experiments.searchPh')} value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </div>
        {FILTER_DEFS.map(f => (
          <select key={f.key} className="input-field" style={{ width: 'auto' }}
            value={filters[f.key]} onChange={e => { setFilters(p => ({ ...p, [f.key]: e.target.value })); setPage(1); }}>
            {f.opts.map(o => (
              <option key={o} value={o}>{o === 'all' ? t(f.allKey) : o}</option>
            ))}
          </select>
        ))}
      </div>

      <div className="section-card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div className="loading"><div className="spinner" /></div>
        ) : data.length === 0 ? (
          <div className="empty-state"><div className="icon">🧪</div><p>{t('experiments.noRows')}</p></div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>{t('experiments.thExpId')}</th>
                  <th>{t('experiments.thDate')}</th>
                  <th>{t('experiments.thOperator')}</th>
                  <th>{t('experiments.thStatus')}</th>
                  <th>{t('experiments.thDecisionShift')}</th>
                  <th>{t('experiments.thBreakdown')}</th>
                  <th>{t('experiments.thValidated')}</th>
                  <th>{t('users.thActions')}</th>
                </tr>
              </thead>
              <tbody>
                {data.map(exp => (
                  <tr key={exp.id}>
                    <td style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 600 }}>{exp.experiment_id}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{exp.date || '—'}</td>
                    <td style={{ fontSize: 13 }}>{exp.operator || '—'}</td>
                    <td>
                      <span className={`badge badge-${exp.status === 'PASS' ? 'success' : exp.status === 'FAIL' ? 'danger' : exp.status === 'PARTIAL' ? 'warning' : 'muted'}`}>
                        {exp.status || 'PENDING'}
                      </span>
                    </td>
                    <td><span className={`badge badge-${exp.decision_shift ? 'warning' : 'muted'}`}>{exp.decision_shift ? t('experiments.yes') : t('experiments.no')}</span></td>
                    <td><span className={`badge badge-${exp.breakdown_flag ? 'danger' : 'muted'}`}>{exp.breakdown_flag ? t('experiments.yes') : t('experiments.no')}</span></td>
                    <td><span className={`badge badge-${exp.validated ? 'success' : 'muted'}`}>{exp.validated ? t('experiments.yes') : t('experiments.no')}</span></td>
                    <td>
                      <button className="btn btn-secondary btn-sm" onClick={() => setEditing({ ...exp })}>✏ {t('experiments.edit')}</button>
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

      {editing && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 500, padding: 20 }}>
          <div className="section-card" style={{ width: '100%', maxWidth: 480 }}>
            <div className="section-title">✏ {t('experiments.modalTitle')} — {editing.experiment_id}</div>
            {[
              { key: 'decision_shift', labelKey: 'experiments.fieldDecisionShift', type: 'bool' },
              { key: 'breakdown_flag', labelKey: 'experiments.fieldBreakdownFlag', type: 'bool' },
              { key: 'validated',      labelKey: 'experiments.fieldValidated',      type: 'bool' },
            ].map(f => (
              <div className="input-group" key={f.key} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <label className="input-label" style={{ marginBottom: 0 }}>{t(f.labelKey)}</label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!editing[f.key]} onChange={e => setEditing(p => ({ ...p, [f.key]: e.target.checked }))} style={{ width: 16, height: 16, accentColor: 'var(--accent-cyan)' }} />
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{editing[f.key] ? t('experiments.yes') : t('experiments.no')}</span>
                </label>
              </div>
            ))}
            <div className="input-group">
              <label className="input-label">{t('experiments.fieldStatus')}</label>
              <select className="input-field" value={editing.status || ''} onChange={e => setEditing(p => ({ ...p, status: e.target.value }))}>
                {['PASS', 'FAIL', 'PARTIAL', 'PENDING'].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="input-group">
              <label className="input-label">{t('experiments.notes')}</label>
              <textarea className="input-field" rows={3} value={editing.notes || ''} onChange={e => setEditing(p => ({ ...p, notes: e.target.value }))} style={{ resize: 'vertical' }} />
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={saveEdit}>{t('experiments.save')}</button>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setEditing(null)}>{t('experiments.cancel')}</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className={`toast ${toast.type}`}><span>{toast.type === 'success' ? '✓' : '⚠'}</span>{toast.msg}</div>}
    </div>
  );
}
