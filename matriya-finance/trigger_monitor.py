# trigger_monitor.py
# Daily at 07:00 UTC via matriya-finance/server.js → python trigger_monitor.py
#
# 1) yfinance market snapshot
# 2) fred_connector macro snapshot (FRED + SEC when env set)
# 3) run_monitor_cycle — appends rows to Layer3_Shadow_Signals.ndjson (read by matriya-back WhatsApp F STATUS)

import json
import os
import sys
import uuid
from datetime import datetime, timezone

try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass

import yfinance as yf


def fetch_market_snapshot():
    """Last ~2 daily closes; pct change vs previous close."""
    snapshot = {"_data_freeze_confirmed": True, "_global": {}}
    for ticker in ["ZION", "CMA", "^VIX", "^TNX"]:
        try:
            d = yf.download(ticker, period="5d", interval="1d", progress=False, auto_adjust=True)
            if d is None or getattr(d, "empty", True) or len(d) < 2:
                snapshot[ticker] = None
                continue
            close = d["Close"]
            prev = float(close.iloc[-2].item())
            last = float(close.iloc[-1].item())
            pct = round((last / prev - 1) * 100, 2) if prev else None
            snapshot[ticker] = {"price_1d_change_pct": pct}
        except Exception:
            snapshot[ticker] = None
    return snapshot


def _ndjson_path():
    override = (os.environ.get("FINANCE_SHADOW_SIGNALS_PATH") or "").strip()
    if override:
        return override
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "Layer3_Shadow_Signals.ndjson")


def _append_ndjson_row(row: dict) -> None:
    path = _ndjson_path()
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    line = json.dumps(row, separators=(",", ":"), ensure_ascii=False)
    with open(path, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def run_monitor_cycle(full_snapshot: dict) -> dict:
    """
    Turn frozen snapshot into shadow-signal NDJSON lines (WhatsApp STATUS / F STATUS).
    Always writes at least one row so operators see a fresh heartbeat when no triggers fire.
    """
    ts = full_snapshot.get("_snapshot_ts") or datetime.now(timezone.utc).isoformat()
    triggers = list(full_snapshot.get("_macro_triggers") or [])
    written = 0

    for t in triggers:
        snap = t.get("snapshot_values") or {}
        val = snap.get("value")
        try:
            a_val = float(val) if val is not None else float(t.get("trigger_value", 0))
        except (TypeError, ValueError):
            a_val = float(t.get("trigger_value") or 0)
        row = {
            "signal_id": str(uuid.uuid4()),
            "instrument": str(t.get("instrument", "?")),
            "A": round(a_val, 4),
            "decision": "Act",
            "signal_timestamp": t.get("signal_timestamp", ts),
            "trigger_type": t.get("trigger_type"),
            "source": t.get("source"),
        }
        _append_ndjson_row(row)
        written += 1

    if written == 0:
        inst = "^TNX"
        a_val = 0.0
        fred = full_snapshot.get("_fred") or {}
        dgs = fred.get("DGS10")
        if isinstance(dgs, dict) and dgs.get("value") is not None:
            inst = "^TNX"
            a_val = float(dgs["value"])
        else:
            for sym in ("ZION", "CMA"):
                block = full_snapshot.get(sym)
                if isinstance(block, dict) and block.get("price_1d_change_pct") is not None:
                    inst = sym
                    a_val = float(block["price_1d_change_pct"])
                    break
        row = {
            "signal_id": str(uuid.uuid4()),
            "instrument": inst,
            "A": round(a_val, 4),
            "decision": "Hold",
            "signal_timestamp": ts,
            "trigger_type": None,
            "source": "trigger_monitor_heartbeat",
        }
        _append_ndjson_row(row)
        written = 1

    return {"ndjson_path": _ndjson_path(), "rows_written": written, "triggers_in_snapshot": len(triggers)}


def daily_cycle():
    """After fetching market data, merge macro and run the monitor."""
    from fred_connector import get_full_macro_snapshot

    market_snapshot = fetch_market_snapshot()
    macro_snapshot = get_full_macro_snapshot(use_fred=True, use_sec=True)
    full_snapshot = {**market_snapshot, **macro_snapshot}
    result = run_monitor_cycle(full_snapshot)
    return result


def main():
    print("[trigger_monitor] starting daily_cycle", flush=True)
    try:
        result = daily_cycle()
        print(f"[trigger_monitor] done: {json.dumps(result)}", flush=True)
        sys.exit(0)
    except Exception as e:
        print(f"[trigger_monitor] error: {e}", file=sys.stderr, flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
