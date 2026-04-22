"""
MATRIYA Aggregation Layer
=========================
Runs AFTER the filter engine — never modifies it.

Architecture:  validate_query → filter (table_query_engine_final) → aggregate (this module)

Responsibilities:
  - detect_aggregation_intent : parse "highest X", "top 3 by X", "lowest Y" from a query
  - apply_aggregation         : run idxmax / idxmin / nlargest / nsmallest on a DataFrame

Rules:
  - Zero imports from table_query_engine_final — strict separation
  - All DataFrame operations are direct pandas calls
  - Always works on a copy; never mutates the caller's DataFrame
"""

import re
import sys
import pandas as pd


# ── Column aliases recognised in natural-language aggregation queries ────────
_ALIASES: dict[str, str] = {
    "expansion ratio":  "expansion_ratio",
    "expansion_ratio":  "expansion_ratio",
    "exp ratio":        "expansion_ratio",
    "er":               "expansion_ratio",
    "adhesion":         "adhesion",
    "viscosity":        "viscosity",
    "char quality":     "char_quality",
    "char_quality":     "char_quality",
    "app:per":          "APP:PER",
    "app per":          "APP:PER",
    "app/per":          "APP:PER",
    "ratio":            "APP:PER",
    "ifr":              "IFR",
    "app":              "APP",
    "per":              "PER",
    "mel":              "MEL",
    "nanoclay":         "Nanoclay",
    "hrr":              "HRR_reduction_pct",
}

# Columns that are meaningful to aggregate (must be numeric)
_NUMERIC_AGG_COLS = {
    "expansion_ratio", "adhesion", "viscosity",
    "APP:PER", "IFR", "APP", "PER", "MEL", "Nanoclay", "HRR_reduction_pct",
}


def detect_aggregation_intent(query: str, available_columns: list) -> dict:
    """
    Detect aggregation keywords in a natural-language query.

    Returns
    -------
    {"has_agg": False}                                      — no aggregation intent
    {"has_agg": True, "type": str, "column": str, "n": int, "original_query": str}

    Supported types:
      "max"      — highest / maximum / best / largest
      "min"      — lowest  / minimum / worst / smallest
      "top_n"    — top N by <column>
      "bottom_n" — bottom N by <column>
    """
    q = query.lower().strip()
    available_lower = {c.lower(): c for c in available_columns}

    # ── Determine aggregation direction and N ───────────────────────────────
    agg_type: str | None = None
    n = 1

    top_match = re.search(r'\btop\s+(\d+)\b', q)
    bot_match = re.search(r'\bbottom\s+(\d+)\b', q)

    if top_match:
        agg_type = "top_n"
        n = int(top_match.group(1))
    elif bot_match:
        agg_type = "bottom_n"
        n = int(bot_match.group(1))
    elif any(kw in q for kw in ["highest", "maximum", "largest", "best", "max "]):
        agg_type = "max"
    elif any(kw in q for kw in ["lowest", "minimum", "smallest", "worst", "min "]):
        agg_type = "min"

    if not agg_type:
        return {"has_agg": False}

    # ── Identify target column — longest alias match wins ───────────────────
    target_col: str | None = None

    for alias in sorted(_ALIASES.keys(), key=len, reverse=True):
        if alias in q:
            canonical = _ALIASES[alias]
            # confirm the column actually exists in this dataset
            if canonical in available_columns:
                target_col = canonical
                break
            # try case-insensitive match against available columns
            if canonical.lower() in available_lower:
                target_col = available_lower[canonical.lower()]
                break

    # Fallback: scan available_columns directly
    if not target_col:
        for col in sorted(available_columns, key=len, reverse=True):
            if col.lower() in q and col in _NUMERIC_AGG_COLS:
                target_col = col
                break

    if not target_col:
        print(f"[aggregation] intent detected ({agg_type}) but no matching column found in query: {query!r}",
              file=sys.stderr, flush=True)
        return {"has_agg": False}

    print(f"[aggregation] intent={agg_type} n={n} column={target_col!r} query={query!r}",
          file=sys.stderr, flush=True)
    return {
        "has_agg":        True,
        "type":           agg_type,
        "column":         target_col,
        "n":              n,
        "original_query": query,
    }


def apply_aggregation(df: pd.DataFrame, agg_intent: dict) -> dict:
    """
    Apply aggregation to *df* according to *agg_intent*.

    Parameters
    ----------
    df         : DataFrame — either the full dataset or the already-filtered subset
    agg_intent : dict from detect_aggregation_intent

    Returns a MATRIYA-compatible result dict (decision = "AGGREGATION_RESULT").
    Never raises — all errors are returned as structured dicts.
    """
    col      = agg_intent["column"]
    agg_type = agg_intent["type"]
    n        = agg_intent.get("n", 1)
    query    = agg_intent.get("original_query", "")

    if col not in df.columns:
        return {
            "decision":    "NO_MATCHES",
            "quality":     "COLUMN_NOT_FOUND",
            "warnings":    [f"Aggregation column '{col}' not found in dataset."],
            "evidence":    {"matched_rows": 0, "result_preview": [], "columns_returned": []},
            "data_source": "DB_COMPUTED",
            "confidence":  "LOW",
            "tag":         "computed",
        }

    # Work on a numeric, non-null copy — never mutate caller's df
    work = df.copy()
    work[col] = pd.to_numeric(work[col], errors="coerce")
    work = work[work[col].notna()]

    if len(work) == 0:
        return {
            "decision":    "NO_MATCHES",
            "quality":     "NO_NUMERIC_DATA",
            "warnings":    [f"No numeric values found in column '{col}'."],
            "evidence":    {"matched_rows": 0, "result_preview": [], "columns_returned": []},
            "data_source": "DB_COMPUTED",
            "confidence":  "LOW",
            "tag":         "computed",
        }

    # ── Run aggregation ────────────────────────────────────────────────────
    if agg_type in ("max", "top_n"):
        result_df = work.nlargest(n, col)
        label = "highest"
    else:
        result_df = work.nsmallest(n, col)
        label = "lowest"

    best_row   = result_df.iloc[0]
    best_val   = best_row[col]
    best_id    = best_row.get("experiment_id", "?") if hasattr(best_row, "get") else best_row["experiment_id"]

    # Human-readable summary (used by Node.js for the answer text)
    if n == 1:
        summary = f"{best_id} has the {label} {col}: {best_val}"
    else:
        entries = ", ".join(
            f"{r.get('experiment_id', '?')} ({r[col]})"
            for r in result_df.to_dict(orient="records")
        )
        summary = f"Top {n} experiments by {col} ({label}): {entries}"

    print(f"[aggregation] result: {summary}", file=sys.stderr, flush=True)

    return {
        "decision":    "AGGREGATION_RESULT",
        "quality":     "COMPLETE",
        "warnings":    [],
        "evidence":    {
            "matched_rows":       len(result_df),
            "total_rows":         len(df),
            "agg_type":           agg_type,
            "agg_column":         col,
            "agg_n":              n,
            "best_value":         best_val,
            "best_experiment_id": best_id,
            "summary":            summary,
            "result_preview":     result_df.to_dict(orient="records"),
            "columns_returned":   list(result_df.columns),
            "filters_applied":    [],
        },
        "data_source": "DB_COMPUTED",
        "confidence":  "HIGH",
        "tag":         "computed",
    }
