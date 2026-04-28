# Formal Proposal — v1.1 Project Initialization Contract (Phase 2)

**To:** David  
**From:** Waqas  
**Date:** 2026-05-XX (replace date when issuing)  
**Status:** Proposal — **no development, deploy, migrations, env changes, or merges until written approval.**

---

## 1. Evidence-based baseline (honest codebase audit)

These statements are grounded in **`managment-back/server.js`**, **`managment-back/lib/proposalEngine.js`**, **`managment-front/src/components/ProposalScreen.jsx`**, and **`managment-front/src/api.js`**.

| David’s requirement | Current code reality |
|--------------------|----------------------|
| User creates project | **Implemented:** `POST /api/projects` → `projects` + `project_members`. |
| User uploads documents | **Implemented:** `POST /api/projects/:projectId/files` → **`project_files` + Supabase Storage** immediately on successful upload. |
| MATRIYA generates structured proposal | **Implemented:** `POST /api/proposals/generate` → `buildProposal()` in **`proposalEngine.js`**. JSON payload includes **normalized blocks**, not arbitrary “5” marketing blocks — logically: **`project_type` / goal**, **`materials`**, **`metrics`**, **`experiments`**, **`milestones`**, plus **`scan_status`**, **`proposal_state`** (see engine output shape). |
| User reviews/edits | **Implemented:** **`ProposalScreen.jsx`**, routed at **`/project/:id/section/proposal`**; **`PATCH /api/proposals/:proposal_id`**, **`POST …/resolve_conflict`**. |
| Only after Approve → data enters operational tables | **Partially aligned:** **Approve** — **`POST /api/proposals/:proposal_id/approve`** runs **`BEGIN`** / **`COMMIT`** and writes **`projects`**, **`material_library`**, **`proposal_metrics`**, **`experiments`**, **`milestones`**, **`source_documents`**. Upload metadata still exists in **`project_files`** *before* approve (storage path) — **that is unavoidable for generate** unless product is changed to stage bytes outside DB (different contract). |

**Important honesty:** Phase 2 v1.1 “from zero” greenfield builds **fewer backend net-new LOC** than a reader might assume — the contract should focus on **production readiness**, **schema completeness**, **acceptance alignment**, **bug fixes**, and **proof/documentation**, not implying the entire subsystem is missing.

---

## 2. Proposed scope (v1.1) — exactly what work is included

1. **DB schema parity** against approve-handler expectations: **`proposals`**, **`approved_at`**/data updates, **`projects.project_type` / goal columns** as used in SQL in approve, **`material_library`**, **`proposal_metrics`**, **`experiments`**, **`milestones`**, **`source_documents`**. Produce **one migration pack** suitable for Supabase as needed ( **`IF NOT EXISTS` / additive** ).
2. **Verify** **`POSTGRES_URL` / `DATABASE_URL`** on **`managment-back`** Railway so atomic approve succeeds (approve uses raw **`pg`**).
3. **Harden**: validation errors, empty states, `INSUFFICIENT` / `READY` transitions, rollback paths **documented**.
4. **UI**: align **`ProposalScreen`** with finalized acceptance checklist (buttons, blocked approve, conflict UX) — only what FAILs acceptance today.
5. **Acceptance test pack**: scripted steps + **live UI screenshots** + **SQL proof** (row counts / key **`SELECT`**s agreed with you).

---

## 3. Likely files / modules touched

| Area | Paths |
|------|--------|
| API + transaction | `managment-back/server.js` (proposal routes §~6464–6800), `proposalEngine.js` |
| UI | `managment-front/src/components/ProposalScreen.jsx`, **`ProposalScreen.css`**, **`App.jsx`** routing |
| Client API | `managment-front/src/api.js` (`proposals` group) |
| SQL | **`managment-back/migrations/`** or **`managment-back/sql/`** — new numbered migration |

**Out of explicit scope:** Matriya **`matriya-back`** RAG index rules (unless blocker for proposal generation content).

---

## 4. Database tables / migrations

**Reads/writes touched by approve logic (must exist and match columns):**

- `projects` (updates: `project_type`, `goal_*` per handler)
- `proposals`
- `material_library`
- `proposal_metrics`
- `experiments`
- `milestones`
- `source_documents`

**Staging:** proposal JSON lives in **`proposals.data`** until approve → operational inserts.

Exact DDL delivered as **`*.sql`** in repo + instructions to run on Supabase (no prod execution until you authorize).

---

## 5. Acceptance tests (PASS = all pass — you define final wording)

Suggested minimum:

1. Create project → upload ≥1 supported file → **Generate proposal** → **non-error JSON** → persisted row in **`proposals`**.
2. Edit one block → **PATCH** persists.
3. If conflicts exist → resolve → **`proposal_state`** allows approve when **`READY`** (per **`validateApproveConditions`** — exact rule in code).
4. **Approve** → **HTTP success** → single transaction proof: **`experiments`** / **`milestones`** rows created as expected → **`proposals`** row shows **`approved_at`** / **`APPROVED`** state (per implementation).
5. **Failure rollback:** induce controlled failure → **no partial commit**.

**Screenshots:** each step documented (browser timestamps optional).  
**DB proof:** agreed queries (redacted screenshots or CSV export).

---

## 6. Pricing & schedule — v1.1 only

| Field | Proposal |
|--------|----------|
| **Price (USD)** | **$1,250** |
| **Calendar days** | **5 days** (~**15 productive hours**/day assumed on your side for delivery throughput) |
| **Payment trigger** | Per your mandate: **v1.1 PASS** + screenshots + DB verification **+ explicit written approval**.

**Note:** Combined Phase 2 budget you indicated (**$2,000 / 7 days**) — v1.1 takes **majority effort** due to transactional + UI + QA surface.

---

## 7. What is NOT included (v1.1)

- **v1.2 Data Governance Patch** — **separate contract**; starts only after paid v1.1 PASS.
- **Performance tuning / unrelated refactors.**
- **Changes to Railway/Vercel env** except those **strictly necessary** for approve (you approve names only).
- **Matriya **`matriya-back`** unrelated features.**
- **Email ingestion / SharePoint** changes.

---

## 8. Prerequisites from you before start (after approval)

- Written **“GO v1.1”** reply.
- **Confirmation** **`proposals`** + dependent tables exist on prod or permission to apply migration in agreed window.

---

_Document aligns with codebase as of Phase 2 planning; no guesses on production DB drift — migration step closes that gap._
