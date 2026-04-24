/**
 * CLI smoke test: fixture CSV + same EXP-id regex as server (no HTTP).
 * Run: node scripts/verify-entity-compare.mjs
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const csvPath = path.join(__dirname, '..', 'science', 'fixtures', 'lab_cli_verify.csv');
const text = readFileSync(csvPath, 'utf8');

function parseTwoExperimentIdsForComparison(s) {
  const re = /\b(EXP-[\dA-Z]+)\b/gi;
  const seen = new Set();
  const out = [];
  let m;
  while ((m = re.exec(s)) !== null) {
    const id = m[1].toUpperCase();
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
      if (out.length >= 2) return [out[0], out[1]];
    }
  }
  return null;
}

const q = 'how does EXP-009 differ structurally from EXP-006?';
const ids = parseTwoExperimentIdsForComparison(q);
if (!ids || ids[0] !== 'EXP-009' || ids[1] !== 'EXP-006') {
  console.error('[FAIL] id parse', ids);
  process.exit(1);
}
const lines = text.split(/\r?\n/).filter(Boolean);
const want = new Set(ids);
const found = [];
for (let i = 1; i < lines.length; i++) {
  const id = lines[i].split(',')[0];
  if (want.has(id)) found.push(id);
}
if (found.length < 2) {
  console.error('[FAIL] rows in fixture', found);
  process.exit(1);
}
console.log('[OK] compare ids', ids, '- fixture has both rows');
