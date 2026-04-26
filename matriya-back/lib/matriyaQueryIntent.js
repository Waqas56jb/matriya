/**
 * Lab query intent: extract EXP-* entities, resolve snapshots from Lab Manager rows,
 * and emit minimal K→C→B→N→L stage markers per snapshot (no direct DB in matriya-back).
 */

/**
 * All distinct EXP-… tokens in order of appearance.
 * @param {string} text
 * @returns {string[]}
 */
export function extractExpEntities(text) {
  const s = String(text || '');
  const re = /\b(EXP-[\dA-Z]+)\b/gi;
  const seen = new Set();
  const out = [];
  let m;
  while ((m = re.exec(s)) !== null) {
    const id = m[1].toUpperCase();
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * @param {string[]} entities
 * @returns {'comparison' | 'entity_lookup' | 'general'}
 */
export function classifyIntent(entities) {
  if (entities.length >= 2) return 'comparison';
  if (entities.length === 1) return 'entity_lookup';
  return 'general';
}

/**
 * @param {string[]} entities — requested order
 * @param {object[]} experiments — rows from Lab Manager /api/matriya/lab-experiments-export
 * @returns {{ snapshots: object[], missing_entities: string[], columnOrder: string[] }}
 */
export function resolveEntitySnapshots(entities, experiments) {
  if (!Array.isArray(experiments) || experiments.length === 0) {
    return { snapshots: [], missing_entities: [...entities], columnOrder: [] };
  }
  const byId = new Map();
  for (const r of experiments) {
    if (!r || typeof r !== 'object') continue;
    const raw = r.experiment_id;
    if (raw == null) continue;
    const id = String(raw).toUpperCase().trim();
    if (id) byId.set(id, r);
  }
  const snapshots = [];
  const missing_entities = [];
  for (const e of entities) {
    const row = byId.get(e);
    if (row) snapshots.push({ ...row });
    else missing_entities.push(e);
  }
  const columnOrder = snapshots[0] && typeof snapshots[0] === 'object'
    ? Object.keys(snapshots[0])
    : [];
  return { snapshots, missing_entities, columnOrder };
}

/**
 * @param {object[]} snapshots — lab rows
 * @returns {Array<{ experiment_id: string, stages: { K: object, C: object, B: object, N: object, L: object } }>}
 */
export function buildKernelStageRuns(snapshots) {
  return (Array.isArray(snapshots) ? snapshots : []).map((row) => {
    const eid = row?.experiment_id != null ? String(row.experiment_id).toUpperCase().trim() : '';
    const pick = (k) => (row && row[k] != null ? row[k] : null);
    return {
      experiment_id: eid,
      stages: {
        K: { kind: 'snapshot', summary: eid ? `Entity ${eid} bound to Lab Manager export row` : 'Unbound' },
        C: { source: 'lab_experiment_snapshot', experiment_id: eid || null },
        B: { metrics: { expansion_ratio: pick('expansion_ratio'), adhesion: pick('adhesion'), char_quality: pick('char_quality') } },
        N: { status: pick('status'), app_per: pick('APP:PER') },
        L: { gate: 'L_structured', note: 'Per-snapshot K→C→B→N→L pass (minimal)' }
      }
    };
  });
}

/**
 * @param {string[]} entities
 * @param {object[]} snapshots
 * @param {string[]} missing
 * @param {(a: object, b: object) => string} structuralDiffSummary
 * @returns {string}
 */
export function buildComparisonNarration(entities, snapshots, missing, structuralDiffSummary) {
  if (missing.length) {
    const msg = `Partial comparison. Loaded ${snapshots.length} of ${entities.length} experiment(s). Missing: ${missing.join(', ')}.`;
    if (snapshots.length >= 2 && typeof structuralDiffSummary === 'function') {
      return `${msg} ${structuralDiffSummary(snapshots[0], snapshots[1])}`;
    }
    return msg;
  }
  if (snapshots.length >= 2 && typeof structuralDiffSummary === 'function') {
    const more = snapshots.length > 2 ? ` (${snapshots.length} experiments included.)` : '';
    return `Structural comparison. ${structuralDiffSummary(snapshots[0], snapshots[1])}${more}`;
  }
  if (entities.length) return `Comparison: ${entities.join(' vs ')}.`;
  return 'Comparison context.';
}
