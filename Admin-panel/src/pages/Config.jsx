import { useState, useEffect } from 'react';
import { api } from '../utils/api.js';
import { t } from '../i18n/i18n.js';

const CONFIG_KEYS = [
  { key: 'system_prompt',         type: 'textarea' },
  { key: 'stop_threshold',        type: 'number' },
  { key: 'iterate_min',           type: 'number' },
  { key: 'iterate_max',           type: 'number' },
  { key: 'go_threshold',          type: 'number' },
  { key: 'finance_cron_schedule', type: 'text' },
  { key: 'daily_pipeline_limit',  type: 'number' },
  { key: 'whitelist_enabled',     type: 'select', options: ['true', 'false'] },
  { key: 'rachel_enabled',        type: 'select', options: ['true', 'false'] },
];

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
      showToast(t('config.toastSaved'));
    } catch (e) { showToast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  const hasChanges = JSON.stringify(edits) !== JSON.stringify(config);

  if (loading) return <div className="loading"><div className="spinner" /></div>;

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div><h1>{t('pages.config')}</h1><p>{t('config.subtitle')}</p></div>
        <button className="btn btn-primary" onClick={save} disabled={!hasChanges || saving}>
          {saving ? <><span className="btn-spinner" /> {t('config.saving')}</> : `💾 ${t('config.save')}`}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 20 }}>
        {CONFIG_KEYS.map(({ key, type, options }) => (
          <div className="section-card" key={key}>
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{t(`configMeta.${key}.label`)}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{t(`configMeta.${key}.description`)}</div>
            </div>
            {type === 'textarea' ? (
              <textarea
                className="input-field"
                rows={4}
                style={{ resize: 'vertical', fontSize: 12, fontFamily: 'monospace' }}
                value={edits[key] ?? ''}
                onChange={e => setEdits(p => ({ ...p, [key]: e.target.value }))}
              />
            ) : type === 'select' ? (
              <select className="input-field" value={edits[key] ?? ''} onChange={e => setEdits(p => ({ ...p, [key]: e.target.value }))}>
                {(options || []).map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input
                type={type}
                className="input-field"
                value={edits[key] ?? ''}
                onChange={e => setEdits(p => ({ ...p, [key]: e.target.value }))}
              />
            )}
            {edits[key] !== config[key] && (
              <div style={{ fontSize: 11, color: 'var(--warning)', marginTop: 6 }}>⚠ {t('config.unsavedChange')}</div>
            )}
          </div>
        ))}
      </div>

      {hasChanges && (
        <div style={{ position: 'fixed', bottom: 24, insetInlineStart: '50%', transform: 'translateX(-50%)', zIndex: 100 }}>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 24px', display: 'flex', gap: 12, alignItems: 'center', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
            <span style={{ fontSize: 13, color: 'var(--warning)' }}>⚠ {t('config.unsaved')}</span>
            <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>
              {saving ? t('config.saving') : `💾 ${t('config.saveSm')}`}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => setEdits({ ...config })}>{t('config.discard')}</button>
          </div>
        </div>
      )}

      {toast && <div className={`toast ${toast.type}`}><span>{toast.type === 'success' ? '✓' : '⚠'}</span>{toast.msg}</div>}
    </div>
  );
}
