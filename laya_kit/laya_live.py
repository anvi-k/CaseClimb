"""Real-time rubric scoring with Laya. Self-contained: stdlib only, needs just the rubric JSON beside it.

Laya is a typed decision model: it answers yes/no and rating questions with probabilities and writes no text.
The patient profile (profiles/*.json) is the only thing that varies; there is no patient-specific code.

How it scores:
  every student line  -> yes/no questions: which checklist tasks did it meet, did it trip a safety flag,
                         is it relevant evidence for each rubric domain
  every ~30 seconds   -> 1-4 rating per rubric domain over the conversation so far
  progress            -> sum of domains rated so far, out of 28. Domains start 'pending' and only get a
                         score once a cited student line supports them, so progress rises as the rubric is covered.

Use it live:
    S = LayaScorer(load_profile("profiles/maria_alvarez.json"), LayaClient("http://127.0.0.1:8000"))
    snap = S.add_line("student", text, turn_id)      # also call for patient lines
    S.record_disclosure("f.med.refills")             # when the encounter engine releases a chart/patient fact
    LiveTicker(S, on_update=push_to_ui).start()      # optional: tick every few seconds even if nobody speaks
    report, summary = S.final_report()

Replay a transcript:
    python laya_live.py replay profiles/maria_alvarez.json episodes/episode_strong.json --url http://127.0.0.1:8000
"""
import argparse, json, os, sys, threading, time, urllib.request
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))

# Thresholds on Laya probabilities. Starting guesses: calibrate on transcripts you have scored by hand.
T_DONE, T_PART, T_EVID, T_SAFE = 0.70, 0.55, 0.60, 0.80
# Laya's 0..3 expected rating that maps to rubric 1 and rubric 4. Laya's ratings are compressed (about 1.7 to 2.3 in a first
# diagnostic), so they are stretched over this range. First guess: run eval_laya.py and set from its output.
SCORE_LO, SCORE_HI = 1.5, 2.7
WINDOW = 8                                    # recent lines sent with each new student line
RANK = {"pending": 0, "partial": 1, "completed": 2}


def load_rubric(path=None):
    for p in (path, os.environ.get("LAYA_RUBRIC"), os.path.join(HERE, "encounter_evaluation_rubric.json")):
        if p and os.path.exists(p): return json.load(open(p))
    raise FileNotFoundError("encounter_evaluation_rubric.json not found: put it beside laya_live.py or set LAYA_RUBRIC")


RUBRIC = load_rubric()

# ---- universal behaviours checked for every patient ------------------------------------------------------
UNIVERSAL_TASKS = [
    {"id": "introduce_self", "points": 5, "rubric_domains": [1],
     "done_when": "Student states their own name AND role near the start.", "partial_when": "Gives a name or role but not both."},
    {"id": "set_agenda", "points": 5, "rubric_domains": [1],
     "done_when": "Student says what the visit is about and/or checks the patient's priorities.", "partial_when": "States the topic but never checks the patient's priorities."},
    {"id": "summarize_and_next_steps", "points": 5, "rubric_domains": [7],
     "done_when": "Student summarizes what was agreed AND names a next step or follow-up.", "partial_when": "Summarizes with no next step, or the reverse."},
]
COUNSEL_TASKS = [
    {"id": "check_understanding", "points": 10, "rubric_domains": [5],
     "done_when": "Student asks the patient to restate the plan in their own words, or asks what is unclear.",
     "partial_when": "Asks 'does that make sense?' without waiting for or probing the answer."},
]
UNIVERSAL_SAFETY = [
    {"id": "no_misstated_chart_values", "rubric_domains": [6, 7], "flag_if": "Student states a lab value, vital sign, or diagnosis that contradicts the patient's chart_data or summary."},
    {"id": "no_overstated_certainty", "rubric_domains": [6, 7], "flag_if": "Student promises a specific outcome or guarantees a treatment or diet will work."},
    {"id": "no_out_of_scope_orders", "rubric_domains": [7], "flag_if": "Student tells the patient to start, stop, or change a prescription as if they were the prescriber."},
]


# Laya answers short, single-idea questions much better than long compound criteria. Profiles may give a `question` per task or
# safety check; these are the universal ones. First drafts: eval_laya.py compares them with the long wording.
SHORT_Q = {
    "introduce_self": "Does the student say their own name and that they are a student or nurse practitioner?",
    "set_agenda": "Does the student say what today's visit is for, or ask what the patient wants to talk about?",
    "summarize_and_next_steps": "Does the student recap the plan and mention a follow-up visit?",
    "check_understanding": "Does the student ask the patient to repeat the plan back, or ask what is unclear?",
    "no_misstated_chart_values": "Does the student state a lab number or diagnosis that differs from the patient chart?",
    "no_overstated_certainty": "Does the student promise or guarantee that a treatment will work?",
    "no_out_of_scope_orders": "Does the student tell the patient to start, stop, or change a medicine?",
}
for _x in UNIVERSAL_TASKS + COUNSEL_TASKS + UNIVERSAL_SAFETY: _x["question"] = SHORT_Q[_x["id"]]


def to_points(laya_score):
    """Laya expected rating (0..3) -> continuous rubric points (1..4), stretched between SCORE_LO and SCORE_HI."""
    return 1 + 3 * max(0.0, min(1.0, (laya_score - SCORE_LO) / (SCORE_HI - SCORE_LO)))


def finalize_profile(p):
    tasks = UNIVERSAL_TASKS + (COUNSEL_TASKS if p.get("encounter_type") == "explain_or_counsel" else []) + p.get("tasks", [])
    ids = [t["id"] for t in tasks]
    assert len(ids) == len(set(ids)), "duplicate task ids"
    p["all_tasks"], p["all_safety"] = tasks, UNIVERSAL_SAFETY + p.get("safety_checks", [])
    return p


def load_profile(path): return finalize_profile(json.load(open(path)))


# ---- Laya client -----------------------------------------------------------------------------------------
class LayaClient:
    """laya-mlx-http wire format: POST /v1/predict {"text", "questions"} -> {"answers": {id: {...}}}."""
    def __init__(self, base_url="http://127.0.0.1:8000", api_key=None, timeout=10):
        self.base, self.key, self.timeout = base_url.rstrip("/"), api_key, timeout
    def __call__(self, text, questions):
        h = {"content-type": "application/json"}
        if self.key: h["X-API-Key"] = self.key
        req = urllib.request.Request(self.base + "/v1/predict", json.dumps({"text": text, "questions": questions}).encode(), h)
        with urllib.request.urlopen(req, timeout=self.timeout) as r: return json.load(r)["answers"]


def yn(instr): return {"type": "noul", "instructions": instr, "criteria": {"false": "No", "true": "Yes"}}


def line_questions(p):
    q = {}
    for t in p["all_tasks"]:
        if t.get("linked_fact"): continue                     # fact tasks are credited from the disclosure log
        q[f"task__{t['id']}"] = yn(t.get("question") or f"Does the student's LATEST line meet this criterion? {t['done_when']}")
    for c in p["all_safety"]:
        q[f"safety__{c['id']}"] = yn(c.get("question") or f"Does the student's LATEST line do this? {c['flag_if']}")
    for d in RUBRIC["domains"]:   # relevance, not quality: a bad line is still evidence. Quality comes from the rating question.
        q[f"evidence__{d['id']}"] = yn(f"Is the student's LATEST line relevant to assessing '{d['name']}', whether done well or badly? Meaning of a good performance: {d['descriptors']['3']}")
    return q


def domain_questions():
    return {f"domain__{d['id']}": {"type": "score", "instructions": f"Rate the student on '{d['name']}' using the conversation so far.",
            "criteria": [d["descriptors"][k] for k in ("1", "2", "3", "4")]} for d in RUBRIC["domains"]}


def fmt(lines): return "\n".join(f"[{l['ref']} {l['speaker']}] {l['text']}" for l in lines)


# ---- the scorer ------------------------------------------------------------------------------------------
class LayaScorer:
    def __init__(self, profile, laya, interval=30.0, clock=time.monotonic, hints=True, context="window"):
        """context='window': latest line + chart + recent lines. context='line': the latest line only (eval_laya.py compares)."""
        self.p, self.laya, self.interval, self.clock, self.hints, self.context = profile, laya, interval, clock, hints, context
        self.lock = threading.RLock()
        self.lines, self.lq, self.dq = [], line_questions(profile), domain_questions()
        self.tasks = {t["id"]: {"status": "pending", "refs": [], "p": None} for t in profile["all_tasks"]}
        self.safety = {}
        self.evid = {d["id"]: [] for d in RUBRIC["domains"]}
        self.dom = {d["id"]: {"points": None, "expected": None, "confidence": None} for d in RUBRIC["domains"]}   # points None = pending
        self.last_tick, self.t0, self.history, self.shown = None, clock(), [], 0
        self.degraded = False

    # 1. line by line
    def add_line(self, speaker, text, turn_id=None):
        with self.lock:
            n = len(self.lines) + 1
            self.lines.append({"turn": n, "ref": turn_id or f"turn{n}", "speaker": speaker, "text": text})
            if speaker == "student": self._line_eval(self.lines[-1])
            return self.maybe_tick()

    def _line_state(self, line):
        if self.context == "line": return f"STUDENT LINE: {line['text']}"
        return (f"PATIENT CHART: {json.dumps(self.p.get('chart_data', {}))}\nRECENT CONVERSATION:\n{fmt(self.lines[-WINDOW:])}"
                f"\nLATEST STUDENT LINE: {line['text']}")

    def _line_eval(self, line):
        try: a = self.laya(self._line_state(line), self.lq)
        except Exception as e: self.degraded = True; print("Laya unavailable, keeping last scores:", e); return
        self.degraded = False
        for t in self.p["all_tasks"]:
            if t.get("linked_fact"): continue
            pr = a[f"task__{t['id']}"]["noul"]
            new = "completed" if pr >= T_DONE else "partial" if pr >= T_PART else "pending"
            rec = self.tasks[t["id"]]
            if RANK[new] > RANK[rec["status"]]:                    # tasks only move forward
                rec.update(status=new, p=round(pr, 3)); rec["refs"].append(line["ref"])
                for d in t["rubric_domains"]: self._add_evid(d, line["ref"])
        for c in self.p["all_safety"]:
            pr = a[f"safety__{c['id']}"]["noul"]
            if pr >= T_SAFE: self.safety.setdefault(c["id"], {"refs": [], "p": round(pr, 3)})["refs"].append(line["ref"])
        for d in RUBRIC["domains"]:
            if a[f"evidence__{d['id']}"]["noul"] >= T_EVID: self._add_evid(d["id"], line["ref"])

    def record_disclosure(self, fact_id):
        """Call when the encounter engine releases a fact. Credits the most recent student line."""
        with self.lock:
            stud = [l for l in self.lines if l["speaker"] == "student"]
            if not stud: return
            ref = stud[-1]["ref"]
            for t in self.p["all_tasks"]:
                rec = self.tasks[t["id"]]
                if t.get("linked_fact") == fact_id and rec["status"] != "completed":
                    rec["status"] = "completed"; rec["refs"].append(ref)
                    for d in t["rubric_domains"]: self._add_evid(d, ref)

    def _add_evid(self, d, ref):
        if ref not in self.evid[d]: self.evid[d].append(ref)

    # 2. every ~30 s
    def maybe_tick(self, final=False):
        with self.lock:
            now = self.clock()
            if self.lines and (final or self.last_tick is None or now - self.last_tick >= self.interval):
                self._tick(final); self.last_tick = now
            return self.snapshot()

    def _tick(self, final):
        state = f"PATIENT CHART: {json.dumps(self.p.get('chart_data', {}))}\nCONVERSATION:\n{fmt(self.lines)}"
        try: a = self.laya(state, self.dq)
        except Exception as e: self.degraded = True; print("Laya unavailable, keeping last scores:", e); return
        self.degraded = False
        for d in RUBRIC["domains"]:
            did, ans = d["id"], a[f"domain__{d['id']}"]
            # closure (domain 7) isn't judged until the student has at least started to close
            closure_open = did == 7 and not final and not any(
                self.tasks[t["id"]]["status"] != "pending" for t in self.p["all_tasks"] if 7 in t["rubric_domains"])
            if not self.evid[did] or closure_open: continue
            # NOTE: no confidence gate. For rating questions Laya's 'confidence' is small (0.05-0.2) even when the rating is useful,
            # and gating on it froze every domain after the first tick.
            self.dom[did].update(points=to_points(ans["score"]), expected=ans["score"], confidence=ans.get("confidence"))
        s = self.snapshot()
        self.history.append((round(self.clock() - self.t0), s["raw_progress"], s["live_progress"]))

    def _cap(self, did, pts):
        """A triggered safety flag caps the rubric domains it names at 2 ('Developing'): you cannot be 'Strong' on closure and also unsafe."""
        capped = any(did in c["rubric_domains"] and c["id"] in self.safety for c in self.p["all_safety"])
        return min(pts, 2.0) if capped else pts

    def _pts(self, did):
        p = self.dom[did]["points"]
        return None if p is None else self._cap(did, p)

    def snapshot(self):
        pts = {k: self._pts(k) for k in self.dom}
        raw = round(sum(v for v in pts.values() if v is not None), 1); self.shown = max(self.shown, raw)
        unmet = sorted((t for t in self.p["all_tasks"] if self.tasks[t["id"]]["status"] == "pending"), key=lambda t: -t["points"])
        return {"live_progress": self.shown, "raw_progress": raw, "max": 4 * len(self.dom),
                "domains": {k: ("pending" if v is None else round(v, 1)) for k, v in pts.items()},
                "tasks_done": f"{sum(r['status'] == 'completed' for r in self.tasks.values())}/{len(self.tasks)}",
                "flags": sorted(self.safety), "degraded": self.degraded,
                "hint": f"Try: {unmet[0]['done_when']}" if (self.hints and unmet) else ""}
    # live_progress never goes down (for the student's bar); raw_progress is the honest current sum (for logs/debrief)

    # 3. end of encounter
    def final_report(self):
        with self.lock:
            self.maybe_tick(final=True)
            def dscore(k):
                p = self._pts(k); return 1 if p is None else max(1, min(4, round(p)))
            out = {"task_results": [{"id": k, "status": "missed" if v["status"] == "pending" else v["status"], "evidence_turns": v["refs"],
                                     "reason": (f"Laya p={v['p']}" if v["p"] is not None else "from the disclosure log") if v["refs"] else "no line met the criterion"}
                                    for k, v in self.tasks.items()],
                   "domain_scores": [{"domain_id": k, "score": dscore(k), "evidence_turns": self.evid[k],
                                      "reason": ((f"Laya rating={v['expected']:.2f} -> {v['points']:.1f} points" if v["points"] is not None
                                                  else "no supporting line found; scored as absent - confirm")
                                                 + ("; capped at 2 by a safety flag" if v["points"] is not None and self._cap(k, 4.0) < 4 else ""))}
                                     for k, v in self.dom.items()],
                   "safety_results": [{"id": c["id"], "triggered": c["id"] in self.safety, "evidence_turns": self.safety.get(c["id"], {}).get("refs", [])}
                                      for c in self.p["all_safety"]]}
            summary = compute(out, self.p)
            out["debrief_inputs"] = debrief_inputs(out, self.p)   # structured pointers for the LLM debrief to write the 3 evidence statements
            return out, summary


def compute(out, profile):
    scored = [s["score"] for s in out["domain_scores"] if s["score"] != "N/A"]
    review_ids = RUBRIC["scoring"]["review_trigger_domain_ids"]
    why = [f"domain {s['domain_id']} scored 1" for s in out["domain_scores"] if s["domain_id"] in review_ids and s["score"] == 1]
    why += [f"safety check triggered: {r['id']}" for r in out.get("safety_results", []) if r["triggered"]]
    pts = {t["id"]: t["points"] for t in profile["all_tasks"]}
    earned = sum(pts[r["id"]] * {"completed": 1, "partial": 0.5, "missed": 0}[r["status"]] for r in out["task_results"])
    return {"patient": profile["patient_name"], "rubric_total": f"{sum(scored)}/{4 * len(scored)}", "rubric_total_int": sum(scored),
            "checklist": f"{earned:g}/{sum(pts.values())}", "checklist_points": earned,
            "needs_teacher_review": bool(why), "review_reasons": why}


def debrief_inputs(out, profile):
    """Laya writes no text. This hands the debrief LLM the pointers for the rubric's three required statements."""
    ds = sorted(out["domain_scores"], key=lambda s: s["score"] if s["score"] != "N/A" else 9)
    names = {d["id"]: d["name"] for d in RUBRIC["domains"]}
    pts = {t["id"]: t["points"] for t in profile["all_tasks"]}
    done = [r for r in out["task_results"] if r["status"] != "missed"]
    return {"strength_demonstrated": {"domain": names[ds[-1]["domain_id"]], "evidence_turns": ds[-1]["evidence_turns"]},
            "important_gap_or_missed_opportunity": {"domain": names[ds[0]["domain_id"]], "score": ds[0]["score"],
                "missed_tasks": [r["id"] for r in sorted((r for r in out["task_results"] if r["status"] == "missed"), key=lambda r: -pts[r["id"]])]},
            "safety_or_accuracy_concern": [{"id": r["id"], "evidence_turns": r["evidence_turns"]} for r in out["safety_results"] if r["triggered"]],
            "partially_done": [r["id"] for r in done if r["status"] == "partial"]}


def validate_report(out, lines):
    """Every cited turn must exist and be a student turn. Returns a list of problems (empty = fine)."""
    spk = {l["ref"]: l["speaker"] for l in lines}; errs = []
    groups = [("domain", out["domain_scores"], "domain_id"), ("task", out["task_results"], "id"), ("safety", out["safety_results"], "id")]
    for label, items, key in groups:
        for it in items:
            for r in it["evidence_turns"]:
                if spk.get(r) != "student": errs.append(f"{label} {it[key]}: {r} is not a student turn")
    return errs


class LiveTicker(threading.Thread):
    """Background timer: lets the 30 s domain rating fire during silences. on_update(snapshot) pushes to your UI."""
    def __init__(self, scorer, on_update=print, every=5.0):
        super().__init__(daemon=True); self.s, self.cb, self.every, self.stop = scorer, on_update, every, threading.Event()
    def run(self):
        while not self.stop.wait(self.every): self.cb(self.s.maybe_tick())


# ---- transcripts -----------------------------------------------------------------------------------------
def load_episode(ep):
    """CaseClimb episode.json -> (lines, disclosures_by_turn_id). Speaker comes from the participant role."""
    role = {p["participant_id"]: ("patient" if p["role"] == "patient" else "student") for p in ep["participants"]}
    parse = lambda s: datetime.fromisoformat(s.replace("Z", "+00:00"))
    t0 = parse(ep["turns"][0]["at"]) if ep["turns"][0].get("at") else None
    lines = [{"turn_id": t["turn_id"], "speaker": role[t["participant_id"]], "text": t["text"],
              "sec": (parse(t["at"]) - t0).total_seconds() if t0 and t.get("at") else 20.0 * i} for i, t in enumerate(ep["turns"])]
    disc = {}
    for d in ep.get("disclosures", []):
        if d.get("item_type") == "fact": disc.setdefault(d["turn_id"], []).append(d["item_id"])
    return lines, disc


def replay(profile, ep, laya, interval=30.0):
    """Feed an episode through the scorer using its real timestamps. Returns (scorer, lines)."""
    lines, disc = load_episode(ep)
    clock = [0.0]; S = LayaScorer(profile, laya, interval, clock=lambda: clock[0])
    for l in lines:
        clock[0] = l["sec"]; S.add_line(l["speaker"], l["text"], l["turn_id"])
        for fid in disc.get(l["turn_id"], []): S.record_disclosure(fid)
    clock[0] = lines[-1]["sec"] + 1
    return S, [{"ref": l["turn_id"], "speaker": l["speaker"]} for l in lines]


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("replay"); r.add_argument("profile"); r.add_argument("episode"); r.add_argument("--url", default="http://127.0.0.1:8000"); r.add_argument("--api-key")
    a = ap.parse_args()
    P, ep = load_profile(a.profile), json.load(open(a.episode))
    S, lines = replay(P, ep, LayaClient(a.url, a.api_key, timeout=30))
    print("timeline (sec, honest score, shown score):", S.history)
    out, summ = S.final_report()
    print(json.dumps(summ, indent=1)); print("citation problems:", validate_report(out, lines) or "none")
    print(json.dumps(out["debrief_inputs"], indent=1))
