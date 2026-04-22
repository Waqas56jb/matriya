import re
import pandas as pd
from typing import Optional, Dict, Any, Literal

# ============================================================
# INTENT CLASSIFICATION
# ============================================================

AGG_KEYWORDS = {
    "max": ["highest", "max", "maximum", "largest", "top", "best"],
    "min": ["lowest", "min", "minimum", "smallest", "worst"],
}

# Change 3: regex patterns instead of flat keyword list
SORT_PATTERNS = [
    r'^\s*by\s+\w+',
    r'sort(?:ed)?\s+by\s+\w+',
    r'order\s+by\s+\w+',
    r'rank(?:ed)?\s+by\s+\w+',
]

CONDITION_KEYWORDS = [">", "<", "=", ">=", "<=", "!=", "where", "and", "or"]


def classify_intent(query: str) -> Literal["FILTER", "AGGREGATION", "SORT", "INVALID"]:
    q = query.lower().strip()

    if re.search(r'[<>=]\s*$', q):
        return "INVALID"

    # Change 4: word boundaries on all AGG keyword checks
    all_agg_kws = AGG_KEYWORDS["max"] + AGG_KEYWORDS["min"]
    has_agg  = any(re.search(r'\b' + kw + r'\b', q) for kw in all_agg_kws)
    # Change 3: regex-based sort detection
    has_sort = any(re.search(p, q, re.IGNORECASE) for p in SORT_PATTERNS)
    has_condition = any(kw in q for kw in CONDITION_KEYWORDS)

    if has_sort and not has_agg:
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
      2. Quote bare identifier values so pandas treats them as strings,
         not column references.
         e.g.  binder == K52  →  binder == "K52"
    """
    # Rule 1 — bare = → == (not preceded or followed by another operator char)
    cond = re.sub(r'(?<![<>!])=(?!=)', '==', cond)
    # Rule 2 — quote bare word on the RHS of ==
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


COLUMN_KEYWORDS = {
    "expansion_ratio": ["expansion", "expansion_ratio", "expand", "swelling"],
    "viscosity":       ["viscosity", "thickness"],
    "adhesion":        ["adhesion", "bond", "bonding"],
}


def detect_target_column(query: str) -> Optional[str]:
    q = query.lower().strip()
    for column, keywords in COLUMN_KEYWORDS.items():
        if any(kw in q for kw in keywords):
            return column
    return None


def extract_where_condition(query: str) -> tuple[str, Optional[str]]:
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
            # Change 1: no silent fallback — explicit error
            return {"error": "INVALID_QUERY", "reason": f"bad condition: {e}"}
    else:
        try:
            # Change 2: normalise before querying
            filtered = df.query(normalize_condition(query))
        except Exception as e:
            # Change 1: no silent fallback — explicit error
            return {"error": "INVALID_QUERY", "reason": str(e)}

    if filtered.empty:
        return {"error": "NO_RESULTS", "reason": "no rows match condition"}

    return {"results": filtered.to_dict("records"), "count": len(filtered)}


# ============================================================
# SORT / RANKING
# ============================================================

def extract_column_after_by(query: str) -> Optional[str]:
    match = re.search(r'\bby\s+([a-zA-Z_][a-zA-Z0-9_]*)', query, re.IGNORECASE)
    return match.group(1) if match else None


def handle_sort(df: pd.DataFrame, query: str) -> Dict[str, Any]:
    col = extract_column_after_by(query)

    if col is None:
        return {"error": "INVALID_QUERY", "reason": "no column specified"}

    if col not in df.columns:
        return {"error": "INVALID_QUERY", "reason": f"unknown column: {col}"}

    ascending = not any(
        re.search(r'\b' + w + r'\b', query.lower())
        for w in ["descending", "highest", "top"]
    )

    return {
        "results": df.sort_values(by=col, ascending=ascending).to_dict("records")
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

    # Change 4: word boundaries for top/highest check
    if any(re.search(r'\b' + w + r'\b', query.lower()) for w in ["top", "highest"]):
        return valid.nlargest(n, col)

    return valid.nsmallest(n, col)


# ============================================================
# MAIN ENTRY POINT
# ============================================================

def answer_query(df: pd.DataFrame, query: str) -> Dict[str, Any]:
    intent = classify_intent(query)

    if intent == "INVALID":
        return {"error": "INVALID_QUERY", "message": "Query not recognized"}

    if intent == "FILTER":
        return handle_filter(df, query)

    if intent == "AGGREGATION":
        base_q, where = extract_where_condition(query)
        if where:
            try:
                # Change 2: normalise before querying
                filtered = df.query(normalize_condition(where))
            except Exception as e:
                # Change 1: no silent fallback — explicit error
                return {"error": "INVALID_QUERY", "reason": f"bad where condition: {e}"}
        else:
            filtered = df
        return handle_aggregation(filtered, base_q)

    if intent == "SORT":
        return handle_sort(df, query)

    return {"error": "INVALID_QUERY", "message": "Unhandled intent"}
