"""
MATRIYA v0.1 — Week 3: Decision Rule Engine
============================================
Weighted boundary scoring. No ML. No LLM.
All weights are domain-expert defined and versioned.
Same inputs → same outputs. Always.
"""

from dataclasses import dataclass, field, asdict
from typing import Optional
from datetime import datetime, timezone
import json


# ─────────────────────────────────────────────────────────
# WEIGHT SCHEMA v1.0 (intumescent coatings)
# Weights sum to 1.0. Change here, version the schema.
# ─────────────────────────────────────────────────────────
BOUNDARY_WEIGHTS_V1 = {
    "version":      "1.0",
    "domain":       "intumescent_coatings",
    "weights": {
        "char_failure":         0.35,
        "stability_failure":    0.30,
        "thermal_failure":      0.20,
        "repeatability_failure": 0.15,
    },
    "boundary_threshold":   0.60,
    "gap_threshold":        0.30,
}


def score_char_failure(result: dict) -> tuple:
    score = 0.0
    contributors = []

    char_quality = str(result.get("char_quality", "")).lower()
    if char_quality == "poor":
        score += 0.5
        contributors.append("char_quality=poor (+0.5)")
    elif char_quality == "fair":
        score += 0.2
        contributors.append("char_quality=fair (+0.2)")

    if result.get("cracked_char") is True:
        score += 0.3
        contributors.append("cracked_char=True (+0.3)")

    cohesion = result.get("char_cohesion_score")
    if cohesion is not None:
        if cohesion < 3:
            score += 0.2
            contributors.append(f"char_cohesion={cohesion}<3 (+0.2)")

    residue = result.get("residue_integrity_score")
    if residue is not None:
        if residue < 3:
            score += 0.1
            contributors.append(f"residue_integrity={residue}<3 (+0.1)")

    return min(score, 1.0), contributors


def score_stability_failure(result: dict) -> tuple:
    score = 0.0
    contributors = []

    if result.get("phase_separation") is True:
        score += 0.5
        contributors.append("phase_separation=True (+0.5)")

    visc_drop = result.get("viscosity_drop_pct")
    if visc_drop is not None and visc_drop > 30:
        score += 0.3
        contributors.append(f"viscosity_drop={visc_drop}% (+0.3)")

    if result.get("sedimentation") is True:
        score += 0.2
        contributors.append("sedimentation=True (+0.2)")

    return min(score, 1.0), contributors


def score_thermal_failure(result: dict, control_expansion: float = None) -> tuple:
    score = 0.0
    contributors = []

    expansion = result.get("expansion_ratio")
    if expansion is not None:
        if expansion < 10:
            score += 0.5
            contributors.append(f"expansion_ratio={expansion}<10 (+0.5)")
        elif expansion < 15:
            score += 0.2
            contributors.append(f"expansion_ratio={expansion}<15 (+0.2)")

        if control_expansion is not None and control_expansion > 0:
            drop_pct = (control_expansion - expansion) / control_expansion * 100
            if drop_pct > 30:
                score += 0.3
                contributors.append(f"expansion drop vs control={drop_pct:.1f}% (+0.3)")

    tga_onset = result.get("TGA_onset_temp")
    if tga_onset is not None and tga_onset < 200:
        score += 0.2
        contributors.append(f"TGA_onset={tga_onset}<200°C (+0.2)")

    return min(score, 1.0), contributors


def score_repeatability_failure(result: dict) -> tuple:
    score = 0.0
    contributors = []

    cv = result.get("repeatability_cv")
    if cv is not None:
        if cv > 25:
            score += 1.0
            contributors.append(f"CV={cv}% > 25% (+1.0)")
        elif cv > 15:
            score += 0.5
            contributors.append(f"CV={cv}% > 15% (+0.5)")
        elif cv > 10:
            score += 0.2
            contributors.append(f"CV={cv}% > 10% (+0.2)")

    return min(score, 1.0), contributors


@dataclass
class BoundaryScoreResult:
    weighted_score:      float
    decision:            str
    sub_scores:          dict
    contributors:        dict
    weights_version:     str
    weights_used:        dict
    threshold_used:      float
    control_reference:   Optional[str]
    data_source:         str = "DB_COMPUTED"
    tag:                 str = "computed"
    timestamp:           str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


def compute_boundary_score(
    result: dict,
    control_result: dict = None,
    weights: dict = None,
) -> BoundaryScoreResult:
    w = weights or BOUNDARY_WEIGHTS_V1
    wt = w["weights"]
    control_expansion = (
        control_result.get("expansion_ratio") if control_result else None
    )

    char_score,        char_contrib        = score_char_failure(result)
    stability_score,   stability_contrib   = score_stability_failure(result)
    thermal_score,     thermal_contrib     = score_thermal_failure(result, control_expansion)
    repeat_score,      repeat_contrib      = score_repeatability_failure(result)

    weighted = (
        wt["char_failure"]         * char_score +
        wt["stability_failure"]    * stability_score +
        wt["thermal_failure"]      * thermal_score +
        wt["repeatability_failure"] * repeat_score
    )
    weighted = round(weighted, 4)

    boundary_t = w["boundary_threshold"]
    gap_t      = w["gap_threshold"]

    if weighted >= boundary_t:
        decision = "CANDIDATE_BOUNDARY"
    elif weighted < gap_t:
        decision = "COVERAGE_GAP_ONLY"
    else:
        decision = "AMBIGUOUS"

    return BoundaryScoreResult(
        weighted_score    = weighted,
        decision          = decision,
        sub_scores        = {
            "char_failure":         round(char_score, 4),
            "stability_failure":    round(stability_score, 4),
            "thermal_failure":      round(thermal_score, 4),
            "repeatability_failure": round(repeat_score, 4),
        },
        contributors      = {
            "char_failure":         char_contrib,
            "stability_failure":    stability_contrib,
            "thermal_failure":      thermal_contrib,
            "repeatability_failure": repeat_contrib,
        },
        weights_version   = w["version"],
        weights_used      = wt,
        threshold_used    = boundary_t,
        control_reference = control_result.get("label") if control_result else None,
    )


def evaluate_sweep(sweep_results: list, control_result: dict) -> dict:
    point_scores = []
    for point in sweep_results:
        score = compute_boundary_score(
            point["measurements"], control_result
        )
        point_scores.append({
            "param_value":     point["param_value"],
            "weighted_score":  score.weighted_score,
            "decision":        score.decision,
            "sub_scores":      score.sub_scores,
        })

    boundary_points = [
        p for p in point_scores if p["decision"] == "CANDIDATE_BOUNDARY"
    ]
    control_score = compute_boundary_score(
        control_result.get("measurements", control_result), None
    )

    control_is_passing = control_score.decision != "CANDIDATE_BOUNDARY"
    consistent_failure = len(boundary_points) >= 2 and control_is_passing

    boundary_candidate = None
    if consistent_failure:
        boundary_candidate = max(
            p["param_value"] for p in boundary_points
        )

    pattern = _describe_pattern(point_scores)

    return {
        "boundary_claim":            consistent_failure,
        "boundary_candidate_value":  boundary_candidate,
        "pattern":                   pattern,
        "n_boundary_points":         len(boundary_points),
        "n_total_points":            len(point_scores),
        "control_decision":          control_score.decision,
        "point_scores":              point_scores,
        "data_source":               "DB_COMPUTED",
        "tag":                       "computed",
        "timestamp":                 datetime.now(timezone.utc).isoformat(),
    }


def _describe_pattern(point_scores: list) -> str:
    decisions = [p["decision"] for p in point_scores]
    if all(d == "CANDIDATE_BOUNDARY" for d in decisions):
        return "uniform_failure"
    if all(d == "COVERAGE_GAP_ONLY" for d in decisions):
        return "no_failure_detected"
    if decisions[-1] == "CANDIDATE_BOUNDARY" and decisions[0] != "CANDIDATE_BOUNDARY":
        return "failure_at_extremes"
    if decisions[0] == "CANDIDATE_BOUNDARY" and decisions[-1] != "CANDIDATE_BOUNDARY":
        return "failure_at_low_values"
    return "mixed"


def run_tests():
    print("=" * 60)
    print("Week 3 — Decision Rule Engine Tests")
    print("=" * 60)
    passed = failed = 0

    control = {
        "label":              "APP:PER=2.26",
        "expansion_ratio":    20.0,
        "char_quality":       "good",
        "cracked_char":       False,
        "phase_separation":   False,
        "repeatability_cv":   8.0,
        "char_cohesion_score": 4,
    }

    fail_result = {
        "expansion_ratio":    7.0,
        "char_quality":       "poor",
        "cracked_char":       True,
        "phase_separation":   True,
        "repeatability_cv":   20.0,
        "char_cohesion_score": 1,
    }
    r = compute_boundary_score(fail_result, control)
    ok = r.decision == "CANDIDATE_BOUNDARY"
    print(f"{'✅' if ok else '❌'} Clear failure → CANDIDATE_BOUNDARY "
          f"(score={r.weighted_score})")
    if ok: passed += 1
    else: failed += 1

    pass_result = {
        "expansion_ratio":    19.0,
        "char_quality":       "good",
        "cracked_char":       False,
        "phase_separation":   False,
        "repeatability_cv":   7.0,
        "char_cohesion_score": 4,
    }
    r2 = compute_boundary_score(pass_result, control)
    ok2 = r2.decision == "COVERAGE_GAP_ONLY"
    print(f"{'✅' if ok2 else '❌'} Clear pass → COVERAGE_GAP_ONLY "
          f"(score={r2.weighted_score})")
    if ok2: passed += 1
    else: failed += 1

    results = [compute_boundary_score(fail_result, control) for _ in range(3)]
    det_ok = all(r.weighted_score == results[0].weighted_score for r in results)
    print(f"{'✅' if det_ok else '❌'} Determinism × 3: "
          f"{'PASS' if det_ok else 'FAIL'}")
    if det_ok: passed += 1
    else: failed += 1

    sweep = [
        {"param_value": 2.26, "measurements": pass_result},
        {"param_value": 2.0,  "measurements": {
            "expansion_ratio": 11.0, "char_quality": "fair",
            "cracked_char": False, "phase_separation": False,
            "repeatability_cv": 12.0, "char_cohesion_score": 3}},
        {"param_value": 1.5,  "measurements": fail_result},
        {"param_value": 1.0,  "measurements": fail_result},
    ]
    sw = evaluate_sweep(sweep, {**control, "measurements": pass_result})
    ok3 = sw["boundary_claim"] is True
    print(f"{'✅' if ok3 else '❌'} Sweep → boundary_claim=True "
          f"at value={sw['boundary_candidate_value']}")
    if ok3: passed += 1
    else: failed += 1

    print(f"\n{'✅' if failed == 0 else '❌'} {passed}/{passed+failed} passed")
    return passed, failed


if __name__ == "__main__":
    run_tests()
