/**
 * Unit checks for N=2, N=3 entity extraction and resolveEntitySnapshots (no network).
 * Run: node matriya-back/scripts/verify-matriya-query-intent.mjs
 */
import assert from 'assert';
import {
  extractExpEntities,
  classifyIntent,
  resolveEntitySnapshots,
  buildKernelStageRuns
} from '../lib/matriyaQueryIntent.js';

const mockRows = [
  { experiment_id: 'EXP-001', expansion_ratio: 1, APP: 10 },
  { experiment_id: 'exp-002', expansion_ratio: 2, APP: 20 },
  { experiment_id: 'EXP-006', expansion_ratio: 3 },
  { experiment_id: 'EXP-009', expansion_ratio: 4 }
];

// N=2
const q2 = 'Compare EXP-006 and EXP-009';
const e2 = extractExpEntities(q2);
assert.deepStrictEqual(e2, ['EXP-006', 'EXP-009'], 'N=2 entities');
assert.strictEqual(classifyIntent(e2), 'comparison', 'N=2 intent');
const r2 = resolveEntitySnapshots(e2, mockRows);
assert.strictEqual(r2.snapshots.length, 2, 'N=2 snapshots');
assert.deepStrictEqual(r2.missing_entities, [], 'N=2 no missing');
assert.strictEqual(String(r2.snapshots[0].experiment_id).toUpperCase(), 'EXP-006');

// N=3
const q3 = 'Show EXP-001, EXP-002, EXP-009 in comparison';
const e3 = extractExpEntities(q3);
assert.strictEqual(e3.length, 3, 'N=3 count');
assert.strictEqual(classifyIntent(e3), 'comparison', 'N=3 intent');
const r3 = resolveEntitySnapshots(e3, mockRows);
assert.strictEqual(r3.snapshots.length, 3, 'N=3 snapshots');

// Partial: one missing
const ePart = ['EXP-006', 'EXP-999'];
const rPart = resolveEntitySnapshots(ePart, mockRows);
assert.deepStrictEqual(rPart.missing_entities, ['EXP-999'], 'missing');
assert.strictEqual(rPart.snapshots.length, 1, 'one snapshot');
assert.ok(rPart.snapshots[0].experiment_id);

const kr = buildKernelStageRuns(rPart.snapshots);
assert.ok(Array.isArray(kr) && kr.length === 1 && kr[0].stages && kr[0].stages.K);

process.stdout.write('verify-matriya-query-intent: OK (N=2, N=3, partial, kernel_runs)\n');
process.exit(0);
