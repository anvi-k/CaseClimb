# laya_kit: live rubric scoring with Laya

Scores a clinical-student interview against the 7-domain Patient Encounter Performance Rubric, line by line,
with a rating refresh about every 30 seconds.

## Layout
- `laya_live.py`                      the scorer (stdlib only)
- `test_laya_live.py`                 tests
- `encounter_evaluation_rubric.json`  the rubric (must sit beside laya_live.py)
- `profiles/maria_alvarez.json`       the only patient-specific file
- `episodes/`                         three example transcripts
- `diagnose_laya.py`                  prints Laya's raw answers (good line vs bad line)
- `eval_laya.py`                      measures which question wordings Laya answers correctly; calibrates ratings

## Run (open a terminal in this folder; use python3 on Mac if python fails)
1. Offline check, no server needed:   `python test_laya_live.py`      (expect 23/23)
2. Start Laya (Apple silicon Mac):    `pip install laya-mlx-http` then `laya-mlx-http`
3. Smoke-test the server:             `python test_laya_live.py --server http://127.0.0.1:8000`
4. Real test on the 3 episodes:       `python test_laya_live.py --url http://127.0.0.1:8000`
4b. Measure the questions:            `python3 eval_laya.py`  (a few minutes)
5. Inspect one run:                   `python laya_live.py replay profiles/maria_alvarez.json episodes/episode_strong.json`

The offline test uses a keyword stand-in, not Laya. Only steps 3 and 4 test Laya itself.

## Adding a patient
Copy `profiles/maria_alvarez.json`, change the chart, tasks (done_when / partial_when, linked_fact) and safety_checks.
No code changes.

## Live use
    S = LayaScorer(load_profile("profiles/maria_alvarez.json"), LayaClient("http://127.0.0.1:8000"))
    snap = S.add_line("student", text, turn_id)   # call for patient lines too
    S.record_disclosure("f.med.refills")          # when the engine releases a fact
    LiveTicker(S, on_update=push_to_ui).start()
    report, summary = S.final_report()
