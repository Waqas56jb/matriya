/**
 * Decision Engine v1.1 /decision/run — fixtures (§2.3 v1.1.1: evidence object, error semantics, data_source enum).
 * Run: npm run verify:decision-run-v110
 */
import assert from 'node:assert/strict';
import {
  processDecisionRun,
  traceIdDeterministic,
  DECISION_RUN_ENGINE_VERSION,
  deriveSynthesisDecisionStub,
  DATA_SOURCE,
  normaliseGrade,
} from '../lib/decisionRunV110.js';

const V11_BASE_KEY_ORDER = [
  'decision',
  'fsctm_state',
  'confidence',
  'data_grade',
  'data_source',
  'reason',
  'evidence',
  'input_hash',
  'trace_id',
  'engine_version',
  'error',
];

function assertV11(ev) {
  const keys = Object.keys(ev);
  const baseLen = V11_BASE_KEY_ORDER.length;
  assert.ok(
    keys.length === baseLen || (keys.length === baseLen + 1 && keys[baseLen] === '_routing'),
    `expected 11 or 12 keys (optional _routing); got ${keys.length}: ${keys.join(',')}`,
  );
  for (let i = 0; i < V11_BASE_KEY_ORDER.length; i++) {
    assert.equal(keys[i], V11_BASE_KEY_ORDER[i], `§2.3 key order mismatch at index ${i}`);
  }
  if (keys.length > baseLen) assert.equal(keys[baseLen], '_routing');

  assert.ok(ev.evidence && typeof ev.evidence === 'object' && !Array.isArray(ev.evidence), 'evidence must be object');
  assert.ok(Array.isArray(ev.evidence.experiment_ids), 'evidence.experiment_ids must be array');
  assert.ok(Array.isArray(ev.evidence.rule_ids), 'evidence.rule_ids must be array');

  if (ev.decision === 'SYSTEM_ERROR') {
    assert.ok(ev.error && typeof ev.error.code === 'string');
    assert.ok(ev.error && typeof ev.error.message === 'string');
  } else {
    assert.strictEqual(ev.error, null, 'success paths require error: null');
  }

  assert.ok(['NONE', 'DB_COMPUTED', 'DOCUMENT_RAG'].includes(ev.data_source), 'data_source ∈ {NONE,DB_COMPUTED,DOCUMENT_RAG}');

  assert.ok(typeof ev.data_grade === 'number' && ev.data_grade >= 0 && ev.data_grade <= 1);
  assert.equal(typeof ev.trace_id, 'string');
}

const sid = '11111111-1111-4111-8111-111111111111';
const noopAudit = () => {};
const MOCK_SESSION_ROW = id => ({
  id,
  kernel_context: null,
});

const fixtureLab = await processDecisionRun(
  {
    input: { type: 'lab', data: { fixture: true } },
    context: { project_id: 'proj-a', model_id: 'fixture-model' },
  },
  { persistAudit: noopAudit },
);
assertV11(fixtureLab);
assert.equal(fixtureLab.decision, 'STOP');
assert.equal(fixtureLab.fsctm_state, 'BLOCKED');
assert.equal(fixtureLab.engine_version, DECISION_RUN_ENGINE_VERSION);
assert.equal(fixtureLab.data_source, DATA_SOURCE.NONE);
assert.equal(
  fixtureLab.input_hash,
  'fa4afc631987e3f2dcf7568693f3f9380371bbe1954da6ec3b9f0416ae978044',
);
assert.equal(traceIdDeterministic(fixtureLab.input_hash), fixtureLab.trace_id);

const fixtureLabB = await processDecisionRun(
  {
    input: { type: 'lab', data: { fixture: true } },
    context: { project_id: 'proj-a', model_id: 'fixture-model' },
  },
  { persistAudit: noopAudit },
);
assert.deepStrictEqual(fixtureLabB, fixtureLab, 'determinism: lab BLOCKED');

const fixtureMessage = await processDecisionRun(
  {
    input: { type: 'message', data: {} },
    context: { project_id: 'proj-a', model_id: 'fixture-msg' },
  },
  { persistAudit: noopAudit },
);
assertV11(fixtureMessage);
assert.equal(fixtureMessage.decision, 'STOP');
assert.equal(fixtureMessage.fsctm_state, 'BLOCKED');
assert.equal(fixtureMessage.data_source, DATA_SOURCE.NONE);

const fixtureMissingSession = await processDecisionRun(
  {
    input: { type: 'question', data: { session_id: sid, query: 'Explain stability' } },
    context: { project_id: 'proj-a', model_id: 'fixture-q1' },
  },
  {
    ResearchSession: { findByPk: async () => null },
    persistAudit: noopAudit,
  },
);
assertV11(fixtureMissingSession);
assert.equal(fixtureMissingSession.decision, 'STOP');
assert.equal(fixtureMissingSession.fsctm_state, 'BLOCKED');
assert.equal(fixtureMissingSession.data_source, DATA_SOURCE.DB_COMPUTED);

const cleanSession = MOCK_SESSION_ROW(sid);
const fixtureViolation = await processDecisionRun(
  {
    input: { type: 'question', data: { session_id: sid, query: 'Explain stability' } },
    context: { project_id: 'proj-a', model_id: 'fixture-q2' },
  },
  {
    ResearchSession: { findByPk: async () => cleanSession },
    getActiveViolation: async () => ({ id: 42, type: 'B_INTEGRITY', reason: 'fixture' }),
    persistAudit: noopAudit,
  },
);
assertV11(fixtureViolation);
assert.equal(fixtureViolation.decision, 'STOP');
assert.equal(fixtureViolation.fsctm_state, 'BLOCKED');
assert.equal(fixtureViolation.data_source, DATA_SOURCE.DB_COMPUTED);
assert.ok(fixtureViolation.evidence.rule_ids.some((x) => String(x).includes('integrity_violation:42')));

/** GO path — mocks researchLoop primitive (researchLoop.js:186) */
const synthGo =
  'GO proceed with formulation EXP-FIXTURE: recommended next step verification with approved protocol.';
assert.equal(deriveSynthesisDecisionStub(synthGo), 'GO');

const fixtureGo = await processDecisionRun(
  {
    input: { type: 'question', data: { session_id: sid, query: 'fixture query' } },
    context: { project_id: 'proj-a', model_id: 'fixture-go-model' },
  },
  {
    ResearchSession: { findByPk: async () => cleanSession },
    getActiveViolation: async () => null,
    runLoop: async () => ({
      outputs: { synthesis: synthGo },
      justifications: [],
      sources: [{ evidence_channel: 'FIXTURE_SMOKE', note: 'x' }],
      duration_ms: 42,
    }),
    getRagService: () => ({}),
    persistAudit: noopAudit,
  },
);
assertV11(fixtureGo);
assert.equal(fixtureGo.decision, 'GO');
assert.equal(fixtureGo.fsctm_state, 'APPROVED');
assert.equal(fixtureGo.data_source, DATA_SOURCE.DOCUMENT_RAG);
assert.strictEqual(fixtureGo.error, null);
assert.equal(fixtureGo.data_grade, normaliseGrade(1));
assert.ok(fixtureGo.evidence.experiment_ids.includes('EXP-FIXTURE'));

const synthIterate = 'We should iterate — collect more adhesion data before approving.';
assert.equal(deriveSynthesisDecisionStub(synthIterate), 'ITERATE');
const fixtureIterate = await processDecisionRun(
  {
    input: { type: 'question', data: { session_id: sid, query: 'Next step?' } },
    context: { project_id: 'proj-a', model_id: 'fixture-iterate' },
  },
  {
    ResearchSession: { findByPk: async () => cleanSession },
    getActiveViolation: async () => null,
    runLoop: async () => ({
      outputs: { synthesis: synthIterate },
      justifications: [],
      sources: [],
      duration_ms: 1,
    }),
    getRagService: () => ({}),
    persistAudit: noopAudit,
  },
);
assertV11(fixtureIterate);
assert.equal(fixtureIterate.decision, 'ITERATE');
assert.strictEqual(fixtureIterate.error, null);
assert.ok(fixtureIterate.data_grade <= 1 && fixtureIterate.data_grade >= 0);

const auditRows = [];
const invalidEnvelope = await processDecisionRun({}, {
  persistAudit: async row => auditRows.push(row),
});
assertV11(invalidEnvelope);
assert.equal(invalidEnvelope.decision, 'SYSTEM_ERROR');
assert.equal(invalidEnvelope.fsctm_state, 'NOT_APPLICABLE');
assert.strictEqual(invalidEnvelope.data_source, DATA_SOURCE.NONE);
assert.ok(String(invalidEnvelope.error.message || '').startsWith('INVALID_INPUT —'));
assert.ok(auditRows.length >= 1);
const snap = auditRows[0]?.audit_bundle;
assert.ok(snap);
for (const k of [
  'trace_id',
  'input_hash',
  'engine_version',
  'decision',
  'fsctm_state',
  'confidence',
  'data_grade',
  'data_source',
  'timestamp',
  'cache_hit',
]) {
  assert.ok(k in snap, `audit bundle missing §6 field ${k}`);
}

console.log('verify:decision-run-v110 PASS');
