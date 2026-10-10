# Evaluator

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

### Grading encounters from the app

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

Bedrock uses the standard AWS credential chain. `AWS_REGION` or `AWS_DEFAULT_REGION` sets the region (default `us-east-1`) and `CASECLIMB_GRADER_MODEL` sets the model (default `us.anthropic.claude-sonnet-5`, the best model the challenge's workshop accounts allow). Run `python scripts/check_bedrock.py` to see which models an account may call.

## Inputs that have no schema yet

- **Rubric**: `evaluator/rubrics/patient_encounter_performance.json` is a stand-in written from the plan. Replace it with the rubric JSON from the organisers, or pass another with `rubric=`.
- **Case checklist**: `{"checklist_id", "title", "items": [{"item_id", "description", "points"}]}`. See `evaluator/rubrics/example_checklist_pediatric_hearing.json`.
- **Student goals**: `[{"goal_id", "description"}]`.
