# Evaluator

Grades a finished encounter against the rubric and runs the debrief (plan section 6, build step 4).

## What it does

Given a patient record and a completed episode, it produces:

- **The episode's `grading` block**, matching `schemas/episode.schema.json`: elicited and missed facts, a result per learning objective, a behavior trace, strengths, improvements.
- **An evaluation document**, matching `schemas/evaluation.schema.json`: the seven rubric domains scored 1 to 4 or N/A, the total, the three pieces of written evidence, the teacher-review flag, the optional case checklist, lies the student accepted, topics they never probed, goal progress, and opening questions for the debrief.
- **A debrief conversation** (`DebriefSession`) that asks the student to reason about specific moments.

The model scores and explains. The code decides what it may claim:

- Elicited and missed facts come from the episode's disclosure log, not from the model.
- Every quote is checked against the turn it cites. Quotes that do not match are dropped, and evidence pointing at a turn that does not exist is removed. The counts are in `evaluation.integrity`.
- An objective cannot be "met" while facts it lists as critical were never elicited.
- Totals and the review flag (a 1 in domain 6 or 7) are computed in code. N/A domains leave both the total and the maximum.

## Use

```python
from evaluator import BedrockLLM, DebriefSession, evaluate_episode

llm = BedrockLLM()
result = evaluate_episode(record, episode, llm, checklist=None, goals=None)

result.evaluation                 # rubric scores and debrief material
result.graded_episode(episode)    # copy of the episode with `grading` filled in

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

## Setup

```bash
python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"
```

```bash
.venv/bin/python -m pytest
```

Bedrock uses the standard AWS credential chain. `AWS_REGION` sets the region (default `us-east-1`) and `CASECLIMB_GRADER_MODEL` sets the model (default `anthropic.claude-opus-5-5`).

## Inputs that have no schema yet

- **Rubric**: `evaluator/rubrics/patient_encounter_performance.json` is a stand-in written from the plan. Replace it with the rubric JSON from the organisers, or pass another with `rubric=`.
- **Case checklist**: `{"checklist_id", "title", "items": [{"item_id", "description", "points"}]}`. See `evaluator/rubrics/example_checklist_pediatric_hearing.json`.
- **Student goals**: `[{"goal_id", "description"}]`.
