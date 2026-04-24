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


# ── Change 2: normalize_condition ────────────────────────────────────────────
def normalize_condition(cond: str) -> str:
    """
    Normalise a condition string before passing it to df.query().

    Rules:
      1. Replace bare '=' with '==' (but leave >=, <=, != untouched).
      2. Quote bare identifier values so pandas.query() treats them as strings
         rather than column references.
         e.g.  binder == K52  →  binder == "K52"
    """
    # Rule 1 — = → == (not preceded or followed by another operator char)
    cond = re.sub(r'(?<![<>!])=(?!=)', '==', cond)
    # Rule 2 — quote bare word on the RHS of ==
    cond = re.sub(r'(\b\w+\b\s*==\s*)([A-Za-z_]\w*)', r'\1"\2"', cond)
    return cond.strip()


# ── Change 3: SORT_PATTERNS (tighter sort detection via regex) ────────────────
SORT_PATTERNS = [
    r'^\s*by\s+\w+',
    r'sort(?:ed)?\s+by\s+\w+',
    r'order\s+by\s+\w+',
    r'rank(?:ed)?\s+by\s+\w+',
]


def has_sort_intent(query: str) -> bool:
    """Return True if the query contains a sort/rank/order-by phrase."""
    return any(re.search(p, query, re.IGNORECASE) for p in SORT_PATTERNS)


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

# "lowest X among top 3 by Y" / "highest X among top 3 by Y" [where ...]
_COMPOUND_MIN = re.compile(
    r'(?:^|\s)(?P<dir>lowest|minimum|min|smallest)\s+'
    r'(?P<final>[\w: ]+?)\s+among\s+top\s+(?P<n>\d+)\s+by\s+'
    r'(?P<rank>[\w: ]+?)(?=\s+where\b|\s*$)',
    re.IGNORECASE,
)
_COMPOUND_MAX = re.compile(
    r'(?:^|\s)(?P<dir>highest|maximum|max|largest|best)\s+'
    r'(?P<final>[\w: ]+?)\s+among\s+top\s+(?P<n>\d+)\s+by\s+'
    r'(?P<rank>[\w: ]+?)(?=\s+where\b|\s*$)',
    re.IGNORECASE,
)
_RANK_BY = re.compile(
    r'(?:^|\s)(?:experiments?|formulations?|rows?|results?)\s+by\s+'
    r'(?P<rank>[\w: ]+?)(?=\s+where\b|\s*$)',
    re.IGNORECASE,
)


def _resolve_col_token(token: str, available_columns: list) -> str | None:
    """Map a free-text token to a column name present in the DataFrame."""
    if not token:
        return None
    raw = token.strip()
    nkey = re.sub(r"\s+", " ", raw.lower().strip())
    n_under = nkey.replace(" ", "_")
    for alias, canonical in _ALIASES.items():
        if alias == nkey or alias.replace(" ", "_") == n_under:
            if canonical in available_columns:
                return canonical
    for c in available_columns:
        if c.lower() == n_under or c.lower() == nkey.replace(" ", ""):
            return c
    if n_under in [x.lower() for x in available_columns]:
        for c in available_columns:
            if c.lower() == n_under:
                return c
    # Normalise APP:PER style colons / underscores — "app per" vs "app:per"
    t_norm = n_under.replace(":", "_").replace(" ", "_")
    for c in available_columns:
        c_norm = c.replace(":", "_").lower()
        if c_norm == t_norm or c.lower().replace(":", "") == n_under.replace(":", ""):
            return c
    return None


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

    # ── COMPOUND (checked FIRST — must beat simple "top 3" + "lowest" heuristics) ─
    # Example: "lowest expansion_ratio among top 3 by adhesion where viscosity > 1400"
    #   → filter → rank top 3 by adhesion → MIN(expansion_ratio) on those 3 rows
    m_min = _COMPOUND_MIN.search(" " + q)
    m_max = _COMPOUND_MAX.search(" " + q) if not m_min else None
    m_c = m_min or m_max
    if m_c:
        final_tok = m_c.group("final").strip()
        rank_tok = m_c.group("rank").strip()
        n = int(m_c.group("n"))
        final_is_max = m_max is not None
        final_col = _resolve_col_token(final_tok, available_columns)
        rank_col = _resolve_col_token(rank_tok, available_columns)
        if final_col and rank_col and n > 0:
            print(
                f"[aggregation] COMPOUND final={'max' if final_is_max else 'min'}({final_col}) "
                f"among top {n} by {rank_col} query={query!r}",
                file=sys.stderr, flush=True,
            )
            return {
                "has_agg":         True,
                "compound":      True,
                "final_agg":       "max" if final_is_max else "min",
                "final_column":  final_col,
                "rank_n":        n,
                "rank_column":   rank_col,
                "original_query": query,
            }
        # Pattern is clearly compound — never fall through to "top N by wrong column"
        print(
            f"[aggregation] COMPOUND query but column map failed: "
            f"final_tok={final_tok!r}→{final_col!r} rank_tok={rank_tok!r}→{rank_col!r} "
            f"available={list(available_columns)}",
            file=sys.stderr, flush=True,
        )
        return {
            "has_agg":                 True,
            "compound":                True,
            "column_resolution_failed": True,
            "original_query":          query,
        }

    # ── SIMPLE RANKING: "experiments by adhesion" -> rank descending by column ──
    m_rank = _RANK_BY.search(" " + q)
    if m_rank:
        rank_tok = m_rank.group("rank").strip()
        rank_col = _resolve_col_token(rank_tok, available_columns)
        if rank_col:
            print(
                f"[aggregation] RANK_BY column={rank_col!r} query={query!r}",
                file=sys.stderr, flush=True,
            )
            return {
                "has_agg":        True,
                "type":           "rank_desc",
                "column":         rank_col,
                "n":              None,  # full list
                "original_query": query,
            }

    # ── Determine aggregation direction and N (simple / single-metric) ───────
    # If the user said "among top … by …", do not treat as simple top_n (avoids misfire).
    if re.search(r"among\s+top\s+\d+\s+by\s", q):
        return {"has_agg": False}

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
    elif any(re.search(r'\b' + kw + r'\b', q) for kw in ["highest", "maximum", "largest", "best", "max"]):
        agg_type = "max"
    elif any(re.search(r'\b' + kw + r'\b', q) for kw in ["lowest", "minimum", "smallest", "worst", "min"]):
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


def _apply_compound_aggregation(df: pd.DataFrame, agg_intent: dict, query: str) -> dict:
    """
    filter (already in *df*) → nlargest(N, rank_col) → min/max on final_col over that subset.

    Preserves the full ranked subset in *working_df* before the final reduce; never
    collapses to one row until after MIN/MAX is computed over all N rows.
    """
    rank_col = agg_intent["rank_column"]
    final_col = agg_intent["final_column"]
    n = int(agg_intent["rank_n"])
    final_op = agg_intent["final_agg"]  # "min" | "max"

    for c in (rank_col, final_col):
        if c not in df.columns:
            return {
                "decision":    "NO_MATCHES",
                "quality":     "COLUMN_NOT_FOUND",
                "warnings":    [f"Column '{c}' not found in dataset."],
                "evidence":    {"matched_rows": 0, "result_preview": [], "columns_returned": []},
                "data_source": "DB_COMPUTED",
                "confidence":  "LOW",
                "tag":         "computed",
            }

    work = df.copy()
    work[rank_col] = pd.to_numeric(work[rank_col], errors="coerce")
    work[final_col] = pd.to_numeric(work[final_col], errors="coerce")
    work = work[work[rank_col].notna() & work[final_col].notna()]

    if len(work) == 0:
        return {
            "decision":    "NO_MATCHES",
            "quality":     "NO_NUMERIC_DATA",
            "warnings":    [f"No numeric rows for {rank_col} and {final_col}."],
            "evidence":    {"matched_rows": 0, "result_preview": [], "columns_returned": []},
            "data_source": "DB_COMPUTED",
            "confidence":  "LOW",
            "tag":         "computed",
        }

    # Top N by rank column (largest = "top")
    ranked = work.nlargest(n, rank_col)
    working_df = ranked.copy()
    print(f"[DEBUG] AGG INPUT ROWS = {len(working_df)}", file=sys.stderr, flush=True)

    if len(working_df) == 0:
        return {
            "decision":    "NO_MATCHES",
            "quality":     "EMPTY_RANK",
            "warnings":    ["Ranked subset is empty after top-N."],
            "evidence":    {"matched_rows": 0, "result_preview": [], "columns_returned": []},
            "data_source": "DB_COMPUTED",
            "confidence":  "LOW",
            "tag":         "computed",
        }

    if final_op == "min":
        final_val = float(working_df[final_col].min())
        fin_idx = working_df[final_col].idxmin()
    else:
        final_val = float(working_df[final_col].max())
        fin_idx = working_df[final_col].idxmax()

    # Single answer row: the experiment that attains the final min/max (not "row 0" of rank)
    answer_df = working_df.loc[[fin_idx]]
    best_id = answer_df.iloc[0].get("experiment_id", "?")

    summary = (
        f"{('Lowest' if final_op == 'min' else 'Highest')} {final_col} among the top {len(working_df)} "
        f"by {rank_col}: {final_val} ({best_id})."
    )
    print(f"[aggregation] compound result: {summary}", file=sys.stderr, flush=True)

    return {
        "decision":    "AGGREGATION_RESULT",
        "quality":     "COMPLETE",
        "warnings":    [],
        "evidence":    {
            "matched_rows":         1,
            "total_rows":            len(df),
            "agg_pipeline":          "compound_rank_then_final",
            "agg_type":              "compound",
            "final_agg_op":          final_op,
            "final_column":         final_col,
            "rank_column":          rank_col,
            "rank_n":                n,
            "ranked_row_count":      len(working_df),
            "best_value":            final_val,
            "best_experiment_id":    best_id,
            "summary":               summary,
            "result_preview":        answer_df.to_dict(orient="records"),
            "ranked_subset_preview": working_df.to_dict(orient="records"),
            "columns_returned":      list(answer_df.columns),
            "filters_applied":       [],
        },
        "data_source": "DB_COMPUTED",
        "confidence":  "HIGH",
        "tag":         "computed",
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
    query = agg_intent.get("original_query", "")

    # ═══ COMPOUND: rank (top N by column A) then min/max (column B) on that subset ═══
    if agg_intent.get("compound"):
        return _apply_compound_aggregation(df, agg_intent, query)

    col      = agg_intent["column"]
    agg_type = agg_intent["type"]
    n        = agg_intent.get("n", 1)

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
    if agg_type == "rank_desc":
        result_df = work.sort_values(col, ascending=False)
        n = len(result_df)
        label = "ranked_desc"
    elif agg_type in ("max", "top_n"):
        result_df = work.nlargest(n, col)
        label = "highest"
    else:
        result_df = work.nsmallest(n, col)
        label = "lowest"

    best_row   = result_df.iloc[0]
    best_val   = best_row[col]
    best_id    = best_row.get("experiment_id", "?") if hasattr(best_row, "get") else best_row["experiment_id"]

    # Human-readable summary (used by Node.js for the answer text)
    if agg_type == "rank_desc":
        summary = f"Experiments ranked by {col} (highest first)."
    elif n == 1:
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
