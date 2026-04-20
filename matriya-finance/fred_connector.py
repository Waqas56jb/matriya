"""
fred_connector.py — FRED + SEC EDGAR Data Feed
Feeds macro data into trigger_monitor.py
FRED: Federal Reserve Economic Data (free API key)
SEC: EDGAR company filings (free; identify via User-Agent)
"""

import json
import os
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Optional

# ── FRED Config ───────────────────────────────────────────────────────
# Free API key: https://fred.stlouisfed.org/docs/api/api_key.html
# Set FRED_API_KEY in environment (e.g. matriya-finance/.env loaded by your runner).
FRED_BASE = "https://api.stlouisfed.org/fred/series/observations"

# ── FRED Series IDs ─────────────────────────────────────────────────
FRED_SERIES = {
    "FEDFUNDS": {"name": "Fed Funds Rate", "class": "Bf-m", "field": "rate_level"},
    "DGS10": {"name": "10Y Treasury Yield", "class": "Bf-m", "field": "yield_level"},
    "T10Y2Y": {"name": "10Y-2Y Spread", "class": "Bf-m", "field": "spread_bps"},
    "SOFR": {"name": "SOFR Rate", "class": "Bf-m", "field": "rate_level"},
    "DPSACBW027SBOG": {"name": "Bank Deposits", "class": "Bf-s", "field": "deposits_bn"},
    "WRMFSL": {"name": "Money Market Funds", "class": "Bf-m", "field": "mmf_level"},
    "CPIAUCSL": {"name": "CPI (monthly)", "class": "Bf-m", "field": "cpi_yoy"},
    "UNRATE": {"name": "Unemployment Rate", "class": "Bf-m", "field": "unrate"},
    "UMCSENT": {"name": "Consumer Sentiment", "class": "Bf-m", "field": "sentiment"},
}

FRED_TRIGGERS = {
    "T10Y2Y": {"inversion_threshold": -0.5, "trigger": "YIELD_CURVE_INVERSION"},
    "FEDFUNDS": {"spike_1m_bps": 50, "trigger": "RATE_SPIKE"},
    "DPSACBW027SBOG": {"drop_1w_pct": -1.0, "trigger": "DEPOSIT_OUTFLOW"},
    "CPIAUCSL": {"spike_1m_pct": 0.5, "trigger": "CPI_SPIKE"},
}


def _fred_api_key() -> str:
    return (os.environ.get("FRED_API_KEY") or "").strip()


def fetch_fred_series(series_id: str, limit: int = 5) -> Optional[list]:
    """Fetch last N observations from FRED for a series."""
    key = _fred_api_key()
    if not key:
        return None
    params = {
        "series_id": series_id,
        "api_key": key,
        "file_type": "json",
        "limit": str(limit),
        "sort_order": "desc",
        "observation_start": (datetime.now() - timedelta(days=180)).strftime("%Y-%m-%d"),
    }
    url = f"{FRED_BASE}?{urllib.parse.urlencode(params)}"
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            data = json.loads(resp.read().decode())
            obs = data.get("observations", [])
            return [o for o in obs if o.get("value") != "."]
    except Exception as e:
        print(f"[FRED] Error fetching {series_id}: {e}")
        return None


def get_fred_snapshot() -> dict:
    """
    Fetch current macro data from FRED.
    Returns dict formatted for trigger_monitor.run_monitor_cycle()
    """
    snapshot_ts = datetime.now(timezone.utc).isoformat()
    macro_data: dict = {}

    for series_id, meta in FRED_SERIES.items():
        obs = fetch_fred_series(series_id, limit=3)
        if not obs or len(obs) < 1:
            macro_data[series_id] = None
            continue

        latest_val = float(obs[0]["value"])
        latest_date = obs[0]["date"]
        prev_val = float(obs[1]["value"]) if len(obs) > 1 else latest_val
        change = latest_val - prev_val

        macro_data[series_id] = {
            "value": latest_val,
            "prev_value": prev_val,
            "change": round(change, 4),
            "date": latest_date,
            "series_name": meta["name"],
            "class": meta["class"],
            "field": meta["field"],
            "_snapshot_ts": snapshot_ts,
        }

    return macro_data


def detect_fred_triggers(macro_data: dict) -> list:
    """Evaluate FRED data against frozen trigger rules."""
    triggers = []
    ts = datetime.now(timezone.utc).isoformat()

    if macro_data.get("T10Y2Y") and macro_data["T10Y2Y"]:
        if macro_data["T10Y2Y"]["value"] <= FRED_TRIGGERS["T10Y2Y"]["inversion_threshold"]:
            triggers.append(
                {
                    "instrument": "T10Y2Y",
                    "trigger_type": "YIELD_CURVE_INVERSION",
                    "signal_timestamp": ts,
                    "snapshot_values": macro_data["T10Y2Y"],
                    "class_label": "Bf-m",
                    "trigger_value": macro_data["T10Y2Y"]["value"],
                    "trigger_threshold": FRED_TRIGGERS["T10Y2Y"]["inversion_threshold"],
                    "data_freeze_confirmed": True,
                    "source": "FRED",
                }
            )

    if macro_data.get("DPSACBW027SBOG") and macro_data["DPSACBW027SBOG"]:
        d = macro_data["DPSACBW027SBOG"]
        if d["prev_value"] > 0:
            pct_chg = (d["value"] - d["prev_value"]) / d["prev_value"] * 100
            if pct_chg <= FRED_TRIGGERS["DPSACBW027SBOG"]["drop_1w_pct"]:
                triggers.append(
                    {
                        "instrument": "BANK_DEPOSITS",
                        "trigger_type": "DEPOSIT_OUTFLOW",
                        "signal_timestamp": ts,
                        "snapshot_values": {**d, "pct_change": round(pct_chg, 3)},
                        "class_label": "Bf-s",
                        "trigger_value": round(pct_chg, 3),
                        "trigger_threshold": FRED_TRIGGERS["DPSACBW027SBOG"]["drop_1w_pct"],
                        "data_freeze_confirmed": True,
                        "source": "FRED",
                    }
                )

    if macro_data.get("CPIAUCSL") and macro_data["CPIAUCSL"]:
        d = macro_data["CPIAUCSL"]
        monthly_chg = d["change"]
        if monthly_chg >= FRED_TRIGGERS["CPIAUCSL"]["spike_1m_pct"]:
            triggers.append(
                {
                    "instrument": "CPI",
                    "trigger_type": "CPI_SPIKE",
                    "signal_timestamp": ts,
                    "snapshot_values": d,
                    "class_label": "Bf-m",
                    "trigger_value": round(monthly_chg, 3),
                    "trigger_threshold": FRED_TRIGGERS["CPIAUCSL"]["spike_1m_pct"],
                    "data_freeze_confirmed": True,
                    "source": "FRED",
                }
            )

    return triggers


# ── SEC EDGAR ─────────────────────────────────────────────────────────
SEC_BASE = "https://data.sec.gov/submissions"


def _sec_headers() -> dict:
    ua = (os.environ.get("SEC_EDGAR_USER_AGENT") or "").strip()
    if not ua:
        ua = "MATRIYA-Finance (contact: set SEC_EDGAR_USER_AGENT in .env)"
    return {"User-Agent": ua}


SEC_WATCHLIST = {
    "ZION": "0000109380",
    "CMA": "0000028412",
}


def fetch_sec_recent_filings(ticker: str, form_types: Optional[list] = None) -> list:
    """Fetch recent SEC filings for a company."""
    if form_types is None:
        form_types = ["8-K", "10-Q"]
    cik = SEC_WATCHLIST.get(ticker)
    if not cik:
        return []

    url = f"{SEC_BASE}/CIK{cik}.json"
    try:
        req = urllib.request.Request(url, headers=_sec_headers())
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
            forms = data.get("filings", {}).get("recent", {})
            filings = []
            form_list = forms.get("form", [])
            primary_docs = forms.get("primaryDocument", []) or []
            for i, form in enumerate(form_list):
                if form in form_types:
                    desc = primary_docs[i] if i < len(primary_docs) else ""
                    filings.append(
                        {
                            "ticker": ticker,
                            "form": form,
                            "date": forms["filingDate"][i],
                            "accession": forms["accessionNumber"][i],
                            "description": desc,
                        }
                    )
                    if len(filings) >= 5:
                        break
            return filings
    except Exception as e:
        print(f"[SEC] Error fetching {ticker}: {e}")
        return []


def get_sec_snapshot() -> dict:
    """8-K within last 7 days = potential trigger signal."""
    snapshot = {}
    cutoff = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")

    for ticker in SEC_WATCHLIST:
        filings = fetch_sec_recent_filings(ticker, ["8-K"])
        recent = [f for f in filings if f["date"] >= cutoff]
        snapshot[ticker] = {
            "recent_8k_count": len(recent),
            "filings": recent,
            "has_recent_event": len(recent) > 0,
        }

    return snapshot


def detect_sec_triggers(sec_data: dict) -> list:
    triggers = []
    ts = datetime.now(timezone.utc).isoformat()

    for ticker, data in sec_data.items():
        if data["has_recent_event"]:
            triggers.append(
                {
                    "instrument": ticker,
                    "trigger_type": "SEC_8K_RECENT",
                    "signal_timestamp": ts,
                    "snapshot_values": data,
                    "class_label": "Bf-s",
                    "trigger_value": data["recent_8k_count"],
                    "trigger_threshold": 1,
                    "data_freeze_confirmed": True,
                    "source": "SEC_EDGAR",
                }
            )

    return triggers


def get_full_macro_snapshot(use_fred: bool = True, use_sec: bool = True) -> dict:
    """
    Master snapshot combining FRED + SEC data.
    Merge with market snapshot before trigger_monitor.run_monitor_cycle().
    """
    snapshot = {
        "_data_freeze_confirmed": True,
        "_global": {},
        "_sources": [],
        "_snapshot_ts": datetime.now(timezone.utc).isoformat(),
    }

    all_triggers: list = []
    fred_key = _fred_api_key()

    if use_fred and fred_key:
        print("[FRED] Fetching macro data...")
        macro = get_fred_snapshot()
        snapshot["_fred"] = macro
        snapshot["_sources"].append("FRED")

        if macro.get("DGS10") and macro["DGS10"]:
            snapshot["^TNX"] = {
                "yield_1d_change_bps": round(macro["DGS10"]["change"] * 100, 1),
                "yield_level": macro["DGS10"]["value"],
            }
        if macro.get("T10Y2Y") and macro["T10Y2Y"]:
            snapshot["_global"]["yield_curve_spread"] = macro["T10Y2Y"]["value"]

        all_triggers.extend(detect_fred_triggers(macro))
    elif use_fred and not fred_key:
        print("[FRED] Skipped - set FRED_API_KEY in environment")

    if use_sec:
        print("[SEC] Fetching recent filings...")
        sec = get_sec_snapshot()
        snapshot["_sec"] = sec
        snapshot["_sources"].append("SEC_EDGAR")
        all_triggers.extend(detect_sec_triggers(sec))

    snapshot["_macro_triggers"] = all_triggers
    return snapshot


if __name__ == "__main__":
    print("=" * 52)
    print("  FRED + SEC EDGAR Connector - Smoke Test")
    print("=" * 52)

    print("\n[1] Testing SEC EDGAR...")
    sec = get_sec_snapshot()
    for ticker, data in sec.items():
        print(f"    {ticker}: {data['recent_8k_count']} recent 8-K filings")
        for f in data["filings"]:
            print(f"      {f['date']} - {f['form']} - {f['accession']}")

    sec_triggers = detect_sec_triggers(sec)
    print(f"    SEC triggers detected: {len(sec_triggers)}")

    print("\n[2] FRED: set FRED_API_KEY then run with use_fred=True")
    print("    https://fred.stlouisfed.org/docs/api/api_key.html")

    print("\n[3] Snapshot structure (SEC only dry run):")
    snap = get_full_macro_snapshot(use_fred=False, use_sec=True)
    print(f"    Sources: {snap['_sources']}")
    print(f"    Macro triggers: {len(snap['_macro_triggers'])}")
    print(f"    Data freeze confirmed: {snap['_data_freeze_confirmed']}")

    print("\n[4] trigger_monitor integration:")
    print("    from fred_connector import get_full_macro_snapshot")
    print("    macro_snapshot = get_full_macro_snapshot()")

    print("\nOK fred_connector.py - smoke test finished")
