/**
 * Unit tests for isUnfilteredDumpQuery guard.
 * Run: node matriya-back/scripts/verify-no-route-matched.mjs
 */
import assert from 'assert';

function isUnfilteredDumpQuery(query) {
  const q = String(query || '').toLowerCase().trim();
  if (!q) return false;
  if (!/\b(show|list|get|fetch|find|display)\s+all\b/.test(q)) return false;
  if (/[><]=?|\bbetween\b|\bgreater\b|\bless\b|\babove\b|\bbelow\b|\bat least\b|\bat most\b|\bmore than\b|\bhigher\b|\blower\b/.test(q)) return false;
  if (/=/.test(q)) return false;
  if (/\bEXP-[\dA-Z]+\b/i.test(q)) return false;
  if (/\b(highest|lowest|top|bottom|maximum|minimum|best|worst|ranking|rank)\b/.test(q)) return false;
  if (/\b(where|with|having|status|pass|fail|partial|validated|char)\b/.test(q)) return false;
  return true;
}

// Must block
assert.strictEqual(isUnfilteredDumpQuery('list all formulations'), true, 'block: list all formulations');
assert.strictEqual(isUnfilteredDumpQuery('show all experiments'), true, 'block: show all experiments');
assert.strictEqual(isUnfilteredDumpQuery('get all formulations'), true, 'block: get all formulations');
assert.strictEqual(isUnfilteredDumpQuery('list all'), true, 'block: list all');
assert.strictEqual(isUnfilteredDumpQuery('fetch all lab data'), true, 'block: fetch all lab data');

// Must pass through
assert.strictEqual(isUnfilteredDumpQuery('list all experiments with expansion_ratio > 20'), false, 'allow: filter');
assert.strictEqual(isUnfilteredDumpQuery('show all status=PASS'), false, 'allow: equality filter');
assert.strictEqual(isUnfilteredDumpQuery('show all EXP-006'), false, 'allow: entity reference');
assert.strictEqual(isUnfilteredDumpQuery('list all highest expansion_ratio'), false, 'allow: ranking');
assert.strictEqual(isUnfilteredDumpQuery('show all experiments with status PASS'), false, 'allow: status word');
assert.strictEqual(isUnfilteredDumpQuery('Compare EXP-006 and EXP-009'), false, 'allow: comparison');
assert.strictEqual(isUnfilteredDumpQuery('expansion_ratio > 20'), false, 'allow: no list-all');

process.stdout.write('verify-no-route-matched: OK (5 blocked, 7 pass-through)\n');
process.exit(0);
