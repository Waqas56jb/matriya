"""
MATRIYA v0.1 — Supabase Lab Connector
======================================
Connects to the live Supabase `experiments` table and returns
normalized DataFrames for the science pipeline.

Two modes:
  SupabaseLabConnector(client=supabase_client)           — live Supabase connection
  SupabaseLabConnector(client=MockSupabaseClient(data))  — deterministic testing

The connector always returns normalized column names via lab_schema_normalizer.
David confirmation: rows_to_dataframe() is wired inside get_all_experiments_as_dataframe().
"""

import os
from typing import Optional

from lab_schema_normalizer import rows_to_dataframe, flatten_experiment_row


# ─────────────────────────────────────────────────────────
# LIVE CONNECTOR
# ─────────────────────────────────────────────────────────
class SupabaseLabConnector:
    """
    Wraps a Supabase Python client to fetch lab experiment data.

    Usage (live):
        from supabase import create_client
        client = create_client(SUPABASE_URL, SUPABASE_KEY)
        connector = SupabaseLabConnector(client=client)

    Usage (testing):
        connector = SupabaseLabConnector(client=MockSupabaseClient(seed_data))
    """

    def __init__(self, client=None):
        self._client = client

    def get_all_experiments_as_dataframe(self, project_id: str) -> dict:
        """
        Fetch all experiments for a project from Supabase and return a
        normalized DataFrame.

        David confirmation: rows_to_dataframe is wired here:
            from lab_schema_normalizer import rows_to_dataframe
            df = rows_to_dataframe(resp.data)

        Returns:
            {
              "decision": "OK" | "INSUFFICIENT_DATA",
              "n_rows":   int,
              "df":       pd.DataFrame | None,
              "evidence": dict
            }
        """
        if self._client is None:
            return {
                "decision": "INSUFFICIENT_DATA",
                "n_rows":   0,
                "df":       None,
                "evidence": {"reason": "No Supabase client configured"},
            }

        try:
            resp = (
                self._client
                .table("experiments")
                .select("*")
                .eq("project_id", project_id)
                .execute()
            )
            raw_rows = resp.data if hasattr(resp, "data") else []
        except Exception as e:
            return {
                "decision": "INSUFFICIENT_DATA",
                "n_rows":   0,
                "df":       None,
                "evidence": {"reason": f"Supabase fetch error: {e}"},
            }

        if not raw_rows:
            return {
                "decision": "INSUFFICIENT_DATA",
                "n_rows":   0,
                "df":       None,
                "evidence": {"reason": f"No experiments found for project_id={project_id}"},
            }

        # ── Normalize via lab_schema_normalizer ────────────────────────────
        # David requirement: rows_to_dataframe() called here.
        df = rows_to_dataframe(raw_rows)

        return {
            "decision": "OK",
            "n_rows":   len(df),
            "df":       df,
            "evidence": {
                "project_id":   project_id,
                "columns":      list(df.columns),
                "n_raw_rows":   len(raw_rows),
            },
        }

    def get_experiment_by_id(self, experiment_id: str) -> Optional[dict]:
        """Fetch and normalize a single experiment row by experiment_id."""
        if self._client is None:
            return None
        try:
            resp = (
                self._client
                .table("experiments")
                .select("*")
                .eq("experiment_id", experiment_id)
                .limit(1)
                .execute()
            )
            rows = resp.data if hasattr(resp, "data") else []
            if rows:
                return flatten_experiment_row(rows[0])
        except Exception:
            pass
        return None


# ─────────────────────────────────────────────────────────
# MOCK QUERY BUILDER (minimal Supabase chain)
# ─────────────────────────────────────────────────────────
class _MockQueryBuilder:
    """Minimal mock for Supabase fluent query-builder chain."""

    def __init__(self, data: list):
        self._data    = list(data)
        self._filters = {}

    def select(self, *args, **kwargs):
        return self

    def eq(self, col: str, val):
        self._filters[col] = val
        return self

    def limit(self, n: int):
        return self

    def execute(self):
        filtered = self._data
        for col, val in self._filters.items():
            filtered = [r for r in filtered if r.get(col) == val]

        class _Result:
            def __init__(self, data):
                self.data = data

        return _Result(filtered)


# ─────────────────────────────────────────────────────────
# MOCK SUPABASE CLIENT
# ─────────────────────────────────────────────────────────
class MockSupabaseClient:
    """
    In-memory mock Supabase client for deterministic testing.
    Supports: .table().select().eq().limit().execute()
    """

    def __init__(self, seed_data: list = None):
        self._tables = {
            "experiments": seed_data or [],
        }

    def table(self, name: str) -> _MockQueryBuilder:
        return _MockQueryBuilder(self._tables.get(name, []))


# ─────────────────────────────────────────────────────────
# SEED DATA  (matches MATRIYA Excel template columns)
# ─────────────────────────────────────────────────────────
def make_seed_data() -> list:
    """
    Representative experiment rows in Supabase storage format.
    Covers PASS, FAIL, and boundary cases for deterministic testing.
    """
    return [
        {
            "id":              "EXP-001",
            "experiment_id":   "EXP-001",
            "project_id":      "INT-TFX",
            "APP_pct":         45.2,
            "PER_pct":         20.0,
            "MEL_pct":         10.0,
            "app_per":         2.26,
            "IFR":             75.2,
            "Nanoclay":        2.0,
            "expansion_ratio": 18.5,
            "char_quality":    "good",
            "adhesion":        4.2,
            "viscosity":       1200,
            "status":          "PASS",
        },
        {
            "id":              "EXP-002",
            "experiment_id":   "EXP-002",
            "project_id":      "INT-TFX",
            "APP_pct":         40.0,
            "PER_pct":         20.0,
            "MEL_pct":         10.0,
            "app_per":         2.0,
            "IFR":             70.0,
            "Nanoclay":        2.0,
            "expansion_ratio": 12.0,
            "char_quality":    "moderate",
            "adhesion":        3.8,
            "viscosity":       1100,
            "status":          "PASS",
        },
        {
            "id":              "EXP-003",
            "experiment_id":   "EXP-003",
            "project_id":      "INT-TFX",
            "APP_pct":         30.0,
            "PER_pct":         20.0,
            "MEL_pct":         10.0,
            "app_per":         1.5,
            "IFR":             60.0,
            "Nanoclay":        2.0,
            "expansion_ratio": 6.5,
            "char_quality":    "poor",
            "adhesion":        3.0,
            "viscosity":       950,
            "status":          "FAIL",
        },
        {
            "id":              "EXP-004",
            "experiment_id":   "EXP-004",
            "project_id":      "INT-TFX",
            "APP_pct":         25.0,
            "PER_pct":         20.0,
            "MEL_pct":         10.0,
            "app_per":         1.25,
            "IFR":             55.0,
            "Nanoclay":        2.0,
            "expansion_ratio": 4.2,
            "char_quality":    "very_poor",
            "adhesion":        2.5,
            "viscosity":       800,
            "status":          "FAIL",
        },
        {
            "id":              "EXP-005",
            "experiment_id":   "EXP-005",
            "project_id":      "INT-TFX",
            "APP_pct":         48.0,
            "PER_pct":         20.0,
            "MEL_pct":         12.0,
            "app_per":         2.4,
            "IFR":             80.0,
            "Nanoclay":        3.0,
            "expansion_ratio": 22.0,
            "char_quality":    "excellent",
            "adhesion":        4.8,
            "viscosity":       1350,
            "status":          "PASS",
        },
    ]


# ─────────────────────────────────────────────────────────
# TESTS
# ─────────────────────────────────────────────────────────
def run_tests():
    print("=" * 60)
    print("Lab Connector — Tests")
    print("=" * 60)
    passed = failed = 0

    seed = make_seed_data()
    mock = MockSupabaseClient(seed_data=seed)
    conn = SupabaseLabConnector(client=mock)

    # Test 1: Fetch returns OK
    result = conn.get_all_experiments_as_dataframe("INT-TFX")
    ok1 = result["decision"] == "OK" and result["n_rows"] == len(seed)
    print(f"{'OK' if ok1 else 'FAIL'} Fetch: decision={result['decision']} rows={result['n_rows']}")
    if ok1: passed += 1
    else:   failed += 1

    # Test 2: DataFrame has canonical columns including APP:PER
    df = result["df"]
    ok2 = df is not None and "APP:PER" in df.columns and "IFR" in df.columns
    print(f"{'OK' if ok2 else 'FAIL'} Canonical columns present: {list(df.columns) if df is not None else 'None'}")
    if ok2: passed += 1
    else:   failed += 1

    # Test 3: rows_to_dataframe wired — APP:PER computed correctly for EXP-001
    row1 = df[df["experiment_id"] == "EXP-001"].iloc[0]
    ok3 = abs(row1["APP:PER"] - 2.26) < 0.01
    print(f"{'OK' if ok3 else 'FAIL'} EXP-001 APP:PER = {row1['APP:PER']} (expected 2.26)")
    if ok3: passed += 1
    else:   failed += 1

    # Test 4: Empty project returns INSUFFICIENT_DATA
    result2 = conn.get_all_experiments_as_dataframe("NONEXISTENT")
    ok4 = result2["decision"] == "INSUFFICIENT_DATA"
    print(f"{'OK' if ok4 else 'FAIL'} Empty project → INSUFFICIENT_DATA")
    if ok4: passed += 1
    else:   failed += 1

    # Test 5: get_experiment_by_id
    exp = conn.get_experiment_by_id("EXP-002")
    ok5 = exp is not None and exp.get("APP:PER") is not None
    print(f"{'OK' if ok5 else 'FAIL'} get_experiment_by_id: APP:PER={exp.get('APP:PER') if exp else None}")
    if ok5: passed += 1
    else:   failed += 1

    print(f"\n{'OK' if failed == 0 else 'FAIL'} {passed}/{passed+failed} passed")
    return passed, failed


if __name__ == "__main__":
    run_tests()
