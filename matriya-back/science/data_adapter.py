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

import sys
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

    # Detect file type: CSV exports from Supabase already have canonical headers
    # at row 0 and do not need the header-2 offset or column renaming.
    is_csv = path.suffix.lower() == '.csv'

    try:
        if is_csv:
            df = pd.read_csv(filepath, dtype=str)
        else:
            # The MATRIYA Excel template has 2 merged header rows;
            # actual headers are on row index 2.
            df = pd.read_excel(filepath, sheet_name=sheet_index, header=2)
    except Exception as e:
        return {"error": str(e)}

    raw_columns = list(df.columns)
    rows_loaded = len(df)

    # ── STEP 1 DIAGNOSTIC ───────────────────────────────────────────────────
    print(f"[data_adapter] STEP1 — RAW rows loaded: {rows_loaded}", file=sys.stderr, flush=True)
    print(f"[data_adapter] STEP1 — RAW columns: {raw_columns}", file=sys.stderr, flush=True)
    if rows_loaded > 0:
        print(f"[data_adapter] STEP1 — RAW sample row: {df.iloc[0].to_dict()}", file=sys.stderr, flush=True)
    # ────────────────────────────────────────────────────────────────────────

    # Drop fully empty rows — keep a row if ANY known lab column has data.
    # Previous bug: only APP/PER/APP:PER were checked, so rows with only
    # expansion_ratio data were silently dropped.
    ALL_LAB_CANDIDATES = [
        "APP", "PER", "APP:PER", "MEL", "IFR", "Nanoclay",
        "expansion_ratio", "adhesion", "viscosity",
    ]
    if is_csv:
        numeric_candidates = [c for c in ALL_LAB_CANDIDATES if c in df.columns]
    else:
        numeric_candidates = [c for c in ["APP_pct", "PER_pct", "MEL_pct"] if c in df.columns]

    if numeric_candidates:
        before_drop = len(df)
        df = df.dropna(subset=numeric_candidates, how="all")
        after_drop = len(df)
        # ── STEP 2 DIAGNOSTIC ────────────────────────────────────────────────
        print(f"[data_adapter] STEP2 — after dropna: {after_drop} rows (dropped {before_drop - after_drop})", file=sys.stderr, flush=True)
        print(f"[data_adapter] STEP2 — dropna subset: {numeric_candidates}", file=sys.stderr, flush=True)
        # ─────────────────────────────────────────────────────────────────────
    elif "experiment_id" in df.columns:
        before_drop = len(df)
        df = df.dropna(subset=["experiment_id"])
        print(f"[data_adapter] STEP2 — after experiment_id dropna: {len(df)} rows (was {before_drop})", file=sys.stderr, flush=True)

    rows_valid = len(df)

    # Rename raw columns to canonical names (Excel template only; CSV is already canonical)
    if not is_csv:
        rename_map = {k: v for k, v in COLUMN_RENAME_MAP.items() if k in df.columns}
        df = df.rename(columns=rename_map)

    computed_columns = []

    # Compute APP:PER ratio (skip if already present in canonical CSV)
    if "APP:PER" not in df.columns:
        if "APP" in df.columns and "PER" in df.columns:
            df["PER_safe"] = pd.to_numeric(df["PER"], errors="coerce").replace(0, float("nan"))
            df["APP:PER"] = pd.to_numeric(df["APP"], errors="coerce") / df["PER_safe"]
            df["APP:PER"] = df["APP:PER"].round(4)
            df.drop(columns=["PER_safe"], inplace=True)
            computed_columns.append("APP:PER")
        else:
            warnings.append("Cannot compute APP:PER — APP or PER column missing")

    # Compute IFR (total intumescent flame retardant loading; skip if already present)
    if "IFR" not in df.columns:
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
                "expansion_ratio", "HRR_reduction_pct", "adhesion", "viscosity"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    canonical_columns = list(df.columns)
    required = ["APP:PER", "IFR"]
    missing  = [c for c in required if c not in canonical_columns]

    # ── STEP 3 DIAGNOSTIC ───────────────────────────────────────────────────
    print(f"[data_adapter] STEP3 — FINAL df shape: {df.shape}", file=sys.stderr, flush=True)
    print(f"[data_adapter] STEP3 — FINAL columns: {canonical_columns}", file=sys.stderr, flush=True)
    if len(df) > 0:
        print(f"[data_adapter] STEP3 — FINAL sample: {df.iloc[0].to_dict()}", file=sys.stderr, flush=True)
    else:
        print(f"[data_adapter] STEP3 — DF IS EMPTY — all rows were dropped!", file=sys.stderr, flush=True)
    print(f"[data_adapter] STEP3 — expansion_ratio non-null: {df['expansion_ratio'].notna().sum() if 'expansion_ratio' in df.columns else 'N/A'}", file=sys.stderr, flush=True)
    # ────────────────────────────────────────────────────────────────────────

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
