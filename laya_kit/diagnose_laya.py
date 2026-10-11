"""Shows what Laya actually answers, so we can tell WHY scores look wrong.
   python3 diagnose_laya.py [http://127.0.0.1:8000]

A: two obvious yes/no questions (does Laya work at all?)
B: the real per-line questions on a GOOD vs a BAD student line, asked (1) all together and (2) one at a time.
   If batch answers differ from solo answers, batching is hurting. If good and bad lines get the same answers, the
   questions are not discriminating. 'truncated' shows whether Laya dropped part of the input.
C: the 7 domain ratings on a good vs a bad conversation.
"""
import json, os, sys, time, urllib.request
from laya_live import load_profile, line_questions, domain_questions, yn, RUBRIC, HERE

URL = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000").rstrip("/")

def call(text, qs):
    req = urllib.request.Request(URL + "/v1/predict", json.dumps({"text": text, "questions": qs}).encode(), {"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r: return json.load(r)

def line_text(line, chart, window=""):
    return f"PATIENT CHART: {json.dumps(chart)}\nRECENT CONVERSATION:\n{window}\nLATEST STUDENT LINE: {line}"

P = load_profile(os.path.join(HERE, "profiles", "maria_alvarez.json"))

print("=== A. sanity ===")
q = {"greet": yn("Does the text contain a greeting?")}
for t in ("Hello there, nice to meet you.", "The HbA1c result is 9.2 percent."):
    r = call(t, q); print(f"  {t!r:45} -> P(yes)={r['answers']['greet']['noul']}  confidence={r['answers']['greet'].get('confidence')}")

print("\n=== B. per-line questions: good vs bad line ===")
GOOD = "I'm so sorry about your mother. It makes sense that this scares you."
BAD = "Whatever. You're lying and wasting my time."
lq = line_questions(P)
t0 = time.time()
bg, bb = call(line_text(GOOD, P["chart_data"]), lq), call(line_text(BAD, P["chart_data"]), lq)
print(f"  {len(lq)} questions in one call: {time.time()-t0:.2f}s for two calls")
print("  usage good:", bg.get("usage")); print("  usage bad: ", bb.get("usage"))
print(f"\n  {'question':52} {'batch good':>10} {'batch bad':>10} {'solo good':>10} {'solo bad':>9}")
same = 0; n = 0
for qid, qq in lq.items():
    sg = call(line_text(GOOD, P["chart_data"]), {qid: qq})["answers"][qid]["noul"]
    sb = call(line_text(BAD, P["chart_data"]), {qid: qq})["answers"][qid]["noul"]
    g, b = bg["answers"][qid]["noul"], bb["answers"][qid]["noul"]
    n += 1; same += abs(g - b) < 0.1
    print(f"  {qid[:52]:52} {g:10.2f} {b:10.2f} {sg:10.2f} {sb:9.2f}")
print(f"\n  {same}/{n} questions answered the same for the good and the bad line (within 0.1)")

print("\n=== C. domain ratings (0..3 scale, expected value) ===")
dq = domain_questions()
CONV_GOOD = ("[t0 student] Good afternoon, I'm Priya, a nurse practitioner student. I'd like to hear what's been going on and make a plan together. Does that sound all right?\n"
             "[t1 patient] That's fine. I'm thirsty all the time.\n[t2 student] That must be wearing you down. When did you first notice it?\n"
             "[t3 patient] About three months ago.\n[t4 student] You look frightened. What are you most afraid of?")
CONV_BAD = ("[t0 student] So you're here about your diabetes?\n[t1 patient] I guess so.\n[t2 student] How long?\n[t3 patient] Three months.\n"
            "[t4 student] You need to take it as prescribed or your sugar won't come down. Why did you lie to me?")
for label, conv in (("good", CONV_GOOD), ("bad", CONV_BAD)):
    r = call(f"PATIENT CHART: {json.dumps(P['chart_data'])}\nCONVERSATION:\n{conv}", dq)
    print(f"  {label}: usage={r.get('usage')}")
    print("   ", {k.replace('domain__', 'd'): (round(v['score'], 2), round(v.get('confidence', 0), 2)) for k, v in r["answers"].items()})
print("\nPaste this whole output back.")
