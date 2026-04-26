/**
 * Proposal Engine — Project Initialization Proposal Contract v1.1 (Final)
 *
 * Implements:
 *  - Normalization layer (Section 10.1)
 *  - Excel + PDF document parsing
 *  - Conflict detection on normalized values (Section 10.2)
 *  - Deterministic proposal_state computation (Sections 4, 10.3)
 *  - buildProposal(), computeProposalState(), applyPatch(), resolveProposalConflict()
 */
import * as XLSX from 'xlsx';

// ── NORMALIZATION LAYER (Section 10.1) ────────────────────────────────────────

const MATERIAL_ALIASES = {
  APP:      ['APP', 'APP %', 'APP%', 'Ammonium Polyphosphate', 'ammonium polyphosphate'],
  PER:      ['PER', 'Pentaerythritol', 'pentaerythritol'],
  MEL:      ['MEL', 'Melamine', 'melamine'],
  Nanoclay: ['Nanoclay', 'nanoclay', 'nano clay', 'Nano Clay'],
  IFR:      ['IFR', 'ifr'],
};

const METRIC_ALIASES = {
  adhesion:        ['adhesion', 'Adhesion', 'Bond Strength', 'bond strength', 'adhesion strength', 'Adhesion Strength'],
  expansion_ratio: ['expansion ratio', 'Expansion Ratio', 'expansion_ratio', 'swelling ratio', 'Swelling Ratio', 'Expansion', 'expansion'],
  viscosity:       ['viscosity', 'Viscosity', 'η'],
  char_quality:    ['char quality', 'Char Quality', 'char_quality'],
};

/** Build case-insensitive reverse lookup: alias → canonical name */
function buildReverseMap(groups) {
  const m = new Map();
  for (const [canonical, aliases] of Object.entries(groups)) {
    for (const alias of aliases) m.set(alias.toLowerCase().trim(), canonical);
  }
  return m;
}

const MAT_MAP = buildReverseMap(MATERIAL_ALIASES);
const MET_MAP = buildReverseMap(METRIC_ALIASES);

/**
 * Classify a raw column header.
 * @returns {{ canonical: string, type: 'material'|'metric' }} | null
 */
function classifyField(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const k = raw.trim().toLowerCase();
  if (MAT_MAP.has(k)) return { canonical: MAT_MAP.get(k), type: 'material' };
  if (MET_MAP.has(k)) return { canonical: MET_MAP.get(k), type: 'metric' };
  return null;
}

/**
 * Normalize a numeric value: strip %, cast to float, round to 2 dp.
 * Returns null on NaN.  (Section 10.1)
 */
function normalizeNum(raw) {
  if (raw == null || raw === '') return null;
  let s = String(raw).trim();
  if (s.endsWith('%')) s = s.slice(0, -1).trim();
  const n = parseFloat(s);
  return isNaN(n) ? null : Math.round(n * 100) / 100;
}

// ── PROJECT TYPE DETECTION ────────────────────────────────────────────────────

const PROJECT_TYPE_PATTERNS = [
  { pattern: /intumescent/i,       value: 'intumescent coating' },
  { pattern: /fire.?retardant/i,   value: 'fire retardant coating' },
  { pattern: /fire.?resistant/i,   value: 'fire resistant coating' },
  { pattern: /epoxy/i,             value: 'epoxy coating' },
  { pattern: /protective.?coat/i,  value: 'protective coating' },
  { pattern: /\bcoat/i,            value: 'coating research' },
  { pattern: /formul/i,            value: 'formulation research' },
];

function detectProjectType(texts) {
  const combined = texts.join(' ');
  for (const { pattern, value } of PROJECT_TYPE_PATTERNS) {
    if (pattern.test(combined)) return { value, confidence: 'HIGH', sources: [] };
  }
  return { value: 'research project', confidence: 'LOW', sources: [] };
}

// ── EXCEL PARSER ──────────────────────────────────────────────────────────────

/**
 * Parse an Excel buffer → experiment rows.
 * Handles: missing cells (LOW confidence), shifted columns, empty rows.
 * @returns {{ experiments, materialsSeen: Set, metricsSeen: Set, rawText: string }}
 */
function parseExcelBuffer(buffer, fileName) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const allExperiments = [];
  const materialsSeen = new Set();
  const metricsSeen = new Set();
  const rawTextParts = [];

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
    if (!rows || rows.length < 2) continue;

    // First non-empty row = headers
    let headerRowIdx = 0;
    while (headerRowIdx < rows.length && rows[headerRowIdx].every(c => c == null || c === '')) headerRowIdx++;
    if (headerRowIdx >= rows.length - 1) continue;

    const headers = rows[headerRowIdx].map(h => (h != null ? String(h).trim() : ''));
    const fieldMap = {}; // colIndex → { canonical, type }

    for (let ci = 0; ci < headers.length; ci++) {
      const classified = classifyField(headers[ci]);
      if (classified) {
        fieldMap[ci] = classified;
        if (classified.type === 'material') materialsSeen.add(classified.canonical);
        if (classified.type === 'metric')   metricsSeen.add(classified.canonical);
      }
    }

    // Data rows
    for (let ri = headerRowIdx + 1; ri < rows.length; ri++) {
      const row = rows[ri];
      if (!row || row.every(c => c == null || c === '')) continue; // Skip entirely empty rows

      // Infer experiment ID from first cell
      const firstCell = row[0] != null ? String(row[0]).trim() : '';
      let expId;
      if (/^EXP-?\d+/i.test(firstCell)) {
        expId = firstCell.toUpperCase().replace(/^EXP(\d)/i, 'EXP-$1');
      } else if (/^Run-?\w+/i.test(firstCell)) {
        expId = firstCell;
      } else if (firstCell) {
        expId = `EXP-${String(ri - headerRowIdx).padStart(3, '0')}`;
      } else {
        expId = `EXP-${String(ri - headerRowIdx).padStart(3, '0')}`;
      }

      const fields = {};
      let validFields = 0;
      let hasNull = false;

      for (const [ci, { canonical }] of Object.entries(fieldMap)) {
        const rawVal = row[parseInt(ci)];
        const num = normalizeNum(rawVal);
        if (num !== null) {
          fields[canonical] = num;
          validFields++;
        } else {
          hasNull = true; // Missing cell
        }
      }

      if (validFields === 0) continue; // Skip rows with no recognized data

      const confidence = hasNull ? 'LOW' : 'HIGH';
      const source = `${fileName}:sheet_${sheetName}:row${ri + 1}`;

      allExperiments.push({
        experiment_id: expId,
        status: 'detected',
        fields,
        confidence,
        sources: [source],
      });
      rawTextParts.push(`${expId}: ${JSON.stringify(fields)}`);
    }
  }

  return { experiments: allExperiments, materialsSeen, metricsSeen, rawText: rawTextParts.join('\n') };
}

// ── PDF PARSER ────────────────────────────────────────────────────────────────

/**
 * Extract text from PDF buffer.
 * Returns { text, ocrRequired } — ocrRequired when text < 50 chars.
 */
async function extractPdfText(buffer) {
  try {
    // Use direct lib path to avoid pdf-parse test-mode auto-import issue
    const { default: pdfParse } = await import('pdf-parse/lib/pdf-parse.js');
    const data = await pdfParse(buffer);
    const text = (data.text || '').trim();
    if (text.length < 50) return { text: '', ocrRequired: true };
    return { text, ocrRequired: false };
  } catch (_) {
    return { text: '', ocrRequired: true };
  }
}

/**
 * Extract experiment mentions and field values from PDF text.
 * Uses alias patterns for flexible matching.
 */
function parsePdfText(text, fileName) {
  const experiments = [];
  const materialsSeen = new Set();
  const metricsSeen = new Set();

  // Find EXP-NNN blocks (up to 8 lines around each mention)
  const expBlockRe = /EXP-?(\d+)/gi;
  let match;
  while ((match = expBlockRe.exec(text)) !== null) {
    const expNum = match[1].padStart(3, '0');
    const expId = `EXP-${expNum}`;
    // Extract surrounding context (400 chars around the match)
    const start = Math.max(0, match.index - 50);
    const end = Math.min(text.length, match.index + 350);
    const block = text.slice(start, end);

    const fields = {};

    for (const [canonical, aliases] of [
      ...Object.entries(MATERIAL_ALIASES),
      ...Object.entries(METRIC_ALIASES),
    ]) {
      const escaped = aliases.map(a => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      const fieldRe = new RegExp(`(?:${escaped.join('|')})\\s*(?:=|:|-|measured at|at)\\s*([\\d.]+)\\s*%?`, 'i');
      const fm = block.match(fieldRe);
      if (fm) {
        const num = normalizeNum(fm[1]);
        if (num !== null) {
          fields[canonical] = num;
          if (MATERIAL_ALIASES[canonical]) materialsSeen.add(canonical);
          else                             metricsSeen.add(canonical);
        }
      }
    }

    if (Object.keys(fields).length > 0) {
      experiments.push({
        experiment_id: expId,
        status: 'detected',
        fields,
        confidence: 'MEDIUM',
        sources: [`${fileName}:text`],
      });
    }
  }

  return { experiments, materialsSeen, metricsSeen };
}

// ── EXPERIMENT MERGE (Test 7) ─────────────────────────────────────────────────

/**
 * Merge experiments with the same experiment_id from multiple sources.
 * Per spec Test 7: single EXP-NNN entry with sources from all docs.
 */
function mergeExperiments(allExperiments) {
  const byId = new Map();

  for (const exp of allExperiments) {
    const existing = byId.get(exp.experiment_id);
    if (!existing) {
      byId.set(exp.experiment_id, { ...exp, sources: [...exp.sources], fields: { ...exp.fields } });
      continue;
    }
    // Add new sources
    for (const src of exp.sources) {
      if (!existing.sources.includes(src)) existing.sources.push(src);
    }
    // Merge fields — existing wins on conflict (conflict detector handles disagreements)
    for (const [field, value] of Object.entries(exp.fields)) {
      if (existing.fields[field] == null) existing.fields[field] = value;
    }
    // Downgrade confidence if any source is lower
    const confidenceRank = { HIGH: 3, MEDIUM: 2, LOW: 1, USER_VERIFIED: 4 };
    if ((confidenceRank[exp.confidence] || 0) < (confidenceRank[existing.confidence] || 0)) {
      existing.confidence = exp.confidence;
    }
  }

  return [...byId.values()];
}

// ── CONFLICT DETECTION (Section 10.2) ────────────────────────────────────────

/**
 * Detect value conflicts. Runs on normalized values AFTER normalization.
 * Per Section 10.2: "30%" and 30 must compare equal → normalizeNum handles this.
 */
function detectConflicts(allExperiments) {
  // Group: key = "expId::field" → [{value, source}]
  const byKey = new Map();

  for (const exp of allExperiments) {
    for (const [field, value] of Object.entries(exp.fields || {})) {
      const key = `${exp.experiment_id}::${field}`;
      if (!byKey.has(key)) byKey.set(key, []);
      for (const src of exp.sources) {
        byKey.get(key).push({ value, source: src, experiment_id: exp.experiment_id });
      }
    }
  }

  const conflicts = [];
  for (const [key, entries] of byKey.entries()) {
    const [experimentId, field] = key.split('::');
    // Find distinct normalized values
    const distinctValues = [];
    const seen = new Set();
    for (const e of entries) {
      const k = String(e.value);
      if (!seen.has(k)) {
        seen.add(k);
        distinctValues.push({ value: e.value, source: e.source });
      }
    }
    if (distinctValues.length > 1) {
      conflicts.push({
        field,
        block: 'experiments',
        experiment_id: experimentId,
        values_found: distinctValues,
        resolution: 'USER_REQUIRED',
      });
    }
  }

  return conflicts;
}

// ── PROPOSAL STATE (Section 4 — DETERMINISTIC) ───────────────────────────────

/**
 * Compute proposal_state by rule only — never by LLM.
 * Algorithm per spec Section 4.
 */
export function computeProposalState(proposal) {
  const { project_type, materials, metrics, experiments, milestones, scan_status } = proposal;

  const hasProjectType  = !!(project_type?.value?.trim());
  const hasMaterials    = Array.isArray(materials)    && materials.length > 0;
  const hasMetrics      = Array.isArray(metrics)      && metrics.length > 0;
  const hasExperiments  = Array.isArray(experiments)  && experiments.length > 0;
  const hasMilestones   = Array.isArray(milestones)   && milestones.length > 0;

  // INSUFFICIENT: any core block is missing
  if (!hasProjectType || !hasMaterials || !hasMetrics || (!hasExperiments && !hasMilestones)) {
    return 'INSUFFICIENT';
  }

  // NEEDS_REVIEW: unresolved conflicts
  const conflicts = scan_status?.conflicts_detected || [];
  const hasUnresolved = conflicts.some(c => c.resolution === 'USER_REQUIRED');

  // NEEDS_REVIEW: ≥2 blocks with any MEDIUM or LOW confidence item
  const blocksWithLowConf = [materials, metrics, experiments, milestones].filter(
    block => Array.isArray(block) && block.some(i => i.confidence === 'MEDIUM' || i.confidence === 'LOW')
  ).length;

  if (hasUnresolved || blocksWithLowConf >= 2) return 'NEEDS_REVIEW';

  return 'READY';
}

// ── MILESTONE GENERATION ──────────────────────────────────────────────────────

function generateMilestones(projectTypeName) {
  const type = (projectTypeName || '').toLowerCase();
  if (type.includes('intumescent') || type.includes('fire')) {
    return [
      { name: 'Baseline Formulation',   description: 'Establish reference formulation with APP/PER/MEL baseline', confidence: 'HIGH' },
      { name: 'Expansion Optimization', description: 'Optimize expansion ratio for fire protection performance',    confidence: 'HIGH' },
      { name: 'Adhesion Enhancement',   description: 'Validate and improve adhesion to substrate',                  confidence: 'HIGH' },
      { name: 'Production Readiness',   description: 'Scale formulation for production batch',                      confidence: 'MEDIUM' },
    ];
  }
  return [
    { name: 'Baseline Formulation', description: 'Establish reference formulation',       confidence: 'HIGH' },
    { name: 'Optimization Phase',   description: 'Optimize key performance metrics',       confidence: 'HIGH' },
    { name: 'Validation',           description: 'Validate final formulation against spec', confidence: 'MEDIUM' },
    { name: 'Production Readiness', description: 'Prepare for production scale-up',        confidence: 'MEDIUM' },
  ];
}

// ── MAIN buildProposal ────────────────────────────────────────────────────────

/**
 * Build a full proposal object from a list of file descriptors.
 *
 * @param {string} projectId
 * @param {Array<{ id: string, name: string, buffer: Buffer, mimeType?: string }>} files
 * @returns {Promise<Object>} Full proposal per spec schema
 */
export async function buildProposal(projectId, files) {
  const year = new Date().getFullYear();
  const rand = String(Math.floor(Math.random() * 90000) + 10000);
  const proposalId = `PROP-${year}-${rand}`;

  const allExperiments  = [];
  const globalMaterials = new Set();
  const globalMetrics   = new Set();
  const allTexts        = [];
  const processedDocs   = [];
  const failedDocs      = [];

  for (const file of files) {
    const { name, buffer } = file;
    const ext = (name.split('.').pop() || '').toLowerCase();

    if (['xlsx', 'xls', 'csv'].includes(ext)) {
      try {
        const { experiments, materialsSeen, metricsSeen, rawText } = parseExcelBuffer(buffer, name);
        allExperiments.push(...experiments);
        materialsSeen.forEach(m => globalMaterials.add(m));
        metricsSeen.forEach(m => globalMetrics.add(m));
        allTexts.push(rawText);
        processedDocs.push(name);
      } catch (err) {
        console.warn(`[proposalEngine] Excel parse failed for ${name}:`, err.message);
        failedDocs.push({ name, reason: 'UNREADABLE' });
      }

    } else if (ext === 'pdf') {
      const { text, ocrRequired } = await extractPdfText(buffer);
      if (ocrRequired) {
        failedDocs.push({ name, reason: 'OCR_REQUIRED' });
        continue;
      }
      allTexts.push(text);
      processedDocs.push(name);

      // Irrelevant document check (Test 4): no lab-related keywords
      const hasLabContent = /EXP-?\d+|adhesion|expansion|viscosity|formul|APP\b|PER\b|MEL\b|intumescent|fire/i.test(text);
      if (!hasLabContent) continue; // processed but contributes nothing

      const { experiments, materialsSeen, metricsSeen } = parsePdfText(text, name);
      allExperiments.push(...experiments);
      materialsSeen.forEach(m => globalMaterials.add(m));
      metricsSeen.forEach(m => globalMetrics.add(m));

    } else if (['txt', 'md', 'docx'].includes(ext)) {
      const text = buffer.toString('utf-8');
      allTexts.push(text);
      processedDocs.push(name);
      const { experiments, materialsSeen, metricsSeen } = parsePdfText(text, name);
      allExperiments.push(...experiments);
      materialsSeen.forEach(m => globalMaterials.add(m));
      metricsSeen.forEach(m => globalMetrics.add(m));

    } else {
      failedDocs.push({ name, reason: 'UNSUPPORTED_FORMAT' });
    }
  }

  // Detect conflicts on pre-merge experiments (same field, different source values)
  const conflicts = detectConflicts(allExperiments);

  // Merge duplicate experiments (Test 7)
  const mergedExperiments = mergeExperiments(allExperiments);

  // Project type
  const projectType = detectProjectType(allTexts);
  projectType.sources = processedDocs.slice(0, 3);

  // Materials list (canonical names, deduplicated)
  const materials = [...globalMaterials].map(name => ({
    name,
    confidence: 'HIGH',
    sources: processedDocs.filter(d => /\.(xlsx|xls|csv)$/i.test(d)),
  }));

  // Metrics list
  const metrics = [...globalMetrics].map(name => ({
    name,
    confidence: 'HIGH',
    sources: processedDocs,
  }));

  // Milestones
  const milestones = generateMilestones(projectType.value);

  const scanStatus = {
    documents_processed: processedDocs.length,
    documents_failed:    failedDocs.length,
    failed_files:        failedDocs,
    conflicts_detected:  conflicts,
  };

  const proposal = {
    proposal_id:    proposalId,
    project_id:     projectId,
    generated_at:   new Date().toISOString(),
    scan_status:    scanStatus,
    proposal_state: 'INSUFFICIENT', // will be overwritten
    project_type:   projectType,
    materials,
    metrics,
    experiments:    mergedExperiments,
    milestones,
    project_goal:   { value: null, status: 'NOT_DEFINED' },
  };

  proposal.proposal_state = computeProposalState(proposal);

  return proposal;
}

// ── PATCH (Section 7 + 10.4) ──────────────────────────────────────────────────

/**
 * Apply a PATCH operation and return the full recomputed proposal.
 * Per spec: every PATCH returns the complete proposal object.
 */
export function applyPatch(proposal, { block, action, payload }) {
  if (!['project_type', 'materials', 'metrics', 'experiments', 'milestones'].includes(block)) {
    throw new Error(`Unknown block: ${block}`);
  }

  const p = JSON.parse(JSON.stringify(proposal)); // deep clone

  if (block === 'project_type') {
    if (action === 'edit') {
      p.project_type = { ...p.project_type, ...payload, confidence: payload.confidence || 'USER_VERIFIED' };
    }
  } else {
    const arr = Array.isArray(p[block]) ? p[block] : [];
    if (action === 'add') {
      arr.push({ ...payload, confidence: payload.confidence || 'USER_VERIFIED' });
      p[block] = arr;
    } else if (action === 'remove') {
      const removeId = payload.name || payload.experiment_id || payload.id;
      p[block] = arr.filter(item => (item.name || item.experiment_id || item.id) !== removeId);
    } else if (action === 'edit') {
      const editId = payload.name || payload.experiment_id || payload.id;
      p[block] = arr.map(item => {
        if ((item.name || item.experiment_id || item.id) === editId) {
          return { ...item, ...payload, confidence: payload.confidence || 'USER_VERIFIED' };
        }
        return item;
      });
    }
  }

  p.proposal_state = computeProposalState(p);
  p.updated_at = new Date().toISOString();
  return p;
}

// ── CONFLICT RESOLUTION (Section 6) ──────────────────────────────────────────

/**
 * Resolve a conflict and return the full recomputed proposal.
 */
export function resolveProposalConflict(proposal, { field, experiment_id, chosen_value, source_or_custom }) {
  const p = JSON.parse(JSON.stringify(proposal));

  // Mark conflict resolved
  const conflicts = (p.scan_status?.conflicts_detected || []).map(c => {
    if (c.field === field && (!experiment_id || c.experiment_id === experiment_id)) {
      return { ...c, resolution: 'RESOLVED', chosen_value: normalizeNum(chosen_value) ?? chosen_value };
    }
    return c;
  });
  p.scan_status = { ...p.scan_status, conflicts_detected: conflicts };

  // Update the experiment field with the chosen value
  if (experiment_id) {
    const num = normalizeNum(chosen_value);
    p.experiments = (p.experiments || []).map(exp => {
      if (exp.experiment_id === experiment_id) {
        return {
          ...exp,
          fields:     { ...exp.fields, [field]: num ?? chosen_value },
          confidence: 'USER_VERIFIED',
        };
      }
      return exp;
    });
  }

  p.proposal_state = computeProposalState(p);
  p.updated_at = new Date().toISOString();
  return p;
}

// ── APPROVE VALIDATION (Section 5) ───────────────────────────────────────────

/**
 * Validate pre-conditions for Approve.
 * Returns { valid: true } or { valid: false, reason: string }.
 */
export function validateApproveConditions(proposal) {
  if (!proposal.project_type?.value?.trim()) {
    return { valid: false, reason: 'project_type.value is empty' };
  }
  if (!proposal.materials?.length) {
    return { valid: false, reason: 'materials list is empty' };
  }
  if (!proposal.metrics?.length) {
    return { valid: false, reason: 'metrics list is empty' };
  }
  if (!(proposal.experiments?.length || proposal.milestones?.length)) {
    return { valid: false, reason: 'at least one experiment or milestone is required' };
  }
  const unresolved = (proposal.scan_status?.conflicts_detected || []).filter(c => c.resolution === 'USER_REQUIRED');
  if (unresolved.length) {
    return { valid: false, reason: `${unresolved.length} conflict(s) require resolution before approve` };
  }
  if (proposal.proposal_state !== 'READY') {
    return { valid: false, reason: `proposal_state is ${proposal.proposal_state}, must be READY` };
  }
  return { valid: true };
}
