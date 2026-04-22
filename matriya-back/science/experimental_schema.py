"""
MATRIYA v0.1 — Week 2: Experimental Schema + Failure Signatures
===============================================================
Produces a structured, executable experiment definition.
Every field is either observed (measured) or inferred (tagged).
No mixing of the two in a single output field.
"""

from dataclasses import dataclass, field, asdict
from typing import Optional
from datetime import datetime, timezone
import json


# ─────────────────────────────────────────────────────────
# OBSERVED FAILURE SIGNATURES
# Directly measurable in the lab — no interpretation required
# ─────────────────────────────────────────────────────────
OBSERVED_SIGNATURES = {
    "phase_separation": {
        "name":        "Phase Separation",
        "measure":     "Visual inspection: two distinct phases visible",
        "threshold":   "Any visible phase separation = FAIL",
        "tag":         "observed",
    },
    "viscosity_collapse": {
        "name":        "Viscosity Collapse",
        "measure":     "Viscosity drops > 30% vs control at same shear rate",
        "threshold":   "> 30% drop = FAIL",
        "tag":         "observed",
    },
    "low_expansion": {
        "name":        "Low Expansion Ratio",
        "measure":     "expansion_ratio < 10",
        "threshold":   "< 10 = FAIL",
        "tag":         "observed",
    },
    "cracked_char": {
        "name":        "Cracked / Brittle Char",
        "measure":     "Visual: cracks, fissures, or fragmentation in char layer",
        "threshold":   "Any cracking = FAIL",
        "tag":         "observed",
    },
    "poor_residue_cohesion": {
        "name":        "Poor Residue Cohesion",
        "measure":     "Char disintegrates under light mechanical pressure",
        "threshold":   "Disintegration = FAIL",
        "tag":         "observed",
    },
    "high_variability": {
        "name":        "High Repeatability Variance",
        "measure":     "CV (coefficient of variation) > 15% across 3 repeats",
        "threshold":   "CV > 15% = FAIL",
        "tag":         "observed",
    },
    "sedimentation": {
        "name":        "Sedimentation",
        "measure":     "Visible solids settling after 24h at rest",
        "threshold":   "Any sedimentation = FAIL",
        "tag":         "observed",
    },
}

# ─────────────────────────────────────────────────────────
# INFERRED FAILURE SIGNATURES
# Mechanistic interpretation — requires domain knowledge
# ALWAYS tagged as inferred, never reported as fact
# ─────────────────────────────────────────────────────────
INFERRED_SIGNATURES = {
    "acid_carbon_imbalance": {
        "name":        "Acid-Carbon Stoichiometric Imbalance",
        "mechanism":   "APP:PER ratio deviates from optimal acid:carbon balance → incomplete char formation",
        "indicator":   "low expansion_ratio + cracked_char simultaneously",
        "tag":         "inferred",
        "confidence":  "medium",
    },
    "char_discontinuity": {
        "name":        "Char Layer Discontinuity",
        "mechanism":   "Insufficient MEL → incomplete blowing → gaps in intumescent layer",
        "indicator":   "low_expansion + poor_residue_cohesion",
        "tag":         "inferred",
        "confidence":  "medium",
    },
    "ionic_network_disruption": {
        "name":        "Ionic Network Disruption",
        "mechanism":   "Low Zn²⁺ neutralization → weak ionic crosslinks → structural collapse under heat",
        "indicator":   "phase_separation + viscosity_collapse at elevated temp",
        "tag":         "inferred",
        "confidence":  "low",
    },
    "nanoclay_agglomeration": {
        "name":        "Nanoclay Agglomeration",
        "mechanism":   "Cloisite 30B > 6wt% → clay stacks not exfoliated → barrier effect lost",
        "indicator":   "high_variability + poor_residue_cohesion",
        "tag":         "inferred",
        "confidence":  "low",
    },
}


# ─────────────────────────────────────────────────────────
# EXPERIMENT TEMPLATE
# ─────────────────────────────────────────────────────────
@dataclass
class ExperimentTemplate:
    name:            str
    hypothesis:      str
    fixed_params:    dict          # variables held constant
    sweep_params:    dict          # {column: [values to test]}
    response_vars:   list          # what to measure
    observed_sigs:   list          # list of OBSERVED_SIGNATURES keys
    inferred_sigs:   list          # list of INFERRED_SIGNATURES keys — always tagged
    decision_inputs: dict          # what feeds into the Decision Rule Engine
    notes:           str = ""
    created_at:      str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )

    def to_dict(self) -> dict:
        d = asdict(self)
        # Expand signature keys into full definitions
        d["observed_signatures"] = {
            k: OBSERVED_SIGNATURES[k]
            for k in self.observed_sigs
            if k in OBSERVED_SIGNATURES
        }
        d["inferred_signatures"] = {
            k: {**INFERRED_SIGNATURES[k], "tag": "inferred"}
            for k in self.inferred_sigs
            if k in INFERRED_SIGNATURES
        }
        return d

    def validate(self) -> list:
        """Return list of validation errors."""
        errors = []
        if not self.name:
            errors.append("name is required")
        if not self.sweep_params:
            errors.append("sweep_params cannot be empty")
        if not self.response_vars:
            errors.append("response_vars cannot be empty")
        if not self.observed_sigs:
            errors.append("at least one observed_sig required")
        for k in self.observed_sigs:
            if k not in OBSERVED_SIGNATURES:
                errors.append(f"unknown observed signature: {k}")
        for k in self.inferred_sigs:
            if k not in INFERRED_SIGNATURES:
                errors.append(f"unknown inferred signature: {k}")
        return errors


# ─────────────────────────────────────────────────────────
# FACTORY: build standard templates
# ─────────────────────────────────────────────────────────
def build_app_per_boundary_template() -> ExperimentTemplate:
    return ExperimentTemplate(
        name        = "APP:PER Stability Boundary Test",
        hypothesis  = (
            "If APP:PER < 2.26 causes consistent failure vs control, "
            "then 2.26 is a candidate stability boundary. "
            "Otherwise it is a coverage gap only."
        ),
        fixed_params = {
            "IFR":     42.0,
            "binder":  "acrylic_ionomer_AA_BMA_MMA_20_50_30",
            "process": "standard_mixing_25C_10min",
            "solids":  "constant",
        },
        sweep_params = {
            "APP:PER": [2.26, 2.0, 1.5, 1.0],
        },
        response_vars = [
            "viscosity",
            "sedimentation_24h",
            "expansion_ratio",
            "char_height_mm",
            "char_cohesion_score",
            "residue_integrity_score",
            "repeatability_cv",
        ],
        observed_sigs = [
            "phase_separation",
            "viscosity_collapse",
            "low_expansion",
            "cracked_char",
            "poor_residue_cohesion",
            "high_variability",
            "sedimentation",
        ],
        inferred_sigs = [
            "acid_carbon_imbalance",
            "char_discontinuity",
        ],
        decision_inputs = {
            "boundary_claim_threshold": 0.6,
            "control_reference":        "APP:PER = 2.26",
            "decision_rule":            "weighted_boundary_score",
        },
        notes = (
            "Run each APP:PER value in triplicate. "
            "Record all 7 response variables per repeat. "
            "Compare each sweep point against control (APP:PER=2.26)."
        ),
    )


def build_nanoclay_sweep_template() -> ExperimentTemplate:
    return ExperimentTemplate(
        name        = "Nanoclay Loading Sweep (Cloisite 30B)",
        hypothesis  = (
            "Cloisite 30B at 4-6wt% provides optimal exfoliation and barrier effect. "
            "Above 6wt% leads to agglomeration."
        ),
        fixed_params = {
            "APP:PER":       3.0,
            "IFR":           40.0,
            "neutralization": 45.0,
        },
        sweep_params = {
            "Nanoclay": [0.0, 2.0, 4.0, 5.0, 6.0, 7.0],
        },
        response_vars = [
            "expansion_ratio",
            "char_quality",
            "adhesion",
            "TGA_onset_temp",
            "residue_integrity_score",
        ],
        observed_sigs = [
            "low_expansion",
            "cracked_char",
            "poor_residue_cohesion",
            "high_variability",
        ],
        inferred_sigs = [
            "nanoclay_agglomeration",
            "char_discontinuity",
        ],
        decision_inputs = {
            "boundary_claim_threshold": 0.5,
            "control_reference":        "Nanoclay = 0.0 (Cloisite-free control)",
            "decision_rule":            "weighted_boundary_score",
        },
        notes = (
            "Cloisite-free control (0.0) is mandatory. "
            "Without it, nanoclay contribution cannot be isolated."
        ),
    )


def build_neutralization_gradient_template() -> ExperimentTemplate:
    return ExperimentTemplate(
        name        = "Zn²⁺ Neutralization Gradient",
        hypothesis  = (
            "Neutralization at 45-55% provides optimal ionic crosslink density. "
            "Below 30% → network too weak. Above 65% → over-crosslinked."
        ),
        fixed_params = {
            "APP:PER":  3.0,
            "IFR":      40.0,
            "Nanoclay": 4.5,
        },
        sweep_params = {
            "neutralization_pct": [30.0, 40.0, 45.0, 50.0, 55.0, 65.0],
        },
        response_vars = [
            "expansion_ratio",
            "viscosity",
            "adhesion",
            "char_cohesion_score",
            "phase_separation_visual",
        ],
        observed_sigs = [
            "phase_separation",
            "viscosity_collapse",
            "low_expansion",
            "poor_residue_cohesion",
        ],
        inferred_sigs = [
            "ionic_network_disruption",
            "acid_carbon_imbalance",
        ],
        decision_inputs = {
            "boundary_claim_threshold": 0.55,
            "control_reference":        "neutralization = 45%",
            "decision_rule":            "weighted_boundary_score",
        },
        notes = (
            "Critical missing experiment. "
            "No neutralization gradient data exists in current dataset. "
            "This is a priority gap."
        ),
    )


# ─────────────────────────────────────────────────────────
# TEMPLATE REGISTRY
# ─────────────────────────────────────────────────────────
TEMPLATE_REGISTRY = {
    "app_per_boundary":       build_app_per_boundary_template,
    "nanoclay_sweep":         build_nanoclay_sweep_template,
    "neutralization_gradient": build_neutralization_gradient_template,
}


def get_template(name: str) -> Optional[ExperimentTemplate]:
    """Retrieve a template by key. Returns None if not found."""
    factory = TEMPLATE_REGISTRY.get(name)
    return factory() if factory else None


def list_templates() -> list:
    return list(TEMPLATE_REGISTRY.keys())


# ─────────────────────────────────────────────────────────
# TESTS
# ─────────────────────────────────────────────────────────
def run_tests():
    print("=" * 60)
    print("Week 2 — Experimental Schema Tests")
    print("=" * 60)
    passed = failed = 0

    for key in list_templates():
        t = get_template(key)
        errors = t.validate()
        ok = len(errors) == 0
        if ok:
            passed += 1
            print(f"✅ {t.name}")
        else:
            failed += 1
            print(f"❌ {t.name}: {errors}")

    # Tag integrity check — inferred must never appear without tag
    t = get_template("app_per_boundary")
    d = t.to_dict()
    for k, v in d["inferred_signatures"].items():
        assert v["tag"] == "inferred", f"FAIL: {k} missing inferred tag"
    for k, v in d["observed_signatures"].items():
        assert v["tag"] == "observed", f"FAIL: {k} missing observed tag"
    print("✅ Tag integrity: all signatures correctly tagged")
    passed += 1

    print(f"\n{'✅' if failed == 0 else '❌'} {passed}/{passed+failed} passed")
    return passed, failed


if __name__ == "__main__":
    run_tests()
    print("\n--- APP:PER Boundary Template ---")
    t = get_template("app_per_boundary")
    print(json.dumps(t.to_dict(), indent=2, default=str))
