/**
 * Decision Engine Contract v1.1 — POST /decision/run
 * Canonical hash §4: sha256(canonical_json + project_id + model_id)
 * Response envelope §2.3 — eleven keys, fixed semantics (GO § May 2026).
 */

import { createHash } from 'crypto';

export const DECISION_RUN_ENGINE_VERSION = '1.1.0';

/** Numeric §2.3 data_grade (not string enums in JSON). */
export const DATA_GRADE = {
  UNKNOWN: -1,
  NO_DATA: 0,
  LOGICAL: 1,
  HISTORICAL_REFERENCE: 2,
  REAL: 3
};

const ALLOWED_TYPES = ['lab', 'question', 'message'];

function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

export function canonicalInputForHash(body) {
  const cleaned = {
    input: {
      type: body.input.type,
      data: body.input.data
    },
    context: {
      project_id: body.context.project_id,
      model_id: body.context.model_id
    }
  };
  return stableStringify(cleaned);
}

export function computeInputHashHex(body) {
  const canonical = canonicalInputForHash(body);
  const pid = body.context.project_id ?? '';
  const mid = body.context.model_id ?? '';
  return createHash('sha256').update(`${canonical}${String(pid)}${String(mid)}`, 'utf8').digest('hex');
}

/** Deterministic UUID-shaped id from hash (determinism over trace_id vs same payload). */
export function traceIdDeterministic(inputHashHex) {
  const h = createHash('sha256').update(`MATRIYA_DECISION_RUN_V11_TRACE\n${inputHashHex}`, 'utf8').digest();
  const a = h.subarray(0, 4).toString('hex');
  const b = h.subarray(4, 6).toString('hex');
  const cPart = h.subarray(6, 8).toString('hex');
  const d = h.subarray(8, 10).toString('hex');
  const e = h.subarray(10, 16).toString('hex');
  return `${a}-${b}-${cPart}-${d}-${e}`;
}

/**
 * Duplicate of server.js deriveSynthesisDecision semantics (frozen for /decision/run mapping).
 */
export function deriveSynthesisDecisionStub(synthesis) {
  if (!synthesis) return 'STOP';
  const s = String(synthesis).toLowerCase();
  if (/\binsufficient[_\s]data\b/.test(s)) return 'INSUFFICIENT_DATA';
  if (/need[_\s]more[_\s]data|need[_\s]selected[_\s]project|no[_\s]project[_\s]data/.test(s)) return 'INSUFFICIENT_DATA';
  if (/\bgo\b/.test(s)) return 'GO';
  if (/\bstop\b/.test(s)) return 'STOP';
  if (/\biterate\b/.test(s)) return 'ITERATE';
  if (/ניסוי.*ממליץ|ממליץ.*ניסוי|מומלץ|עדיף|מנצח|טוב יותר|הטוב ביותר|winner|recommend|preferred|better performing/.test(s)) return 'GO';
  if (/exp-\d/.test(s) && /(recommend|winner|preferred|better|best|ממליץ|מומלץ|עדיף|מנצח)/.test(s)) return 'GO';
  if (/אין מידע|אין נתונים|no data|no supporting|insufficient/.test(s)) return 'INSUFFICIENT_DATA';
  return 'ITERATE';
}

function mapSynthToDecisionPair(synthStatus) {
  if (synthStatus === 'GO') {
    return { decision: 'GO', fsctm_state: 'APPROVED', data_grade: DATA_GRADE.REAL };
  }
  return {
    decision: 'STOP',
    fsctm_state: 'BLOCKED',
    data_grade: synthStatus === 'INSUFFICIENT_DATA' ? DATA_GRADE.NO_DATA : DATA_GRADE.LOGICAL
  };
}

/** §2.3 envelope — preserve key order per GO PASS checklist. */
export function buildV23Envelope(parts) {
  return {
    decision: parts.decision,
    fsctm_state: parts.fsctm_state,
    confidence: parts.confidence,
    data_grade: parts.data_grade,
    data_source: parts.data_source,
    reason: parts.reason,
    evidence: parts.evidence,
    input_hash: parts.input_hash,
    trace_id: parts.trace_id,
    engine_version: parts.engine_version,
    error: parts.error
  };
}

function envelopeSystemError(reasonText, invalidField, inputHashHex, traceId) {
  return buildV23Envelope({
    decision: 'SYSTEM_ERROR',
    fsctm_state: 'NOT_APPLICABLE',
    confidence: 0,
    data_grade: DATA_GRADE.NO_DATA,
    data_source: 'VALIDATION_GATE',
    reason: reasonText,
    evidence: [],
    input_hash: inputHashHex,
    trace_id: traceId,
    engine_version: DECISION_RUN_ENGINE_VERSION,
    error: { code: 'INTERNAL', message: `INVALID_INPUT — ${invalidField}` }
  });
}

function truncateReason(s, max = 480) {
  const t = String(s || '');
  return t.length <= max ? t : `${t.slice(0, max - 3)}...`;
}

function evidenceFromRunLoop(result) {
  const src = result?.sources || [];
  if (!Array.isArray(src) || src.length === 0) return [];
  return src.slice(0, 40).map((s, i) => {
    if (s && typeof s === 'object') {
      return { index: i, channel: s.channel ?? s.evidence_channel ?? null, snippet: JSON.stringify(s).slice(0, 400) };
    }
    return { index: i, snippet: String(s).slice(0, 400) };
  });
}

/** Parse §2.2 body; returns { ok, bodyNormalized } or { ok:false, ... } before hash. */
export function validateContract22Shape(raw) {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, field: 'body', reason: 'Request JSON must be an object.' };
  }
  if (!('input' in raw) || raw.input == null || typeof raw.input !== 'object') {
    return { ok: false, field: 'input', reason: 'Missing or invalid `input` object.' };
  }
  const { type, data } = raw.input;
  if (typeof type !== 'string' || !ALLOWED_TYPES.includes(type.trim())) {
    return { ok: false, field: 'input.type', reason: '`input.type` must be one of lab | question | message.' };
  }
  if (!('data' in raw.input) || raw.input.data == null || typeof raw.input.data !== 'object') {
    return { ok: false, field: 'input.data', reason: '`input.data` must be an object.' };
  }
  if (!('context' in raw) || raw.context == null || typeof raw.context !== 'object') {
    return { ok: false, field: 'context', reason: 'Missing or invalid `context` object.' };
  }
  const projectId = raw.context.project_id;
  const modelId = raw.context.model_id;
  if (typeof projectId !== 'string' || projectId.trim() === '') {
    return { ok: false, field: 'context.project_id', reason: '`context.project_id` must be a non-empty string.' };
  }
  if (typeof modelId !== 'string' || modelId.trim() === '') {
    return { ok: false, field: 'context.model_id', reason: '`context.model_id` must be a non-empty string.' };
  }
  const trimmedType = type.trim();
  const bodyNorm = {
    input: {
      type: trimmedType,
      data: raw.input.data
    },
    context: {
      project_id: projectId.trim(),
      model_id: modelId.trim()
    }
  };
  return { ok: true, bodyNormalized: bodyNorm };
}

function fireAudit(fn, row) {
  if (typeof fn !== 'function' || row == null) return;
  Promise.resolve(fn(row)).catch(() => {});
}

function auditRowFromEnvelope(envelope, bodyNormalized, extras) {
  const tsIso = new Date().toISOString();
  return {
    session_id: extras.session_id,
    request_query: extras.request_query || null,
    inputs_snapshot: Object.keys(bodyNormalized || {}).length ? { contract_v11: bodyNormalized } : {},
    envelope_snapshot: envelope,
    audit_bundle: {
      trace_id: envelope.trace_id,
      input_hash: envelope.input_hash,
      engine_version: envelope.engine_version,
      decision: envelope.decision,
      fsctm_state: envelope.fsctm_state,
      confidence: envelope.confidence,
      data_grade: envelope.data_grade,
      data_source: envelope.data_source,
      timestamp: tsIso,
      cache_hit: Boolean(extras.cache_hit)
    },
    decision: envelope.decision,
    confidence_score: envelope.confidence
  };
}

/**
 * Execute decision/run (pure async; no Express).
 * deps: { runLoop, getRagService, ResearchSession?, getActiveViolation?, researchRunLocks (Map)?, persistAudit? }
 */
export async function processDecisionRun(rawBody, deps = {}) {
  const shape = validateContract22Shape(rawBody || {});
  if (!shape.ok) {
    /* §4 hash still requires project_id/model_id — use stable placeholders before validation failure would block */
    let inputHashFallback = '';
    let traceFb = '';
    try {
      if (rawBody && rawBody.context && typeof rawBody.context === 'object') {
        const partial = {
          input: rawBody.input &&
            typeof rawBody.input === 'object' &&
            typeof rawBody.input.type === 'string' &&
            rawBody.input.data != null &&
            typeof rawBody.input.data === 'object'
            ? rawBody.input
            : { type: 'question', data: {} },
          context: {
            project_id: rawBody.context.project_id != null ? String(rawBody.context.project_id) : '',
            model_id: rawBody.context.model_id != null ? String(rawBody.context.model_id) : ''
          }
        };
        inputHashFallback = computeInputHashHex(partial);
        traceFb = traceIdDeterministic(inputHashFallback);
      } else if (stableStringify(rawBody || {})) {
        inputHashFallback = createHash('sha256')
          .update(`INVALID_SHAPE\n${stableStringify(rawBody || {})}`)
          .digest('hex');
        traceFb = traceIdDeterministic(inputHashFallback);
      }
    } catch (_) {
      inputHashFallback = createHash('sha256').update('INVALID_FALLBACK').digest('hex');
      traceFb = traceIdDeterministic(inputHashFallback);
    }

    const ev = envelopeSystemError(shape.reason, shape.field, inputHashFallback, traceFb);
    fireAudit(deps.persistAudit, auditRowFromEnvelope(ev, {}, { session_id: null, cache_hit: false }));
    return ev;
  }

  const body = shape.bodyNormalized;
  const inputHash = computeInputHashHex(body);
  const traceId = traceIdDeterministic(inputHash);

  const { persistAudit } = deps;

  if (body.input.type === 'lab') {
    const ev = buildV23Envelope({
      decision: 'STOP',
      fsctm_state: 'BLOCKED',
      confidence: 0,
      data_grade: DATA_GRADE.NO_DATA,
      data_source: 'SCOPE_BOUNDARY',
      reason: truncateReason(
        'BOUNDED_SCOPE: lab path is staged for Decision Engine WRAP GO; invocation recorded without downstream lab bridge.'
      ),
      evidence: [],
      input_hash: inputHash,
      trace_id: traceId,
      engine_version: DECISION_RUN_ENGINE_VERSION,
      error: { code: 'OK', message: '' }
    });
    fireAudit(persistAudit, auditRowFromEnvelope(ev, body, { session_id: null, cache_hit: false }));
    return ev;
  }

  if (body.input.type === 'message') {
    const ev = buildV23Envelope({
      decision: 'STOP',
      fsctm_state: 'BLOCKED',
      confidence: 0,
      data_grade: DATA_GRADE.NO_DATA,
      data_source: 'SCOPE_BOUNDARY',
      reason: truncateReason(
        'BOUNDED_SCOPE: message path is gated for Decision Engine WRAP GO; invocation recorded.'
      ),
      evidence: [],
      input_hash: inputHash,
      trace_id: traceId,
      engine_version: DECISION_RUN_ENGINE_VERSION,
      error: { code: 'OK', message: '' }
    });
    fireAudit(persistAudit, auditRowFromEnvelope(ev, body, { session_id: null, cache_hit: false }));
    return ev;
  }

  /* --- question --- */
  const sessionIdRaw = body.input.data.session_id;
  const queryRaw = body.input.data.query;
  if (typeof sessionIdRaw !== 'string' || sessionIdRaw.trim() === '') {
    const ev = envelopeSystemError('`input.data.session_id` must be a non-empty string.', 'input.data.session_id', inputHash, traceId);
    fireAudit(persistAudit, auditRowFromEnvelope(ev, body, { session_id: null, cache_hit: false }));
    return ev;
  }
  if (typeof queryRaw !== 'string' || queryRaw.trim() === '') {
    const ev = envelopeSystemError('`input.data.query` must be a non-empty string.', 'input.data.query', inputHash, traceId);
    fireAudit(persistAudit, auditRowFromEnvelope(ev, body, { session_id: null, cache_hit: false }));
    return ev;
  }

  const sessionId = sessionIdRaw.trim();
  const query = queryRaw.trim();

  const ResearchSession = deps.ResearchSession;
  const getActiveViolation = deps.getActiveViolation;
  let session = null;
  if (ResearchSession) {
    session = await ResearchSession.findByPk(sessionId).catch(() => null);
  }

  if (!session) {
    const ev = buildV23Envelope({
      decision: 'STOP',
      fsctm_state: 'BLOCKED',
      confidence: 0,
      data_grade: DATA_GRADE.NO_DATA,
      data_source: 'SESSION_GATE',
      reason: truncateReason(`Research session ${sessionId} was not found.`),
      evidence: [],
      input_hash: inputHash,
      trace_id: traceId,
      engine_version: DECISION_RUN_ENGINE_VERSION,
      error: { code: 'OK', message: '' }
    });
    fireAudit(persistAudit, auditRowFromEnvelope(ev, body, { session_id: null, cache_hit: false }));
    return ev;
  }

  if (getActiveViolation) {
    try {
      const violation = await getActiveViolation(sessionId);
      if (violation) {
        const ev = buildV23Envelope({
          decision: 'STOP',
          fsctm_state: 'BLOCKED',
          confidence: 0,
          data_grade: DATA_GRADE.NO_DATA,
          data_source: 'B_INTEGRITY_GATE',
          reason: truncateReason(
            `Gate locked due to unresolved B-Integrity violation (${violation.reason || violation.type || 'unknown'}).`
          ),
          evidence: [],
          input_hash: inputHash,
          trace_id: traceId,
          engine_version: DECISION_RUN_ENGINE_VERSION,
          error: { code: 'OK', message: '' }
        });
        fireAudit(persistAudit, auditRowFromEnvelope(ev, body, { session_id: sessionId, cache_hit: false }));
        return ev;
      }
    } catch (_) {
      /* continue */
    }
  }

  const kcShutdown = session.kernel_context && session.kernel_context.possibility_shutdown;
  if (kcShutdown) {
    const ev = buildV23Envelope({
      decision: 'STOP',
      fsctm_state: 'BLOCKED',
      confidence: 0,
      data_grade: DATA_GRADE.NO_DATA,
      data_source: 'KERNEL_V16_SHUTDOWN',
      reason: truncateReason(
        'Possibility space shutdown recorded on session — bounded agent loop not admitted for /decision/run question path.'
      ),
      evidence: [],
      input_hash: inputHash,
      trace_id: traceId,
      engine_version: DECISION_RUN_ENGINE_VERSION,
      error: { code: 'OK', message: '' }
    });
    fireAudit(persistAudit, auditRowFromEnvelope(ev, body, { session_id: sessionId, cache_hit: false }));
    return ev;
  }

  const runLoopFn = deps.runLoop;
  const getRagService = deps.getRagService;
  if (!runLoopFn || !getRagService) {
    const ev = envelopeSystemError(
      'SERVER_MISCONFIGURED — run primitive not injected',
      'server.decision_deps',
      inputHash,
      traceId
    );
    fireAudit(persistAudit, auditRowFromEnvelope(ev, body, { session_id: sessionId, cache_hit: false }));
    return ev;
  }

  let filenamesBody = Array.isArray(body.input.data.filenames)
    ? body.input.data.filenames.filter((f) => typeof f === 'string' && f.trim())
    : null;
  const fname = typeof body.input.data.filename === 'string' ? body.input.data.filename.trim() : '';
  if (!filenamesBody?.length && fname) {
    const baseOnly = fname.includes('/') ? fname.replace(/^.*\//, '') : fname.replace(/^.*[/\\]/, '');
    filenamesBody = baseOnly !== fname ? [fname, baseOnly] : [fname];
  }
  const filterMetadata = filenamesBody?.length ? { filenames: filenamesBody } : null;

  const runOptions = {};
  if (typeof body.input.data.pre_justification === 'string' && body.input.data.pre_justification.trim()) {
    runOptions.pre_justification_text = body.input.data.pre_justification.trim();
  }
  const doeDesignId = body.input.data.doe_design_id;
  if (doeDesignId != null) runOptions.doe_design_id = parseInt(String(doeDesignId), 10) || null;

  const rag = getRagService();
  const locks = deps.researchRunLocks;
  let result;

  const runOnce = async () =>
    runLoopFn(sessionId, query, rag, filterMetadata || null, Object.keys(runOptions).length ? runOptions : null);

  if (locks && typeof locks.get === 'function') {
    const prev = locks.get(sessionId) || Promise.resolve();
    const runPromise = prev
      .then(() => runOnce())
      .finally(() => {
        if (locks.get(sessionId) === runPromise) locks.delete(sessionId);
      });
    locks.set(sessionId, runPromise);
    result = await runPromise;
  } else {
    result = await runOnce();
  }

  if (!result || result.error) {
    const ev = buildV23Envelope({
      decision: 'STOP',
      fsctm_state: 'BLOCKED',
      confidence: 0,
      data_grade: DATA_GRADE.NO_DATA,
      data_source: 'RESEARCH_LOOP',
      reason: truncateReason(result?.error || 'Research loop returned an error.'),
      evidence: evidenceFromRunLoop(result || {}),
      input_hash: inputHash,
      trace_id: traceId,
      engine_version: DECISION_RUN_ENGINE_VERSION,
      error: { code: 'OK', message: '' }
    });
    fireAudit(persistAudit, auditRowFromEnvelope(ev, body, {
      session_id: sessionId,
      cache_hit: false,
      request_query: query
    }));
    return ev;
  }

  const synth = result.outputs?.synthesis || '';
  const synthDecision = deriveSynthesisDecisionStub(synth);
  const pair = mapSynthToDecisionPair(synthDecision);
  const confInner =
    synth.length === 0 ? 0.1 : Math.min(0.95, 0.55 + synth.length / 8000);
  const confidence = Math.min(0.99, Math.max(0, confInner));

  const ev = buildV23Envelope({
    decision: pair.decision,
    fsctm_state: pair.fsctm_state,
    confidence,
    data_grade: pair.data_grade,
    data_source: 'RESEARCH_LOOP',
    reason: truncateReason(
      synthDecision === 'GO'
        ? 'Synthesis-derived GO mapped to FSCTM APPROVED.'
        : `Synthesis-derived status ${synthDecision} mapped to guarded outcome.`
    ),
    evidence: evidenceFromRunLoop(result),
    input_hash: inputHash,
    trace_id: traceId,
    engine_version: DECISION_RUN_ENGINE_VERSION,
    error: { code: 'OK', message: '' }
  });
  fireAudit(persistAudit, auditRowFromEnvelope(ev, body, {
    session_id: sessionId,
    cache_hit: false,
    request_query: query
  }));
  return ev;
}
