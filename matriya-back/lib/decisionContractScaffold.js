/**
 * Contract v1.1 scaffold — POST /decision/run (commit #1 proof only).
 * Returns full eleven-key §2.3 envelope; no DB, LLM, or downstream side effects.
 */
export const DECISION_CONTRACT_ENGINE_VERSION = '1.1.0';

/**
 * §2.3 response keys (implicit contract): eleven top-level scalar/object fields exactly as listed below.
 *
 * David scaffold requirements (SYSTEM_ERROR stub):
 * decision, fsctm_state, reason, error { code, message } — plus complementary keys below.
 *
 * Key order stabilized for deterministic JSON readability (consumers MUST treat JSON as unordered).
 *
 * Keys:
 * 1 engine_version — string
 * 2 input_hash — string (empty until canonical pipeline exists)
 * 3 decision — string (literal SYSTEM_ERROR stub)
 * 4 fsctm_state — string
 * 5 data_grade — string (enumeration compatible with Answer Composer lineage)
 * 6 confidence — number in [0,1]
 * 7 reason — string
 * 8 error — object { code: string, message: string }
 * 9 audit_trace — object (empty object valid)
 * 10 external_context — null | object (null until GO wiring)
 * 11 metadata — object (scaffold breadcrumbs only)
 *
 * @param {object} [opts]
 * @param {string} [opts.message] — error.message override
 * @returns {object} eleven-key §2.3 envelope matching DECISION_CONTRACT schema stub
 */
export function buildDecisionContractScaffoldEnvelope(opts = {}) {
  const msg =
    opts.message ||
    'POST /decision/run scaffold — engine logic not wired. Awaiting GO for v1.1 implementation phase.';

  return {
    engine_version: DECISION_CONTRACT_ENGINE_VERSION,
    input_hash: '',
    decision: 'SYSTEM_ERROR',
    fsctm_state: 'NOT_APPLICABLE',
    data_grade: 'NO_DATA',
    confidence: 0,
    reason: 'NOT_IMPLEMENTED — scaffold only',
    error: { code: 'INTERNAL', message: msg },
    audit_trace: {},
    external_context: null,
    metadata: {
      scaffold: true,
      route: '/decision/run',
      note: 'No database calls, caches, agents, or management HTTP from this stub.',
    },
  };
}

/** Express handler — synchronous JSON send (body ignored; deterministic stub) */
export function sendDecisionContractScaffoldResponse(req, res) {
  res.status(503).json(buildDecisionContractScaffoldEnvelope());
}
