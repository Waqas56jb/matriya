# Formal Proposal — v1.2 Data Governance Patch (Phase 2)

**To:** David  
**From:** Waqas  
**Date:** 2026-05-XX  
**Status:** Proposal — **starts only after v1.1 PASS + payment + written approval.**

**Mandatory sequence:** **v1.1 PASS → approval/payment → v1.2 START.**  
Do not bundle with v1.1 pricing.

---

## 1. Evidence-based baseline (honest codebase audit)

| Feature | Today (repo fact) |
|--------|---------------------|
| **External source registry** (management DB) | Table **`external_sources`** exists in **`managment-back/supabase_schema.sql`** (`trust_grade` **IN ('C','D')** only). **`runs`** can reference **`external_source_id`** — **experiment/run level**, not per **file**. |
| **Project files** (`project_files`) | **No** `internal`/`external` / `classification` column in **`supabase_schema.sql`** snapshot reviewed. Classification at **upload** — **greenfield.** |
| **Matriya Decision Engine lab path** | **`matriya-back/services/answerComposer.js`**, **`lib/matriyaLabBridgeFlow.js`**, **`managment-back/lib/labBridgeQueryRoute.js`** — **no document-class gate** wired today beyond existing evidence rules. |
| **GPT RAG for projects** | **`gptRagQuery.js` / sync** indexes project files → **classification needed** before “external → reference only” is enforceable everywhere. |

**Honesty:** **v1.2 is materially new governance surface area** versus v1.1 (much of which already ships in code paths above).

---

## 2. Proposed scope — exact

1. **`project_files`** (or sibling table): **`governance_scope`**/`classification`: **`INTERNAL` | `EXTERNAL`** (names TBD stable in API contract).
2. **Manual upload UI only** — classify at upload/edit before sync to OpenAI (**no auto-ingest bypass** unless already product-approved).
3. **Validation pipeline** pre-persist OR pre-sync: MIME, size caps, forbidden paths — **minimal** set agreed in writing.
4. **Decision Engine / RAG routing:** INTERNAL → **`file_search`/vector**/lab inputs as today; EXTERNAL → **`reference`** only (UI + **`meta`** payload + **`answerComposer`/`gptRagQuery`** rejects or stubs **decisions** grounded on EXTERNAL — exact rule per your **`PASS`** table).
5. **Migrations**: additive DDL + rollback notes.
6. **Acceptance tests** + screenshots + DB proof analogous to v1.1 style.

---

## 3. Likely files / modules affected

| Area | Paths |
|------|--------|
| Management upload + classify | **`managment-back/server.js`** (`createProjectFileFromBuffer`, `POST …/files`), optional **`gptRagSync.js`**| 
| Frontend | **`App.jsx`** (Documents section — file list UI), **`api.js`**, CSS |
| Decision / Matriya back | **`matriya-back`** RAG wrappers, **`answerComposer.js`** (decision sourcing), **`ragService.js`** if management passes metadata |
| Migration | **`managment-back/migrations/…sql`**, docs |

Exact file list freezes at kickoff against **`git`** diff boundary.

---

## 4. DB tables / migrations

| Artifact | Purpose |
|---------|---------|
| **`project_files`** | **ALTER** add classification + optional **`validated_at`**, **`governance_notes`**. |
| **Audit** | Optionally append **`audit_log`** entries with classification sets. |

**Separate** from **`external_sources`** (unless you authorize merge of concepts).

---

## 5. Acceptance tests (PASS = all — finalize with you)

1. INTERNAL file → Decision Engine lab/GPT paths **usable** **as PASS criteria for “allowed.”**
2. EXTERNAL file → explicitly **blocked** from **decisions** (**HTTP/log payload proves** **`governance_blocked`** branch).
3. Manual upload classification **cannot be skipped** in UI (**forced choice** or sane default documented).
4. DB row shows **`EXTERNAL`** for negative test uploads.

Screenshots + **`SELECT`** proof on **`project_files`**.

---

## 6. Pricing & schedule — v1.2 only

| Field | Proposal |
|--------|----------|
| **Price (USD)** | **$750** |
| **Calendar days** | **2 days** (**contiguous after v1.1 close**) |
| **Payment trigger** | After **v1.1 PASS** + your **payment/instruction**.

**Combined Phase 2 umbrella:** **$2,000** total if **both phases** accepted as priced (**$1,250 + $750**) — aligns with stated **budget** (**7 calendar days total** spaced **5 + 2** unless you reorder).

---

## 7. What is NOT included (v1.2)

- Anything under **v1.1** contract.
- **SharePoint/import** rewires unless contracted separately.
- **Matriya corpus** (**`rag_documents`**) global reset.
- OpenAI quota **costs** … (usage remains your Org billing.)
- **`external_ctx.*`** Postgres layer extensions beyond agreed patch.

---

## 8. Start gate

Starts only when **all**: **v1.1 ✅**, **payments cleared**, **`GO v1.2`** text, **`main`/branch freeze** agreed after v1 merge policy.
