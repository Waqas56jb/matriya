"""
MATRIYA v0.1 — Week 4: FSCTM State Object + Audit Trace
=========================================================
Tracks scientific discovery state: K → C → B → N → L
Every transition is recorded. No state can be skipped.
B (Breakdown) is a mandatory gate before N or L.
"""

from dataclasses import dataclass, field
from typing import Optional, List
from datetime import datetime, timezone
from enum import Enum
import json
import hashlib


class FSCTMState(str, Enum):
    K = "K"
    C = "C"
    B = "B"
    N = "N"
    L = "L"


LEGAL_TRANSITIONS = {
    FSCTMState.K: [FSCTMState.C],
    FSCTMState.C: [FSCTMState.B, FSCTMState.K],
    FSCTMState.B: [FSCTMState.N],
    FSCTMState.N: [FSCTMState.L, FSCTMState.B],
    FSCTMState.L: [FSCTMState.K],
}

STATE_ENTRY_REQUIREMENTS = {
    FSCTMState.K: ["evidence_items"],
    FSCTMState.C: ["contradiction_description", "evidence_items"],
    FSCTMState.B: ["breakdown_proof", "failed_model_description"],
    FSCTMState.N: ["hypothesis", "experiment_template"],
    FSCTMState.L: ["law_statement", "validation_evidence", "n_replications"],
}


@dataclass
class FSCTMStateObject:
    case_id:        str
    current_state:  FSCTMState
    known:          List[str]
    contradictions: List[str]
    breakdown_claim: Optional[str]
    next_experiment: Optional[dict]
    law_statement:   Optional[str]
    history:         List[dict]
    tags:            dict
    created_at:      str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    updated_at:      str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )

    def to_dict(self) -> dict:
        return {
            "case_id":        self.case_id,
            "current_state":  self.current_state.value,
            "known":          [{"fact": f, "tag": "retrieved"} for f in self.known],
            "contradictions": [{"contradiction": c, "tag": "retrieved"} for c in self.contradictions],
            "breakdown_claim": {
                "claim": self.breakdown_claim,
                "tag":   "computed"
            } if self.breakdown_claim else None,
            "next_experiment": {
                **self.next_experiment,
                "tag": "computed"
            } if self.next_experiment else None,
            "law_statement": {
                "law":  self.law_statement,
                "tag":  "computed"
            } if self.law_statement else None,
            "tags":       self.tags,
            "history":    self.history,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }

    def fingerprint(self) -> str:
        content = json.dumps({
            "case_id":       self.case_id,
            "state":         self.current_state.value,
            "known":         sorted(self.known),
            "contradictions": sorted(self.contradictions),
            "breakdown":     self.breakdown_claim,
        }, sort_keys=True)
        return hashlib.sha256(content.encode()).hexdigest()[:16]


class FSCTMEngine:
    def __init__(self, case_id: str, initial_known: List[str] = None):
        self.state = FSCTMStateObject(
            case_id        = case_id,
            current_state  = FSCTMState.K,
            known          = initial_known or [],
            contradictions = [],
            breakdown_claim = None,
            next_experiment = None,
            law_statement   = None,
            history        = [],
            tags           = {},
        )
        self._record_event("INIT", FSCTMState.K, None, {
            "known_count": len(self.state.known)
        })

    def add_knowledge(self, facts: List[str]) -> dict:
        if self.state.current_state not in (FSCTMState.K, FSCTMState.C):
            return self._blocked("add_knowledge", "Only allowed in K or C state")
        self.state.known.extend(facts)
        self._record_event("ADD_KNOWLEDGE", self.state.current_state,
                           self.state.current_state, {"added": facts})
        return {"ok": True, "known_count": len(self.state.known)}

    def assert_contradiction(self, description: str, evidence: List[str]) -> dict:
        return self._transition(
            to_state    = FSCTMState.C,
            payload     = {"contradiction": description, "evidence": evidence},
            action      = "ASSERT_CONTRADICTION",
            side_effects = lambda: self.state.contradictions.append(description),
        )

    def assert_breakdown(self, proof: str, failed_model: str) -> dict:
        if self.state.current_state != FSCTMState.C:
            return self._blocked(
                "assert_breakdown",
                f"Cannot enter B from {self.state.current_state.value}. Must be in C first."
            )
        return self._transition(
            to_state = FSCTMState.B,
            payload  = {"proof": proof, "failed_model": failed_model},
            action   = "ASSERT_BREAKDOWN",
            side_effects = lambda: setattr(
                self.state, "breakdown_claim",
                f"MODEL_FAILED: {failed_model} | PROOF: {proof}"
            ),
        )

    def propose_experiment(self, template: dict, hypothesis: str) -> dict:
        if self.state.current_state != FSCTMState.B:
            return self._blocked(
                "propose_experiment",
                f"Cannot generate N from {self.state.current_state.value}. "
                f"Breakdown (B) must be proven first."
            )
        exp = {**template, "hypothesis": hypothesis, "tag": "computed"}
        return self._transition(
            to_state = FSCTMState.N,
            payload  = {"experiment": exp},
            action   = "PROPOSE_EXPERIMENT",
            side_effects = lambda: setattr(self.state, "next_experiment", exp),
        )

    def assert_law(self, statement: str, validation_evidence: List[str],
                   n_replications: int) -> dict:
        if self.state.current_state != FSCTMState.N:
            return self._blocked(
                "assert_law",
                f"Cannot assert L from {self.state.current_state.value}. Must be in N."
            )
        if n_replications < 3:
            return self._blocked(
                "assert_law",
                f"Minimum 3 replications required. Got {n_replications}."
            )
        return self._transition(
            to_state = FSCTMState.L,
            payload  = {
                "law":        statement,
                "evidence":   validation_evidence,
                "n_rep":      n_replications,
            },
            action   = "ASSERT_LAW",
            side_effects = lambda: setattr(self.state, "law_statement", statement),
        )

    def regress(self, reason: str) -> dict:
        if self.state.current_state != FSCTMState.N:
            return self._blocked("regress", "Regression only valid from N state")
        return self._transition(
            to_state = FSCTMState.B,
            payload  = {"reason": reason},
            action   = "REGRESS_N_TO_B",
        )

    def get_audit_trace(self) -> dict:
        return {
            "case_id":         self.state.case_id,
            "current_state":   self.state.current_state.value,
            "n_transitions":   len(self.state.history),
            "fingerprint":     self.state.fingerprint(),
            "history":         self.state.history,
            "data_source":     "DB_COMPUTED",
            "tag":             "computed",
        }

    def get_state_object(self) -> dict:
        return self.state.to_dict()

    def _transition(self, to_state: FSCTMState, payload: dict,
                    action: str, side_effects=None) -> dict:
        from_state = self.state.current_state

        if to_state not in LEGAL_TRANSITIONS.get(from_state, []):
            return self._blocked(
                action,
                f"Illegal transition: {from_state.value} → {to_state.value}"
            )

        if side_effects:
            side_effects()

        self.state.current_state = to_state
        self.state.updated_at    = datetime.now(timezone.utc).isoformat()
        self._record_event(action, from_state, to_state, payload)

        return {
            "ok":         True,
            "from_state": from_state.value,
            "to_state":   to_state.value,
            "action":     action,
        }

    def _blocked(self, action: str, reason: str) -> dict:
        self._record_event(f"BLOCKED:{action}",
                           self.state.current_state,
                           self.state.current_state,
                           {"reason": reason})
        return {
            "ok":           False,
            "blocked":      True,
            "action":       action,
            "reason":       reason,
            "current_state": self.state.current_state.value,
            "data_source":  "NONE",
        }

    def _record_event(self, action: str, from_state, to_state, payload: dict):
        self.state.history.append({
            "timestamp":  datetime.now(timezone.utc).isoformat(),
            "action":     action,
            "from_state": from_state.value if from_state else None,
            "to_state":   to_state.value if to_state else None,
            "payload":    payload,
            "tag":        "computed",
        })


def run_tests():
    print("=" * 60)
    print("Week 4 — FSCTM State Machine Tests")
    print("=" * 60)
    passed = failed = 0

    eng = FSCTMEngine("TEST-001", ["APP:PER >= 2.26 stable"])
    eng.add_knowledge(["IFR = 42% in all experiments"])
    r1 = eng.assert_contradiction(
        "Domain below APP:PER=2.26 unexplored",
        ["no experiments in dataset below 2.26"]
    )
    r2 = eng.assert_breakdown(
        "Current model cannot predict behaviour below 2.26 — no data",
        "linear_stability_assumption"
    )
    r3 = eng.propose_experiment(
        {"name": "APP:PER Boundary Test", "sweep": [2.26, 2.0, 1.5, 1.0]},
        "If APP:PER < 2.26 causes failure, 2.26 is a boundary"
    )
    ok = (r1["ok"] and r2["ok"] and r3["ok"] and
          eng.state.current_state == FSCTMState.N)
    print(f"{'✅' if ok else '❌'} Full path K→C→B→N")
    if ok: passed += 1
    else: failed += 1

    eng2 = FSCTMEngine("TEST-002")
    eng2.assert_contradiction("Some contradiction", ["evidence"])
    r_bad = eng2.propose_experiment({"name": "test"}, "hypothesis")
    ok2 = r_bad["ok"] is False and r_bad.get("blocked") is True
    print(f"{'✅' if ok2 else '❌'} B gate enforced — K→N blocked without B")
    if ok2: passed += 1
    else: failed += 1

    eng3 = FSCTMEngine("TEST-003", ["known fact"])
    eng3.assert_contradiction("contradiction", ["e1"])
    eng3.assert_breakdown("proof", "model")
    eng3.propose_experiment({"name": "exp"}, "hypothesis")
    r_law_bad = eng3.assert_law("some law", ["ev1", "ev2"], n_replications=2)
    ok3 = r_law_bad["ok"] is False
    print(f"{'✅' if ok3 else '❌'} Law requires 3+ replications")
    if ok3: passed += 1
    else: failed += 1

    trace = eng.get_audit_trace()
    ok4 = (trace["n_transitions"] >= 4 and
           "fingerprint" in trace and
           len(trace["history"]) >= 4)
    print(f"{'✅' if ok4 else '❌'} Audit trace complete ({trace['n_transitions']} events)")
    if ok4: passed += 1
    else: failed += 1

    eng4 = FSCTMEngine("TEST-004", ["fact1"])
    eng4.assert_contradiction("c", ["e"])
    eng4.assert_breakdown("proof", "model")
    eng4.propose_experiment({"name": "exp"}, "hyp")
    r_reg = eng4.regress("Experiment showed no failure pattern — not a boundary")
    ok5 = r_reg["ok"] and eng4.state.current_state == FSCTMState.B
    print(f"{'✅' if ok5 else '❌'} Regression N→B")
    if ok5: passed += 1
    else: failed += 1

    def make_engine():
        e = FSCTMEngine("DET-001", ["fact1", "fact2"])
        e.assert_contradiction("c1", ["ev1"])
        e.assert_breakdown("proof1", "model1")
        return e.state.fingerprint()

    fps = [make_engine() for _ in range(3)]
    ok6 = len(set(fps)) == 1
    print(f"{'✅' if ok6 else '❌'} Fingerprint determinism × 3")
    if ok6: passed += 1
    else: failed += 1

    print(f"\n{'✅' if failed == 0 else '❌'} {passed}/{passed+failed} passed")
    return passed, failed


if __name__ == "__main__":
    run_tests()
