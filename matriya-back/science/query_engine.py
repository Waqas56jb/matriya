import re
import pandas as pd
from typing import Optional, Dict, Any, Literal, Tuple

# ============================================================
# INTENT CLASSIFICATION
# ============================================================

AGG_KEYWORDS = {
    "max": ["highest", "max", "maximum", "largest", "top", "best"],
    "min": ["lowest", "min", "minimum", "smallest", "worst"],
}

# Change 3: regex patterns replace flat SORT_KEYWORDS list
# Include "<context> by <column>" (e.g. "experiments by adhesion") which does NOT
# start with the word "by" and does not use "order by" / "sort by".
SORT_PATTERNS = [
    r'^\s*by\s+\w+',
    r'sort(?:ed)?\s+by\s+\w+',
    r'order\s+by\s+\w+',
    r'rank(?:ed)?\s+by\s+\w+',
    r'(?:\b\w+\s+)+by\s+\w+',
]

CONDITION_KEYWORDS = [">", "<", "=", ">=", "<=", "!=", "where", "and", "or"]


def classify_intent(query: str) -> Literal["FILTER", "AGGREGATION", "SORT", "INVALID"]:
    q = query.lower().strip()

    if re.search(r'[<>=]\s*$', q):
        return "INVALID"

    # Change 4: word boundaries on all AGG keyword checks
    all_agg_kws = AGG_KEYWORDS["max"] + AGG_KEYWORDS["min"]
    has_agg      = any(re.search(r'\b' + kw + r'\b', q) for kw in all_agg_kws)
    # Change 3: regex-based sort detection
    has_sort     = any(re.search(p, q, re.IGNORECASE) for p in SORT_PATTERNS)
    has_condition = any(kw in q for kw in CONDITION_KEYWORDS)

    # "where …" is a filter; do not treat as pure SORT (even if " by " appears in grammar)
    if (has_sort and not has_agg) and "where" not in q:
        return "SORT"

    if has_agg:
        return "AGGREGATION"

    if has_condition:
        return "FILTER"

    return "INVALID"


# ============================================================
# CHANGE 2: normalize_condition
# ============================================================

def normalize_condition(cond: str) -> str:
    """
    Normalise a condition string before passing it to df.query().

    Rules:
      1. Replace bare '=' with '==' (but leave >=, <=, != untouched).
      2. Quote bare identifier values on the RHS of == so pandas treats
         them as strings, not column references.
         e.g.  binder == K52  →  binder == "K52"
    """
    cond = re.sub(r'(?<![<>!])=(?!=)', '==', cond)
    cond = re.sub(r'(\b\w+\b\s*==\s*)([A-Za-z_]\w*)', r'\1"\2"', cond)
    return cond.strip()


# ============================================================
# QUERY PARSING HELPERS
# ============================================================

def detect_aggregation(query: str) -> Optional[str]:
    q = query.lower().strip()
    # Change 4: word boundaries
    for agg, keywords in AGG_KEYWORDS.items():
        if any(re.search(r'\b' + kw + r'\b', q) for kw in keywords):
            return agg
    return None


_COLUMN_MAP = {
    "expansion_ratio": ["expansion_ratio", "expansion", "expand", "swelling"],
    "viscosity":       ["viscosity", "thickness"],
    "adhesion":        ["adhesion", "bond", "bonding"],
}

_AGG_WORDS = ["lowest", "highest", "minimum", "maximum", "min", "max",
              "smallest", "largest", "worst", "best"]


def extract_target_column(query: str) -> Optional[str]:
    """
    Detect the aggregation target column by looking ONLY at the phrase
    immediately after the aggregation keyword.

    Example:
      "highest viscosity where expansion_ratio > 15"
       → searches phrase after "highest" → "viscosity ..."  → returns "viscosity"
       NOT expansion_ratio (that sits in the filter condition, not after the keyword).
    """
    q = query.lower()

    for agg in _AGG_WORDS:
        match = re.search(rf'\b{agg}\s+([a-zA-Z_][a-zA-Z0-9_\s]*)', q)
        if match:
            phrase = match.group(1)
            for col, keywords in _COLUMN_MAP.items():
                if any(k in phrase for k in keywords):
                    return col

    return None


def extract_where_condition(query: str) -> tuple[str, Optional[str]]:
    """Split into (base_query, where_clause) if 'where' exists."""
    parts = re.split(r'\bwhere\b', query, flags=re.IGNORECASE)
    if len(parts) == 1:
        return parts[0].strip(), None
    return parts[0].strip(), parts[1].strip()


# ============================================================
# HANDLERS
# ============================================================

def handle_aggregation(filtered: pd.DataFrame, query: str) -> Dict[str, Any]:
    if filtered is None or filtered.empty:
        return {"error": "NO_RESULTS", "reason": "no matching rows"}

    agg = detect_aggregation(query)
    if agg is None:
        return {"error": "INVALID_QUERY", "reason": "unknown aggregation"}

    col = extract_target_column(query)
    if col is None:
        return {"error": "INVALID_QUERY", "reason": "unknown target column"}

    if col not in filtered.columns:
        return {"error": "INVALID_QUERY", "reason": f"missing column: {col}"}

    numeric_series = pd.to_numeric(filtered[col], errors="coerce")
    valid = filtered.loc[numeric_series.notna()].copy()

    if valid.empty:
        return {"error": "NO_RESULTS", "reason": f"column '{col}' has no valid numeric values"}

    if agg == "max":
        idx = valid[col].astype(float).idxmax()
        row = valid.loc[idx].to_dict()
        row["_aggregation"]   = "max"
        row["_target_column"] = col
        return row

    if agg == "min":
        idx = valid[col].astype(float).idxmin()
        row = valid.loc[idx].to_dict()
        row["_aggregation"]   = "min"
        row["_target_column"] = col
        return row

    return {"error": "INVALID_QUERY", "reason": f"unsupported aggregation: {agg}"}


def handle_filter(df: pd.DataFrame, query: str) -> Dict[str, Any]:
    base_q, where = extract_where_condition(query)

    if where:
        try:
            # Change 2: normalise before querying
            filtered = df.query(normalize_condition(where))
        except Exception as e:
            # Change 1: explicit error — no silent fallback
            return {"error": "INVALID_QUERY", "reason": f"bad condition: {e}"}
    else:
        try:
            # Change 2: normalise before querying
            filtered = df.query(normalize_condition(query))
        except Exception as e:
            # Change 1: explicit error — no silent fallback
            return {"error": "INVALID_QUERY", "reason": str(e)}

    if filtered.empty:
        return {"error": "NO_RESULTS", "reason": "no rows match condition"}

    return {"results": filtered.to_dict("records"), "count": len(filtered)}


def extract_column_after_by(query: str) -> Optional[str]:
    match = re.search(r'\bby\s+([a-zA-Z_][a-zA-Z0-9_]*)', query, re.IGNORECASE)
    return match.group(1) if match else None


def handle_sort(df: pd.DataFrame, query: str) -> Dict[str, Any]:
    if df is None or len(df) == 0:
        return {"error": "NO_RESULTS", "reason": "no rows in dataset"}

    col = extract_column_after_by(query)

    if col is None:
        return {"error": "INVALID_QUERY", "reason": "no column specified"}

    if col not in df.columns:
        return {"error": "INVALID_QUERY", "reason": f"unknown column: {col}"}

    # Change 4: word boundaries for descending/highest/top check
    ascending = not any(
        re.search(r'\b' + w + r'\b', query.lower())
        for w in ["descending", "highest", "top"]
    )

    try:
        # Numeric columns: sort on coerced values so string "92" / float mix works
        series = df[col]
        if pd.api.types.is_numeric_dtype(series):
            key = series
        else:
            key = pd.to_numeric(series, errors="coerce")
        ordered = df.assign(_sort_key=key).sort_values(
            by="_sort_key", ascending=ascending, na_position="last"
        ).drop(columns=["_sort_key"])
    except Exception as e:
        return {"error": "INVALID_QUERY", "reason": f"sort failed: {e}"}

    return {
        "decision":  "MATCHES_FOUND",
        "quality":   "COMPLETE",
        "results":   ordered.to_dict("records"),
        "count":     len(ordered),
    }


def apply_ranking(df: pd.DataFrame, query: str, n: int = 3) -> pd.DataFrame:
    col = extract_column_after_by(query)

    if col is None or col not in df.columns:
        raise ValueError("Cannot rank: column not found in query")

    numeric_series = pd.to_numeric(df[col], errors="coerce")
    valid = df.loc[numeric_series.notna()].copy()
    valid[col] = numeric_series.loc[numeric_series.notna()].astype(float)

    if valid.empty:
        return valid

    # Change 4: word boundaries
    if any(re.search(r'\b' + w + r'\b', query.lower()) for w in ["top", "highest"]):
        return valid.nlargest(n, col)

    return valid.nsmallest(n, col)


# ============================================================
# COMPOSITE QUERY ORCHESTRATION
# ============================================================

def extract_top_n_by_clause(query: str) -> Tuple[Optional[int], Optional[str]]:
    """
    Extract pattern: among top 3 by viscosity
    Returns: (3, "viscosity")
    """
    match = re.search(
        r"\bamong\s+top\s+(\d+)\s+by\s+([a-zA-Z_]+)",
        query,
        re.IGNORECASE,
    )
    if not match:
        print("[DEBUG] extract_top_n_by_clause: NO MATCH", flush=True)
        return None, None
    n = int(match.group(1))
    col = match.group(2)
    print(f"[DEBUG] extracted n={n}, rank_col={col}", flush=True)
    return n, col


def extract_pre_among_segment(query: str) -> str:
    """
    From: 'lowest expansion_ratio among top 3 by viscosity'
    Returns: 'lowest expansion_ratio'
    """
    parts = re.split(r'\bamong\s+top\b', query, flags=re.IGNORECASE)
    return parts[0].strip()


def detect_final_aggregation_target(query: str) -> Optional[str]:
    return extract_target_column(extract_pre_among_segment(query))


def detect_final_aggregation(query: str) -> Optional[str]:
    return detect_aggregation(extract_pre_among_segment(query))


def is_composite_rank_then_aggregate_query(query: str) -> bool:
    """
    Detect: lowest expansion_ratio among top 3 by viscosity where adhesion > 90
    """
    base_q, _ = extract_where_condition(query)
    has_top_n_by = bool(re.search(
        r'\bamong\s+top\s+\d+\s+by\s+[a-zA-Z_][a-zA-Z0-9_]*',
        base_q, re.IGNORECASE
    ))
    return (
        has_top_n_by
        and detect_final_aggregation(base_q) is not None
        and detect_final_aggregation_target(base_q) is not None
    )


def handle_rank_then_aggregate(
    df: pd.DataFrame, query: str, debug: bool = False
) -> Dict[str, Any]:
    """
    Strict execution order:
      1) FILTER   — apply where clause
      2) RANK     — top N by <rank_col>
      3) AGGREGATE — lowest/highest <target_col> within ranked subset
    """
    if debug:
        print(f"[DEBUG] handle_rank_then_aggregate | query={query!r}", flush=True)

    base_q, where = extract_where_condition(query)

    # Step 1: FILTER
    if where:
        try:
            # Change 2: normalise before querying
            filtered = df.query(normalize_condition(where))
        except Exception as e:
            # Change 1: explicit error
            return {"error": "INVALID_QUERY", "reason": f"bad condition: {e}"}
    else:
        filtered = df

    if debug:
        print(f"[DEBUG] after filter: rows={len(filtered)}", flush=True)

    if filtered.empty:
        return {"error": "NO_RESULTS", "reason": "no rows after filtering"}

    # Step 2: RANK
    n, rank_col = extract_top_n_by_clause(base_q)
    if n is None or rank_col is None:
        return {"error": "INVALID_QUERY", "reason": "missing 'among top N by <column>' clause"}

    if rank_col not in filtered.columns:
        return {"error": "INVALID_QUERY", "reason": f"unknown ranking column: {rank_col}"}

    try:
        ranked = apply_ranking(filtered, f"top {n} by {rank_col}", n=n)
    except ValueError as e:
        return {"error": "INVALID_QUERY", "reason": str(e)}

    if debug:
        print(f"[DEBUG] after rank: n={n} by={rank_col!r} rows={len(ranked)}", flush=True)

    if ranked is None or ranked.empty:
        return {"error": "NO_RESULTS", "reason": f"ranking column '{rank_col}' has no valid numeric values"}

    # Step 3: FINAL AGGREGATION on ranked subset only
    result = handle_aggregation(ranked, extract_pre_among_segment(base_q))

    if "error" in result:
        return result

    result["_ranking_column"] = rank_col
    result["_ranking_size"]   = n
    result["_pipeline"]       = "filter -> ranking -> aggregation"
    return result


def is_composite_query(query: str) -> bool:
    """Alias: composite rank-then-aggregate pattern (must route before all other intent)."""
    return is_composite_rank_then_aggregate_query(query)


def execute_composite_query(
    df: pd.DataFrame, query: str, debug: bool = False
) -> Dict[str, Any]:
    """Alias: filter → rank (top N by) → final aggregation on ranked rows."""
    return handle_rank_then_aggregate(df, query, debug=debug)


# ============================================================
# MAIN ENTRY POINT
# ============================================================

def answer_query(
    df: pd.DataFrame, query: str, debug: bool = False
) -> Dict[str, Any]:
    print(f"[DEBUG] ENTER answer_query | query={query}", flush=True)

    # שלב 1 — composite must run first
    if is_composite_rank_then_aggregate_query(query):
        print("[DEBUG] ROUTE = COMPOSITE", flush=True)
        return handle_rank_then_aggregate(df, query, debug=debug)

    # שלב 2 — standard intent
    intent = classify_intent(query)
    print(f"[DEBUG] ROUTE = STANDARD | intent={intent}", flush=True)

    if intent == "INVALID":
        return {"error": "INVALID_QUERY", "message": "Query not recognized"}

    if intent == "FILTER":
        return handle_filter(df, query)

    if intent == "AGGREGATION":
        base_q, where = extract_where_condition(query)

        if where:
            try:
                filtered = df.query(normalize_condition(where))
            except Exception as e:
                return {"error": "INVALID_QUERY", "reason": str(e)}
        else:
            filtered = df

        return handle_aggregation(filtered, base_q)

    if intent == "SORT":
        return handle_sort(df, query)

    return {"error": "INVALID_QUERY", "message": "Unhandled intent"}


# ============================================================
# SMOKE TESTS
# ============================================================

if __name__ == "__main__":
    df = pd.DataFrame([
        {
            "experiment_id": "EXP-004",
            "expansion_ratio": 21.3,
            "viscosity": 1480,
            "adhesion": 92,
            "char_quality": "EXCELLENT",
            "status": "PASS",
            "formula": "Nanoclay enhanced",
        },
        {
            "experiment_id": "EXP-006",
            "expansion_ratio": 23.8,
            "viscosity": 1560,
            "adhesion": 95,
            "char_quality": "EXCELLENT",
            "status": "PASS",
            "formula": "Optimal production",
        },
        {
            "experiment_id": "EXP-009",
            "expansion_ratio": 27.1,
            "viscosity": 1620,
            "adhesion": 94,
            "char_quality": "EXCELLENT",
            "status": "PASS",
            "formula": "High expansion target",
        },
        {
            "experiment_id": "EXP-010",
            "expansion_ratio": 19.0,
            "viscosity": 1400,
            "adhesion": 88,
            "char_quality": "GOOD",
            "status": "PASS",
            "formula": "Lower adhesion sample",
        },
    ])

    tests = [
        ("highest expansion_ratio",                    "AGGREGATION"),
        ("lowest viscosity",                           "AGGREGATION"),
        ("viscosity > 1400",                           "FILTER"),
        ("by viscosity",                               "SORT"),
        ("sort by adhesion",                           "SORT"),
        ("highest adhesion where viscosity > 1500",    "AGGREGATION"),
        ("expansion_ratio >",                          "INVALID"),
        ("where binder = K52",                         "FILTER"),
        ("order by expansion_ratio",                   "SORT"),
        ("unknown intent",                             "INVALID"),
    ]

    for q, expected_intent in tests:
        intent = classify_intent(q)
        result = answer_query(df, q)
        print(f"{q[:50]:50} | intent: {intent:12} | result: {str(result)[:80]}")
        assert intent == expected_intent, f"Intent mismatch: {q!r} → got {intent!r}, expected {expected_intent!r}"

        if intent == "INVALID":
            assert "error" in result
        elif intent == "AGGREGATION":
            assert "_aggregation" in result or "error" in result
        elif intent == "FILTER":
            assert "results" in result or "error" in result
        elif intent == "SORT":
            assert "results" in result or "error" in result

    composite_query = "lowest expansion_ratio among top 3 by viscosity where adhesion > 90"
    composite_result = answer_query(df, composite_query)

    print("\nComposite query result:")
    print(composite_result)

    assert composite_result["experiment_id"] == "EXP-004", composite_result
    assert composite_result["_aggregation"]   == "min"
    assert composite_result["_target_column"] == "expansion_ratio"
    assert composite_result["_ranking_column"] == "viscosity"
    assert composite_result["_ranking_size"]   == 3
    assert composite_result["_pipeline"]       == "filter -> ranking -> aggregation"

    # Sort: natural phrasing "experiments by <column>" (not only "order by" / leading "by")
    sort_test_q = "experiments by adhesion"
    assert classify_intent(sort_test_q) == "SORT", classify_intent(sort_test_q)
    sort_res = answer_query(df, sort_test_q)
    assert "results" in sort_res, sort_res
    assert sort_res.get("count") == len(df)
    assert sort_res["results"][0]["experiment_id"] == "EXP-010"  # lowest adhesion 88
    assert sort_res["results"][-1]["experiment_id"] == "EXP-006"  # highest 95

    print("\n✅ ALL TESTS PASS")
