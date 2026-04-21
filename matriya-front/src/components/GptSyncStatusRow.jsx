import React, { useState, useEffect, useCallback, useRef, useImperativeHandle, forwardRef } from 'react';
import api from '../utils/api';
import './GptSyncStatusRow.css';

/** Extensions eligible for cloud document sync (logical basename). */
const GPT_ELIGIBLE_RE = /\.(pdf|docx|doc|txt|xlsx|xls|pptx|csv|json|md|html|htm)$/i;

function hasEligibleFilenames(filenames) {
    if (!Array.isArray(filenames) || filenames.length === 0) return false;
    return filenames.some((n) => {
        const base = String(n || '').split('/').filter(Boolean).pop() || '';
        return base && GPT_ELIGIBLE_RE.test(base);
    });
}

function filterEligibleLogicalNames(names) {
    if (!Array.isArray(names) || names.length === 0) return [];
    return names.filter((n) => {
        const base = String(n || '').split('/').filter(Boolean).pop() || '';
        return base && GPT_ELIGIBLE_RE.test(base);
    });
}

const STATUS_REQUEST_MS = 120000;

function vectorStoreIndexingLooksActive(st) {
    if (!st?.vector_store_id || st.vector_store_status !== 'in_progress') return false;
    const ip = st.file_counts?.in_progress;
    if (typeof ip === 'number' && ip === 0) return false;
    return true;
}

function statusFetchErrorMessage(err) {
    if (err?.code === 'ECONNABORTED' || String(err?.message || '').toLowerCase().includes('timeout')) {
        return 'Connection to the document service timed out. Verify Matriya Back is running, wait a moment, then click Refresh Status.';
    }
    if (!err?.response) {
        return 'Cannot connect to Matriya Back. Check the API URL (REACT_APP_API_BASE_URL) and confirm the server is running.';
    }
    const server = err.response?.data?.error || err.response?.data?.detail;
    if (server) return `Server error: ${server}`;
    return 'Could not load document status. Try Refresh Status.';
}

const GptSyncStatusRow = forwardRef(function GptSyncStatusRow(
    {
        filenames = [],
        onSyncComplete,
        onSyncingChange,
        onStatusChange,
        fileUploadInProgress = false,
        backgroundGptSyncBusy = false,
        className = ''
    },
    ref
) {
    const [st, setSt] = useState(null);
    const [statusLoading, setStatusLoading] = useState(true);
    const [statusError, setStatusError] = useState(null);
    const [syncing, setSyncing] = useState(false);
    const [syncResponseIndexingPending, setSyncResponseIndexingPending] = useState(false);
    const [syncHadError, setSyncHadError] = useState(false);
    const stRef = useRef(null);
    const onStatusChangeRef = useRef(onStatusChange);
    const onSyncingChangeRef = useRef(onSyncingChange);
    const onSyncCompleteRef = useRef(onSyncComplete);
    onStatusChangeRef.current = onStatusChange;
    onSyncingChangeRef.current = onSyncingChange;
    onSyncCompleteRef.current = onSyncComplete;

    useEffect(() => { stRef.current = st; }, [st]);
    useEffect(() => { onStatusChangeRef.current?.(st); }, [st]);

    const refresh = useCallback(async (opts = {}) => {
        const silent = Boolean(opts.silent);
        if (!silent) { setStatusError(null); setStatusLoading(true); }
        const fetchOnce = () => api.get('/gpt-rag/status', { timeout: STATUS_REQUEST_MS });
        try {
            let res;
            try { res = await fetchOnce(); } catch (e1) {
                const isTimeout = e1?.code === 'ECONNABORTED' || String(e1?.message || '').toLowerCase().includes('timeout');
                if (isTimeout) { await new Promise((r) => setTimeout(r, 2000)); res = await fetchOnce(); }
                else throw e1;
            }
            const data = res.data ?? null;
            setSt(data); stRef.current = data;
            return data;
        } catch (e) {
            if (!silent) { setSt(null); stRef.current = null; setStatusError(statusFetchErrorMessage(e)); }
            return null;
        } finally {
            if (!silent) setStatusLoading(false);
        }
    }, []);

    useImperativeHandle(ref, () => ({
        refresh: () => refresh({ silent: false }),
        refreshSilent: () => refresh({ silent: true })
    }), [refresh]);

    useEffect(() => { refresh({ silent: false }); }, [refresh]);
    useEffect(() => { refresh({ silent: true }); }, [filenames.length, refresh]);

    useEffect(() => {
        const onVis = () => { if (document.visibilityState === 'visible') refresh({ silent: false }); };
        document.addEventListener('visibilitychange', onVis);
        return () => document.removeEventListener('visibilitychange', onVis);
    }, [refresh]);

    const runSync = useCallback(async (opts) => {
        const only = opts && Array.isArray(opts.only_logical_names) ? opts.only_logical_names : null;
        const body = only && only.length > 0
            ? { only_logical_names: only.map((x) => String(x || '').trim()).filter(Boolean) }
            : {};
        setSyncing(true); setSyncHadError(false); setSyncResponseIndexingPending(false);
        try {
            const res = await api.post('/gpt-rag/sync', body, { timeout: 300000 });
            await refresh({ silent: true });
            onSyncComplete?.();
            setSyncResponseIndexingPending(Boolean(res.data?.indexing_pending));
            if (res.data?.indexing_pending) await refresh({ silent: true });
        } catch (e) {
            setSyncHadError(true); setSyncResponseIndexingPending(false);
        } finally {
            setSyncing(false);
        }
    }, [refresh, onSyncComplete]);

    const hasAnyFile = filenames.length > 0;
    const hasEligible = hasEligibleFilenames(filenames);
    const openAiIndexing = Boolean(st && vectorStoreIndexingLooksActive(st));
    const gptGateBusy = syncing || backgroundGptSyncBusy || fileUploadInProgress || openAiIndexing || syncResponseIndexingPending;

    useEffect(() => { onSyncingChangeRef.current?.(gptGateBusy); }, [gptGateBusy]);

    useEffect(() => {
        if (!syncResponseIndexingPending || !st?.vector_store_id) return;
        const vs = st.vector_store_status;
        const ip = st.file_counts?.in_progress;
        if (vs !== 'in_progress' || (typeof ip === 'number' && ip === 0)) setSyncResponseIndexingPending(false);
    }, [st, syncResponseIndexingPending]);

    useEffect(() => {
        if (!openAiIndexing) return;
        const id = window.setInterval(() => refresh({ silent: true }), 3500);
        return () => clearInterval(id);
    }, [openAiIndexing, refresh]);

    let dotColor = 'var(--matriya-border, #1e3a5f)';
    let label = 'Checking document service connection…';
    let extraWarn = null;

    if (statusError) {
        dotColor = 'var(--matriya-danger, #ef4444)';
        label = statusError;
    } else if (fileUploadInProgress) {
        dotColor = 'var(--matriya-accent, #00d4ff)';
        label = 'Uploading or adding files… (wait before querying)';
    } else if (syncing || backgroundGptSyncBusy) {
        dotColor = 'var(--matriya-accent, #00d4ff)';
        label = 'Syncing…';
    } else if (statusLoading) {
        dotColor = 'var(--matriya-muted, #8baac8)';
        label = 'Checking document service connection…';
    } else if (!st) {
        dotColor = 'var(--matriya-danger, #ef4444)';
        label = 'No status received from server. Try Refresh Status.';
    } else if (st) {
        if (!st.openai) {
            dotColor = 'var(--matriya-danger, #ef4444)';
            label = 'Cloud document search not configured. Contact the system administrator.';
        } else if (openAiIndexing || syncResponseIndexingPending) {
            dotColor = 'var(--matriya-accent, #00d4ff)';
            label = 'Indexing documents in the cloud… (wait before querying)';
        } else if (st.vector_store_id) {
            dotColor = 'var(--matriya-success, #10b981)';
            label = 'Synced';
            if (st.warning) {
                extraWarn = 'Could not verify document store. Try Refresh Status or Re-sync.';
            }
        } else if (!hasEligible) {
            dotColor = 'var(--matriya-muted, #8baac8)';
            label = !hasAnyFile
                ? 'No documents to index — upload files then sync.'
                : 'No supported file types for cloud sync (PDF, Word, Excel, text, etc.).';
        } else if (syncHadError) {
            dotColor = 'var(--matriya-danger, #ef4444)';
            label = 'Sync failed. Check the server or try again.';
        } else if (!st.use_openai_file_search) {
            dotColor = 'var(--matriya-muted, #8baac8)';
            label = 'Cloud document search is disabled in server settings. Contact the administrator.';
        } else {
            dotColor = 'var(--matriya-accent, #00d4ff)';
            label = 'Awaiting sync…';
        }
    }

    const uiBusy = syncing || backgroundGptSyncBusy || fileUploadInProgress || statusLoading || openAiIndexing || syncResponseIndexingPending;
    const showResync = st?.openai && st?.use_openai_file_search && Boolean(st?.vector_store_id) && !uiBusy;
    const showRetry = st?.openai && st?.use_openai_file_search && !st?.vector_store_id && !uiBusy && hasEligible && syncHadError;
    const showInitialSync = st?.openai && st?.use_openai_file_search && !st?.vector_store_id && !uiBusy && hasEligible && !syncHadError;

    return (
        <div className={`gpt-sync-status-row ${className}`.trim()} role="region" aria-label="Document sync status">
            <div className="gpt-sync-status-row__inner">
                <span className="gpt-sync-status-row__dot" style={{ background: dotColor }} aria-hidden />
                <span className="gpt-sync-status-row__label">
                    {label}
                    {extraWarn && (
                        <span className="gpt-sync-status-row__warn">{extraWarn}</span>
                    )}
                </span>
                {showResync && (
                    <button type="button" className="gpt-sync-status-row__btn" disabled={!hasEligible} onClick={() => runSync()}>
                        Re-sync
                    </button>
                )}
                {showRetry && (
                    <button type="button" className="gpt-sync-status-row__btn" onClick={() => { setSyncHadError(false); runSync(); }}>
                        Try Again
                    </button>
                )}
                {showInitialSync && (
                    <button type="button" className="gpt-sync-status-row__btn gpt-sync-status-row__btn--primary" disabled={!hasEligible} onClick={() => runSync()}>
                        Sync
                    </button>
                )}
                <button type="button" className="gpt-sync-status-row__btn" disabled={syncing || backgroundGptSyncBusy} onClick={() => refresh({ silent: false })}>
                    Refresh Status
                </button>
            </div>
        </div>
    );
});

GptSyncStatusRow.displayName = 'GptSyncStatusRow';

export default GptSyncStatusRow;
export { hasEligibleFilenames, GPT_ELIGIBLE_RE, filterEligibleLogicalNames };
