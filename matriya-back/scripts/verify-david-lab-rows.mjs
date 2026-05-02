/**
 * David deployment integrity — POST /decision/run `mode: lab` + `data.rows[]` checklist.
 * Run: npm run verify:david-lab-rows
 */
import assert from 'node:assert/strict';
import { processDecisionRun, isDavidLabRowsBody, DECISION_RUN_ENGINE_VERSION } from '../lib/decisionRunV110.js';

const audits = [];

const test1 = {
  mode: 'lab',
  data: {
    rows: [
      {
        experiment_id: 'TEST-001',
        APP: 30,
        PER: 10,
        MEL: 5,
        nanoclay: 2,
        IFR: 25,
        expansion: 80,
      },
    ],
  },
};

const test2 = {
  mode: 'lab',
  data: {
    rows: [{ experiment_id: 'TEST-002' }],
  },
};

const test3 = {
  mode: 'lab',
  data: {
    rows: [
      {
        experiment_id: 'TEST-003',
        APP: 32,
        PER: 14,
        MEL: 6,
        nanoclay: 3,
        IFR: 30,
        expansion: 95,
        char_quality: 'GOOD',
      },
    ],
  },
};

assert.equal(isDavidLabRowsBody(test1), true);
assert.equal(isDavidLabRowsBody({ input: { type: 'lab', data: {} }, context: { project_id: 'x', model_id: 'y' } }), false);

const r1 = await processDecisionRun(test1, {
  persistAudit: (row) => audits.push({ label: 't1', row }),
});
assert.equal(r1.engine_version, DECISION_RUN_ENGINE_VERSION);
assert.strictEqual(r1.error, null);
assert.notEqual(r1.decision, 'SYSTEM_ERROR');
assert.ok(typeof r1.decision === 'string' && r1.decision.length > 0);
assert.ok(['GO', 'ITERATE', 'STOP', 'INSUFFICIENT_DATA'].includes(r1.decision));

const r2 = await processDecisionRun(test2, {
  persistAudit: (row) => audits.push({ label: 't2', row }),
});
assert.strictEqual(r2.error, null);
assert.equal(r2.decision, 'STOP');

const r3 = await processDecisionRun(test3, {
  persistAudit: (row) => audits.push({ label: 't3', row }),
});
assert.strictEqual(r3.error, null);
assert.notEqual(r3.decision, 'STOP');
assert.ok(r3.confidence > 0, `TEST 3 confidence > 0, got ${r3.confidence}`);

for (const a of audits) {
  assert.ok(a.row?.audit_bundle, 'audit_bundle on persist row');
  assert.ok(a.row.audit_bundle.trace_id, 'trace_id in audit bundle');
  assert.equal(a.row.audit_bundle.engine_version, DECISION_RUN_ENGINE_VERSION);
}

console.log('--- TEST 1 response ---');
console.log(JSON.stringify(r1, null, 2));
console.log('--- TEST 2 response ---');
console.log(JSON.stringify(r2, null, 2));
console.log('--- TEST 3 response ---');
console.log(JSON.stringify(r3, null, 2));
console.log('\nverify:david-lab-rows PASS');
