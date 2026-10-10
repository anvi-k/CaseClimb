# Poscere evaluator

Grades a finished encounter against the rubric and runs the debrief (plan section 6, build step 4).

## What it does

Given a patient record and a completed episode, it produces:

- **The episode's `grading` block**, matching `schemas/episode.schema.json`: elicited and missed facts, a result per learning objective, a behavior trace, strengths, improvements.
- **An evaluation document**, matching `schemas/evaluation.schema.json`: the seven rubric domains scored 1 to 4 or N/A, the total, the three pieces of written evidence, the teacher-review flag, the optional case checklist, lies the student accepted, topics they never probed, goal progress, and opening questions for the debrief.
- **A debrief result**, matching `schemas/debrief_result.schema.json`: the two documents above merged into one self-contained file for the debrief screen, with fact labels, turn positions, and the transcript included. This is the one the front end reads. Samples are in `examples/output/`.
- **A debrief conversation** (`DebriefSession`) that asks the student to reason about specific moments.

The model scores and explains. The code decides what it may claim:

- Elicited and missed facts come from the episode's disclosure log, not from the model.
- Every quote is checked against the turn it cites. Quotes that do not match are dropped, and evidence pointing at a turn that does not exist is removed. The counts are in `evaluation.integrity`.
- An objective cannot be "met" while facts it lists as critical were never elicited.
- Totals and the review flag (a 1 in domain 6 or 7) are computed in code. N/A domains leave both the total and the maximum.

## Use

```python
from evaluator import BedrockLLM, DebriefSession, build_debrief_result, evaluate_episode

llm = BedrockLLM()
result = evaluate_episode(record, episode, llm, checklist=None, goals=None)

result.evaluation                 # rubric scores and debrief material
result.graded_episode(episode)    # copy of the episode with `grading` filled in
build_debrief_result(record, episode, result)   # one document for the debrief screen

debrief = DebriefSession(record, episode, result.evaluation, llm)
first = debrief.open()
reply = debrief.reply("She sounded sure, so I moved on.")
debrief.messages                  # store this; pass it back as messages= to resume
```

From the command line:

```bash
python -m evaluator --record examples/patient_record.json --episode examples/episode.json --debrief
```

Without AWS credentials, replay a saved grader response instead of calling Bedrock:

```bash
python -m evaluator --record examples/patient_record.json --episode examples/episode.json --replay examples/grader_response.json
```

`examples/grader_response.json` contains one misquote, one citation of a turn that does not exist, and one over-generous objective result, so the output shows each correction.

## Running inside the Poscere app

The app in `../app` (copied from the `lowhangingfruit26` repository at commit `a14043b`) scores every submitted visit with this evaluator. `app/src/lib/engine/evaluator.ts` builds the visit bundle, runs `python -m evaluator.poscere`, and stores what comes back as the visit's feedback. The feedback page shows the debrief questions and under-probed topics in two extra cards.

```bash
python3 -m venv .venv && .venv/bin/pip install -e .
```

```bash
cd app && npm install && cp .env.example .env.local && npm run dev
```

- The app looks for the evaluator one folder up and for Python at `../.venv/bin/python`. Override with `EVALUATOR_ROOT` and `EVALUATOR_PYTHON`.
- The evaluator uses the same AWS credentials and region as the app.
- Points-checklist rubrics are still scored by the app's original scorer; only domain rubrics go to the evaluator.
- `EVALUATOR_REPLAY=/path/to/grader_response.json` scores with a saved grader reply and no Bedrock call, for testing.

### Grading visits from the Poscere app

The Poscere app (TypeScript, in the `lowhangingfruit26` repository) stores a visit as an encounter row with a case snapshot, a config, a state holding the disclosure ledger, and message rows. `evaluator.poscere` takes those as one JSON bundle and returns feedback in the app's own `Feedback` shape, so its feedback page can render the result unchanged.

```bash
python -m evaluator.poscere --bundle examples/poscere/visit_bundle.json > result.json
```

Or pipe the bundle in on standard input. The output is `{"feedback": ..., "debrief_result": ...}`. From Python: `evaluator.poscere.grade_visit(bundle, BedrockLLM())`.

The bundle is built on the app side from `loadEncounter(id)` and `messagesOf(id)`:

```json
{
  "encounter": {"id": "", "user_id": "", "case_id": "", "status": "", "started_at": "", "ended_at": ""},
  "case": "row.case_snapshot (CaseProfile)",
  "config": "row.config (EncounterConfig)",
  "state": "row.state (EncounterState)",
  "messages": [{"id": 1, "turn": 1, "speaker": "student", "text": "", "meta": null, "created_at": ""}],
  "write_up": "row.wrapup, as {fieldId: text}",
  "student": {"name": ""},
  "profession": "profession(config.professionId)",
  "rubric": "getRubric(case.rubricId); optional"
}
```

How the app's data is read:

- **Facts and orders.** Every fact is something the student can earn by asking; exams and orders become chart facts earned by ordering. Anything on record at turn 0 came from an earlier visit and is not credited. Red herrings are left out unless the visit's difficulty turns them on, and approved variant wording is applied.
- **Findings.** `elicited`, `missed`, `actionsDone`, `actionsMissed` and `unnecessaryOrders` are read from the app's ledger exactly as the app's own scorer reads it.
- **Mismatches** become discrepancies; `noticed` is true when the student uncovered or challenged the claim.
- **The answer key, knowledge sources and chart-at-start** are given to the grader as sources. The written write-up is graded too, and quotes from it are checked like transcript quotes.
- **Patient comfort.** Each patient reply carries the feeling and comfort score the app recorded, so the grader can see when comfort dropped.
- **Rubric.** A domain rubric passed in the bundle (the app's default or a faculty-written one) is used with its score descriptors. Points-checklist rubrics are not supported and raise an error. With no rubric in the bundle, the stand-in rubric in this package is used.
- **Extra output.** `feedback.debrief` holds the debrief questions, under-probed topics and behaviour trace, which the app's `Feedback` type does not have. `accuracyIssues`, `wrapUpReview` and `interview.sequencing` are left empty.

`examples/poscere/visit_bundle.json` is one of the app's AI-drafted seed cases with a short hand-written visit.

### Grading encounters from the earlier FastAPI app

The deployed app (`main`, `backend/`) stores cases as `CaseDraft` and sessions as encounter records with an event log. `evaluator.app_bridge` converts both into the evaluator's inputs:

```python
from evaluator.app_bridge import episode_from_encounter, record_from_case

record = record_from_case(case.model_dump(), case_id=case_id, version=version, published_at=published_at)
episode = episode_from_encounter(encounter, case.model_dump(), student_id="u.jo", student_name="Jo")
result = evaluate_episode(record, episode, BedrockLLM())
```

- Release rules map to `at_start` (initially released), `after_fact` (has prerequisites), or `when_asked` (keywords only), so only facts the student earned count as elicited.
- A fact with a `nondisclosure_answer` becomes a discrepancy: the cover answer is the patient's claim and the fact is the truth.
- Objectives keep their `required_fact_ids` as critical facts; their label and guidance become the description the grader reads.
- The app has no patient sex or fact categories, so the record uses `unknown` and `other`.

Or in one call, straight from what the app stores:

```python
from evaluator.app_bridge import grade_app_encounter

graded = grade_app_encounter(version["case"], encounter, BedrockLLM())
graded["debrief_result"]   # the document the debrief screen renders
```

- Encounters with status `completed` or `expired` are graded; `active` ones are refused.
- The app's nonclinical conversation demo (`mode: "conversation_demo"`) has no objectives and is refused with a clear error.
- The app's `simulated_mood` and per-turn `rapport_change` are not carried over, because the episode schema has no field for them.

`examples/app/` holds the app's demo case and an encounter produced by running the app's engine on it. `api_case.json` and `api_encounter.json` are the full payloads stored by `main`'s FastAPI app (commit 0b42252) after publishing that case and running an encounter through the HTTP API.

## Setup

```bash
python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"
```

```bash
.venv/bin/python -m pytest
```

Bedrock uses the standard AWS credential chain. `AWS_REGION` or `AWS_DEFAULT_REGION` sets the region (default `us-east-1`) and `POSCERE_GRADER_MODEL` sets the model (default `us.anthropic.claude-sonnet-5`, the best model the challenge's workshop accounts allow). Run `python scripts/check_bedrock.py` to see which models an account may call.

## Inputs that have no schema yet

- **Rubric**: `evaluator/rubrics/patient_encounter_performance.json` is a stand-in written from the plan. The organisers' `encounter_evaluation_rubric.json` is read as it is: pass its path with `--rubric`, or the loaded rubric with `rubric=`.
- **Case checklist**: `{"checklist_id", "title", "items": [{"item_id", "description", "points"}]}`. See `evaluator/rubrics/example_checklist_pediatric_hearing.json`.
- **Student goals**: `[{"goal_id", "description"}]`.
