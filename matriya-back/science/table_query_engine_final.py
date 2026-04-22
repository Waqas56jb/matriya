"""
MATRIYA v0.1 — Table Query Engine (Week 1 FINAL)
=================================================
Deterministic Excel query parser.

Principles:
- NO eval(), NO exec(), NO LLM-generated code
- Boolean mask indexing only (safer than pandas.query())
- Schema validation on load
- Numeric coercion before comparisons
- COUNT intent detection
- Full audit trace on every response
- observed / computed / hypothesis tagging
- Ambiguity surfaced to caller — never silent fail
"""

import re
import json
import hashlib
from pathlib import Path
from typing import Optional, Union
from datetime import datetime, timezone

import pandas as pd


# ─────────────────────────────────────────────────────────
# COLUMN CONFIGURATION
# ─────────────────────────────────────────────────────────

# Required columns — load will FAIL if these are absent
REQUIRED_COLUMNS = ["APP:PER", "IFR"]

# Column type registry — prevents semantic nonsense (APP:PER = "good")
COLUMN_TYPES = {
    "APP:PER":         "numeric",
    "IFR":             "numeric",
    "APP":             "numeric",
    "PER":             "numeric",
    "MEL":             "numeric",
    "Nanoclay":        "numeric",
    "expansion_ratio": "numeric",
    "adhesion":        "numeric",   # numeric — values like 85.0, 90.0
    "viscosity":       "numeric",   # numeric — values like 1200.0
    "char_quality":    "categorical",
    "status":          "categorical",
}

# Alias map: natural language term → actual column name
COLUMN_ALIASES = {
    "app:per":              "APP:PER",
    "app per ratio":        "APP:PER",
    "app per":              "APP:PER",
    "ratio":                "APP:PER",
    "ifr":                  "IFR",
    "ifr loading":          "IFR",
    "total ifr":            "IFR",
    "app":                  "APP",
    # "per" intentionally omitted so ambiguity check fires (PER vs APP:PER)
    "mel":                  "MEL",
    "nanoclay":             "Nanoclay",
    "cloisite":             "Nanoclay",
    "cloisite 30b":         "Nanoclay",
    # expansion_ratio — exact name AND natural variants all resolve to the same column
    "expansion_ratio":      "expansion_ratio",
    "expansion":            "expansion_ratio",
    "expansion ratio":      "expansion_ratio",
    "er":                   "expansion_ratio",
    "char":                 "char_quality",
    "char quality":         "char_quality",
    "char_quality":         "char_quality",
    "adhesion":             "adhesion",
    "viscosity":            "viscosity",
    "status":               "status",
    "result":               "status",
    "outcome":              "status",
}

OPERATOR_MAP = {
    "greater than":              ">",
    "more than":                 ">",
    "above":                     ">",
    "higher than":               ">",
    "over":                      ">",
    "less than":                 "<",
    "below":                     "<",
    "under":                     "<",
    "lower than":                "<",
    "at least":                  ">=",
    "greater than or equal to":  ">=",
    "greater than or equal":     ">=",
    "at most":                   "<=",
    "less than or equal to":     "<=",
    "less than or equal":        "<=",
    "equals":                    "==",
    "equal to":                  "==",
    "equal":                     "==",
    "is":                        "==",
    "not equal":                 "!=",
    "not equal to":              "!=",
    "!=":                        "!=",
    ">=":                        ">=",
    "<=":                        "<=",
    ">":                         ">",
    "<":                         "<",
    "==":                        "==",
    "=":                         "==",
}

# Count-intent trigger words
COUNT_TRIGGERS = [
    "how many", "count", "number of", "total number",
    "quantity of", "sum of rows", "rows count"
]

# Aggregation keywords → direction
# Rule: column that appears IMMEDIATELY AFTER these words is the aggregation target.
# Columns in filter conditions (where/and/>/<) are NEVER the target.
AGGREGATION_KEYWORDS = {
    "highest":  "max",
    "maximum":  "max",
    "max":      "max",
    "best":     "max",
    "largest":  "max",
    "greatest": "max",
    "lowest":   "min",
    "minimum":  "min",
    "min":      "min",
    "smallest": "min",
    "worst":    "min",
    "least":    "min",
}


# ─────────────────────────────────────────────────────────
# STEP 1: LOAD EXCEL WITH SCHEMA VALIDATION
# ─────────────────────────────────────────────────────────

def load_excel(filepath: str, sheet_name: str = None) -> dict:
    """
    Load Excel file and validate schema.

    Returns:
        On success: {"sheets": {name: df}, "status": "loaded", ...}
        On failure: {"error": str, "data_source": "NONE"}
    """
    path = Path(filepath)
    if not path.exists():
        return {
            "error": f"File not found: {filepath}",
            "data_source": "NONE",
            "decision": "INSUFFICIENT_DATA"
        }

    try:
        raw = pd.read_excel(filepath, sheet_name=sheet_name or None)
        sheets = raw if isinstance(raw, dict) else {sheet_name: raw}
    except Exception as e:
        return {"error": str(e), "data_source": "NONE", "decision": "INSUFFICIENT_DATA"}

    # Schema validation per sheet
    sheet_reports = {}
    for sname, df in sheets.items():
        missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
        sheet_reports[sname] = {
            "rows": len(df),
            "columns": list(df.columns),
            "missing_required": missing,
            "schema_valid": len(missing) == 0
        }

    return {
        "sheets": sheets,
        "status": "loaded",
        "sheet_names": list(sheets.keys()),
        "sheet_reports": sheet_reports,
        "data_source": "DB_COMPUTED",
    }


# ─────────────────────────────────────────────────────────
# STEP 2: COLUMN RESOLUTION WITH AMBIGUITY DETECTION
# ─────────────────────────────────────────────────────────

def resolve_column(term: str, df_columns: list) -> dict:
    """
    Resolve natural language term to DataFrame column.

    Returns:
        {"column": str}                          — unambiguous match
        {"ambiguous": True, "candidates": list}  — multiple possible matches
        {"not_found": True, "term": str}         — no match
    """
    term_lower = term.strip().lower()
    candidates = []

    # 1. Direct alias
    if term_lower in COLUMN_ALIASES:
        alias = COLUMN_ALIASES[term_lower]
        if alias in df_columns:
            return {"column": alias}

    # 2. Exact case-insensitive match
    exact = [c for c in df_columns if c.lower() == term_lower]
    # 3. Partial match (other columns that CONTAIN the term)
    partial = [c for c in df_columns if term_lower in c.lower() and c not in exact]
    # If exact match also appears as substring in other columns -> ambiguous
    if len(exact) == 1 and len(partial) > 0:
        return {"ambiguous": True, "candidates": exact + partial}
    if len(exact) == 1:
        return {"column": exact[0]}
    if len(exact) > 1:
        return {"ambiguous": True, "candidates": exact}
    if len(partial) == 1:
        return {"column": partial[0]}
    if len(partial) > 1:
        return {"ambiguous": True, "candidates": partial}

    return {"not_found": True, "term": term}


# ─────────────────────────────────────────────────────────
# STEP 3: PARSE NATURAL LANGUAGE QUERY
# ─────────────────────────────────────────────────────────

def detect_count_intent(query: str) -> bool:
    """Return True if the query asks for a count, not rows."""
    q = query.lower().strip()
    return any(q.startswith(trigger) or trigger in q for trigger in COUNT_TRIGGERS)


def _protect_between(query: str) -> tuple:
    """
    Protect 'X between A and B' expressions before splitting on 'and'.
    Returns (protected_query, {placeholder: original})
    """
    placeholders = {}

    def replacer(m):
        key = f"__BTW{len(placeholders)}__"
        placeholders[key] = m.group(0)
        return key

    protected = re.sub(
        r"(.+?)\s+between\s+([\d.]+)\s+and\s+([\d.]+)",
        replacer,
        query,
        flags=re.IGNORECASE
    )
    return protected, placeholders


def _parse_single_condition(part: str, df_columns: list) -> dict:
    """
    Parse one condition string into a filter dict.

    Returns one of:
      {"column": str, "operator": str, "value": ..., "raw": str, "tag": "computed"}
      {"ambiguous": True, "candidates": list, "raw": str}
      None  — unparseable
    """
    part = part.strip()

    # IS NOT NULL / IS NULL — must be checked BEFORE the named-operator loop
    # because "is" maps to "==" and would mis-parse "expansion_ratio is not null"
    # as expansion_ratio == "not".
    m_null = re.search(r"(.+?)\s+is\s+not\s+null\s*$", part, re.IGNORECASE)
    if m_null:
        resolved = resolve_column(m_null.group(1).strip(), df_columns)
        if "column" in resolved:
            return {"column": resolved["column"], "operator": "is_not_null",
                    "value": None, "raw": part, "tag": "computed"}

    m_isnull = re.search(r"(.+?)\s+is\s+null\s*$", part, re.IGNORECASE)
    if m_isnull:
        resolved = resolve_column(m_isnull.group(1).strip(), df_columns)
        if "column" in resolved:
            return {"column": resolved["column"], "operator": "is_null",
                    "value": None, "raw": part, "tag": "computed"}

    # != null / != None shorthand
    m_notnull = re.search(r"(.+?)\s*(!=|<>)\s*(null|none)\s*$", part, re.IGNORECASE)
    if m_notnull:
        resolved = resolve_column(m_notnull.group(1).strip(), df_columns)
        if "column" in resolved:
            return {"column": resolved["column"], "operator": "is_not_null",
                    "value": None, "raw": part, "tag": "computed"}

    # BETWEEN pattern
    m = re.search(
        r"(.+?)\s+between\s+([\d.]+)\s+and\s+([\d.]+)",
        part, re.IGNORECASE
    )
    if m:
        col_text = m.group(1).strip()
        lo, hi = float(m.group(2)), float(m.group(3))
        resolved = resolve_column(col_text, df_columns)
        if "ambiguous" in resolved:
            return {**resolved, "raw": part}
        if "column" in resolved:
            return {"column": resolved["column"], "operator": "between",
                    "value": (lo, hi), "raw": part, "tag": "computed"}

    # Symbolic operator: "APP:PER > 3" / "IFR >= 30"
    m = re.search(
        r"(.+?)\s*(>=|<=|!=|>|<|==|=)\s*([\d.]+|\"[^\"]+\"|'[^']+'|\w+)",
        part
    )
    if m:
        col_text, op_sym, val_str = (g.strip() for g in m.groups())
        val_str = val_str.strip("\"'")
        resolved = resolve_column(col_text, df_columns)
        op = OPERATOR_MAP.get(op_sym, op_sym)
        if "ambiguous" in resolved:
            return {**resolved, "raw": part}
        if "column" in resolved:
            try:
                value = float(val_str)
            except ValueError:
                value = val_str
            return {"column": resolved["column"], "operator": op,
                    "value": value, "raw": part, "tag": "computed"}

    # Named operator (sorted longest-first to avoid prefix shadowing)
    for op_text in sorted(OPERATOR_MAP, key=len, reverse=True):
        pattern = rf"(.+?)\s+{re.escape(op_text)}\s+([\d.]+|\w+)"
        m = re.search(pattern, part, re.IGNORECASE)
        if m:
            col_text, val_str = m.group(1).strip(), m.group(2).strip()
            resolved = resolve_column(col_text, df_columns)
            op = OPERATOR_MAP[op_text.lower()]
            if "ambiguous" in resolved:
                return {**resolved, "raw": part}
            if "column" in resolved:
                try:
                    value = float(val_str)
                except ValueError:
                    value = val_str
                return {"column": resolved["column"], "operator": op,
                        "value": value, "raw": part, "tag": "computed"}

    return None


def detect_aggregation(query: str, df_columns: list) -> Optional[dict]:
    """
    Find an aggregation keyword and extract the column name IMMEDIATELY after it.

    Rule:
      - Aggregation target = column that appears right after the keyword
        (highest/lowest/maximum/minimum/best/worst …)
      - Columns that appear in filter conditions (where X > N, and Y < N)
        are NEVER the aggregation target.

    Returns:
      {"keyword": str, "column": str, "direction": "max"|"min"}  — on success
      None — if no aggregation keyword is found or column cannot be resolved

    Example:
      "highest viscosity where expansion_ratio > 15"
       → {"keyword": "highest", "column": "viscosity", "direction": "max"}
      NOT expansion_ratio (that is a filter condition after 'where').
    """
    q_lower = query.lower()

    # Sort longest-first so "maximum" is matched before "max"
    for keyword in sorted(AGGREGATION_KEYWORDS, key=len, reverse=True):
        # Match: <keyword> <column-phrase> <stop: where | with | , | end-of-string>
        pattern = rf"\b{re.escape(keyword)}\s+(.+?)(?=\s+where\b|\s+with\b|\s*,|\s*$)"
        m = re.search(pattern, q_lower, re.IGNORECASE)
        if not m:
            continue

        candidate_phrase = m.group(1).strip()

        # Try to resolve the candidate phrase as a column (alias or exact/partial match)
        resolved = resolve_column(candidate_phrase, df_columns)
        if "column" in resolved:
            return {
                "keyword":   keyword,
                "column":    resolved["column"],
                "direction": AGGREGATION_KEYWORDS[keyword],
            }

        # Candidate phrase may have extra words (e.g. "viscosity value").
        # Try each token in the phrase from left to right.
        for token in candidate_phrase.split():
            resolved = resolve_column(token, df_columns)
            if "column" in resolved:
                return {
                    "keyword":   keyword,
                    "column":    resolved["column"],
                    "direction": AGGREGATION_KEYWORDS[keyword],
                }

    return None


def detect_ranking(query: str, df_columns: list) -> Optional[dict]:
    """
    Detect a ranking intent: "top N by <column>".

    Rule:
      - Pattern: top <integer> by <column>
      - The ranking column is extracted from "by <column>", NOT from filter conditions.

    Returns:
      {"n": int, "column": str, "direction": "max"}   — always descending (top = highest)
      None — if no ranking pattern found

    Examples:
      "top 3 by expansion_ratio"  → {"n": 3, "column": "expansion_ratio", "direction": "max"}
      "top 5 by IFR"              → {"n": 5, "column": "IFR",             "direction": "max"}
    """
    m = re.search(r"\btop\s+(\d+)\s+by\s+(\S+)", query, re.IGNORECASE)
    if not m:
        return None

    n = int(m.group(1))
    col_text = m.group(2).strip().rstrip(".,?!")

    resolved = resolve_column(col_text, df_columns)
    if "column" in resolved:
        return {"n": n, "column": resolved["column"], "direction": "max"}

    return None


def parse_natural_language_query(query: str, df_columns: list) -> dict:
    """
    Parse NL query into structured filter list.

    Returns:
    {
        "filters":          list of filter dicts (may include ambiguous entries),
        "ambiguous_items":  list of ambiguous filter dicts,
        "parse_confidence": "HIGH" | "MEDIUM" | "LOW",
        "count_intent":     bool,
        "unparsed":         str | None
    }
    """
    count_intent = detect_count_intent(query)

    # ── Aggregation + ranking detection (on original query, before any stripping) ──
    # Must run first so phrases are removed before filter parsing.
    aggregation = detect_aggregation(query, df_columns)
    ranking     = detect_ranking(query, df_columns)

    query_lower = query.lower().strip()

    # If aggregation was found, remove "keyword <column>" from the query so the
    # aggregation target never falls into the filter layer.
    if aggregation:
        agg_phrase = rf"\b{re.escape(aggregation['keyword'])}\s+\S+"
        query_lower = re.sub(agg_phrase, "", query_lower, flags=re.IGNORECASE).strip()

    # If ranking was found, remove "top N by <column>" from the query so the
    # ranking column never falls into the filter layer.
    if ranking:
        rank_phrase = rf"\btop\s+{ranking['n']}\s+by\s+\S+"
        query_lower = re.sub(rank_phrase, "", query_lower, flags=re.IGNORECASE).strip()

    # Strip leading context words — repeat until stable.
    _strip_words = sorted([
        "find", "show me", "show", "get", "filter", "select",
        "list", "formulations", "formulation", "rows", "row", "where", "with",
        "have", "that", "that have", "which have", "having", "all", "only",
        "how many", "count of", "number of",
        "which experiment has", "which experiment", "which",
        "experiment has", "experiment", "experiments",
        "data", "results", "result",
        "give me", "return", "display", "output",
        "among",
    ], key=len, reverse=True)
    for _ in range(6):  # max passes
        prev = query_lower
        for prefix in _strip_words:
            query_lower = re.sub(rf"^\s*{re.escape(prefix)}\s+", "", query_lower).strip()
        if query_lower == prev:
            break  # stable

    # Protect BETWEEN before splitting on "and"
    protected, placeholders = _protect_between(query_lower)

    # Split on "and" / ","
    raw_parts = re.split(r"\s+and\s+|,\s*", protected)

    # Restore placeholders
    parts = [placeholders.get(p.strip(), p) for p in raw_parts]

    filters = []
    ambiguous_items = []
    unparsed = []

    for part in parts:
        part = part.strip()
        if not part:
            continue
        result = _parse_single_condition(part, df_columns)
        if result is None:
            unparsed.append(part)
        elif result.get("ambiguous"):
            ambiguous_items.append(result)
        else:
            filters.append(result)

    has_ambiguity = len(ambiguous_items) > 0
    has_unparsed = len(unparsed) > 0

    if has_ambiguity:
        confidence = "LOW"
    elif has_unparsed and not filters:
        confidence = "LOW"
    elif has_unparsed:
        confidence = "MEDIUM"
    else:
        confidence = "HIGH"

    return {
        "filters":          filters,
        "ambiguous_items":  ambiguous_items,
        "parse_confidence": confidence,
        "count_intent":     count_intent,
        "unparsed":         " | ".join(unparsed) if unparsed else None,
        "aggregation":      aggregation,   # {"keyword", "column", "direction"} or None
        "ranking":          ranking,       # {"n", "column", "direction"} or None
    }


# ─────────────────────────────────────────────────────────
# STEP 4: TYPE VALIDATION
# ─────────────────────────────────────────────────────────

def validate_filter_types(filters: list) -> list:
    """
    Check that filter value types match COLUMN_TYPES registry.
    Returns list of type violation warnings.
    """
    warnings = []
    for f in filters:
        col = f.get("column")
        val = f.get("value")
        expected = COLUMN_TYPES.get(col)
        if expected == "numeric" and isinstance(val, str):
            warnings.append(
                f"Type mismatch: column '{col}' is numeric but value '{val}' is string. "
                f"Did you mean a number?"
            )
        if expected == "categorical" and isinstance(val, (int, float)):
            warnings.append(
                f"Type note: column '{col}' is categorical — "
                f"comparing with number {val} may not match."
            )
    return warnings


# ─────────────────────────────────────────────────────────
# STEP 5: EXECUTE QUERY
# ─────────────────────────────────────────────────────────

def execute_query(df: pd.DataFrame, parsed: dict) -> dict:
    """
    Apply parsed filters using boolean mask indexing.
    NO eval(), NO exec(), NO pandas.query().

    Returns full MATRIYA-compatible response with audit trace.
    """
    filters      = parsed.get("filters", [])
    count_intent = parsed.get("count_intent", False)
    aggregation  = parsed.get("aggregation")   # {"keyword", "column", "direction"} | None
    ranking      = parsed.get("ranking")       # {"n", "column", "direction"} | None

    if not filters:
        return {
            "decision":  "INSUFFICIENT_DATA",
            "quality":   "NO_FILTERS",
            "warnings":  ["No valid filters could be parsed from the query."],
            "evidence":  {"unparsed": parsed.get("unparsed")},
            "data_source": "NONE",
            "confidence": "LOW",
            "tag":        "none",
            "audit_trace": _build_trace(parsed, [], [], None)
        }

    # Type validation
    type_warnings = validate_filter_types(filters)

    # Coerce ALL numeric columns to float before any comparison.
    # This must happen once up-front so every filter sees proper NaN (not empty strings).
    df = df.copy()
    for col_name, col_type in COLUMN_TYPES.items():
        if col_type == "numeric" and col_name in df.columns:
            df[col_name] = pd.to_numeric(df[col_name], errors="coerce")

    mask = pd.Series([True] * len(df), index=df.index)
    applied = []
    failed = []
    execution_steps = []

    import sys as _sqsys

    # NULL-safety rule (mirrors SQL WHERE semantics):
    # For any numeric comparison operator (>, <, >=, <=, between, ==, !=),
    # a NULL (NaN) value in the column MUST evaluate to FALSE.
    # We enforce this by applying .notna() to the column mask before the comparison.
    NUMERIC_OPS = {">", "<", ">=", "<=", "between", "==", "!="}

    # CRITICAL: if ANY filter references a column that does not exist in the DataFrame,
    # we must NOT silently return all rows. Raise it as a hard failure so the caller
    # returns NO_MATCHES (not MATCHES_FOUND with all rows).
    missing_cols = [f["column"] for f in filters if f["column"] not in df.columns]
    if missing_cols:
        print(f"[execute_query] COLUMN NOT FOUND: {missing_cols}. DataFrame columns: {list(df.columns)}",
              file=_sqsys.stderr, flush=True)
        return {
            "decision":    "NO_MATCHES",
            "quality":     "SCHEMA_ERROR",
            "warnings":    [f"Column(s) not found in dataset: {missing_cols}. Available: {list(df.columns)}"],
            "evidence":    {
                "matched_rows":     0,
                "total_rows":       len(df),
                "match_rate":       0.0,
                "filters_applied":  [],
                "filters_failed":   [{"column": c, "error": "Column not found"} for c in missing_cols],
                "result_preview":   [],
                "columns_returned": list(df.columns),
            },
            "data_source": "DB_COMPUTED",
            "confidence":  "LOW",
            "tag":         "computed",
            "audit_trace": _build_trace(parsed, [], [], df.head(0)),
            "result_df":   df.head(0),
        }

    for f in filters:
        col = f["column"]
        op  = f["operator"]
        val = f["value"]

        # Log each filter step for full traceability
        print(f"[execute_query] FILTER: {col} {op} {val} | col_in_df={col in df.columns} | "
              f"dtype={df[col].dtype if col in df.columns else 'N/A'} | "
              f"non_null={(df[col].notna().sum() if col in df.columns else 'N/A')}",
              file=_sqsys.stderr, flush=True)

        # col always exists here (missing_cols check above handles the case)
        if col not in df.columns:  # defensive — should never reach here
            failed.append({**f, "error": f"Column '{col}' not found (defensive)"})
            continue

        try:
            before = mask.sum()

            # SQL-style NULL semantics: exclude NULL rows from ALL numeric comparisons
            is_numeric_col = COLUMN_TYPES.get(col) == "numeric"
            if is_numeric_col and op in NUMERIC_OPS:
                null_mask = df[col].notna()
                null_count = (~null_mask).sum()
                if null_count > 0:
                    import sys as _sys2
                    print(f"[execute_query] NULL-safety: excluding {null_count} NULL rows from '{col} {op} {val}'",
                          file=_sys2.stderr, flush=True)
                mask &= null_mask  # enforce: NULL always = FALSE for numeric filters

            if op == "between":
                lo, hi = val
                mask &= (df[col] >= lo) & (df[col] <= hi)
                step_desc = f"{col} BETWEEN {lo} AND {hi} (nulls excluded)"
            elif op == ">":
                mask &= df[col] > val
                step_desc = f"{col} > {val} (nulls excluded)"
            elif op == "<":
                mask &= df[col] < val
                step_desc = f"{col} < {val} (nulls excluded)"
            elif op == ">=":
                mask &= df[col] >= val
                step_desc = f"{col} >= {val} (nulls excluded)"
            elif op == "<=":
                mask &= df[col] <= val
                step_desc = f"{col} <= {val} (nulls excluded)"
            elif op == "==":
                if isinstance(val, str):
                    mask &= df[col].astype(str).str.strip().str.lower() == val.lower()
                else:
                    mask &= df[col] == val
                step_desc = f"{col} == {val}"
            elif op == "!=":
                mask &= df[col] != val
                step_desc = f"{col} != {val}"
            elif op == "is_not_null":
                mask &= df[col].notna()
                step_desc = f"{col} IS NOT NULL"
            elif op == "is_null":
                mask &= df[col].isna()
                step_desc = f"{col} IS NULL"
            else:
                failed.append({**f, "error": f"Unknown operator '{op}'"})
                continue

            after = mask.sum()
            execution_steps.append({
                "step":    step_desc,
                "rows_before": int(before),
                "rows_after":  int(after),
                "rows_eliminated": int(before - after),
                "method": "boolean_mask",
                "tag":    "computed"
            })
            applied.append({**f, "tag": "computed"})

        except Exception as e:
            failed.append({**f, "error": str(e)})

    # ── DATASET CONSISTENCY CHECK (David request) ──────────────────────────────
    # Verify id(df) is the same object used for filtering and for result_df.
    # This confirms no reload or re-mapping happened between filter and return.
    print(f"[execute_query] id(df)_before_result={id(df)} | mask_true_count={int(mask.sum())} | df_len={len(df)}",
          file=_sqsys.stderr, flush=True)
    result_df = df[mask]
    print(f"[execute_query] id(df)_after={id(df)} | id(result_df)={id(result_df)} | result_df_len={len(result_df)}",
          file=_sqsys.stderr, flush=True)
    if 'expansion_ratio' in result_df.columns:
        er_vals = result_df['expansion_ratio'].tolist()
        print(f"[execute_query] result_df expansion_ratio values: {er_vals}", file=_sqsys.stderr, flush=True)
    if len(result_df) > 0:
        print(f"[execute_query] result_df[0]: {result_df.iloc[0].to_dict()}", file=_sqsys.stderr, flush=True)

    # ── Step 2: Ranking — top N by <rank_column> ─────────────────────────────
    # "top 3 by expansion_ratio" → sort desc, keep top 3 rows.
    rank_meta = None
    if ranking and len(result_df) > 0:
        rank_col = ranking["column"]
        rank_n   = ranking["n"]
        if rank_col in result_df.columns:
            numeric_rank = pd.to_numeric(result_df[rank_col], errors="coerce")
            sorted_df = (
                result_df
                .assign(_rank_col=numeric_rank)
                .sort_values("_rank_col", ascending=False)
                .head(rank_n)  # 🔥 enforce TOP N (critical fix)
                .drop(columns=["_rank_col"])
            )
            result_df = sorted_df
            rank_meta = {
                "rank_column":    rank_col,
                "rank_n":         rank_n,
                "rows_after_rank": len(result_df),
            }
            print(
                f"[execute_query] after ranking top {rank_n} by {rank_col}: {len(sorted_df)} rows",
                flush=True,
            )

    # ── Step 3: Aggregation — idxmax / idxmin on aggregation column ──────────
    # Applied AFTER ranking so it operates on the ranked subset, not the full
    # filter result.  This is the correct two-step pipeline:
    #   filter → rank → aggregate
    agg_meta = None
    if aggregation and len(result_df) > 0:
        agg_col = aggregation["column"]
        agg_dir = aggregation["direction"]
        if agg_col in result_df.columns:
            numeric_col = pd.to_numeric(result_df[agg_col], errors="coerce")
            if not numeric_col.isna().all():
                best_idx = numeric_col.idxmax() if agg_dir == "max" else numeric_col.idxmin()
                best_row = result_df.loc[[best_idx]]
                agg_meta = {
                    "aggregation_column":    agg_col,
                    "aggregation_direction": agg_dir,
                    "aggregation_keyword":   aggregation["keyword"],
                    "aggregation_value":     float(numeric_col.loc[best_idx]),
                    "applied_on":            "ranked_result" if rank_meta else "filtered_result",
                    "best_row":              best_row.to_dict(orient="records"),
                }
                result_df = best_row   # narrow to the single best row

    matched = len(result_df)
    total = len(df)

    decision  = "MATCHES_FOUND" if matched > 0 else "NO_MATCHES"
    quality   = "PARTIAL_DATA" if failed else "COMPLETE"
    all_warnings = type_warnings + [
        f"Filter failed: {f['raw']} — {f.get('error')}" for f in failed
    ]

    evidence = {
        "matched_rows":    matched,
        "total_rows":      total,
        "match_rate":      round(matched / total, 4) if total > 0 else 0,
        "filters_applied": applied,
        "filters_failed":  failed,
    }
    if rank_meta:
        evidence["ranking"] = rank_meta
    if agg_meta:
        evidence["aggregation"] = agg_meta

    if count_intent:
        evidence["count_result"] = matched
        evidence["count_note"] = f"{matched} rows match the query out of {total} total"
    else:
        # Full result rows — no positional cap. The Node.js layer is responsible
        # for display limits; the data contract requires unmodified rows here.
        evidence["result_preview"] = result_df.to_dict(orient="records")
        evidence["columns_returned"] = list(result_df.columns)

    return {
        "decision":    decision,
        "quality":     quality,
        "warnings":    all_warnings,
        "evidence":    evidence,
        "data_source": "DB_COMPUTED",
        "confidence":  "HIGH" if not failed and not all_warnings else "MEDIUM",
        "tag":         "computed",
        "audit_trace": _build_trace(parsed, execution_steps, applied, result_df),
        "result_df":   result_df   # removed before JSON serialisation in query_excel
    }


def _build_trace(parsed: dict, execution_steps: list,
                 applied: list, result_df) -> dict:
    """Build full audit trace for every query execution."""
    return {
        "timestamp":      datetime.now(timezone.utc).isoformat(),
        "query_text":     parsed.get("_original_query", ""),
        "parsed_filters": parsed.get("filters", []),
        "parse_confidence": parsed.get("parse_confidence"),
        "count_intent":   parsed.get("count_intent", False),
        "execution_path": "boolean_mask_indexing",
        "execution_steps": execution_steps,
        "filters_applied": applied,
        "rows_matched":   len(result_df) if result_df is not None else 0,
        "no_eval":        True,
        "no_exec":        True,
        "deterministic":  True,
    }


# ─────────────────────────────────────────────────────────
# MAIN API
# ─────────────────────────────────────────────────────────

def query_excel(filepath: str, natural_language_query: str,
                sheet_name: str = "Formulation Data") -> dict:
    """
    Full pipeline: load → validate → parse → execute → return.

    Returns MATRIYA-compatible JSON-serialisable dict.
    """
    # 1. Load
    loaded = load_excel(filepath, sheet_name)
    if "error" in loaded:
        return {
            "decision": "INSUFFICIENT_DATA",
            "evidence": {"error": loaded["error"]},
            "data_source": "NONE",
            "confidence": "LOW"
        }

    sheet_report = loaded["sheet_reports"].get(sheet_name, {})
    if not sheet_report.get("schema_valid", False):
        return {
            "decision": "INSUFFICIENT_DATA",
            "quality":  "SCHEMA_ERROR",
            "evidence": {
                "missing_required_columns": sheet_report.get("missing_required"),
                "available_columns": sheet_report.get("columns"),
                "sheet": sheet_name,
            },
            "data_source": "NONE",
            "confidence": "LOW"
        }

    df = loaded["sheets"][sheet_name]

    # 2. Parse
    parsed = parse_natural_language_query(natural_language_query, list(df.columns))
    parsed["_original_query"] = natural_language_query

    # Surface ambiguity immediately — do NOT silently execute
    if parsed["ambiguous_items"]:
        return {
            "decision":   "AMBIGUOUS_QUERY",
            "quality":    "AMBIGUOUS",
            "warnings":   ["Query contains ambiguous column references."],
            "evidence": {
                "original_query": natural_language_query,
                "ambiguous_items": [
                    {"term": a.get("raw"), "candidates": a.get("candidates")}
                    for a in parsed["ambiguous_items"]
                ],
                "suggestion": "Please specify the exact column name."
            },
            "data_source": "NONE",
            "confidence":  "LOW",
            "tag":         "none"
        }

    if parsed["parse_confidence"] == "LOW" and not parsed["filters"]:
        return {
            "decision":   "INSUFFICIENT_DATA",
            "quality":    "PARSE_FAILED",
            "warnings":   ["Could not parse query into executable filters."],
            "evidence": {
                "original_query": natural_language_query,
                "unparsed": parsed["unparsed"],
                "available_columns": list(df.columns),
                "hint": "Try: 'APP:PER > 3' or 'IFR between 25 and 30'"
            },
            "data_source": "NONE",
            "confidence":  "LOW",
            "tag":         "none"
        }

    # 3. Execute
    result = execute_query(df, parsed)
    result.pop("result_df", None)   # not JSON-serialisable
    result["query"]            = natural_language_query
    result["sheet"]            = sheet_name
    result["parse_confidence"] = parsed["parse_confidence"]

    return result


# ─────────────────────────────────────────────────────────
# UNIT TESTS
# ─────────────────────────────────────────────────────────

def run_tests():
    print("=" * 65)
    print("MATRIYA Table Query Engine — Unit + Determinism Tests")
    print("=" * 65)

    mock_columns = ["APP:PER", "IFR", "APP", "PER", "MEL",
                    "Nanoclay", "expansion_ratio", "char_quality", "status"]

    unit_tests = [
        ("APP:PER > 3",                             "APP:PER", ">",       3.0),
        ("IFR between 25 and 30",                   "IFR",    "between", (25.0, 30.0)),
        ("APP:PER greater than 3",                  "APP:PER", ">",       3.0),
        ("IFR >= 40",                               "IFR",    ">=",      40.0),
        ("IFR less than 35",                        "IFR",    "<",       35.0),
        ("expansion ratio above 15",                "expansion_ratio", ">", 15.0),
        ("nanoclay == 4.5",                         "Nanoclay", "==",    4.5),
        ("IFR between 35 and 45 and APP:PER <= 3",  "IFR",    "between", (35.0, 45.0)),
    ]

    passed = failed = 0
    for query, exp_col, exp_op, exp_val in unit_tests:
        r = parse_natural_language_query(query, mock_columns)
        f = r["filters"]
        ok = (f and f[0]["column"] == exp_col
              and f[0]["operator"] == exp_op
              and f[0]["value"] == exp_val)
        if ok:
            passed += 1
        else:
            failed += 1
            print(f"\n❌ FAIL: '{query}'")
            print(f"   Expected: col={exp_col}, op={exp_op}, val={exp_val}")
            print(f"   Got:      {f[0] if f else 'NO FILTERS'}")

    print(f"\n{'✅' if failed == 0 else '❌'} Unit tests: {passed}/{len(unit_tests)} passed")

    # ── Aggregation target column detection test ──
    agg_columns = ["APP:PER", "IFR", "APP", "PER", "MEL",
                   "Nanoclay", "expansion_ratio", "viscosity", "char_quality", "adhesion", "status"]
    agg_tests = [
        (
            "Which experiment has the highest viscosity where expansion_ratio > 15 and adhesion > 85?",
            "viscosity", "max"
        ),
        (
            "find the lowest IFR where APP:PER > 3",
            "IFR", "min"
        ),
        (
            "highest APP:PER where expansion ratio > 10",
            "APP:PER", "max"
        ),
    ]
    agg_passed = agg_failed = 0
    for q, exp_col, exp_dir in agg_tests:
        r = parse_natural_language_query(q, agg_columns)
        agg = r.get("aggregation")
        # Verify: aggregation target is correct AND that column is NOT in filters
        filter_cols = [f["column"] for f in r.get("filters", [])]
        ok = (
            agg is not None
            and agg["column"] == exp_col
            and agg["direction"] == exp_dir
            and exp_col not in filter_cols
        )
        if ok:
            agg_passed += 1
        else:
            agg_failed += 1
            print(f"\n❌ AGG FAIL: '{q}'")
            print(f"   Expected agg: col={exp_col}, dir={exp_dir}")
            print(f"   Got agg:      {agg}")
            print(f"   Filter cols:  {filter_cols}")
    print(f"{'✅' if agg_failed == 0 else '❌'} Aggregation target detection: "
          f"{agg_passed}/{len(agg_tests)} passed")

    # ── COUNT intent test ──
    count_tests = [
        ("how many formulations have IFR > 40", True),
        ("count rows where APP:PER < 3",         True),
        ("show rows where IFR > 30",             False),
        ("APP:PER > 3",                           False),
    ]
    count_ok = all(
        parse_natural_language_query(q, mock_columns)["count_intent"] == expected
        for q, expected in count_tests
    )
    print(f"{'✅' if count_ok else '❌'} COUNT intent detection: {'PASS' if count_ok else 'FAIL'}")

    # ── Ambiguity detection test ──
    ambig_r = parse_natural_language_query("PER > 3", mock_columns)
    ambig_detected = len(ambig_r["ambiguous_items"]) > 0
    print(f"{'✅' if ambig_detected else '❌'} Ambiguity detection ('PER' → APP:PER vs PER): "
          f"{'PASS' if ambig_detected else 'FAIL'}")
    if ambig_detected:
        print(f"   Candidates: {ambig_r['ambiguous_items'][0].get('candidates')}")

    # ── Determinism check ──
    q = "APP:PER > 3 and IFR between 30 and 45"
    results = [parse_natural_language_query(q, mock_columns) for _ in range(5)]
    deterministic = all(r == results[0] for r in results)
    print(f"{'✅' if deterministic else '❌'} Determinism (same query × 5): "
          f"{'DETERMINISTIC' if deterministic else 'NON-DETERMINISTIC'}")

    return passed, failed


# ─────────────────────────────────────────────────────────
# ACCEPTANCE TESTS (requires real Excel file)
# ─────────────────────────────────────────────────────────

def run_acceptance_tests(filepath: str, sheet_name: str = "Formulation Data"):
    """
    Real-file tests with exact expected counts.
    Update expected_count values after running once against your actual XLSX.
    """
    print("\n" + "=" * 65)
    print("MATRIYA — Acceptance Tests (real file)")
    print("=" * 65)

    tests = [
        {
            "query":          "APP:PER > 3",
            "expected_count": None,    # ← fill in after first run
            "description":    "High APP:PER ratio formulations"
        },
        {
            "query":          "IFR between 25 and 30",
            "expected_count": None,
            "description":    "IFR in 25-30% range"
        },
        {
            "query":          "expansion ratio > 10",
            "expected_count": None,
            "description":    "Good expansion formulations"
        },
        {
            "query":          "how many formulations have IFR > 40",
            "expected_count": None,
            "description":    "COUNT intent test",
            "is_count":       True
        },
        {
            "query":          "PER > 3",
            "expect_ambiguity": True,
            "description":    "Ambiguity: PER vs APP:PER"
        },
    ]

    passed = failed = 0
    for t in tests:
        result = query_excel(filepath, t["query"], sheet_name)
        desc = t["description"]

        # Ambiguity test
        if t.get("expect_ambiguity"):
            ok = result.get("decision") == "AMBIGUOUS_QUERY"
            candidates = [
                item["candidates"]
                for item in result.get("evidence", {}).get("ambiguous_items", [])
            ]
            if ok:
                passed += 1
                print(f"✅ PASS [{desc}] — AMBIGUOUS_QUERY, candidates: {candidates}")
            else:
                failed += 1
                print(f"❌ FAIL [{desc}] — Expected AMBIGUOUS_QUERY, got: {result.get('decision')}")
            continue

        # COUNT test
        if t.get("is_count"):
            count = result.get("evidence", {}).get("count_result")
            exp = t["expected_count"]
            ok = (exp is None) or (count == exp)
            diff = f"(expected {exp}, got {count})" if exp is not None and not ok else ""
            status = "✅ PASS" if ok else "❌ FAIL"
            note = f"count={count}" if exp is None else ""
            print(f"{status} [{desc}] {note} {diff}")
            if ok: passed += 1
            else: failed += 1
            continue

        # Row-match test
        matched = result.get("evidence", {}).get("matched_rows", 0)
        exp = t["expected_count"]
        ok = (exp is None) or (matched == exp)
        diff = f"(expected {exp}, got {matched})" if exp is not None and not ok else ""
        status = "✅ PASS" if ok else "❌ FAIL"
        note = f"matched={matched}" if exp is None else ""
        print(f"{status} [{desc}] {note} {diff}")
        if ok: passed += 1
        else: failed += 1

    print(f"\nAcceptance: {passed}/{len(tests)} passed")
    print("ℹ️  Set expected_count values above after first run against real data.")


# ─────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────

if __name__ == "__main__":
    passed, failed = run_tests()

    print("\n" + "=" * 65)
    print("Demo queries (no Excel file)")
    print("=" * 65)

    demo_columns = ["APP:PER", "IFR", "APP", "PER", "MEL",
                    "Nanoclay", "expansion_ratio", "char_quality"]

    demos = [
        "find rows where APP:PER > 3",
        "formulations with IFR between 25 and 30",
        "APP:PER greater than 3 and IFR less than 40",
        "nanoclay above 4 and expansion ratio >= 15",
        "IFR between 35 and 45 and APP:PER <= 3",
        "how many formulations have IFR > 40",
        "PER > 3",                              # should surface ambiguity
    ]

    for q in demos:
        r = parse_natural_language_query(q, demo_columns)
        print(f"\n'{q}'")
        print(f"  confidence={r['parse_confidence']}  count_intent={r['count_intent']}")
        for f in r["filters"]:
            val = f"({f['value'][0]},{f['value'][1]})" if f['operator'] == 'between' else f['value']
            print(f"  filter: {f['column']} {f['operator']} {val}  [{f['tag']}]")
        for a in r["ambiguous_items"]:
            print(f"  AMBIGUOUS: '{a['raw']}' → candidates {a['candidates']}")
        if r["unparsed"]:
            print(f"  unparsed: {r['unparsed']}")
