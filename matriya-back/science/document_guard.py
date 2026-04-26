"""
MATRIYA v0.1 — Document Guard
==============================
Prevents cross-domain contamination in RAG responses.


Three problems solved:
1. Index separation: lab data / MATRIYA docs / unrelated docs
2. Domain metric guardrails: blocks F1, MCC, accuracy in experiment design
3. Structured output enforcement: experiment responses must match schema

No LLM decides what is allowed. All rules are deterministic code.
"""

import re
from pathlib import Path

from typing import Optional
from datetime import datetime, timezone


# ─────────────────────────────────────────────────────────
# DOMAIN TAXONOMY
# ─────────────────────────────────────────────────────────
class DocumentDomain:
    LAB_FORMULATION  = "LAB_FORMULATION"   # Excel, experiments, formulas
    MATRIYA_METHOD   = "MATRIYA_METHOD"    # MATRIYA docs, kernel, protocols
    UNRELATED        = "UNRELATED"         # anything else — blocked from lab queries
    UNKNOWN          = "UNKNOWN"           # not yet classified


# ─────────────────────────────────────────────────────────
# KEYWORD SIGNATURES PER DOMAIN
# ─────────────────────────────────────────────────────────
LAB_KEYWORDS = [
    "formulation", "expansion_ratio", "char", "app", "per", "mel",
    "nanoclay", "cloisite", "intumescent", "IFR", "adhesion",
    "viscosity", "coating", "binder", "acrylic", "DOE",
    "fresco", "experiment", "ניסוי", "פורמולה", "ציפוי",
    "fire retardant", "fire protection", "corrosion",
]

MATRIYA_KEYWORDS = [
    "matriya", "FSCTM", "kernel", "breakdown", "contradiction",
    "structural validity", "decision gate", "RAG", "agent",
    "handover", "developer", "scope", "sprint", "supabase",
    "railway", "vercel", "API", "endpoint",
]

# Metric terms that MUST NOT appear in formulation experiment outputs
FORBIDDEN_METRICS = {
    # ML classification metrics — belong to computer science, not coatings
    "f1_score":              ["f1-score", "f1 score", "f1score", "f1"],
    "mcc":                   ["mcc", "matthews correlation", "matthews corr"],
    "accuracy":              ["classification accuracy", "model accuracy", "test accuracy",
                              "validation accuracy", "accuracy score"],
    "precision_recall":      ["precision", "recall", "confusion matrix", "roc auc",
                              "roc curve", "auc score"],
    "cross_validation":      ["cross-validation", "cross validation", "k-fold", "kfold"],
    "ml_performance":        ["overfitting", "underfitting", "train/test split",
                              "hyperparameter", "epoch", "batch size", "learning rate"],
    "har_specific":          ["human activity recognition", "accelerometer", "gyroscope",
                              "sensor fusion", "HAR", "activity classification"],
}

# Flatten for quick lookup
ALL_FORBIDDEN_METRIC_TERMS = set()
for terms in FORBIDDEN_METRICS.values():
    ALL_FORBIDDEN_METRIC_TERMS.update(terms)


# ─────────────────────────────────────────────────────────
# DOCUMENT CLASSIFIER
# ─────────────────────────────────────────────────────────
def classify_document(filename: str, content_preview: str = "") -> dict:
    """
    Classify a document into a domain.
    Uses filename + content preview. Deterministic.

    Returns:
        {
          "domain": str,
          "confidence": "HIGH"|"MEDIUM"|"LOW",
          "reason": str,
          "allowed_in_lab_queries": bool
        }
    """
    fname = filename.lower()
    preview = content_preview.lower()
    combined = fname + " " + preview

    # Hard rules on filename
    if any(x in fname for x in ["formulation", "intumescent", "corrosion",
                                 "experiment", "lab", "int-tfx", "ifr",
                                 "fresco", "barnacle", "bio-001", "corr-001"]):
        return _classification(DocumentDomain.LAB_FORMULATION, "HIGH",
                               f"Filename contains lab keyword: {fname}",
                               allowed=True)

    if any(x in fname for x in ["matriya", "kernel", "handover", "developer",
                                 "fsctm", "scope", "rachel", "report.txt"]):
        return _classification(DocumentDomain.MATRIYA_METHOD, "HIGH",
                               f"Filename contains MATRIYA keyword: {fname}",
                               allowed=False)

    # Content-based classification
    lab_hits   = sum(1 for kw in LAB_KEYWORDS if kw.lower() in combined)
    matr_hits  = sum(1 for kw in MATRIYA_KEYWORDS if kw.lower() in combined)

    # Detect ML/classification paper signatures
    ml_hits = sum(1 for term in ALL_FORBIDDEN_METRIC_TERMS if term in combined)

    if ml_hits >= 3:
        return _classification(DocumentDomain.UNRELATED, "HIGH",
                               f"Contains {ml_hits} ML/classification metric terms",
                               allowed=False)

    if lab_hits >= 3 and lab_hits > matr_hits:
        conf = "HIGH" if lab_hits >= 5 else "MEDIUM"
        return _classification(DocumentDomain.LAB_FORMULATION, conf,
                               f"Content: {lab_hits} lab keywords", allowed=True)

    if matr_hits >= 3:
        return _classification(DocumentDomain.MATRIYA_METHOD, "MEDIUM",
                               f"Content: {matr_hits} MATRIYA keywords", allowed=False)

    return _classification(DocumentDomain.UNKNOWN, "LOW",
                           "No strong domain signal — manual review required",
                           allowed=False)


def _classification(domain, confidence, reason, allowed):
    return {
        "domain":               domain,
        "confidence":           confidence,
        "reason":               reason,
        "allowed_in_lab_queries": allowed,
        "timestamp":            datetime.now(timezone.utc).isoformat(),
    }


# ─────────────────────────────────────────────────────────
# INDEX SEPARATION
# ─────────────────────────────────────────────────────────
class DocumentIndex:
    """
    Separated index: LAB_FORMULATION | MATRIYA_METHOD | UNRELATED
    Each query only searches the appropriate index.
    """

    def __init__(self):
        self._indexes = {
            DocumentDomain.LAB_FORMULATION: [],
            DocumentDomain.MATRIYA_METHOD:  [],
            DocumentDomain.UNRELATED:       [],
            DocumentDomain.UNKNOWN:         [],
        }

    def add_document(self, doc_id: str, filename: str,
                     content_preview: str = "") -> dict:
        """Classify and route document to correct index."""
        classification = classify_document(filename, content_preview)
        domain = classification["domain"]
        entry = {
            "doc_id":   doc_id,
            "filename": filename,
            "domain":   domain,
            "classification": classification,
        }
        self._indexes[domain].append(entry)
        return {
            "routed_to":  domain,
            "doc_id":     doc_id,
            "filename":   filename,
            "allowed_in_lab_queries": classification["allowed_in_lab_queries"],
        }

    def get_allowed_ids(self, query_domain: str = DocumentDomain.LAB_FORMULATION) -> list:
        """
        Return doc_ids allowed for a given query domain.
        Lab queries ONLY search LAB_FORMULATION index.
        """
        return [
            d["doc_id"]
            for d in self._indexes.get(query_domain, [])
        ]

    def get_blocked_ids(self, query_domain: str = DocumentDomain.LAB_FORMULATION) -> list:
        """Return all doc_ids NOT allowed for this query domain."""
        allowed = set(self.get_allowed_ids(query_domain))
        all_ids = [
            d["doc_id"]
            for docs in self._indexes.values()
            for d in docs
        ]
        return [id_ for id_ in all_ids if id_ not in allowed]

    def report(self) -> dict:
        return {
            "index_sizes": {
                k: len(v) for k, v in self._indexes.items()
            },
            "documents": {
                k: [{"doc_id": d["doc_id"], "filename": d["filename"]}
                    for d in v]
                for k, v in self._indexes.items()
            }
        }


# ─────────────────────────────────────────────────────────
# DOMAIN METRIC GUARDRAIL
# ─────────────────────────────────────────────────────────
def check_metric_contamination(text: str) -> dict:
    """
    Scan text for forbidden ML/classification metrics.
    Returns violations found. If any → response is blocked.
    """
    text_lower = text.lower()
    violations = []

    for category, terms in FORBIDDEN_METRICS.items():
        found = [t for t in terms if t in text_lower]
        if found:
            violations.append({
                "category":    category,
                "terms_found": found,
                "severity":    "HIGH" if category in ("f1_score", "mcc", "accuracy") else "MEDIUM",
            })

    return {
        "contaminated":      len(violations) > 0,
        "violations":        violations,
        "n_violations":      len(violations),
        "action":            "BLOCK" if violations else "ALLOW",
        "forbidden_categories": list(FORBIDDEN_METRICS.keys()),
    }


def sanitize_response(text: str) -> dict:
    """
    Remove forbidden metric terms from a response.
    Returns sanitized text + list of what was removed.
    """
    sanitized = text
    removed = []

    for category, terms in FORBIDDEN_METRICS.items():
        for term in terms:
            pattern = re.compile(re.escape(term), re.IGNORECASE)
            if pattern.search(sanitized):
                sanitized = pattern.sub("[METRIC_BLOCKED]", sanitized)
                removed.append({"term": term, "category": category})

    # Remove sentences that are mostly about ML
    sentences = sanitized.split(". ")
    clean_sentences = []
    for sent in sentences:
        if "[METRIC_BLOCKED]" in sent:
            clean_sentences.append("[SENTENCE_REMOVED: irrelevant domain metric]")
        else:
            clean_sentences.append(sent)
    sanitized = ". ".join(clean_sentences)

    return {
        "original_length": len(text),
        "sanitized_text":  sanitized,
        "terms_removed":   removed,
        "n_removed":       len(removed),
        "action":          "SANITIZED" if removed else "CLEAN",
    }


# ─────────────────────────────────────────────────────────
# EXPERIMENT OUTPUT VALIDATOR
# ─────────────────────────────────────────────────────────

# Required fields in any experiment design output
REQUIRED_EXPERIMENT_FIELDS = [
    "name",
    "fixed_params",
    "sweep_params",
    "response_vars",
    "observed_sigs",
    "decision_inputs",
]

# Response variables ALLOWED in intumescent coating experiments
ALLOWED_RESPONSE_VARS = {
    "expansion_ratio",
    "char_quality",
    "char_height_mm",
    "char_cohesion_score",
    "residue_integrity_score",
    "adhesion",
    "viscosity",
    "sedimentation_24h",
    "phase_separation_visual",
    "repeatability_cv",
    "TGA_onset_temp",
    "TGA_residue_pct",
    "LOI",
    "heat_release_rate",
    "smoke_density",
}

# Response variables FORBIDDEN in intumescent experiments
FORBIDDEN_RESPONSE_VARS = {
    "f1_score", "mcc", "accuracy", "precision", "recall",
    "auc", "roc", "confusion_matrix", "classification_report",
    "model_performance", "prediction_accuracy",
}


def validate_experiment_output(experiment: dict) -> dict:
    """
    Validate that an experiment design conforms to the schema.
    Blocks any output with forbidden metrics or missing required fields.
    """
    errors   = []
    warnings = []
    blocked_fields = []

    # Required fields check
    for field in REQUIRED_EXPERIMENT_FIELDS:
        if field not in experiment:
            errors.append(f"Missing required field: '{field}'")

    # Response variable validation
    response_vars = experiment.get("response_vars", [])
    for var in response_vars:
        var_lower = var.lower().replace("-", "_").replace(" ", "_")
        if var_lower in FORBIDDEN_RESPONSE_VARS:
            errors.append(f"FORBIDDEN response variable: '{var}' "
                          f"(ML metric not applicable to coatings)")
            blocked_fields.append(var)
        elif var_lower not in ALLOWED_RESPONSE_VARS:
            warnings.append(f"Unknown response variable: '{var}' "
                            f"— verify it is a physical coating measurement")

    # Full text scan of the experiment dict
    experiment_text = str(experiment).lower()
    contamination = check_metric_contamination(experiment_text)
    if contamination["contaminated"]:
        for v in contamination["violations"]:
            errors.append(f"Forbidden metric in experiment text: "
                          f"{v['terms_found']} ({v['category']})")

    valid = len(errors) == 0
    return {
        "valid":          valid,
        "action":         "ALLOW" if valid else "BLOCK",
        "errors":         errors,
        "warnings":       warnings,
        "blocked_fields": blocked_fields,
        "n_errors":       len(errors),
        "n_warnings":     len(warnings),
    }


# ─────────────────────────────────────────────────────────
# QUERY GUARD: wraps any RAG query with domain enforcement
# ─────────────────────────────────────────────────────────
def guard_query(
    query:        str,
    doc_index:    DocumentIndex,
    query_domain: str = DocumentDomain.LAB_FORMULATION,
) -> dict:
    """
    Pre-query guard: returns allowed_doc_ids and blocked_doc_ids.
    The RAG system MUST only search allowed_doc_ids.
    """
    allowed  = doc_index.get_allowed_ids(query_domain)
    blocked  = doc_index.get_blocked_ids(query_domain)

    return {
        "query":           query,
        "query_domain":    query_domain,
        "allowed_doc_ids": allowed,
        "blocked_doc_ids": blocked,
        "n_allowed":       len(allowed),
        "n_blocked":       len(blocked),
        "action":          "PROCEED" if allowed else "BLOCK_NO_DOCUMENTS",
        "timestamp":       datetime.now(timezone.utc).isoformat(),
    }


def guard_response(
    response_text:  str,
    experiment:     Optional[dict] = None,
) -> dict:
    """
    Post-response guard: checks for metric contamination.
    If experiment dict provided, validates schema too.
    Returns {action: ALLOW|BLOCK|SANITIZE, ...}
    """
    contamination = check_metric_contamination(response_text)
    experiment_validation = None

    if experiment:
        experiment_validation = validate_experiment_output(experiment)

    exp_blocked = (
        experiment_validation and
        experiment_validation.get("action") == "BLOCK"
    )

    if contamination["contaminated"] or exp_blocked:
        sanitized = sanitize_response(response_text)
        return {
            "action":                 "SANITIZE" if not exp_blocked else "BLOCK",
            "contamination":          contamination,
            "experiment_validation":  experiment_validation,
            "sanitized_response":     sanitized["sanitized_text"] if not exp_blocked else None,
            "terms_removed":          sanitized["terms_removed"],
            "reason":                 (
                "Experiment schema violation" if exp_blocked
                else "Forbidden metric terms found and removed"
            ),
        }

    return {
        "action":                "ALLOW",
        "contamination":         contamination,
        "experiment_validation": experiment_validation,
        "sanitized_response":    None,
    }


# ─────────────────────────────────────────────────────────
# TESTS
# ─────────────────────────────────────────────────────────
def run_tests():
    print("=" * 60)
    print("Document Guard — Tests")
    print("=" * 60)
    passed = failed = 0

    # Test 1: Final Project Report classified as UNRELATED
    c = classify_document(
        "Final Project Report.pdf",
        "human activity recognition f1-score mcc confusion matrix classification accuracy"
    )
    ok = c["domain"] == DocumentDomain.UNRELATED and not c["allowed_in_lab_queries"]
    print(f"{'OK' if ok else 'FAIL'} Final Project Report → UNRELATED, blocked")
    if ok: passed += 1
    else: failed += 1

    # Test 2: Formulation Excel classified as LAB_FORMULATION
    c2 = classify_document("INT-TFX_Formulation_Analysis.xlsx")
    ok2 = c2["domain"] == DocumentDomain.LAB_FORMULATION and c2["allowed_in_lab_queries"]
    print(f"{'OK' if ok2 else 'FAIL'} INT-TFX xlsx → LAB_FORMULATION, allowed")
    if ok2: passed += 1
    else: failed += 1

    # Test 3: MATRIYA handover classified correctly
    c3 = classify_document("MATRIYA_Developer_Handover.docx")
    ok3 = c3["domain"] == DocumentDomain.MATRIYA_METHOD
    print(f"{'OK' if ok3 else 'FAIL'} Developer Handover → MATRIYA_METHOD")
    if ok3: passed += 1
    else: failed += 1

    # Test 4: Index separation — unrelated doc blocked from lab query
    idx = DocumentIndex()
    idx.add_document("doc-001", "INT-TFX_Formulation_Analysis.xlsx")
    idx.add_document("doc-002", "Final Project Report.pdf",
                     "f1-score mcc classification accuracy human activity")
    idx.add_document("doc-003", "MATRIYA_Developer_Handover.docx")

    allowed = idx.get_allowed_ids(DocumentDomain.LAB_FORMULATION)
    blocked = idx.get_blocked_ids(DocumentDomain.LAB_FORMULATION)
    ok4 = "doc-001" in allowed and "doc-002" in blocked and "doc-003" in blocked
    print(f"{'OK' if ok4 else 'FAIL'} Index separation: "
          f"allowed={allowed}, blocked={blocked}")
    if ok4: passed += 1
    else: failed += 1

    # Test 5: F1-score contamination detected
    bad_response = (
        "The experiment should measure F1-score and MCC. "
        "Classification accuracy should be tracked. "
        "Use cross-validation to assess model performance."
    )
    result = check_metric_contamination(bad_response)
    ok5 = result["contaminated"] and result["action"] == "BLOCK"
    print(f"{'OK' if ok5 else 'FAIL'} Contamination detection: "
          f"{result['n_violations']} violations found")
    if ok5: passed += 1
    else: failed += 1

    # Test 6: Clean coating response not blocked
    good_response = (
        "Measure expansion_ratio and char_quality. "
        "Record viscosity and sedimentation after 24h. "
        "Assess char cohesion and residue integrity."
    )
    result2 = check_metric_contamination(good_response)
    ok6 = not result2["contaminated"] and result2["action"] == "ALLOW"
    print(f"{'OK' if ok6 else 'FAIL'} Clean coating response → ALLOW")
    if ok6: passed += 1
    else: failed += 1

    # Test 7: Experiment with F1-score blocked
    bad_exp = {
        "name":          "Boundary test",
        "fixed_params":  {"IFR": 42},
        "sweep_params":  {"APP:PER": [2.0, 1.5, 1.0]},
        "response_vars": ["expansion_ratio", "f1_score", "mcc"],
        "observed_sigs": ["low_expansion"],
        "decision_inputs": {"rule": "weighted"},
    }
    val = validate_experiment_output(bad_exp)
    ok7 = val["action"] == "BLOCK" and len(val["blocked_fields"]) == 2
    print(f"{'OK' if ok7 else 'FAIL'} Experiment with f1_score/mcc → BLOCK "
          f"({val['blocked_fields']})")
    if ok7: passed += 1
    else: failed += 1

    # Test 8: Valid experiment → ALLOW
    good_exp = {
        "name":          "APP:PER Boundary Test",
        "fixed_params":  {"IFR": 42},
        "sweep_params":  {"APP:PER": [2.26, 2.0, 1.5, 1.0]},
        "response_vars": ["expansion_ratio", "char_quality", "viscosity"],
        "observed_sigs": ["low_expansion", "cracked_char"],
        "decision_inputs": {"rule": "weighted_boundary_score"},
    }
    val2 = validate_experiment_output(good_exp)
    ok8 = val2["action"] == "ALLOW"
    print(f"{'OK' if ok8 else 'FAIL'} Valid coating experiment → ALLOW")
    if ok8: passed += 1
    else: failed += 1

    # Test 9: Full response guard pipeline
    guard = guard_response(bad_response)
    ok9 = (guard["action"] == "SANITIZE" and
           guard.get("sanitized_response") is not None and
           "SENTENCE_REMOVED" in guard["sanitized_response"])
    print(f"{'OK' if ok9 else 'FAIL'} Response guard: sanitized contaminated response")
    if ok9: passed += 1
    else: failed += 1

    print(f"\n{'OK' if failed == 0 else 'FAIL'} {passed}/{passed+failed} passed")
    return passed, failed


if __name__ == "__main__":
    run_tests()
