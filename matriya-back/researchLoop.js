/**
 * Research Loop MVP – fixed 4-agent chain: analysis → research → critic → synthesis.
 * After each agent: save output, create Justification if change.
 * Justification labels/descriptions come from justification templates when available.
 */
import logger from './logger.js';
import { ResearchLoopRun, sequelize } from './database.js';
import { getJustificationDisplay } from './justificationTemplates.js';
import { evidenceFromSearchResults } from './lib/openaiFileSearchMatriya.js';

const AGENT_ORDER = ['analysis', 'research', 'critic', 'synthesis'];

function getAgentPrompt(agentName, query, previousOutput, ragContext = null, hasLabData = false) {
  const prev = previousOutput ? `\n\nPrevious step output:\n${String(previousOutput).slice(0, 2000)}` : '';
  const docContext = ragContext ? `\n\nData and document context:\n${String(ragContext).slice(0, 5000)}` : '';
  const base = `Query: ${query}${prev}${docContext}`;
  const hebrewOnly = ' Always respond in Hebrew (עברית) only. Do not use Arabic.';

  // When real lab data exists, agents must reason from it — no fallbacks allowed
  const dataGroundingRule = hasLabData
    ? ' Lab experiment data is provided above — you MUST use the actual numeric values in your reasoning.'
      + ' STRICTLY FORBIDDEN: do NOT write "אין במערכת מידע תומך" or "no supporting information" or any fallback phrase — real data IS present.'
      + ' STRICTLY FORBIDDEN: do not end your response with any phrase indicating missing data.'
    : '';

  const prompts = {
    analysis: {
      system: 'You are the analysis agent for a materials science system.' + hebrewOnly + dataGroundingRule
        + (hasLabData
          ? ' Extract and list the exact numeric values (expansion_ratio, adhesion, viscosity, char_quality, status) for each experiment from the provided data. Present them as a clear comparison table or list.'
          : ' Analyze the query and previous context. Output a concise analysis.'),
      user: base
    },
    research: {
      system: 'You are the research agent for a materials science system.' + hebrewOnly + dataGroundingRule
        + (hasLabData
          ? ' Using the exact numeric values provided, compare each experiment on all available metrics. Identify which experiment performs better on each metric and explain why.'
          : ' Based on the analysis and document context above, produce a short research summary.'),
      user: base
    },
    critic: {
      system: 'You are the critic agent for a materials science system.' + hebrewOnly + dataGroundingRule
        + (hasLabData
          ? ' Verify that the previous analysis used the actual data values. Check if all metrics were considered. Point out any metric that was missed or incorrectly interpreted.'
          : ' Review the research output critically. Point out gaps or strengths briefly.'),
      user: base
    },
    synthesis: {
      system: 'You are the synthesis agent for a materials science system.' + hebrewOnly + dataGroundingRule
        + (hasLabData
          ? ' Based on all the data and analysis above, make a CLEAR and DEFINITIVE recommendation: which experiment is better for production and why. State the winning experiment_id explicitly. Cite the specific numeric values that justify the decision. Do not hedge or give a non-answer.'
          : ' Synthesize the analysis, research, and critique into a final concise conclusion.'),
      user: base
    }
  };
  return prompts[agentName] || { system: 'Process the input.', user: base };
}

/**
 * Run one agent: build context and call LLM.
 */
async function runAgent(agentName, query, previousOutput, ragService, ragContextForResearch = null, hasLabData = false) {
  const { system, user } = getAgentPrompt(agentName, query, previousOutput, ragContextForResearch, hasLabData);
  const llm = ragService.llmService;
  if (!llm || !llm.isAvailable()) {
    return { output: null, error: 'LLM not available' };
  }
  const context = `${system}\n\n${user}`;
  const question = query;
  try {
    const output = await llm.generateAnswer(question, context, 800);
    return { output: output || '', error: null };
  } catch (e) {
    logger.error(`Research loop agent ${agentName} error: ${e.message}`);
    return { output: null, error: e.message };
  }
}

/**
 * Run the full 4-agent loop. After each agent: save output, justification if changed.
 * No Integrity Monitor – just the 4 agents (no K/C/B/N/L snapshots or violation checks).
 * @param {string} sessionId - Research session UUID
 * @param {string} query - User query
 * @param {object} ragService - RAG service (has llmService, generateAnswer)
 * @param {object|null} filterMetadata - Optional { filename } to restrict RAG to one file
 * @param {object|null} runOptions - Optional { pre_justification_text, doe_design_id, labContext }
 *   labContext: { experiments: [{experiment_id, expansion_ratio, adhesion, ...}] }
 *   When provided, experiment data is injected into agent context and stored in outputs.selected_experiments.
 * @returns {Promise<{ run_id, outputs, justifications, error? }>}
 */
export async function runLoop(sessionId, query, ragService, filterMetadata = null, runOptions = null) {
  const startMs = Date.now();
  const outputs = {};
  const justifications = [];

  let previousOutput = null;
  let ragContext = null;
  let ragEvidenceSources = [];

  // Extract labContext from runOptions (pre-fetched lab experiments to inject into agent context)
  const labContext = runOptions?.labContext || null;
  const selectedExperiments = labContext?.experiments || [];

  // When searching a single file, use fewer chunks; when no filter or multiple filenames (project scope), use more
  const filenamesList =
    filterMetadata && Array.isArray(filterMetadata.filenames)
      ? filterMetadata.filenames.filter((f) => typeof f === 'string' && f.trim())
      : [];
  const singleFilename =
    filterMetadata && typeof filterMetadata.filename === 'string' && filterMetadata.filename.trim();
  const singleFileFilter = Boolean(singleFilename) || filenamesList.length === 1;
  const isAllFiles = !singleFileFilter;
  const cloudReady = ragService._openAiFileSearchReady && ragService._openAiFileSearchReady();
  const nResults = isAllFiles ? (cloudReady ? 24 : 16) : 8;
  const maxContextChars = isAllFiles ? 6000 : 3000;

  try {
    if (ragService.generateAnswer) {
      const res = await ragService.generateAnswer(query, nResults, filterMetadata || null, false);
      ragEvidenceSources = evidenceFromSearchResults(res.results || [], undefined, undefined, query, null);
      let text = (res.context || res.results?.map(r => r.document || r.content).join('\n') || '').slice(0, maxContextChars);
      const hadFileFilter = filterMetadata && (
        (Array.isArray(filterMetadata.filenames) && filterMetadata.filenames.length > 0) ||
        (typeof filterMetadata.filename === 'string' && filterMetadata.filename.trim())
      );
      if (filterMetadata) {
        const files = Array.isArray(filterMetadata.filenames) && filterMetadata.filenames.length > 0
          ? filterMetadata.filenames
          : (typeof filterMetadata.filename === 'string' && filterMetadata.filename.trim() ? [filterMetadata.filename] : null);
        if (files && files.length > 0) {
          const sourceLine = `Sources (files) this answer is based on: ${files.join(', ')}.\n\n`;
          text = sourceLine + text;
        }
      }
      // When user asked about a specific file but no content was found, give agents a clear instruction instead of empty context (avoids LLM inventing "אין מידע זמין...")
      if (hadFileFilter && (!text || text.length < 100)) {
        const fileLabel = Array.isArray(filterMetadata.filenames) && filterMetadata.filenames.length > 0
          ? filterMetadata.filenames[0]
          : (filterMetadata.filename || '').trim();
        text = (text || '') + `[System note: No document content was found in the system for the selected file "${fileLabel}". Tell the user in Hebrew, briefly: לא נמצא תוכן במערכת עבור הקובץ שנבחר. ייתכן שהקובץ טרם עובד (אינדוקס) או שהשם לא תואם. נסה לבחור "כל הקבצים" או לבדוק שהקובץ מופיע ברשימה ולהמתין לסיום העיבוד.]
`;
      }
      // When searching "all files" but RAG returned no context (empty collection or no matches), tell the user clearly
      // SKIP this fallback if lab experiment data will be injected — it would contradict the real data
      if (isAllFiles && (!text || text.length < 100) && selectedExperiments.length === 0) {
        text = (text || '') + `[System note: No document content was found in the RAG system. Tell the user in Hebrew, briefly: לא נמצא תוכן במערכת. ייתכן שקבצים טרם עובדו (אינדוקס) בסביבה זו. וודא שהקבצים הועלו ושה-Matriya בסביבת ה-production מקבלת את העלאת הקבצים (MATRIYA_BACK_URL) ומחוברת לאותה מסד נתונים.]
`;
      }
      ragContext = text;
    }
  } catch (e) {
    logger.warn(`RAG context for research step: ${e.message}`);
  }

  // Inject pre-fetched lab experiments directly into agent context (enriches RAG with live DB data)
  const hasLabData = selectedExperiments.length > 0;
  if (hasLabData) {
    // Build a structured, human-readable table the LLM can parse unambiguously
    const header = '=== LAB EXPERIMENT DATA (from live DB — use as primary evidence, do NOT say data is missing) ===';
    const labLines = selectedExperiments.map(e => {
      const metrics = [
        ['experiment_id',       e.experiment_id],
        ['formula',             e.formula],
        ['expansion_ratio',     e.expansion_ratio],
        ['adhesion',            e.adhesion],
        ['viscosity',           e.viscosity],
        ['char_quality',        e.char_quality],
        ['experiment_outcome',  e.experiment_outcome || e.status],
      ]
        .filter(([, v]) => v != null)
        .map(([k, v]) => `  ${k}: ${v}`)
        .join('\n');
      return `Experiment:\n${metrics}`;
    }).join('\n\n');
    const hint = '\nNote: "experiment_outcome=production_formula" means this experiment is validated for production use.';
    // Replace the entire ragContext with lab data as the primary source (prepend so it appears first)
    ragContext = `${header}\n\n${labLines}\n${hint}\n\n` + (ragContext ? `Additional document context:\n${ragContext}` : '');
  }

  for (const agentName of AGENT_ORDER) {
    const { output, error } = await runAgent(
      agentName,
      query,
      previousOutput,
      ragService,
      ragContext,
      hasLabData
    );
    if (error) {
      return {
        run_id: null,
        outputs,
        justifications,
        error: `Agent ${agentName} failed: ${error}`,
        sources: ragEvidenceSources
      };
    }
    const out = (output || '').trim();
    outputs[agentName] = out;
    if (previousOutput !== null && out !== previousOutput) {
      const reasonCode = 'output_changed';
      const ctx = { agent: agentName, previous_snippet: String(previousOutput).slice(0, 200) };
      const display = await getJustificationDisplay(reasonCode, ctx);
      justifications.push({
        agent: agentName,
        reason: reasonCode,
        ...display,
        previous_snippet: ctx.previous_snippet,
        created_at: new Date().toISOString()
      });
    }
    previousOutput = out;
  }

  const durationMs = Date.now() - startMs;
  const opts = runOptions && typeof runOptions === 'object' ? runOptions : {};

  // Embed selected experiments into outputs so they are stored in research_loop_runs.outputs (JSONB)
  if (selectedExperiments.length > 0) {
    outputs.selected_experiments = selectedExperiments.map(e => ({
      experiment_id:      e.experiment_id,
      expansion_ratio:    e.expansion_ratio ?? null,
      adhesion:           e.adhesion ?? null,
      viscosity:          e.viscosity ?? null,
      char_quality:       e.char_quality ?? null,
      experiment_outcome: e.experiment_outcome ?? e.status ?? null,
      formula:            e.formula ?? null
    }));
  }

  const runRecord = await saveRun(sessionId, query, outputs, justifications, false, null, durationMs, opts.pre_justification_text ?? null, opts.doe_design_id ?? null);

  // Write research_session_id back into lab_experiments for each selected experiment.
  // This closes the loop: lab_experiments.research_session_id → research_sessions.id
  if (selectedExperiments.length > 0 && sequelize) {
    try {
      const expIds = selectedExperiments.map(e => e.experiment_id).filter(Boolean);
      if (expIds.length > 0) {
        // Build placeholders manually — Sequelize doesn't expand arrays in ANY(:param)
        const placeholders = expIds.map((_, i) => `:eid${i}`).join(', ');
        const replacements = { sessionId };
        expIds.forEach((id, i) => { replacements[`eid${i}`] = id; });
        await sequelize.query(
          `UPDATE lab_experiments SET research_session_id = :sessionId WHERE experiment_id IN (${placeholders})`,
          { replacements }
        );
        logger.info(`[researchLoop] Wrote research_session_id=${sessionId} to lab_experiments: ${expIds.join(', ')}`);
      }
    } catch (e) {
      logger.warn(`[researchLoop] Could not update lab_experiments.research_session_id: ${e.message}`);
    }
  }

  return {
    run_id: runRecord?.id ?? null,
    outputs,
    justifications,
    duration_ms: durationMs,
    sources: ragEvidenceSources
  };
}

async function saveRun(sessionId, query, outputs, justifications, stoppedByViolation = false, violationId = null, durationMs = null, preJustificationText = null, doeDesignId = null) {
  if (!ResearchLoopRun) return null;
  try {
    const run = await ResearchLoopRun.create({
      session_id: sessionId,
      query,
      outputs: outputs || {},
      justifications: justifications || [],
      stopped_by_violation: stoppedByViolation,
      violation_id: violationId,
      duration_ms: durationMs,
      pre_justification_text: preJustificationText || null,
      doe_design_id: doeDesignId || null
    });
    return run;
  } catch (e) {
    logger.warn(`Failed to save research loop run: ${e.message}`);
    return null;
  }
}

export { AGENT_ORDER };
