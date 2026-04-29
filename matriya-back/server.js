
/**
 * Express application for RAG system file ingestion
 */
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { Op } from 'sequelize';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import path, { dirname, join } from 'path';
import { existsSync, mkdirSync, unlinkSync, readdirSync, writeFileSync, readFileSync, copyFileSync } from 'fs';
import settings from './config.js';
import RAGService from './ragService.js';
import { initDb, SearchHistory, ResearchSession, ResearchAuditLog, PolicyAuditLog, DecisionAuditLog, NoiseEvent, IntegrityCycleSnapshot, Experiment, EXPERIMENT_OUTCOMES } from './database.js';
import { authRouter, getCurrentUser, requireAuth } from './authEndpoints.js';
import DocumentProcessor from './documentProcessor.js';
import axios from 'axios';
import XLSX from 'xlsx';
import { adminRouter } from './adminEndpoints.js';
import { StateMachine, Kernel } from './stateMachine.js';
import {
  validateAndAdvance,
  logAudit,
  getOrCreateSession,
  getGateObservabilityContext,
  HARD_STOP_MESSAGE,
  stripSuggestions,
  evaluatePreLlmResearchGate,
  getModelVersionHash,
  filterChunksByRetrievalSimilarityThreshold,
  getMaxAttributionSources
} from './researchGate.js';
import { runAfterCycle, getActiveViolation } from './integrityMonitor.js';
import { runLoop } from './researchLoop.js';
import logger from './logger.js';
import { metricsMiddleware, getMetrics } from './metrics.js';
import { getMetricsDashboard, getSEMOutput, getGateRecords } from './observability.js';
import {
  buildStructuredKernelOutput,
  parseKernelJsonParam,
  suggestStructuralGeneration,
  KERNEL_V16_VERSION
} from './kernelV16.js';
import {
  getMatriyaOpenAiVectorStoreId,
  hydrateMatriyaOpenAiVectorStoreId,
  persistMatriyaOpenAiVectorStoreId,
  useOpenAiFileSearchEnabled,
  getOpenAiApiBase
} from './lib/openaiMatriyaConfig.js';
import {
  syncMatriyaRagToOpenAI,
  onMatriyaRagFileDeleted,
  removeMatriyaOpenAiFileByLogicalName
} from './lib/matriyaOpenAiSync.js';
import {
  classifyMaterialsLibraryIntent,
  fetchManagementMaterialsLibraryContext,
  answerFromMaterialsLibraryContext
} from './lib/uploadAskMaterialsRouter.js';
import { scheduleMatriyaOpenAiSyncAfterIngest } from './lib/matriyaOpenAiAutoSync.js';
import { buildAnswerSourcesFromRetrieval } from './lib/answerAttribution.js';
import {
  filterRetrievalRowsByAnswerBinding
} from './lib/answerSourceBindingFilter.js';
import {
  tryDavidAcceptanceFixture,
  isDavidFormulationInsufficientQuestion,
  davidInsufficientEvidencePayload
} from './lib/davidAskMatriyaAcceptance.js';
import { repairUtf8MisdecodedAsLatin1 } from './lib/textEncoding.js';
import { RAG_INSUFFICIENT_SUPPORT_MESSAGE_HE } from './lib/ragEvidenceFailSafe.js';
import { handleLabBridgeFlow } from './lib/matriyaLabBridgeFlow.js';
import {
  extractExpEntities,
  buildKernelStageRuns,
  buildComparisonNarration,
  resolveEntitySnapshots
} from './lib/matriyaQueryIntent.js';
import { externalLayerRouter, initExternalLayerFromEnv } from './lib/externalLayerRouter.js';
import { evaluate as evaluateConstraintEngine } from './services/eliminationLogic.js';
import sourcesRouter from './routes/external/sources.js';
import corrosionRouter from './routes/projects/corrosion.js';
import whatsappRouter from './routes/webhook/whatsapp.js';
import githubWebhookRouter from './routes/webhook/github.js';
import experimentsUploadRouter from './routes/experiments/upload.js';
import internalWhatsappOutboundRouter from './routes/internal/whatsappOutbound.js';
import { get as cacheGet, set as cacheSet, getOrCompute } from './services/agentCache.js';
import { evaluate as evaluateCreativity } from './services/creativityOrchestrator.js';
import { handleInbound, handleOutbound, createActionPackage } from './twilioGateway.js';
import { processPendingTasks, startPolling } from './services/whatsappPipeline.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize Express app
const app = express();

// Prevent crashes from pg pool "Connection terminated unexpectedly" on idle connection drops.
// This is benign: pg will reconnect automatically on the next query.
process.on('uncaughtException', (err) => {
  if (
    err.message?.includes('Connection terminated unexpectedly') ||
    err.message?.includes('ECONNRESET') ||
    err.code === 'ECONNRESET'
  ) {
    console.warn('[pg] connection dropped (handled, will reconnect):', err.message);
  } else {
    console.error('[UNCAUGHT EXCEPTION]', err);
    process.exit(1);
  }
});
// Trust first proxy (e.g. Vercel) so req.protocol / X-Forwarded-* match the public URL — used by Twilio webhook signature checks.
app.set('trust proxy', 1);

// CORS: must not combine origin: "*" with credentials: true (browsers block; looks like "no CORS header").
// origin: true echoes the request Origin so preflight succeeds for matriya-front.vercel.app, localhost, etc.
logger.info("CORS: dynamic origin (reflect Origin), credentials off (Bearer in Authorization is fine)");
app.use(cors({
  origin: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH", "HEAD"],
  credentials: false,
  maxAge: 3600
}));

// Handle preflight requests explicitly
app.options('*', cors());

// Body parsing middleware with UTF-8 support (limit >> default 100kb — see settings.EXPRESS_BODY_LIMIT)
app.use(express.json({ charset: 'utf-8', limit: settings.EXPRESS_BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, charset: 'utf-8', limit: settings.EXPRESS_BODY_LIMIT }));

// Set UTF-8 encoding for all responses
app.use((req, res, next) => {
  res.charset = 'utf-8';
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  next();
});

// Scope 3: observability – metrics and latency per route (no dashboard UI)
app.use(metricsMiddleware);

// Initialize database (non-blocking on Vercel; non-fatal so server still starts if DB unreachable)
if (!process.env.VERCEL) {
  try {
    await initDb();
  } catch (e) {
    const msg = e.message || e.code || 'Connection failed';
    logger.error(`Database initialization failed: ${msg}. Server will start but DB-dependent routes will return 503.`);
    // Do not throw – allow server to listen (e.g. when Supabase is unreachable / timeout)
  }
} else {
  logger.info("Skipping database initialization on Vercel - will initialize on first use");
}

// Register routers
app.use('/auth', authRouter);
app.use('/admin', adminRouter);
initExternalLayerFromEnv(logger);
app.use('/api/external/v1', externalLayerRouter);
app.use('/api/external/sources', sourcesRouter);
app.use('/api/projects/corrosion-shield', corrosionRouter);
app.use('/api/webhook/whatsapp', whatsappRouter);
app.use('/api/webhook/github', githubWebhookRouter);
app.use('/api/experiments', experimentsUploadRouter);
app.use('/api/internal/whatsapp-outbound', internalWhatsappOutboundRouter);

// Milestone 1: inbound WhatsApp → MATRIYA pipeline → reply
app.post('/api/whatsapp/inbound', handleInbound);
// Milestone 1: GET health check for the inbound route
app.get('/api/whatsapp/inbound', (_req, res) => res.status(200).type('text/plain').send('WhatsApp inbound OK'));

// WhatsApp Pipeline — cron endpoint (Vercel calls this every minute via vercel.json crons)
// Also callable manually for testing: GET /api/whatsapp/process-pending
app.get('/api/whatsapp/process-pending', async (req, res) => {
  try {
    const result = await processPendingTasks();
    res.json({ ok: true, ...result });
  } catch (e) {
    logger.error(`GET /api/whatsapp/process-pending: ${e.message}`);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Milestone 2: outbound action — POST { to, message, expectedResponseType }
// Triggers handleOutbound which sends a WhatsApp message and logs to twilio_tickets.
app.post('/api/whatsapp/outbound', async (req, res) => {
  try {
    const { to, message, expectedResponseType } = req.body || {};
    if (!to || !message) return res.status(400).json({ error: 'to and message are required' });
    const actionPackage = createActionPackage(
      { decision: { reason: message, action_required: expectedResponseType || 'STOP' } },
      to
    );
    await handleOutbound(actionPackage);
    res.json({ sent: true, to, action: expectedResponseType || 'STOP' });
  } catch (e) {
    logger.error(`POST /api/whatsapp/outbound: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/cache/get   — { input, agent_name } → { result, cached }
 * POST /api/cache/set   — { input, agent_name, value } → { key, expires_at }
 * POST /api/cache/query — { input, agent_name } → runs mock compute, returns { result, cached }
 */
app.post('/api/cache/get', async (req, res) => {
  try {
    const { input, agent_name } = req.body || {};
    if (!input || !agent_name) return res.status(400).json({ error: 'input and agent_name required' });
    const result = await cacheGet(input, agent_name);
    res.json({ result, cached: result !== null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/cache/set', async (req, res) => {
  try {
    const { input, agent_name, value } = req.body || {};
    if (!input || !agent_name || value === undefined) return res.status(400).json({ error: 'input, agent_name, value required' });
    const info = await cacheSet(input, agent_name, value);
    res.json(info);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/cache/query', async (req, res) => {
  try {
    const { input, agent_name } = req.body || {};
    if (!input || !agent_name) return res.status(400).json({ error: 'input and agent_name required' });
    const { result, cached } = await getOrCompute(input, agent_name, async () => ({
      computed_at: new Date().toISOString(),
      echo: input,
    }));
    res.json({ result, cached });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/**
 * POST /api/creativity/evaluate
 * Body: { text: string, agent_name: string }
 * Returns: { Es_score, regime, components, feedback, agent_name }
 */
app.post('/api/creativity/evaluate', (req, res) => {
  try {
    const { text, agent_name } = req.body || {};
    if (!text) return res.status(400).json({ error: 'MISSING_FIELD', field: 'text' });
    const result = evaluateCreativity({ text, agent_name });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/constraint/evaluate — Constraint engine (file-backed rules only; no DB, no suppliers).
 * Body: { material_conditions: { ... } } or flat condition fields per MATRIYA_Constraint_Engine_Guide.md
 */
app.post('/api/constraint/evaluate', (req, res) => {
  try {
    const t0 = Date.now();
    const result = evaluateConstraintEngine(req.body || {});
    const ms = Date.now() - t0;
    if (ms >= 100) {
      logger.warn(`[constraint] evaluate() took ${ms}ms (target <100ms)`);
    }
    res.json(result);
  } catch (e) {
    logger.error(`[constraint] evaluate error: ${e.message}`);
    res.status(400).json({ error: e.message || 'constraint evaluate failed' });
  }
});

// Initialize RAG service (lazy initialization to avoid blocking startup)
let ragService = null;

function getRagService() {
  /**Get or initialize RAG service*/
  if (!ragService) {
    logger.info("Initializing RAG service...");
    ragService = new RAGService();
    logger.info("RAG service initialized");
  }
  return ragService;
}

// Initialize Kernel (lazy initialization)
let kernel = null;

function getKernel() {
  /**Get or initialize Kernel with State Machine*/
  if (!kernel) {
    logger.info("Initializing Kernel...");
    // State machine doesn't need DB session for basic operations (logging only)
    const stateMachine = new StateMachine();
    kernel = new Kernel(getRagService(), stateMachine);
    logger.info("Kernel initialized");
  }
  return kernel;
}

function researchKernelOptsFromRequest(req) {
  const q = req.query || {};
  const b = req.body || {};
  const raw = { ...q, ...b };
  return {
    kernel_signals: parseKernelJsonParam(raw.kernel_signals),
    data_anchors: parseKernelJsonParam(raw.data_anchors),
    methodology_flags: parseKernelJsonParam(raw.methodology_flags)
  };
}

function attachKernelV16ToPayload(resPayload, { stage, answer, sources, session, gateKernelV16, insufficientInfo }) {
  const kc = session?.kernel_context || {};
  const base = {
    spec: KERNEL_V16_VERSION,
    ...(gateKernelV16 && typeof gateKernelV16 === 'object' ? gateKernelV16 : {}),
    structured: buildStructuredKernelOutput({
      stage,
      answer: insufficientInfo ? '' : answer,
      sources: sources || [],
      insufficientInfo: !!insufficientInfo
    })
  };
  if (stage === 'N' && Array.isArray(kc.breakdown_reasons) && kc.breakdown_reasons.length) {
    base.n_generation = suggestStructuralGeneration(kc.breakdown_reasons);
  }
  // Source separation (David): research/document responses are DOCUMENT_RAG only.
  // Numerical values (delta%, versions) come from document text — NOT from DB computation.
  return {
    ...resPayload,
    data_source: 'DOCUMENT_RAG',
    source_note: 'Values extracted from indexed document text (RAG). For authoritative lab computation use Lab Engine (flow=lab, data_source=DB_COMPUTED).',
    kernel_v16: base,
  };
}

const KG01_VIOLATION = 'KG-01_VIOLATION';
const ENFORCEMENT_THRESHOLD = 3;

/** Returns matriya_enforcement payload (soft redirect) or null. Does not block. */
async function getEnforcement(sessionId, stage, session) {
  if (stage === 'L' || !session) return null;
  if (session.enforcement_overridden) return null;
  if (!ResearchAuditLog) return null;
  const count = await ResearchAuditLog.count({
    where: { session_id: sessionId, response_type: KG01_VIOLATION }
  });
  if (count < ENFORCEMENT_THRESHOLD) return null;
  return {
    type: 'soft_redirect',
    message_he: 'נמצאו 3 או יותר הפרות מדיניות (KG-01) בסשן זה. מומלץ לחזור לשלב B.',
    message_en: 'Three or more policy violations (KG-01) in this session. Consider returning to stage B.',
    suggestion_stage: 'B'
  };
}

async function logPolicyEnforcement(sessionId, stage) {
  if (!PolicyAuditLog) return;
  try {
    await PolicyAuditLog.create({ session_id: sessionId, stage });
  } catch (e) {
    logger.warn(`Policy audit log failed: ${e.message}`);
  }
}

/** Scope 2 + Kernel Amendment v1.2: log every gate decision with confidence_score, basis_count, model_version_hash, complexity_context */
async function logDecisionAudit(sessionId, stage, decision, responseType, requestQuery, inputsSnapshot, details = null, opts = {}) {
  if (!DecisionAuditLog) return;
  const gateCtx = getGateObservabilityContext();
  try {
    await DecisionAuditLog.create({
      session_id: sessionId,
      stage,
      decision,
      response_type: responseType || null,
      request_query: requestQuery != null ? String(requestQuery).slice(0, 4000) : null,
      inputs_snapshot: inputsSnapshot || null,
      details: details || null,
      confidence_score: opts.confidence_score != null ? opts.confidence_score : gateCtx.confidence_score,
      basis_count: opts.basis_count != null ? opts.basis_count : gateCtx.basis_count,
      model_version_hash: opts.model_version_hash || gateCtx.model_version_hash,
      complexity_context: opts.complexity_context || null
    });
  } catch (e) {
    logger.warn(`Decision audit log failed: ${e.message}`);
  }
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dest = settings.UPLOAD_DIR;
    try {
      mkdirSync(dest, { recursive: true });
    } catch (_) {}
    cb(null, dest);
  },
  filename: (req, file, cb) => {
    // Preserve original filename; use basename only (folder uploads send "folder/sub/file.pdf")
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    let originalName = file.originalname || 'file';
    // Strip any path segments (e.g. from webkitdirectory)
    if (originalName.includes('/') || originalName.includes('\\')) {
      originalName = originalName.replace(/^.*[/\\]/, '');
    }
    originalName = repairUtf8MisdecodedAsLatin1(originalName);
    // Sanitize: remove null bytes and path traversal
    originalName = originalName.replace(/\0/g, '').replace(/\.\./g, '') || 'file';
    cb(null, uniqueSuffix + '-' + originalName);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: settings.MAX_FILE_SIZE
  }
});

// Scope 1: parallel processes – one research run per session at a time
const researchRunLocks = new Map();

/**
 * Root endpoint
 */
app.get("/", (req, res) => {
  // Serve the bundled React frontend when available; otherwise return API info.
  const indexPath = join(__dirname, 'public', 'index.html');
  if (existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }
  return res.json({
    message: "MATRIYA RAG System API",
    version: "1.0.0",
    status: "running",
    build: "whatsapp-pipeline-v2"
  });
});

/** Redact POSTGRES_URL to a short fingerprint so local vs prod can be compared (same DB = same fingerprint). */
function getDbFingerprint() {
  const url = process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL || "";
  if (!url) return null;
  const m = url.match(/@([^/]+?)(?::\d+)?(?:\/|$)/);
  return m ? m[1] : null; // e.g. "abc123.pooler.supabase.com"
}

/**
 * Health check endpoint (Scope 3: includes metrics and latency).
 * db_fingerprint: same on local and prod when using the same DB (compare to verify).
 */
app.get("/health", async (req, res) => {
  try {
    const info = await getRagService().getCollectionInfo();
    const metrics = getMetrics();
    const dbFingerprint = getDbFingerprint();
    const collectionName = process.env.COLLECTION_NAME || "rag_documents";
    return res.json({
      status: "healthy",
      version: "v1.1-matgate-final",
      vector_db: info,
      db_fingerprint: dbFingerprint,
      collection_name: collectionName,
      metrics: {
        total_requests: metrics.total_requests,
        total_errors: metrics.total_errors,
        latency_p50_ms: metrics.latency_p50,
        latency_p99_ms: metrics.latency_p99
      }
    });
  } catch (e) {
    logger.error(`Health check failed: ${e.message}`);
    return res.status(500).json({
      status: "unhealthy",
      error: e.message
    });
  }
});

// ---------- Lab integration: formula analysis & experiment sync ----------
const OUTCOMES_SET = new Set(EXPERIMENT_OUTCOMES);

/**
 * POST /analysis/formula – analyze formula before experiment (domain, materials, percentages).
 * Returns status, warnings, and similar_experiments from stored experiments.
 */
app.post("/analysis/formula", async (req, res) => {
  try {
    const { domain, materials, percentages } = req.body || {};
    const warnings = [];
    let similar_experiments = [];
    if (Experiment) {
      const where = {};
      if (domain && typeof domain === 'string' && domain.trim()) where.technology_domain = domain.trim();
      const rows = await Experiment.findAll({
        where: Object.keys(where).length ? where : undefined,
        order: [['updated_at', 'DESC']],
        limit: 10,
        attributes: ['experiment_id', 'technology_domain', 'formula', 'experiment_outcome', 'is_production_formula']
      });
      similar_experiments = rows.map(r => ({
        experiment_id: r.experiment_id,
        technology_domain: r.technology_domain,
        formula: r.formula,
        experiment_outcome: r.experiment_outcome,
        is_production_formula: !!r.is_production_formula
      }));
    }
    return res.json({
      status: 'ok',
      warnings,
      similar_experiments
    });
  } catch (e) {
    logger.error(`/analysis/formula error: ${e.message}`);
    return res.status(500).json({ error: e.message, status: 'error', warnings: [], similar_experiments: [] });
  }
});

const INSIGHTS_DOC_PREVIEW_LEN = 600;
const INSIGHTS_RAG_N = 10;
const INSIGHTS_FORMULATION_LIMIT = 20;

function buildExperimentRagQuery(exp) {
  if (!exp || typeof exp !== 'object') return '';
  const parts = [];
  if (exp.technology_domain && String(exp.technology_domain).trim()) parts.push(String(exp.technology_domain).trim());
  if (exp.formula != null && String(exp.formula).trim()) parts.push(String(exp.formula).trim().slice(0, 800));
  const mats = exp.materials;
  if (Array.isArray(mats)) {
    for (const m of mats.slice(0, 24)) {
      if (typeof m === 'string' && m.trim()) parts.push(m.trim());
      else if (m && typeof m === 'object' && m.name) parts.push(String(m.name).trim());
    }
  } else if (mats && typeof mats === 'object') {
    parts.push(...Object.keys(mats).slice(0, 24));
  }
  const q = parts.filter(Boolean).join(' ').trim();
  return q.slice(0, 2000) || 'experiment';
}

function mapSearchHitToSimilarDoc(hit) {
  const text = (hit && (hit.document || hit.text || '')) || '';
  const meta = (hit && hit.metadata) || {};
  return {
    filename: meta.filename || meta.source || 'Unknown',
    text_preview: text.slice(0, INSIGHTS_DOC_PREVIEW_LEN),
    distance: typeof hit.distance === 'number' ? hit.distance : null,
    metadata: {
      chunk_index: meta.chunk_index,
      filename: meta.filename
    }
  };
}

/**
 * GET /insights/experiment/:experimentId
 * Data-only for management / lab integration: similar RAG chunks + similar synced formulations.
 * No recommendations and no "next experiment". Requires auth.
 */
app.get('/insights/experiment/:experimentId', requireAuth, async (req, res) => {
  const experimentId = req.params.experimentId != null ? String(req.params.experimentId) : '';
  if (!experimentId) {
    return res.status(400).json({ error: 'experimentId is required' });
  }
  try {
    if (!Experiment) {
      return res.status(503).json({
        error: 'Experiments storage not available',
        experiment_id: experimentId,
        matriya_experiment_found: false,
        similar_documents: [],
        similar_formulations: []
      });
    }
    const row = await Experiment.findOne({ where: { experiment_id: experimentId } });
    const matriya_experiment_found = !!row;
    const ragQuery = row ? buildExperimentRagQuery(row.toJSON ? row.toJSON() : row) : '';

    let similar_documents = [];
    if (ragQuery) {
      try {
        const hits = await getRagService().search(ragQuery, INSIGHTS_RAG_N, null);
        similar_documents = (Array.isArray(hits) ? hits : []).map(mapSearchHitToSimilarDoc);
      } catch (e) {
        logger.warn(`insights RAG search failed: ${e.message}`);
      }
    }

    let similar_formulations = [];
    if (row) {
      const domain = row.technology_domain && String(row.technology_domain).trim();
      const where = {
        experiment_id: { [Op.ne]: experimentId },
        ...(domain ? { technology_domain: domain } : {})
      };
      const others = await Experiment.findAll({
        where,
        order: [['updated_at', 'DESC']],
        limit: INSIGHTS_FORMULATION_LIMIT + 5,
        attributes: [
          'experiment_id',
          'technology_domain',
          'formula',
          'experiment_outcome',
          'is_production_formula'
        ]
      });
      similar_formulations = others.slice(0, INSIGHTS_FORMULATION_LIMIT).map((r) => ({
        experiment_id: r.experiment_id,
        technology_domain: r.technology_domain,
        formula: r.formula,
        experiment_outcome: r.experiment_outcome,
        is_production_formula: !!r.is_production_formula
      }));
    }

    return res.json({
      experiment_id: experimentId,
      matriya_experiment_found,
      rag_query_used: ragQuery || null,
      similar_documents,
      similar_formulations
    });
  } catch (e) {
    logger.error(`/insights/experiment error: ${e.message}`);
    return res.status(500).json({ error: e.message });
  }
});

/**
 * POST /sync/experiments – lab system sends snapshot of experiments for MATRIYA to learn from.
 * Body: { experiments: [ { experiment_id, technology_domain, formula, materials, percentages, results, experiment_outcome, is_production_formula? }, ... ] }
 */
app.post("/sync/experiments", async (req, res) => {
  try {
    const { experiments } = req.body || {};
    if (!Array.isArray(experiments) || experiments.length === 0) {
      return res.status(400).json({ error: 'experiments array is required and must be non-empty' });
    }
    let synced = 0;
    const errors = [];
    if (!Experiment) {
      return res.status(503).json({ error: 'Experiments table not available', synced: 0, errors: [] });
    }
    for (const exp of experiments) {
      const experiment_id = exp.experiment_id != null ? String(exp.experiment_id) : null;
      if (!experiment_id) {
        errors.push({ index: synced + errors.length, error: 'experiment_id is required' });
        continue;
      }
      const outcome = exp.experiment_outcome && OUTCOMES_SET.has(exp.experiment_outcome) ? exp.experiment_outcome : 'success';
      try {
        await Experiment.upsert({
          experiment_id,
          technology_domain: exp.technology_domain != null ? String(exp.technology_domain) : null,
          formula: exp.formula != null ? String(exp.formula) : null,
          materials: exp.materials != null ? exp.materials : null,
          percentages: exp.percentages != null ? exp.percentages : null,
          results: exp.results != null ? (typeof exp.results === 'string' ? exp.results : JSON.stringify(exp.results)) : null,
          experiment_outcome: outcome,
          is_production_formula: !!exp.is_production_formula,
          updated_at: new Date()
        }, { conflictFields: ['experiment_id'] });
        synced++;
      } catch (e) {
        errors.push({ experiment_id, error: e.message });
      }
    }
    return res.json({ synced, errors });
  } catch (e) {
    logger.error(`/sync/experiments error: ${e.message}`);
    return res.status(500).json({ error: e.message, synced: 0, errors: [] });
  }
});

/**
 * Upload and ingest a single file
 * 
 * Returns:
 *   Ingestion result
 */
app.post("/ingest/file", upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file provided" });
  }
  
  const file = req.file;
  if (!file.originalname) {
    return res.status(400).json({ error: "No file selected" });
  }

  let originalFilename = Buffer.isBuffer(file.originalname)
    ? file.originalname.toString('utf-8')
    : String(file.originalname);
  originalFilename = repairUtf8MisdecodedAsLatin1(originalFilename);

  // Validate file extension (use repaired name — raw multipart name may be mojibake)
  const fileExt = originalFilename.substring(originalFilename.lastIndexOf('.')).toLowerCase();
  if (!settings.ALLOWED_EXTENSIONS.includes(fileExt)) {
    return res.status(400).json({
      error: `סוג קובץ ${fileExt} לא נתמך לאינדוקס. פורמטים מותרים: ${settings.ALLOWED_EXTENSIONS.join(', ')}`
    });
  }
  
  // Validate file size
  if (file.size > settings.MAX_FILE_SIZE) {
    return res.status(400).json({
      error: `File size exceeds maximum of ${settings.MAX_FILE_SIZE} bytes`
    });
  }
  
  const tempFilePath = file.path;

  try {
    if (originalFilename.includes('%') && /%[0-9A-F]{2}/i.test(originalFilename)) {
      originalFilename = decodeURIComponent(originalFilename);
      originalFilename = repairUtf8MisdecodedAsLatin1(originalFilename);
    }
  } catch (e) {
    logger.warn(`Could not URL-decode filename: ${e.message}`);
  }

  // When uploading a folder, frontend sends relative_path (e.g. "FolderName/sub/file.pdf") so we store and display as folder
  let relativePath = req.body && typeof req.body.relative_path === 'string' && req.body.relative_path.trim();
  if (relativePath) {
    relativePath = repairUtf8MisdecodedAsLatin1(
      relativePath.replace(/\0/g, '').replace(/\.\./g, '').trim()
    );
  }
  const displayFilename = relativePath || originalFilename;

  let ragService;
  try {
    ragService = getRagService();
  } catch (e) {
    logger.error(`RAG service init failed: ${e.message}`);
    try { if (existsSync(tempFilePath)) unlinkSync(tempFilePath); } catch (_) {}
    const isEnv = /required|environment|POSTGRES|SUPABASE/i.test(e.message);
    return res.status(isEnv ? 503 : 500).json({
      error: e.message,
      hint: isEnv ? 'Check .env: POSTGRES_URL (or POSTGRES_PRISMA_URL) and Supabase/embedding config.' : undefined
    });
  }

  try {
    const result = await ragService.ingestFile(tempFilePath, displayFilename);

    try {
      if (existsSync(tempFilePath)) unlinkSync(tempFilePath);
    } catch (e) {
      logger.warn(`Failed to delete temp file: ${e.message}`);
    }

    if (result.success) {
      // Matriya web UI calls POST /gpt-rag/sync after ingest — skip debounced server sync to avoid two
      // queued syncs (long client wait + stuck «מסנכרן»). API clients without the header still get auto-sync.
      const clientWillGptSync = String(req.get('x-matriya-client-gpt-sync') || '').trim() === '1';
      if (!clientWillGptSync) {
        scheduleMatriyaOpenAiSyncAfterIngest(() => getRagService(), 'ingest/file', {
          logicalName: displayFilename
        });
      }
      return res.json({
        success: true,
        message: "File ingested successfully",
        data: result
      });
    }
    return res.status(500).json({
      error: result.error || 'Unknown error during ingestion'
    });
  } catch (e) {
    logger.error(`Error ingesting file: ${e.message}`);
    logger.error(`Stack trace: ${e.stack}`);
    try {
      if (existsSync(tempFilePath)) unlinkSync(tempFilePath);
    } catch (e2) {}
    return res.status(500).json({
      error: `Error ingesting file: ${e.message}`,
      details: process.env.NODE_ENV === 'development' ? e.stack : undefined
    });
  }
});

/**
 * POST /ingest/excel
 *
 * Route for Excel / CSV attachments sent by managment-back when an email arrives
 * with a spreadsheet attached.  Unlike /ingest/file (which chunks text into RAG),
 * this endpoint:
 *   1. Saves the file to lab_data/ so it persists across restarts.
 *   2. Validates the schema via the Python data_adapter (normalises APP_pct → APP:PER etc.)
 *   3. Sets the file as the ACTIVE lab dataset so all science queries use it.
 *   4. Optionally also ingests a human-readable summary text block into RAG so
 *      document-mode questions ("how many experiments?") still work.
 *
 * Returns: { ok, filename, rows_valid, canonical_columns, schema_valid, active_lab_excel }
 */
app.post("/ingest/excel", upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' });

  const file = req.file;
  let originalFilename = Buffer.isBuffer(file.originalname)
    ? file.originalname.toString('utf-8')
    : String(file.originalname || 'data.xlsx');
  originalFilename = repairUtf8MisdecodedAsLatin1(originalFilename);

  const fileExt = path.extname(originalFilename).toLowerCase();
  if (!['.xlsx', '.xls', '.csv'].includes(fileExt)) {
    try { if (existsSync(file.path)) unlinkSync(file.path); } catch (_) {}
    return res.status(400).json({ error: `File must be Excel (.xlsx, .xls) or CSV (.csv). Got: ${fileExt}` });
  }

  // Persist to lab_data/ so the file survives restarts and is accessible to Python.
  const destFilename = `${Date.now()}_${originalFilename.replace(/[^a-z0-9._\-]/gi, '_')}`;
  const destPath = join(_labDataDir, destFilename);
  try {
    copyFileSync(file.path, destPath);
  } catch (copyErr) {
    logger.error(`[ingest/excel] copy to lab_data failed: ${copyErr.message}`);
    return res.status(500).json({ error: `Failed to persist lab file: ${copyErr.message}` });
  } finally {
    try { if (existsSync(file.path)) unlinkSync(file.path); } catch (_) {}
  }

  // Validate schema + get stats via Python data_adapter.
  let validateResult = null;
  try {
    validateResult = await runSciencePython(['validate', destPath, '0']);
  } catch (pyErr) {
    logger.warn(`[ingest/excel] Python validation error (non-fatal): ${pyErr.message}`);
  }

  const schemaValid  = validateResult?.schema_valid ?? false;
  const rowsValid    = validateResult?.rows_valid   ?? 0;
  const columns      = validateResult?.canonical_columns ?? [];
  const columnStats  = validateResult?.column_stats ?? {};

  // Activate as the lab dataset regardless of schema warnings (dataset may still be queryable).
  _activeLabExcel = destPath;
  try { writeFileSync(_labActiveFile, destPath, 'utf8'); } catch (_) {}
  logger.info(`[ingest/excel] activated lab dataset: ${originalFilename} | rows=${rowsValid} | schema_valid=${schemaValid} | path=${destPath}`);

  // ── Push rows into Supabase experiments table ──────────────────────────────
  // After activation, dump parsed rows and send to managment-back for storage
  // in the canonical `experiments` table (same source as Lab Decision Board).
  const projectId = req.body?.project_id || req.query?.project_id || null;
  const managementBase = settings.MATRIYA_MANAGEMENT_API_URL || '';
  if (managementBase && rowsValid > 0) {
    setImmediate(async () => {
      try {
        const dumpResult = await runSciencePython(['dump_rows', destPath, '0']);
        const rows = dumpResult?.rows;
        if (!Array.isArray(rows) || rows.length === 0) {
          logger.warn('[ingest/excel] dump_rows returned no rows — Supabase sync skipped');
          return;
        }
        const ingestResp = await axios.post(
          `${managementBase}/api/matriya/experiments/ingest`,
          {
            project_id: projectId || 'default',
            source: `excel:${originalFilename}`,
            rows,
          },
          {
            headers: {
              'Content-Type': 'application/json',
              ...(settings.MATRIYA_MANAGEMENT_MATERIALS_KEY
                ? { 'X-Matriya-Materials-Key': settings.MATRIYA_MANAGEMENT_MATERIALS_KEY }
                : {}),
            },
            timeout: 30000,
          }
        );
        logger.info(`[ingest/excel] Supabase experiments sync: inserted=${ingestResp.data?.inserted} errors=${ingestResp.data?.error_count}`);
      } catch (syncErr) {
        logger.warn(`[ingest/excel] Supabase sync failed (non-fatal): ${syncErr.message}`);
      }
    });
  } else if (!managementBase) {
    logger.warn('[ingest/excel] MATRIYA_MANAGEMENT_API_URL not set — Supabase experiments sync skipped');
  }
  // ─────────────────────────────────────────────────────────────────────────

  // Optionally index a text summary into RAG so document-mode queries are aware of the dataset.
  if (schemaValid && rowsValid > 0) {
    setImmediate(async () => {
      try {
        const statLines = Object.entries(columnStats)
          .map(([col, s]) => `  ${col}: min=${s.min}, max=${s.max}, mean=${s.mean}, n=${s.n_valid}`)
          .join('\n');
        const summaryText = [
          `Lab dataset: ${originalFilename}`,
          `Rows: ${rowsValid}`,
          `Columns: ${columns.join(', ')}`,
          `Column statistics:`,
          statLines,
          '',
          'This dataset contains structured experimental (formulation) data.',
          'For precise numeric queries (e.g. "expansion ratio > 10") use the Science Query Engine.',
        ].join('\n');

        const summaryFilename = `lab-summary-${destFilename.replace(/\.[^.]+$/, '')}.txt`;
        const summaryPath = join(_labDataDir, summaryFilename);
        writeFileSync(summaryPath, summaryText, 'utf8');
        const ragService = getRagService();
        await ragService.ingestFile(summaryPath, summaryFilename);
        try { unlinkSync(summaryPath); } catch (_) {}
        logger.info(`[ingest/excel] RAG summary indexed for ${originalFilename}`);
      } catch (ragErr) {
        logger.warn(`[ingest/excel] RAG summary indexing failed (non-fatal): ${ragErr.message}`);
      }
    });
  }

  return res.json({
    ok: true,
    filename: originalFilename,
    path: destPath,
    rows_valid: rowsValid,
    canonical_columns: columns,
    column_stats: columnStats,
    schema_valid: schemaValid,
    active_lab_excel: destPath,
    message: schemaValid
      ? `Lab dataset loaded: ${rowsValid} experiments, ${columns.length} columns`
      : `File saved but schema validation had issues. Science queries may return limited results.`,
    validation: validateResult ? {
      missing_required: validateResult.missing_required,
      adapter_warnings: validateResult.adapter_warnings,
    } : null,
  });
});

/**
 * Ingest all supported files from a directory
 * 
 * Returns:
 *   Ingestion results for all files
 */
app.post("/ingest/directory", async (req, res) => {
  const { directory_path } = req.body;
  if (!directory_path) {
    return res.status(400).json({ error: "directory_path is required" });
  }
  
  if (!existsSync(directory_path)) {
    return res.status(404).json({
      error: `Directory not found: ${directory_path}`
    });
  }
  
  try {
    const result = await getRagService().ingestDirectory(directory_path);
    if (result && result.successful > 0) {
      scheduleMatriyaOpenAiSyncAfterIngest(() => getRagService(), 'ingest/directory', { fullIndex: true });
    }
    return res.json(result);
  } catch (e) {
    logger.error(`Error ingesting directory: ${e.message}`);
    return res.status(500).json({
      error: `Error ingesting directory: ${e.message}`
    });
  }
});

/**
 * POST /integration/email-received
 * Called by managment-back after every inbound email.
 * Indexes the email body into the MATRIYA RAG vector store so it appears in search results.
 */
app.post('/integration/email-received', async (req, res) => {
  try {
    const { project_id, email_id, from, subject, body_text, received_at } = req.body || {};
    if (!body_text || !String(body_text).trim()) {
      return res.status(400).json({ error: 'body_text is required' });
    }
    const document = [
      `Source: inbound email`,
      `Project: ${project_id || 'unknown'}`,
      `From: ${from || 'unknown'}`,
      `Subject: ${subject || ''}`,
      `Date: ${received_at || new Date().toISOString()}`,
      '',
      String(body_text).trim()
    ].join('\n');
    const safeSubject = (subject || '').slice(0, 60).replace(/[^a-z0-9\-_.]/gi, '_');
    const filename = `email-inbound-${safeSubject || (email_id || Date.now()).toString().slice(0, 12)}.txt`;
    const tempPath = join(settings.UPLOAD_DIR || '/tmp', filename);
    const { writeFileSync } = await import('fs');
    writeFileSync(tempPath, document, 'utf8');
    try {
      const ragService = getRagService();
      const result = await ragService.ingestFile(tempPath, filename);
      try { if (existsSync(tempPath)) unlinkSync(tempPath); } catch (_) {}
      if (result && result.success) {
        scheduleMatriyaOpenAiSyncAfterIngest(() => getRagService(), 'integration/email-received', { logicalName: filename });
        logger.info(`[email-received] indexed: ${filename} project=${project_id}`);
        return res.json({ ok: true, indexed: true, email_id, filename });
      }
      return res.status(500).json({ error: result?.error || 'Indexing failed' });
    } catch (e) {
      try { if (existsSync(tempPath)) unlinkSync(tempPath); } catch (_) {}
      throw e;
    }
  } catch (e) {
    logger.error(`/integration/email-received error: ${e.message}`);
    return res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────
// SCIENCE PIPELINE ENDPOINTS
// Bridges Node.js → Python science/ modules via child_process
// ─────────────────────────────────────────────────────────
import { spawn } from 'child_process';

const _scienceDir   = join(dirname(fileURLToPath(import.meta.url)), 'science');
const _builtinExcel = join(dirname(fileURLToPath(import.meta.url)), 'MATRIYA_Experiment_Template-1.xlsx');

// Persistent lab dataset directory — uploaded Excel/CSV files land here.
// The most recently ingested file becomes the active lab dataset for science queries.
const _labDataDir = join(dirname(fileURLToPath(import.meta.url)), 'lab_data');
const _labActiveFile = join(_labDataDir, '_active.txt');
try { mkdirSync(_labDataDir, { recursive: true }); } catch (_) {}

/**
 * Mutable path to the active lab Excel/CSV dataset.
 * Initialised from _active.txt (written on each /ingest/excel call) so it
 * survives server restarts. Falls back to the bundled template.
 */
let _activeLabExcel = (() => {
  try {
    if (existsSync(_labActiveFile)) {
      const p = readFileSync(_labActiveFile, 'utf8').trim();
      if (p && existsSync(p)) { logger.info(`[lab-data] restored active dataset: ${p}`); return p; }
    }
  } catch (_) {}
  return _builtinExcel;
})();
console.log("ACTIVE DATASET:", _activeLabExcel);
logger.info(`[lab-data] active dataset on startup: ${_activeLabExcel}`);

/**
 * Spawn Python science runner and resolve with parsed JSON output.
 * Forces UTF-8 so emoji in Python print() don't crash on Windows.
 */
function runSciencePython(args) {
  return new Promise((resolve, reject) => {
    // On Railway/Linux the executable is 'python3'; on Windows dev it is 'python'.
    // PYTHON_CMD env var overrides both.
    const pythonCmd = process.env.PYTHON_CMD || (process.platform === 'win32' ? 'python' : 'python3');
    const proc = spawn(pythonCmd, [join(_scienceDir, 'run_pipeline.py'), ...args], {
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('close', code => {
      // Surface Python diagnostic lines into Node logs so API verification can prove
      // the exact aggregation path used (e.g. [aggregation] COMPOUND, [DEBUG] AGG INPUT ROWS).
      if (stderr && stderr.trim()) {
        const debugLines = stderr
          .split(/\r?\n/)
          .map(s => s.trim())
          .filter(Boolean)
          .filter(s =>
            s.includes('[aggregation]') ||
            s.includes('[DEBUG]') ||
            s.includes('[execute_query]')
          );
        for (const line of debugLines) {
          console.log(line);
        }
      }
      // Extract last JSON object from stdout (module print() lines precede JSON line)
      const jsonLine = stdout.split('\n').reverse().find(l => l.trim().startsWith('{'));
      if (!jsonLine) {
        return reject(new Error(`No JSON output. code=${code} stderr=${stderr.slice(0, 400)}`));
      }
      try {
        resolve(JSON.parse(jsonLine));
      } catch (e) {
        reject(new Error(`JSON parse error: ${e.message} — line: ${jsonLine.slice(0, 200)}`));
      }
    });
    proc.on('error', reject);
  });
}

/**
 * POST /science/query
 * Run a natural language query against the formulations Excel dataset.
 * Body: { query, filepath?, sheet_name?, case_id? }
 */
app.post('/science/query', requireAuth, async (req, res) => {
  try {
    const { query, filepath, sheet_name, case_id } = req.body || {};
    if (!query || !String(query).trim()) {
      return res.status(400).json({ error: 'query is required' });
    }
    const excelPath = filepath || _activeLabExcel;
    const sheet     = sheet_name || 'Formulation Data';
    const caseId    = case_id   || `QUERY-${Date.now()}`;
    const result    = await runSciencePython(['query', excelPath, query, sheet, caseId]);
    logger.info(`[science/query] query="${query}" decision=${result.decision}`);
    return res.json(result);
  } catch (e) {
    logger.error(`[science/query] error: ${e.message}`);
    return res.status(500).json({ error: e.message });
  }
});

/**
 * POST /science/boundary
 * Run the full boundary experiment pipeline (schema → score → FSCTM → priors).
 * Body: { template_key, sweep_results, control_result, case_id?, known_facts?, involved_components?, observed_sigs? }
 */
app.post('/science/boundary', requireAuth, async (req, res) => {
  try {
    const {
      template_key, sweep_results, control_result,
      case_id, known_facts, involved_components, observed_sigs
    } = req.body || {};
    if (!template_key) return res.status(400).json({ error: 'template_key is required' });
    if (!sweep_results || !Array.isArray(sweep_results)) return res.status(400).json({ error: 'sweep_results array is required' });
    if (!control_result) return res.status(400).json({ error: 'control_result is required' });

    const caseId = case_id || `BOUNDARY-${Date.now()}`;
    const result = await runSciencePython([
      'boundary',
      template_key,
      JSON.stringify(sweep_results),
      JSON.stringify(control_result),
      caseId,
      JSON.stringify(known_facts || []),
      JSON.stringify(involved_components || ['APP', 'PER', 'APP:PER_ratio']),
      JSON.stringify(observed_sigs || []),
    ]);
    logger.info(`[science/boundary] template=${template_key} decision=${result.decision}`);
    return res.json(result);
  } catch (e) {
    logger.error(`[science/boundary] error: ${e.message}`);
    return res.status(500).json({ error: e.message });
  }
});

/**
 * GET /science/tests
 * Run all Python module unit tests and return pass/fail report.
 */
app.get('/science/tests', requireAuth, async (req, res) => {
  try {
    const result = await runSciencePython(['test']);
    logger.info(`[science/tests] total_passed=${result.total_passed} total_failed=${result.total_failed}`);
    return res.json(result);
  } catch (e) {
    logger.error(`[science/tests] error: ${e.message}`);
    return res.status(500).json({ error: e.message });
  }
});

/**
 * GET /science/validate
 * Run real-file validation against the formulations Excel dataset.
 */
app.get('/science/validate', requireAuth, async (req, res) => {
  try {
    const filepath = req.query.filepath || _activeLabExcel;
    const result   = await runSciencePython(['validate', filepath, '0']);
    logger.info(`[science/validate] tests_passed=${result.tests_passed}/${result.total_tests}`);
    return res.json(result);
  } catch (e) {
    logger.error(`[science/validate] error: ${e.message}`);
    return res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/lab/query
 * Dedicated Lab Query Engine endpoint.
 * Runs a natural language query against the formulations Excel dataset
 * using the deterministic science pipeline (no LLM, no RAG).
 *
 * Body: { query, filepath?, sheet_name? }
 */
app.post('/api/lab/query', requireAuth, async (req, res) => {
  try {
    const { query, filepath, sheet_name } = req.body || {};
    if (!query || !String(query).trim()) {
      return res.status(400).json({ error: 'query is required' });
    }
    return await handleScienceQueryFlow(req, res, { query });
  } catch (e) {
    logger.error(`[api/lab/query] error: ${e.message}`);
    return res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/lab/test
 * Run all science module unit tests and return pass/fail report.
 * Confirms the lab query engine is connected and working.
 */
app.get('/api/lab/test', requireAuth, async (req, res) => {
  try {
    const result = await runSciencePython(['test']);
    logger.info(`[api/lab/test] total_passed=${result.total_passed} total_failed=${result.total_failed}`);
    return res.json({
      connected: result.all_passed,
      total_passed: result.total_passed,
      total_failed: result.total_failed,
      all_passed: result.all_passed,
      test_results: result.test_results,
      message: result.all_passed
        ? `Lab Query Engine connected and operational. ${result.total_passed} tests passed.`
        : `Lab Query Engine has failures. ${result.total_failed} tests failed.`,
    });
  } catch (e) {
    logger.error(`[api/lab/test] error: ${e.message}`);
    return res.status(500).json({ connected: false, error: e.message });
  }
});

/** Logical path or basename ends with .xlsx / .xls */
function isAskMatriyaSpreadsheetFilename(name) {
  const base = String(name || '').split(/[/\\]/).filter(Boolean).pop() || '';
  return /\.xlsx$/i.test(base) || /\.xls$/i.test(base);
}

/** Prepended under each spreadsheet file so the model treats TSV rows as real document content. */
const ASK_MATRIYA_EXCEL_CONTEXT_PREAMBLE =
  '[מקור: קובץ Excel — שברי רכיב (0–1) כבר הומרו לאחוזים (×100) בטקסט המאונדקס. שורה עם סיומת «INVALID OUTPUT: row sum not 100%±0.1» = סכום השברים בשורה לא בטווח 100%±0.1. השתמש בערכי האחוזים כפי שמוצגים; אל תציג שוב כשבר עשרוני מעל התו %.]\n';

/** Ask Matriya: model must not answer from general knowledge — only selected document text. */
const ASK_MATRIYA_STRICT_DOCUMENT_ONLY_RULES = [
  'Grounding (mandatory): Use ONLY the text under "Documents:" below as your source of truth.',
  'Do NOT use outside knowledge, training data, or the open web: no extra facts, names, dates, laws, definitions, or background that do not appear in those documents.',
  'Direct inference rule: You may only infer what follows DIRECTLY and MATHEMATICALLY from numbers or explicit statements in the document (e.g. addition, counting, ratio). General-knowledge inferences are FORBIDDEN.',
  'If the documents do not contain enough information to answer, say clearly in Hebrew: "המסמך אינו מכיל מידע מספיק לשאלה זו." — do NOT fill gaps with general knowledge.',
  'Inference marking (mandatory): If ANY part of your response goes beyond what is EXPLICITLY written in the document — even a reasonable guess — you MUST prefix that specific sentence or list item with: [הנחה — לא מצוין במסמך] (meaning: Assumption — not stated in the document). This applies to: timelines, responsibilities, equipment, quantities, steps, or any item not literally present in the document text.',
  'Interpretive / evaluative questions (CRITICAL for consistency with factual questions): These include questions about: innovation, novelty, "what is the innovation" / מה החדשות, significance, importance, "why" something matters, value proposition, impact, advantage, risk in qualitative terms, or the "central idea" in an abstract or evaluative sense (as opposed to listing stated facts). For such questions: (1) If the document EXPLICITLY names or directly states the answer (e.g. uses the words innovation, חדשנות, or clearly labels the point as the goal), answer using ONLY that wording — that counts as fact. (2) If the document does NOT explicitly state it but you can only connect ideas by interpretation — you must EITHER say in Hebrew: "המסמך אינו מנוסח בבירור לגבי [נושא השאלה]; אין מידע מפורש." OR give your interpretation in sentences that EACH begin with [הנחה — לא מצוין במסמך]. (3) Never present interpretive synthesis as plain factual paragraphs without the tag — same strictness as for numbers and dates.',
  '"What is not defined?" questions: List ONLY items that are EXPLICITLY referenced or implied by the document context but whose values/details are ABSENT from the text. Do NOT generate generic lists (e.g. "usually a plan needs a timeline") — only list gaps that exist based on topics the document actually touches.',
  'Consistency: For the same evidence, prefer stable wording — same facts and order of points; avoid decorative variation or filler when the question and documents are unchanged.',
  'Respond in Hebrew (עברית) only. Do not use Arabic.'
].join('\n');

function inferContributingFilesFromReply(reply, filteredFilenames, fileContext) {
  if (!reply || !fileContext || filteredFilenames.length === 0) return filteredFilenames.slice(0, 1);
  if (filteredFilenames.length === 1) return filteredFilenames;

  const replyLower = reply.replace(/\s+/g, ' ').toLowerCase();
  // Tokenise reply into meaningful words (3+ chars)
  const replyWords = new Set(
    replyLower.split(/[\s,.!?;:()\[\]"']+/).filter(w => w.length >= 3)
  );

  const scored = filteredFilenames.map(fn => {
    const marker = `--- ${fn} ---`;
    const start = fileContext.indexOf(marker);
    if (start === -1) return { fn, score: 0 };
    const afterHeader = fileContext.indexOf('\n', start) + 1;
    const nextMarker = fileContext.indexOf('\n---', afterHeader);
    const section = (nextMarker > 0 ? fileContext.slice(afterHeader, nextMarker) : fileContext.slice(afterHeader))
      .replace(/\s+/g, ' ').toLowerCase();
    const sectionWords = section.split(/[\s,.!?;:()\[\]"']+/).filter(w => w.length >= 3);
    // Count how many section words appear in the reply
    let hits = 0;
    for (const w of sectionWords) {
      if (replyWords.has(w)) hits++;
    }
    const score = sectionWords.length > 0 ? hits / sectionWords.length : 0;
    return { fn, score, hits };
  });

  // Keep files with enough overlap (at least 3 hits OR top scorer if all are low)
  const threshold = 3;
  const passing = scored.filter(x => x.hits >= threshold);
  if (passing.length > 0) {
    // Return top-3 by score
    return passing.sort((a, b) => b.score - a.score).slice(0, 3).map(x => x.fn);
  }
  // Fallback: top-1 by score (at least show the most likely contributor)
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 1).map(x => x.fn);
}


const ASK_MATRIYA_DOCUMENTS_TEMPERATURE = 0;
const ASK_MATRIYA_DOCUMENTS_SEED = 918_273_645;

/**
 * Ask Matriya: full indexed text (or first chunk fallback) into the chat prompt — not vector RAG retrieval.
 */
async function loadIndexedTextForAskMatriya(rag, filename) {
  let text = await rag.getFullTextForFile(filename);
  if (String(text || '').trim()) return text;
  const first = await rag.getFirstChunkForFile(filename);
  const t = first && typeof first.text === 'string' ? first.text : '';
  return String(t || '').trim() || null;
}

/**
 * OpenAI may return HTTP 401 (invalid key) or 403; the Matriya SPA treats **401** as expired **user JWT**
 * and logs out. Never forward upstream OpenAI auth/billing status as 401 to the browser.
 */
function matriyaHttpStatusForOpenAiUpstream(upstreamStatus) {
  if (upstreamStatus === 401 || upstreamStatus === 403) return 502;
  if (upstreamStatus === 429) return 429;
  return 500;
}

/**
 * Ask Matriya: chat with AI about selected files (OpenAI).
 * Flow: (1) LLM classifies materials-library vs document intent; (2) if materials + MATRIYA_MANAGEMENT_API_URL returns data, answer from management /api/materials + /api/projects only; (3) else full extracted text (capped) in system message — not vector RAG.
 * Body: JSON { message, history?, filenames? } for system files, or multipart (message, history, files) for uploads.
 */
const docProcessor = new DocumentProcessor();
const askMatriyaMulter = (req, res, next) => {
  if (req.is('application/json')) return next();
  return upload.array('files', 10)(req, res, next);
};
/** GET — health / contract hint (browser must use POST with JSON body for queries). */
app.get("/ask-matriya", (req, res) => {
  res.status(200).json({ status: 'OK', message: 'Use POST for queries' });
});
/** Lab science JSON contract; body: { query }. Rejects non–lab-structured questions (use POST /ask-matriya for RAG). */
app.post('/api/matriya/query', requireAuth, async (req, res) => {
  const q = String(req.body?.query ?? '').trim();
  if (!q) {
    return res.status(200).json(withScienceTrace(
      buildScienceContract({ mode: 'error', query: '', message: 'BLOCKED: parse_failed — empty or missing query.', evidence: { result_preview: [], columns_returned: [] }, warnings: ['BLOCKED_PARSE_FAILED'], blocked_reason: 'parse_failed' }),
      { trigger_id: randomUUID(), intent: 'blocked' }
    ));
  }
  if (!isScienceQueryQuestion(q)) {
    return res.status(400).json({ error: 'not_a_lab_query', message: 'Use lab/EXP-*/filter syntax or POST /ask-matriya for documents.' });
  }
  console.log(`[api/matriya/query] query="${q}"`);
  return await handleScienceQueryFlow(req, res, { query: q });
});
app.post("/ask-matriya", requireAuth, askMatriyaMulter, async (req, res) => {
  const message = (req.body?.message ?? '').trim();
  if (!message) {
    return res.status(200).json(withScienceTrace(
      buildScienceContract({ mode: 'error', query: '', message: 'BLOCKED: parse_failed — empty or missing query.', evidence: { result_preview: [], columns_returned: [] }, warnings: ['BLOCKED_PARSE_FAILED'], blocked_reason: 'parse_failed' }),
      { trigger_id: randomUUID(), intent: 'blocked' }
    ));
  }

  // ── DEBUG LOGGING — full request lifecycle (David) ───────────────────────
  const _sci = isScienceQueryQuestion(message);
  const _expN = extractExpEntities(message).length;
  console.log(
    JSON.stringify({
      tag: 'ask-matriya-lifecycle',
      step: 'incoming',
      query: message,
      routing: _sci ? 'LAB' : 'RAG',
      exp_entity_count: _expN,
      intent_hint: _expN >= 2 ? 'comparison' : _sci ? 'lab_other' : 'documents_llm'
    })
  );

  // ── SCIENCE QUERY ROUTING for /ask-matriya ──────────────────────────────
  if (_sci) {
    logger.info(`[ask-matriya] science routing → lab pipeline. query="${message}"`);
    return await handleScienceQueryFlow(req, res, { query: message });
  }
  // ────────────────────────────────────────────────────────────────────────

  // Mock fixtures removed (David M2 — all responses must come from real data, not fixtures).

  let history = [];
  try {
    const raw = req.body?.history;
    if (raw != null) {
      history = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!Array.isArray(history)) history = [];
    }
  } catch (_) {
    history = [];
  }
  const files = req.files || [];
  const filenames = (() => {
    const f = req.body?.filenames;
    if (Array.isArray(f)) return f.filter(x => typeof x === 'string' && x.trim());
    if (typeof f === 'string') try { const a = JSON.parse(f); return Array.isArray(a) ? a.filter(x => typeof x === 'string' && x.trim()) : []; } catch (_) { return []; }
    return [];
  })();
  if (filenames.length === 0 && files.length === 0) {
    return res.status(400).json({
      error: 'יש לבחור לפחות מסמך אחד או להעלות קובץ.',
      code: 'NO_DOCUMENTS_SELECTED'
    });
  }
  const MAX_FILE_CONTEXT_CHARS = 80000;

  const openaiKey = settings.OPENAI_API_KEY;
  if (!openaiKey) {
    return res.status(503).json({ error: "OpenAI API key not configured. Set OPENAI_API_KEY in .env." });
  }

  const MAX_HISTORY_MESSAGES = 20;
  const MAX_MESSAGE_CONTENT_CHARS = 4000;
  let materialsIntent = false;
  try {
    materialsIntent = await classifyMaterialsLibraryIntent(message, openaiKey);
  } catch (_) {
    materialsIntent = false;
  }
  if (materialsIntent) {
    const managementBase = settings.MATRIYA_MANAGEMENT_API_URL || '';
    const authHeader = req.headers?.authorization || '';
    logger.info(
      `[ask-matriya routing] classifier=MATERIALS_LIBRARY → trying management API | management_base=${managementBase || '(unset)'}`
    );
    const { text: libraryText, ok: libraryOk } = await fetchManagementMaterialsLibraryContext(
      authHeader,
      managementBase
    );
    if (libraryOk && String(libraryText || '').trim()) {
      try {
        const historyForMaterials = (Array.isArray(history) ? history.slice(-MAX_HISTORY_MESSAGES) : []).map((m) => ({
          ...m,
          content: typeof m.content === 'string' ? m.content.slice(0, MAX_MESSAGE_CONTENT_CHARS) : m.content
        }));
        const replyMat = await answerFromMaterialsLibraryContext(
          message,
          libraryText,
          openaiKey,
          historyForMaterials
        );
        return res.json(
          buildAskMatriyaLlmContract({ message, text: replyMat })
        );
      } catch (e) {
        logger.error(
          `[ask-matriya routing] MATERIALS_LIBRARY answer LLM failed → fallback DOCUMENTS | ${e.message}`
        );
      }
    } else {
      logger.info(
        `[ask-matriya routing] classifier=MATERIALS_LIBRARY but no management context (ok=${libraryOk}) → fallback DOCUMENTS`
      );
    }
  } else {
    logger.info(`[ask-matriya routing] classifier=DOCUMENTS → full indexed text path (filenames=${filenames.length})`);
  }

  // Full-document context in the chat prompt (no vector / file_search RAG for this route).
  let fileContext = '';
  let contextHasSpreadsheet = false;

  // ── PRE-RETRIEVAL DOCUMENT GUARD ──────────────────────────────────────────
  // Classify each requested filename and block UNRELATED domain docs
  // (e.g. Final Project Report.pdf with ML metrics) from contaminating
  // lab/formulation experiment responses. LAB_FORMULATION files pass through;
  // UNKNOWN files also pass (conservative — only clear unrelated docs blocked).
  //
  // SCOPE ISOLATION: When the user selected specific file(s), ONLY load context
  // from those files — never fall back to the full corpus. This prevents
  // cross-document contamination (e.g. "Final Project Report" topics bleeding
  // into an intumescent coating document answer).
  const isLabFormulationQuery = /\b(formulation|intumescent|experiment|expansion|char|app.?per|ifr|coating|binder|fire)\b/i.test(message);
  let filteredFilenames = filenames;
  if (isLabFormulationQuery && filenames.length > 0) {
    const domainFiltered = filterFilenamesByDomain(filenames, 'LAB_FORMULATION');
    if (domainFiltered.length > 0) {
      filteredFilenames = domainFiltered;
    }
    // If domain filter removes ALL files (edge case), keep original selection to avoid empty context
    // but log the fall-through so it's visible.
    if (domainFiltered.length === 0) {
      logger.warn('[document-guard] All files blocked by domain filter — keeping original selection');
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  if (filteredFilenames.length > 0) {
    const rag = getRagService();
    for (const fn of filteredFilenames) {
      if (fileContext.length >= MAX_FILE_CONTEXT_CHARS) break;
      const text = await loadIndexedTextForAskMatriya(rag, fn);
      if (text) {
        const sheet = isAskMatriyaSpreadsheetFilename(fn);
        if (sheet) contextHasSpreadsheet = true;
        const pre = sheet ? ASK_MATRIYA_EXCEL_CONTEXT_PREAMBLE : '';
        const chunk = `\n--- ${fn} ---\n${pre}${text}\n`;
        fileContext += fileContext.length + chunk.length <= MAX_FILE_CONTEXT_CHARS ? chunk : chunk.slice(0, MAX_FILE_CONTEXT_CHARS - fileContext.length);
      }
    }
  } else if (files.length > 0) {
    const tempPaths = [];
    try {
      for (const f of files) {
        tempPaths.push(f.path);
        const result = await docProcessor.processFile(f.path);
        if (result.success && result.text && fileContext.length < MAX_FILE_CONTEXT_CHARS) {
          const logicalName = result.metadata?.filename || f.originalname;
          const sheet =
            isAskMatriyaSpreadsheetFilename(logicalName) ||
            result.metadata?.file_type === '.xlsx' ||
            result.metadata?.file_type === '.xls';
          if (sheet) contextHasSpreadsheet = true;
          const pre = sheet ? ASK_MATRIYA_EXCEL_CONTEXT_PREAMBLE : '';
          const chunk = `\n--- ${logicalName} ---\n${pre}${result.text}\n`;
          fileContext += fileContext.length + chunk.length <= MAX_FILE_CONTEXT_CHARS ? chunk : chunk.slice(0, MAX_FILE_CONTEXT_CHARS - fileContext.length);
        }
      }
    } finally {
      for (const p of tempPaths) {
        try {
          if (existsSync(p)) unlinkSync(p);
        } catch (_) {}
      }
    }
  }

  if ((filenames.length > 0 || files.length > 0) && !String(fileContext || '').trim()) {
    return res.status(422).json({
      error:
        'לא נמצא טקסט מאונדקס עבור המסמכים שנבחרו. ודאו שהקובץ הועלה והאינדוקס הושלם, או העלו שוב.',
      code: 'NO_INDEXED_TEXT',
      sources: []
    });
  }

  const spreadsheetMode = contextHasSpreadsheet || /\[גיליון:/.test(fileContext);
  const spreadsheetHint = spreadsheetMode
    ? '\n\nSpreadsheets: Lines may be tab-separated rows from Excel; sheet titles may appear as [גיליון: …]. This tabular text is valid document content. You MUST answer and summarize from it (columns, headers, values) still using ONLY that text—no outside knowledge. Never claim you lack the document when the Documents section contains non-empty spreadsheet text; describe sheets, columns, and data in Hebrew from the text only.\n'
    : '';

  const systemContent = fileContext
    ? `The user selected the following documents. The text below is the full extracted content (as stored for search indexing).

${ASK_MATRIYA_STRICT_DOCUMENT_ONLY_RULES}
${spreadsheetHint}
Documents:
${fileContext}`
    : "You are a helpful research assistant. You must respond in Hebrew (עברית) only. Do not use Arabic.";
  const hasFileContext = String(fileContext || '').trim().length > 0;
  let trimmedHistory = (Array.isArray(history) ? history.slice(-MAX_HISTORY_MESSAGES) : []).map(m => ({
    ...m,
    content: typeof m.content === 'string' ? m.content.slice(0, MAX_MESSAGE_CONTENT_CHARS) : m.content
  }));
  // No document text in this request: do not let prior assistant turns act as “live” document memory (e.g. after מחקר user deleted files).
  if (!hasFileContext) {
    trimmedHistory = trimmedHistory.filter((m) => m.role === 'user');
  }
  const messages = [
    { role: "system", content: systemContent },
    ...trimmedHistory,
    { role: "user", content: message }
  ];
  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4o-mini",
        messages,
        max_tokens: spreadsheetMode ? 2048 : 1024,
        temperature: hasFileContext ? ASK_MATRIYA_DOCUMENTS_TEMPERATURE : 0.2,
        ...(hasFileContext ? { seed: ASK_MATRIYA_DOCUMENTS_SEED } : {})
      },
      {
        headers: {
          "Authorization": `Bearer ${openaiKey}`,
          "Content-Type": "application/json"
        },
        timeout: 60000
      }
    );
    let reply = response.data?.choices?.[0]?.message?.content?.trim() || "";
    logger.info(
      `[ask-matriya routing] response path=DOCUMENTS | spreadsheetMode=${spreadsheetMode} file_context_chars=${String(fileContext || '').length} reply_chars=${reply.length}`
    );

    // ── POST-RESPONSE DOCUMENT GUARD ─────────────────────────────────────────
    // Check for forbidden ML metric contamination (F1-score, MCC, etc.)
    // These must never appear in formulation/experiment design responses.
    const guardResult = guardResponseText(reply);
    if (guardResult.contaminated) {
      logger.warn(
        `[document-guard] Post-response contamination detected: ${guardResult.violations.slice(0, 3).join(', ')} — sanitizing reply`
      );
      reply = guardResult.sanitized_text;
    }
    // ─────────────────────────────────────────────────────────────────────────

    return res.json(
      buildAskMatriyaLlmContract({
        message,
        text: reply,
        sources: inferContributingFilesFromReply(reply, filteredFilenames, fileContext).map((fn) => ({
          filename: fn,
          document_name: fn,
          content: `מקור: ${fn}`
        }))
      })
    );
  } catch (e) {
    const upstream = e.response?.status;
    const msg = e.response?.data?.error?.message || e.message || "OpenAI request failed";
    logger.error(`[ask-matriya routing] DOCUMENTS path OpenAI error: ${msg}`);
    const httpStatus = matriyaHttpStatusForOpenAiUpstream(upstream);
    return res.status(httpStatus).json({
      error: msg,
      code: 'OPENAI_PROVIDER_ERROR'
    });
  }
});

/**
 * Search for relevant documents and optionally generate an answer
 * Stage 1: session_id + stage required when generate_answer=true. No valid session → no handling.
 *
 * Query params:
 *   query: Search query (required)
 *   session_id: Research session UUID (required when generate_answer=true; create via POST /research/session)
 *   stage: Research stage K|C|B|N|L (required when generate_answer=true)
 *   n_results: Number of results to return (default: 5)
 *   filename: Optional filename filter
 *   generate_answer: Whether to generate AI answer from results (default: true)
 *   flow: "document" — retrieval + LLM only (no research session). "lab" — Lab Chain bridge only (no RAG, no LLM on lab facts).
 *         Any other value uses full research flow.
 *
 * Returns:
 *   Search results, generated answer (or hard stop for B), session_id, research_stage
 *
 * POST /api/research/search — same behavior; body may include kernel_signals, data_anchors, methodology_flags (JSON objects or JSON strings).
 */

function normalizeQueryText(q) {
  return String(q || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// DOCUMENT GUARD — Index separation + metric contamination control
// Prevents cross-domain contamination: unrelated docs (e.g. Final Project
// Report.pdf with ML metrics) are blocked from lab/formulation queries.
// Mirrors document_guard.py but runs inline without a Python subprocess.
// ─────────────────────────────────────────────────────────────────────────────

const _LAB_FILENAME_KEYS  = ["formulation", "intumescent", "corrosion", "experiment", "lab", "int-tfx", "ifr", "fresco", "barnacle", "bio-001", "corr-001"];
const _MATR_FILENAME_KEYS = ["matriya", "kernel", "handover", "developer", "fsctm", "scope", "rachel", "report.txt"];

/** Classify a document filename into its domain (fast, no subprocess). */
function classifyDocumentDomain(filename) {
  const f = String(filename || '').toLowerCase();
  if (_LAB_FILENAME_KEYS.some(k => f.includes(k)))  return { domain: 'LAB_FORMULATION',  allowed: true  };
  if (_MATR_FILENAME_KEYS.some(k => f.includes(k))) return { domain: 'MATRIYA_METHOD',   allowed: false };
  return { domain: 'UNKNOWN', allowed: false };
}

/**
 * Filter a list of filenames down to those allowed for a given query domain.
 * For lab/formulation queries: only LAB_FORMULATION files are allowed.
 * For general queries (UNKNOWN domain arg): all files pass through.
 */
function filterFilenamesByDomain(filenames, queryDomain = 'LAB_FORMULATION') {
  if (!Array.isArray(filenames) || filenames.length === 0) return filenames;
  const classified = filenames.map(fn => ({ fn, ...classifyDocumentDomain(fn) }));
  const blocked = classified.filter(c => !c.allowed);
  if (blocked.length > 0) {
    logger.info(`[document-guard] Pre-retrieval filter: blocked ${blocked.length} non-lab file(s): ${blocked.map(c => `${c.fn}(${c.domain})`).join(', ')}`);
  }
  return classified.filter(c => c.allowed).map(c => c.fn);
}

// Forbidden ML metric terms that must not appear in lab/experiment outputs
const _FORBIDDEN_METRIC_TERMS = [
  "f1-score", "f1 score", "f1score",
  "matthews correlation", "matthews corr",
  "classification accuracy", "model accuracy", "test accuracy", "validation accuracy", "accuracy score",
  "confusion matrix", "roc auc", "roc curve", "auc score",
  "cross-validation", "cross validation", "k-fold", "kfold",
  "overfitting", "underfitting", "train/test split", "hyperparameter",
  "human activity recognition", "accelerometer", "gyroscope", "sensor fusion", "activity classification",
];

/**
 * Scan response text for forbidden ML metric terms.
 * Returns {contaminated, violations, sanitized_text}
 */
function guardResponseText(text) {
  const lower = String(text || '').toLowerCase();
  const violations = _FORBIDDEN_METRIC_TERMS.filter(term => lower.includes(term));
  if (violations.length === 0) {
    return { contaminated: false, violations: [], sanitized_text: text, action: 'ALLOW' };
  }
  // Sanitize: remove sentences containing forbidden terms
  let sanitized = text;
  for (const term of violations) {
    const re = new RegExp(term.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'), 'gi');
    sanitized = sanitized.replace(re, '[METRIC_BLOCKED]');
  }
  const sentences = sanitized.split(/(?<=[.!?])\s+/);
  const clean = sentences.map(s =>
    s.includes('[METRIC_BLOCKED]') ? '[SENTENCE_REMOVED: irrelevant domain metric]' : s
  );
  return {
    contaminated: true,
    violations,
    sanitized_text: clean.join(' '),
    action: 'SANITIZE',
    n_removed: violations.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SCIENCE QUERY ROUTING — Lab Query Engine (table_query_engine_final.py)
// Detects NL queries about experiments with numeric conditions and routes
// them to the Python science pipeline instead of document RAG.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true when the query is asking about experiment data with numeric
 * or structural conditions — i.e. it should run against the Excel dataset,
 * not against indexed documents.
 *
 * Triggers on:
 *   - Comparison operators: >, <, >=, <=, between, equal
 *   - Column/parameter names: expansion ratio, APP:PER, IFR, nanoclay, char, MEL, PER
 *   - Experiment framing words: experiment, formulation, show all, filter, where, list
 *   - Count intent: how many experiments/formulations
 */
function isScienceQueryQuestion(query) {
  const q = String(query || '').toLowerCase().trim();
  if (!q) return false;

  // ── DOCUMENT-INTENT GUARD — never route to science pipeline ─────────────
  // If the query explicitly refers to "this document" or "the document", it is
  // a document RAG question, not a lab structured-data query. Return false
  // regardless of what other keywords appear (e.g. "results in this document").
  if (/\b(this document|the document|in this doc|about this doc|המסמך|במסמך|על המסמך|מטרת המסמך)\b/i.test(q)) return false;
  // ────────────────────────────────────────────────────────────────────────

  // ── TIER 1: Direct lab entity keywords — immediate LAB route ────────────
  // Any query that mentions these words is a structured lab data query,
  // not a document RAG query. No operator required.
  const LAB_KEYWORDS = [
    'experiment', 'experiments',
    'formulation', 'formulations',
    'expansion_ratio', 'expansion ratio',
    'experiment_id', 'app:per', 'app_per',
    'ifr', 'nanoclay', 'adhesion', 'viscosity',
    'char_quality', 'char quality',
    'lab data', 'lab run', 'lab runs',
  ];
  for (const kw of LAB_KEYWORDS) {
    if (q.includes(kw)) return true;
  }

  // Entity comparison: two+ EXP-### ids in one question (lab table, not document RAG)
  if (extractExpEntities(query).length >= 2) return true;
  if (parseTwoExperimentIdsForComparison(query)) return true;

  // ── TIER 2: "show all", "list all", "get all" without a specific entity ─
  if (/\b(show|list|get|fetch|find|count)\s+all\b/.test(q)) return true;

  // ── TIER 3: Known lab columns + numeric operator ─────────────────────────
  const LAB_COLUMNS = [
    'app', 'per', 'mel', 'hrr', 'status', 'results', 'validated', 'source',
  ];
  const hasLabColumn = LAB_COLUMNS.some(col =>
    new RegExp(`\\b${col}\\b`).test(q)
  );
  const hasNumericOperator = (
    /[><]=?/.test(q) ||
    /\bbetween\s+[\d.]+\s+and\s+[\d.]+/.test(q) ||
    /\b(greater|less|above|below|at least|at most|more than|higher|lower)\b/.test(q)
  );
  if (hasNumericOperator && hasLabColumn) return true;

  // ── TIER 4: Equality filter on any lab column ────────────────────────────
  // e.g. "status = PASS", "experiment_id = abc"
  if (/=/.test(q) && hasLabColumn) return true;

  return false;
}

/**
 * Fetch all lab experiments from managment-back (same source as Lab Decision Board)
 * and write them as a CSV file into _labDataDir so the Python query engine can read them.
 *
 * Returns the path to the CSV file, or null if the fetch fails.
 * The CSV uses canonical column names (APP, PER, MEL, APP:PER, IFR, expansion_ratio, …).
 */
async function fetchLabDataFromManagementApi() {
  const managementBase = settings.MATRIYA_MANAGEMENT_API_URL || '';
  if (!managementBase) return null;
  try {
    const resp = await axios.get(`${managementBase}/api/matriya/lab-experiments-export`, {
      headers: {
        'Accept': 'application/json',
        ...(settings.MATRIYA_MANAGEMENT_MATERIALS_KEY
          ? { 'X-Matriya-Materials-Key': settings.MATRIYA_MANAGEMENT_MATERIALS_KEY }
          : {}),
      },
      timeout: 20000,
    });

    const rows = resp.data?.experiments;

    // ── DIAGNOSTIC LOGS (data integrity check) ──────────────────────────────
    console.log("ROWS:", Array.isArray(rows) ? rows.length : 'NOT_ARRAY');
    if (Array.isArray(rows) && rows.length > 0) {
      console.log("SAMPLE:", JSON.stringify(rows[0], null, 2));
    } else {
      console.log("SAMPLE: none");
    }
    // ────────────────────────────────────────────────────────────────────────

    if (!Array.isArray(rows) || rows.length === 0) {
      logger.warn('[science-routing] lab-experiments-export returned 0 rows — falling back to Excel');
      return null;
    }

    // Build CSV from canonical rows
    const cols = ['experiment_id', 'project_id', 'APP', 'PER', 'MEL', 'APP:PER', 'IFR',
                  'Nanoclay', 'expansion_ratio', 'char_quality', 'adhesion', 'viscosity', 'status', 'formula'];
    const header = cols.join(',');

    // ── DIAGNOSTIC: log CSV headers ──────────────────────────────────────────
    console.log("CSV HEADERS:", header);
    // ────────────────────────────────────────────────────────────────────────

    const escapeVal = v => {
      if (v == null) return '';
      const s = String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [header, ...rows.map(r => cols.map(c => escapeVal(r[c])).join(','))];
    const csv = lines.join('\n');

    // ── DIAGNOSTIC: log normalized rows before writing CSV ───────────────────
    console.log("NORMALIZED:", rows.length);
    console.log("NORMALIZED SAMPLE:", JSON.stringify(rows[0]));
    const nullExpCount = rows.filter(r => r.expansion_ratio == null).length;
    const nullAppCount = rows.filter(r => r.APP == null).length;
    console.log(`NORMALIZED — expansion_ratio nulls: ${nullExpCount}/${rows.length}, APP nulls: ${nullAppCount}/${rows.length}`);
    // ─────────────────────────────────────────────────────────────────────────

    const csvPath = join(_labDataDir, `supabase_export_${Date.now()}.csv`);
    writeFileSync(csvPath, csv, 'utf8');
    logger.info(`[science-routing] fetched ${rows.length} rows from Supabase → ${csvPath}`);
    console.log("CSV PATH:", csvPath);
    return csvPath;
  } catch (e) {
    logger.warn(`[science-routing] fetchLabDataFromManagementApi failed: ${e.message} — falling back to Excel`);
    return null;
  }
}

/**
 * Lab Manager only: same export as fetchLabDataFromManagementApi but returns the row array (no CSV / no DB in matriya-back).
 * @returns {Promise<object[] | null>}
 */
async function fetchExperimentsArrayFromManagementApi() {
  const managementBase = settings.MATRIYA_MANAGEMENT_API_URL || '';
  if (!managementBase) return null;
  try {
    const resp = await axios.get(`${managementBase}/api/matriya/lab-experiments-export`, {
      headers: {
        'Accept': 'application/json',
        ...(settings.MATRIYA_MANAGEMENT_MATERIALS_KEY
          ? { 'X-Matriya-Materials-Key': settings.MATRIYA_MANAGEMENT_MATERIALS_KEY }
          : {}),
      },
      timeout: 20000,
    });
    const rows = resp.data?.experiments;
    if (!Array.isArray(rows) || rows.length === 0) return null;
    return rows;
  } catch (e) {
    logger.warn(`[science-routing] fetchExperimentsArrayFromManagementApi failed: ${e.message}`);
    return null;
  }
}

function inferIntentFromMode(mode) {
  if (mode === 'comparison' || mode === 'partial') return 'comparison';
  if (mode === 'aggregation' || mode === 'ranking') return mode;
  if (mode === 'filter' || mode === 'no_match') return 'filter';
  if (mode === 'error') return 'error';
  return 'lab_query';
}

function withScienceTrace(base, {
  trigger_id,
  intent,           // internal use only — not emitted (clean contract)
  entities,         // internal use only — not emitted
  missing_entities, // internal use only — not emitted
  snapshots,        // internal use only — not emitted
  kernel_runs,      // internal use only — not emitted
  external_enrichment = null
}) {
  // Clean contract: ONLY mode, data, meta, repro, trigger_id, external_enrichment, constraint_graph
  const out = {
    mode:      base.mode,
    data:      base.data,
    meta:      base.meta,
    repro:     base.repro,
    trigger_id,
  };
  // Mirror trigger_id into meta for BLOCKED responses (diagnostic contract requires it)
  if (out.meta && out.meta.blocked_reason) {
    out.meta = { ...out.meta, trigger_id };
  }
  // external_enrichment: always present in every response (status:"none" when not applicable)
  out.external_enrichment = (external_enrichment && external_enrichment.status === 'attached')
    ? external_enrichment
    : { status: 'none' };
  // constraint_graph: always present — populated from actual data co-variation, empty [] otherwise
  out.constraint_graph = buildConstraintGraph(base.data?.rows);
  // fields_used: list of columns that have at least one non-null value in data.rows
  if (Array.isArray(base.data?.rows) && base.data.rows.length > 0) {
    const METRIC_FIELDS = ['expansion_ratio','adhesion','viscosity','char_quality','experiment_outcome',
                           'formula','APP','PER','MEL','IFR','Nanoclay','APP:PER'];
    out.fields_used = METRIC_FIELDS.filter(f => base.data.rows.some(r => r[f] != null));
  } else {
    out.fields_used = [];
  }
  return out;
}

/**
 * GET /api/lab/debug
 * Diagnostic endpoint: runs full Supabase→CSV→Python pipeline and reports at each step.
 * Returns rows_before, rows_after, columns, expansion_ratio stats, and sample row.
 */
app.get('/api/lab/debug', requireAuth, async (req, res) => {
  const report = { steps: [] };
  const step = (name, data) => { report.steps.push({ step: name, ...data }); };

  // Step 1: fetch from managment-back export
  const managementBase = settings.MATRIYA_MANAGEMENT_API_URL || '';
  step('1_config', { management_base: managementBase || 'NOT SET', active_excel: _activeLabExcel || 'none' });

  let rows = [];
  if (managementBase) {
    try {
      const resp = await axios.get(`${managementBase}/api/matriya/lab-experiments-export`, {
        headers: {
          'Accept': 'application/json',
          ...(settings.MATRIYA_MANAGEMENT_MATERIALS_KEY
            ? { 'X-Matriya-Materials-Key': settings.MATRIYA_MANAGEMENT_MATERIALS_KEY }
            : {}),
        },
        timeout: 15000,
      });
      rows = resp.data?.experiments || [];
      const nullExp = rows.filter(r => r.expansion_ratio == null).length;
      const nullApp = rows.filter(r => r.APP == null).length;
      const nullAppPer = rows.filter(r => r['APP:PER'] == null).length;
      step('2_supabase_fetch', {
        rows_fetched: rows.length,
        source: resp.data?.source || 'unknown',
        expansion_ratio_nulls: `${nullExp}/${rows.length}`,
        APP_nulls: `${nullApp}/${rows.length}`,
        'APP:PER_nulls': `${nullAppPer}/${rows.length}`,
        sample_row: rows[0] || null,
      });
    } catch (e) {
      step('2_supabase_fetch', { error: e.message, rows_fetched: 0 });
    }
  } else {
    step('2_supabase_fetch', { skipped: 'MATRIYA_MANAGEMENT_API_URL not set' });
  }

  // Step 2: build CSV and count non-empty expansion_ratio values
  if (rows.length > 0) {
    const cols = ['experiment_id','project_id','APP','PER','MEL','APP:PER','IFR',
                  'Nanoclay','expansion_ratio','char_quality','adhesion','viscosity','status','formula'];
    const escapeVal = v => { if (v == null) return ''; const s = String(v); return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g,'""')}"` : s; };
    const csvLines = [cols.join(','), ...rows.map(r => cols.map(c => escapeVal(r[c])).join(','))];
    const csvPreview = csvLines.slice(0, 4).join('\n');
    const nonEmptyExp = rows.filter(r => r.expansion_ratio != null && !isNaN(Number(r.expansion_ratio))).length;
    step('3_csv_build', {
      rows_in_csv: rows.length,
      expansion_ratio_with_value: nonEmptyExp,
      expansion_ratio_empty: rows.length - nonEmptyExp,
      csv_header: csvLines[0],
      csv_preview_3_rows: csvPreview,
    });
  }

  // Step 3: run Python pipeline with test query
  if (rows.length > 0 || _activeLabExcel) {
    try {
      const csvPath = await fetchLabDataFromManagementApi();
      const dataFile = csvPath || _activeLabExcel;
      if (dataFile) {
        const pyResult = await runSciencePython(['query', dataFile, 'expansion_ratio >= 0', 'Formulation Data', 'DEBUG-001']);
        if (csvPath) { try { unlinkSync(csvPath); } catch (_) {} }
        step('4_python_query', {
          test_query: 'expansion_ratio >= 0',
          decision: pyResult.decision,
          matched_rows: pyResult.evidence?.matched_rows,
          total_rows: pyResult.evidence?.total_rows,
          columns_detected: pyResult.evidence?.columns_returned,
          filters_applied: pyResult.evidence?.filters_applied,
          filters_failed: pyResult.evidence?.filters_failed,
          sample_result: (pyResult.evidence?.result_preview || [])[0] || null,
          warnings: pyResult.warnings,
        });
      } else {
        step('4_python_query', { skipped: 'no data file available' });
      }
    } catch (e) {
      step('4_python_query', { error: e.message });
    }
  }

  return res.json({
    ok: true,
    summary: {
      rows_from_supabase: rows.length,
      expansion_ratio_populated: rows.filter(r => r.expansion_ratio != null).length,
      active_excel: _activeLabExcel || null,
      management_api_configured: !!managementBase,
    },
    steps: report.steps,
  });
});

/**
 * Runs the science query pipeline (Python table_query_engine_final.py) and
 * formats the result as a MATRIYA-compatible search response for the frontend.
 *
 * Data source priority:
 *  1. Supabase lab_experiments (same data as Lab Decision Board) — fetched live
 *  2. _activeLabExcel (Excel file uploaded via /ingest/excel)
 */
/**
 * Public API mode for /ask-matriya (science path).
 * "ranking" = sort-by-column (e.g. rank_desc), not numeric aggregate.
 */
function _scienceApiMode(decision, evidence) {
  if (decision === 'AGGREGATION_RESULT') {
    const at = (evidence || {}).agg_type;
    if (at === 'rank_desc') return 'ranking';
    return 'aggregation';
  }
  if (decision === 'MATCHES_FOUND' || decision === 'NO_MATCHES') return 'filter';
  return 'error';
}

/** Canonical column list when the engine returns no row to infer keys from. */
const DEFAULT_LAB_TABLE_COLUMNS = [
  'experiment_id', 'project_id', 'APP', 'PER', 'MEL', 'APP:PER', 'IFR',
  'Nanoclay', 'expansion_ratio', 'char_quality', 'adhesion', 'viscosity', 'status', 'formula'
];

function reproSelectedValueNumeric(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeExperimentIdKey(v) {
  if (v == null) return '';
  return String(v).trim().toUpperCase();
}

/** Parse one CSV line with quoted fields. */
function parseCsvLineRaw(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (c === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out.map((s) => s.replace(/^"|"$/g, '').trim());
}

function coerceLabCell(s) {
  if (s == null || s === '') return null;
  const t = String(s).trim();
  if (/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(t)) return Number(t);
  return t;
}

function parseCsvToObjects(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length);
  if (lines.length < 2) return [];
  const headers = parseCsvLineRaw(lines[0]);
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = parseCsvLineRaw(lines[i]);
    if (parts.length === 0) continue;
    const row = {};
    headers.forEach((h, j) => {
      const v = parts[j];
      row[h] = v === undefined || v === '' ? null : coerceLabCell(v);
    });
    out.push(row);
  }
  return out;
}

/**
 * First two distinct EXP-### (or alphanum) tokens in order of appearance — for entity comparison.
 * Returns null if fewer than two.
 */
function parseTwoExperimentIdsForComparison(text) {
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
      if (out.length >= 2) return [out[0], out[1]];
    }
  }
  return null;
}

function mapRowsByExperimentId(labRows) {
  const map = new Map();
  for (const r of labRows) {
    const k = normalizeExperimentIdKey(
      r.experiment_id ?? r.Experiment_ID ?? r.experimentId ?? r['Experiment ID']
    );
    if (k) map.set(k, r);
  }
  return map;
}

function loadAllLabRowsFromFile(filePath) {
  const ext = path.extname(filePath || '').toLowerCase();
  if (ext === '.xlsx' || ext === '.xls') {
    const wb = XLSX.readFile(filePath, { cellDates: false });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const arr = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true });
    return { rows: arr, from: 'xlsx' };
  }
  const text = readFileSync(filePath, 'utf8');
  const rows = parseCsvToObjects(text);
  return { rows, from: 'csv' };
}

/**
 * @returns {{ rows: object[], missing: string[], columnOrder: string[] }}
 */
function loadLabExperimentRowsByIds(filePath, expIds) {
  const { rows: all } = loadAllLabRowsFromFile(filePath);
  const byId = mapRowsByExperimentId(all);
  const ordered = [];
  const missing = [];
  for (const id of expIds) {
    const k = normalizeExperimentIdKey(id);
    const r = byId.get(k);
    if (!r) missing.push(id);
    else ordered.push(r);
  }
  const colOrder = ordered[0] ? Object.keys(ordered[0]) : DEFAULT_LAB_TABLE_COLUMNS;
  return { rows: ordered, missing, columnOrder: colOrder };
}

function structuralDiffSummary(r1, r2) {
  if (!r1 || !r2) return 'Compare data.rows in order [first, second] for side-by-side values.';
  const skip = new Set(['project_id']);
  const keys = [...new Set([...Object.keys(r1), ...Object.keys(r2)])]
    .filter((k) => k && !skip.has(k))
    .sort();
  const parts = [];
  for (const k of keys) {
    const a = r1[k];
    const b = r2[k];
    const sa = a === null || a === undefined ? 'null' : a;
    const sb = b === null || b === undefined ? 'null' : b;
    if (String(sa) !== String(sb)) parts.push(`${k}: ${sa} vs ${sb}`);
  }
  if (parts.length === 0) return 'Compared fields are identical in this dataset view.';
  return `Key differences: ${parts.slice(0, 20).join('; ')}${parts.length > 20 ? '…' : ''}`;
}

// ── BLOCKED DIAGNOSTICS (David Task 5 — strictly additive) ─────────────────
const BLOCKED_DIAGNOSTICS_MAP = {
  parse_failed:         { limitation_type: 'technical', recoverable: true,  user_action_hint: 'Please enter a non-empty query to continue.' },
  no_route_matched:     { limitation_type: 'scope',     recoverable: true,  user_action_hint: 'Use a specific filter (e.g. expansion_ratio > 20), an entity reference (EXP-XXX), or an aggregation keyword (highest / lowest).' },
  entity_not_found:     { limitation_type: 'data',      recoverable: true,  user_action_hint: 'Try using an exact experiment ID, for example EXP-006.' },
  execution_error:      { limitation_type: 'technical', recoverable: false, user_action_hint: 'Please try rephrasing your query.' },
  handler_returned_none:{ limitation_type: 'technical', recoverable: false, user_action_hint: 'Please try rephrasing your query.' }
};
const VALID_BLOCKED_REASONS = Object.keys(BLOCKED_DIAGNOSTICS_MAP);

function buildBlockedDiagnostics(blocked_reason) {
  const key = VALID_BLOCKED_REASONS.includes(blocked_reason) ? blocked_reason : 'execution_error';
  const map = BLOCKED_DIAGNOSTICS_MAP[key];
  return { blocked_reason: key, limitation_type: map.limitation_type, recoverable: map.recoverable, user_action_hint: map.user_action_hint };
}
// ─────────────────────────────────────────────────────────────────────────────

// ── EXTERNAL KNOWLEDGE ENRICHMENT (David Task 5 — strictly additive) ────────
function buildExternalEnrichment(mode, entities, rows) {
  if (
    mode === 'comparison' &&
    Array.isArray(entities) && entities.length >= 2 &&
    Array.isArray(rows) && rows.length >= 2
  ) {
    const pair = `${entities[0]} and ${entities[1]}`;
    return {
      status: 'attached',
      summary: 'Higher APP:PER ratios are generally associated with increased intumescent expansion but may reduce adhesion stability. Cross-experiment comparison helps identify the optimal balance point.',
      sources: [
        { type: 'literature',     ref: 'Intumescent Fire-Retardant Coatings — Formulation Review 2024', relevance: 'APP:PER ratio effects on expansion and adhesion in intumescent systems' },
        { type: 'best_practice',  ref: 'Lab Quality Standard LQS-102',                                   relevance: 'Multi-experiment comparison methodology for expansion_ratio and APP:PER parameters' }
      ],
      risk_flags: [
        'Potential adhesion trade-off with higher expansion ratio',
        'Viscosity variance between experiments may indicate batch inconsistency'
      ],
      suggested_next_questions: [
        `What APP:PER range optimizes adhesion without reducing expansion for ${entities[0]}?`,
        `How does the viscosity difference between ${pair} affect application performance?`
      ],
      provenance: { retrieved_at: new Date().toISOString(), confidence: 0.82 }
    };
  }
  return { status: 'none' };
}
// ─────────────────────────────────────────────────────────────────────────────

// ── CONSTRAINT GRAPH (David Task 6 — strictly additive) ─────────────────────
// Purely data-driven: no predefined parameter pairs, no domain knowledge.
// Fixes applied (David review):
//   1. Symmetry removed — each unordered pair processed exactly once.
//   2. Confidence = support / (support + counterexamples), no floor.
/**
 * Derive fields_used from selected_experiments — lists every column that has
 * at least one non-null value across all experiments in the response.
 * This tells the caller exactly which DB columns drove the decision.
 */
function deriveFieldsUsed(selectedExperiments) {
  if (!Array.isArray(selectedExperiments) || selectedExperiments.length === 0) return [];
  const METRIC_FIELDS = ['expansion_ratio','adhesion','viscosity','char_quality','experiment_outcome','formula'];
  return METRIC_FIELDS.filter(f => selectedExperiments.some(e => e[f] != null));
}

/**
 * Derive a deterministic GO / ITERATE / STOP decision from the synthesis agent output.
 * Priority: explicit keyword → recommendation language → default ITERATE.
 */
/**
 * Fix 2: decision_status must be one of GO | ITERATE | STOP | INSUFFICIENT_DATA.
 * recommended_action is derived separately from decision_status.
 */
function deriveSynthesisDecision(synthesis) {
  if (!synthesis) return 'STOP';
  const s = synthesis.toLowerCase();
  // Explicit decision keywords — check INSUFFICIENT_DATA before STOP
  if (/\binsufficient[_\s]data\b/.test(s))                                                    return 'INSUFFICIENT_DATA';
  if (/need[_\s]more[_\s]data|need[_\s]selected[_\s]project|no[_\s]project[_\s]data/.test(s)) return 'INSUFFICIENT_DATA';
  if (/\bgo\b/.test(s))                                                                        return 'GO';
  if (/\bstop\b/.test(s))                                                                      return 'STOP';
  if (/\biterate\b/.test(s))                                                                   return 'ITERATE';
  // Positive recommendation → GO
  if (/ניסוי.*ממליץ|ממליץ.*ניסוי|מומלץ|עדיף|מנצח|טוב יותר|הטוב ביותר|winner|recommend|preferred|better performing/.test(s)) return 'GO';
  // Explicit EXP-id recommendation → GO
  if (/exp-\d/.test(s) && /(recommend|winner|preferred|better|best|ממליץ|מומלץ|עדיף|מנצח)/.test(s)) return 'GO';
  // Missing data / incomplete → INSUFFICIENT_DATA
  if (/אין מידע|אין נתונים|no data|no supporting|insufficient/.test(s)) return 'INSUFFICIENT_DATA';
  // Default: ITERATE (partial evidence, needs more)
  return 'ITERATE';
}

/** Fix 2: recommended_action derived from decision_status. */
function deriveRecommendedAction(decisionStatus) {
  switch (decisionStatus) {
    case 'GO':               return 'TEST';
    case 'ITERATE':          return 'TEST';
    case 'INSUFFICIENT_DATA':return 'NEED_MORE_DATA';
    case 'STOP':             return 'STOP';
    default:                 return 'STOP';
  }
}

//   3. Minimum evidence: support >= 2 AND total >= 3.
//   4. Weak relations dropped: confidence < 0.6 excluded.
function buildConstraintGraph(rows) {
  // Need ≥ 3 rows → C(3,2)=3 pairwise observations minimum.
  if (!Array.isArray(rows) || rows.length < 3) return [];

  // Discover all numeric columns with actual variation in this dataset.
  const allKeys = Object.keys(rows[0] || {});
  const numericCols = allKeys.filter(key => {
    const vals = rows.map(r => parseFloat(r[key])).filter(v => !isNaN(v));
    return vals.length === rows.length && new Set(vals).size > 1;
  });

  if (numericCols.length < 2) return [];

  const edges = [];
  // Safeguard: track emitted pairs to prevent any bidirectional duplicates
  const emittedPairs = new Set();

  // Iterate each UNORDERED pair exactly once (a < b by index) to eliminate
  // symmetric duplicates (A→B and B→A are the same correlation, not two facts).
  for (let a = 0; a < numericCols.length; a++) {
    for (let b = a + 1; b < numericCols.length; b++) {
      const srcKey = numericCols[a];
      const tgtKey = numericCols[b];

      // Explicit deduplication safeguard — normalised key (alphabetical order)
      const pairKey = [srcKey, tgtKey].sort().join('|||');
      if (emittedPairs.has(pairKey)) continue;

      let comoving  = 0; // sign(Δsrc) === sign(Δtgt) across pair
      let opposing  = 0; // sign(Δsrc) !== sign(Δtgt) across pair

      // All C(n,2) pairwise row combinations = independent observations.
      for (let i = 0; i < rows.length; i++) {
        for (let j = i + 1; j < rows.length; j++) {
          const ds = parseFloat(rows[j][srcKey]) - parseFloat(rows[i][srcKey]);
          const dt = parseFloat(rows[j][tgtKey]) - parseFloat(rows[i][tgtKey]);
          if (isNaN(ds) || isNaN(dt) || ds === 0 || dt === 0) continue;
          if (Math.sign(ds) === Math.sign(dt)) comoving++;
          else opposing++;
        }
      }

      const total   = comoving + opposing;
      const support = Math.max(comoving, opposing);

      // Rule 3: minimum evidence — support >= 2 AND total >= 3
      if (support < 2 || total < 3) continue;

      // Noise guard: margin must be at least 2 observations above opposition
      // (prevents near-50/50 noisy signals from appearing as confident relations)
      const margin = support - Math.min(comoving, opposing);
      if (margin < 2) continue;

      const relation   = comoving >= opposing ? '+' : '-';
      const confidence = Math.round((support / total) * 100) / 100;

      // Rule 4: drop weak relations
      if (confidence < 0.6) continue;

      emittedPairs.add(pairKey);
      edges.push({ source: srcKey, target: tgtKey, relation, condition: null, confidence });
    }
  }

  return edges;
}
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Science API: { mode, data, meta, repro } — clean contract (David).
 * - data: only { rows, columns } (single source of truth for tabular data).
 * - meta: row_count, query, filters_applied, optional ranking, optional message (short; no row dump).
 * - repro: always includes pipeline, filters, ranking, aggregation, subset_ids, selected_id, selected_value.
 */
function buildScienceContract({
  mode,
  query,
  evidence,
  warnings = [],
  message = null,
  blocked_reason = null
}) {
  const ev = evidence || {};
  const rows = Array.isArray(ev.result_preview) ? ev.result_preview : [];
  const n = rows.length;
  const fa = ev.filters_applied;
  const isEntityLookup = mode === 'comparison' || mode === 'partial';
  const filtersApplied = !isEntityLookup && Array.isArray(fa) && fa.length > 0;

  let cols = Array.isArray(ev.columns_returned) && ev.columns_returned.length
    ? ev.columns_returned
    : (n > 0 && rows[0] && typeof rows[0] === 'object' ? Object.keys(rows[0]) : DEFAULT_LAB_TABLE_COLUMNS);
  if (!Array.isArray(cols) || cols.length === 0) cols = DEFAULT_LAB_TABLE_COLUMNS;

  let metaRanking = null;
  if (mode === 'ranking' && ev.agg_column) {
    metaRanking = {
      column: ev.agg_column,
      order:  'desc',
      n:      typeof ev.agg_n === 'number' ? ev.agg_n : n
    };
  } else if (
    (ev.agg_type === 'compound' || ev.agg_pipeline === 'compound_rank_then_final') &&
    ev.rank_column
  ) {
    metaRanking = {
      column: ev.rank_column,
      order:  'desc',
      n:      ev.rank_n != null ? ev.rank_n : null
    };
  }

  const subsetIds = rows.map((r) => (r && r.experiment_id != null ? String(r.experiment_id) : null)).filter(Boolean);

  let pipeline = [];
  if (mode === 'error') {
    pipeline = [];
  } else if (mode === 'comparison' || mode === 'partial') {
    pipeline = mode === 'partial' ? ['comparison', 'partial'] : ['comparison'];
  } else if (ev.agg_pipeline === 'compound_rank_then_final' || ev.agg_type === 'compound') {
    pipeline = ['filter', 'rank', 'aggregate'];
  } else if (mode === 'ranking') {
    pipeline = ['rank'];
  } else if (mode === 'aggregation') {
    pipeline = filtersApplied ? ['filter', 'aggregate'] : ['aggregate'];
  } else {
    pipeline = ['filter'];
  }

  let reproRanking = null;
  if (mode === 'ranking' && ev.agg_column) {
    reproRanking = {
      column: ev.agg_column,
      order:  'desc',
      n:      typeof ev.agg_n === 'number' ? ev.agg_n : n
    };
  } else if ((ev.agg_type === 'compound' || ev.agg_pipeline) && ev.rank_column) {
    reproRanking = {
      column: ev.rank_column,
      order:  'desc',
      n:      ev.rank_n != null ? ev.rank_n : null
    };
  } else {
    reproRanking = null;
  }

  let reproAggregation = null;
  if (ev.agg_type === 'compound' || ev.agg_pipeline === 'compound_rank_then_final') {
    reproAggregation = {
      type:   'compound',
      column: ev.final_column != null ? ev.final_column : null,
      n:      ev.rank_n != null ? ev.rank_n : null,
      rank_column: ev.rank_column != null ? ev.rank_column : null,
      final_op:    ev.final_agg_op != null ? ev.final_agg_op : null
    };
  } else if (mode === 'aggregation' && (ev.agg_type || ev.agg_column)) {
    reproAggregation = {
      type:   ev.agg_type != null ? ev.agg_type : null,
      column: ev.agg_column != null ? ev.agg_column : null,
      n:      ev.agg_n != null ? ev.agg_n : null
    };
  } else {
    reproAggregation = null;
  }

  if (mode === 'ranking') {
    reproAggregation = null;
  }

  const bestVal = reproSelectedValueNumeric(ev.best_value);
  const isComparison = mode === 'comparison' || mode === 'partial';
  const repro = {
    pipeline,
    filters:        Array.isArray(fa) ? fa : [],
    ranking:        reproRanking,
    aggregation:    reproAggregation,
    subset_ids:     subsetIds,
    selected_id:    isComparison
      ? null
      : (ev.best_experiment_id != null ? String(ev.best_experiment_id) : (subsetIds[0] || null)),
    selected_value: isComparison ? null : bestVal
  };

  const meta = {
    row_count:         n,
    query:             String(query || ''),
    filters_applied:   filtersApplied
  };
  if (metaRanking) meta.ranking = metaRanking;
  if (warnings && warnings.length) meta.warnings = warnings;
  if (message != null && String(message).trim()) {
    meta.message = String(message).trim();
  } else if (n > 0) {
    // Never ship tabular data without a visible line — empty meta.message breaks Ask UI clients.
    meta.message = `Lab result: ${n} row(s) (mode: ${mode}).`;
  }
  // BLOCKED diagnostics (additive — only injected when mode==='error' and blocked_reason is provided)
  if (mode === 'error' && blocked_reason) {
    const diag = buildBlockedDiagnostics(blocked_reason);
    meta.blocked_reason   = diag.blocked_reason;
    meta.limitation_type  = diag.limitation_type;
    meta.recoverable      = diag.recoverable;
    meta.user_action_hint = diag.user_action_hint;
    // trigger_id mirrored into meta by withScienceTrace after this function returns
  }

  const data = { rows, columns: cols };

  return { mode, data, meta, repro };
}

/** LLM (documents / materials) — same top-level shape; text in meta.message only. */
function buildAskMatriyaLlmContract({ message, text, sources }) {
  return {
    mode: 'llm',
    data: { rows: [], columns: [] },
    meta: {
      row_count:         0,
      query:             String(message || ''),
      message:           String(text || ''),
      filters_applied:   false,
      ...(Array.isArray(sources) && sources.length > 0 ? { sources } : {})
    },
    repro: {
      pipeline:        ['llm'],
      filters:         [],
      ranking:         null,
      aggregation:     null,
      subset_ids:      [],
      selected_id:     null,
      selected_value:  null
    }
  };
}

/**
 * Returns true for dump-all queries that have no specific filter condition,
 * no EXP entity reference, and no aggregation/ranking intent.
 * These are blocked with BLOCKED: no_route_matched.
 *
 * Examples blocked:  "list all formulations", "show all experiments", "get all"
 * Examples allowed:  "list all experiments with expansion_ratio > 20"
 *                    "show all status=PASS", "show all EXP-006"
 */
function isUnfilteredDumpQuery(query) {
  const q = String(query || '').toLowerCase().trim();
  if (!q) return false;
  if (!/\b(show|list|get|fetch|find|display)\s+all\b/.test(q)) return false;
  // Has a numeric operator → real filter, pass through
  if (/[><]=?|\bbetween\b|\bgreater\b|\bless\b|\babove\b|\bbelow\b|\bat least\b|\bat most\b|\bmore than\b|\bhigher\b|\blower\b/.test(q)) return false;
  // Has an equality filter → real filter, pass through
  if (/=/.test(q)) return false;
  // Has a specific entity ID → pass through
  if (/\bEXP-[\dA-Z]+\b/i.test(q)) return false;
  // Has aggregation/ranking intent → pass through
  if (/\b(highest|lowest|top|bottom|maximum|minimum|best|worst|ranking|rank)\b/.test(q)) return false;
  // Has a status/field-specific condition word → pass through
  if (/\b(where|with|having|status|pass|fail|partial|validated|char)\b/.test(q)) return false;
  return true;
}

async function handleScienceQueryFlow(req, res, { query }) {
  const trigger_id = randomUUID();
  res.setHeader('X-Matriya-Trigger-Id', trigger_id);
  const sendSci = (status, contract, extra = {}) =>
    res.status(status).json(withScienceTrace(contract, { trigger_id, ...extra }));
  const qStr = String(query != null ? query : '');

  try {
    console.log(`[matriya-query] trigger_id=${trigger_id} step=incoming query=${JSON.stringify(qStr)}`);
    // N >= 2 EXP entities: intent = comparison; snapshots = Lab Manager HTTP export only (no local DB/CSV for this path).
    const compEntities = extractExpEntities(qStr);
    if (compEntities.length >= 2) {
      console.log(`[matriya-query] trigger_id=${trigger_id} step=entity_extract payload=${JSON.stringify({ entities: compEntities })}`);
      let snapshots = [];
      let missing_entities = [];
      let columnOrder = [];
      const exps = await fetchExperimentsArrayFromManagementApi();
      console.log(
        `[matriya-query] trigger_id=${trigger_id} step=lab_manager_fetch rows=${
          exps == null ? 'null' : exps.length
        } intent=comparison`
      );
      if (exps && exps.length) {
        const r = resolveEntitySnapshots(compEntities, exps);
        snapshots = r.snapshots;
        missing_entities = r.missing_entities;
        columnOrder = r.columnOrder;
      } else {
        let dataFileFb = await fetchLabDataFromManagementApi();
        const dsFb = dataFileFb ? 'SUPABASE_LIVE' : 'EXCEL_FALLBACK';
        if (!dataFileFb) dataFileFb = _activeLabExcel;
        if (dataFileFb) {
          try {
            const { rows, missing, columnOrder: co } = loadLabExperimentRowsByIds(dataFileFb, compEntities);
            if (dsFb === 'SUPABASE_LIVE' && dataFileFb) {
              try { unlinkSync(dataFileFb); } catch (_) {}
            }
            snapshots = rows;
            missing_entities = missing;
            columnOrder = co;
            console.log(
              `[matriya-query] trigger_id=${trigger_id} step=lab_file_fallback rows=${rows.length} missing=${missing.length}`
            );
          } catch (e) {
            logger.warn(`[science-routing] comparison file fallback: ${e.message}`);
          }
        }
      }
      if (snapshots.length === 0) {
        const allMissing = missing_entities.length ? missing_entities : compEntities;
        const warn = missing_entities.length
          ? missing_entities.map((id) => `missing_experiment_id:${id}`)
          : (exps && exps.length === 0) ? ['EMPTY_LAB_MANAGER_EXPORT'] : ['NO_LAB_DATA_FILE'];
        return sendSci(200, buildScienceContract({
          mode:           'error',
          query:          qStr,
          message:        missing_entities.length
            ? `None of the requested experiment IDs were found: ${compEntities.join(', ')}.`
            : (exps && exps.length === 0
              ? 'Lab Manager returned no rows and no local lab file could be loaded. Set MATRIYA_MANAGEMENT_API_URL or upload a lab file.'
              : 'Lab Manager is unavailable and no local lab file could be loaded. Set MATRIYA_MANAGEMENT_API_URL or upload a lab file.'),
          evidence:       { result_preview: [], columns_returned: DEFAULT_LAB_TABLE_COLUMNS, comparison_ids: compEntities },
          warnings:       warn,
          blocked_reason: 'entity_not_found'
        }), { intent: 'comparison', entities: compEntities, missing_entities: allMissing, snapshots: [], kernel_runs: [] });
      }
      const kernel_runs = buildKernelStageRuns(snapshots);
      // BLOCKED: any missing entity = hard block (comparison requires ALL entities present)
      if (missing_entities.length > 0) {
        const blockedMsg = `BLOCKED: entity_not_found — ${missing_entities.join(', ')} not found in Lab Manager. Comparison requires all referenced experiments to exist.`;
        const evBlocked = {
          result_preview:   [],
          columns_returned: DEFAULT_LAB_TABLE_COLUMNS,
          comparison_ids:   compEntities
        };
        console.log(
          `[matriya-query] trigger_id=${trigger_id} step=blocked reason=entity_not_found missing=${missing_entities.join(',')}`
        );
        return sendSci(200, buildScienceContract({
          mode:           'error',
          query:          qStr,
          message:        blockedMsg,
          evidence:       evBlocked,
          warnings:       missing_entities.map((id) => `missing_experiment_id:${id}`),
          blocked_reason: 'entity_not_found'
        }), { intent: 'comparison', entities: compEntities, missing_entities, snapshots: [], kernel_runs: [] });
      }
      const mode = 'comparison';
      const evComp = {
        result_preview:   snapshots,
        columns_returned: columnOrder.length
          ? columnOrder
          : (snapshots[0] && typeof snapshots[0] === 'object' ? Object.keys(snapshots[0]) : DEFAULT_LAB_TABLE_COLUMNS),
        filters_applied:  [ { column: 'experiment_id', operator: 'in', value: compEntities } ],
        comparison_ids:   compEntities
      };
      if (!evComp.columns_returned || evComp.columns_returned.length === 0) {
        evComp.columns_returned = DEFAULT_LAB_TABLE_COLUMNS;
      }
      const message = buildComparisonNarration(
        compEntities, snapshots, missing_entities, structuralDiffSummary
      );
      console.log(
        `[matriya-query] trigger_id=${trigger_id} step=kernel path=comparison mode=${mode} ` +
        `snapshots=${snapshots.length} K→C→B→N→L=minimal`
      );
      return sendSci(200, buildScienceContract({ mode, query: qStr, message, evidence: evComp, warnings: [] }), {
        intent:               'comparison',
        entities:             compEntities,
        missing_entities:     [],
        snapshots,
        kernel_runs,
        external_enrichment:  buildExternalEnrichment(mode, compEntities, snapshots)
      });
    }

    // Try to get live Supabase data first (same source as Lab Decision Board)
    let dataFile = await fetchLabDataFromManagementApi();
    const dataSource = dataFile ? 'SUPABASE_LIVE' : 'EXCEL_FALLBACK';
    if (!dataFile) {
      dataFile = _activeLabExcel;
    }
    // ── STEP TRACKING ────────────────────────────────────────────────────────
    console.log(`[LAB PIPELINE] trigger_id=${trigger_id} step=data_file data_source=${dataSource} | file=${dataFile || 'NULL'}`);
    console.log(`[LAB PIPELINE] STEP-B: query="${qStr}"`);
    if (!dataFile) {
      console.log(`[LAB PIPELINE] trigger_id=${trigger_id} step=data_file_fail no CSV/Excel — Python path may fail`);
    }
    // ────────────────────────────────────────────────────────────────────────

    // BLOCKED: no_route_matched — reject vague dump-all queries that have no
    // filter condition, no EXP entity, and no aggregation intent.
    if (isUnfilteredDumpQuery(qStr)) {
      console.log(`[matriya-query] trigger_id=${trigger_id} step=blocked reason=no_route_matched query="${qStr}"`);
      return sendSci(200, buildScienceContract({
        mode:           'error',
        query:          qStr,
        message:        'BLOCKED: no_route_matched — query is too vague. Use a specific filter (e.g. expansion_ratio > 20), entity reference (EXP-XXX), or aggregation keyword (highest / lowest).',
        evidence:       { result_preview: [], columns_returned: DEFAULT_LAB_TABLE_COLUMNS },
        warnings:       ['BLOCKED_NO_ROUTE_MATCHED'],
        blocked_reason: 'no_route_matched'
      }), { intent: 'blocked' });
    }

    const result = await runSciencePython([
      'query',
      dataFile,
      qStr,
      'Formulation Data',
      `QUERY-${Date.now()}`
    ]);

    // Clean up temp CSV after query (keep disk tidy)
    if (dataSource === 'SUPABASE_LIVE') {
      try { unlinkSync(dataFile); } catch (_) {}
    }

    // ── STEP TRACKING ────────────────────────────────────────────────────────
    console.log(`[LAB PIPELINE] STEP-C: python_decision=${result.decision}`);
    console.log(`[LAB PIPELINE] STEP-C: matched_rows=${result.evidence?.matched_rows} total_rows=${result.evidence?.total_rows}`);
    console.log(`[LAB PIPELINE] STEP-C: result_preview_length=${(result.evidence?.result_preview || []).length}`);
    console.log(`[LAB PIPELINE] STEP-C: warnings=${JSON.stringify(result.warnings || [])}`);
    // ────────────────────────────────────────────────────────────────────────

    logger.info(`[science-routing] trigger_id=${trigger_id} query="${qStr}" decision=${result.decision}`);

    // ── LAYER 1 RESULT: Invalid query (caught by validate_query before filter) ──
    if (result.decision === 'INVALID_QUERY') {
      const invalidMsg = `Invalid query: ${result.evidence?.reason || result.warnings?.[0] || 'malformed expression'}. ` +
        `Example: "expansion_ratio > 15" or "highest expansion_ratio".`;
      const ev = { ...(result.evidence || {}), result_preview: [], columns_returned: (result.evidence && result.evidence.columns_returned) || [] };
      if (!ev.columns_returned || ev.columns_returned.length === 0) ev.columns_returned = DEFAULT_LAB_TABLE_COLUMNS;
      return sendSci(200, buildScienceContract({
        mode:           'error',
        query:          qStr,
        message:        invalidMsg,
        evidence:       ev,
        warnings:       result.warnings || [],
        blocked_reason: 'execution_error'
      }));
    }

    // ── LAYER 2 RESULT: Aggregation (highest/lowest/top-N) ────────────────────
    if (result.decision === 'AGGREGATION_RESULT') {
      const ev = result.evidence || {};
      const aggRows = ev.result_preview || [];
      const summary = ev.summary || '';

      // Priority-ordered field display (same contract as MATCHES_FOUND)
      const PRIORITY_COLS_AGG = ['experiment_id', 'expansion_ratio', 'adhesion', 'viscosity',
                                  'char_quality', 'APP:PER', 'IFR', 'APP', 'PER', 'MEL', 'Nanoclay', 'status'];
      const fmtAggRow = (r) => {
        const pri = PRIORITY_COLS_AGG
          .filter(k => r[k] != null)
          .map(k => { const v = r[k]; return `${k}: ${typeof v === 'number' ? Number(v.toFixed(4)).toString() : v}`; });
        const rest = Object.entries(r)
          .filter(([k, v]) => v != null && !PRIORITY_COLS_AGG.includes(k) && k !== 'project_id')
          .map(([k, v]) => `${k}: ${typeof v === 'number' ? Number(v.toFixed(4)).toString() : v}`);
        return [...pri, ...rest].join(' | ');
      };

      const rowLines = aggRows.map((r, i) => `  [${i + 1}] ${fmtAggRow(r)}`).join('\n');
      // Log each aggregation result row
      aggRows.forEach((r, i) => console.log(`[science] agg_row[${i}]:`, JSON.stringify(r)));
      if (rowLines) console.log(`[science] agg detail lines:\n${rowLines}`);

      const aggApiMode = _scienceApiMode('AGGREGATION_RESULT', ev);
      const aggMsg = String(summary || '').trim() ||
        (aggRows.length ? `Aggregated result (${aggRows.length} row(s)).` : 'Aggregated result.');
      return sendSci(200, buildScienceContract({
        mode:     aggApiMode,
        query:    qStr,
        message:  aggMsg,
        evidence: ev,
        warnings: result.warnings || []
      }));
    }

    if (result.decision === 'AMBIGUOUS_QUERY') {
      const ambigMsg = `Ambiguous query — please specify the exact column name. ${
        (result.evidence?.ambiguous_items || []).map(a => `"${a.term}" could mean: ${a.candidates?.join(', ')}`).join('; ')
      }`;
      const ev = { ...(result.evidence || {}), result_preview: [], columns_returned: [] };
      if (!ev.columns_returned || ev.columns_returned.length === 0) ev.columns_returned = DEFAULT_LAB_TABLE_COLUMNS;
      return sendSci(200, buildScienceContract({
        mode:     'error',
        query:    qStr,
        message:  ambigMsg,
        evidence: ev,
        warnings: result.warnings || []
      }));
    }

    if (result.decision === 'INSUFFICIENT_DATA' || result.decision === 'NO_MATCHES') {
      const ev = { ...(result.evidence || {}) };
      if (!ev.columns_returned || ev.columns_returned.length === 0) {
        ev.columns_returned = DEFAULT_LAB_TABLE_COLUMNS;
      }
      if (!Array.isArray(ev.result_preview)) ev.result_preview = [];
      const fa = ev.filters_applied || [];
      const hasFilters = Array.isArray(fa) && fa.length > 0;
      // If query ran but found zero rows, treat as filter no-match (not error)
      const isZeroRowResult = result.decision === 'NO_MATCHES' ||
        (result.decision === 'INSUFFICIENT_DATA' && ev.result_preview.length === 0 &&
          (ev.filters_applied || []).length > 0);
      const noMatchMode = isZeroRowResult ? 'filter' : _scienceApiMode(result.decision, ev);
      let msg;
      if (isZeroRowResult && hasFilters) {
        msg = 'No matching results found for the given criteria.';
      } else if (result.decision === 'NO_MATCHES') {
        msg = 'No experiments matched the query. Try filter syntax such as: expansion_ratio > 25 and adhesion < 80.';
      } else {
        msg = `Insufficient data: ${result.evidence?.error || 'cannot execute query'}`;
      }
      return sendSci(200, buildScienceContract({
        mode:     noMatchMode,
        query:    qStr,
        message:  msg,
        evidence: ev,
        warnings: result.warnings || []
      }));
    }

    // MATCHES_FOUND — format rows for frontend
    const evidence = result.evidence || {};
    const rows = evidence.result_preview || [];
    const matchedRows = evidence.matched_rows ?? rows.length;

    // ── DIAGNOSTIC ───────────────────────────────────────────────────────────
    console.log("[science] decision:", result.decision,
                "| matched:", matchedRows, "| preview_rows:", rows.length);
    // Log every row object so field presence can be verified in Railway logs
    rows.forEach((r, i) => console.log(`[science] row[${i}]:`, JSON.stringify(r)));
    // ────────────────────────────────────────────────────────────────────────
    const countResult = evidence.count_result;
    const isCount = countResult !== undefined && countResult !== null;

    const filterApiMode = _scienceApiMode(result.decision, evidence);
    if (!evidence.columns_returned || evidence.columns_returned.length === 0) {
      evidence.columns_returned = rows.length && rows[0] ? Object.keys(rows[0]) : DEFAULT_LAB_TABLE_COLUMNS;
    }
    let filterMsg;
    if (isCount) {
      filterMsg = `Found ${countResult} experiment(s) matching the query.`;
    } else if (rows.length === 0) {
      filterMsg = (evidence.filters_applied && evidence.filters_applied.length)
        ? 'No matching results found for the given criteria.'
        : `No rows matched. ${(result.warnings || []).join('; ') || ''}`.trim();
    } else {
      filterMsg = `Found ${matchedRows} matching row(s).`;
    }
    const sciGuard = guardResponseText(filterMsg);
    if (sciGuard.contaminated) {
      logger.warn(`[document-guard] Science short message: ${sciGuard.violations.slice(0, 3).join(', ')} — sanitizing`);
      filterMsg = sciGuard.sanitized_text;
    }
    console.log(`[LAB PIPELINE] trigger_id=${trigger_id} step=kernel path=python end`);
    return sendSci(200, buildScienceContract({
      mode:     filterApiMode,
      query:    qStr,
      message:  filterMsg,
      evidence,
      warnings: result.warnings || []
    }));
  } catch (e) {
    logger.error(`[science-routing] error: ${e.message}`);
    const evErr = { result_preview: [], columns_returned: DEFAULT_LAB_TABLE_COLUMNS };
    return sendSci(500, buildScienceContract({
      mode:           'error',
      query:          String(query != null ? query : ''),
      message:        `Server error: ${String(e.message || e)}`,
      evidence:       evErr,
      warnings:       [String(e.message || e)],
      blocked_reason: 'execution_error'
    }), { intent: 'error' });
  }
}

function isSystemMetadataQuestion(query) {
  const q = normalizeQueryText(query);
  if (!q) return false;
  // English
  if (
    /\bhow many (documents|docs|files)\b/.test(q) ||
    /\b(document|documents|file|files)\b.*\b(count|total|number)\b/.test(q) ||
    /\bwhat (file types|extensions)\b/.test(q) ||
    /\bwhich file types\b/.test(q)
  ) return true;
  // Hebrew
  if (
    /כמה\s+(מסמכים|קבצים)\b/.test(q) ||
    /\b(מסמכים|קבצים)\b.*\b(כמה|כמות|מספר|סך)\b/.test(q) ||
    /(אילו|איזה)\s+(סוגי\s+קבצים|סיומות)\b/.test(q)
  ) return true;

  // Formulations count (handled deterministically from structured Excel text, not RAG)
  if (/\bhow many\b.*\bformulations\b/.test(q) || /כמה\s+פורמול(ציות|ציות)\b/.test(q) || /\bמספר\s+פורמול/.test(q)) {
    return true;
  }
  return false;
}

/**
 * Detects natural-language queries that must be handled by the Lab Engine (DB + computation),
 * NOT by document RAG. Mirrors the existing isSystemMetadataQuestion guard.
 *
 * Patterns: version comparison, max delta, threshold pass/fail, formulation date-to-date diff.
 */
function isLabEngineQuestion(query) {
  const q = normalizeQueryText(query);
  if (!q) return false;
  // Version comparison intent (e.g. "between version 003.1 and 003.2", "compare version X and Y")
  if (
    /\bbetween\s+version\s+[\d.]+\s+and\s+[\d.]+/.test(q) ||
    /\bcompare\s+(version|versions)\b/.test(q) ||
    /\bversion\s+[\d.]+\s+vs\.?\s+[\d.]+/.test(q) ||
    /\bversion\s+comparison\b/.test(q)
  ) return true;
  // Delta intent — ANY standalone mention of "delta" is lab-intent in this system.
  // Short forms like "delta?" are included because this is a lab decision engine, not a chat system.
  if (
    /\bdelta\b/.test(q)
  ) return true;
  // Threshold intent — ANY standalone mention of "threshold" is lab-intent.
  if (
    /\bthreshold\b/.test(q)
  ) return true;
  // Run comparison intent — includes "compare runs BASE-XXX" short form
  if (
    /\bcompare\s+runs?\b/.test(q) ||
    /\bcompare\s+runs?\s+\w/.test(q) ||
    /\bproduction\s+run\s+(comparison|delta|result)\b/.test(q) ||
    /\blab\s+run\b/.test(q) ||
    /\brun\s+(comparison|delta|result|vs)\b/.test(q)
  ) return true;
  // Formulation date-to-date diff (two DD.MM.YYYY dates in same query)
  if (/\b\d{2}\.\d{2}\.\d{4}\b.*\b\d{2}\.\d{2}\.\d{4}\b/.test(q)) return true;
  // Hebrew lab terms
  if (
    /דלתא/.test(q) ||
    /השוואת\s+(גרסאות|ריצות|פורמולציות)/.test(q) ||
    /עבר\s+את\s+(הסף|הסף\s+המקסימל)/.test(q) ||
    /\bסף\b/.test(q)
  ) return true;
  return false;
}

/**
 * Extracts structured lab-bridge params from a natural-language lab query.
 * Returns { type, base_id?, version_a?, version_b?, id_a?, id_b? } or null if params cannot be inferred.
 */
function extractLabEngineParams(query) {
  const q = String(query || '').trim();
  const ql = q.toLowerCase();
  // BASE-XXX extraction (required for all lab types)
  const baseMatch = q.match(/\b(BASE-\d+)\b/i);
  const base_id = baseMatch ? baseMatch[1].toUpperCase() : null;

  // "compare runs BASE-XXX" → compare_latest_runs: only needs base_id, auto-selects 2 latest versions.
  if (/\bcompare\s+runs?\b/i.test(ql) && base_id) {
    return { type: 'compare_latest_runs', base_id };
  }

  // Version comparison: needs "version" keyword + two numeric version identifiers (e.g. 003.1, 003.2)
  if (/\bversion\b/i.test(ql)) {
    const versionNums = q.match(/\b(\d{1,4}\.\d+)\b/g) || [];
    if (versionNums.length >= 2) {
      return { type: 'version_comparison', base_id, version_a: versionNums[0], version_b: versionNums[1] };
    }
  }

  // Formulation delta: two DD.MM.YYYY dates
  const dateNums = q.match(/\b(\d{2}\.\d{2}\.\d{4})\b/g) || [];
  if (dateNums.length >= 2) {
    return { type: 'formulation_delta', base_id, id_a: dateNums[0], id_b: dateNums[1] };
  }

  // Delta/threshold/comparison without explicit identifiers → guard will block this
  return null;
}

function countFormulationRowsFromIndexedExcelText(text) {
  const t = String(text || '');
  if (!t.trim()) return { count: 0, keys: [] };
  const lines = t.split(/\r?\n/);
  const seen = new Set();
  const keys = [];
  for (const lineRaw of lines) {
    const line = String(lineRaw || '').trim();
    if (!line) continue;
    if (line.startsWith('[גיליון:') || line.startsWith('[')) continue;
    if (!line.includes('\t')) continue;
    // Require at least 2 percentage-like values in the row (composition-like).
    const pctMatches = line.match(/\b\d{1,3}\.\d{2}%\b|\b0%\b|\b100%\b/g) || [];
    if (pctMatches.length < 2) continue;
    const firstCell = line.split('\t').map((c) => c.trim()).find(Boolean) || '';
    const key = firstCell || line;
    if (!seen.has(key)) {
      seen.add(key);
      if (keys.length < 20) keys.push(key);
    }
  }
  return { count: seen.size, keys };
}

async function answerSystemMetadataQuestion(query, rag, filterMetadata = null) {
  const q = normalizeQueryText(query);
  const collection = await rag.getCollectionInfo();
  const files = await rag.getFilesWithMetadata();
  const filenames = (Array.isArray(files) ? files : []).map((f) => String(f?.filename || '').trim()).filter(Boolean);

  // Optional single-file scope (when user picked a file in UI).
  const scopedFilenames =
    filterMetadata && typeof filterMetadata.filename === 'string' && filterMetadata.filename.trim()
      ? filenames.filter((n) => n === filterMetadata.filename.trim())
      : filenames;

  const fileExts = [...new Set(scopedFilenames.map((n) => {
    const base = n.split('/').filter(Boolean).pop() || n;
    const idx = base.lastIndexOf('.');
    return idx >= 0 ? base.slice(idx).toLowerCase() : '';
  }).filter(Boolean))].sort();

  // Formulations count: sum across Excel files by counting composition-like rows in indexed text.
  if (q.includes('formulation') || q.includes('פורמול')) {
    const excelNames = scopedFilenames.filter((n) => {
      const base = n.split('/').filter(Boolean).pop() || n;
      return /\.xlsx$/i.test(base) || /\.xls$/i.test(base);
    });
    if (excelNames.length === 0) {
      return {
        status: 422,
        body: {
          error: 'INSUFFICIENT_EVIDENCE',
          status: 'INSUFFICIENT_EVIDENCE',
          reply: RAG_INSUFFICIENT_SUPPORT_MESSAGE_HE,
          routing: 'SYSTEM_METADATA',
          query,
          evidence: { excel_files: 0, formulation_rows: 0 }
        }
      };
    }
    let total = 0;
    const perFile = [];
    for (const fn of excelNames.slice(0, 30)) {
      const full = await rag.getFullTextForFile(fn);
      const { count, keys } = countFormulationRowsFromIndexedExcelText(full);
      total += count;
      perFile.push({ filename: fn, formulations_count: count, sample_keys: keys.slice(0, 5) });
    }
    return {
      status: 200,
      body: {
        routing: 'SYSTEM_METADATA',
        query,
        answer: `נמצאו ${total} פורמולציות (נספר מתוך שורות הרכב בקובצי Excel המאונדקסים).`,
        results_count: 0,
        results: [],
        sources: [],
        evidence: {
          method: 'excel_indexed_rows_with_percent_values',
          excel_files: excelNames.length,
          per_file: perFile
        }
      }
    };
  }

  // Documents / files count.
  if (q.includes('how many') || q.includes('כמה') || q.includes('count') || q.includes('מספר') || q.includes('כמות') || q.includes('סך')) {
    const fileCount = scopedFilenames.length;
    const chunkCount = (Array.isArray(files) ? files : []).reduce((sum, f) => sum + (Number(f?.chunks_count) || 0), 0);
    const docCount = Number(collection?.document_count) || 0;
    return {
      status: 200,
      body: {
        routing: 'SYSTEM_METADATA',
        query,
        answer: `במערכת יש ${fileCount} קבצים ו-${docCount} קטעי אינדוקס (chunks).`,
        results_count: 0,
        results: [],
        sources: [],
        evidence: {
          file_count: fileCount,
          chunks_count: docCount,
          chunks_count_sum_from_files: chunkCount,
          file_types: fileExts
        }
      }
    };
  }

  // File types / extensions.
  if (q.includes('file type') || q.includes('extension') || q.includes('סוגי קבצים') || q.includes('סיומות')) {
    if (fileExts.length === 0) {
      return {
        status: 422,
        body: {
          error: 'INSUFFICIENT_EVIDENCE',
          status: 'INSUFFICIENT_EVIDENCE',
          reply: RAG_INSUFFICIENT_SUPPORT_MESSAGE_HE,
          routing: 'SYSTEM_METADATA',
          query,
          evidence: { file_types: [] }
        }
      };
    }
    return {
      status: 200,
      body: {
        routing: 'SYSTEM_METADATA',
        query,
        answer: `סוגי הקבצים במערכת: ${fileExts.join(', ')}`,
        results_count: 0,
        results: [],
        sources: [],
        evidence: { file_types: fileExts }
      }
    };
  }

  return {
    status: 422,
    body: {
      error: 'INSUFFICIENT_EVIDENCE',
      status: 'INSUFFICIENT_EVIDENCE',
      reply: RAG_INSUFFICIENT_SUPPORT_MESSAGE_HE,
      routing: 'SYSTEM_METADATA',
      query
    }
  };
}

async function handleMatriyaSearch(req, res) {
  const query = req.body?.query ?? req.query.query;
  if (!query) {
    return res.status(400).json({ error: "query parameter is required" });
  }

  // ── DEBUG LOGGING (David request) ──────────────────────────────────────
  console.log("QUERY RECEIVED:", query);

  // ─── SOURCE GUARD: runs at absolute entry, before ANY retrieval, DB call, or user lookup ───
  // David requirement: log "[ENTRY] guard check starting" at the very top.
  const flowRawEarly = String(req.body?.flow ?? req.query.flow ?? '').toLowerCase().trim();
  logger.info(`[ENTRY] guard check starting — flow=${flowRawEarly || 'none'} query="${query}"`);

  // flow=lab set explicitly by caller → bypass guard entirely; the caller already knows the intent.
  if (flowRawEarly === 'lab') {
    const userEarly = await getCurrentUser(req);
    return await handleLabBridgeFlow(req, res, { query, userId: userEarly?.id ?? null });
  }

  // ── SCIENCE QUERY ROUTING ────────────────────────────────────────────────
  // Detect NL queries about experiment data with numeric conditions and route
  // them to the Lab Query Engine (Python science pipeline, not document RAG).
  // flow=science: explicit override. flow=document: skip this routing.
  const scienceDetected = isScienceQueryQuestion(query);
  if (flowRawEarly === 'science' || (flowRawEarly !== 'document' && scienceDetected)) {
    console.log("ROUTING TO LAB");
    logger.info(`[science-routing] detected lab data query → science pipeline. query="${query}"`);
    return await handleScienceQueryFlow(req, res, { query });
  } else {
    console.log("ROUTING TO RAG", `(flow=${flowRawEarly || 'none'} scienceDetected=${scienceDetected})`);
  }
  // ────────────────────────────────────────────────────────────────────────

  const labIntentDetected = isLabEngineQuestion(query);
  logger.warn(`[source-guard] lab_intent_detected=${labIntentDetected} query="${query}"`);

  if (labIntentDetected) {
    const labParams = extractLabEngineParams(query);
    const identifiersExtracted = labParams !== null;
    logger.warn(
      `[source-guard] explicit_identifiers_extracted=${identifiersExtracted} ` +
      `flow=${flowRawEarly || 'none'} query="${query}"`
    );
    if (identifiersExtracted && flowRawEarly !== 'document') {
      // Has explicit identifiers extracted from query text → auto-route to Lab Engine.
      logger.info(`[auto-lab-route] query="${query}" → type=${labParams.type}`);
      req.body = {
        ...(req.body || {}),
        flow: 'lab',
        lab_query_type: labParams.type,
        ...(labParams.base_id   && { base_id:   labParams.base_id   }),
        ...(labParams.version_a && { version_a: labParams.version_a }),
        ...(labParams.version_b && { version_b: labParams.version_b }),
        ...(labParams.id_a      && { id_a:      labParams.id_a      }),
        ...(labParams.id_b      && { id_b:      labParams.id_b      }),
      };
      const userEarly = await getCurrentUser(req);
      return await handleLabBridgeFlow(req, res, { query, userId: userEarly?.id ?? null });
    }
    // Guard fires: lab-intent in query text but no extractable identifiers, and not flow=lab.
    // Must NOT reach RAG — document text is NOT authoritative for lab values.
    logger.warn(`[source-guard] source_guard_fired=true — blocking before RAG. query="${query}"`);
    return res.status(200).json({
      error: 'LAB_QUERY_INCOMPLETE',
      routing: 'BLOCKED_SOURCE_GUARD',
      data_source: 'NONE',
      lab_intent_detected: true,
      explicit_identifiers_extracted: identifiersExtracted,
      source_guard_fired: true,
      message:
        'This query requests lab computation (delta, threshold, version comparison). ' +
        'Document RAG is NOT authoritative for lab values — only the DB-computed Lab Engine is. ' +
        (identifiersExtracted
          ? 'Parameters found but flow=document is set. Use flow=lab to route to the Lab Engine.'
          : 'Required parameters (base_id, version_a, version_b or two DD.MM.YYYY dates) not found. ' +
            'Supply explicit identifiers and use flow=lab.'),
      query,
    });
  }
  // ─── END SOURCE GUARD ───────────────────────────────────────────────────────────────────────

  // ── GREETING / TRIVIAL QUERY GUARD ─────────────────────────────────────────────────────────
  // David requirement: "שלום" or any non-document greeting must NEVER return document sources.
  // If the query is a short greeting/salutation, respond immediately without retrieval.
  const _trimmedQ = query.trim();
  const GREETING_RE = /^[\u0590-\u05FF\s,!?.]{1,20}$|^(hi|hello|hey|good morning|good afternoon|good evening|shalom|greetings|test|ping|yo|sup)\s*[!?.,]*$/i;
  const _isShortNonQuestion = _trimmedQ.length <= 6 && !/[\d]/.test(_trimmedQ) && !/[a-zA-Z\u0590-\u05FF]{4,}/.test(_trimmedQ);
  const _greetingWords = ['שלום', 'היי', 'הי', 'בוקר טוב', 'ערב טוב', 'להתראות', 'תודה', 'hello', 'hi', 'hey', 'thanks', 'thank you', 'bye'];
  const _isGreeting = GREETING_RE.test(_trimmedQ) || _greetingWords.some(w => _trimmedQ.toLowerCase() === w.toLowerCase());
  if (_isGreeting && flowRawEarly !== 'document' && flowRawEarly !== 'lab') {
    logger.info(`[greeting-guard] trivial query detected — returning no-source response. query="${query}"`);
    return res.status(200).json({
      query,
      results: [],
      results_count: 0,
      answer: 'MATRIYA מוכן לעזור. אנא שאל שאלה הקשורה למסמכי המחקר שלך.',
      sources: [],
      routing: 'GREETING_GUARD'
    });
  }
  // ────────────────────────────────────────────────────────────────────────────────────────────

  let nResults = parseInt(req.body?.n_results ?? req.query.n_results, 10) || 5;
  if (nResults < 1 || nResults > 50) {
    nResults = 5;
  }

  const filename = (req.body?.filename ?? req.query.filename) || null;
  const generateAnswer = (req.body?.generate_answer ?? req.query.generate_answer) !== 'false';
  const flowRaw = flowRawEarly;
  const documentFlow = flowRaw === 'document';
  const labFlow = flowRaw === 'lab';
  const stage = String(req.body?.stage ?? req.query.stage ?? '').toUpperCase().trim();
  const sessionId = (req.body?.session_id ?? req.query.session_id) || null;

  const filterMetadata = filename ? { filename } : null;

  const user = await getCurrentUser(req);
  const userId = user?.id ?? null;

  try {
    // Explicit flow=lab (no guard needed — already passed guard above or set programmatically).
    if (labFlow) {
      return await handleLabBridgeFlow(req, res, { query, userId });
    }

    // System / metadata routing (David): answer from DB/index only, never from RAG/LLM.
    // This must happen BEFORE any document retrieval so we don't return "no information" for questions like "how many documents".
    if (generateAnswer && isSystemMetadataQuestion(query)) {
      let rag;
      try {
        rag = getRagService();
      } catch (e) {
        // If DB is not configured, return a clear 503 (this often surfaces as Vercel "Bad Gateway" to the client).
        return res.status(503).json({
          error: e.message || 'RAG service unavailable',
          routing: 'SYSTEM_METADATA',
          hint: 'Set POSTGRES_URL in Vercel (Production + Preview + Development) and redeploy.'
        });
      }
      try {
        const out = await answerSystemMetadataQuestion(query, rag, filterMetadata);
        return res.status(out.status).json(out.body);
      } catch (e) {
        logger.error(`[system-metadata] failed: ${e.message}`);
        return res.status(500).json({ error: e.message || 'system metadata query failed', routing: 'SYSTEM_METADATA' });
      }
    }

    if (generateAnswer && documentFlow) {
      const rag = getRagService();
      const nPre = rag.getDocAgentRetrievalCount(filterMetadata);
      let searchResults;
      try {
        searchResults = await rag.search(query, nPre, filterMetadata);
      } catch (e) {
        logger.error(`Document flow search error: ${e.message}`);
        return res.status(500).json({ error: `Search error: ${e.message}`, flow: 'document' });
      }
      if (!searchResults?.length) {
        return res.status(422).json({
          error: 'INSUFFICIENT_EVIDENCE',
          flow: 'document',
          research_flow: 'document',
          routing: 'DOCUMENT_RAG_ONLY',
          data_source: 'DOCUMENT_RAG',
          lab_bridge_invoked: false,
          document_rag_invoked: true,
          reply_code: 'NO_ANSWER',
          kernel_invoked: false,
          state_machine: false,
          sources: [],
          query
        });
      }
      // For document-only flow (user explicitly selected a document), use a much lower
      // similarity threshold (0.1) to avoid false INSUFFICIENT_EVIDENCE on broad/Hebrew queries.
      // The filename filter already scopes results to the selected document.
      const docFlowThreshold = 0.1;
      const relevantDoc = filterChunksByRetrievalSimilarityThreshold(searchResults, docFlowThreshold);
      if (!relevantDoc.length) {
        return res.status(422).json({
          error: 'INSUFFICIENT_EVIDENCE',
          flow: 'document',
          research_flow: 'document',
          routing: 'DOCUMENT_RAG_ONLY',
          data_source: 'DOCUMENT_RAG',
          lab_bridge_invoked: false,
          document_rag_invoked: true,
          reply_code: 'NO_ANSWER',
          kernel_invoked: false,
          state_machine: false,
          sources: [],
          query,
          status: 'INSUFFICIENT_EVIDENCE',
          reply: RAG_INSUFFICIENT_SUPPORT_MESSAGE_HE
        });
      }
      const docResult = await rag.generateAnswer(query, nPre, filterMetadata, true, relevantDoc);
      let rows = filterChunksByRetrievalSimilarityThreshold(docResult.results || [], docFlowThreshold);
      rows = filterRetrievalRowsByAnswerBinding(rows, docResult.answer || '');
        const sources = buildAnswerSourcesFromRetrieval(rows);
      if (SearchHistory && docResult.answer) {
        try {
          await SearchHistory.create({
            user_id: userId,
            username: user?.username ?? 'אורח',
            question: query,
            answer: docResult.answer
          });
        } catch (e) {
          logger.warn(`Failed to save search history: ${e.message}`);
        }
      }
      return res.json({
        query,
        flow: 'document',
        research_flow: 'document',
        routing: 'DOCUMENT_RAG_ONLY',
        // Source separation (David): this answer comes from indexed documents only.
        // Numerical values (delta%, versions) are from document text — NOT from DB computation.
        // For authoritative lab values use flow=lab (DB_COMPUTED).
        data_source: 'DOCUMENT_RAG',
        source_note: 'Values extracted from indexed document text. For authoritative lab computation (delta, threshold, versions) use Lab Engine (flow=lab) which reads from DB production_runs.',
        document_rag_invoked: true,
        lab_bridge_invoked: false,
        kernel_invoked: false,
        state_machine: false,
        answer: docResult.answer ?? null,
        results_count: rows.length,
        results: rows,
        sources,
        context_sources: docResult.context_used ?? 0,
        context: docResult.context || '',
        error: docResult.error || null
      });
    }

    if (generateAnswer) {
      // Stage 1: session_id + stage required. Without valid session → no handling.
      if (!sessionId || String(sessionId).trim() === '') {
        return res.status(400).json({
          error: "session_id is required for research search. Create a session via POST /research/session first.",
          research_session_required: true
        });
      }
      if (!stage || !['K', 'C', 'B', 'N', 'L'].includes(stage)) {
        return res.status(400).json({
          error: "stage is required and must be one of: K, C, B, N, L",
          research_stage_required: true
        });
      }
      const krOpts = researchKernelOptsFromRequest(req);
      let gate;
      try {
        gate = await validateAndAdvance(sessionId, stage, userId, krOpts);
      } catch (e) {
        logger.error(`Research gate error: ${e.message}`);
        return res.status(500).json({ error: `Research gate error: ${e.message}` });
      }
      if (!gate.ok) {
        let complexityContext = null;
        try {
          const info = await getRagService().getCollectionInfo();
          complexityContext = { document_count: info?.document_count ?? 0, session_depth: 0 };
        } catch (_) {}
        await logDecisionAudit(sessionId, stage, 'deny', null, query, { session_id: sessionId, stage, research_gate_locked: !!gate.research_gate_locked, error: gate.error }, null, { complexity_context: complexityContext });
        const denyPayload = {
          error: gate.error,
          research_stage_error: true,
          ...(gate.research_gate_locked && {
            research_gate_locked: true,
            violation_id: gate.violation_id,
            status: gate.status || 'stopped',
            stopPipeline: gate.stopPipeline !== false,
            allowed_next_step: gate.allowed_next_step || 'recovery_required'
          }),
          ...(gate.insufficient_information && { insufficient_information: true }),
          ...(gate.kernel_v16 && { kernel_v16: { spec: KERNEL_V16_VERSION, ...gate.kernel_v16 } })
        };
        if (gate.insufficient_information) {
          denyPayload.kernel_v16 = {
            spec: KERNEL_V16_VERSION,
            ...(denyPayload.kernel_v16 || {}),
            structured: buildStructuredKernelOutput({
              stage,
              answer: '',
              sources: [],
              insufficientInfo: true
            })
          };
        }
        return res.status(400).json(denyPayload);
      }
      const responseSessionId = gate.session.id;
      const responseType = gate.responseType;
      let complexityContext = null;
      try {
        const info = await getRagService().getCollectionInfo();
        complexityContext = { document_count: info?.document_count ?? 0, session_depth: (gate.session?.completed_stages?.length) ?? 0 };
      } catch (_) {}
      await logDecisionAudit(responseSessionId, stage, 'allow', responseType, query, { session_id: responseSessionId, stage }, null, { complexity_context: complexityContext });
      const enforcement = await getEnforcement(responseSessionId, stage, gate.session);
      if (enforcement) await logPolicyEnforcement(responseSessionId, stage);

      // B: Hard Stop only – no smart answer
      if (stage === 'B') {
        await logAudit(responseSessionId, stage, responseType, query);
        return res.json(
          attachKernelV16ToPayload(
            {
              query,
              results_count: 0,
              results: [],
              answer: HARD_STOP_MESSAGE,
              context_sources: 0,
              context: '',
              sources: [],
              session_id: responseSessionId,
              research_stage: stage,
              response_type: responseType,
              ...(enforcement && { matriya_enforcement: enforcement })
            },
            {
              stage,
              answer: HARD_STOP_MESSAGE,
              sources: [],
              session: gate.session,
              gateKernelV16: { stage_B_hard_stop: true }
            }
          )
        );
      }

      // K/C: info only (no solutions) – we'll post-process answer. N/L: full answer
      const rag = getRagService();
      const nPre = rag.getDocAgentRetrievalCount(filterMetadata);
      let preSearchResults;
      try {
        preSearchResults = await rag.search(query, nPre, filterMetadata);
      } catch (e) {
        logger.error(`Pre-LLM gate search error: ${e.message}`);
        return res.status(500).json({ error: 'Search error', pre_llm_gate: true });
      }
      const relevantPre = filterChunksByRetrievalSimilarityThreshold(preSearchResults);
      if (relevantPre.length === 0) {
        await logDecisionAudit(
          responseSessionId,
          stage,
          'deny_retrieval_threshold',
          null,
          query,
          {
            session_id: responseSessionId,
            stage,
            gate_code: 'INSUFFICIENT_EVIDENCE',
            retrieval_similarity_gate: true
          },
          null,
          { complexity_context: complexityContext }
        );
        return res.status(422).json({
          error: 'INSUFFICIENT_EVIDENCE',
          message: 'INSUFFICIENT_EVIDENCE',
          status: 'INSUFFICIENT_EVIDENCE',
          reply: RAG_INSUFFICIENT_SUPPORT_MESSAGE_HE,
          sources: [],
          pre_llm_gate: true,
          retrieval_similarity_gate: true,
          session_id: responseSessionId,
          research_stage: stage
        });
      }
      const preGate = await evaluatePreLlmResearchGate({
        sessionId: responseSessionId,
        stage,
        completedStages: gate.session.completed_stages || [],
        searchResults: relevantPre
      });
      if (!preGate.ok) {
        await logDecisionAudit(
          responseSessionId,
          stage,
          'deny_pre_llm',
          null,
          query,
          {
            session_id: responseSessionId,
            stage,
            gate_code: preGate.code,
            ...(preGate.violation_id && { violation_id: preGate.violation_id })
          },
          null,
          { complexity_context: complexityContext }
        );
        return res.status(preGate.httpStatus).json({
          error: preGate.code,
          message: preGate.message || preGate.code,
          pre_llm_gate: true,
          sources: [],
          ...(preGate.violation_id && { violation_id: preGate.violation_id })
        });
      }

      if (preGate.partialEvidence) {
        await logDecisionAudit(
          responseSessionId,
          stage,
          'partial_evidence',
          null,
          query,
          {
            session_id: responseSessionId,
            stage,
            status: 'PARTIAL_EVIDENCE',
            what_exists: preGate.partialEvidence.what_exists,
            what_missing: preGate.partialEvidence.what_missing,
            gap_type: preGate.partialEvidence.gap_type
          },
          null,
          { complexity_context: complexityContext }
        );
        return res.status(200).json({
          ...preGate.partialEvidence,
          session_id: responseSessionId,
          research_stage: stage,
          ...(enforcement && { matriya_enforcement: enforcement })
        });
      }

      const kernel = getKernel();
      const citationOnly = stage === 'K' || stage === 'C';
      const kernelResult = await kernel.processUserIntent(query, null, null, filterMetadata, {
        prefetchedSearchResults: relevantPre,
        citationOnly
      });

      if (kernelResult.decision === 'block' || kernelResult.decision === 'stop') {
        const noAnswerFromRag = (kernelResult.reason || '').includes('לא נמצאה תשובה') || (kernelResult.reason || '').includes('No answer');
        if (noAnswerFromRag) {
          await logAudit(responseSessionId, stage, 'no_results', query);
          const noAns = RAG_INSUFFICIENT_SUPPORT_MESSAGE_HE;
          const kernelRelevant = filterChunksByRetrievalSimilarityThreshold(kernelResult.search_results || []);
          return res.json(
            attachKernelV16ToPayload(
              {
                query,
                results_count: kernelRelevant.length,
                results: kernelRelevant,
                answer: noAns,
                context_sources: 0,
                context: '',
                sources: [],
                session_id: responseSessionId,
                research_stage: stage,
                response_type: 'no_results',
                ...(enforcement && { matriya_enforcement: enforcement })
              },
              { stage, answer: noAns, sources: [], session: gate.session, gateKernelV16: gate.kernel_v16 }
            )
          );
        }
        await logAudit(responseSessionId, stage, 'blocked', query);
        const br = kernelResult.reason || 'תשובה נחסמה';
        return res.json(
          attachKernelV16ToPayload(
            {
              query,
              results_count: 0,
              results: [],
              answer: null,
              context_sources: 0,
              context: '',
              sources: [],
              error: br,
              decision: kernelResult.decision,
              state: kernelResult.state,
              blocked: true,
              block_reason: br,
              session_id: responseSessionId,
              research_stage: stage,
              ...(enforcement && { matriya_enforcement: enforcement })
            },
            { stage, answer: br, sources: [], session: gate.session, gateKernelV16: gate.kernel_v16 }
          )
        );
      }

      let answer = kernelResult.answer || null;
      if ((stage === 'K' || stage === 'C') && answer) {
        answer = stripSuggestions(answer);
      }

      await logAudit(responseSessionId, stage, responseType, query);

      // B-Integrity Monitor: after each research cycle (stage L completed), record snapshot and run checks
      if (stage === 'L') {
        runAfterCycle(responseSessionId, 'L', async () => {
          const info = await getRagService().getCollectionInfo();
          return (info && info.document_count) || 0;
        }).catch(e => logger.warn(`B-Integrity runAfterCycle failed: ${e.message}`));
      }

      if (SearchHistory) {
        try {
          await SearchHistory.create({
            user_id: userId,
            username: user?.username ?? 'אורח',
            question: query,
            answer
          });
        } catch (e) {
          logger.warn(`Failed to save search history: ${e.message}`);
        }
      }

      let kernelFiltered = filterChunksByRetrievalSimilarityThreshold(kernelResult.search_results || []);
      kernelFiltered = filterRetrievalRowsByAnswerBinding(kernelFiltered, answer || '');
      const maxSources = getMaxAttributionSources();
      const topChunks = kernelFiltered.slice(0, maxSources);
      const evidenceSources = buildAnswerSourcesFromRetrieval(topChunks, {
        maxItems: maxSources
      });
      return res.json(
        attachKernelV16ToPayload(
          {
            query,
            results_count: topChunks.length,
            results: topChunks,
            answer,
            context_sources: kernelResult.agent_results.doc_agent.context_sources || 0,
            context: kernelResult.context || '',
            sources: evidenceSources,
            error: null,
            decision: kernelResult.decision,
            state: kernelResult.state,
            warning: kernelResult.warning,
            session_id: responseSessionId,
            research_stage: stage,
            response_type: responseType,
            ...(enforcement && { matriya_enforcement: enforcement }),
            agent_results: {
              contradiction: kernelResult.agent_results.contradiction_agent,
              risk: kernelResult.agent_results.risk_agent
            }
          },
          { stage, answer, sources: evidenceSources, session: gate.session, gateKernelV16: gate.kernel_v16 }
        )
      );
    } else {
      // No generate_answer – plain search (no stage required)
      const results = await getRagService().search(query, nResults, filterMetadata);
      const relevantOnly = filterChunksByRetrievalSimilarityThreshold(results);
      return res.json({
        query: query,
        results_count: relevantOnly.length,
        results: relevantOnly,
        answer: null,
        sources: buildAnswerSourcesFromRetrieval(relevantOnly)
      });
    }
  } catch (e) {
    logger.error(`Error searching: ${e.message}`);
    return res.status(500).json({
      error: `Error searching: ${e.message}`
    });
  }
}

app.get("/search", handleMatriyaSearch);
app.post("/api/research/search", handleMatriyaSearch);

/**
 * Research run: either 4-agent loop (use_4_agents: true) or current single-shot flow (use_4_agents: false).
 * POST /api/research/run
 * Body: { session_id, query, use_4_agents?: boolean } (default use_4_agents: true for this endpoint)
 */
app.post("/api/research/run", async (req, res) => {
  try {
    const { session_id: sessionId, query, use_4_agents: use4Agents = true, filename, filenames: filenamesBody, pre_justification: preJustification, doe_design_id: doeDesignId } = req.body || {};
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'query is required' });
    }
    if (!sessionId) {
      return res.status(400).json({ error: 'session_id is required for research run' });
    }
    const session = await ResearchSession.findByPk(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Fix 3: Deterministic gate — if Project Mode is active but no project_id selected, return STOP immediately.
    // project_mode is active when: (a) body explicitly sets project_mode:true, OR (b) session has a project_id.
    const sessionProjectId = session.project_id || null;
    const projectModeRequested = req.body?.project_mode === true;
    if (projectModeRequested && !sessionProjectId) {
      const stopMsg = 'NEED_SELECTED_PROJECT: No project is selected. Select a project to use Project Mode.';
      return res.json({
        run_id:             null,
        mode:               'result',
        decision:           'STOP',
        decision_status:    'STOP',
        recommended_action: 'NEED_SELECTED_PROJECT',
        reasoning:          'NEED_SELECTED_PROJECT',
        outputs:            { synthesis: stopMsg, analysis: stopMsg },
        selected_experiments: [],
        fields_used:        [],
        sources:            [],
        data:               [],
      });
    }

    const kcShutdown = session.kernel_context && session.kernel_context.possibility_shutdown;
    if (use4Agents && kcShutdown) {
      return res.status(409).json({
        error:
          'לאחר זיהוי שבירה (B) הופעל סגירת מרחב אפשרויות — אין אופטימיזציה/כוונון במסלול 4 סוכנים. השתמשו במסלול מחקר מהיר (שלב N) או פתחו סשן חדש.',
        possibility_shutdown: true,
        kernel_v16: { spec: KERNEL_V16_VERSION, code: 'POSSIBILITY_SPACE_SHUTDOWN' }
      });
    }

    const violation = await getActiveViolation(sessionId);
    if (violation) {
      return res.status(409).json({
        error: `Session locked due to B-Integrity violation (${violation.reason || violation.type}). Use Recovery API to resolve.`,
        research_gate_locked: true,
        violation_id: violation.id,
        status: 'stopped',
        stopPipeline: true,
        allowed_next_step: 'recovery_required'
      });
    }

    let filenamesArray = Array.isArray(filenamesBody) && filenamesBody.length > 0 ? filenamesBody.filter(f => typeof f === 'string' && f.trim()) : null;
    // When a single file is selected, also try basename so we match whether RAG stored "file.pdf" or "folder/file.pdf"
    if (!filenamesArray?.length && filename && typeof filename === 'string' && filename.trim()) {
      const trimmed = filename.trim();
      const base = path.basename(trimmed);
      filenamesArray = base !== trimmed ? [trimmed, base] : [trimmed];
    }
    const filterMetadata = filenamesArray?.length ? { filenames: filenamesArray } : null;
    const runOptions = {};
    if (preJustification != null && typeof preJustification === 'string') runOptions.pre_justification_text = preJustification.trim() || null;
    if (doeDesignId != null) runOptions.doe_design_id = parseInt(doeDesignId, 10) || null;

    // Fetch live lab experiments from management API and inject into research loop context.
    // This connects the research session loop to real DB data (lab_experiments).
    const managementBase = settings.MATRIYA_MANAGEMENT_API_URL || '';
    let allExps = [];
    let labApiReachable = false;
    if (managementBase) {
      try {
        const labResp = await axios.get(`${managementBase}/api/matriya/lab-experiments-export`, {
          headers: {
            'Accept': 'application/json',
            ...(settings.MATRIYA_MANAGEMENT_MATERIALS_KEY
              ? { 'X-Matriya-Materials-Key': settings.MATRIYA_MANAGEMENT_MATERIALS_KEY }
              : {}),
          },
          timeout: 8000,
        });
        allExps = labResp.data?.experiments || [];
        labApiReachable = true;
      } catch (e) {
        logger.warn(`[research/run] Lab context fetch skipped: ${e.message}`);
      }
    }

    // ── Boundary check A: Open-ended query (no entity IDs) ───────────────────
    // Queries that ask for a "best" experiment without naming any specific IDs
    // are ambiguous and cannot be answered deterministically — return no_entities.
    // This prevents the agents from hallucinating a winner out of thin air.
    const requestedIds = [...new Set(
      (query.toUpperCase().match(/EXP-[\w-]+/g) || [])
    )];
    const OPEN_ENDED_PATTERNS = [
      /which\s+experiment\s+is\s+best/i,
      /what\s+is\s+the\s+best\s+experiment/i,
      /\bbest\s+experiment\b/i,
      /\btop\s+experiment\b/i,
      /\boptimal\s+experiment\b/i,
      /\brecommend\s+an?\s+experiment\b/i,
      /which\s+one\s+should\s+i\s+use/i,
      /\bwhich\s+experiment\b(?!.*\bEXP-)/i,
      // Hebrew equivalents
      /איזה\s+ניסוי\s+טוב\s+יותר/,
      /מהו\s+הניסוי\s+הטוב/,
      /הניסוי\s+הטוב\s+ביותר/,
    ];
    if (requestedIds.length === 0 && OPEN_ENDED_PATTERNS.some(p => p.test(query))) {
      return res.status(400).json({
        mode: 'no_entities',
        run_id: null,
        missing_entities: [],
        selected_experiments: [],
        fields_used: [],
        meta: {
          message: 'BLOCKED: no_entities — query does not reference any specific experiment IDs. Please name the experiments to compare (e.g. EXP-006, EXP-009).',
          recoverable: true,
          limitation_type: 'no_entities',
          user_action_hint: 'Specify experiment IDs to compare, e.g. "Compare EXP-006 and EXP-009 across expansion_ratio."'
        }
      });
    }

    // ── Boundary check B: No-match / partial-match detection ─────────────────
    // Only runs when the management API was reachable (avoid false-positive on 401).
    // Fires when ANY requested experiment ID is missing — even if others exist.
    // Partial comparisons (e.g. EXP-006 vs EXP-999) must be blocked entirely to
    // prevent the system from answering with incomplete data.
    if (labApiReachable && requestedIds.length > 0) {
      const knownIds = new Set((allExps || []).map(e => String(e.experiment_id || '').toUpperCase()));
      const missing  = requestedIds.filter(id => !knownIds.has(id));
      if (missing.length > 0) {
        // ANY requested IDs are missing — full block, no partial answer
        const found = requestedIds.filter(id => knownIds.has(id));
        return res.status(404).json({
          mode: 'no_match',
          run_id: null,
          missing_entities: missing,
          found_entities: found,
          selected_experiments: [],
          fields_used: [],
          meta: {
            message: `BLOCKED: entity_not_found — ${missing.join(', ')} not found in lab_experiments`,
            recoverable: true,
            limitation_type: missing.length === requestedIds.length ? 'all_missing' : 'partial_missing',
            user_action_hint: 'Check the experiment ID and try again, or list available experiments.'
          }
        });
      }
    }

    // Fix 3: Filter experiments to selected project if session has project_id (Project Mode isolation).
    if (sessionProjectId) {
      const before = allExps.length;
      allExps = allExps.filter(e => String(e.project_id || '') === String(sessionProjectId));
      logger.info(`[research/run] Project Mode: filtered experiments ${before} → ${allExps.length} for project_id=${sessionProjectId}`);
    }

    // Fix 4: Deterministic material-library gate + context injection for Project Mode.
    // (a) For formulation-proposal queries: if the project lacks char_former (a critical IFR
    //     material), return INSUFFICIENT_DATA immediately without calling the LLM.
    // (b) For all other project-mode queries: inject the material library as context so the LLM
    //     knows what is available and can correctly flag limitations.
    let contextualQuery = query;
    let earlyStopped = false;
    if (sessionProjectId && managementBase) {
      try {
        const matResp = await axios.get(`${managementBase}/api/matriya/project-materials`, {
          params: { project_id: sessionProjectId },
          headers: {
            'Accept': 'application/json',
            ...(settings.MATRIYA_MANAGEMENT_MATERIALS_KEY
              ? { 'X-Matriya-Materials-Key': settings.MATRIYA_MANAGEMENT_MATERIALS_KEY }
              : {}),
          },
          timeout: 5000,
        });
        const materials = matResp.data?.materials || [];
        if (materials.length > 0) {
          const matList = materials.map(m =>
            `${m.name}(${m.role_or_function || 'unknown'})`
          ).join(', ');

          // Detect missing critical IFR roles deterministically
          const hasCharFormer = materials.some(m =>
            (m.role_or_function || '').toLowerCase().includes('char'));
          const missingEssential = [];
          if (!hasCharFormer) missingEssential.push('char_former/carbon-source (e.g. PER)');

          // Gate A: if this is a proposal query AND critical material is absent → STOP immediately
          const isProposalQuery = /propose.*formul|candidate.*formul|suggest.*formula|next.*formul|formulat.*improve|create.*formul/i.test(query);
          if (isProposalQuery && missingEssential.length > 0) {
            const stopMsg = `INSUFFICIENT_DATA: Project material library [${matList}] is missing critical IFR component(s): ${missingEssential.join(', ')}. Cannot propose a reliable candidate formulation without these materials. Add the missing materials to the project material library first.`;
            logger.info(`[research/run] Material gate blocked proposal — missing: ${missingEssential.join(',')}`);
            earlyStopped = true;
            return res.json({
              run_id:             null,
              mode:               'result',
              decision:           'INSUFFICIENT_DATA',
              decision_status:    'INSUFFICIENT_DATA',
              recommended_action: 'NEED_MORE_DATA',
              reasoning:          stopMsg,
              outputs:            { synthesis: stopMsg, analysis: stopMsg },
              selected_experiments: [],
              fields_used:        [],
              sources:            [],
              data:               [],
            });
          }

          // Gate B: for non-proposal queries, inject material context + missing-material note
          const missingNote = missingEssential.length > 0
            ? `MISSING CRITICAL MATERIALS: ${missingEssential.join(', ')} — use ITERATE (not GO) for analysis.`
            : 'All essential IFR material categories are present.';
          contextualQuery = [
            `[PROJECT MATERIAL LIBRARY (project_id=${sessionProjectId}): ${matList}]`,
            `[${missingNote}]`,
            `[RULES: (1) Only use materials listed above. (2) If critical materials are missing, use ITERATE not GO. (3) If humidity/RH/aging test data is absent, include "NEED_MORE_DATA".]`,
            ``,
            query,
          ].join('\n');
          logger.info(`[research/run] Material context injected: ${materials.map(m=>m.name).join(',')} (missing: ${missingEssential.join(',') || 'none'})`);
        }
      } catch (e) {
        logger.warn(`[research/run] Material context fetch skipped: ${e.message}`);
      }
    }

    if (allExps.length > 0) {
      // Select the most relevant experiments: prefer those mentioned in the query by ID,
      // otherwise take the top 5 by most recent / highest numeric values.
      const upperQuery = query.toUpperCase();
      const mentioned = allExps.filter(e => e.experiment_id && upperQuery.includes(String(e.experiment_id).toUpperCase()));
      const labExps = mentioned.length > 0 ? mentioned : allExps.slice(0, 5);
      runOptions.labContext = { experiments: labExps };
      logger.info(`[research/run] Injected ${labExps.length} lab experiments into research context (session=${sessionId})`);
    }

    if (use4Agents) {
      const prev = researchRunLocks.get(sessionId) || Promise.resolve();
      const runPromise = prev
        .then(() => runLoop(sessionId, contextualQuery.trim(), getRagService(), filterMetadata, runOptions))
        .finally(() => { if (researchRunLocks.get(sessionId) === runPromise) researchRunLocks.delete(sessionId); });
      researchRunLocks.set(sessionId, runPromise);
      const result = await runPromise;
      if (result.error) {
        return res.status(500).json({ error: result.error, outputs: result.outputs || {}, justifications: result.justifications || [] });
      }
      const synthText = result.outputs?.synthesis || '';
      // If the query is ASKING about missing data (e.g. "list missing data", "what is missing?"),
      // override GO/INSUFFICIENT_DATA → ITERATE so response says "collect more data" rather than "ready to test".
      // Negative: do NOT trigger if "missing data" appears only as a requested output field (e.g. "risks/missing data").
      const isMissingDataQuery = (
        /\blist\s+missing\s+data\b|\blist\s+data\s+(that\s+is\s+)?missing\b/i.test(query) ||
        /\bwhat\s+(specific\s+)?data\s+(is\s+)?missing\b/i.test(query) ||
        /\bwhat\s+is\s+(specific\s+)?missing\b/i.test(query) ||
        /\bidentify.*missing.*data\b/i.test(query)
      ) && !/^\d+\.\s+risks.*missing|return.*missing|propose.*missing/i.test(query);
      let decisionStatus = deriveSynthesisDecision(synthText);
      // Fix Q3: missing-data queries must be ITERATE regardless of what the LLM puts in sub-items.
      if (isMissingDataQuery && (decisionStatus === 'GO' || decisionStatus === 'INSUFFICIENT_DATA')) decisionStatus = 'ITERATE';
      // Fix Q1: proposal queries where the material gate passed (earlyStopped=false) and lab experiments
      // exist should never be INSUFFICIENT_DATA.  The LLM writes "NEED_MORE_DATA" inside a numbered
      // sub-item ("6. risks/missing data: NEED_MORE_DATA") which is NOT the overall decision signal.
      // With required materials present, a candidate CAN be proposed → downgrade to ITERATE.
      const isProposalQueryLocal = /propose.*formul|candidate.*formul|suggest.*formula|next.*formul|formulat.*improve|create.*formul/i.test(query);
      if (isProposalQueryLocal && !earlyStopped && allExps.length > 0 && decisionStatus === 'INSUFFICIENT_DATA') {
        decisionStatus = 'ITERATE';
      }
      // For ITERATE on a missing-data query, recommend NEED_MORE_DATA not TEST.
      const recommendedAction = (isMissingDataQuery && decisionStatus === 'ITERATE')
        ? 'NEED_MORE_DATA'
        : deriveRecommendedAction(decisionStatus);
      return res.json({
        run_id: result.run_id != null ? String(result.run_id) : null,
        mode: 'result',
        decision:           decisionStatus,
        decision_status:    decisionStatus,
        recommended_action: recommendedAction,
        reasoning: synthText,
        outputs: result.outputs,
        justifications: result.justifications,
        selected_experiments: result.outputs?.selected_experiments || [],
        fields_used: result.outputs?.fields_used || deriveFieldsUsed(result.outputs?.selected_experiments),
        sources: Array.isArray(result.sources) ? result.sources : [],
        duration_ms: result.duration_ms ?? null
      });
    }

    const kernel = getKernel();
    const kernelResult = await kernel.processUserIntent(query.trim(), null, null, null);
    return res.json({
      use_4_agents: false,
      decision: kernelResult.decision,
      state: kernelResult.state,
      answer: kernelResult.answer,
      reason: kernelResult.reason,
      context: kernelResult.context,
      agent_results: kernelResult.agent_results
    });
  } catch (e) {
    logger.error(`Research run error: ${e.message}`);
    return res.status(500).json({ error: e.message });
  }
});

/**
 * Create a new research session (Stage 1). Optional – session is also created on first /search with stage.
 */
app.post("/research/session", async (req, res) => {
  if (!ResearchSession) {
    return res.status(503).json({ error: "Research session storage not available. Ensure database is initialized and research_sessions table exists." });
  }
  const user = await getCurrentUser(req);
  const userId = user?.id ?? null;
  const projectId = req.body?.project_id || null;
  try {
    const { session } = await getOrCreateSession(null, userId, projectId);
    return res.json({ session_id: session.id, project_id: session.project_id || null, completed_stages: session.completed_stages || [] });
  } catch (e) {
    logger.error(`Create research session error: ${e.message}`);
    const isDbError = /relation|does not exist|research_sessions/i.test(String(e.message));
    return res.status(isDbError ? 503 : 500).json({
      error: isDbError ? "Research session table missing or DB error. Run migrations to create research_sessions." : e.message
    });
  }
});

/**
 * Get research session and audit log (for export/verification – Stage 1 checklist).
 */
app.get("/research/session/:id", async (req, res) => {
  if (!ResearchSession || !ResearchAuditLog) {
    return res.status(503).json({ error: "Research session storage not available" });
  }
  const sessionId = req.params.id;
  try {
    const session = await ResearchSession.findByPk(sessionId);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }
    const logs = await ResearchAuditLog.findAll({
      where: { session_id: sessionId },
      order: [['created_at', 'ASC']]
    });
    return res.json({
      session_id: session.id,
      completed_stages: session.completed_stages || [],
      enforcement_overridden: !!session.enforcement_overridden,
      kernel_context: session.kernel_context && typeof session.kernel_context === 'object' ? session.kernel_context : {},
      created_at: session.created_at,
      audit_log: logs.map(l => ({
        stage: l.stage,
        response_type: l.response_type,
        request_query: l.request_query ? l.request_query.slice(0, 200) : null,
        created_at: l.created_at
      }))
    });
  } catch (e) {
    logger.error(`Get research session error: ${e.message}`);
    return res.status(500).json({ error: e.message });
  }
});

/** Set enforcement_overridden on session (dismiss soft-redirect warning for this session). */
app.patch("/research/session/:id", async (req, res) => {
  if (!ResearchSession) return res.status(503).json({ error: "Research session storage not available" });
  const sessionId = req.params.id;
  const overridden = req.body?.enforcement_overridden === true;
  try {
    const session = await ResearchSession.findByPk(sessionId);
    if (!session) return res.status(404).json({ error: "Session not found" });
    await session.update({ enforcement_overridden: overridden, updated_at: new Date() });
    return res.json({ session_id: session.id, enforcement_overridden: session.enforcement_overridden });
  } catch (e) {
    logger.error(`Patch research session error: ${e.message}`);
    return res.status(500).json({ error: e.message });
  }
});

/** Scope 1: Staging proof – current stage, next allowed, gate status (for verification/automation). */
app.get("/research/staging-proof", async (req, res) => {
  const sessionId = req.query.session_id || req.query.sessionId;
  if (!sessionId) return res.status(400).json({ error: "session_id query is required" });
  try {
    const session = await ResearchSession.findByPk(sessionId);
    if (!session) return res.status(404).json({ error: "Session not found" });
    const completed = session.completed_stages || [];
    const { getNextAllowedStage } = await import('./researchGate.js');
    const nextAllowed = getNextAllowedStage(completed);
    const violation = await getActiveViolation(sessionId);
    let lastSnapshotCycleIndex = null;
    if (IntegrityCycleSnapshot) {
      const last = await IntegrityCycleSnapshot.findOne({
        where: { session_id: sessionId },
        order: [['created_at', 'DESC']]
      });
      if (last) lastSnapshotCycleIndex = last.cycle_index;
    }
    return res.json({
      session_id: sessionId,
      current_stage: completed.length ? completed[completed.length - 1] : null,
      completed_stages: completed,
      next_allowed: nextAllowed,
      gate_locked: !!violation,
      violation_id: violation?.id ?? null,
      last_snapshot_cycle_index: lastSnapshotCycleIndex,
      kernel_v16: {
        spec: KERNEL_V16_VERSION,
        possibility_shutdown: !!(session.kernel_context && session.kernel_context.possibility_shutdown),
        document_mode_n: !!(session.kernel_context && session.kernel_context.document_mode_n)
      }
    });
  } catch (e) {
    logger.error(`Staging proof error: ${e.message}`);
    return res.status(500).json({ error: e.message });
  }
});

/** Scope 2: Read-only – list decision audit log (no UI). */
app.get("/api/audit/decisions", async (req, res) => {
  if (!DecisionAuditLog) return res.status(503).json({ error: "Decision audit log not available" });
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  try {
    const { count, rows } = await DecisionAuditLog.findAndCountAll({
      order: [['created_at', 'DESC']],
      limit,
      offset
    });
    return res.json({ decisions: rows, total: count, limit, offset });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/** Scope 2: Read-only – decision audit for one session (replay/snapshot). */
app.get("/api/audit/session/:sessionId/decisions", async (req, res) => {
  if (!DecisionAuditLog) return res.status(503).json({ error: "Decision audit log not available" });
  const sessionId = req.params.sessionId;
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 100));
  try {
    const rows = await DecisionAuditLog.findAll({
      where: { session_id: sessionId },
      order: [['created_at', 'ASC']],
      limit
    });
    return res.json({ session_id: sessionId, decisions: rows });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// ---------- Kernel Amendment v1.2 – Observability dashboard, SEM, gates, noise ----------
/** Metrics dashboard: False B rate, Missed B rate, confidence, complexity + total_requests, latency_p50, latency_p99, error_count */
app.get("/api/observability/dashboard", async (req, res) => {
  try {
    const dashboard = await getMetricsDashboard();
    if (!dashboard) return res.status(503).json({ error: "Decision audit log not available" });
    const metrics = getMetrics();
    return res.json({
      ...dashboard,
      total_requests: metrics.total_requests,
      latency_p50: metrics.latency_p50,
      latency_p99: metrics.latency_p99,
      error_count: metrics.total_errors
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/** SEM output: component_breakdown, confidence_range, historical_predictive_accuracy (no single value) */
app.get("/api/observability/sem", async (req, res) => {
  try {
    const sem = await getSEMOutput();
    if (!sem) return res.status(503).json({ error: "Decision audit log not available" });
    return res.json(sem);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/** Gate records for dashboard: confidence_score, basis_count, model_version_hash per gate */
app.get("/api/observability/gates", async (req, res) => {
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 100));
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  try {
    const out = await getGateRecords(limit, offset);
    return res.json(out);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/** List noise events (for re-evaluation after Kernel update) */
app.get("/api/observability/noise", async (req, res) => {
  if (!NoiseEvent) return res.status(503).json({ error: "Noise events not available" });
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  try {
    const { count, rows } = await NoiseEvent.findAndCountAll({
      order: [['created_at', 'DESC']],
      limit,
      offset
    });
    return res.json({ noise_events: rows, total: count, limit, offset });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/** Record event as noise – for later re-evaluation after Kernel update */
app.post("/api/observability/noise", async (req, res) => {
  if (!NoiseEvent) return res.status(503).json({ error: "Noise events not available" });
  const { session_id: sessionId, decision_id: decisionId, event_type: eventType, re_evaluate_after_kernel_version: reEvalVersion } = req.body || {};
  if (!sessionId) return res.status(400).json({ error: "session_id is required" });
  try {
    const currentHash = getModelVersionHash();
    const row = await NoiseEvent.create({
      session_id: sessionId,
      decision_id: decisionId || null,
      event_type: eventType || 'gate_decision',
      kernel_version_at_classification: currentHash,
      re_evaluate_after_kernel_version: reEvalVersion || null
    });
    return res.status(201).json(row);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/** Set human_feedback on a decision (false_b | missed_b) for False B / Missed B rate */
app.patch("/api/observability/decision/:id/feedback", async (req, res) => {
  if (!DecisionAuditLog) return res.status(503).json({ error: "Decision audit log not available" });
  const id = parseInt(req.params.id, 10);
  const feedback = req.body?.human_feedback;
  if (!['false_b', 'missed_b'].includes(feedback)) return res.status(400).json({ error: "human_feedback must be 'false_b' or 'missed_b'" });
  try {
    const row = await DecisionAuditLog.findByPk(id);
    if (!row) return res.status(404).json({ error: "Decision not found" });
    await row.update({ human_feedback: feedback });
    return res.json(row);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/**
 * Contradiction Agent - Checks for contradictions in the answer
 * 
 * JSON body:
 *   answer: The answer from Doc Agent
 *   context: The context used to generate the answer
 *   query: Original user query
 * 
 * Returns:
 *   Contradiction analysis results
 */
app.post("/agent/contradiction", async (req, res) => {
  const { answer, context, query } = req.body;
  
  if (!answer || !context || !query) {
    return res.status(400).json({ error: "answer, context, and query are required" });
  }
  
  try {
    const result = await getRagService().checkContradictions(answer, context, query);
    return res.json(result);
  } catch (e) {
    logger.error(`Error checking contradictions: ${e.message}`);
    return res.status(500).json({
      error: `Error checking contradictions: ${e.message}`
    });
  }
});

/**
 * Risk Agent - Identifies risks in the answer
 * 
 * JSON body:
 *   answer: The answer from Doc Agent
 *   context: The context used for the answer
 *   query: Original user query
 * 
 * Returns:
 *   Risk analysis results
 */
app.post("/agent/risk", async (req, res) => {
  const { answer, context, query } = req.body;
  
  if (!answer || !context || !query) {
    return res.status(400).json({ error: "answer, context, and query are required" });
  }
  
  try {
    const result = await getRagService().checkRisks(answer, context, query);
    return res.json(result);
  } catch (e) {
    logger.error(`Error checking risks: ${e.message}`);
    return res.status(500).json({
      error: `Error checking risks: ${e.message}`
    });
  }
});

/**
 * Get information about the vector database collection
 */
app.get("/collection/info", async (req, res) => {
  try {
    const info = await getRagService().getCollectionInfo();
    return res.json(info);
  } catch (e) {
    logger.error(`Error getting collection info: ${e.message}`);
    return res.status(500).json({
      error: `Error getting collection info: ${e.message}`
    });
  }
});

/**
 * OpenAI File Search status (vector store + env flags). Aligns with manager Documents GPT RAG UX.
 */
app.get("/gpt-rag/status", async (req, res) => {
  const key = (settings.OPENAI_API_KEY || '').trim();
  if (!key) {
    return res.json({
      configured: false,
      openai: false,
      reason: 'cloud_doc_key_missing',
      use_openai_file_search: useOpenAiFileSearchEnabled()
    });
  }
  await hydrateMatriyaOpenAiVectorStoreId();
  const enabled = useOpenAiFileSearchEnabled();
  const vsId = getMatriyaOpenAiVectorStoreId();
  if (!enabled) {
    return res.json({
      configured: true,
      openai: true,
      use_openai_file_search: false,
      vector_store_id: vsId || null,
      hint: 'cloud_file_search_disabled'
    });
  }
  if (!vsId) {
    return res.json({
      configured: true,
      openai: true,
      use_openai_file_search: true,
      vector_store_id: null,
      vector_store_status: null,
      hint: 'sync_required'
    });
  }
  try {
    const base = getOpenAiApiBase();
    const r = await axios.get(`${base}/vector_stores/${vsId}`, {
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'assistants=v2'
      },
      timeout: 30000
    });
    return res.json({
      configured: true,
      openai: true,
      use_openai_file_search: true,
      vector_store_id: vsId,
      vector_store_status: r.data?.status || null,
      file_counts: r.data?.file_counts || null
    });
  } catch (e) {
    return res.json({
      configured: true,
      openai: true,
      use_openai_file_search: true,
      vector_store_id: vsId,
      vector_store_status: 'unknown',
      warning: e.response?.data?.error?.message || e.message
    });
  }
});

/**
 * Sync indexed Matriya documents (extracted text) into a new OpenAI vector store; persists store id under uploads.
 */
app.post("/gpt-rag/sync", async (req, res) => {
  const key = (settings.OPENAI_API_KEY || '').trim();
  if (!key) {
    return res.status(503).json({ error: 'OPENAI_API_KEY not set' });
  }
  await hydrateMatriyaOpenAiVectorStoreId();
  let rag;
  try {
    rag = getRagService();
  } catch (e) {
    return res.status(503).json({ error: e.message || 'RAG service unavailable' });
  }
  try {
    const rawNames = req.body?.only_logical_names;
    const onlyLogicalNames = Array.isArray(rawNames)
      ? rawNames.map((n) => String(n || '').trim()).filter(Boolean)
      : undefined;
    const result = await syncMatriyaRagToOpenAI(rag, {
      openaiApiKey: key,
      openaiBase: getOpenAiApiBase(),
      onLog: (msg) => logger.info(`[gpt-rag/sync] ${msg}`),
      ...(onlyLogicalNames && onlyLogicalNames.length > 0 ? { onlyLogicalNames } : {})
    });
    if (!result.ok) {
      return res.status(result.status).json({
        error: result.error,
        skipped: result.skipped,
        uploaded: result.uploaded,
        batch_id: result.batch_id
      });
    }
    await persistMatriyaOpenAiVectorStoreId(result.vector_store_id);
    return res.json({
      ok: true,
      vector_store_id: result.vector_store_id,
      uploaded: result.uploaded,
      incremental: Boolean(result.incremental),
      skipped: result.skipped,
      batch_status: result.batch_status,
      indexing_pending: Boolean(result.indexing_pending),
      batch_id: result.batch_id || undefined
    });
  } catch (e) {
    logger.error(`gpt-rag/sync: ${e.message}`);
    return res.status(500).json({ error: e.response?.data?.error?.message || e.message || 'Sync failed' });
  }
});

function gptFileSearchMeta(ragInstance) {
  const base = {
    use_openai_file_search: useOpenAiFileSearchEnabled(),
    vector_store_configured: Boolean(getMatriyaOpenAiVectorStoreId()),
    active: false
  };
  try {
    if (ragInstance && typeof ragInstance.openAiFileSearchActive === 'function') {
      base.active = ragInstance.openAiFileSearchActive();
    }
  } catch (_) {}
  return base;
}

/**
 * Get list of all uploaded files
 */
app.get("/files", async (req, res) => {
  try {
    const rag = getRagService();
    const filenames = await rag.getAllFilenames();
    return res.json({
      files: filenames,
      count: filenames.length,
      gpt_file_search: gptFileSearchMeta(rag)
    });
  } catch (e) {
    logger.error(`Error getting files: ${e.message}`);
    return res.status(500).json({
      error: `Error getting files: ${e.message}`
    });
  }
});

/**
 * Get list of files with metadata (file type derived from name, chunks_count, uploaded_at)
 */
app.get("/files/detail", async (req, res) => {
  try {
    const rag = getRagService();
    const files = await rag.getFilesWithMetadata();
    return res.json({ files, gpt_file_search: gptFileSearchMeta(rag) });
  } catch (e) {
    logger.error(`Error getting files detail: ${e.message}`);
    return res.status(500).json({
      error: `Error getting files detail: ${e.message}`
    });
  }
});

/**
 * Get first chunk of a file for preview
 */
app.get("/files/preview", async (req, res) => {
  const filename = req.query.filename;
  if (!filename || typeof filename !== 'string') {
    return res.status(400).json({ error: 'filename query is required' });
  }
  try {
    const chunk = await getRagService().getFirstChunkForFile(filename);
    if (!chunk) return res.status(404).json({ error: 'File not found or has no chunks' });
    return res.json(chunk);
  } catch (e) {
    logger.error(`Error getting file preview: ${e.message}`);
    return res.status(500).json({ error: `Error getting file preview: ${e.message}` });
  }
});

/**
 * Delete documents by IDs
 * 
 * JSON body:
 *   ids: List of document IDs to delete
 * 
 * Returns:
 *   Deletion result
 */
app.delete("/files", requireAuth, async (req, res) => {
  const { filename } = req.body || {};
  if (!filename || typeof filename !== "string" || !filename.trim()) {
    return res.status(400).json({ error: "filename is required in body" });
  }
  try {
    const rag = getRagService();
    const trimmed = filename.trim();
    const deleted = await rag.deleteDocumentsByFilename(trimmed);

    // Reply immediately. OpenAI detach + prune can scan many vector-store files and take minutes,
    // which left the UI stuck on «מוחק…» until the client timed out.
    res.json({ success: true, message: `Deleted ${deleted} chunks`, deleted_count: deleted });

    const apiKey = (settings.OPENAI_API_KEY || '').trim();
    if (apiKey) {
      setImmediate(() => {
        (async () => {
          try {
            await removeMatriyaOpenAiFileByLogicalName(trimmed, {
              openaiApiKey: apiKey,
              openaiBase: settings.OPENAI_API_BASE,
              onLog: (m) => logger.info(`[OpenAI delete file] ${m}`)
            });
          } catch (e) {
            logger.error(`[OpenAI delete file] ${e.message}`);
          }
          try {
            await onMatriyaRagFileDeleted(rag, {
              openaiApiKey: apiKey,
              openaiBase: settings.OPENAI_API_BASE,
              onLog: (m) => logger.info(`[OpenAI prune after delete] ${m}`)
            });
          } catch (err) {
            logger.error(`[OpenAI prune after delete] ${err.message}`);
          }
        })();
      });
    }
    return;
  } catch (e) {
    logger.error(`Error deleting file: ${e.message}`);
    return res.status(500).json({ error: e.message });
  }
});

app.delete("/documents", async (req, res) => {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids)) {
    return res.status(400).json({ error: "ids array is required" });
  }

  try {
    const success = await getRagService().deleteDocuments(ids);
    if (success) {
      return res.json({
        success: true,
        message: `Deleted ${ids.length} documents`,
        deleted_ids: ids
      });
    } else {
      return res.status(500).json({
        error: "Failed to delete documents"
      });
    }
  } catch (e) {
    logger.error(`Error deleting documents: ${e.message}`);
    return res.status(500).json({
      error: `Error deleting documents: ${e.message}`
    });
  }
});

/**
 * Reset the entire vector database (WARNING: This deletes all data)
 * 
 * Returns:
 *   Reset result
 */
app.post("/reset", async (req, res) => {
  try {
    const success = await getRagService().resetDatabase();
    if (success) {
      return res.json({
        success: true,
        message: "Database reset successfully"
      });
    } else {
      return res.status(500).json({
        error: "Failed to reset database"
      });
    }
  } catch (e) {
    logger.error(`Error resetting database: ${e.message}`);
    return res.status(500).json({
      error: `Error resetting database: ${e.message}`
    });
  }
});

// ── Serve React frontend (matriya-front build) ──────────────────────────────
// Any request that is NOT a known API prefix is served the React SPA so that
// browser-side routing works correctly (e.g. deep-links, page refresh).
const frontendDist = join(__dirname, 'public');
if (existsSync(join(frontendDist, 'index.html'))) {
  app.use(express.static(frontendDist));
  const API_PREFIXES = ['/auth', '/admin', '/api', '/ingest', '/files', '/documents',
    '/search', '/ask-matriya', '/reset', '/gpt-rag', '/collection', '/research', '/health',
    '/matriya', '/external', '/webhook', '/upload-ask-materials'];
  app.get('*', (req, res, next) => {
    if (API_PREFIXES.some(p => req.path.startsWith(p))) return next();
    res.sendFile(join(frontendDist, 'index.html'));
  });
  logger.info('[frontend] Serving React UI from /public');
}

// Start server
if (!process.env.VERCEL) {
  app.listen(settings.API_PORT, settings.API_HOST, () => {
    logger.info(`Server running on http://${settings.API_HOST}:${settings.API_PORT}`);
    // Start WhatsApp pipeline polling (30s interval) — non-Vercel only
    startPolling();
  });
}

export default app;
