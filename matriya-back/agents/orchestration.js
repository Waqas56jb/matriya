/**
 * agents/orchestration.js
 *
 * MATRIYA Pipeline Orchestration
 *
 * runPipeline(input) → { consilium, gate, score, decision, experiment }
 *
 * Flow:
 *   1. consilium  — RAG document retrieval (ragService.generateAnswer)
 *   2. gate       — domain + eligibility check
 *   3. llm        — OpenAI with RAG context (or fallback direct call)
 *   4. score      — Emergence Score (Eₛ)
 *   5. decision   — GO / STOP / ITERATE + reason (= WhatsApp reply)
 *   6. experiment — suggested follow-up
 */

import axios from 'axios';
import logger from '../logger.js';
import settings from '../config.js';
import { evaluate as evaluateCreativity } from '../services/creativityOrchestrator.js';
import RAGService from '../ragService.js';

// ─── Lazy RAG singleton ───────────────────────────────────────────────────────

let _ragService = null;
function getRagService() {
  if (!_ragService) _ragService = new RAGService();
  return _ragService;
}

// ─── Domain gate ──────────────────────────────────────────────────────────────

function checkDomainGate(input) {
  const domainTerms = /\b(formul|corrosion|coating|experiment|viscosit|polymer|alloy|substrate|inhibit|passiv|adhesion|thermal|nano|crystal|react|bond|intumesc|material|lab|test|result|ציפוי|נוסחה|ניסוי|חומר|תוצאות|מעבדה)/i;
  const passed = domainTerms.test(input);
  return {
    passed,
    stage: passed ? 'DOMAIN_PASS' : 'DOMAIN_WARN',
    reason: passed ? 'Input matches MATRIYA domain' : 'Input may be outside core domain — answering best-effort'
  };
}

// ─── RAG answer (primary) ─────────────────────────────────────────────────────

/**
 * Try to get a document-grounded answer using the full RAG service.
 * Returns null if RAG produces no usable answer (e.g. no documents uploaded yet).
 */
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

    logger.info(`[pipeline] RAG answer obtained (${answer.length} chars)`);
    return answer;
  } catch (e) {
    logger.warn(`[pipeline] RAG failed — falling back to direct LLM: ${e.message}`);
    return null;
  }
}

// ─── Direct OpenAI fallback ───────────────────────────────────────────────────

async function callLlmDirect(input) {
  const apiKey = (settings.OPENAI_API_KEY || process.env.OPENAI_API_KEY || '').trim();
  const model = settings.OPENAI_RAG_MODEL || process.env.OPENAI_RAG_MODEL || 'gpt-4o-mini';
  const base = (settings.OPENAI_API_BASE || process.env.OPENAI_API_BASE || 'https://api.openai.com/v1').replace(/\/$/, '');

  if (!apiKey) {
    return 'MATRIYA: מערכת לא מוגדרת עם מפתח LLM. אנא פנה למנהל המערכת.';
  }

  const systemPrompt = `You are MATRIYA, an advanced materials science AI assistant specializing in
coatings, corrosion protection, intumescent formulations, and laboratory experiments.
Answer in the same language the user wrote in (Hebrew if Hebrew, English if English).
Be concise and informative (max 4 sentences). Be professional and helpful.`;

  const resp = await axios.post(
    `${base}/chat/completions`,
    {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: input }
      ],
      max_tokens: 400,
      temperature: 0.3
    },
    {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: 25000
    }
  );

  const text = (resp.data?.choices?.[0]?.message?.content || '').trim();
  return text || 'MATRIYA: בקשתך התקבלה אך לא ניתן היה לעבד תשובה.';
}

// ─── Decision classifier ──────────────────────────────────────────────────────

function classifyDecision(answer) {
  if (/decision\s*=\s*GO/i.test(answer)) return 'VALID_CONCLUSION';
  if (/decision\s*=\s*STOP/i.test(answer)) return 'INSUFFICIENT_DATA';
  if (/decision\s*=\s*ITERATE/i.test(answer)) return 'INCONCLUSIVE';
  // Heuristic: if answer contains measurable evidence → GO, otherwise ITERATE
  if (/\b(proven|confirmed|experiment|result|data|tested|verified)\b/i.test(answer)) return 'VALID_CONCLUSION';
  return 'INCONCLUSIVE';
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Run the full MATRIYA pipeline for a given input string.
 *
 * @param {string} input — raw user message (WhatsApp body or API query)
 * @returns {{ consilium, gate, score, decision, experiment }}
 */
export async function runPipeline(input) {
  const startedAt = Date.now();
  logger.info(`[pipeline] runPipeline: "${input.slice(0, 80)}"`);

  // 1. Gate — domain check
  const gate = checkDomainGate(input);

  // 2. Consilium — try RAG first, fall back to direct LLM
  let answer;
  let ragUsed = false;

  const ragAnswer = await callRag(input);
  if (ragAnswer) {
    answer = ragAnswer;
    ragUsed = true;
  } else {
    try {
      answer = await callLlmDirect(input);
    } catch (e) {
      logger.error(`[pipeline] direct LLM also failed: ${e.message}`);
      answer = `MATRIYA: שגיאה בעיבוד הבקשה.\nPipeline error: ${e.message}`;
    }
  }

  // Clean decision keyword from the visible answer
  const cleanAnswer = answer.replace(/\bdecision\s*=\s*(GO|STOP|ITERATE)\b/gi, '').trim() || answer;

  const consilium = {
    input,
    sources: [],
    context: ragUsed ? 'RAG document retrieval' : 'Direct LLM',
    rag_used: ragUsed,
    timestamp: new Date().toISOString()
  };

  // 3. Decision classification
  const decision_status = classifyDecision(answer);
  const actionMap = {
    VALID_CONCLUSION:       'GO',
    INCONCLUSIVE:           'ITERATE',
    NO_CHANGE:              'ITERATE',
    INSUFFICIENT_DATA:      'STOP',
    STRUCTURAL_INCOMPLETE:  'STOP',
    INVALID_EXPERIMENT:     'STOP',
    REFERENCE_ONLY:         'STOP'
  };

  // 4. Score — Emergence Score (guard against empty text)
  let scoreResult = { score: 0, regime: 'UNKNOWN', components: {} };
  if (cleanAnswer) {
    try {
      scoreResult = evaluateCreativity(cleanAnswer);
    } catch (e) {
      logger.warn(`[pipeline] evaluateCreativity failed: ${e.message}`);
    }
  }

  const score = {
    emergence_score: scoreResult.score ?? 0,
    regime: scoreResult.regime ?? 'UNKNOWN',
    components: scoreResult.components ?? {}
  };

  const decision = {
    status: decision_status,
    action_required: actionMap[decision_status] ?? 'STOP',
    reason: cleanAnswer,
    elapsed_ms: Date.now() - startedAt
  };

  // 5. Experiment suggestion (look for "experiment:" in answer)
  const expMatch = answer.match(/experiment[:\s]+(.+)/i);
  const experiment = expMatch
    ? { suggestion: expMatch[1].trim(), status: 'PROPOSED' }
    : null;

  logger.info(`[pipeline] done in ${decision.elapsed_ms}ms — action=${decision.action_required} rag=${ragUsed}`);
  return { consilium, gate, score, decision, experiment };
}

/** Build a structured action package from pipeline result (used by handleOutbound). */
export function createActionPackage(pipelineResult, recipientPhone) {
  return {
    to: recipientPhone,
    message: pipelineResult.decision?.reason || 'MATRIYA: עיבוד הושלם.',
    expectedResponseType: pipelineResult.decision?.action_required ?? 'STOP',
    pipeline_result: pipelineResult,
    created_at: new Date().toISOString()
  };
}
