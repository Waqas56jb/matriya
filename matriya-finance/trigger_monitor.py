# trigger_monitor.py
# Daily at 07:00 UTC via matriya-finance/server.js → python trigger_monitor.py
#
# 1) yfinance market snapshot — 10 instruments (watchlist v2)
# 2) fred_connector macro snapshot (FRED + SEC when env set)
# 3) run_monitor_cycle — persists signals to Supabase finance_signals table
#    (NDJSON fallback kept for local dev when Supabase vars are absent)
# 4) check_structural_instability — composite rule: MOVE+VIX+BANK simultaneous
# 5) Twilio WhatsApp alert on structural warning

import json
import os
import sys
import uuid
import urllib.request
import urllib.parse
from datetime import datetime, timezone

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

import yfinance as yf

# ─── Watchlist v2 — 10 instruments ───────────────────────────────────────────

WATCHLIST_V2 = {
    "ZION":  {"type": "bank_equity",        "class": "Bf-s"},
    "CMA":   {"type": "bank_equity",        "class": "Bf-s"},
    "KRE":   {"type": "regional_banks_etf", "class": "Bf-s"},
    "^TNX":  {"type": "rates_10y_us",       "class": "Bf-m"},
    "BUND":  {"type": "rates_10y_de",       "class": "Bf-m"},
    "^VIX":  {"type": "stress_index",       "class": "Bf-m"},
    "MOVE":  {"type": "stress_index",       "class": "Bf-m"},
    "HYG":   {"type": "credit_spread",      "class": "Bf-m"},
    "DXY":   {"type": "dollar_liquidity",   "class": "Bf-m"},
    "GLD":   {"type": "flight_to_safety",   "class": "Bf-m"},
}

# ─── Market snapshot (yfinance) ───────────────────────────────────────────────

def fetch_market_snapshot():
    """Last ~2 daily closes; pct change vs previous close for all 10 instruments."""
    snapshot = {"_data_freeze_confirmed": True, "_global": {}}
    for ticker in WATCHLIST_V2:
        try:
            d = yf.download(ticker, period="5d", interval="1d", progress=False, auto_adjust=True)
            if d is None or getattr(d, "empty", True) or len(d) < 2:
                snapshot[ticker] = None
                continue
            close = d["Close"]
            # Handle multi-level columns produced by newer yfinance versions
            if hasattr(close, "columns"):
                close = close.iloc[:, 0]
            prev = float(close.iloc[-2].item())
            last = float(close.iloc[-1].item())
            pct = round((last / prev - 1) * 100, 2) if prev else None
            snapshot[ticker] = {
                "price_1d_change_pct": pct,
                "price_last": round(last, 4),
                "class": WATCHLIST_V2[ticker]["class"],
            }
        except Exception as e:
            print(f"[trigger_monitor] yfinance error {ticker}: {e}", flush=True)
            snapshot[ticker] = None
    return snapshot

# ─── Supabase signal persistence ─────────────────────────────────────────────

def _supabase_url():
    return (os.environ.get("SUPABASE_URL") or "").strip().rstrip("/")

def _supabase_key():
    return (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or
            os.environ.get("SUPABASE_KEY") or "").strip()

def _supabase_available():
    return bool(_supabase_url() and _supabase_key())

def insert_signal_supabase(row: dict) -> bool:
    """
    Upserts a signal row into Supabase finance_signals table via REST API.
    Returns True on success, False on failure.
    """
    url = f"{_supabase_url()}/rest/v1/finance_signals"
    payload = json.dumps(row, default=str).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        method="POST",
        headers={
            "apikey": _supabase_key(),
            "Authorization": f"Bearer {_supabase_key()}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status in (200, 201, 204)
    except Exception as e:
        print(f"[trigger_monitor] Supabase insert failed: {e}", flush=True)
        return False

# ─── NDJSON fallback (local dev only) ────────────────────────────────────────

def _ndjson_path():
    override = (os.environ.get("FINANCE_SHADOW_SIGNALS_PATH") or "").strip()
    if override:
        return override
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "Layer3_Shadow_Signals.ndjson")

def _append_ndjson_row(row: dict) -> None:
    path = _ndjson_path()
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    line = json.dumps(row, separators=(",", ":"), ensure_ascii=False, default=str)
    with open(path, "a", encoding="utf-8") as f:
        f.write(line + "\n")

def persist_signal(row: dict) -> None:
    """Write signal to Supabase (primary) and NDJSON (fallback / local dev)."""
    if _supabase_available():
        ok = insert_signal_supabase(row)
        if not ok:
            print(f"[trigger_monitor] Supabase write failed, falling back to NDJSON", flush=True)
            _append_ndjson_row(row)
    else:
        print("[trigger_monitor] Supabase vars not set — writing to NDJSON only", flush=True)
        _append_ndjson_row(row)

# ─── Twilio WhatsApp alert ────────────────────────────────────────────────────

def send_whatsapp_alert(message: str) -> None:
    """Send a WhatsApp alert via Twilio REST API (structural warnings)."""
    sid = (os.environ.get("TWILIO_ACCOUNT_SID") or "").strip()
    token = (os.environ.get("TWILIO_AUTH_TOKEN") or "").strip()
    from_raw = (os.environ.get("TWILIO_WHATSAPP_FROM") or
                os.environ.get("TWILIO_WHATSAPP_NUMBER") or "").strip()
    to_raw = (os.environ.get("TWILIO_WHATSAPP_TO") or
              os.environ.get("DAVID_WHATSAPP") or "").strip()

    if not (sid and token and from_raw and to_raw):
        print("[trigger_monitor] Twilio vars missing — skipping WhatsApp alert", flush=True)
        return

    def _wa(addr):
        a = addr.strip()
        return a if a.startswith("whatsapp:") else f"whatsapp:{a}"

    url = f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json"
    data = urllib.parse.urlencode({
        "From": _wa(from_raw),
        "To":   _wa(to_raw),
        "Body": message,
    }).encode("ascii")

    import base64
    creds = base64.b64encode(f"{sid}:{token}".encode()).decode()
    req = urllib.request.Request(url, data=data, method="POST",
                                 headers={"Authorization": f"Basic {creds}",
                                          "Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            print(f"[trigger_monitor] WhatsApp alert sent (status={resp.status})", flush=True)
    except Exception as e:
        print(f"[trigger_monitor] WhatsApp alert failed: {e}", flush=True)

# ─── Composite rule ───────────────────────────────────────────────────────────

def check_structural_instability(triggers: list) -> dict:
    """
    Composite Rule: MOVE + VIX + any bank instrument firing simultaneously
    = STRUCTURAL_INSTABILITY_WARNING.
    Triggers is the list of trigger dicts from run_monitor_cycle.
    """
    fired = {t.get("instrument", "") for t in triggers}
    bank_sensors = {"ZION", "CMA", "KRE"}
    stress_sensors = {"MOVE", "^VIX"}

    stress_hit = stress_sensors & fired
    bank_hit   = bank_sensors & fired

    if len(stress_hit) >= 2 and len(bank_hit) >= 1:
        return {
            "composite_alert": True,
            "type": "STRUCTURAL_INSTABILITY_WARNING",
            "severity": "HIGH",
            "components": sorted(fired),
            "stress_sensors_fired": sorted(stress_hit),
            "bank_sensors_fired":   sorted(bank_hit),
            "message": (
                "🔴🔴 STRUCTURAL WARNING: simultaneous MOVE+VIX+BANK stress detected. "
                f"Sensors: {', '.join(sorted(fired))}"
            ),
        }
    return {"composite_alert": False}

# ─── Monitor cycle ────────────────────────────────────────────────────────────

def run_monitor_cycle(full_snapshot: dict) -> dict:
    """
    Turn frozen snapshot into signal rows persisted to Supabase (+ NDJSON fallback).
    Always writes at least one heartbeat row.
    Evaluates composite structural instability rule.
    """
    ts = full_snapshot.get("_snapshot_ts") or datetime.now(timezone.utc).isoformat()
    macro_triggers = list(full_snapshot.get("_macro_triggers") or [])
    written = 0
    trigger_rows = []

    for t in macro_triggers:
        snap = t.get("snapshot_values") or {}
        val  = snap.get("value")
        try:
            a_val = float(val) if val is not None else float(t.get("trigger_value", 0))
        except (TypeError, ValueError):
            a_val = float(t.get("trigger_value") or 0)

        row = {
            "signal_id":        str(uuid.uuid4()),
            "instrument":       str(t.get("instrument", "?")),
            "a_value":          round(a_val, 4),
            "decision":         "Act",
            "signal_timestamp": t.get("signal_timestamp", ts),
            "trigger_type":     t.get("trigger_type"),
            "source":           t.get("source"),
            "class_label":      t.get("class_label"),
            "composite_alert":  False,
        }
        persist_signal(row)
        trigger_rows.append(row)
        written += 1

    # Heartbeat row when no macro triggers fired
    if written == 0:
        inst  = "^TNX"
        a_val = 0.0
        fred  = full_snapshot.get("_fred") or {}
        dgs   = fred.get("DGS10")
        if isinstance(dgs, dict) and dgs.get("value") is not None:
            a_val = float(dgs["value"])
        else:
            for sym in ("ZION", "CMA"):
                block = full_snapshot.get(sym)
                if isinstance(block, dict) and block.get("price_1d_change_pct") is not None:
                    inst  = sym
                    a_val = float(block["price_1d_change_pct"])
                    break

        row = {
            "signal_id":        str(uuid.uuid4()),
            "instrument":       inst,
            "a_value":          round(a_val, 4),
            "decision":         "Hold",
            "signal_timestamp": ts,
            "trigger_type":     None,
            "source":           "trigger_monitor_heartbeat",
            "class_label":      WATCHLIST_V2.get(inst, {}).get("class"),
            "composite_alert":  False,
        }
        persist_signal(row)
        trigger_rows.append(row)
        written = 1

    # ── Composite rule evaluation ─────────────────────────────────────────────
    composite = check_structural_instability(macro_triggers)
    print(f"[trigger_monitor] composite rule → {composite}", flush=True)

    if composite.get("composite_alert"):
        # Persist composite alert as its own signal row
        comp_row = {
            "signal_id":        str(uuid.uuid4()),
            "instrument":       "COMPOSITE",
            "a_value":          0.0,
            "decision":         "Act",
            "signal_timestamp": ts,
            "trigger_type":     composite["type"],
            "source":           "composite_rule",
            "class_label":      "Bf-s",
            "composite_alert":  True,
        }
        persist_signal(comp_row)
        # Send WhatsApp structural warning
        send_whatsapp_alert(composite["message"])

    return {
        "rows_written":             written,
        "triggers_in_snapshot":     len(macro_triggers),
        "composite_alert":          composite.get("composite_alert", False),
        "composite_type":           composite.get("type"),
        "supabase_active":          _supabase_available(),
    }

# ─── Daily cycle ─────────────────────────────────────────────────────────────

def daily_cycle():
    """Fetch market data, merge macro, run monitor + composite rule."""
    from fred_connector import get_full_macro_snapshot

    print("[trigger_monitor] fetching market snapshot (10 instruments)...", flush=True)
    market_snapshot = fetch_market_snapshot()

    print("[trigger_monitor] fetching macro snapshot (FRED + SEC)...", flush=True)
    macro_snapshot  = get_full_macro_snapshot(use_fred=True, use_sec=True)

    full_snapshot = {**market_snapshot, **macro_snapshot}
    result = run_monitor_cycle(full_snapshot)
    return result

# ─── Entry point ─────────────────────────────────────────────────────────────

def main():
    print("[trigger_monitor] starting daily_cycle", flush=True)
    try:
        result = daily_cycle()
        print(f"[trigger_monitor] done: {json.dumps(result, default=str)}", flush=True)
        sys.exit(0)
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"[trigger_monitor] error: {e}", file=sys.stderr, flush=True)
        sys.exit(1)

if __name__ == "__main__":
    main()
