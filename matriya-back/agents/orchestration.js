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
        sufficient_data: parsed.insufficient_data === false,
        variables_distinguishable: parsed.variables_distinguishable !== false,
        extrapolation_intent: parsed.extrapolation_intent === true,
        data_in_domain: parsed.data_in_domain !== false
      };
    } catch (_) { /* ignore parse errors */ }
  }

  // Extract plain-language part (after JSON block)
  const plainText = text.replace(/```json[\s\S]*?```/gi, '').replace(/\{[\s\S]*?"decision"[\s\S]*?\}/, '').trim();
  const answer = plainText || text;

    return { answer, signals, llmDecision, missingData, llmConfidence };
}

// ─── Data completeness scorer ────────────────────────────────────────────────

/**
 * Deterministic confidence score based on data completeness.
 * Returns 0-100 reflecting how much usable research data is in the input.
 *
 * Tiers:
 *   70-90 — numeric measurements + domain terms + result language
 *   40-60 — partial: domain terms or results but not both
 *   10-30 — minimal: plain text, no domain signals
 */
function computeDataCompleteness(input) {
  const text = input || '';
  let score = 0;

  // ── Numeric data signals (measurements, concentrations, ranges) ──
  const numericMatches = (text.match(/\b\d+(\.\d+)?\s*(%|mg|g|kg|ml|l|mm|nm|µm|°C|°F|K|MPa|GPa|ppm|mol|bar|Hz|rpm|wt|vol|cP|mPa|Pa·s)\b/gi) || []).length;
  if (numericMatches >= 3) score += 35;
  else if (numericMatches >= 1) score += 20;

  // ── Domain-specific terminology ──
  const domainHits = (text.match(/\b(formul|corrosion|coating|viscosit|polymer|alloy|substrate|inhibit|passiv|adhesion|thermal|nano|crystal|react|bond|intumesc|epoxy|pigment|binder|solvent|zinc|oxide|particle|surface|concentration|batch|sample|specimen|substrate|primer|topcoat|basecoat)\b/gi) || []).length;
  if (domainHits >= 4) score += 25;
  else if (domainHits >= 2) score += 15;
  else if (domainHits >= 1) score += 8;

  // ── Result / outcome language ──
  const resultHits = (text.match(/\b(result|outcome|measured|tested|observed|found|showed|demonstrated|achieved|obtained|confirmed|verified|experiment|trial|run|batch|sample\s*\d|test\s*\d|cycle|pass|fail|complies|meets)\b/gi) || []).length;
  if (resultHits >= 3) score += 20;
  else if (resultHits >= 1) score += 12;

  // ── Structured experiment identifiers ──
  if (/\b(experiment\s*#?\d|batch\s*#?\d|sample\s*#?\d|run\s*#?\d|trial\s*#?\d|EXP-\w+|B-\d|S-\d)/i.test(text)) score += 10;

  // ── Multiple variables / comparison ──
  if (/\b(vs\.?|versus|compared|control|baseline|reference|delta|difference|increase|decrease|ratio)\b/i.test(text)) score += 5;

  // ── Penalise very short inputs (< 20 words) ──
  const wordCount = text.trim().split(/\s+/).length;
  if (wordCount < 5)  score = Math.min(score, 10);
  else if (wordCount < 10) score = Math.min(score, 25);
  else if (wordCount < 20) score = Math.min(score, 45);

  return Math.min(Math.max(Math.round(score), 0), 100);
}

// ─── FSCTM kernel gate ────────────────────────────────────────────────────────

/**
 * Apply kernelV16 deterministic gates as a post-LLM override.
 * Returns the enforced decision status and reason if kernel trips.
 */
function applyKernelGate(signals = {}, llmDecision = null) {
  // FailSafe gate
  const failSafe = evaluateFailSafe(signals);
  if (!failSafe.ok && !failSafe.skipped) {
    return {
      tripped: true,
      status: 'INSUFFICIENT_DATA',
      action: 'STOP',
      reason: failSafe.message_en || failSafe.message_he || 'Insufficient data'
    };
  }

  // Extrapolation gate
  const extrap = checkExtrapolationRule(signals);
  if (!extrap.ok && !extrap.skipped) {
    return {
      tripped: true,
      status: 'INCONCLUSIVE',
      action: 'ITERATE',
      reason: extrap.message_en || 'No extrapolation beyond observed data'
    };
  }

  // Methodology flags
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

  // Confidence: LLM-reported value takes priority (it evaluated semantic completeness);
  // fall back to deterministic completeness score; STOP always caps at completenessScore.
  let confidence;
  if (llmConfidence !== null) {
    // Blend: 60% LLM + 40% deterministic to prevent hallucinated high confidence
    confidence = Math.round(llmConfidence * 0.6 + completenessScore * 0.4);
  } else {
    confidence = completenessScore;
  }
  // Kernel override: if kernel tripped, cap confidence at the completeness score
  if (kernel.tripped) confidence = Math.min(confidence, completenessScore);
  // STOP should never report > 40% (there is clearly something missing)
  if (action_required === 'STOP') confidence = Math.min(confidence, 40);

  const decision = {
    status: decision_status,
    action_required,
    reason: decisionReason,
    confidence,              // 0-100 real score
    missing_data: missingData,
    kernel_tripped: kernel.tripped,
    elapsed_ms: Date.now() - startedAt
  };

  const expMatch = answer.match(/experiment[:\s]+(.+)/i);
  const experiment = expMatch ? { suggestion: expMatch[1].trim(), status: 'PROPOSED' } : null;

  logger.info(`[pipeline] done ${decision.elapsed_ms}ms action=${action_required} kernel=${kernel.tripped} rag=${ragUsed}`);
  return { consilium, gate, score, decision, experiment };
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
