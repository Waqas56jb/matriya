import React, { useState, useRef, useEffect, useCallback } from 'react';
import { HiPaperAirplane, HiChevronDown, HiChevronUp } from 'react-icons/hi2';
import api from '../utils/api';
import { formatApiErrorForUser } from '../utils/openAiFriendlyError';
import {
    runAskMatriyaDocumentsQuery,
    runResearchDecisionQuery,
    sortFilenamesForAskMatriyaDisplay,
    isLikelyScienceQuery
} from '../utils/askMatriyaDocumentsClient';
import { formatBoldSegments } from '../utils/formatBold';
import AnswerEvidenceSection from './AnswerEvidenceSection';
import GptSyncStatusRow from './GptSyncStatusRow';
import './AskMatriyaTab.css';

const ASK_CHAT_EVIDENCE_TITLE = 'Document Sources (Citations)';
const ASK_CHAT_EVIDENCE_HINT = 'Passages used as the basis for this answer — for transparency and review.';
const ASK_CHAT_LAB_EVIDENCE_TITLE = 'Lab Experiments Used';
const ASK_CHAT_LAB_EVIDENCE_HINT = 'Experiment records from the lab database that the decision engine compared.';
const ASK_ALL_FILES_VALUE = '__ALL_FILES__';

const DECISION_MODE_LABELS = {
    result:      { text: 'Decision Result', cls: 'result' },
    no_match:    { text: 'No Match',        cls: 'no_match' },
    no_entities: { text: 'Specify Experiments', cls: 'no_entities' },
    error:       { text: 'Pipeline Error', cls: 'error' },
};

const DECISION_LABELS = {
    GO:               { text: 'GO',               cls: 'go' },
    ITERATE:          { text: 'ITERATE',           cls: 'iterate' },
    STOP:             { text: 'STOP',              cls: 'stop' },
    INSUFFICIENT_DATA:{ text: 'INSUFFICIENT_DATA', cls: 'stop' },
};

/**
 * Fix 1: derive the displayed chip from reasoning keywords first,
 * then fall back to the decision field value.
 * Rules (David spec):
 *   NEED_SELECTED_PROJECT | NO_PROJECT_DATA_FOUND  → STOP
 *   NEED_MORE_DATA | INSUFFICIENT_DATA             → INSUFFICIENT_DATA
 *   GO in reasoning                                → GO
 *   decision field in DECISION_LABELS              → use as-is
 *   otherwise                                      → ITERATE
 */
function deriveDecisionChip(decision, reasoning) {
    const r = String(reasoning || '').toUpperCase();
    if (r.includes('NEED_SELECTED_PROJECT') || r.includes('NO_PROJECT_DATA_FOUND')) return 'STOP';
    if (r.includes('INSUFFICIENT_DATA') || r.includes('NEED_MORE_DATA'))            return 'INSUFFICIENT_DATA';
    if (/\bGO\b/.test(r))                                                           return 'GO';
    const d = String(decision || '').toUpperCase();
    if (d in DECISION_LABELS) return d;
    return 'ITERATE';
}

/** Safe coercions — never let unexpected types crash the render tree */
function safeString(v) {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    try { return JSON.stringify(v); } catch { return ''; }
}
function safeArray(v) { return Array.isArray(v) ? v : []; }

function DecisionMeta({ decisionData }) {
    if (!decisionData) return null;
    const rawMode      = decisionData.mode;
    const rawDecision  = decisionData.decision;
    const rawReasoning = decisionData.reasoning;
    const rawFieldsUsed = decisionData.fieldsUsed;
    const rawRunId     = decisionData.runId;
    const missingEntities = safeArray(decisionData.missingEntities);
    const foundEntities   = safeArray(decisionData.foundEntities);
    const metaHint        = safeString(decisionData.metaHint);

    const mode      = safeString(rawMode) || 'result';
    const decision  = safeString(rawDecision).toUpperCase();
    const reasoning = safeString(rawReasoning);
    const fieldsUsed = safeArray(rawFieldsUsed);
    const runIdStr  = rawRunId != null ? safeString(rawRunId) : null;

    const label    = DECISION_MODE_LABELS[mode] || { text: mode, cls: 'error' };
    const chipKey  = deriveDecisionChip(decision, reasoning);
    const decLabel = DECISION_LABELS[chipKey] || null;

    return (
        <div className="decision-meta">
            <div className="decision-meta-header">
                <span className={`decision-mode-badge decision-mode-badge--${label.cls}`}>
                    {label.text}
                </span>
                {decLabel && (
                    <span className={`decision-mode-badge decision-mode-badge--${decLabel.cls}`}
                        title="Decision Engine verdict">
                        {decLabel.text}
                    </span>
                )}
                <span className="decision-engine-label">Decision Engine · /api/research/run</span>
                {runIdStr && (
                    <span className="decision-run-id" title={`Run ID: ${runIdStr}`}>
                        #{runIdStr.length > 8 ? runIdStr.slice(0, 8) : runIdStr}
                    </span>
                )}
            </div>
            {fieldsUsed.length > 0 && (
                <div className="decision-fields">
                    <span className="decision-fields-label">fields_used</span>
                    {fieldsUsed.map((f, i) => (
                        <span key={safeString(f) || i} className="decision-field-tag">{safeString(f)}</span>
                    ))}
                </div>
            )}
            {reasoning && (
                <div className="decision-reasoning">
                    <span className="decision-fields-label">reasoning</span>
                    <div className="decision-reasoning-text">{reasoning}</div>
                </div>
            )}
            {missingEntities.length > 0 && (
                <div className="decision-missing">
                    <div className="decision-missing-label">Missing entities (not in lab_experiments)</div>
                    <div className="decision-missing-list">
                        {missingEntities.map((id) => (
                            <span key={safeString(id)} className="decision-missing-tag">{safeString(id)}</span>
                        ))}
                    </div>
                    {foundEntities.length > 0 && (
                        <div style={{ marginTop: 6 }}>
                            <span className="decision-fields-label">Found</span>
                            <span style={{ marginLeft: 6 }}>
                                {foundEntities.map((id) => (
                                    <span key={safeString(id)} className="decision-field-tag" style={{ marginRight: 4 }}>{safeString(id)}</span>
                                ))}
                            </span>
                        </div>
                    )}
                </div>
            )}
            {metaHint && (
                <div className="decision-hint">{metaHint}</div>
            )}
        </div>
    );
}

function AskMatriyaTab({ onGptSyncingChange, gptRagSyncing = false }) {
    const [filesInApiOrder, setFilesInApiOrder] = useState([]);
    const [selectedFilenames, setSelectedFilenames] = useState([ASK_ALL_FILES_VALUE]);
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [sending, setSending] = useState(false);
    const [error, setError] = useState(null);
    const [filesLoading, setFilesLoading] = useState(true);
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const messagesEndRef = useRef(null);
    const dropdownRef = useRef(null);
    const searchInputRef = useRef(null);

    const filteredFiles = sortFilenamesForAskMatriyaDisplay(
        filesInApiOrder.filter((f) => f.toLowerCase().includes((searchQuery || '').trim().toLowerCase()))
    );

    const fileBasename = (f) => f.split('/').filter(Boolean).pop() || f;
    const isSpreadsheetFilename = (f) => /\.xlsx$/i.test(fileBasename(f)) || /\.xls$/i.test(fileBasename(f));

    useEffect(() => {
        if (!dropdownOpen) return;
        searchInputRef.current?.focus();
    }, [dropdownOpen]);

    useEffect(() => {
        const handleClickOutside = (e) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
                setDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => { scrollToBottom(); }, [messages]);

    const loadSystemFiles = useCallback((opts = {}) => {
        const silent = Boolean(opts.silent);
        if (!silent) setFilesLoading(true);
        return api
            .get('/files/detail')
            .then((res) => {
                const list = Array.isArray(res.data?.files) ? res.data.files : [];
                const names = list.map((f) => f.filename).filter((n) => typeof n === 'string' && n.trim());
                setFilesInApiOrder(names);
            })
            .catch(() => {})
            .finally(() => { if (!silent) setFilesLoading(false); });
    }, []);

    useEffect(() => { loadSystemFiles(); }, [loadSystemFiles]);

    useEffect(() => {
        setSelectedFilenames((prev) => {
            if (prev.includes(ASK_ALL_FILES_VALUE)) return [ASK_ALL_FILES_VALUE];
            const kept = prev.filter((f) => filesInApiOrder.includes(f));
            return kept.length ? kept : [ASK_ALL_FILES_VALUE];
        });
    }, [filesInApiOrder]);

    const isAllFilesSelected = selectedFilenames.includes(ASK_ALL_FILES_VALUE);

    const toggleFile = (filename) => {
        if (filename === ASK_ALL_FILES_VALUE) {
            setSelectedFilenames([ASK_ALL_FILES_VALUE]);
            return;
        }
        setSelectedFilenames((prev) => {
            const withoutAll = prev.filter((f) => f !== ASK_ALL_FILES_VALUE);
            if (withoutAll.includes(filename)) {
                const next = withoutAll.filter((f) => f !== filename);
                return next.length ? next : [ASK_ALL_FILES_VALUE];
            }
            return [...withoutAll, filename];
        });
    };

    const handleSend = async () => {
        const text = input.trim();
        if (!text || sending || gptRagSyncing) return;

        setError(null);
        setInput('');
        const userMessage = { role: 'user', content: text };
        setMessages((prev) => [...prev, userMessage]);
        setSending(true);

        try {
            const labOnly = isLikelyScienceQuery(text);
            if (!labOnly && selectedFilenames.length === 0) {
                setError('Select at least one document before sending a question.');
                setMessages((prev) => prev.slice(0, -1));
                return;
            }
            if (!labOnly && filesInApiOrder.length === 0) {
                setError('No documents in the system — upload documents in the Documents tab first.');
                setMessages((prev) => prev.slice(0, -1));
                return;
            }
            const filenames = labOnly
                ? []
                : isAllFilesSelected
                    ? [...filesInApiOrder]
                    : filesInApiOrder.filter((f) => selectedFilenames.includes(f));
            if (!labOnly && filenames.length === 0) {
                setError('No documents available for query. Refresh the list and try again.');
                setMessages((prev) => prev.slice(0, -1));
                return;
            }

            if (labOnly) {
                // ── Validated decision pipeline (/research/session → /api/research/run) ──
                const decisionResult = await runResearchDecisionQuery(text);
                const experimentSources = (decisionResult.experiments || []).map((e) => ({
                    content: Object.entries(e || {})
                        .filter(([k, v]) => v != null && k !== 'project_id')
                        .map(([k, v]) => `${k}: ${v}`)
                        .join(' | '),
                    metadata: { source: 'lab_data', experiment_id: e?.experiment_id ?? null },
                    score: 1,
                }));
                setMessages((prev) => [...prev, {
                    role: 'assistant',
                    content: decisionResult.reply || '',
                    sources: experimentSources,
                    decisionData: {
                        mode: decisionResult.mode,
                        decision: decisionResult.decision,
                        reasoning: decisionResult.reasoning,
                        fieldsUsed: decisionResult.fieldsUsed,
                        runId: decisionResult.runId,
                        missingEntities: decisionResult.missingEntities,
                        foundEntities: decisionResult.foundEntities,
                        metaHint: decisionResult.metaHint,
                    },
                }]);
            } else {
                // ── Document RAG path (/ask-matriya) ────────────────────────────────────
                const { reply: replyText, sources } = await runAskMatriyaDocumentsQuery(text, filenames);
                setMessages((prev) => [...prev, { role: 'assistant', content: replyText, sources }]);
            }
        } catch (err) {
            setError(formatApiErrorForUser(err, 'Error sending message'));
            setMessages((prev) => prev.slice(0, -1));
        } finally {
            setSending(false);
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const dropdownLabel = isAllFilesSelected
        ? 'All documents'
        : selectedFilenames.length === 1
            ? selectedFilenames[0]
            : `${selectedFilenames.length} documents selected`;

    return (
        <div className="ask-matriya-tab">
            <div className="ask-matriya-single card">
                <div className="ask-matriya-header">
                    <h2 className="ask-matriya-title">Ask Matriya</h2>
                    <p className="ask-matriya-hint">
                        Ask questions grounded in your indexed documents. Answers are limited to
                        content found in the selected files — no general knowledge fill-in.
                        If the documents don't have sufficient data, the answer will say so explicitly.
                    </p>
                </div>

                <GptSyncStatusRow
                    filenames={filesInApiOrder}
                    onSyncComplete={loadSystemFiles}
                    onSyncingChange={onGptSyncingChange}
                    className="ask-matriya-gpt-sync"
                />

                {/* Document selector */}
                <div className="ask-matriya-file-section" ref={dropdownRef}>
                    <span className="ask-matriya-file-section-label">
                        Documents in system
                        {!filesLoading && filesInApiOrder.length > 0 && (
                            <span className="ask-matriya-file-count">{filesInApiOrder.length}</span>
                        )}
                    </span>
                    {filesLoading ? (
                        <div className="ask-matriya-loading-files">
                            <span className="ask-matriya-spinner" aria-hidden />
                            Loading documents…
                        </div>
                    ) : filesInApiOrder.length === 0 ? (
                        <div className="ask-matriya-no-files">
                            No documents in the system. Upload documents in the Documents tab first.
                        </div>
                    ) : (
                        <div className="ask-matriya-dropdown">
                            <button
                                type="button"
                                className="ask-matriya-dropdown-trigger"
                                onClick={() =>
                                    setDropdownOpen((o) => {
                                        const next = !o;
                                        if (next) { setSearchQuery(''); void loadSystemFiles({ silent: true }); }
                                        return next;
                                    })
                                }
                                aria-expanded={dropdownOpen}
                                aria-haspopup="listbox"
                            >
                                <span className="ask-matriya-dropdown-trigger-text">{dropdownLabel}</span>
                                <span className="ask-matriya-dropdown-arrow" aria-hidden>
                                    {dropdownOpen ? <HiChevronUp size={16} /> : <HiChevronDown size={16} />}
                                </span>
                            </button>
                            {dropdownOpen && (
                                <div className="ask-matriya-dropdown-panel" role="listbox">
                                    <input
                                        ref={searchInputRef}
                                        type="text"
                                        className="ask-matriya-dropdown-search"
                                        placeholder="Search by filename (PDF, Word, Excel…)"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        onKeyDown={(e) => e.stopPropagation()}
                                    />
                                    <div className="ask-matriya-dropdown-list">
                                        <button
                                            type="button"
                                            role="option"
                                            aria-selected={isAllFilesSelected}
                                            className={`ask-matriya-dropdown-option ${isAllFilesSelected ? 'selected' : ''}`}
                                            onClick={() => toggleFile(ASK_ALL_FILES_VALUE)}
                                        >
                                            <span className="ask-matriya-dropdown-option-check">
                                                {isAllFilesSelected ? '✓' : ''}
                                            </span>
                                            <span className="ask-matriya-dropdown-option-label">All documents</span>
                                        </button>
                                        {filteredFiles.length === 0 ? (
                                            <div className="ask-matriya-dropdown-empty">No matches found</div>
                                        ) : (
                                            filteredFiles.map((filename) => (
                                                <button
                                                    key={filename}
                                                    type="button"
                                                    role="option"
                                                    aria-selected={selectedFilenames.includes(filename)}
                                                    className={`ask-matriya-dropdown-option ${selectedFilenames.includes(filename) ? 'selected' : ''}`}
                                                    onClick={() => toggleFile(filename)}
                                                >
                                                    <span className="ask-matriya-dropdown-option-check">
                                                        {selectedFilenames.includes(filename) ? '✓' : ''}
                                                    </span>
                                                    <span className="ask-matriya-dropdown-option-label" title={filename}>
                                                        {filename}
                                                    </span>
                                                    {isSpreadsheetFilename(filename) && (
                                                        <span className="ask-matriya-file-kind" aria-hidden>XLS</span>
                                                    )}
                                                </button>
                                            ))
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Messages */}
                <div className="ask-matriya-messages">
                    {messages.length === 0 && (
                        <div className="ask-matriya-placeholder">
                            For document questions: select files above and type your query.<br />
                            For lab decisions (e.g. "Compare EXP-006 and EXP-009 across expansion_ratio"):
                            the <strong>validated decision engine</strong> runs automatically — no document selection needed.
                        </div>
                    )}
                    <div className="ask-matriya-messages-list">
                        {messages.map((msg, i) => (
                            <div key={i} className={`ask-matriya-msg ask-matriya-msg-${msg.role}`}>
                                {msg.role === 'assistant' && msg.decisionData && (
                                    <DecisionMeta decisionData={msg.decisionData} />
                                )}
                                {msg.content && (
                                    <div className={`ask-matriya-msg-content${msg.decisionData ? ' decision-synthesis' : ''}`}>
                                        {formatBoldSegments(msg.content || '').map((part, j) => (
                                            part.type === 'bold'
                                                ? <strong key={`p-${i}-${j}`}>{part.value}</strong>
                                                : <span key={`p-${i}-${j}`}>{part.value}</span>
                                        ))}
                                    </div>
                                )}
                                {msg.role === 'assistant' && (
                                    <AnswerEvidenceSection
                                        sources={msg.sources || []}
                                        title={msg.decisionData ? ASK_CHAT_LAB_EVIDENCE_TITLE : ASK_CHAT_EVIDENCE_TITLE}
                                        hint={msg.decisionData ? ASK_CHAT_LAB_EVIDENCE_HINT : ASK_CHAT_EVIDENCE_HINT}
                                    />
                                )}
                            </div>
                        ))}
                    </div>
                    <div className="ask-matriya-typing-container">
                        {sending && (
                            <div className="ask-matriya-msg ask-matriya-msg-assistant">
                                <div className="ask-matriya-msg-content ask-matriya-typing">
                                    <span className="ask-matriya-typing-dot" />
                                    <span className="ask-matriya-typing-dot" />
                                    <span className="ask-matriya-typing-dot" />
                                </div>
                            </div>
                        )}
                    </div>
                    <div ref={messagesEndRef} />
                </div>

                {error && (
                    <div className="ask-matriya-error" role="alert">
                        <span>⚠</span> {error}
                    </div>
                )}

                {/* Input row */}
                <div className="ask-matriya-input-row">
                    <textarea
                        className="ask-matriya-input"
                        placeholder="Type your question… (Enter to send, Shift+Enter for new line)"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        rows={2}
                        disabled={
                            sending || gptRagSyncing ||
                            (!isLikelyScienceQuery(input) &&
                                (filesInApiOrder.length === 0 || selectedFilenames.length === 0))
                        }
                    />
                    <button
                        type="button"
                        className="ask-matriya-send"
                        onClick={handleSend}
                        disabled={
                            sending || gptRagSyncing || !input.trim() ||
                            (!isLikelyScienceQuery(input) &&
                                (selectedFilenames.length === 0 || filesInApiOrder.length === 0))
                        }
                        aria-label="Send message"
                    >
                        {sending || gptRagSyncing
                            ? <span className="ask-matriya-send-spinner" aria-hidden />
                            : <HiPaperAirplane size={20} aria-hidden />
                        }
                    </button>
                </div>
            </div>
        </div>
    );
}

export default AskMatriyaTab;
