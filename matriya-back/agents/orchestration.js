/**
 * agents/orchestration.js
 *
 * MATRIYA Pipeline Orchestration
 *
 * runPipeline(input) → { consilium, gate, score, decision, experiment }
 *
 * Flow:
 *   1. gate       — domain + eligibility check
 *   2. consilium  — RAG document retrieval (ragService.generateAnswer)
 *                   falls back to direct OpenAI if no documents uploaded
 *   3. kernel     — FSCTM kernel signals extracted from LLM output
 *                   evaluateBreakdown + evaluateFailSafe applied as post-LLM gate
 *   4. score      — Emergence Score (Eₛ)
 *   5. decision   — GO / STOP / ITERATE (kernel-enforced, not just LLM keyword)
 */

import axios from 'axios';
import logger from '../logger.js';
import settings from '../config.js';
import { evaluate as evaluateCreativity } from '../services/creativityOrchestrator.js';
import RAGService from '../ragService.js';
import {
  evaluateBreakdown,
  evaluateFailSafe,
  checkExtrapolationRule,
  checkMethodologyFlags
} from '../kernelV16.js';

// ─── Lazy RAG singleton ───────────────────────────────────────────────────────

let _ragService = null;
function getRagService() {
  if (!_ragService) _ragService = new RAGService();
  return _ragService;
}

// ─── Domain gate ──────────────────────────────────────────────────────────────

function checkDomainGate(input) {
  const domainTerms = /\b(formul|corrosion|coating|experiment|viscosit|polymer|alloy|substrate|inhibit|passiv|adhesion|thermal|nano|crystal|react|bond|intumesc|material|lab|test|result|ציפוי|נוסחה|ניסוי|חומר|תוצאות|מעבדה|formula|formulation|sample|batch|measurement|concentration|temperature|pressure|particle|surface|oxide|zinc|epoxy|pigment|binder|solvent)/i;
  const passed = domainTerms.test(input);
  return {
    passed,
    stage: passed ? 'DOMAIN_PASS' : 'DOMAIN_WARN',
    reason: passed ? 'Input matches MATRIYA domain' : 'Input may be outside core domain'
  };
}

// ─── RAG call (primary path) ──────────────────────────────────────────────────

async function callRag(input) {
  try {
    const rag = getRagService();
    const result = await rag.generateAnswer(input, 5, null, true);
    if (result?.error && result?.generation_blocked) {
      logger.warn(`[pipeline] RAG generation blocked: ${result.error}`);
      return null;
    }
    const answer = (result?.answer || '').trim();
    if (!answer) {
      logger.warn('[pipeline] RAG returned empty answer — falling back to direct LLM');
      return null;
    }
    logger.info(`[pipeline] RAG answer (${answer.length} chars)`);
    return answer;
  } catch (e) {
    logger.warn(`[pipeline] RAG failed — fallback to direct LLM: ${e.message}`);
    return null;
  }
}

// ─── Direct OpenAI (fallback) ─────────────────────────────────────────────────

async function callLlmDirect(input) {
  const apiKey = (settings.OPENAI_API_KEY || process.env.OPENAI_API_KEY || '').trim();
  const model = settings.OPENAI_RAG_MODEL || process.env.OPENAI_RAG_MODEL || 'gpt-4o-mini';
  const base = (settings.OPENAI_API_BASE || process.env.OPENAI_API_BASE || 'https://api.openai.com/v1').replace(/\/$/, '');

  if (!apiKey) {
    return {
      answer: 'MATRIYA: מפתח API לא מוגדר. אנא פנה למנהל המערכת.',
      signals: {}
    };
  }

  // EXECUTION ENGINE prompt — NOT a chatbot.
  // Must return a structured JSON block for kernel gate enforcement.
  const systemPrompt = `You are MATRIYA — a deterministic research decision engine for materials science.

Your ONLY job: evaluate the input as lab/research data and return a structured decision.

RULES (never violate):
- Do NOT give advice, tutorials, or setup instructions
- Do NOT suggest how to register numbers or use software
- Do NOT respond as a chatbot or general assistant
- If input is NOT lab/research data → return STOP with reason "Not lab data"
- External data is CONTEXT only, never evidence
- trust_grade is limited to C or D — no conclusions from external sources alone

RESPONSE FORMAT (always output this exact JSON block, then a plain-language summary):
\`\`\`json
{
  "decision": "GO" | "STOP" | "ITERATE",
  "confidence": 0-100,
  "reason": "one concise sentence",
  "missing_data": ["list", "of", "specific", "missing", "items"] | [],
  "insufficient_data": true | false,
  "variables_distinguishable": true | false,
  "extrapolation_intent": true | false,
  "data_in_domain": true | false
}
\`\`\`

CRITICAL for STOP decisions: missing_data MUST list exactly what the user needs to provide.
Examples: ["experiment results", "formulation parameters", "temperature range", "viscosity measurements"]
If input is not lab data: missing_data: ["experiment results", "formulation parameters"]

Answer in the same language as the user (Hebrew if Hebrew, English if English).`;

  const resp = await axios.post(
    `${base}/chat/completions`,
    {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: input }
      ],
      max_tokens: 500,
      temperature: 0.1
    },
    {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: 25000
    }
  );

  const text = (resp.data?.choices?.[0]?.message?.content || '').trim();

  // Extract JSON block from response
  const jsonMatch = text.match(/```json\s*([\s\S]*?)```/i) || text.match(/\{[\s\S]*?"decision"[\s\S]*?\}/);
  let signals = {};
  let llmDecision = null;
  let missingData = [];
  let llmConfidence = null; // 0-100 from LLM, null if not provided
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
      llmDecision = parsed.decision;
      missingData = Array.isArray(parsed.missing_data) ? parsed.missing_data.filter(Boolean) : [];
      if (typeof parsed.confidence === 'number' && parsed.confidence >= 0 && parsed.confidence <= 100) {
        llmConfidence = Math.round(parsed.confidence);
      }
      signals = {
        // sufficient_data is only false when LLM says GO but marks data insufficient.
        // For ITERATE, insufficient_data:true is expected and correct — don't treat as failure.
        sufficient_data: parsed.decision !== 'GO'
          ? true                                  // ITERATE/STOP: not a kernel concern
          : parsed.insufficient_data === false,   // GO only: must have sufficient data
        variables_distinguishable: parsed.variables_distinguishable !== false,
        extrapolation_intent: parsed.extrapolation_intent === true,
        data_in_domain: parsed.data_in_domain !== false
      };
    } catch (_) { /* ignore parse errors */ }
  }

  // Extract plain-language part — strip JSON block(s) from the response
  const plainText = text
    .replace(/```json[\s\S]*?```/gi, '')   // remove fenced JSON
    .replace(/```[\s\S]*?```/gi, '')        // remove any other fenced blocks
    .replace(/^\s*\{[\s\S]*?\}\s*$/m, '')   // remove bare JSON object if it's the whole response
    .trim();

  // If LLM returned only JSON (no plain text), build a clean reason from parsed fields
  let answer;
  if (plainText) {
    answer = plainText;
  } else if (llmDecision) {
    // Build a concise reason from the parsed JSON so no raw JSON leaks into WhatsApp
    const decisionLabels = { GO: 'Evidence is sufficient to proceed.', ITERATE: 'Partial data — additional evidence required.', STOP: 'Insufficient data to evaluate.' };
    answer = decisionLabels[llmDecision] || 'MATRIYA evaluation complete.';
  } else {
    answer = text; // last resort — will be cleaned later
  }

  return { answer, signals, llmDecision, missingData, llmConfidence };
}

// ─── Data completeness scorer ────────────────────────────────────────────────

/**
 * Deterministic evidence-quality score (0–100).
 *
 * Scoring factors (David's spec):
 *   A. Required fields / numeric measurements present
 *   B. Experiment/run identifiers present
 *   C. Domain terminology depth
 *   D. Result/outcome language
 *   E. Baseline or comparison data
 *   F. Number of usable evidence sentences
 *
 * Ceilings (scale by input length — more words = higher max):
 *   < 5 words  → max 20
 *   5–14 words → max 45
 *   15–29 words→ max 70
 *   30+ words  → max 100
 */
function computeDataCompleteness(input) {
  const text = (input || '').trim();
  if (!text) return 0;

  let score = 0;

  // A. Numeric measurements with scientific units (strongest evidence signal)
  const numericHits = (text.match(
    /\b\d+(\.\d+)?\s*(%|mg|g|kg|ml|l|mm|nm|µm|°C|°F|K|MPa|GPa|ppm|mol|bar|Hz|rpm|wt\.?%|vol\.?%|cP|mPa|Pa[·\s]?s|N\/m|J\/g)\b/gi
  ) || []).length;
  if      (numericHits >= 5) score += 40;
  else if (numericHits >= 3) score += 30;
  else if (numericHits >= 1) score += 18;

  // B. Experiment / batch / run identifiers
  const hasExpId = /\b(EXP[-_]?\w+|B[-_]\d{1,4}|S[-_]\d{1,4}|batch\s*#?\d|sample\s*#?\d|run\s*#?\d|trial\s*#?\d|experiment\s*#?\d)\b/i.test(text);
  if (hasExpId) score += 12;

  // C. Domain-specific terminology depth
  const domainHits = (text.match(
    /\b(formul|corrosion|coating|viscosit|polymer|alloy|substrate|inhibit|passiv|adhesion|thermal|nano|crystal|react|bond|intumesc|epoxy|pigment|binder|solvent|zinc|oxide|particle|surface|concentration|primer|topcoat|basecoat|resin|filler|thickener|catalyst|hardener|cross.?link)\b/gi
  ) || []).length;
  if      (domainHits >= 5) score += 20;
  else if (domainHits >= 3) score += 14;
  else if (domainHits >= 1) score += 7;

  // D. Result / outcome evidence language
  const resultHits = (text.match(
    /\b(result|outcome|measured|tested|observed|found|showed|demonstrated|achieved|obtained|confirmed|verified|passed|failed|complies|meets|evaluated|analysed|quantified)\b/gi
  ) || []).length;
  if      (resultHits >= 3) score += 15;
  else if (resultHits >= 1) score += 8;

  // E. Baseline / comparison data
  const hasBaseline = /\b(vs\.?|versus|compared|control|baseline|reference|delta|change|difference|ratio|increase|decrease|improvement|regression)\b/i.test(text);
  if (hasBaseline) score += 8;

  // F. Multiple evidence sentences (sentences that contain a number)
  const evidenceSentences = (text.match(/[^.!?\n]*\d+[^.!?\n]*/g) || []).length;
  if      (evidenceSentences >= 4) score += 5;
  else if (evidenceSentences >= 2) score += 3;

  // Apply ceiling based on input length
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const ceiling = wordCount < 5  ? 20
                : wordCount < 15 ? 45
                : wordCount < 30 ? 70
                : 100;

  return Math.min(Math.max(Math.round(score), 0), ceiling);
}

// ─── FSCTM kernel gate ────────────────────────────────────────────────────────

/**
 * Apply kernelV16 deterministic gates as a post-LLM safety check.
 *
 * Design rule (prevents regression):
 *   The kernel is a DOWNGRADE-ONLY safety net for GO decisions.
 *   - If LLM says ITERATE → trust it; partial data is the correct reason to iterate.
 *   - If LLM says STOP   → trust it; nothing to add.
 *   - If LLM says GO     → validate signals; if bad → downgrade to ITERATE or STOP.
 *   - If no LLM decision → apply as a general sanity check (RAG path, etc.).
 *
 * Root cause of the ITERATE→STOP regression:
 *   LLM returns insufficient_data:true for partial data (correct — it's not enough for GO)
 *   but that does NOT mean STOP. ITERATE is the right call for partial data.
 *   Kernel was treating insufficient_data:true as a STOP signal, which is wrong.
 */
function applyKernelGate(signals = {}, llmDecision = null) {
  // ITERATE and STOP from the LLM are correct as-is — never override them.
  if (llmDecision === 'ITERATE' || llmDecision === 'STOP') {
    return { tripped: false };
  }

  // For GO (or unknown), validate that data actually supports a positive conclusion.
  // FailSafe gate — only trips if data is genuinely insufficient (not just partial).
  const failSafe = evaluateFailSafe(signals);
  if (!failSafe.ok && !failSafe.skipped) {
    // Downgrade GO → ITERATE (not STOP) because partial data = needs more, not rejected.
    return {
      tripped: true,
      status: 'INCONCLUSIVE',
      action: 'ITERATE',
      reason: failSafe.message_en || 'Data insufficient for a GO — iterate with more evidence'
    };
  }

  // Extrapolation gate — only relevant when claiming GO beyond observed data range.
  const extrap = checkExtrapolationRule(signals);
  if (!extrap.ok && !extrap.skipped) {
    return {
      tripped: true,
      status: 'INCONCLUSIVE',
      action: 'ITERATE',
      reason: extrap.message_en || 'No extrapolation beyond observed data'
    };
  }

  // Methodology flags — repeated solutions or patches without hypothesis.
  const meth = checkMethodologyFlags(signals);
  if (meth.trip) {
    return {
      tripped: true,
      status: 'INCONCLUSIVE',
      action: 'ITERATE',
      reason: `Methodology flag: ${meth.reasons.join(', ')}`
    };
  }

  return { tripped: false };
}

// ─── Main pipeline ────────────────────────────────────────────────────────────

/**
 * Run the full MATRIYA pipeline for a given input string.
 *
 * @param {string} input
 * @returns {{ consilium, gate, score, decision, experiment }}
 */
export async function runPipeline(input) {
  const startedAt = Date.now();
  logger.info(`[pipeline] start: "${input.slice(0, 80)}"`);

  // 1. Domain gate
  const gate = checkDomainGate(input);

  // 2. Get answer — RAG first, then direct LLM
  let answer = '';
  let signals = {};
  let llmDecision = null;
  let missingData = [];
  let llmConfidence = null;
  let ragUsed = false;

  const ragAnswer = await callRag(input);
  if (ragAnswer) {
    answer = ragAnswer;
    ragUsed = true;
    signals = { sufficient_data: true, variables_distinguishable: true };
  } else {
    try {
      const llmResult = await callLlmDirect(input);
      answer = llmResult.answer || '';
      signals = llmResult.signals || {};
      llmDecision = llmResult.llmDecision || null;
      missingData = llmResult.missingData || [];
      llmConfidence = llmResult.llmConfidence ?? null;
    } catch (e) {
      logger.error(`[pipeline] LLM failed: ${e.message}`);
      answer = `MATRIYA: שגיאה בעיבוד. ${e.message}`;
      missingData = ['experiment results', 'formulation parameters'];
    }
  }

  // Compute deterministic data-completeness score (0-100)
  const completenessScore = computeDataCompleteness(input);

  const cleanAnswer = answer.replace(/\bdecision\s*=\s*(GO|STOP|ITERATE)\b/gi, '').trim() || answer;

  // 3. FSCTM kernel gate — enforces decision regardless of what LLM said
  const kernel = applyKernelGate(signals, llmDecision);

  let decision_status;
  let action_required;
  let decisionReason = cleanAnswer;

  if (kernel.tripped) {
    decision_status = kernel.status;
    action_required = kernel.action;
    decisionReason = `[KERNEL GATE] ${kernel.reason}\n\n${cleanAnswer}`;
    logger.warn(`[pipeline] kernel tripped → ${action_required}: ${kernel.reason}`);
  } else {
    // Use LLM decision if available, else classify from text
    const statusMap = { GO: 'VALID_CONCLUSION', STOP: 'INSUFFICIENT_DATA', ITERATE: 'INCONCLUSIVE' };
    decision_status = statusMap[llmDecision] || classifyFromText(answer);
    const actionMap = {
      VALID_CONCLUSION: 'GO', INCONCLUSIVE: 'ITERATE', NO_CHANGE: 'ITERATE',
      INSUFFICIENT_DATA: 'STOP', STRUCTURAL_INCOMPLETE: 'STOP', INVALID_EXPERIMENT: 'STOP'
    };
    action_required = actionMap[decision_status] ?? 'STOP';
  }

  // 4. Emergence Score
  let scoreResult = { score: 0, regime: 'UNKNOWN', components: {} };
  if (cleanAnswer) {
    try { scoreResult = evaluateCreativity(cleanAnswer); }
    catch (e) { logger.warn(`[pipeline] evaluateCreativity: ${e.message}`); }
  }

  const consilium = {
    input, sources: [], rag_used: ragUsed,
    context: ragUsed ? 'RAG retrieval' : 'Direct LLM',
    timestamp: new Date().toISOString()
  };

  const score = {
    emergence_score: scoreResult.score ?? 0,
    regime: scoreResult.regime ?? 'UNKNOWN',
    components: scoreResult.components ?? {}
  };

  // For STOP: ensure missing_data is populated with defaults if LLM didn't provide it
  if (action_required === 'STOP' && missingData.length === 0) {
    missingData = ['experiment results', 'formulation parameters'];
  }

  // ── Confidence = evidence quality, independent of decision type ──────────────
  //
  // Rule: completeness score is the deterministic baseline.
  //       LLM confidence can only RAISE it (prevents LLM returning 0 and collapsing score).
  //       STOP hard-cap at 35% (something is clearly missing).
  //       ITERATE and GO: no artificial floor/ceiling — score reflects actual evidence.
  //
  let confidence = completenessScore; // deterministic baseline (0-100)

  if (typeof llmConfidence === 'number' && llmConfidence > confidence) {
    // LLM saw more context (e.g. from RAG docs) — allow it to raise confidence
    // but never more than 25 points above the deterministic score
    confidence = Math.min(llmConfidence, confidence + 25);
  }

  // ── Rule 6 — deterministic evidence overrides LLM STOP ───────────────────────
  //
  // The deterministic scorer uses regex to find real numeric/domain evidence.
  // If it finds any (≥10 pts), the data is not absent — it's incomplete.
  // Incomplete data → ITERATE (more data needed), not STOP (no data at all).
  // This prevents the LLM from returning STOP when actual lab values are present.
  //
  // Applied BEFORE the STOP cap so confidence is not already clamped when rule fires.
  if (completenessScore >= 10 && action_required === 'STOP') {
    action_required = 'ITERATE';
    decision_status = 'INCONCLUSIVE';
    logger.info(`[pipeline] Rule 6: deterministic evidence (${completenessScore}%) → LLM STOP overridden to ITERATE`);
  }

  // STOP always capped at 35% — if there's enough evidence, decision wouldn't be STOP
  if (action_required === 'STOP') confidence = Math.min(confidence, 35);

  confidence = Math.min(Math.max(Math.round(confidence), 0), 100);

  // ── Hard consistency enforcement (backend rules, not prompt behaviour) ────────
  //
  // Threshold mapping:   STOP = 0%   |   ITERATE = 1–69%   |   GO = 70–100%
  //
  // Rule 1: confidence = 0 → decision MUST be STOP (no basis for any action)
  // Rule 2: ITERATE → confidence MUST be > 0 (partial basis required)
  // Rule 3: Response contains "no supporting information" → confidence = 0 → STOP
  // Rule 4: GO requires confidence ≥ 70%; below that, downgrade to ITERATE
  // Rule 5: confidence ≥ 70% with STOP is contradictory → upgrade to ITERATE
  // Rule 6: deterministic evidence ≥ 10% → LLM STOP overridden to ITERATE (above)

  // Rule 3 — detect "no supporting information" language in answer
  const noSupportPattern = /no supporting information|no evidence|no data available|insufficient information|cannot be determined/i;
  if (noSupportPattern.test(decisionReason)) {
    confidence = 0;
  }

  // Rule 1 + 2 — zero confidence forces STOP
  if (confidence === 0) {
    action_required = 'STOP';
    decision_status = 'INSUFFICIENT_DATA';
    if (missingData.length === 0) {
      missingData = ['experiment results', 'formulation parameters'];
    }
  }

  // Rule 4 — GO requires ≥ 70%; below that, downgrade to ITERATE
  if (action_required === 'GO' && confidence < 70) {
    action_required = 'ITERATE';
    decision_status = 'INCONCLUSIVE';
    logger.info(`[pipeline] GO downgraded to ITERATE (confidence ${confidence}% < 70%)`);
  }

  // Rule 5 — STOP with high confidence is contradictory → ITERATE
  if (action_required === 'STOP' && confidence >= 70) {
    action_required = 'ITERATE';
    decision_status = 'INCONCLUSIVE';
    logger.info(`[pipeline] STOP upgraded to ITERATE (confidence ${confidence}% ≥ 70%)`);
  }

  // STOP: re-apply 35% cap (may have been raised by LLM before consistency check)
  if (action_required === 'STOP') confidence = Math.min(confidence, 35);

  logger.info(`[pipeline] FINAL confidence=${confidence}% action=${action_required} (completeness=${completenessScore} llmConf=${llmConfidence})`);

  const decision = {
    status: decision_status,
    action_required,
    reason: decisionReason,
    confidence,
    missing_data: missingData,
    kernel_tripped: kernel.tripped,
    elapsed_ms: Date.now() - startedAt
  };

  const expMatch = answer.match(/experiment[:\s]+(.+)/i);
  const experiment = expMatch ? { suggestion: expMatch[1].trim(), status: 'PROPOSED' } : null;

  // ── N-stage candidates (generated when decision = ITERATE) ───────────────────
  // Candidates are the 3 most actionable next-step suggestions extracted from
  // the LLM answer.  If the LLM didn't produce structured candidates, we
  // synthesise them from the missing_data list and domain context so the
  // outbound Rachel message always contains 3 concrete next steps.
  const candidates = action_required === 'ITERATE'
    ? generateCandidates(input, answer, missingData)
    : [];

  logger.info(`[pipeline] done ${decision.elapsed_ms}ms action=${action_required} kernel=${kernel.tripped} rag=${ragUsed} candidates=${candidates.length}`);
  return { consilium, gate, score, decision, experiment, candidates };
}

// ─── N-stage candidate generator ──────────────────────────────────────────────

/**
 * Extract or synthesise 3 ITERATE candidates from the pipeline answer.
 *
 * Priority order:
 *   1. Numbered / bulleted items in the LLM answer (1. / 2. / • / – lines)
 *   2. Sentences that mention "candidate", "suggest", "recommend", "next step"
 *   3. Fallback: synthesise from missing_data + domain-aware defaults
 *
 * Always returns exactly 3 candidate strings.
 *
 * @param {string} input       — original user message
 * @param {string} answer      — LLM / RAG answer
 * @param {string[]} missing   — missing_data array from decision
 * @returns {string[]}
 */
function generateCandidates(input, answer, missing = []) {
  const extracted = [];

  // 1. Numbered / bulleted list items
  const listMatches = (answer || '').match(/(?:^|\n)\s*(?:\d+[.)]\s*|[•\-–*]\s*)([^\n]{10,})/g) || [];
  for (const m of listMatches) {
    const clean = m.replace(/^\s*[\d•\-–*.)\s]+/, '').trim();
    if (clean.length > 8) extracted.push(clean);
    if (extracted.length >= 3) break;
  }

  // 2. Sentences with key iteration language
  if (extracted.length < 3) {
    const sentences = (answer || '').split(/[.!?\n]/).map(s => s.trim()).filter(Boolean);
    for (const s of sentences) {
      if (/candidate|suggest|recommend|next step|iteration|additional|improve|refine|measure|test|run|provide/i.test(s)
          && s.length > 15 && !extracted.includes(s)) {
        extracted.push(s);
        if (extracted.length >= 3) break;
      }
    }
  }

  // 3. Synthesise from missing_data + generic domain fallbacks
  if (extracted.length < 3) {
    const fallbacks = (missing.length > 0 ? missing : ['experiment results', 'formulation parameters', 'baseline comparison'])
      .map(m => `Provide ${m} to advance the decision`);
    for (const f of fallbacks) {
      if (!extracted.includes(f)) {
        extracted.push(f);
        if (extracted.length >= 3) break;
      }
    }
  }

  // Pad to 3 with domain-aware defaults if still short
  const defaults = [
    'Run additional measurements with full unit specification',
    'Provide baseline or control comparison data',
    'Add experiment identifier and repeat count'
  ];
  let di = 0;
  while (extracted.length < 3 && di < defaults.length) {
    extracted.push(defaults[di++]);
  }

  return extracted.slice(0, 3);
}

function classifyFromText(text) {
  if (/\bGO\b/i.test(text) && !/STOP|ITERATE/i.test(text)) return 'VALID_CONCLUSION';
  if (/\bSTOP\b/i.test(text)) return 'INSUFFICIENT_DATA';
  if (/\bITERATE\b/i.test(text)) return 'INCONCLUSIVE';
  if (/\b(proven|confirmed|result|data|tested|verified)\b/i.test(text)) return 'VALID_CONCLUSION';
  return 'INCONCLUSIVE';
}

export function createActionPackage(pipelineResult, recipientPhone) {
  return {
    to: recipientPhone,
    message: pipelineResult.decision?.reason || 'MATRIYA: עיבוד הושלם.',
    expectedResponseType: pipelineResult.decision?.action_required ?? 'STOP',
    pipeline_result: pipelineResult,
    created_at: new Date().toISOString()
  };
}
