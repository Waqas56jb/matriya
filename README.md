<div align="center">

# 🧪 MATRIYA — Research-Grade RAG Platform

**An enterprise-level Retrieval-Augmented Generation (RAG) system for laboratory research, formulation science, and evidence-based decision making.**

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green?logo=node.js)](https://nodejs.org)
[![React](https://img.shields.io/badge/React-18-blue?logo=react)](https://reactjs.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-pgvector-blue?logo=postgresql)](https://supabase.com)
[![OpenAI](https://img.shields.io/badge/OpenAI-GPT--4o--mini-412991?logo=openai)](https://openai.com)
[![Supabase](https://img.shields.io/badge/Supabase-Storage%20%2B%20DB-3ECF8E?logo=supabase)](https://supabase.com)
[![Vercel](https://img.shields.io/badge/Deployed-Vercel-black?logo=vercel)](https://vercel.com)

</div>

---

## 📋 Table of Contents

- [Overview](#-overview)
- [System Architecture](#-system-architecture)
- [Repository Structure](#-repository-structure)
- [Tech Stack](#-tech-stack)
- [Services](#-services)
  - [matriya-back — Core API](#matriya-back--core-api)
  - [matriya-front — Research UI](#matriya-front--research-ui)
  - [managment-back — Project Manager API](#managment-back--project-manager-api)
  - [managment-front — Lab UI](#managment-front--lab-ui)
- [Key Features](#-key-features)
- [Research Gate (FSCTM)](#-research-gate-fsctm)
- [RAG Pipeline](#-rag-pipeline)
- [B-Integrity System](#-b-integrity-system)
- [Answer Composer](#-answer-composer)
- [Getting Started](#-getting-started)
- [Environment Variables](#-environment-variables)
- [API Reference](#-api-reference)
- [Database Schema](#-database-schema)
- [Deployment](#-deployment)
- [Troubleshooting](#-troubleshooting)
- [Contributing](#-contributing)

---

## 🔬 Overview

MATRIYA is a full-stack RAG (Retrieval-Augmented Generation) platform built for R&D laboratories that work with chemical formulations, experiment data, and regulatory documents.

The system enforces strict **scientific methodology in software** — researchers cannot skip steps in the research process, answers that have no supporting evidence are blocked at the server level, and every decision is logged to an immutable audit trail.

### What makes it different from a standard chatbot

| Standard RAG | MATRIYA |
|---|---|
| Any question gets an answer | Gate enforces research stage order (K→C→B→N→L) |
| Model can hallucinate from training data | Fail-safe blocks answers with zero evidence |
| No audit trail | Every decision logged to `decision_audit_log` |
| No data integrity monitoring | B-Integrity system detects data anomalies and locks gate |
| External data mixed freely | External data is context only, never affects conclusions |
| Temperature defaults to >0 | Temperature locked at 0 for deterministic answers |

---

## 🏗 System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        MATRIYA Platform                      │
├───────────────────────┬─────────────────────────────────────┤
│   matriya-front       │         managment-front              │
│   React 18 (CRA)      │         React 18 (Vite)              │
│   Port: 3000          │         Port: 5173                   │
└──────────┬────────────┴────────────────┬────────────────────┘
           │ HTTP + JWT                  │ HTTP + JWT
           ▼                             ▼
┌──────────────────────┐    ┌────────────────────────────────┐
│    matriya-back      │◄───┤      managment-back             │
│    Express API       │    │      Express API                │
│    Port: 8000        │    │      Port: 8001                 │
└──────────┬───────────┘    └──────────┬─────────────────────┘
           │                           │
    ┌──────┴──────┐              ┌─────┴──────────────────┐
    │  Supabase   │              │  Supabase               │
    │  PostgreSQL │              │  Storage Buckets        │
    │  + pgvector │              │  (project files)        │
    └──────┬──────┘              └─────┬──────────────────┘
           │                           │
    ┌──────┴──────┐              ┌─────┴──────────────────┐
    │  OpenAI     │              │  OpenAI                 │
    │  Responses  │              │  Per-project            │
    │  API        │              │  Vector Stores          │
    └─────────────┘              └────────────────────────┘
```

### Cross-Service Communication

- `managment-back` proxies all auth calls to `matriya-back` — one JWT works in both UIs
- `matriya-back` calls `managment-back /api/lab/query` to retrieve lab data for Answer Composer
- Both backends share the same Supabase PostgreSQL database
- Shared secret (`MATRIYA_MANAGEMENT_MATERIALS_KEY`) protects server-to-server calls

---

## 📁 Repository Structure

```
Matriya-System-Project/
│
├── matriya-back/                   # Core RAG + Research Gate API
│   ├── server.js                   # Express bootstrap, CORS, route mounting
│   ├── config.js                   # Settings class — all env vars with defaults
│   ├── database.js                 # Sequelize models (14 tables)
│   ├── authEndpoints.js            # Auth routes: signup, login, me, users
│   ├── adminEndpoints.js           # Admin routes: files, users, integrity, oracle
│   ├── ragService.js               # Ingestion pipeline + retrieval orchestration
│   ├── vectorStoreSupabase.js      # pgvector embedding + similarity search
│   ├── researchGate.js             # FSCTM gate: stage validation + enforcement
│   ├── kernelV16.js                # Kernel v1.6: breakdown/anchor/L-gate helpers
│   ├── integrityMonitor.js         # B-Integrity: snapshot recording + violation detection
│   ├── integrityRulesEngine.js     # Configurable integrity rules (growth, drop, stall)
│   ├── riskOracle.js               # Risk dashboard: read-only risk indicators
│   ├── stateMachine.js             # FSM state progression helpers
│   ├── researchLoop.js             # 4-agent deep research chain
│   ├── justificationTemplates.js   # Gate justification templates CRUD
│   ├── filLayer.js                 # FIL (Failure Indication Layer) warnings
│   ├── twilioGateway.js            # WhatsApp integration via Twilio
│   ├── logger.js                   # Logger wrapper
│   ├── auth.js                     # JWT issuance/verification + bcrypt helpers
│   ├── lib/                        # 21 focused guard and helper modules
│   │   ├── openaiFileSearchMatriya.js
│   │   ├── openaiMatriyaConfig.js
│   │   ├── matriyaOpenAiSync.js
│   │   ├── matriyaOpenAiAutoSync.js
│   │   ├── domainAndGenerationGate.js
│   │   ├── ragEvidenceFailSafe.js
│   │   ├── answerAttribution.js
│   │   ├── answerWordingGuard.js
│   │   ├── answerSourceBindingFilter.js
│   │   ├── gptRagEligible.js
│   │   ├── researchEvidenceGaps.js
│   │   ├── matriyaLabBridgeFlow.js
│   │   ├── detectStructuredFormulationChunks.js
│   │   ├── filterFileSearchSnippetsToIndex.js
│   │   ├── uploadAskMaterialsRouter.js
│   │   ├── davidAskMatriyaAcceptance.js
│   │   ├── externalLayerRouter.js
│   │   ├── externalLayerPool.js
│   │   ├── textEncoding.js
│   │   ├── excelPercentFormat.js
│   │   └── vectorMetadataFilenameFilter.js
│   ├── services/
│   │   ├── answerComposer.js       # Lab-only decision engine (VALID_CONCLUSION logic)
│   │   └── labConstraintRules.js   # Lab constraint rule evaluator
│   ├── supabase_setup_complete.sql # Full DB schema including pgvector extension
│   ├── env_example.txt             # Example environment variables
│   └── package.json
│
├── matriya-front/                  # Research UI (React 18, CRA)
│   ├── src/
│   │   ├── App.js                  # Tab routing shell + auth
│   │   ├── components/
│   │   │   ├── UploadTab.js        # File tree, ingest, GPT sync, per-file ask
│   │   │   ├── SearchTab.js        # Research gate queries, lab mode, agents mode
│   │   │   ├── AskMatriyaTab.js    # Conversational RAG chat
│   │   │   ├── AdminTab.js         # Admin panel: files, users, integrity, oracle
│   │   │   ├── InfoTab.js          # System information display
│   │   │   ├── GptSyncStatusRow.js # OpenAI sync status per file
│   │   │   ├── AnswerEvidenceSection.js  # Evidence citations
│   │   │   ├── AnswerView.js       # Answer Composer JSON renderer
│   │   │   ├── JsonViewer.js       # Generic JSON viewer
│   │   │   └── answerComposer/     # Answer Composer sub-components
│   │   └── utils/
│   │       ├── api.js              # Axios client (matriya-back)
│   │       ├── managementApi.js    # Axios client (managment-back)
│   │       ├── openAiFriendlyError.js
│   │       ├── formatBold.js
│   │       ├── askMatriyaDocumentsClient.js
│   │       └── isAnswerComposerPayload.js
│   └── package.json
│
├── managment-back/                 # Project Manager API (Node.js + Express)
│   ├── server.js                   # ~5500 line monolith: all routes + integrations
│   ├── lib/
│   │   ├── gptRagSync.js           # Sync project files → OpenAI vector stores
│   │   ├── labBridgeQueryRoute.js  # GET /api/lab/query (Answer Composer bridge)
│   │   ├── labExperimentParse.js   # Excel/CSV/TXT/JSON → Markdown table
│   │   ├── labCompositionCompare.js # A vs B composition comparison with Δ
│   │   ├── labEmailImportValidation.js
│   │   ├── labConstraintRules.js
│   │   ├── labExperimentHeatmap.js
│   │   ├── ragService.js           # Local management RAG
│   │   ├── managementRagDelete.js
│   │   ├── inboundProjectRouting.js # Email → project routing
│   │   ├── sendLabImportIncompleteEmail.js
│   │   └── gptRagQuery.js
│   └── package.json
│
├── managment-front/                # Lab UI (React 18, Vite)
│   ├── src/
│   │   ├── App.jsx                 # ~4349 line main component: all sections + routing
│   │   ├── api.js                  # Full Axios API client (~400 lines)
│   │   ├── strings.js              # Hebrew/English i18n strings
│   │   ├── LabExcelSpreadsheet.jsx # React Data Grid spreadsheet
│   │   └── *.css                   # Component styles
│   └── package.json
│
├── CLAUDE.md                       # Complete operational reference for AI agents
├── README.md                       # This file
└── .gitignore
```

---

## 🛠 Tech Stack

### Backend (Both Services)

| Technology | Purpose |
|---|---|
| **Node.js 18+** | Runtime (ESM — all `import`/`export`) |
| **Express.js** | HTTP framework |
| **PostgreSQL + Sequelize** | Relational ORM and query layer |
| **pgvector** | Vector similarity search extension |
| **Supabase** | Hosted PostgreSQL + Storage buckets |
| **OpenAI Responses API** | `file_search` RAG (primary retrieval path) |
| **Together AI / Hugging Face** | LLM fallback providers |
| **`@xenova/transformers`** | Local embeddings (all-MiniLM-L6-v2) |
| **`pdf-parse`** | PDF text extraction |
| **`mammoth`** | DOCX text extraction |
| **`xlsx`** | Excel/CSV parsing |
| **`bcrypt`** | Password hashing |
| **`jsonwebtoken`** | JWT issuance and verification |
| **`express-rate-limit`** | Rate limiting on auth, upload, and API routes |
| **`multer`** | Multipart file upload handling |
| **`zod`** | Request body schema validation |
| **Resend** | Transactional email + inbound webhook |
| **Microsoft Graph** | SharePoint integration |
| **Twilio** | WhatsApp messaging gateway |

### Frontend (Both UIs)

| Technology | Purpose |
|---|---|
| **React 18** | UI framework |
| **CRA (`react-scripts`)** | matriya-front bundler |
| **Vite** | managment-front bundler |
| **React Router v6** | Client-side routing |
| **Axios** | HTTP client with JWT interceptors |
| **Supabase JS v2** | Direct bucket uploads |
| **React Data Grid** | Lab experiment spreadsheet |
| **React Markdown + remark-gfm** | Markdown rendering with table support |
| **React Toastify** | Toast notifications |
| **React Icons** | Icon library |

---

## ⚙️ Services

### matriya-back — Core API

The heart of the platform. Handles document ingestion, vector storage, research gate enforcement, and all AI-powered Q&A.

**Default port:** `8000`

**Responsibilities:**
- Accept document uploads (PDF, DOCX, TXT, XLSX, images)
- Extract text, chunk, embed, and store in pgvector
- Sync documents to OpenAI vector store
- Enforce FSCTM research gate (K→C→B→N→L)
- Monitor B-Integrity on each research cycle
- Answer questions using only uploaded document content
- Provide admin panel APIs for file management and user permissions

---

### matriya-front — Research UI

The researcher's day-to-day interface. Designed around scientific methodology.

**Default port:** `3000`

**Five tabs:**

| Tab | Description |
|---|---|
| 📤 **Upload** | Virtual folder tree, ingest documents, trigger GPT sync, ask per-file questions |
| 🔍 **Search** | Research gate queries across three modes: Research (K/C/B/N/L stages), Lab (Answer Composer), Agents (4-agent deep research) |
| 💬 **Ask Matriya** | Conversational RAG chat against the document library |
| 🛡 **Admin** | File and user management, B-Integrity violations, Risk Oracle dashboard |
| ℹ️ **Info** | System stats: collection size, chunk count, vector store ID |

---

### managment-back — Project Manager API

Full project lifecycle management with integrated GPT RAG per project.

**Default port:** `8001`

**Responsibilities:**
- Project, member, task, and milestone management
- Per-project file storage in Supabase buckets
- Per-project OpenAI vector store sync (GPT RAG)
- Lab experiment tracking and analysis
- Materials library (linked to experiments)
- Email inbox via Resend inbound webhook (auto-imports lab attachments)
- SharePoint file import via Microsoft Graph
- Auth proxy to matriya-back (shared JWT)
- Lab Bridge: serves Answer Composer data to matriya-back

---

### managment-front — Lab UI

The project team's interface. Organized around projects and experiments.

**Default port:** `5173`

**Sections (per project):**

| Section | Description |
|---|---|
| 🧪 **Experiments** | React Data Grid spreadsheet, upload/parse experiment files, GPT analysis |
| 🧱 **Materials** | Materials library CRUD, properties, linked to experiments |
| 📁 **Documents** | File management, GPT RAG sync, project-scoped Q&A |
| ✉️ **Emails** | Project inbox and compose via Resend |
| ⚙️ **Settings** | Project metadata and member management |

---

## 🌟 Key Features

### 1. Grounded RAG — Zero Hallucination Policy
Every answer is built exclusively from uploaded document content. The system cannot and will not make up facts, fill gaps, or infer beyond what the retrieved text actually states.

### 2. Research Gate (FSCTM)
A deterministic Finite-State Concurrent Transition Machine enforces the research methodology. Five stages in strict order — no skipping allowed.

### 3. B-Integrity Monitoring
Automatic anomaly detection on research data. If document counts grow unexpectedly, stall, or drop without a structural reason, the gate is locked and an admin must explicitly resolve the violation.

### 4. Answer Composer
Lab-only decision engine that produces a structured verdict (`VALID_CONCLUSION` / `INCONCLUSIVE` / `STOP`) based purely on experiment data delta. External context is read-only and appended after the decision — it cannot influence the outcome.

### 5. Full Audit Trail
Every research decision is stored in `decision_audit_log` with: decision type, input snapshot, confidence score, basis count, model version hash, and complexity context. Supports replay and review.

### 6. Deterministic Temperature
LLM temperature defaults to `0` (`MATRIYA_LLM_TEMPERATURE`). All answers are reproducible for the same inputs.

### 7. WhatsApp Integration
Researchers can submit tasks and receive pipeline results via WhatsApp through Twilio integration.

---

## 🔒 Research Gate (FSCTM)

The Research Gate is the core scientific methodology enforcer in `researchGate.js`.

### Stage Order

```
K → C → B → N → L
```

| Stage | Name | Rule |
|---|---|---|
| **K** | Known | Existing information only — no solutions proposed |
| **C** | Confirmed | Verified/confirmed information only |
| **B** | Breakdown | Hard stop — triggers Kernel v1.6 breakdown detection |
| **N** | Next | Allowed only after B is completed |
| **L** | Synthesis | Final synthesis — L-gate validation runs |

### How the gate works

1. Client creates a session: `POST /research/session` → receives `session_id`
2. Every query includes `session_id` + `stage`
3. Gate checks:
   - Is the session valid?
   - Does an active B-Integrity violation exist? → **Hard stop if yes**
   - Is this stage the correct next one? → **Rejects out-of-order requests**
4. On pass: logs to `research_audit_log`, advances `completed_stages` in DB
5. Response includes `responseType`: `hard_stop` | `info_only` | `full_answer`

### Kernel v1.6 Signals (optional advanced inputs)

```json
{
  "kernel_signals": {
    "sufficient_data": true,
    "residual_non_random": false,
    "model_fits": { "linear": { "ok": true }, "polynomial": { "ok": false } }
  },
  "data_anchors": {
    "experiment_snapshot": { "run_id": "BASE-003" }
  },
  "methodology_flags": {
    "repeated_solution": false,
    "cost_rising_no_progress": false
  }
}
```

---

## 🔄 RAG Pipeline

### Ingestion Flow

```
User uploads file
  ↓
Multer saves to UPLOAD_DIR (/tmp on Vercel, ./uploads locally)
  ↓
Text extraction:
  PDF    → pdf-parse
  DOCX   → mammoth
  XLSX   → xlsx library
  Images → base64
  ↓
Chunking: 500 tokens, 100 token overlap
  ↓
Embedding: @xenova/transformers (all-MiniLM-L6-v2)
  ↓
Storage: rag_documents table (pgvector in Supabase)
  ↓
Auto-sync to OpenAI vector store (debounced)
```

### Retrieval Flow

```
User submits query
  ↓
FSCTM Gate check (session + stage)
  ↓
B-Integrity check (no active violation)
  ↓
Query embedding generated
  ↓
pgvector similarity search → top-k chunks
  ↓
Domain filter: drop chunks with <2 query-token overlaps
  ↓
OpenAI file_search (if configured) → merge with vector results
  ↓
Generation gate: min chunk count + min similarity sum
  ↓
LLM call with retrieved context (temperature = 0)
  ↓
Post-generation filters:
  - Wording guard (strip forbidden phrases)
  - Source binding filter (remove unmatched citations)
  ↓
Response: answer + citations
```

### Fail-Safe Guarantee

If no supporting evidence is found, the system returns **only** this message:

> `אין במערכת מידע תומך לשאלה זו.`
> *(There is no supporting information in the system for this question.)*

No advice, no suggestions, no "however" alternatives. This is enforced in `lib/ragEvidenceFailSafe.js`.

---

## 🛡 B-Integrity System

B-Integrity monitors the health of research data across cycles and automatically locks the gate when anomalies are detected.

### Rules Engine (`integrityRulesEngine.js`)

| Rule | Condition | Default Threshold |
|---|---|---|
| `growth_above_ratio` | Document count grew too fast | 50% per cycle |
| `decrease_without_structural_change` | Count dropped with no declared structural change | Any drop |
| `no_progress_cycles` | Count unchanged for N consecutive cycles | 3 cycles |
| `metric_above` | Count exceeds hard cap | Disabled (0) |
| `drop_percent_above` | Percentage drop exceeds threshold | 100% |

### Violation Lifecycle

```
Research cycle runs
  ↓
IntegrityCycleSnapshot saved (metric_value = document count)
  ↓
Rules engine evaluates last N snapshots
  ↓
Rule triggered → Violation record created (resolved_at = NULL)
  ↓
Gate LOCKED for this session
  ↓
Admin reviews and resolves: POST /admin/integrity/recovery
  ↓
resolved_at set → Gate UNLOCKED
```

### Risk Oracle (`riskOracle.js`)

Read-only risk assessment visible in AdminTab:

| Risk | Severity |
|---|---|
| Active unresolved violations | High |
| Document growth ≥ 60% of threshold | Medium / High |
| 2+ violations in last 7 days | Medium |
| No progress for N cycles | Low |

---

## 📊 Answer Composer

The Answer Composer (`services/answerComposer.js`) is the lab-only decision engine.

### Decision Contract

```
Input: labResult (from managment-back /api/lab/query)
  ↓
buildDecisionStatus(labResult) → decision_status
  ↓
Decision must come from lab data only — NEVER from external context
  ↓
buildActionRequired(decision_status, data_grade) → GO / ITERATE / STOP
  ↓
external_context appended (read-only, never modifies decision)
```

### Decision Matrix

| `decision_status` | `data_grade` | `action_required` |
|---|---|---|
| `VALID_CONCLUSION` | `REAL` | **GO** |
| `INCONCLUSIVE` | Any | **ITERATE** |
| `NO_CHANGE` | Any | **ITERATE** |
| `INSUFFICIENT_DATA` | Any | **STOP** |
| `INVALID_EXPERIMENT` | Any | **STOP** |
| `STRUCTURAL_INCOMPLETE` | Any | **STOP** |
| Any | `HISTORICAL_REFERENCE` | **STOP** |
| Any | `NO_DATA` | **STOP** |

### Efficacy Rule

```javascript
// Single source of truth — no exceptions
decideEfficacyFromDelta(maxDeltaPct, thresholdPct)
  // maxDeltaPct >= thresholdPct → VALID_CONCLUSION
  // maxDeltaPct <  thresholdPct → INCONCLUSIVE
```

---

## 🚀 Getting Started

### Prerequisites

- Node.js 18 or higher
- npm 8+
- A Supabase project (free tier works)
- OpenAI API key (for GPT RAG)
- Git

### Installation

**1. Clone the repository**

```bash
git clone https://github.com/shoshan19-prog/Matriya-System-Project.git
cd Matriya-System-Project
```

**2. Install dependencies for all services**

```bash
cd matriya-back && npm install && cd ..
cd managment-back && npm install && cd ..
cd matriya-front && npm install && cd ..
cd managment-front && npm install && cd ..
```

**3. Create environment files**

Copy the templates from the [Environment Variables](#-environment-variables) section and create `.env` files in each service directory.

**4. Set up Supabase database**

Run the SQL schema file in your Supabase SQL editor:

```bash
# Open matriya-back/supabase_setup_complete.sql
# Copy contents and run in Supabase Dashboard → SQL Editor
```

**5. Start services (recommended order)**

Open 4 terminal windows:

```bash
# Terminal 1 — Core API
cd matriya-back
npm run dev

# Terminal 2 — Management API
cd managment-back
npm run dev

# Terminal 3 — Research UI
cd matriya-front
npm start

# Terminal 4 — Lab UI
cd managment-front
npm run dev
```

**6. Verify everything is running**

```bash
curl http://localhost:8000/health    # Should return OK
curl http://localhost:8001/health    # Should return OK
# Open http://localhost:3000         # Research UI
# Open http://localhost:5173         # Lab UI
```

### First-time setup checklist

- [ ] Create admin user via `POST /auth/signup` with `is_admin: true` in DB, or set `username = "admin"`
- [ ] Upload at least one test document in UploadTab
- [ ] Trigger GPT sync (requires `OPENAI_API_KEY`)
- [ ] Create a test research session and run a K-stage query
- [ ] Verify admin panel is accessible

---

## 🔐 Environment Variables

### `matriya-back/.env`

```env
# ── Server ──────────────────────────────────────────────────
API_PORT=8000
API_HOST=0.0.0.0
NODE_ENV=development
EXPRESS_BODY_LIMIT=15mb

# ── Security ────────────────────────────────────────────────
JWT_SECRET=replace_with_strong_32plus_char_secret

# ── Database (one required) ─────────────────────────────────
POSTGRES_URL=postgresql://postgres.PROJECT:PASSWORD@aws-0-REGION.pooler.supabase.com:6543/postgres
SUPABASE_DB_URL=postgresql://postgres:PASSWORD@db.PROJECT.supabase.co:5432/postgres

# ── Supabase (optional — for bucket operations) ─────────────
SUPABASE_URL=https://PROJECT.supabase.co
SUPABASE_KEY=your_supabase_service_role_key

# ── OpenAI — required for GPT RAG ───────────────────────────
OPENAI_API_KEY=sk-...
OPENAI_API_BASE=https://api.openai.com/v1
OPENAI_RAG_MODEL=gpt-4o-mini

# ── LLM Fallback (pick one if not using OpenAI for LLM) ─────
LLM_PROVIDER=together
TOGETHER_API_KEY=...
TOGETHER_MODEL=mistralai/Mistral-7B-Instruct-v0.2

# ── Embedding ───────────────────────────────────────────────
EMBEDDING_MODEL=sentence-transformers/all-MiniLM-L6-v2
COLLECTION_NAME=rag_documents

# ── Document Processing ─────────────────────────────────────
MAX_FILE_SIZE=52428800
CHUNK_SIZE=500
CHUNK_OVERLAP=100

# ── Integration with managment-back ─────────────────────────
MANAGEMENT_BACK_URL=http://localhost:8001
MATRIYA_MANAGEMENT_API_URL=http://localhost:8001
MATRIYA_MANAGEMENT_MATERIALS_KEY=shared_secret_key

# ── Deterministic Tuning (optional) ─────────────────────────
MATRIYA_LLM_TEMPERATURE=0
MATRIYA_DOMAIN_MIN_QUERY_OVERLAP=2
B_INTEGRITY_MAX_GROWTH_RATIO=0.5
B_INTEGRITY_NO_PROGRESS_CYCLES=3

# ── WhatsApp / Twilio (optional) ────────────────────────────
TWILIO_AUTH_TOKEN=...
TWILIO_ACCOUNT_SID=AC...
TWILIO_WHATSAPP_FROM=whatsapp:+1234567890
TWILIO_WEBHOOK_PUBLIC_URL=https://your-api.vercel.app/api/whatsapp/inbound
DAVID_WHATSAPP=whatsapp:+1234567890
```

### `managment-back/.env`

```env
# ── Server ──────────────────────────────────────────────────
PORT=8001
NODE_ENV=development
PUBLIC_API_BASE_URL=http://localhost:8001

# ── Supabase — required ──────────────────────────────────────
NEXT_PUBLIC_SUPABASE_URL=https://PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# ── Database (for lab bridge) ────────────────────────────────
POSTGRES_URL=postgresql://postgres.PROJECT:PASSWORD@aws-0-REGION.pooler.supabase.com:6543/postgres

# ── Auth proxy (point to matriya-back) ──────────────────────
MATRIYA_BACK_URL=http://localhost:8000
MANEGER_MATERIALS_SUMMARY_SERVER_KEY=shared_secret_key

# ── OpenAI — required for project GPT RAG ───────────────────
OPENAI_API_KEY=sk-...
OPENAI_RAG_MODEL=gpt-4o-mini

# ── Email (optional) ─────────────────────────────────────────
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=noreply@yourdomain.com
RESEND_REPLY_DOMAIN=yourdomain.com
RESEND_INBOUND_WEBHOOK_SECRET=webhook_secret

# ── SharePoint (optional) ────────────────────────────────────
SHAREPOINT_TENANT_ID=...
SHAREPOINT_CLIENT_ID=...
SHAREPOINT_CLIENT_SECRET=...

# ── CORS ─────────────────────────────────────────────────────
CORS_ORIGINS=http://localhost:5173,https://your-front.vercel.app
```

### `matriya-front/.env`

```env
REACT_APP_API_BASE_URL=http://localhost:8000
REACT_APP_MANAGEMENT_API_URL=http://localhost:8001
REACT_APP_MANAGEMENT_FRONT_URL=http://localhost:5173
```

### `managment-front/.env`

```env
VITE_MANEGER_API_URL=http://localhost:8001
VITE_SUPABASE_URL=https://PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

---

## 📡 API Reference

### MATRIYA API (Port 8000)

#### Authentication

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/auth/signup` | Public | Create new account |
| `POST` | `/auth/login` | Public | Login, receive JWT |
| `GET` | `/auth/me` | Bearer | Get current user |
| `GET` | `/auth/users` | Bearer | List all active users |

#### Documents & RAG

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/ingest` | Bearer | Upload and ingest document |
| `GET` | `/files` | Bearer | List all filenames |
| `GET` | `/files/detail` | Bearer | List files with metadata |
| `DELETE` | `/files/:filename` | Bearer | Delete file |
| `GET` | `/documents` | Bearer | List document chunks |
| `POST` | `/reset` | Admin | Delete all documents |
| `POST` | `/gpt-rag/sync` | Bearer | Sync files to OpenAI vector store |
| `GET` | `/gpt-rag/status` | Bearer | OpenAI sync status |
| `GET` | `/collection/info` | Bearer | Vector collection stats |

#### Research & AI

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/research/session` | Bearer | Create research session |
| `GET` | `/research/session/:id` | Bearer | Get session state |
| `POST` | `/api/research/search` | Bearer | Gate-enforced research query |
| `POST` | `/api/research/run` | Bearer | 4-agent deep research chain |
| `POST` | `/search` | Bearer | Vector + RAG search |
| `POST` | `/ask-matriya` | Bearer | Conversational RAG |

#### Admin

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/admin/files` | Admin | List all files |
| `DELETE` | `/admin/files/:filename` | Admin | Delete file (admin) |
| `GET` | `/admin/users` | Admin | List all users |
| `POST` | `/admin/users/:id/permissions` | Admin | Set file permissions |
| `GET` | `/admin/history` | Admin | Search history log |
| `POST` | `/admin/integrity/recovery` | Admin | Resolve B-Integrity violation |
| `GET` | `/admin/risk-oracle` | Admin | Risk indicator dashboard |
| `GET` | `/admin/fil-warnings` | Admin | FIL layer warnings |

#### Audit

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/audit/decisions` | Bearer | Decision audit log |
| `GET` | `/api/observability/gate` | Bearer | Gate observability info |

---

### Management API (Port 8001)

#### Projects

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/projects` | Bearer | List projects |
| `POST` | `/api/projects` | Bearer | Create project |
| `GET` | `/api/projects/:id` | Bearer | Get project details |
| `PUT` | `/api/projects/:id` | Bearer | Update project |
| `DELETE` | `/api/projects/:id` | Bearer | Delete project |
| `POST` | `/api/projects/:id/members` | Bearer | Add member |
| `DELETE` | `/api/projects/:id/members/:uid` | Bearer | Remove member |

#### Lab

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/projects/:id/lab` | Bearer | List experiment runs |
| `POST` | `/api/projects/:id/lab` | Bearer | Create experiment run |
| `PUT` | `/api/projects/:id/lab/:runId` | Bearer | Update run |
| `DELETE` | `/api/projects/:id/lab/:runId` | Bearer | Delete run |
| `POST` | `/api/lab/parse-experiment-file` | Bearer | Parse experiment file → Markdown |
| `GET` | `/api/lab/query` | Key or Bearer | Lab bridge query for Answer Composer |
| `POST` | `/api/projects/:id/lab/:runId/analyze` | Bearer | GPT analysis of experiment |

#### Files & GPT RAG

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/projects/:id/files` | Bearer | List project files |
| `POST` | `/api/projects/:id/files` | Bearer | Upload file to Supabase bucket |
| `DELETE` | `/api/projects/:id/files/:fileId` | Bearer | Delete file |
| `POST` | `/api/projects/:id/gpt-rag/sync` | Bearer | Sync project to OpenAI vector store |
| `POST` | `/api/projects/:id/gpt-rag/query` | Bearer | Query project GPT RAG |

#### Email & Communication

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/projects/:id/emails` | Bearer | List emails |
| `POST` | `/api/projects/:id/emails` | Bearer | Send email via Resend |
| `POST` | `/api/webhooks/resend-inbound` | Webhook | Inbound email handler |
| `GET` | `/api/projects/:id/chat` | Bearer | Get chat messages |
| `POST` | `/api/projects/:id/chat` | Bearer | Post chat message |

---

## 🗄 Database Schema

### Core Tables (Supabase PostgreSQL)

```sql
-- Auth
users                   -- id, username, email, hashed_password, is_admin, is_active
file_permissions        -- user_id, filename (access control)
search_history          -- user_id, username, question, answer

-- Research Gate
research_sessions       -- id (UUID), user_id, completed_stages[], kernel_context
research_audit_log      -- session_id, stage, response_type, request_query
policy_audit_log        -- session_id, stage
decision_audit_log      -- session_id, stage, decision, inputs_snapshot, confidence_score,
                        --   basis_count, model_version_hash, complexity_context

-- B-Integrity
integrity_cycle_snapshots  -- session_id, stage, cycle_index, metric_name, metric_value
integrity_violations       -- session_id, type, reason, resolved_at
noise_events               -- session_id, decision_id, kernel_version_at_classification

-- System
system_snapshots        -- periodic system-level metrics
research_loop_runs      -- 4-agent loop run records
justification_templates -- gate justification templates
doe_designs             -- Design of Experiment records

-- RAG (pgvector extension)
rag_documents           -- id, content, embedding vector(384), metadata (JSONB)
```

---

## 🌐 Deployment

### Vercel (Recommended)

Both backends are designed for Vercel serverless deployment.

**matriya-back — deploy to Vercel:**

1. Connect GitHub repo to Vercel
2. Set root directory: `matriya-back`
3. Build command: *(leave empty — Node.js serverless)*
4. Add all environment variables from the template above
5. Set `UPLOAD_DIR` to `/tmp/matriya-uploads` (Vercel filesystem is read-only except `/tmp`)

**managment-back — deploy to Vercel:**

1. Connect GitHub repo, root directory: `managment-back`
2. Add environment variables
3. Set `MATRIYA_BACK_URL` to the deployed matriya-back URL

**matriya-front — deploy to Vercel:**

1. Root directory: `matriya-front`
2. Build command: `npm run build`
3. Output directory: `build`
4. Set `REACT_APP_API_BASE_URL` to deployed matriya-back URL

**managment-front — deploy to Vercel:**

1. Root directory: `managment-front`
2. Build command: `npm run build`
3. Output directory: `dist`
4. Set `VITE_MANEGER_API_URL` to deployed managment-back URL

### Important Vercel Notes

- `UPLOAD_DIR` **must** start with `/tmp` — project directory is read-only on Vercel
- Use Supabase **pooler** connection string (`pooler.supabase.com:6543`) — not direct `db.PROJECT.supabase.co`
- Set Sequelize pool `max: 1` — already handled automatically by `database.js`
- Supabase PgBouncer: `prepare: false` in dialect options — already set, do not remove
- Body limit above 4.5MB requires Vercel Pro — use direct-to-Supabase-bucket upload for large files

---

## 🔧 Troubleshooting

### CORS errors

```bash
# Add origin to managment-back env:
CORS_ORIGINS=http://localhost:5173,https://your-app.vercel.app

# For all Vercel previews:
CORS_ALLOW_VERCEL_PREVIEWS=true
```

### 401 Auth loop / redirect

1. Confirm `MATRIYA_BACK_URL` in managment-back points to live matriya-back
2. Test token directly: `curl -H "Authorization: Bearer TOKEN" https://your-api/auth/me`
3. Check localStorage key: `matriya_token` (matriya-front) vs `maneger_token` (managment-front)

### Upload 413 / Payload Too Large

1. Raise `EXPRESS_BODY_LIMIT=20mb` in matriya-back
2. On Vercel — use direct-to-Supabase-bucket upload (bypasses API)
3. Check `UPLOAD_RATE_LIMIT_MAX` — reduce batch size if rate limited

### GPT RAG returns "אין במערכת מידע"

1. Verify `OPENAI_API_KEY` is valid
2. Check if vector store was created: `GET /gpt-rag/status`
3. Re-run sync: `POST /gpt-rag/sync`
4. Confirm files are eligible: `.pdf`, `.docx`, `.txt`, `.xlsx`, etc.
5. Check OpenAI dashboard for vector store file count

### Research gate locked

```bash
# View active violations in AdminTab → Integrity section
# Or resolve via API:
curl -X POST https://your-api/admin/integrity/recovery \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -d '{"violation_id": 123}'
```

### Database ENOTFOUND / connection fails

- Use pooler URL: `pooler.supabase.com:6543` not `db.PROJECT.supabase.co:5432`
- Direct URL can fail if Supabase project is paused or DNS is slow
- Set `POSTGRES_URL` (pooler) in production; keep `SUPABASE_DB_URL` (direct) only locally

### Lab bridge 503

1. Confirm `POSTGRES_URL` is set in managment-back
2. URL must start with `postgresql://` or `postgres://` — NOT `neon://`
3. Do not paste `POSTGRES_URL=postgresql://...` as the value — paste only the URI part

---

## 🤝 Contributing

### Safety Rules (mandatory)

1. **Never skip or bypass the research gate stages** — gate logic in `researchGate.js` must not be weakened
2. **Never modify `decision_status` using external context** — `external_context` is read-only decoration
3. **Never remove the RAG fail-safe** — `ragEvidenceFailSafe.js` is a hard requirement, not optional
4. **Always run a build check before PR**: `npm run build` in both frontend directories
5. **Environment variables must never be hardcoded** — use env config in `config.js`

### Workflow

```bash
# 1. Create a feature branch
git checkout -b feature/your-feature-name

# 2. Make changes

# 3. Build check
cd matriya-front && npm run build
cd ../managment-front && npm run build

# 4. Commit with a clear message
git commit -m "feat: description of what you added"

# 5. Push
git push origin feature/your-feature-name

# 6. Open a pull request
```

### Naming conventions

- **`managment-*`** — directory names (keep the typo — it's legacy)
- **`MANEGER_*`** — some env keys (keep as-is)
- **`MANAGEMENT_*`** — other env keys (keep as-is)
- Do not silently rename either pattern — requires a full migration

---

## 📄 License

This project is proprietary software. All rights reserved.

---

<div align="center">

**Built with precision for R&D laboratories**

*MATRIYA — where scientific methodology is enforced in code*

</div>
