import React, { useState, useEffect } from 'react';
import {
  MANAGEMENT_API_URL,
  MANAGEMENT_FRONT_URL,
  isManagementLabConfigured
} from '../utils/managementConfig';
import managementApi from '../utils/managementApi';
import './ManagementLabTab.css';

function ManagementLabTab() {
  const [status, setStatus] = useState('idle');
  const [detail, setDetail] = useState(null);
  const [projectTotal, setProjectTotal] = useState(null);

  useEffect(() => {
    if (!isManagementLabConfigured()) {
      setStatus('unconfigured');
      return;
    }

    let cancelled = false;
    setStatus('checking');

    (async () => {
      try {
        const me = await managementApi.get('/api/auth/me');
        if (cancelled) return;
        setDetail({ user: me.data });
        setStatus('ok');

        try {
          const pr = await managementApi.get('/api/projects', { params: { limit: 1, offset: 0 } });
          if (!cancelled && pr.data && typeof pr.data.total === 'number') {
            setProjectTotal(pr.data.total);
          }
        } catch (_) {
          if (!cancelled) setProjectTotal(null);
        }
      } catch (err) {
        if (cancelled) return;
        const msg =
          err.response?.data?.error ||
          err.response?.data?.detail ||
          err.message ||
          'Connection error';
        setDetail({ error: msg, status: err.response?.status });
        setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const openManagementUi = () => {
    if (!MANAGEMENT_FRONT_URL) return;
    window.open(MANAGEMENT_FRONT_URL, '_blank', 'noopener,noreferrer');
  };

  if (!isManagementLabConfigured()) {
    return (
      <div className="management-lab-tab">
        <div className="management-lab-card">
          <h2>Lab (Management)</h2>
          <p className="management-lab-lead">
            To integrate the lab, set these environment variables at build time (local: <code>.env</code> file, Vercel: Environment Variables):
          </p>
          <ul className="management-lab-env-list">
            <li>
              <code>REACT_APP_MANAGEMENT_API_URL</code> — Management server URL (e.g.{' '}
              <code>https://matriya-mangment-back.vercel.app</code>)
            </li>
            <li>
              <code>REACT_APP_MANAGEMENT_FRONT_URL</code> — Management UI URL (e.g.{' '}
              <code>https://management-front.vercel.app</code>)
            </li>
          </ul>
          <p className="management-lab-note">
            <strong>Login:</strong> Use the same username and password as Matriya — the management server authenticates against Matriya using the same JWT.
            In the management interface (separate tab), sign in with the same credentials.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="management-lab-tab">
      <div className="management-lab-card">
        <h2>Lab (Management)</h2>
        <p className="management-lab-lead">
          Connected to the projects and lab system. <strong>Same username and password as Matriya</strong> — authentication passes through the management server to Matriya.
        </p>

        <div className="management-lab-urls">
          <div>
            <span className="management-lab-label">API</span>
            <code className="management-lab-code">{MANAGEMENT_API_URL}</code>
          </div>
          <div>
            <span className="management-lab-label">Interface</span>
            <code className="management-lab-code">{MANAGEMENT_FRONT_URL}</code>
          </div>
        </div>

        {status === 'checking' && <p className="management-lab-status checking">Checking connection to management server…</p>}

        {status === 'ok' && detail?.user && (
          <p className="management-lab-status ok">
            <span key="status-ok">
              Connected to management server as <strong>{detail.user.username || detail.user.full_name || 'user'}</strong>
              {projectTotal != null ? ` · ${projectTotal} projects in system` : ''}.
            </span>
          </p>
        )}

        {status === 'error' && (
          <p className="management-lab-status error">
            <span key="status-error">
              Cannot authenticate with management server: {detail?.error}
              {detail?.status === 503
                ? ' — ensure MATRIYA_BACK_URL is set on the management server and Matriya is available.'
                : ''}
            </span>
          </p>
        )}

        <div className="management-lab-actions">
          <button type="button" className="management-lab-primary" onClick={openManagementUi}>
            Open Management Interface in New Tab
          </button>
        </div>

        <p className="management-lab-hint">
          In the project lab (management interface): Excel files are displayed as tables and AI text is stored in table structure (Markdown) — to update a sheet: re-upload the file.
        </p>
        <p className="management-lab-hint">
          If a login screen appears in the management interface, sign in with the same Matriya credentials. The token here is only used for API checks from within Matriya; the browser in the management interface maintains a separate session.
        </p>
      </div>
    </div>
  );
}

export default ManagementLabTab;
