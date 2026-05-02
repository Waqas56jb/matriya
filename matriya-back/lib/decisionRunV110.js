/**
 * Decision Engine Contract v1.1.0 — POST /decision/run
 * Canonical hash §4: sha256(canonical_json + project_id + model_id)
 * Response §2.3: evidence object, error null unless SYSTEM_ERROR,
 * data_source ∈ { NONE, DB_COMPUTED, DOCUMENT_RAG }, data_grade ∈ [0.0, 1.0] per contract
 */

import { createHash } from 'crypto';

export const DECISION_RUN_ENGINE_VERSION = '1.1.0';

/** §2.3 data_grade: scalar in closed interval [0.0, 1.0] (Decision Engine v1.1.0). */
export const CONTRACT_DATA_GRADE = Object.freeze({
  NONE: 0,
  LOW: 1 / 3,
  MID: 2 / 3,
  HIGH: 1
});

/** Normalise floating output for stable JSON ([0.0, 1.0]). */
export function normaliseGrade(g) {
  const n = Number(g);
  if (Number.isNaN(n)) return 0;
  return Math.round(Math.min(1, Math.max(0, n)) * 1e6) / 1e6;
}

export const DATA_SOURCE = Object.freeze({
  NONE: 'NONE',
  DB_COMPUTED: 'DB_COMPUTED',
  DOCUMENT_RAG: 'DOCUMENT_RAG'
});

/** @deprecated prefer CONTRACT_DATA_GRADE (float grades in [0.0, 1.0]) */
export const DATA_GRADE = {
  UNKNOWN: CONTRACT_DATA_GRADE.NONE,
  NO_DATA: CONTRACT_DATA_GRADE.NONE,
  LOGICAL: CONTRACT_DATA_GRADE.LOW,
  HISTORICAL_REFERENCE: CONTRACT_DATA_GRADE.MID,
  REAL: CONTRACT_DATA_GRADE.HIGH
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

/** §2.3 evidence — object shape required on every path */
export function emptyEvidence() {
  return { experiment_ids: [], rule_ids: [] };
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

export function traceIdDeterministic(inputHashHex) {
  const h = createHash('sha256').update(`MATRIYA_DECISION_RUN_V11_TRACE\n${inputHashHex}`, 'utf8').digest();
  const a = h.subarray(0, 4).toString('hex');
  const b = h.subarray(4, 6).toString('hex');
  const cPart = h.subarray(6, 8).toString('hex');
  const d = h.subarray(8, 10).toString('hex');
  const e = h.subarray(10, 16).toString('hex');
  return `${a}-${b}-${cPart}-${d}-${e}`;
}

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

function mapSynthToDecisionTriple(synthStatus) {
  if (synthStatus === 'GO') {
    return {
      decision: 'GO',
      fsctm_state: 'APPROVED',
      data_grade: normaliseGrade(CONTRACT_DATA_GRADE.HIGH)
    };
  }
  if (synthStatus === 'INSUFFICIENT_DATA') {
    return {
      decision: 'INSUFFICIENT_DATA',
      fsctm_state: 'BLOCKED',
      data_grade: normaliseGrade(CONTRACT_DATA_GRADE.NONE)
    };
  }
  if (synthStatus === 'ITERATE') {
    return {
      decision: 'ITERATE',
      fsctm_state: 'BLOCKED',
      data_grade: normaliseGrade(CONTRACT_DATA_GRADE.MID)
    };
  }
  return {
    decision: 'STOP',
    fsctm_state: 'BLOCKED',
    data_grade: normaliseGrade(CONTRACT_DATA_GRADE.LOW)
  };
}

/**
 * §2.3 envelope — core keys stable order; `_routing` optional diagnostic (not hashed).
 */
export function buildV23Envelope(parts) {
  const envelope = {
    decision: parts.decision,
    fsctm_state: parts.fsctm_state,
    confidence: parts.confidence,
    data_grade: normaliseGrade(parts.data_grade),
    data_source: parts.data_source,
    reason: parts.reason,
    evidence: parts.evidence && typeof parts.evidence === 'object' && !Array.isArray(parts.evidence)
      ? {
          experiment_ids: Array.isArray(parts.evidence.experiment_ids)
            ? parts.evidence.experiment_ids.map((x) => String(x))
            : [],
          rule_ids: Array.isArray(parts.evidence.rule_ids)
            ? parts.evidence.rule_ids.map((x) => String(x))
            : []
        }
      : emptyEvidence(),
    input_hash: parts.input_hash,
    trace_id: parts.trace_id,
    engine_version: parts.engine_version,
    error:
      parts.error === undefined ? null : parts.error === null ? null : parts.error,
  };
  if (parts._routing != null && typeof parts._routing === 'object' && Object.keys(parts._routing).length > 0) {
    envelope._routing = parts._routing;
  }
  return envelope;
}

function envelopeSystemError(reasonText, invalidField, inputHashHex, traceId, routingHints = {}) {
  return buildV23Envelope({
    decision: 'SYSTEM_ERROR',
    fsctm_state: 'NOT_APPLICABLE',
    confidence: 0,
    data_grade: normaliseGrade(CONTRACT_DATA_GRADE.NONE),
    data_source: DATA_SOURCE.NONE,
    reason: truncateReason(reasonText),
    evidence: emptyEvidence(),
    input_hash: inputHashHex,
    trace_id: traceId,
    engine_version: DECISION_RUN_ENGINE_VERSION,
    error: {
      code: 'INTERNAL',
      message: invalidField.startsWith('INVALID_INPUT')
        ? invalidField
        : `INVALID_INPUT — ${invalidField}`
    },
    _routing: { subsystem: 'validation', legacy_hint: 'VALIDATION_GATE', field: invalidField, ...routingHints }
  });
}

function truncateReason(s, max = 520) {
  const t = String(s || '');
  return t.length <= max ? t : `${t.slice(0, max - 3)}...`;
}

function extractExperimentIdsFromResult(result) {
  const ids = new Set();
  const sel = result?.outputs?.selected_experiments;
  if (Array.isArray(sel)) {
    for (const row of sel) {
      const id = row?.experiment_id;
      if (id != null && String(id).trim()) ids.add(String(id).trim());
    }
  }
  const synth = result?.outputs?.synthesis;
  if (typeof synth === 'string') {
    const found = synth.match(/\bEXP-[A-Z0-9][A-Z0-9_-]*/gi);
    if (found) found.forEach((x) => ids.add(String(x).toUpperCase()));
  }
  return [...ids];
}

/** Evidence populated from structured loop outputs; rule_ids populated when gates supply rules */
export function evidenceFromRunLoop(result, ruleIds = []) {
  return {
    experiment_ids: extractExperimentIdsFromResult(result),
    rule_ids: Array.isArray(ruleIds)
      ? ruleIds.map((r) => String(r)).filter(Boolean)
      : []
  };
}

/** David checklist — `{ "mode":"lab", "data": { "rows":[...] } }` (distinct from §2.2 input/context envelope). */
export function isDavidLabRowsBody(raw) {
  if (!raw || typeof raw !== 'object') return false;
  if (String(raw.mode || '').trim() !== 'lab') return false;
  if (!raw.data || typeof raw.data !== 'object') return false;
  if (!Array.isArray(raw.data.rows)) return false;
  return true;
}

function canonicalDavidLabRowsForHash(body) {
  return stableStringify({ mode: 'lab', data: { rows: body.data.rows } });
}

function computeDavidLabInputHashHex(body) {
  return createHash('sha256')
    .update(`DAVID_LAB_ROWS_V11\n${canonicalDavidLabRowsForHash(body)}`, 'utf8')
    .digest('hex');
}

function parseMeasurementNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const DAVID_LAB_MEAS_KEYS = ['APP', 'PER', 'MEL', 'nanoclay', 'IFR', 'expansion'];

/** Deterministic evaluation for David's lab row integrity tests. */
function evaluateDavidLabRowsEnvelope(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return {
      decision: 'STOP',
      fsctm_state: 'BLOCKED',
      confidence: 0,
      data_grade: normaliseGrade(CONTRACT_DATA_GRADE.NONE),
      data_source: DATA_SOURCE.DB_COMPUTED,
      reason: 'No lab rows supplied.',
      evidence: emptyEvidence(),
      ruleIds: ['DAVID_LAB_EMPTY_ROWS']
    };
  }

  const row = rows[0];
  if (!row || typeof row !== 'object') {
    return {
      decision: 'STOP',
      fsctm_state: 'BLOCKED',
      confidence: 0,
      data_grade: normaliseGrade(CONTRACT_DATA_GRADE.NONE),
      data_source: DATA_SOURCE.DB_COMPUTED,
      reason: 'Invalid lab row object.',
      evidence: emptyEvidence(),
      ruleIds: ['DAVID_LAB_INVALID_ROW']
    };
  }

  const keys = Object.keys(row);
  const experimentId = row.experiment_id != null ? String(row.experiment_id).trim() : '';

  const substantiveKeys = keys.filter((k) => {
    const v = row[k];
    return v !== undefined && v !== null && v !== '';
  });

  if (substantiveKeys.length === 1 && substantiveKeys[0] === 'experiment_id' && experimentId) {
    return {
      decision: 'STOP',
      fsctm_state: 'BLOCKED',
      confidence: 0,
      data_grade: normaliseGrade(CONTRACT_DATA_GRADE.NONE),
      data_source: DATA_SOURCE.DB_COMPUTED,
      reason: 'Lab row incomplete — formulation measurements required (guard).',
      evidence: {
        experiment_ids: [experimentId],
        rule_ids: ['DAVID_LAB_ROW_INCOMPLETE']
      },
      ruleIds: ['DAVID_LAB_ROW_INCOMPLETE']
    };
  }

  const vals = {};
  for (const m of DAVID_LAB_MEAS_KEYS) {
    const n = parseMeasurementNumber(row[m]);
    if (n === null) {
      return {
        decision: 'STOP',
        fsctm_state: 'BLOCKED',
        confidence: 0,
        data_grade: normaliseGrade(CONTRACT_DATA_GRADE.NONE),
        data_source: DATA_SOURCE.DB_COMPUTED,
        reason: truncateReason(`Missing or invalid measurement field: ${m}.`),
        evidence: {
          experiment_ids: experimentId ? [experimentId] : [],
          rule_ids: ['DAVID_LAB_MISSING_MEASUREMENT']
        },
        ruleIds: ['DAVID_LAB_MISSING_MEASUREMENT']
      };
    }
    vals[m] = n;
  }

  const expansion = vals.expansion;
  const cq = String(row.char_quality ?? '').trim().toUpperCase();
  const baseEvidence = {
    experiment_ids: experimentId ? [experimentId] : [],
    rule_ids: []
  };

  if (expansion >= 93 && cq === 'GOOD') {
    const confidence = Math.min(0.99, 0.88 + expansion / 1000);
    return {
      decision: 'GO',
      fsctm_state: 'APPROVED',
      confidence,
      data_grade: normaliseGrade(CONTRACT_DATA_GRADE.HIGH),
      data_source: DATA_SOURCE.DB_COMPUTED,
      reason:
        'Structured lab row satisfies high-performing expansion threshold with positive quality cue (DB-computed gate).',
      evidence: baseEvidence,
      ruleIds: []
    };
  }

  if (expansion >= 72) {
    const confidence = Math.min(0.94, 0.52 + expansion / 200);
    return {
      decision: 'ITERATE',
      fsctm_state: 'BLOCKED',
      confidence,
      data_grade: normaliseGrade(CONTRACT_DATA_GRADE.MID),
      data_source: DATA_SOURCE.DB_COMPUTED,
      reason: 'Measurements complete; iterative refinement indicated before APPROVED.',
      evidence: baseEvidence,
      ruleIds: []
    };
  }

  return {
    decision: 'STOP',
    fsctm_state: 'BLOCKED',
    confidence: Math.min(0.45, 0.12 + expansion / 400),
    data_grade: normaliseGrade(CONTRACT_DATA_GRADE.LOW),
    data_source: DATA_SOURCE.DB_COMPUTED,
    reason: 'Expansion below minimum gate for forward progress — hold or reformulate.',
    evidence: baseEvidence,
    ruleIds: ['DAVID_LAB_LOW_EXPANSION']
  };
}

function processDavidLabRowsDecision(rawBody, deps = {}) {
  const { persistAudit } = deps;
  const snapshot = {
    david_lab_rows: {
      mode: 'lab',
      data: { rows: rawBody.data.rows }
    }
  };
  const inputHash = computeDavidLabInputHashHex(rawBody);
  const traceId = traceIdDeterministic(inputHash);
  const inner = evaluateDavidLabRowsEnvelope(rawBody.data.rows);

  const ev = buildV23Envelope({
    decision: inner.decision,
    fsctm_state: inner.fsctm_state,
    confidence: inner.confidence,
    data_grade: inner.data_grade,
    data_source: inner.data_source,
    reason: inner.reason,
    evidence: inner.evidence,
    input_hash: inputHash,
    trace_id: traceId,
    engine_version: DECISION_RUN_ENGINE_VERSION,
    error: null,
    _routing: { legacy_hint: 'DAVID_LAB_ROWS', path: 'mode_lab_data_rows' }
  });
  fireAudit(
    persistAudit,
    auditRowFromEnvelope(ev, snapshot, { session_id: null, cache_hit: false })
  );
  return ev;
}

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
 * deps: { runLoop, getRagService, ResearchSession?, getActiveViolation?, researchRunLocks (Map)?, persistAudit? }
 */
export async function processDecisionRun(rawBody, deps = {}) {
  if (isDavidLabRowsBody(rawBody)) {
    return processDavidLabRowsDecision(rawBody, deps);
  }

  const shape = validateContract22Shape(rawBody || {});
  if (!shape.ok) {
    let inputHashFallback = '';
    let traceFb = '';
    try {
      if (rawBody && rawBody.context && typeof rawBody.context === 'object') {
        const partial = {
          input:
            rawBody.input &&
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
      data_grade: normaliseGrade(CONTRACT_DATA_GRADE.NONE),
      data_source: DATA_SOURCE.NONE,
      reason: truncateReason(
        `[Bounded scope lab] Decision Engine WRAP GO pending — invocation logged; no downstream lab bridge.`
      ),
      evidence: emptyEvidence(),
      input_hash: inputHash,
      trace_id: traceId,
      engine_version: DECISION_RUN_ENGINE_VERSION,
      error: null,
      _routing: { legacy_hint: 'SCOPE_BOUNDARY', path: 'lab' }
    });
    fireAudit(persistAudit, auditRowFromEnvelope(ev, body, { session_id: null, cache_hit: false }));
    return ev;
  }

  if (body.input.type === 'message') {
    const ev = buildV23Envelope({
      decision: 'STOP',
      fsctm_state: 'BLOCKED',
      confidence: 0,
      data_grade: normaliseGrade(CONTRACT_DATA_GRADE.NONE),
      data_source: DATA_SOURCE.NONE,
      reason: truncateReason(
        `[Bounded scope message] Decision Engine WRAP GO pending — invocation logged.`
      ),
      evidence: emptyEvidence(),
      input_hash: inputHash,
      trace_id: traceId,
      engine_version: DECISION_RUN_ENGINE_VERSION,
      error: null,
      _routing: { legacy_hint: 'SCOPE_BOUNDARY', path: 'message' }
    });
    fireAudit(persistAudit, auditRowFromEnvelope(ev, body, { session_id: null, cache_hit: false }));
    return ev;
  }

  const sessionIdRaw = body.input.data.session_id;
  const queryRaw = body.input.data.query;
  if (typeof sessionIdRaw !== 'string' || sessionIdRaw.trim() === '') {
    const ev = envelopeSystemError(
      '`input.data.session_id` must be a non-empty string.',
      'input.data.session_id',
      inputHash,
      traceId
    );
    fireAudit(deps.persistAudit, auditRowFromEnvelope(ev, body, { session_id: null, cache_hit: false }));
    return ev;
  }
  if (typeof queryRaw !== 'string' || queryRaw.trim() === '') {
    const ev = envelopeSystemError(
      '`input.data.query` must be a non-empty string.',
      'input.data.query',
      inputHash,
      traceId
    );
    fireAudit(deps.persistAudit, auditRowFromEnvelope(ev, body, { session_id: null, cache_hit: false }));
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
      data_grade: normaliseGrade(CONTRACT_DATA_GRADE.NONE),
      data_source: DATA_SOURCE.DB_COMPUTED,
      reason: truncateReason(`Research session ${sessionId} was not found.`),
      evidence: emptyEvidence(),
      input_hash: inputHash,
      trace_id: traceId,
      engine_version: DECISION_RUN_ENGINE_VERSION,
      error: null,
      _routing: { legacy_hint: 'SESSION_GATE', gate: 'session_lookup' }
    });
    fireAudit(persistAudit, auditRowFromEnvelope(ev, body, { session_id: null, cache_hit: false }));
    return ev;
  }

  if (getActiveViolation) {
    try {
      const violation = await getActiveViolation(sessionId);
      if (violation) {
        const rid =
          violation.id != null ? `integrity_violation:${violation.id}` : violation.type ? String(violation.type) : 'B_INTEGRITY';
        const ev = buildV23Envelope({
          decision: 'STOP',
          fsctm_state: 'BLOCKED',
          confidence: 0,
          data_grade: normaliseGrade(CONTRACT_DATA_GRADE.NONE),
          data_source: DATA_SOURCE.DB_COMPUTED,
          reason: truncateReason(
            `Unresolved B-Integrity condition (${violation.reason || violation.type || 'unknown'}) blocks execution.`
          ),
          evidence: { experiment_ids: [], rule_ids: [rid] },
          input_hash: inputHash,
          trace_id: traceId,
          engine_version: DECISION_RUN_ENGINE_VERSION,
          error: null,
          _routing: { legacy_hint: 'B_INTEGRITY_GATE', gate: 'integrity', violation_id: violation.id ?? null }
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
      data_grade: normaliseGrade(CONTRACT_DATA_GRADE.NONE),
      data_source: DATA_SOURCE.DB_COMPUTED,
      reason: truncateReason(
        'Session kernel marks possibility-space shutdown — research loop suppressed for /decision/run question.'
      ),
      evidence: { experiment_ids: [], rule_ids: ['KERNEL_V16_POSSIBILITY_SHUTDOWN'] },
      input_hash: inputHash,
      trace_id: traceId,
      engine_version: DECISION_RUN_ENGINE_VERSION,
      error: null,
      _routing: { legacy_hint: 'KERNEL_V16_SHUTDOWN', gate: 'kernel_shutdown' }
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
      traceId,
      { subsystem: 'config', legacy_hint: 'SERVER_INJECTION' }
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
      data_grade: normaliseGrade(CONTRACT_DATA_GRADE.NONE),
      data_source: DATA_SOURCE.DOCUMENT_RAG,
      reason: truncateReason(result?.error || 'Research loop returned an error.'),
      evidence: evidenceFromRunLoop(result || {}),
      input_hash: inputHash,
      trace_id: traceId,
      engine_version: DECISION_RUN_ENGINE_VERSION,
      error: null,
      _routing: { legacy_hint: 'RESEARCH_LOOP_ERROR', gate: 'run_loop_failure' }
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
  const triple = mapSynthToDecisionTriple(synthDecision);
  const confInner =
    synth.length === 0 ? 0.1 : Math.min(0.95, 0.55 + synth.length / 8000);
  const confidence = Math.min(0.99, Math.max(0, confInner));

  const ev = buildV23Envelope({
    decision: triple.decision,
    fsctm_state: triple.fsctm_state,
    confidence,
    data_grade: triple.data_grade,
    data_source: DATA_SOURCE.DOCUMENT_RAG,
    reason: truncateReason(
      synthDecision === 'GO'
        ? 'Synthesis-derived GO mapped to FSCTM APPROVED.'
        : `Synthesis-derived status ${synthDecision} (${triple.decision}) — guarded outcome per contract mapping.`
    ),
    evidence: evidenceFromRunLoop(result),
    input_hash: inputHash,
    trace_id: traceId,
    engine_version: DECISION_RUN_ENGINE_VERSION,
    error: null,
    _routing: { legacy_hint: 'RESEARCH_LOOP', gate: 'run_loop_success', synth_derived: synthDecision }
  });
  fireAudit(persistAudit, auditRowFromEnvelope(ev, body, {
    session_id: sessionId,
    cache_hit: false,
    request_query: query
  }));
  return ev;
}
