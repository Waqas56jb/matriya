"""
MATRIYA v0.1 — Lab Schema Normalizer
======================================
Normalizes raw Supabase experiment row column names to canonical form.

Canonical column names used throughout the science pipeline:
  experiment_id  — unique row identifier
  APP            — Ammonium Polyphosphate content (%)
  PER            — Pentaerythritol content (%)
  MEL            — Melamine content (%)
  APP:PER        — APP/PER ratio (computed if missing)
  IFR            — Total intumescent content = APP+PER+MEL (computed if missing)
  Nanoclay       — Nanoclay / Cloisite loading (%)
  expansion_ratio— Key fire-test outcome
  char_quality   — Qualitative char assessment
  adhesion       — Coating adhesion score
  viscosity      — Rheology measurement
  status         — PASS | FAIL | PENDING
  project_id     — parent project identifier
"""

import pandas as pd
from typing import Optional


# ─────────────────────────────────────────────────────────
# COLUMN NAME MAPPING (raw → canonical)
# ─────────────────────────────────────────────────────────
COLUMN_MAP = {
    # Experiment identifiers
    "id":                  "experiment_id",
    "exp_id":              "experiment_id",
    "experiment_id":       "experiment_id",

    # APP — Ammonium Polyphosphate
    "app_pct":             "APP",
    "APP_pct":             "APP",
    "app":                 "APP",
    "APP":                 "APP",

    # PER — Pentaerythritol
    "per_pct":             "PER",
    "PER_pct":             "PER",
    "per":                 "PER",
    "PER":                 "PER",

    # MEL — Melamine
    "mel_pct":             "MEL",
    "MEL_pct":             "MEL",
    "mel":                 "MEL",
    "MEL":                 "MEL",

    # APP:PER ratio (may be stored or computed)
    "app_per":             "APP:PER",
    "APP_PER":             "APP:PER",
    "app:per":             "APP:PER",
    "APP:PER":             "APP:PER",
    "app_per_ratio":       "APP:PER",
    "app_to_per":          "APP:PER",

    # IFR — Intumescent Fire Retardant total
    "ifr":                 "IFR",
    "IFR":                 "IFR",
    "i_fr":                "IFR",
    "ifr_pct":             "IFR",
    "total_fr":            "IFR",

    # Nanoclay
    "nanoclay":            "Nanoclay",
    "nanoclay_pct":        "Nanoclay",
    "clay":                "Nanoclay",
    "cloisite":            "Nanoclay",

    # Key fire-test outcome
    "expansion_ratio":     "expansion_ratio",
    "exp_ratio":           "expansion_ratio",
    "expansion":           "expansion_ratio",
    "char_expansion":      "expansion_ratio",

    # Char quality
    "char_quality":        "char_quality",
    "char":                "char_quality",
    "char_assessment":     "char_quality",

    # Adhesion
    "adhesion":            "adhesion",
    "adhesion_score":      "adhesion",

    # Viscosity
    "viscosity":           "viscosity",
    "visc":                "viscosity",
    "viscosity_cps":       "viscosity",

    # Status / result
    "status":              "status",
    "result":              "status",
    "test_result":         "status",

    # Project / case
    "project_id":          "project_id",
    "case_id":             "case_id",

    # Timestamps (pass through)
    "created_at":          "created_at",
    "updated_at":          "updated_at",
}


def normalize_column_name(col: str) -> str:
    """
    Map a raw column name to its canonical form.
    Falls back to the original name if no mapping is found.
    """
    if col in COLUMN_MAP:
        return COLUMN_MAP[col]
    col_lower = col.lower()
    for raw, canonical in COLUMN_MAP.items():
        if raw.lower() == col_lower:
            return canonical
    return col


def flatten_experiment_row(row: dict) -> dict:
    """
    Normalize all column names in a Supabase experiment row.

    - Applies COLUMN_MAP to every key.
    - Computes APP:PER from APP/PER if the ratio column is absent.
    - Computes IFR from APP+PER+MEL if the total column is absent.

    Returns a flat dict with canonical column names.
    """
    if not row:
        return {}

    flat: dict = {}
    for col, val in row.items():
        canonical = normalize_column_name(col)
        if canonical not in flat:           # first mapping wins
            flat[canonical] = val

    # Derive APP:PER if absent
    if "APP:PER" not in flat:
        app = flat.get("APP")
        per = flat.get("PER")
        if app is not None and per is not None:
            try:
                per_f = float(per)
                if per_f > 0:
                    flat["APP:PER"] = round(float(app) / per_f, 4)
            except (TypeError, ValueError, ZeroDivisionError):
                pass

    # Derive IFR if absent
    if "IFR" not in flat:
        app = flat.get("APP")
        per = flat.get("PER")
        mel = flat.get("MEL")
        if app is not None and per is not None and mel is not None:
            try:
                flat["IFR"] = round(float(app) + float(per) + float(mel), 4)
            except (TypeError, ValueError):
                pass

    return flat


def rows_to_dataframe(rows: list) -> pd.DataFrame:
    """
    Convert a list of raw Supabase experiment rows to a normalized DataFrame.

    Wired inside SupabaseLabConnector.get_all_experiments_as_dataframe():
        from lab_schema_normalizer import rows_to_dataframe
        df = rows_to_dataframe(resp.data)

    Steps:
    1. Normalize every row via flatten_experiment_row()
    2. Build DataFrame from normalized dicts
    3. Drop rows where ALL science columns are null

    Returns a pandas DataFrame with canonical column names.
    """
    if not rows:
        return pd.DataFrame()

    normalized = [flatten_experiment_row(r) for r in rows]
    df = pd.DataFrame(normalized)

    # Drop rows completely empty of science measurements
    science_cols = [
        c for c in ["APP:PER", "IFR", "expansion_ratio", "char_quality"]
        if c in df.columns
    ]
    if science_cols:
        df = df.dropna(subset=science_cols, how="all")

    return df


# ─────────────────────────────────────────────────────────
# TESTS
# ─────────────────────────────────────────────────────────
def run_tests():
    print("=" * 60)
    print("Lab Schema Normalizer — Tests")
    print("=" * 60)
    passed = failed = 0

    # Test 1: APP_pct → APP
    row = {"id": "EXP-001", "APP_pct": 45.2, "PER_pct": 20.0, "MEL_pct": 10.0,
           "expansion_ratio": 18.5, "char_quality": "good", "status": "PASS"}
    flat = flatten_experiment_row(row)
    ok1 = flat.get("APP") == 45.2 and flat.get("PER") == 20.0
    print(f"{'OK' if ok1 else 'FAIL'} APP_pct/PER_pct normalized: APP={flat.get('APP')}")
    if ok1: passed += 1
    else:   failed += 1

    # Test 2: APP:PER computed
    ok2 = abs(flat.get("APP:PER", 0) - round(45.2 / 20.0, 4)) < 1e-6
    print(f"{'OK' if ok2 else 'FAIL'} APP:PER computed: {flat.get('APP:PER')} (expected {round(45.2/20.0,4)})")
    if ok2: passed += 1
    else:   failed += 1

    # Test 3: IFR computed
    expected_ifr = round(45.2 + 20.0 + 10.0, 4)
    ok3 = abs(flat.get("IFR", 0) - expected_ifr) < 1e-6
    print(f"{'OK' if ok3 else 'FAIL'} IFR computed: {flat.get('IFR')} (expected {expected_ifr})")
    if ok3: passed += 1
    else:   failed += 1

    # Test 4: APP:PER not overwritten when already present
    row2 = {"APP_pct": 45.2, "PER_pct": 20.0, "app_per": 2.26}
    flat2 = flatten_experiment_row(row2)
    ok4 = flat2.get("APP:PER") == 2.26
    print(f"{'OK' if ok4 else 'FAIL'} Existing APP:PER preserved: {flat2.get('APP:PER')}")
    if ok4: passed += 1
    else:   failed += 1

    # Test 5: rows_to_dataframe produces canonical columns
    rows = [
        {"id": "EXP-001", "APP_pct": 45.2, "PER_pct": 20.0, "MEL_pct": 10.0,
         "expansion_ratio": 18.5, "status": "PASS"},
        {"id": "EXP-002", "APP_pct": 40.0, "PER_pct": 20.0, "MEL_pct": 10.0,
         "expansion_ratio": 12.0, "status": "PASS"},
    ]
    df = rows_to_dataframe(rows)
    ok5 = "APP" in df.columns and "APP:PER" in df.columns and "IFR" in df.columns
    print(f"{'OK' if ok5 else 'FAIL'} DataFrame columns: {list(df.columns)}")
    if ok5: passed += 1
    else:   failed += 1

    # Test 6: normalize_column_name round-trip
    ok6 = (normalize_column_name("app_per") == "APP:PER" and
           normalize_column_name("APP:PER") == "APP:PER" and
           normalize_column_name("expansion_ratio") == "expansion_ratio" and
           normalize_column_name("unknown_col") == "unknown_col")
    print(f"{'OK' if ok6 else 'FAIL'} normalize_column_name round-trip")
    if ok6: passed += 1
    else:   failed += 1

    print(f"\n{'OK' if failed == 0 else 'FAIL'} {passed}/{passed+failed} passed")
    return passed, failed


if __name__ == "__main__":
    run_tests()
