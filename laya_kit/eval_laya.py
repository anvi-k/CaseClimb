"""Measures how well Laya answers our questions, against labels I wrote by hand from the 3 example episodes.
   python3 eval_laya.py [http://127.0.0.1:8000]        (takes a few minutes; the server must be running)

PART 1  For each task / safety question, three setups are compared:
          old/window  the long 'done_when' wording, with chart + recent lines as context
          new/window  the short `question` wording, same context
          new/line    the short wording, with ONLY the student's line as context
        For each: average P(yes) on lines that should be 'yes' vs lines that should be 'no', and the best threshold.
        BA = balanced accuracy at that threshold (0.5 = coin flip, 1.0 = perfect).
PART 2  Domain ratings for each full episode, to set SCORE_LO / SCORE_HI in laya_live.py.

My labels are judgement calls. Lines I could not label cleanly are marked 'ignore' and left out. Disagree? Edit POS / IGN below.
"""
import json, os, sys, urllib.request
from laya_live import load_profile, load_episode, fmt, yn, domain_questions, HERE, WINDOW

URL = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000").rstrip("/")
EPS = {"default": "episode_default.json", "strong": "episode_strong.json", "conf": "episode_confrontational.json"}

# lines that SHOULD answer yes ("episode:turn")
POS = {
    "task__introduce_self": ["default:t0", "strong:t0", "conf:t0"],
    "task__set_agenda": ["default:t0", "strong:t0", "conf:t0"],
    "task__summarize_and_next_steps": ["strong:t20"],
    "task__discrepancy-adherence": ["strong:t8", "strong:t10", "conf:t8", "conf:t10", "conf:t12"],
    "task__respond-to-fear": ["strong:t14", "strong:t16"],
    "task__shared-plan": ["strong:t18", "strong:t20"],
    "safety__plan_on_unverified_adherence": ["default:t12"],
    "safety__no_overstated_certainty": [], "safety__no_out_of_scope_orders": [], "safety__no_misstated_chart_values": [],
}
# lines that are ambiguous for that question: left out of the scoring
IGN = {
    "task__summarize_and_next_steps": ["default:t12", "conf:t18"],
    "task__discrepancy-adherence": ["default:t6", "strong:t6", "conf:t6"],
    "task__respond-to-fear": ["strong:t12", "strong:t2"],
    "task__shared-plan": ["conf:t18"],
    "safety__no_out_of_scope_orders": ["default:t12"],
}


def call(text, qs):
    req = urllib.request.Request(URL + "/v1/predict", json.dumps({"text": text, "questions": qs}).encode(), {"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r: return json.load(r)["answers"]


P = load_profile(os.path.join(HERE, "profiles", "maria_alvarez.json"))
tasks = {f"task__{t['id']}": t for t in P["all_tasks"] if not t.get("linked_fact")}
safety = {f"safety__{c['id']}": c for c in P["all_safety"]}


def questions(new):
    q = {}
    for qid in POS:
        if qid in tasks:
            t = tasks[qid]; q[qid] = yn((t.get("question") if new else None) or f"Does the student's LATEST line meet this criterion? {t['done_when']}")
        else:
            c = safety[qid]; q[qid] = yn((c.get("question") if new else None) or f"Does the student's LATEST line do this? {c['flag_if']}")
    return q


SETUPS = {"old/window": (questions(False), "window"), "new/window": (questions(True), "window"), "new/line": (questions(True), "line")}
probs = {(s, qid): {} for s in SETUPS for qid in POS}
transcripts = {}
for name, f in EPS.items():
    lines, _ = load_episode(json.load(open(os.path.join(HERE, "episodes", f))))
    lines = [{"ref": l["turn_id"], "speaker": l["speaker"], "text": l["text"]} for l in lines]
    transcripts[name] = lines
    for i, l in enumerate(lines):
        if l["speaker"] != "student": continue
        for s, (q, ctx) in SETUPS.items():
            if ctx == "line": state = f"STUDENT LINE: {l['text']}"
            else: state = f"PATIENT CHART: {json.dumps(P['chart_data'])}\nRECENT CONVERSATION:\n{fmt(lines[max(0, i + 1 - WINDOW):i + 1])}\nLATEST STUDENT LINE: {l['text']}"
            a = call(state, q)
            for qid in POS: probs[(s, qid)][f"{name}:{l['ref']}"] = a[qid]["noul"]
    print(f"scored {name}", flush=True)

print("\n=== PART 1: do the questions separate yes-lines from no-lines? ===")
print(f"{'question':40} {'setup':11} {'avg yes-lines':>13} {'avg no-lines':>12} {'max no':>7} {'best thr':>8} {'BA':>5}")
for qid in POS:
    for s in SETUPS:
        d = probs[(s, qid)]; pos = [d[k] for k in POS[qid]]
        neg = [v for k, v in d.items() if k not in POS[qid] and k not in IGN.get(qid, [])]
        if pos:
            best = max(((sum(p >= th for p in pos) / len(pos) + sum(p < th for p in neg) / len(neg)) / 2, th) for th in [x / 20 for x in range(1, 20)])
            row = f"{sum(pos)/len(pos):13.2f} {sum(neg)/len(neg):12.2f} {max(neg):7.2f} {best[1]:8.2f} {best[0]:5.2f}"
        else:
            row = f"{'(none)':>13} {sum(neg)/len(neg):12.2f} {max(neg):7.2f} {'-':>8} {'-':>5}   <- should stay low; max no > 0.8 = false alarm"
        print(f"{qid[:40]:40} {s:11} {row}")
    print()

print("=== PART 2: domain ratings on the full episodes (Laya's 0..3 scale) ===")
dq = domain_questions(); vals = {}
for name, lines in transcripts.items():
    a = call(f"PATIENT CHART: {json.dumps(P['chart_data'])}\nCONVERSATION:\n{fmt(lines)}", dq)
    vals[name] = {k.replace("domain__", "d"): round(v["score"], 2) for k, v in a.items()}
print(f"{'domain':8}" + "".join(f"{n:>8}" for n in EPS))
for d in vals["strong"]: print(f"{d:8}" + "".join(f"{vals[n][d]:8.2f}" for n in EPS))
allv = [v for n in vals for v in vals[n].values()]
print(f"\nrange across all: {min(allv):.2f} to {max(allv):.2f}")
print("Expected order per domain: strong > default and strong > conf. Paste this whole output back.")
