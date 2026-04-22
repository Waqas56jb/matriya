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


def _out(obj):
    print(json.dumps(obj, default=str), flush=True)


def cmd_query(args):
    if len(args) < 2:
        _out({"error": "Usage: query <filepath> <query> [sheet_name]"})
        sys.exit(1)
    filepath   = args[0]
    query      = args[1]
    sheet_name = args[2] if len(args) > 2 else "Formulation Data"
    case_id    = args[3] if len(args) > 3 else "QUERY-001"
    result = run_query_pipeline(filepath, query, case_id, sheet_name)
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


def cmd_test(_args):
    """Run all module unit tests and report results."""
    results = {}
    total_passed = 0
    total_failed = 0

    modules = [
        ("table_query_engine", run_tqe_tests),
        ("experimental_schema", run_schema_tests),
        ("decision_rule_engine", run_dre_tests),
        ("fsctm_state", run_fsctm_tests),
        ("domain_priors", run_dp_tests),
        ("matriya_pipeline", run_pipeline_tests),
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
    "query":    cmd_query,
    "boundary": cmd_boundary,
    "test":     cmd_test,
    "validate": cmd_validate,
    "sheets":   cmd_sheets,
}

if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        _out({"error": f"Unknown command. Available: {list(COMMANDS.keys())}"})
        sys.exit(1)

    cmd  = sys.argv[1]
    rest = sys.argv[2:]
    COMMANDS[cmd](rest)
