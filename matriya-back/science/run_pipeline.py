"""
MATRIYA Science Pipeline — CLI Runner
Node.js bridge: called via child_process.spawn, returns JSON to stdout.

Usage:
  python run_pipeline.py query   <filepath> <query> [sheet_name]
  python run_pipeline.py boundary <template_key> <sweep_json> <control_json> [case_id]
  python run_pipeline.py test
  python run_pipeline.py validate <filepath> [sheet_name]
  python run_pipeline.py sheets  <filepath>
"""

import sys
import json
import os
import io

# Force UTF-8 on stdout/stderr so emoji in module print() don't crash on Windows
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

# Add science dir to path so imports resolve regardless of cwd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from matriya_pipeline import run_query_pipeline, run_boundary_pipeline
from table_query_engine_final import load_excel, run_tests as run_tqe_tests, run_acceptance_tests
from experimental_schema import run_tests as run_schema_tests
from decision_rule_engine import run_tests as run_dre_tests
from fsctm_state import run_tests as run_fsctm_tests
from domain_priors import run_tests as run_dp_tests
from matriya_pipeline import run_tests as run_pipeline_tests
from data_adapter import load_and_adapt
from document_guard import (
    run_tests as run_guard_tests,
    classify_document, guard_response, check_metric_contamination,
)
from lab_schema_normalizer import run_tests as run_normalizer_tests
from lab_connector import run_tests as run_connector_tests


def _nan_safe(obj):
    """Recursively replace NaN/Inf floats with None so JSON output is valid."""
    import math
    if isinstance(obj, float):
        return None if (math.isnan(obj) or math.isinf(obj)) else obj
    if isinstance(obj, dict):
        return {k: _nan_safe(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_nan_safe(v) for v in obj]
    return obj


# ── LAYER 1: Query Validation ─────────────────────────────────────────────────
# Runs BEFORE the filter engine. Rejects structurally invalid queries early
# so the filter never sees malformed input.
import re as _re

def validate_query(query: str) -> dict:
    """
    Structural pre-filter validation.

    Returns {"valid": True} or {"valid": False, "reason": str}.

    Catches:
      - Dangling operator  : "expansion_ratio >"  (no RHS value)
      - Self-referential   : "expansion_ratio > expansion_ratio"  (column as its own RHS)
    """
    q = query.strip()

    # Dangling operator — expression ends with a comparison operator and nothing after
    dangling = _re.search(r'(>=|<=|!=|==|>|<|=)\s*$', q)
    if dangling:
        op = dangling.group(1)
        return {
            "valid":  False,
            "reason": (
                f"Query ends with operator '{op}' but provides no value. "
                f"Example: 'expansion_ratio > 15'"
            ),
        }

    # Self-referential — same column name used as the RHS of its own condition
    # e.g. "expansion_ratio > expansion_ratio"
    self_ref = _re.search(
        r'\b(\w+)\s*(?:>=|<=|!=|==|>|<)\s*\1\b', q, _re.IGNORECASE
    )
    if self_ref:
        col = self_ref.group(1)
        return {
            "valid":  False,
            "reason": (
                f"Column '{col}' appears on both sides of the operator. "
                f"Provide a numeric value on the right-hand side."
            ),
        }

    return {"valid": True}

def _out(obj):
    print(json.dumps(_nan_safe(obj), default=str), flush=True)


def cmd_query(args):
    if len(args) < 2:
        _out({"error": "Usage: query <filepath> <query> [sheet_name_or_index]"})
        sys.exit(1)

    filepath = args[0]
    query    = args[1]
    case_id  = args[3] if len(args) > 3 else "QUERY-001"

    # Use data_adapter to handle raw Excel format (Hebrew sheets, computed APP:PER / IFR).
    # This is the integration fix: the Excel file's actual sheet name is Hebrew,
    # not "Formulation Data". The adapter loads sheet index 0 and normalises columns.
    adapted = load_and_adapt(filepath, 0)
    if "error" in adapted:
        _out({
            "decision":    "INSUFFICIENT_DATA",
            "evidence":    {"error": adapted["error"]},
            "data_source": "NONE",
            "confidence":  "LOW",
        })
        return

    # Relaxed schema check: allow query if ANY known lab column is present.
    # A strict APP:PER + IFR requirement would block queries like "expansion_ratio > 0"
    # when the data came from manually-entered experiments without APP/PER fields.
    KNOWN_LAB_COLUMNS = {"APP:PER", "IFR", "APP", "PER", "MEL", "Nanoclay",
                         "expansion_ratio", "char_quality", "adhesion", "viscosity", "status"}
    available = set(adapted["canonical_columns"])
    has_any_lab_column = bool(available & KNOWN_LAB_COLUMNS)
    if not has_any_lab_column:
        _out({
            "decision":    "INSUFFICIENT_DATA",
            "quality":     "SCHEMA_ERROR",
            "evidence":    {
                "missing_required_columns": adapted["missing_required"],
                "available_columns":        adapted["canonical_columns"],
            },
            "data_source": "NONE",
            "confidence":  "LOW",
        })
        return

    df = adapted["df"]

    # ── DIAGNOSTIC LOGS — printed to stderr so they appear in Railway logs ──
    import sys as _sys
    print("COLUMNS:", list(df.columns), file=_sys.stderr, flush=True)
    print("DTYPES:", df.dtypes.to_dict(), file=_sys.stderr, flush=True)
    if "expansion_ratio" in df.columns:
        print("expansion_ratio sample:", df["expansion_ratio"].head(5).tolist(), file=_sys.stderr, flush=True)
        print("expansion_ratio dtype:", str(df["expansion_ratio"].dtype), file=_sys.stderr, flush=True)
        print("expansion_ratio non-null count:", df["expansion_ratio"].notna().sum(), file=_sys.stderr, flush=True)
    else:
        print("expansion_ratio: COLUMN NOT FOUND", file=_sys.stderr, flush=True)
    print("ROWS IN DF:", len(df), file=_sys.stderr, flush=True)
    if len(df) > 0:
        print("SAMPLE ROW:", df.iloc[0].to_dict(), file=_sys.stderr, flush=True)
    # ────────────────────────────────────────────────────────────────────────

    # Explicit numeric coercion for all known numeric columns (safety net for string CSV values)
    import pandas as _pd
    for _col in ["APP", "PER", "MEL", "Nanoclay", "APP:PER", "IFR",
                 "expansion_ratio", "adhesion", "viscosity", "HRR_reduction_pct"]:
        if _col in df.columns:
            df[_col] = _pd.to_numeric(df[_col], errors="coerce")

    from table_query_engine_final import (
        parse_natural_language_query, execute_query
    )
    from fsctm_state import FSCTMEngine
    from query_aggregation import detect_aggregation_intent, apply_aggregation

    # ═══════════════════════════════════════════════════════════════════════
    # LAYER 1 — VALIDATION  (pre-filter, returns early on invalid syntax)
    # ═══════════════════════════════════════════════════════════════════════
    v = validate_query(query)
    if not v["valid"]:
        print(f"[validation] INVALID_QUERY: {v['reason']}", file=_sys.stderr, flush=True)
        _out({
            "decision":    "INVALID_QUERY",
            "quality":     "VALIDATION_FAILED",
            "warnings":    [v["reason"]],
            "evidence":    {
                "original_query": query,
                "reason":         v["reason"],
            },
            "data_source": "NONE",
            "confidence":  "LOW",
        })
        return

    # ═══════════════════════════════════════════════════════════════════════
    # LAYER 2 — AGGREGATION DETECTION  (runs filter first if filters exist,
    #           then aggregates; bypasses filter when query is agg-only)
    # ═══════════════════════════════════════════════════════════════════════
    agg_intent = detect_aggregation_intent(query, list(df.columns))
    if agg_intent["has_agg"]:
        if agg_intent.get("column_resolution_failed"):
            print("[aggregation] compound pattern matched but final/rank columns could not be mapped to CSV",
                  file=_sys.stderr, flush=True)
            _out({
                "decision":    "INSUFFICIENT_DATA",
                "quality":     "COMPOUND_COLUMN_MAP",
                "warnings":    [
                    "Compound query (among top N by …) needs both rank and result columns in the lab export. "
                    "Expected names like adhesion, expansion_ratio in the dataset.",
                ],
                "evidence":    {
                    "original_query":   query,
                    "available_columns": list(df.columns),
                },
                "data_source": "NONE",
                "confidence":  "LOW",
            })
            return
        # Parse filter segment: compound NL queries break the generic parser if passed whole.
        if agg_intent.get("compound"):
            _where = _re.search(r"\bwhere\s+(.+)$", query, _re.IGNORECASE | _re.DOTALL)
            if _where:
                _filter_text = _where.group(1).strip()
                _parsed_for_agg = parse_natural_language_query(_filter_text, list(df.columns))
                print(f"[aggregation] compound — filter text only: {_filter_text!r}",
                      file=_sys.stderr, flush=True)
            else:
                _parsed_for_agg = {
                    "filters":          [],
                    "ambiguous_items":  [],
                    "parse_confidence":  "HIGH",
                    "count_intent":     False,
                    "unparsed":         None,
                }
                print("[aggregation] compound — no WHERE clause; using full df",
                      file=_sys.stderr, flush=True)
        else:
            _parsed_for_agg = parse_natural_language_query(query, list(df.columns))
        _parsed_for_agg["_original_query"] = query

        if _parsed_for_agg.get("filters"):
            # Filters present → run filter first, then aggregate on the subset
            print("[aggregation] has filters — running filter then aggregating",
                  file=_sys.stderr, flush=True)
            _parsed_for_agg["defer_final_aggregation"] = True
            _filter_result = execute_query(df, _parsed_for_agg)
            working_df = _filter_result.get("ranked_working_df")
            if working_df is None or (hasattr(working_df, "__len__") and len(working_df) == 0):
                working_df = _filter_result.get("result_df")
            if working_df is None or len(working_df) == 0:
                if agg_intent.get("compound"):
                    print("[aggregation] compound — filter returned 0 rows; NO_MATCHES (no full-df fallback)",
                          file=_sys.stderr, flush=True)
                    _out({
                        "decision":    "NO_MATCHES",
                        "quality":     "FILTER_EMPTY",
                        "warnings":    ["No rows after WHERE filter; cannot rank or aggregate."],
                        "evidence":    {
                            "matched_rows": 0,
                            "total_rows":  len(df),
                            "query":      query,
                        },
                        "data_source": "DB_COMPUTED",
                        "confidence":  "HIGH",
                        "tag":         "computed",
                    })
                    return
                # Non-compound: no silent full-df fallback when filter is empty
                print("[aggregation] filter returned 0 rows — returning NO_MATCHES",
                      file=_sys.stderr, flush=True)
                _out({
                    "error":       "INVALID_QUERY",
                    "reason":      "Filter conditions matched 0 rows — cannot aggregate on an empty result set.",
                    "decision":    "NO_MATCHES",
                    "quality":     "EMPTY_FILTER_RESULT",
                    "warnings":    ["No rows matched the filter conditions. Aggregation was not applied."],
                    "evidence":    {
                        "original_query":  query,
                        "filters_applied": _parsed_for_agg.get("filters", []),
                        "matched_rows":    0,
                    },
                    "data_source": "DB_COMPUTED",
                    "confidence":  "LOW",
                })
                return
        else:
            # Pure aggregation query — use the full dataset directly
            print("[aggregation] no filters — aggregating on full df",
                  file=_sys.stderr, flush=True)
            working_df = df

        print(
            f"[CRITICAL DEBUG] AGG INPUT SIZE = "
            f"{len(working_df) if 'working_df' in locals() else len(df)}",
            flush=True,
        )
        result = apply_aggregation(working_df, agg_intent)
        result["query"]            = query
        result["parse_confidence"] = "HIGH"
        result["computed_columns"] = adapted.get("computed_columns", [])
        _out(result)
        return

    # ═══════════════════════════════════════════════════════════════════════
    # LAYER 3 — FILTER ENGINE  (table_query_engine_final — NOT modified)
    # ═══════════════════════════════════════════════════════════════════════
    parsed = parse_natural_language_query(query, list(df.columns))
    parsed["_original_query"] = query

    # Surface ambiguity immediately
    if parsed["ambiguous_items"]:
        _out({
            "decision":   "AMBIGUOUS_QUERY",
            "quality":    "AMBIGUOUS",
            "warnings":   ["Query contains ambiguous column references."],
            "evidence":   {
                "original_query":   query,
                "ambiguous_items":  [
                    {"term": a.get("raw"), "candidates": a.get("candidates")}
                    for a in parsed["ambiguous_items"]
                ],
                "suggestion": "Please specify the exact column name.",
            },
            "data_source": "NONE",
            "confidence":  "LOW",
        })
        return

    # "show all experiments" / "list experiments" — no filter means return all rows
    SHOW_ALL_TRIGGERS = [
        "show all", "list all", "get all", "fetch all", "find all",
        "show experiments", "list experiments", "all experiments",
        "show formulations", "list formulations",
        "show runs", "list runs", "show all runs",
    ]
    is_show_all = any(t in query.lower() for t in SHOW_ALL_TRIGGERS)

    if parsed["parse_confidence"] == "LOW" and not parsed["filters"] and not parsed["count_intent"]:
        if is_show_all:
            # Return all rows — no filter applied
            import pandas as _pd2
            rows = df.head(100).to_dict(orient="records")
            _out({
                "decision":    "MATCHES_FOUND",
                "quality":     "COMPLETE",
                "warnings":    [],
                "evidence":    {
                    "matched_rows":     len(df),
                    "total_rows":       len(df),
                    "match_rate":       1.0,
                    "filters_applied":  [],
                    "result_preview":   rows,
                    "columns_returned": list(df.columns),
                    "note":             "No filter — returning all rows",
                },
                "data_source":  "DB_COMPUTED",
                "confidence":   "HIGH",
                "tag":          "computed",
                "query":        query,
                "computed_columns": adapted.get("computed_columns", []),
            })
            return
        _out({
            "decision":   "INSUFFICIENT_DATA",
            "quality":    "PARSE_FAILED",
            "warnings":   ["Could not parse query into executable filters."],
            "evidence":   {
                "original_query":    query,
                "unparsed":          parsed["unparsed"],
                "available_columns": list(df.columns),
                "hint":              "Try: 'APP:PER > 3' or 'IFR between 25 and 30' or 'expansion ratio > 10'",
            },
            "data_source": "NONE",
            "confidence":  "LOW",
        })
        return

    result = execute_query(df, parsed)
    result.pop("ranked_working_df", None)

    # ── DIAGNOSTIC LOGS (David request) ─────────────────────────────────────
    result_df_ref = result.get("result_df")
    print("QUERY RESULT decision:", result.get("decision"), file=_sys.stderr, flush=True)
    print("RESULT_DF shape:", result_df_ref.shape if result_df_ref is not None else "None", file=_sys.stderr, flush=True)
    print("MATCHED ROWS:", result.get("evidence", {}).get("matched_rows"), file=_sys.stderr, flush=True)
    preview = result.get("evidence", {}).get("result_preview", [])
    print("RESULT_PREVIEW length:", len(preview), file=_sys.stderr, flush=True)
    if preview:
        print("RESULT_PREVIEW[0]:", preview[0], file=_sys.stderr, flush=True)
    else:
        print("RESULT_PREVIEW: EMPTY — rows not populated in execute_query", file=_sys.stderr, flush=True)
    # ────────────────────────────────────────────────────────────────────────

    result.pop("result_df", None)
    result["query"]            = query
    result["sheet"]            = "adapted_from_raw"
    result["parse_confidence"] = parsed["parse_confidence"]
    result["computed_columns"] = adapted.get("computed_columns", [])

    engine = FSCTMEngine(case_id, [query])
    result["fsctm_state"] = engine.get_state_object()
    result["audit_trace"]["fsctm_trace"] = engine.get_audit_trace()

    # ── FINAL OUTPUT VERIFICATION ─────────────────────────────────────────
    final_rows = result.get("evidence", {}).get("result_preview", [])
    print("FINAL OUTPUT rows count:", len(final_rows), file=_sys.stderr, flush=True)
    print("FINAL OUTPUT decision:", result.get("decision"), file=_sys.stderr, flush=True)
    # ─────────────────────────────────────────────────────────────────────

    _out(result)


def cmd_boundary(args):
    if len(args) < 3:
        _out({"error": "Usage: boundary <template_key> <sweep_json> <control_json> [case_id]"})
        sys.exit(1)
    template_key  = args[0]
    sweep_results = json.loads(args[1])
    control       = json.loads(args[2])
    case_id       = args[3] if len(args) > 3 else "BOUNDARY-001"
    known_facts   = json.loads(args[4]) if len(args) > 4 else []
    components    = json.loads(args[5]) if len(args) > 5 else ["APP", "PER", "APP:PER_ratio"]
    sigs          = json.loads(args[6]) if len(args) > 6 else []
    result = run_boundary_pipeline(
        template_key, sweep_results, control, case_id,
        known_facts, components, sigs
    )
    _out(result)


def cmd_dump_rows(args):
    """
    Dump parsed rows from an Excel/CSV file as a JSON array.
    Usage: dump_rows <filepath> [sheet_index]

    Returns canonical rows ready for insertion into Supabase experiments table:
      { experiment_id, formulation: {...}, results: {...}, status }
    """
    if not args:
        _out({"error": "Usage: dump_rows <filepath> [sheet_index]"})
        sys.exit(1)

    filepath    = args[0]
    sheet_index = int(args[1]) if len(args) > 1 else 0

    adapted = load_and_adapt(filepath, sheet_index)
    if "error" in adapted:
        _out({"error": adapted["error"], "rows": []})
        return

    df = adapted["df"]
    if df is None or len(df) == 0:
        _out({"rows": [], "n_rows": 0})
        return

    # Formulation columns (input parameters)
    FORMULATION_COLS = ["APP", "PER", "MEL", "APP:PER", "IFR", "Nanoclay", "formula"]
    # Results columns (output measurements)
    RESULTS_COLS = ["expansion_ratio", "char_quality", "char_height_mm",
                    "adhesion", "viscosity", "HRR_reduction_pct", "LOI",
                    "char_cohesion_score", "residue_integrity_score"]
    STATUS_COLS = ["status", "result_status"]

    rows_out = []
    for _, row in df.iterrows():
        row_dict = row.where(row.notna(), None).to_dict()

        # Build formulation JSONB
        formulation = {}
        for col in FORMULATION_COLS:
            if col in row_dict and row_dict[col] is not None:
                formulation[col] = row_dict[col]

        # Build results JSONB
        results = {}
        for col in RESULTS_COLS:
            if col in row_dict and row_dict[col] is not None:
                results[col] = row_dict[col]

        # Determine status
        status = "PENDING"
        for sc in STATUS_COLS:
            if sc in row_dict and row_dict[sc] is not None:
                raw = str(row_dict[sc]).strip().upper()
                if raw in ("PASS", "SUCCESS", "1", "TRUE"):
                    status = "PASS"
                elif raw in ("FAIL", "FAILURE", "0", "FALSE"):
                    status = "FAIL"
                elif raw in ("PARTIAL",):
                    status = "PARTIAL"
                else:
                    status = raw if raw else "PENDING"
                break

        # Experiment ID
        exp_id = (row_dict.get("experiment_id") or
                  row_dict.get("Experiment ID") or
                  row_dict.get("exp_id") or
                  f"EXP-{len(rows_out)+1:03d}")

        rows_out.append({
            "experiment_id": str(exp_id),
            "formulation":   formulation,
            "results":       results,
            "status":        status,
        })

    _out({
        "rows":              rows_out,
        "n_rows":            len(rows_out),
        "canonical_columns": list(df.columns),
    })


def cmd_guard_text(args):
    """
    Check a text string for forbidden metric contamination.
    Usage: guard_text <text>
    Returns guard_response JSON (action: ALLOW | SANITIZE | BLOCK).
    """
    if not args:
        _out({"error": "Usage: guard_text <text>"})
        sys.exit(1)
    text   = " ".join(args)
    result = guard_response(text)
    _out(result)


def cmd_classify_doc(args):
    """
    Classify a document into a domain using filename + optional content preview.
    Usage: classify_doc <filename> [content_preview]
    Returns: {domain, confidence, reason, allowed_in_lab_queries}
    """
    if not args:
        _out({"error": "Usage: classify_doc <filename> [content_preview]"})
        sys.exit(1)
    filename = args[0]
    preview  = " ".join(args[1:]) if len(args) > 1 else ""
    result   = classify_document(filename, preview)
    _out(result)


def cmd_test(_args):
    """Run all module unit tests and report results."""
    results = {}
    total_passed = 0
    total_failed = 0

    modules = [
        ("table_query_engine",  run_tqe_tests),
        ("experimental_schema", run_schema_tests),
        ("decision_rule_engine", run_dre_tests),
        ("fsctm_state",         run_fsctm_tests),
        ("domain_priors",       run_dp_tests),
        ("matriya_pipeline",    run_pipeline_tests),
        ("document_guard",      run_guard_tests),
        ("lab_schema_normalizer", run_normalizer_tests),
        ("lab_connector",       run_connector_tests),
    ]

    for name, fn in modules:
        try:
            p, f = fn()
            results[name] = {"passed": p, "failed": f, "ok": f == 0}
            total_passed += p
            total_failed += f
        except Exception as e:
            results[name] = {"passed": 0, "failed": 1, "ok": False, "error": str(e)}
            total_failed += 1

    _out({
        "test_results":   results,
        "total_passed":   total_passed,
        "total_failed":   total_failed,
        "all_passed":     total_failed == 0,
    })


def cmd_validate(args):
    """
    Run acceptance tests against real MATRIYA Excel file.
    Applies data_adapter to handle raw column format before querying.
    """
    if len(args) < 1:
        _out({"error": "Usage: validate <filepath> [sheet_index]"})
        sys.exit(1)

    filepath    = args[0]
    sheet_index = int(args[1]) if len(args) > 1 else 0

    # Step 1: Adapt raw Excel to canonical schema
    adapted = load_and_adapt(filepath, sheet_index)
    if "error" in adapted:
        _out({"error": adapted["error"]})
        sys.exit(1)

    df           = adapted["df"]
    columns      = adapted["canonical_columns"]
    rows_valid   = adapted["rows_valid"]
    computed     = adapted["computed_columns"]
    schema_valid = adapted["schema_valid"]
    adapter_warnings = adapted["warnings"]

    from table_query_engine_final import (
        parse_natural_language_query, execute_query
    )

    # Regression test queries with expected counts (locked after first real run)
    queries = [
        {
            "description":    "High APP:PER ratio (>3)",
            "query":          "APP:PER > 3",
            "expected_count": None,
        },
        {
            "description":    "IFR in 25–45 range",
            "query":          "IFR between 25 and 45",
            "expected_count": None,
        },
        {
            "description":    "Combined: high APP:PER + IFR range",
            "query":          "APP:PER > 3 and IFR between 30 and 45",
            "expected_count": None,
        },
        {
            "description":    "Expansion ratio > 10",
            "query":          "expansion ratio > 10",
            "expected_count": None,
        },
        {
            "description":    "COUNT: IFR > 40",
            "query":          "how many formulations have IFR > 40",
            "expected_count": None,
            "is_count":       True,
        },
        {
            "description":    "Ambiguity: PER → candidates [PER, APP:PER]",
            "query":          "PER > 3",
            "expect_ambiguity": True,
        },
        {
            "description":    "Good char quality",
            "query":          "char quality == good",
            "expected_count": None,
        },
    ]

    validation_results = []
    for t in queries:
        q = t["query"]
        parsed = parse_natural_language_query(q, list(df.columns))
        parsed["_original_query"] = q

        if t.get("expect_ambiguity"):
            has_ambig = len(parsed.get("ambiguous_items", [])) > 0
            validation_results.append({
                "description":    t["description"],
                "query":          q,
                "decision":       "AMBIGUOUS_QUERY" if has_ambig else "NO_AMBIGUITY_DETECTED",
                "passed":         has_ambig,
                "candidates":     [a.get("candidates") for a in parsed.get("ambiguous_items", [])],
            })
            continue

        result = execute_query(df, parsed)
        matched = result.get("evidence", {}).get("matched_rows", 0)
        count   = result.get("evidence", {}).get("count_result")
        exp     = t.get("expected_count")

        if t.get("is_count"):
            ok = exp is None or count == exp
            validation_results.append({
                "description":  t["description"],
                "query":        q,
                "decision":     result.get("decision"),
                "count_result": count,
                "expected":     exp,
                "passed":       ok,
                "warnings":     result.get("warnings", []),
            })
        else:
            ok = exp is None or matched == exp
            row_preview = result.get("evidence", {}).get("result_preview", [])
            # Trim for JSON output
            preview_slim = [
                {k: v for k, v in row.items()
                 if k in ["experiment_id", "APP:PER", "IFR", "APP", "PER", "MEL",
                           "expansion_ratio", "char_quality", "status"]}
                for row in row_preview[:5]
            ]
            validation_results.append({
                "description":  t["description"],
                "query":        q,
                "decision":     result.get("decision"),
                "matched_rows": matched,
                "expected":     exp,
                "passed":       ok,
                "preview":      preview_slim,
                "warnings":     result.get("warnings", []),
            })

    # Collect per-row stats for columns present
    row_stats = {}
    for col in ["APP:PER", "IFR", "APP", "PER", "MEL", "Nanoclay", "expansion_ratio"]:
        if col in df.columns:
            s = df[col].dropna()
            if len(s):
                row_stats[col] = {
                    "min": round(float(s.min()), 4),
                    "max": round(float(s.max()), 4),
                    "mean": round(float(s.mean()), 4),
                    "n_valid": int(len(s)),
                }

    _out({
        "file":              filepath,
        "sheet_index":       sheet_index,
        "rows_loaded":       adapted["rows_loaded"],
        "rows_valid":        rows_valid,
        "canonical_columns": columns,
        "computed_columns":  computed,
        "schema_valid":      schema_valid,
        "missing_required":  adapted["missing_required"],
        "adapter_warnings":  adapter_warnings,
        "column_stats":      row_stats,
        "validation_results": validation_results,
        "total_tests":       len(validation_results),
        "tests_passed":      sum(1 for r in validation_results if r.get("passed", True)),
    })


def cmd_sheets(args):
    """List sheets in Excel file."""
    if not args:
        _out({"error": "Usage: sheets <filepath>"})
        sys.exit(1)
    loaded = load_excel(args[0])
    if "error" in loaded:
        _out({"error": loaded["error"]})
        sys.exit(1)
    _out({
        "sheet_names":    loaded["sheet_names"],
        "sheet_reports":  loaded["sheet_reports"],
    })


COMMANDS = {
    "query":        cmd_query,
    "boundary":     cmd_boundary,
    "test":         cmd_test,
    "validate":     cmd_validate,
    "sheets":       cmd_sheets,
    "guard_text":   cmd_guard_text,
    "classify_doc": cmd_classify_doc,
    "dump_rows":    cmd_dump_rows,
}

if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        _out({"error": f"Unknown command. Available: {list(COMMANDS.keys())}"})
        sys.exit(1)

    cmd  = sys.argv[1]
    rest = sys.argv[2:]
    COMMANDS[cmd](rest)
