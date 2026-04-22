"""
MATRIYA v0.1 — Week 5: Domain Mechanism Priors
===============================================
Hand-crafted knowledge graph for intumescent coatings.
No ML. No LLM. Deterministic lookup.
Used to enrich inferred signatures and suggest mechanisms.
"""

from typing import Optional
import json


MECHANISM_GRAPH = {
    "APP": {
        "full_name":   "Ammonium Polyphosphate",
        "cas":         "68333-79-9",
        "function":    "acid_source",
        "role":        "Releases phosphoric acid on decomposition → catalyses char formation",
        "effects": {
            "high_APP": {
                "condition": "APP:PER > 4",
                "effect":    "Excess acid → char too porous, weak cohesion",
                "tag":       "inferred",
                "confidence": "medium",
            },
            "optimal_APP": {
                "condition": "APP:PER 2.5–3.5",
                "effect":    "Balanced acid:carbon ratio → dense, cohesive char",
                "tag":       "inferred",
                "confidence": "high",
            },
            "low_APP": {
                "condition": "APP:PER < 2",
                "effect":    "Insufficient acid → incomplete carbonisation → low expansion",
                "tag":       "inferred",
                "confidence": "medium",
            },
        },
        "decomp_temp_c": 250,
        "data_grade":    "HISTORICAL_REFERENCE",
    },
    "PER": {
        "full_name":   "Pentaerythritol",
        "cas":         "115-77-5",
        "function":    "carbon_source",
        "role":        "Polyol that reacts with APP acid to form carbonaceous char",
        "effects": {
            "low_PER": {
                "condition": "APP:PER > 4 (relative PER deficiency)",
                "effect":    "Insufficient carbon skeleton → thin, fragile char",
                "tag":       "inferred",
                "confidence": "medium",
            },
        },
        "decomp_temp_c": 260,
        "data_grade":    "HISTORICAL_REFERENCE",
    },
    "MEL": {
        "full_name":   "Melamine",
        "cas":         "108-78-1",
        "function":    "blowing_agent",
        "role":        "Releases NH3 on decomposition → expands char layer",
        "effects": {
            "low_MEL": {
                "condition": "MEL < 5% of IFR",
                "effect":    "Insufficient gas evolution → low expansion ratio",
                "tag":       "inferred",
                "confidence": "high",
            },
            "high_MEL": {
                "condition": "MEL > 10% of IFR",
                "effect":    "Excess gas → rapid collapse of char structure",
                "tag":       "inferred",
                "confidence": "medium",
            },
        },
        "decomp_temp_c": 354,
        "data_grade":    "HISTORICAL_REFERENCE",
        "note":          "MEL is a blowing agent, NOT a char stabiliser. "
                         "Zn²⁺ neutralisation is ionic network reinforcement.",
    },
    "Nanoclay": {
        "full_name":     "Cloisite 30B (organically modified montmorillonite)",
        "cas":           "1318-93-0",
        "function":      "barrier_agent",
        "supplier":      "Southern Clay Products",
        "role":          "Exfoliated clay platelets form physical barrier → reduces heat transfer",
        "effects": {
            "optimal_loading": {
                "condition": "4–6 wt%",
                "effect":    "Good exfoliation → tortuous path barrier effect",
                "tag":       "inferred",
                "confidence": "high",
            },
            "agglomeration": {
                "condition": "> 6 wt%",
                "effect":    "Clay stacks not fully exfoliated → barrier effect lost, variability increases",
                "tag":       "inferred",
                "confidence": "medium",
            },
            "insufficient": {
                "condition": "< 2 wt%",
                "effect":    "Insufficient clay content → no measurable barrier effect",
                "tag":       "inferred",
                "confidence": "medium",
            },
        },
        "decomp_temp_c": ">600",
        "data_grade":    "HISTORICAL_REFERENCE",
    },
    "Zn_ionic_network": {
        "full_name":   "Zinc ionic crosslinks in acrylic ionomer binder",
        "function":    "network_stabiliser",
        "role":        "Ionic crosslinks between carboxylate groups → controls melt viscosity and char integrity",
        "effects": {
            "low_neutralisation": {
                "condition": "Neutralisation < 35%",
                "effect":    "Weak ionic network → phase separation risk, low viscosity",
                "tag":       "inferred",
                "confidence": "medium",
            },
            "optimal_neutralisation": {
                "condition": "Neutralisation 45–55%",
                "effect":    "Balanced network → stable melt, good char cohesion",
                "tag":       "inferred",
                "confidence": "high",
            },
            "over_neutralisation": {
                "condition": "Neutralisation > 65%",
                "effect":    "Over-crosslinked → brittle, poor application properties",
                "tag":       "inferred",
                "confidence": "low",
            },
        },
        "data_grade": "HISTORICAL_REFERENCE",
        "note":       "Zn²⁺ is ionic reinforcement, NOT oxidation prevention.",
    },
    "APP:PER_ratio": {
        "full_name":   "APP:PER mass ratio",
        "function":    "stoichiometric_balance",
        "role":        "Governs acid:carbon stoichiometry in char formation reaction",
        "known_range": "2.0–4.0 in literature; Fresco dataset: 2.26–6.5",
        "effects": {
            "stability_boundary": {
                "condition": "< 2.26 (unexplored in current dataset)",
                "effect":    "Unknown — priority gap. Hypothesis: stability boundary exists.",
                "tag":       "inferred",
                "confidence": "low",
                "fsctm_stage": "C",
            },
        },
        "data_grade": "PARTIAL",
    },
    "IFR_loading": {
        "full_name":   "Total IFR loading (APP + PER + MEL as % of formulation)",
        "function":    "fire_retardant_concentration",
        "role":        "Higher loading → more char, but above ~50% causes processing problems",
        "effects": {
            "low_loading": {
                "condition": "< 30%",
                "effect":    "Insufficient char formation, low expansion",
                "tag":       "inferred",
                "confidence": "high",
            },
            "optimal": {
                "condition": "35–45%",
                "effect":    "Good balance of fire performance and processability",
                "tag":       "inferred",
                "confidence": "high",
            },
            "high_loading": {
                "condition": "> 50%",
                "effect":    "Process instability, high viscosity, film defects",
                "tag":       "inferred",
                "confidence": "medium",
            },
        },
        "data_grade": "HISTORICAL_REFERENCE",
    },
}


INTERACTION_MAP = [
    {
        "components": ["APP", "PER"],
        "interaction": "acid_esterification",
        "description": "APP acid reacts with PER polyol → phosphate ester intermediate → char precursor",
        "temperature_onset_c": 200,
        "tag": "HISTORICAL_REFERENCE",
    },
    {
        "components": ["MEL", "APP"],
        "interaction": "synergistic_decomposition",
        "description": "MEL and APP decompose in complementary temperature windows → coupled expansion",
        "temperature_onset_c": 250,
        "tag": "HISTORICAL_REFERENCE",
    },
    {
        "components": ["Nanoclay", "binder"],
        "interaction": "dispersion_dependency",
        "description": "Nanoclay exfoliation depends on binder polarity; acrylic ionomer moderately compatible",
        "tag": "inferred",
        "confidence": "medium",
    },
    {
        "components": ["Zn_ionic_network", "APP"],
        "interaction": "ionic_disruption_risk",
        "description": "Phosphate from APP can compete with Zn²⁺ crosslinks at high temp → network disruption",
        "temperature_onset_c": 180,
        "tag": "inferred",
        "confidence": "low",
    },
]


def get_mechanism(component: str) -> Optional[dict]:
    return MECHANISM_GRAPH.get(component)


def get_interactions(component: str) -> list:
    return [
        i for i in INTERACTION_MAP
        if component in i["components"]
    ]


def enrich_contradiction(contradiction: str, involved_components: list) -> dict:
    mechanisms = {}
    interactions = []
    cited_sources = []

    for comp in involved_components:
        mech = get_mechanism(comp)
        if mech:
            mechanisms[comp] = {
                "function":   mech.get("function"),
                "role":       mech.get("role"),
                "effects":    mech.get("effects"),
                "data_grade": mech.get("data_grade"),
            }
            cited_sources.append(comp)

        for interaction in get_interactions(comp):
            if interaction not in interactions:
                interactions.append(interaction)

    return {
        "contradiction":       contradiction,
        "components_queried":  involved_components,
        "mechanisms_found":    mechanisms,
        "interactions_found":  interactions,
        "n_mechanisms":        len(mechanisms),
        "n_interactions":      len(interactions),
        "data_source":         "DOCUMENT_RAG",
        "tag":                 "retrieved",
        "all_inferred_tagged": True,
    }


def suggest_mechanism_candidate(
    contradiction: str,
    observed_signatures: list,
    components: list,
) -> dict:
    enriched = enrich_contradiction(contradiction, components)
    candidates = []

    for comp, mech in enriched["mechanisms_found"].items():
        for effect_key, effect in (mech.get("effects") or {}).items():
            for sig in observed_signatures:
                if sig in effect.get("effect", "").lower():
                    candidates.append({
                        "component":  comp,
                        "effect_key": effect_key,
                        "mechanism":  effect["effect"],
                        "confidence": effect.get("confidence", "low"),
                        "condition":  effect.get("condition", ""),
                        "tag":        "inferred",
                        "fsctm_stage": "N",
                    })

    conf_order = {"high": 0, "medium": 1, "low": 2}
    candidates.sort(key=lambda x: conf_order.get(x["confidence"], 3))

    return {
        "contradiction":    contradiction,
        "n_candidates":     len(candidates),
        "top_candidate":    candidates[0] if candidates else None,
        "all_candidates":   candidates[:3],
        "data_source":      "DOCUMENT_RAG",
        "tag":              "inferred",
        "fsctm_stage":      "N" if candidates else "C",
    }


def list_known_components() -> list:
    return list(MECHANISM_GRAPH.keys())


def run_tests():
    print("=" * 60)
    print("Week 5 — Domain Mechanism Priors Tests")
    print("=" * 60)
    passed = failed = 0

    for key, mech in MECHANISM_GRAPH.items():
        ok = all(f in mech for f in ["function", "role", "data_grade"])
        if ok: passed += 1
        else:
            failed += 1
            print(f"❌ {key} missing required fields")

    for key, mech in MECHANISM_GRAPH.items():
        for ek, effect in (mech.get("effects") or {}).items():
            tag = effect.get("tag")
            assert tag in ("inferred", "HISTORICAL_REFERENCE"), \
                f"FAIL: {key}.{ek} has invalid tag '{tag}'"
    print("✅ All mechanism effects tagged correctly")
    passed += 1

    mel = get_mechanism("MEL")
    ok_mel = "blowing" in mel.get("function", "").lower()
    print(f"{'✅' if ok_mel else '❌'} MEL classified as blowing_agent (not char_stabiliser)")
    if ok_mel: passed += 1
    else: failed += 1

    result = enrich_contradiction(
        "APP:PER below 2.26 causes unknown failure pattern",
        ["APP", "PER", "APP:PER_ratio"]
    )
    ok_enrich = result["n_mechanisms"] == 3
    print(f"{'✅' if ok_enrich else '❌'} Contradiction enrichment: "
          f"{result['n_mechanisms']} mechanisms found")
    if ok_enrich: passed += 1
    else: failed += 1

    sug = suggest_mechanism_candidate(
        "Low expansion below APP:PER=2.26",
        ["insufficient acid", "incomplete carbonisation", "low expansion"],
        ["APP", "PER"]
    )
    ok_sug = sug["n_candidates"] > 0 and sug["tag"] == "inferred"
    print(f"{'✅' if ok_sug else '❌'} Mechanism suggestion: "
          f"{sug['n_candidates']} candidates, tag={sug['tag']}")
    if ok_sug: passed += 1
    else: failed += 1

    print(f"\n{'✅' if failed == 0 else '❌'} {passed}/{passed+failed} passed")
    return passed, failed


if __name__ == "__main__":
    run_tests()
