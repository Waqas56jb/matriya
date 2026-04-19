import { useState, useEffect } from 'react';
import { api } from '../utils/api.js';

const CONFIG_META = {
  system_prompt:         { label: 'System Prompt',           type: 'textarea', description: 'MATRIYA LLM system instructions' },
  stop_threshold:        { label: 'STOP Max Confidence',     type: 'number',   description: 'Max confidence % for STOP decision (default 0)' },
  iterate_min:           { label: 'ITERATE Min Confidence',  type: 'number',   description: 'Min confidence % for ITERATE decision (default 1)' },
  iterate_max:           { label: 'ITERATE Max Confidence',  type: 'number',   description: 'Max confidence % for ITERATE decision (default 69)' },
  go_threshold:          { label: 'GO Min Confidence',       type: 'number',   description: 'Min confidence % for GO decision (default 70)' },
  finance_cron_schedule: { label: 'Finance Cron Schedule',   type: 'text',     description: 'Cron expression for matriya-finance (default: 0 7 * * *)' },
  daily_pipeline_limit:  { label: 'Daily Pipeline Limit',    type: 'number',   description: 'Max pipeline calls per user per day' },
  whitelist_enabled:     { label: 'Whitelist Enabled',       type: 'select',   options: ['true','false'], description: 'Enable phone number whitelist enforcement' },
  rachel_enabled:        { label: 'Rachel Notifications',    type: 'select',   options: ['true','false'], description: 'Send outbound WhatsApp alerts to Rachel on ITERATE' },
};

export default function Config() {
  const [config,  setConfig]  = useState({});
  const [edits,   setEdits]   = useState({});
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [toast,   setToast]   = useState(null);

  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };

  useEffect(() => {
    api.get('/api/admin/config')
      .then(d => { setConfig(d.config || {}); setEdits(d.config || {}); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await api.put('/api/admin/config', edits);
      setConfig({ ...edits });
      showToast('Configuration saved');
    } catch (e) { showToast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  const hasChanges = JSON.stringify(edits) !== JSON.stringify(config);

  if (loading) return <div className="loading"><div className="spinner" /></div>;

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div><h1>Configuration</h1><p>Live system settings — changes apply instantly</p></div>
        <button className="btn btn-primary" onClick={save} disabled={!hasChanges || saving}>
          {saving ? <><span className="btn-spinner" /> Saving…</> : '💾 Save Changes'}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 20 }}>
        {Object.entries(CONFIG_META).map(([key, meta]) => (
          <div className="section-card" key={key}>
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{meta.label}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{meta.description}</div>
            </div>
            {meta.type === 'textarea' ? (
              <textarea
                className="input-field"
                rows={4}
                style={{ resize: 'vertical', fontSize: 12, fontFamily: 'monospace' }}
                value={edits[key] ?? ''}
                onChange={e => setEdits(p => ({ ...p, [key]: e.target.value }))}
              />
            ) : meta.type === 'select' ? (
              <select className="input-field" value={edits[key] ?? ''} onChange={e => setEdits(p => ({ ...p, [key]: e.target.value }))}>
                {(meta.options || []).map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input
                type={meta.type}
                className="input-field"
                value={edits[key] ?? ''}
                onChange={e => setEdits(p => ({ ...p, [key]: e.target.value }))}
              />
            )}
            {edits[key] !== config[key] && (
              <div style={{ fontSize: 11, color: 'var(--warning)', marginTop: 6 }}>⚠ Unsaved change</div>
            )}
          </div>
        ))}
      </div>

      {hasChanges && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 100 }}>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 24px', display: 'flex', gap: 12, alignItems: 'center', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
            <span style={{ fontSize: 13, color: 'var(--warning)' }}>⚠ Unsaved changes</span>
            <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : '💾 Save'}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => setEdits({ ...config })}>Discard</button>
          </div>
        </div>
      )}

      {toast && <div className={`toast ${toast.type}`}><span>{toast.type === 'success' ? '✓' : '⚠'}</span>{toast.msg}</div>}
    </div>
  );
}
