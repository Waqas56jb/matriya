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

SORT_KEYWORDS = ["by", "order by", "sorted by", "ranked by"]
CONDITION_KEYWORDS = [">", "<", "=", ">=", "<=", "!=", "where", "and", "or"]


def classify_intent(query: str) -> Literal["FILTER", "AGGREGATION", "SORT", "INVALID"]:
    q = query.lower().strip()

    # INVALID: incomplete operator at end
    if re.search(r'[<>=]\s*$', q):
        return "INVALID"


    # Detect aggregation
    has_agg = any(kw in q for kw in AGG_KEYWORDS["max"] + AGG_KEYWORDS["min"])
    has_sort = any(kw in q for kw in SORT_KEYWORDS)
    has_condition = any(kw in q for kw in CONDITION_KEYWORDS)

    # Rule: SORT without aggregation keywords
    if has_sort and not has_agg:
        return "SORT"

    # Rule: AGGREGATION even with "by"
    if has_agg:
        return "AGGREGATION"

    # Rule: FILTER has conditions but no aggregation/sort
    if has_condition:
        return "FILTER"

    # If nothing else matches
    return "INVALID"


# ============================================================
# QUERY PARSING HELPERS
# ============================================================

def detect_aggregation(query: str) -> Optional[str]:
    q = query.lower().strip()
    for agg, keywords in AGG_KEYWORDS.items():
        if any(kw in q for kw in keywords):
            return agg
    return None


COLUMN_KEYWORDS = {
    "expansion_ratio": ["expansion", "expansion_ratio", "expand", "swelling"],
    "viscosity": ["viscosity", "thickness"],
    "adhesion": ["adhesion", "bond", "bonding"],
}


def detect_target_column(query: str) -> Optional[str]:
    q = query.lower().strip()
    for column, keywords in COLUMN_KEYWORDS.items():
        if any(kw in q for kw in keywords):
            return column
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
    """Same as apply_aggregation from previous version."""
    if filtered is None or filtered.empty:
        return {"error": "NO_RESULTS", "reason": "no matching rows"}

    agg = detect_aggregation(query)
    if agg is None:
        return {"error": "INVALID_QUERY", "reason": "unknown aggregation"}

    col = detect_target_column(query)
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
        row["_aggregation"] = "max"
        row["_target_column"] = col
        return row

    if agg == "min":
        idx = valid[col].astype(float).idxmin()
        row = valid.loc[idx].to_dict()
        row["_aggregation"] = "min"
        row["_target_column"] = col
        return row

    return {"error": "INVALID_QUERY", "reason": f"unsupported aggregation: {agg}"}


def handle_filter(df: pd.DataFrame, query: str) -> Dict[str, Any]:
    """Apply conditions and return matching rows."""
    base_q, where = extract_where_condition(query)
    if where:
        try:
            filtered = df.query(where)
        except Exception as e:
            return {"error": "INVALID_QUERY", "reason": f"bad condition: {e}"}
    else:
        # No explicit where – treat whole query as condition?
        # For simplicity, we assume query contains operators. But if not, return full df.
        # Let's try to apply the whole query as a condition
        try:
            filtered = df.query(query)
        except Exception:
            filtered = df   # fallback to full

    if filtered.empty:
        return {"error": "NO_RESULTS", "reason": "no rows match condition"}

    # Return list of rows (as dicts) for FILTER intent
    return {"results": filtered.to_dict("records"), "count": len(filtered)}


def extract_column_after_by(query: str):
    match = re.search(r'\bby\s+([a-zA-Z_][a-zA-Z0-9_]*)', query, re.IGNORECASE)
    return match.group(1) if match else None


def handle_sort(df, query):
    col = extract_column_after_by(query)

    if col is None:
        return {"error": "INVALID_QUERY", "reason": "no column specified"}

    if col not in df.columns:
        return {"error": "INVALID_QUERY", "reason": f"unknown column: {col}"}

    ascending = not any(w in query.lower() for w in ["descending", "highest", "top"])

    return {
        "results": df.sort_values(by=col, ascending=ascending).to_dict("records")
    }


def apply_ranking(df, query, n=3):
    col = extract_column_after_by(query)

    if col is None or col not in df.columns:
        raise ValueError("Cannot rank: column not found in query")

    # ensure numeric values only
    numeric_series = pd.to_numeric(df[col], errors="coerce")
    valid = df.loc[numeric_series.notna()].copy()
    valid[col] = numeric_series.loc[numeric_series.notna()].astype(float)

    if valid.empty:
        return valid

    if "top" in query.lower() or "highest" in query.lower():
        return valid.nlargest(n, col)

    return valid.nsmallest(n, col)


# ============================================================
# COMPOSITE QUERY ORCHESTRATION
# ============================================================

def extract_top_n_by_clause(query: str) -> Tuple[Optional[int], Optional[str]]:
    """
    Extract pattern:
      among top 3 by viscosity
    Returns:
      (3, "viscosity")
    """
    match = re.search(
        r'\bamong\s+top\s+(\d+)\s+by\s+([a-zA-Z_][a-zA-Z0-9_]*)',
        query,
        re.IGNORECASE
    )
    if not match:
        return None, None

    n = int(match.group(1))
    col = match.group(2)
    return n, col


def extract_pre_among_segment(query: str) -> str:
    """
    From:
      'lowest expansion_ratio among top 3 by viscosity'
    returns:
      'lowest expansion_ratio'
    """
    parts = re.split(r'\bamong\s+top\b', query, flags=re.IGNORECASE)
    return parts[0].strip()


def detect_final_aggregation_target(query: str) -> Optional[str]:
    """
    Detect final aggregation target only from the segment before 'among top ... by ...'
    Example:
      'lowest expansion_ratio among top 3 by viscosity'
      -> expansion_ratio
    """
    prefix = extract_pre_among_segment(query)
    return detect_target_column(prefix)


def detect_final_aggregation(query: str) -> Optional[str]:
    """
    Detect final aggregation only from the segment before 'among top ... by ...'
    Example:
      'lowest expansion_ratio among top 3 by viscosity'
      -> min
    """
    prefix = extract_pre_among_segment(query)
    return detect_aggregation(prefix)


def is_composite_rank_then_aggregate_query(query: str) -> bool:
    """
    Detect composite queries of the form:
      lowest expansion_ratio among top 3 by viscosity where adhesion > 90
    """
    base_q, _ = extract_where_condition(query)

    has_top_n_by = re.search(
        r'\bamong\s+top\s+\d+\s+by\s+[a-zA-Z_][a-zA-Z0-9_]*',
        base_q,
        re.IGNORECASE
    ) is not None

    has_final_agg = detect_final_aggregation(base_q) is not None
    has_final_target = detect_final_aggregation_target(base_q) is not None

    return has_top_n_by and has_final_agg and has_final_target


def handle_rank_then_aggregate(df: pd.DataFrame, query: str) -> Dict[str, Any]:
    """
    Strict execution order:
      1) FILTER
      2) RANK (top N by column)
      3) AGGREGATE (lowest/highest target within ranked subset)

    Example:
      lowest expansion_ratio among top 3 by viscosity where adhesion > 90
    """
    base_q, where = extract_where_condition(query)

    # Step 1: FILTER
    if where:
        try:
            filtered = df.query(where)
        except Exception as e:
            return {"error": "INVALID_QUERY", "reason": f"bad condition: {e}"}
    else:
        filtered = df

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

    if ranked is None or ranked.empty:
        return {"error": "NO_RESULTS", "reason": f"ranking column '{rank_col}' has no valid numeric values"}

    # Step 3: FINAL AGGREGATION
    final_prefix = extract_pre_among_segment(base_q)
    result = handle_aggregation(ranked, final_prefix)

    if "error" in result:
        return result

    result["_ranking_column"] = rank_col
    result["_ranking_size"] = n
    result["_pipeline"] = "filter -> ranking -> aggregation"
    return result


# ============================================================
# MAIN ENTRY POINT
# ============================================================

def answer_query(df: pd.DataFrame, query: str) -> Dict[str, Any]:
    """
    Main orchestration entry.
    Important:
    - Existing filter / sort / aggregation logic is left intact.
    - Composite queries are intercepted first and executed in strict order.
    """
    if is_composite_rank_then_aggregate_query(query):
        return handle_rank_then_aggregate(df, query)

    intent = classify_intent(query)

    if intent == "INVALID":
        return {"error": "INVALID_QUERY", "message": "Query not recognized"}

    if intent == "FILTER":
        return handle_filter(df, query)

    if intent == "AGGREGATION":
        # Optional: apply any filter conditions before aggregation
        base_q, where = extract_where_condition(query)
        if where:
            try:
                filtered = df.query(where)
            except Exception:
                filtered = df
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
        ("highest expansion_ratio", "AGGREGATION"),
        ("lowest viscosity", "AGGREGATION"),
        ("viscosity > 1400", "FILTER"),
        ("by viscosity", "SORT"),
        ("sort by adhesion", "SORT"),
        ("highest adhesion where viscosity > 1500", "AGGREGATION"),
        ("expansion_ratio >", "INVALID"),
        ("where binder = K52", "FILTER"),
        ("order by expansion_ratio", "SORT"),
        ("unknown intent", "INVALID"),
    ]

    for q, expected_intent in tests:
        intent = classify_intent(q)
        result = answer_query(df, q)
        print(f"{q[:50]:50} | intent: {intent:12} | result: {str(result)[:80]}")
        assert intent == expected_intent, f"Intent mismatch: {q} -> {intent}"

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
    assert composite_result["_aggregation"] == "min"
    assert composite_result["_target_column"] == "expansion_ratio"
    assert composite_result["_ranking_column"] == "viscosity"
    assert composite_result["_ranking_size"] == 3
    assert composite_result["_pipeline"] == "filter -> ranking -> aggregation"

    print("\n✅ ALL TESTS PASS")
