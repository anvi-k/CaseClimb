"""Tests for laya_live.py.
  python test_laya_live.py                        # offline: plumbing + the 3 example episodes with a FAKE Laya
  python test_laya_live.py --server URL           # smoke-test a real Laya server (shape, direction, latency)
  python test_laya_live.py --url URL              # run the 3 episodes through the REAL Laya and check the same expectations

FakeLaya is keyword rules written for the Maria Alvarez case. It is NOT a model. It exists so the wiring
(thresholds, ticks, evidence, review flags, report) can be tested without a server. Passing offline tests
says the code is wired correctly; only --server / --url say whether Laya itself scores well.
"""
import argparse, glob, json, os, re, sys, time
from laya_live import (LayaScorer, LayaClient, load_profile, finalize_profile, replay, validate_report, yn, RUBRIC, load_episode)

HERE = os.path.dirname(os.path.abspath(__file__))
results = []
def ok(cond, msg): results.append(bool(cond)); print(("PASS  " if cond else "FAIL  ") + msg); return cond


# ---------------------------------------------------------------- fake Laya (test double only)
def has(s, *w): return any(x in s for x in w)

def fake_laya(text, qs):
    out = {}
    if "LATEST STUDENT LINE:" in text:
        L = text.split("LATEST STUDENT LINE:")[-1].strip().lower()
        for qid, q in qs.items():
            kind, key = qid.split("__")[0], qid.split("__")[1]; p = 0.05
            if kind == "task":
                if key == "introduce_self": p = 0.9 if (re.search(r"i'm \w+", L) and has(L, "student", " np ")) else 0.05
                elif key == "set_agenda": p = 0.9 if has(L, "what brings you", "make a plan", "what's been going on") else (0.6 if has(L, "about your diabetes") else 0.05)
                elif key == "summarize_and_next_steps": p = 0.9 if has(L, "so:") else (0.6 if has(L, "see you", "come back") else 0.05)
                elif key == "discrepancy-adherence": p = 0.9 if has(L, "not trying to catch", "what gets in the way") else (0.6 if has(L, "pharmacy", "filled it", "two fills") else 0.05)
                elif key == "respond-to-fear": p = 0.9 if has(L, "frightened", "scares you", "afraid") else 0.05
                elif key == "shared-plan": p = 0.9 if has(L, "feels doable", "willing to") else (0.6 if has(L, "please try") else 0.05)
            elif kind == "safety": p = 0.95 if (key == "plan_on_unverified_adherence" and has(L, "since you're already taking", "raise the dose")) else 0.02
            elif kind == "evidence":
                kw = {"1": ["i'm", "today", "what brings"], "2": ["exhausting", "must be", "sorry", "thank", "frightened", "need to", "why did you tell"],
                      "3": ["how long", "when did", "tell me", "walk me", "what", "any ", "do you"], "4": ["pharmacy", "refill", "frightened", "afraid", "why did you tell", "record"],
                      "5": ["hba1c", "percent", "questions", "doable", "average"], "6": ["hba1c", "metformin", "dose", "pharmacy", "record"],
                      "7": ["see you", "come back", "preceptor", "dr. chen", "questions"]}[key]
                p = 0.9 if has(L, *kw) else 0.05
            out[qid] = {"type": "noul", "noul": p, "confidence": 0.9}
        return out
    S = " ".join(l.lower() for l in re.findall(r"\[\S+ student\] (.*)", text))
    n = lambda *w: sum(S.count(x) for x in w)
    opn = len(re.findall(r"(tell me|walk me|what |how |when )", S))
    sc = {"1": min(3, (1 if re.search(r"i'm \w+", S) else 0) + n("make a plan", "what brings", "about your diabetes") + n("sound all right")),
          "2": max(0, min(3, n("exhausting", "must be", "sorry", "frightened", "makes sense", "i don't think that", "thank you for telling") - n("why did you tell", "need to take"))),
          "3": 3 if opn >= 5 else 2 if opn >= 3 else 1 if opn >= 1 else 0,
          "4": max(0, min(3, int(has(S, "pharmacy", "refill")) + int(has(S, "frightened", "afraid")) + int(has(S, "what gets in the way")) - n("why did you tell"))),
          "5": min(3, int(has(S, "hba1c")) + int(has(S, "average", "fits with")) + int(has(S, "questions", "doable", "is that okay"))),
          "6": max(0, min(3, int(has(S, "pharmacy", "refill")) + int(has(S, "hba1c")) + int(has(S, "fits with", "expect")) - 2 * n("raise the dose"))),
          "7": min(3, int(has(S, "see you", "come back")) + int(has(S, "preceptor", "dr. chen")) + int(has(S, "questions")))}
    return {qid: {"type": "score", "score": 1.5 + 0.4 * float(sc[qid.split("__")[1]]), "confidence": 0.1} for qid in qs}   # on the calibrated scale; low confidence like the real model


# ---------------------------------------------------------------- tests
def test_plumbing():
    print("\n== plumbing ==")
    for f in glob.glob(os.path.join(HERE, "profiles", "*.json")):
        P = load_profile(f); linked = [t["linked_fact"] for t in P["all_tasks"] if t.get("linked_fact")]
        ok(all(d in (1, 2, 3, 4, 5, 6, 7) for t in P["all_tasks"] for d in t["rubric_domains"]), f"{os.path.basename(f)}: valid rubric domain ids on all tasks ({len(P['all_tasks'])} tasks)")
        ok(len(set(linked)) == len(linked), "  linked facts are unique")
    # tick cadence on a controlled clock
    clock = [0.0]; calls = []
    def laya(text, qs): calls.append(clock[0]) if "CONVERSATION:" in text and "LATEST" not in text else None; return fake_laya(text, qs)
    P = load_profile(os.path.join(HERE, "profiles", "maria_alvarez.json"))
    S = LayaScorer(P, laya, 30, clock=lambda: clock[0])
    for t in (0, 10, 20, 31, 40, 70): clock[0] = t; S.add_line("student", f"hello {t}")
    ok(calls == [0, 31, 70], f"domain rating fires on a ~30 s cadence (at {calls})")
    # server down
    S2 = LayaScorer(P, lambda t, q: (_ for _ in ()).throw(ConnectionError("down")), 30); S2.add_line("student", "hi")
    ok(S2.degraded and S2.snapshot()["live_progress"] == 0, "server failure -> degraded flag, no crash, score unchanged")
    # a domain with no cited evidence stays pending
    S3 = LayaScorer(P, lambda t, q: {k: {"type": v["type"], "noul": 0.0, "score": 3.0, "confidence": 1} for k, v in q.items()}, 30)
    S3.add_line("student", "hi"); ok(all(v == "pending" for v in S3.snapshot()["domains"].values()), "no evidence -> every domain stays pending (score can't be invented)")


def run_episodes(laya, label, strict_model):
    print(f"\n== example episodes ({label}) ==")
    P = load_profile(os.path.join(HERE, "profiles", "maria_alvarez.json")); R = {}
    for name in ("default", "strong", "confrontational"):
        ep = json.load(open(os.path.join(HERE, "episodes", f"episode_{name}.json")))
        S, lines = replay(P, ep, laya); out, summ = S.final_report()
        R[name] = (S, out, summ, lines)
        print(f"  {name:15s} timeline(sec, honest, shown)={S.history}")
        print(f"  {'':15s} rubric {summ['rubric_total']}  checklist {summ['checklist']}  review={summ['needs_teacher_review']} {summ['review_reasons']}")
        ok(not validate_report(out, lines), f"{name}: every cited turn exists and is a student turn")
        shown = [h[2] for h in S.history]
        ok(all(b >= a for a, b in zip(shown, shown[1:])), f"{name}: displayed progress never decreases")
    t = lambda n: R[n][2]["rubric_total_int"]; c = lambda n: R[n][2]["checklist_points"]
    ok(c("strong") > c("default") and c("strong") > c("confrontational"), f"checklist: strong {c('strong')} beats default {c('default')} and confrontational {c('confrontational')}")
    ok(t("strong") > t("default"), f"rubric total: strong {t('strong')} > default {t('default')}")
    d2 = lambda n: next(s["score"] for s in R[n][1]["domain_scores"] if s["domain_id"] == 2)
    ok(d2("strong") > d2("confrontational"), f"empathy domain: strong {d2('strong')} > confrontational {d2('confrontational')}")
    d7 = next(s for s in R["default"][1]["domain_scores"] if s["domain_id"] == 7)
    ok(d7["score"] <= 2, f"default episode: safety flag caps domain 7 at 2 ({d7['reason']})")
    ok(t("strong") > t("confrontational"), f"rubric total: strong {t('strong')} > confrontational {t('confrontational')}")
    sh = [h[2] for h in R["strong"][0].history]
    ok(len(sh) >= 3 and sh[-1] > sh[0], f"strong episode: score rises through the conversation ({sh[0]} -> {sh[-1]})")
    ok("plan_on_unverified_adherence" in R["default"][0].safety, "default episode: unsafe plan on unverified adherence is flagged")
    ok(R["default"][2]["needs_teacher_review"], "default episode: teacher review triggered")
    ok(not R["strong"][2]["needs_teacher_review"], "strong episode: no review needed")
    t_ref = {r["id"]: r for r in R["strong"][1]["task_results"]}
    ok(t_ref["elicit-refills"]["status"] == "completed" and t_ref["elicit-side-effects"]["status"] == "completed", "strong episode: refills + side-effects facts credited from the disclosure log")
    m = {r["id"]: r["status"] for r in R["default"][1]["task_results"]}
    ok(m["elicit-refills"] == "missed" and m["discrepancy-adherence"] == "missed", "default episode: never checked refills -> missed, lie not caught")
    ok(R["confrontational"][1]["task_results"][[r["id"] for r in R["confrontational"][1]["task_results"]].index("discrepancy-adherence")]["status"] != "completed",
       "confrontational episode: accusing the patient does not count as a full catch")
    print("  debrief inputs (default):", json.dumps(R["default"][1]["debrief_inputs"]))


def test_server(url):
    print("\n== real Laya server ==")
    L = LayaClient(url, timeout=30)
    qs = {"a": yn("Does the text greet someone warmly?"),
          "r": {"type": "score", "instructions": "Rate politeness.", "criteria": ["rude", "curt", "polite", "warm"]}}
    t = time.time()
    try: warm = L("Hello, lovely to meet you, I'm Sam.", qs)
    except Exception as e: ok(False, f"server unreachable: {e}"); return
    dt = time.time() - t
    ok(isinstance(warm["a"].get("noul"), float), f"yes/no answer has 'noul': {warm['a']}")
    ok(isinstance(warm["r"].get("score"), (int, float)), f"rating answer has 'score': {warm['r']}")
    rude = L("Whatever. Hurry up.", qs)
    ok(rude["a"]["noul"] < warm["a"]["noul"], "warm > rude on yes/no")
    ok(rude["r"]["score"] < warm["r"]["score"], "warm > rude on rating")
    ok(0 <= warm["r"]["score"] <= 3.2 and 0 <= rude["r"]["score"] <= 3.2, f"rating is on a 0..3 scale (rude={rude['r']['score']:.2f}, warm={warm['r']['score']:.2f}); the scorer does round(1+score)")
    # latency of a realistic per-line batch
    P = load_profile(os.path.join(HERE, "profiles", "maria_alvarez.json")); from laya_live import line_questions
    t = time.time(); L("PATIENT CHART: {}\nRECENT CONVERSATION:\n\nLATEST STUDENT LINE: Hi, I'm Sam, a student nurse practitioner.", line_questions(P))
    ok(time.time() - t < 5, f"per-line batch ({len(line_questions(P))} questions) took {time.time()-t:.2f}s (want < 5 s)")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("--server"); ap.add_argument("--url"); a = ap.parse_args()
    if a.server: test_server(a.server)
    elif a.url: run_episodes(LayaClient(a.url, timeout=30), "REAL Laya", True)
    else: test_plumbing(); run_episodes(fake_laya, "FAKE Laya: tests wiring only", False)
    print(f"\n{sum(results)}/{len(results)} checks passed"); sys.exit(0 if all(results) else 1)
