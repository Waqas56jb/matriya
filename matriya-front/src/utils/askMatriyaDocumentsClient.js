/**
 * Shared client for POST /ask-matriya (document text path).
 * Used by Upload and Ask Matriya so identical question + scope hits the same behavior.
 * Cross-tab cache: repeat submit skips the network, waits 3s, returns the previous reply.
 */

import api from './api';

function normalizeAskQuestion(text) {
    return String(text || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function makeAskScopeKey(filenames) {
    return [...new Set((Array.isArray(filenames) ? filenames : []).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'he', { sensitivity: 'base' }))
        .join('\n');
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Heuristic: lab table / EXP-* / filter-style questions (aligned with matriya-back lab routing).
 * Used to allow Ask without uploaded documents when the question is clearly lab-scoped.
 */
export function isLikelyScienceQuery(text) {
    const q = normalizeAskQuestion(text);
    if (!q) return false;
    const expTokens = q.match(/\bexp-\d{2,}\b/g) || [];
    const twoOrMoreExp = expTokens.length >= 2;
    return (
        twoOrMoreExp ||
        q.includes('expansion_ratio') ||
        q.includes('expansion ratio') ||
        q.includes('adhesion') ||
        q.includes('viscosity') ||
        q.includes('app:per') ||
        q.includes('ifr') ||
        q.includes('experiment') ||
        q.includes('formulation') ||
        q.includes('experiment_id') ||
        q.includes('char_quality') ||
        q.includes('expansion') ||
        /[><]=?/.test(q) ||
        /\b(top|bottom|highest|lowest|minimum|maximum|among)\b/.test(q) ||
        /\bexp-\d{2,}\b/.test(q) ||
        /\b(compare|comparison|versus|vs\.?|between)\b.*\bexp-/.test(q) ||
        /\bexp-.*\b(compare|comparison|versus|vs\.?|between)\b/.test(q) ||
        (/\b(differ|compare|versus|structural|structurally)\b/.test(q) && /\bexp-\d/.test(q))
    );
}

/** @type {{ key: string, reply: string, sources: unknown[] } | null} */
let askMatriyaDocumentsCache = null;

/**
 * Same request body as Upload runAsk: { message, filenames } only.
 * @param {string} message
 * @param {string[]} filenames — order must match Upload (API list order for “all files”)
 * @returns {Promise<{ reply: string, sources: unknown[] }>}
 */
export async function runAskMatriyaDocumentsQuery(message, filenames) {
    const repeatKey = `${normalizeAskQuestion(message)}\n---\n${makeAskScopeKey(filenames)}`;
    const cacheEligible = !isLikelyScienceQuery(message);
    if (cacheEligible && askMatriyaDocumentsCache && askMatriyaDocumentsCache.key === repeatKey) {
        await sleep(3000);
        return {
            reply: askMatriyaDocumentsCache.reply,
            sources: askMatriyaDocumentsCache.sources
        };
    }
    const res = await api.post('/ask-matriya', { message, filenames }, { timeout: 90000 });
    const body = res.data || {};
    const mode = body.mode;
    const dataRows = body.data?.rows;
    const rowCount = typeof body.meta?.row_count === 'number' ? body.meta.row_count : (Array.isArray(dataRows) ? dataRows.length : 0);
    const filtersApplied = Boolean(body.meta?.filters_applied);
    const triggerId = typeof body.trigger_id === 'string' ? body.trigger_id : '';
    // Clean contract: prefer meta.message; then mandatory empty-filter line for filter+0+filters.
    let reply = '';
    if (typeof body.meta?.message === 'string' && body.meta.message.trim()) {
        reply = body.meta.message.trim();
    } else if (mode === 'filter' && rowCount === 0 && filtersApplied) {
        reply = 'No matching results found for the given criteria.';
    } else if (typeof body.meta?.presentation?.text === 'string' && body.meta.presentation.text) {
        reply = body.meta.presentation.text;
    } else if (typeof body.data?.answer === 'string' && body.data.answer) {
        reply = body.data.answer;
    } else if (typeof body.reply === 'string') {
        reply = body.reply;
    }
    const labModes = new Set(['comparison', 'partial', 'filter', 'ranking', 'aggregation', 'no_match', 'error']);
    if (!reply && labModes.has(mode)) {
        if (rowCount > 0) {
            reply = `Lab response (${rowCount} row(s), mode: ${mode}).${triggerId ? ` Reference: ${triggerId}` : ''}`;
        } else if (mode === 'no_match') {
            reply = typeof body.meta?.message === 'string' && body.meta.message.trim()
                ? body.meta.message.trim()
                : 'No matching lab rows for this query.';
        } else if (mode === 'error') {
            const w = Array.isArray(body.meta?.warnings) && body.meta.warnings.length
                ? body.meta.warnings.join(' ')
                : '';
            reply = w || `Lab query error.${triggerId ? ` Reference: ${triggerId}` : ''}`;
        }
    }
    let sources = Array.isArray(body.meta?.sources)
        ? body.meta.sources
        : (Array.isArray(body.data?.sources)
            ? body.data.sources
            : (Array.isArray(body.sources) ? body.sources : []));
    if (
        (!sources || sources.length === 0) &&
        Array.isArray(dataRows) &&
        dataRows.length > 0 &&
        (mode === 'filter' || mode === 'ranking' || mode === 'aggregation' || mode === 'comparison' || mode === 'partial' || mode === 'no_match')
    ) {
        sources = dataRows.map((r) => ({
            content: Object.entries(r || {})
                .filter(([k, v]) => v != null && k !== 'project_id')
                .map(([k, v]) => `${k}: ${v}`)
                .join(' | '),
            metadata: { source: 'lab_data', experiment_id: r?.experiment_id ?? null },
            score: 1
        }));
    }
    console.log('[ask-matriya] response', {
        mode,
        rowCount,
        replyLength: reply.length,
        trigger_id: triggerId || undefined,
        hasMetaMessage: Boolean(body.meta?.message)
    });
    if (process.env.NODE_ENV === 'development') {
        console.log('[ask-matriya] full response JSON', body);
    }
    if (cacheEligible) {
        askMatriyaDocumentsCache = { key: repeatKey, reply, sources };
    } else {
        askMatriyaDocumentsCache = null; // avoid stale science results for repeated validation queries
    }
    return { reply, sources };
}

/**
 * Call the validated decision pipeline for lab / science queries.
 *
 * Two-step flow:
 *   1. POST /research/session  → session_id
 *   2. POST /api/research/run  → decision result (4-agent loop)
 *
 * Handles all three outcome modes:
 *   • result      — synthesis + fields_used + selected experiments
 *   • no_match    — one or more requested IDs are not in lab_experiments
 *   • no_entities — query is open-ended; no specific experiment IDs named
 *
 * @param {string} message
 * @returns {Promise<{
 *   mode: string,
 *   reply: string,
 *   fieldsUsed: string[],
 *   runId: string|null,
 *   experiments: object[],
 *   missingEntities: string[],
 *   foundEntities: string[],
 *   metaHint: string|null
 * }>}
 */
export async function runResearchDecisionQuery(message) {
    // Step 1 – create a fresh research session (Bearer token forwarded via api interceptor)
    const sessRes = await api.post('/research/session', {}, { timeout: 15000 });
    const sessionId = sessRes.data?.session_id;
    if (!sessionId) {
        throw new Error('Failed to create research session — session_id missing in response');
    }

    // Step 2 – run the 4-agent decision loop
    let runRes;
    try {
        runRes = await api.post(
            '/api/research/run',
            { session_id: sessionId, query: message },
            { timeout: 120000 }
        );
    } catch (err) {
        // Boundary modes (no_match / no_entities) arrive as HTTP 400/404 — treat as structured result, not UI error
        const data = err.response?.data || {};
        const mode = typeof data.mode === 'string' ? data.mode : 'error';
        // David requirement: log error response before rendering
        console.log('[decision-pipeline] /api/research/run error response', { status: err.response?.status, data });
        return {
            mode,
            reply: typeof data.meta?.message === 'string' ? data.meta.message
                 : typeof data.error === 'string'         ? data.error
                 : 'The decision pipeline could not process this query.',
            decision:  null,
            reasoning: null,
            fieldsUsed: Array.isArray(data.fields_used) ? data.fields_used : [],
            runId: null,
            experiments: Array.isArray(data.selected_experiments) ? data.selected_experiments : [],
            missingEntities: Array.isArray(data.missing_entities) ? data.missing_entities : [],
            foundEntities:   Array.isArray(data.found_entities)   ? data.found_entities   : [],
            metaHint: typeof data.meta?.user_action_hint === 'string' ? data.meta.user_action_hint : null,
        };
    }

    const body = runRes.data || {};

    // David requirement: log response before rendering
    console.log('[decision-pipeline] /api/research/run response', body);

    const synthesis  = typeof body.outputs?.synthesis  === 'string' ? body.outputs.synthesis
                     : typeof body.outputs?.analysis   === 'string' ? body.outputs.analysis
                     : '';
    const fieldsUsed = Array.isArray(body.fields_used)        ? body.fields_used
                     : Array.isArray(body.outputs?.fields_used) ? body.outputs.fields_used
                     : [];
    const experiments = Array.isArray(body.selected_experiments)         ? body.selected_experiments
                      : Array.isArray(body.outputs?.selected_experiments) ? body.outputs.selected_experiments
                      : [];
    const runId     = body.run_id != null ? body.run_id : null;
    const decision  = typeof body.decision === 'string' ? body.decision : null;
    const reasoning = typeof body.reasoning === 'string' ? body.reasoning
                    : synthesis;
    const mode      = typeof body.mode === 'string' ? body.mode : 'result';

    return {
        mode,
        reply: synthesis,
        decision,
        reasoning,
        fieldsUsed,
        runId,
        experiments,
        missingEntities: [],
        foundEntities: [],
        metaHint: null,
    };
}

/** For dropdown UI only — same helper as Ask tab; does not affect /ask-matriya payload order. */
export function sortFilenamesForAskMatriyaDisplay(filenames) {
    const list = (Array.isArray(filenames) ? filenames : []).filter((f) => typeof f === 'string' && f.trim());
    const base = (f) => f.split('/').filter(Boolean).pop() || f;
    const isSheet = (f) => /\.xlsx$/i.test(base(f)) || /\.xls$/i.test(base(f));
    return [...new Set(list)].sort((a, b) => {
        const sa = isSheet(a);
        const sb = isSheet(b);
        if (sa !== sb) return sa ? -1 : 1;
        return a.localeCompare(b, 'he', { sensitivity: 'base' });
    });
}
