"""
MATRIYA v0.1 — Data Adapter
============================
Transforms raw MATRIYA Excel template format into the canonical
column schema expected by table_query_engine_final.py.

Raw Excel columns  →  Canonical columns
─────────────────────────────────────────
APP_pct            →  APP
PER_pct            →  PER
MEL_pct            →  MEL
Nanoclay_pct       →  Nanoclay
result_status      →  status
computed: APP/PER  →  APP:PER
computed: APP+PER+MEL → IFR

Integration bug fix:
The MATRIYA_Experiment_Template-1.xlsx uses _pct suffixed columns
and does not pre-compute APP:PER or IFR.
This adapter bridges the raw data format to the query engine schema.
"""

import pandas as pd
from pathlib import Path


# Map: raw column → canonical column
COLUMN_RENAME_MAP = {
    "APP_pct":      "APP",
    "PER_pct":      "PER",
    "MEL_pct":      "MEL",
    "Nanoclay_pct": "Nanoclay",
    "result_status": "status",
}


def load_and_adapt(filepath: str, sheet_index: int = 0) -> dict:
    """
    Load MATRIYA Excel template and transform to canonical schema.

    Returns:
        {
          "df":            pd.DataFrame with canonical columns,
          "raw_columns":   list,
          "canonical_columns": list,
          "rows_loaded":   int,
          "rows_valid":    int,
          "computed_columns": list,
          "schema_valid":  bool,
          "missing_required": list,
          "warnings":      list,
        }
    """
    path = Path(filepath)
    if not path.exists():
        return {"error": f"File not found: {filepath}"}

    warnings = []

    try:
        # The template has 2 merged header rows; actual headers are on row index 2
        df = pd.read_excel(filepath, sheet_name=sheet_index, header=2)
    except Exception as e:
        return {"error": str(e)}

    raw_columns = list(df.columns)
    rows_loaded = len(df)

    # Drop fully empty rows (template placeholders)
    # A row is valid if experiment_id is present and at least one numeric col is filled
    numeric_candidates = [c for c in ["APP_pct", "PER_pct", "MEL_pct"] if c in df.columns]
    if numeric_candidates:
        df = df.dropna(subset=numeric_candidates, how="all")
    else:
        df = df.dropna(subset=["experiment_id"])

    rows_valid = len(df)

    # Rename raw columns to canonical names
    rename_map = {k: v for k, v in COLUMN_RENAME_MAP.items() if k in df.columns}
    df = df.rename(columns=rename_map)

    computed_columns = []

    # Compute APP:PER ratio
    if "APP" in df.columns and "PER" in df.columns:
        df["PER_safe"] = pd.to_numeric(df["PER"], errors="coerce").replace(0, float("nan"))
        df["APP:PER"] = pd.to_numeric(df["APP"], errors="coerce") / df["PER_safe"]
        df["APP:PER"] = df["APP:PER"].round(4)
        df.drop(columns=["PER_safe"], inplace=True)
        computed_columns.append("APP:PER")
    else:
        warnings.append("Cannot compute APP:PER — APP or PER column missing")

    # Compute IFR (total intumescent flame retardant loading)
    ifr_parts = [c for c in ["APP", "PER", "MEL"] if c in df.columns]
    if len(ifr_parts) == 3:
        df["IFR"] = (
            pd.to_numeric(df["APP"], errors="coerce").fillna(0) +
            pd.to_numeric(df["PER"], errors="coerce").fillna(0) +
            pd.to_numeric(df["MEL"], errors="coerce").fillna(0)
        ).round(4)
        computed_columns.append("IFR")
    else:
        warnings.append(f"Cannot compute IFR — only found: {ifr_parts}")

    # Coerce all numeric columns
    for col in ["APP", "PER", "MEL", "Nanoclay", "APP:PER", "IFR",
                "expansion_ratio", "HRR_reduction_pct"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    canonical_columns = list(df.columns)
    required = ["APP:PER", "IFR"]
    missing  = [c for c in required if c not in canonical_columns]

    return {
        "df":                 df,
        "raw_columns":        raw_columns,
        "canonical_columns":  canonical_columns,
        "rows_loaded":        rows_loaded,
        "rows_valid":         rows_valid,
        "computed_columns":   computed_columns,
        "schema_valid":       len(missing) == 0,
        "missing_required":   missing,
        "warnings":           warnings,
    }


def get_adapted_df(filepath: str, sheet_index: int = 0) -> pd.DataFrame:
    """Convenience: returns just the DataFrame, or raises on error."""
    result = load_and_adapt(filepath, sheet_index)
    if "error" in result:
        raise ValueError(result["error"])
    return result["df"]
