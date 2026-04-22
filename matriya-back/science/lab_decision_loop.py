"""
MATRIYA v0.1 — Lab Decision Loop
==================================
Connects lab results to the decision pipeline:

    Lab result (from Supabase)
        ↓
    Schema normalization (lab_schema_normalizer)
        ↓
    Decision Rule Engine (boundary scoring)
        ↓
    FSCTM state advance
        ↓
    Domain priors enrichment
        ↓
    Tagged MATRIYA response

This closes the scientific cycle:
Experiment → Data → Score → State → Decision
"""

import json
from typing import Optional
from datetime import datetime, timezone

from lab_schema_normalizer import (
    flatten_experiment_row,
    rows_to_dataframe,
    normalize_column_name,
)
from decision_rule_engine import compute_boundary_score, evaluate_sweep
from fsctm_state import FSCTMEngine, FSCTMState
from domain_priors import enrich_contradiction, suggest_mechanism_candidate
from lab_connector import SupabaseLabConnector, MockSupabaseClient, make_seed_data


# ─────────────────────────────────────────────────────────
# SOURCE TAGS
# ─────────────────────────────────────────────────────────
class Tag:
    RETRIEVED = "retrieved"
    COMPUTED  = "computed"
    COMBINED  = "combined"
    INFERRED  = "inferred"


# ─────────────────────────────────────────────────────────
# LAB RESULT → DECISION SCORE
# ─────────────────────────────────────────────────────────
def score_lab_result(
    experiment_row: dict,
    control_row:    dict = None,
) -> dict:
    """
    Take a raw Supabase experiment row → compute boundary score.

    Steps:
    1. Normalize column names via lab_schema_normalizer
    2. Extract measurements
    3. Run decision_rule_engine

    Returns score with full audit trace + source tags.
    """
    flat    = flatten_experiment_row(experiment_row)
    control = flatten_experiment_row(control_row) if control_row else None

    score = compute_boundary_score(flat, control)

    return {
        "experiment_id":   flat.get("experiment_id"),
        "decision":        score.decision,
        "weighted_score":  score.weighted_score,
        "sub_scores":      score.sub_scores,
        "contributors":    score.contributors,
        "weights_version": score.weights_version,
        "data_source":     "DB_COMPUTED",
        "tag":             Tag.COMPUTED,
        "audit_trace": {
            "experiment_id":   flat.get("experiment_id"),
            "normalized_cols": list(flat.keys()),
            "weights_used":    score.weights_used,
            "threshold":       score.threshold_used,
            "no_llm":          True,
            "deterministic":   True,
        },
    }


# ─────────────────────────────────────────────────────────
# MULTI-EXPERIMENT SWEEP EVALUATION
# ─────────────────────────────────────────────────────────
def evaluate_lab_sweep(
    experiment_rows: list,
    control_row:     dict,
    sweep_column:    str = "APP:PER",
) -> dict:
    """
    Evaluate a set of lab experiments as a parameter sweep.

    Args:
        experiment_rows: list of raw Supabase rows
        control_row:     the control experiment (reference)
        sweep_column:    which parameter was swept

    Returns boundary claim with full provenance.
    """
    flat_rows    = [flatten_experiment_row(r) for r in experiment_rows]
    flat_control = flatten_experiment_row(control_row)
    canon_col    = normalize_column_name(sweep_column)

    sweep_results = []
    for row in flat_rows:
        param_value = row.get(canon_col)
        if param_value is None:
            continue
        sweep_results.append({
            "param_value":  param_value,
            "measurements": row,
        })

    if not sweep_results:
        return {
            "decision":    "INSUFFICIENT_DATA",
            "evidence":    {
                "reason": f"No values found for sweep column '{canon_col}'",
                "available_columns": list(flat_rows[0].keys()) if flat_rows else [],
            },
            "data_source": "NONE",
            "tag":         Tag.COMPUTED,
        }

    sweep_results.sort(key=lambda x: x["param_value"])

    result = evaluate_sweep(sweep_results, {
        **flat_control,
        "measurements": flat_control,
    })
    result["sweep_column"]  = canon_col
    result["n_experiments"] = len(sweep_results)
    result["data_source"]   = "DB_COMPUTED"
    result["tag"]           = Tag.COMPUTED

    return result


# ─────────────────────────────────────────────────────────
# FULL LAB DECISION LOOP
# ─────────────────────────────────────────────────────────
def run_lab_decision_loop(
    connector:              SupabaseLabConnector,
    case_id:                str,
    project_id:             str,
    sweep_column:           str  = "APP:PER",
    control_experiment_id:  str  = None,
    known_facts:            list = None,
    involved_components:    list = None,
) -> dict:
    """
    Full scientific decision loop driven by live Supabase data.

    Steps:
    1. RETRIEVED: fetch experiments from Supabase
    2. COMPUTED:  normalize + score each experiment
    3. COMPUTED:  evaluate sweep → boundary claim
    4. COMPUTED:  advance FSCTM state
    5. RETRIEVED: enrich with domain priors
    6. COMBINED:  return tagged MATRIYA response

    Scientific cycle: Lab data → Boundary score → FSCTM state → Mechanism candidate
    """
    trace = []

    # ── Step 1: Fetch ────────────────────────────────────
    fetch = connector.get_all_experiments_as_dataframe(project_id)
    trace.append({"step": "1_FETCH", "tag": Tag.RETRIEVED,
                  "result": {
                      "n_rows":   fetch.get("n_rows", 0),
                      "decision": fetch.get("decision"),
                  }})

    if fetch.get("decision") == "INSUFFICIENT_DATA":
        return _response("INSUFFICIENT_DATA", fetch.get("evidence", {}),
                         "NONE", "LOW", Tag.COMPUTED, trace=trace)

    # Re-fetch raw rows for the normalization pipeline
    raw_rows = []
    if hasattr(connector, "_client") and connector._client is not None:
        try:
            raw_resp = (
                connector._client
                .table("experiments")
                .select("*")
                .eq("project_id", project_id)
                .execute()
            )
            raw_rows = raw_resp.data if hasattr(raw_resp, "data") else []
        except Exception:
            raw_rows = []

    if not raw_rows:
        return _response("INSUFFICIENT_DATA",
                         {"reason": "No raw experiment rows fetched"},
                         "NONE", "LOW", Tag.COMPUTED, trace=trace)

    # ── Step 2: Find control ─────────────────────────────
    control_row = None
    if control_experiment_id:
        control_row = next(
            (r for r in raw_rows if r.get("experiment_id") == control_experiment_id),
            None,
        )
    if control_row is None:
        control_row = next(
            (r for r in raw_rows if r.get("status") == "PASS"),
            raw_rows[0],
        )

    flat_control = flatten_experiment_row(control_row)
    trace.append({"step": "2_CONTROL", "tag": Tag.RETRIEVED,
                  "result": {
                      "control_id":       flat_control.get("experiment_id"),
                      "sweep_col_value":  flat_control.get(normalize_column_name(sweep_column)),
                  }})

    # ── Step 3: Score each experiment ────────────────────
    scored = [score_lab_result(row, control_row) for row in raw_rows]
    trace.append({"step": "3_SCORE", "tag": Tag.COMPUTED,
                  "result": {
                      "n_scored":  len(scored),
                      "decisions": [s["decision"] for s in scored],
                  }})

    # ── Step 4: Evaluate sweep ───────────────────────────
    sweep_result = evaluate_lab_sweep(raw_rows, control_row, sweep_column)
    trace.append({"step": "4_SWEEP", "tag": Tag.COMPUTED,
                  "result": {
                      "boundary_claim": sweep_result.get("boundary_claim"),
                      "boundary_value": sweep_result.get("boundary_candidate_value"),
                      "pattern":        sweep_result.get("pattern"),
                  }})

    # ── Step 5: FSCTM state ──────────────────────────────
    engine = FSCTMEngine(case_id, known_facts or [
        f"Dataset: {len(raw_rows)} experiments for project {project_id}"
    ])
    fsctm_result = _advance_fsctm_from_sweep(engine, sweep_result, sweep_column)
    trace.append({"step": "5_FSCTM", "tag": Tag.COMPUTED,
                  "result": fsctm_result})

    # ── Step 6: Domain priors ────────────────────────────
    boundary_val = sweep_result.get("boundary_candidate_value")
    contradiction = (
        f"{sweep_column} below {boundary_val} shows consistent failure"
        if sweep_result.get("boundary_claim")
        else f"No boundary detected in {sweep_column} sweep"
    )
    comps     = involved_components or ["APP", "PER", "APP:PER_ratio"]
    sigs      = [s["decision"] for s in scored if s["decision"] == "CANDIDATE_BOUNDARY"]
    priors    = enrich_contradiction(contradiction, comps)
    candidate = suggest_mechanism_candidate(contradiction, sigs, comps)
    trace.append({"step": "6_PRIORS", "tag": Tag.RETRIEVED,
                  "result": {
                      "n_mechanisms":       priors["n_mechanisms"],
                      "mechanism_candidate": candidate.get("top_candidate"),
                  }})

    # ── Final response ────────────────────────────────────
    final_decision = {
        True:  "CANDIDATE_BOUNDARY",
        False: "COVERAGE_GAP_ONLY",
    }.get(sweep_result.get("boundary_claim"), "AMBIGUOUS")

    return _response(
        decision    = final_decision,
        evidence    = {
            "sweep_column":        sweep_column,
            "n_experiments":       len(raw_rows),
            "boundary_claim":      sweep_result.get("boundary_claim"),
            "boundary_value":      boundary_val,
            "pattern":             sweep_result.get("pattern"),
            "fsctm_state":         engine.state.current_state.value,
            "mechanism_candidate": candidate.get("top_candidate"),
            "point_scores":        sweep_result.get("point_scores", []),
            "source_breakdown": {
                "experiments":   Tag.RETRIEVED,
                "scores":        Tag.COMPUTED,
                "fsctm":         Tag.COMPUTED,
                "domain_priors": Tag.RETRIEVED,
                "final":         Tag.COMBINED,
            },
        },
        data_source = "DB_COMPUTED",
        confidence  = "HIGH" if not sweep_result.get("warnings") else "MEDIUM",
        tag         = Tag.COMBINED,
        fsctm_state = engine.get_state_object(),
        trace       = trace,
    )


def _advance_fsctm_from_sweep(
    engine:       FSCTMEngine,
    sweep_result: dict,
    sweep_column: str,
) -> dict:
    """Advance FSCTM state based on sweep evaluation result."""
    boundary_claim = sweep_result.get("boundary_claim", False)
    boundary_value = sweep_result.get("boundary_candidate_value")

    if engine.state.current_state == FSCTMState.K:
        engine.assert_contradiction(
            f"{sweep_column} sweep reveals boundary candidate at {boundary_value}",
            [f"boundary_claim={boundary_claim}",
             f"n_points={sweep_result.get('n_boundary_points')}/{sweep_result.get('n_total_points')}"],
        )

    if engine.state.current_state == FSCTMState.C and boundary_claim:
        engine.assert_breakdown(
            f"Consistent failure detected below {boundary_value} "
            f"({sweep_result.get('n_boundary_points')} of "
            f"{sweep_result.get('n_total_points')} points fail)",
            f"{sweep_column}_monotonic_stability_assumption",
        )

    if engine.state.current_state == FSCTMState.B:
        engine.propose_experiment(
            {"name": f"{sweep_column} Boundary Confirmation",
             "sweep": sweep_result.get("point_scores", []),
             "boundary_candidate": boundary_value},
            f"Confirm {sweep_column} < {boundary_value} causes consistent failure",
        )

    return {
        "final_state":   engine.state.current_state.value,
        "n_transitions": len(engine.state.history),
    }


def _response(decision, evidence, data_source, confidence, tag,
              fsctm_state=None, trace=None):
    return {
        "decision":    decision,
        "evidence":    evidence,
        "data_source": data_source,
        "confidence":  confidence,
        "tag":         tag,
        "fsctm_state": fsctm_state,
        "audit_trace": {
            "steps":         trace or [],
            "no_llm":        True,
            "deterministic": True,
        },
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# ─────────────────────────────────────────────────────────
# TESTS
# ─────────────────────────────────────────────────────────
def run_tests():
    print("=" * 60)
    print("Lab Decision Loop — Tests")
    print("=" * 60)
    passed = failed = 0

    seed = make_seed_data()
    mock = MockSupabaseClient(seed_data=seed)
    conn = SupabaseLabConnector(client=mock)

    # Test 1: Score single experiment
    row     = seed[0]
    control = seed[0]
    s       = score_lab_result(row, control)
    ok1     = s["tag"] == Tag.COMPUTED and "weighted_score" in s
    print(f"{'OK' if ok1 else 'FAIL'} Score single experiment "
          f"(decision={s['decision']}, score={s['weighted_score']})")
    if ok1: passed += 1
    else:   failed += 1

    # Test 2: APP:PER normalization in score audit trace
    ok2 = "APP:PER" in s["audit_trace"]["normalized_cols"]
    print(f"{'OK' if ok2 else 'FAIL'} APP:PER normalized in score audit trace")
    if ok2: passed += 1
    else:   failed += 1

    # Test 3: Sweep evaluation
    sweep = evaluate_lab_sweep(seed, seed[0], "APP:PER")
    ok3   = "boundary_claim" in sweep and sweep["tag"] == Tag.COMPUTED
    print(f"{'OK' if ok3 else 'FAIL'} Sweep evaluation "
          f"(boundary_claim={sweep.get('boundary_claim')})")
    if ok3: passed += 1
    else:   failed += 1

    # Test 4: Full loop
    result = run_lab_decision_loop(
        connector           = conn,
        case_id             = "LOOP-TEST-001",
        project_id          = "INT-TFX",
        sweep_column        = "APP:PER",
        known_facts         = ["APP:PER >= 2.26 stable (3 test experiments)"],
        involved_components = ["APP", "PER", "APP:PER_ratio"],
    )
    ok4 = result["tag"] == Tag.COMBINED and "fsctm_state" in result
    print(f"{'OK' if ok4 else 'FAIL'} Full loop "
          f"(decision={result['decision']}, "
          f"fsctm={result.get('fsctm_state', {}).get('current_state')})")
    if ok4: passed += 1
    else:   failed += 1

    # Test 5: Source breakdown present
    breakdown = result["evidence"].get("source_breakdown", {})
    ok5 = (breakdown.get("experiments") == Tag.RETRIEVED and
           breakdown.get("final") == Tag.COMBINED)
    print(f"{'OK' if ok5 else 'FAIL'} Source breakdown: {breakdown}")
    if ok5: passed += 1
    else:   failed += 1

    # Test 6: Audit trace has 6 steps
    steps = result["audit_trace"].get("steps", [])
    ok6   = len(steps) == 6
    print(f"{'OK' if ok6 else 'FAIL'} Audit trace: {len(steps)} steps (expected 6)")
    if ok6: passed += 1
    else:   failed += 1

    # Test 7: no_llm flag
    ok7 = result["audit_trace"].get("no_llm") is True
    print(f"{'OK' if ok7 else 'FAIL'} no_llm=True in audit trace")
    if ok7: passed += 1
    else:   failed += 1

    # Test 8: Determinism × 3
    results = [
        run_lab_decision_loop(conn, "DET-001", "INT-TFX", "APP:PER")
        for _ in range(3)
    ]
    ok8 = all(
        r["decision"] == results[0]["decision"] and
        r["evidence"].get("boundary_claim") == results[0]["evidence"].get("boundary_claim")
        for r in results
    )
    print(f"{'OK' if ok8 else 'FAIL'} Determinism x3: {'PASS' if ok8 else 'FAIL'}")
    if ok8: passed += 1
    else:   failed += 1

    print(f"\n{'OK' if failed == 0 else 'FAIL'} {passed}/{passed+failed} passed")
    return passed, failed


if __name__ == "__main__":
    run_tests()
