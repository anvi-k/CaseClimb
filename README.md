# Poscere

Poscere is a practice tool for health-professions students. A student holds a ten-minute video-style
visit with a virtual patient, reads the patient's chart as it fills in, and gets a scored debrief
that quotes what they actually said. An instructor assigns patients, reads the reports, and adds
their own note.

*Poscere* is Latin for "to ask". The project was first called CaseClimb, which is why the
repository and a few older folders still carry that name.

Built for RU Health Hack 2026, TwinVerse Challenge 1, "The Virtual Patient Encounter System".

> Every patient is synthetic. No profile has been reviewed by a clinician. This is a teaching
> prototype and is not for clinical use.

## What it does

**For a student**

- **My patients.** The patients their instructor assigned, each with a portrait and a Start visit
  button. They can be seen in any order; finished ones move to a Completed section.
- **The visit.** The patient on the left (voice or typing), the chart on the right. History the
  student takes is filed into the chart; exams, tests and records are requested from a Results tab.
  A visit is capped at ten minutes.
- **The debrief.** A score out of 28 across seven domains, what was found and what was missed, the
  places where the patient's account and the chart disagreed, and questions to think through.
- **Practice.** An extra private visit. The student chooses only the patient's temperament.

**For an instructor**

- **My class.** A join code, the visits waiting for review, and each student's progress. Clicking
  a student shows their reports and the visits they still have to complete.
- **Patients.** One row per patient with portrait, main health issue and personality. Assign opens
  a pop-up to pick the students and the temperament. Open shows a short summary of the patient.
- **New patient.** One temperament slider. The clinical record comes from a real-data-style
  patient record and the conversation is written to match.
- **Review.** A visit is flagged for the instructor when clinical reasoning or safety scored 1.
  Saving a note returns to the class page.

**Temperament** replaces difficulty levels. There are five: Easygoing, Reserved, Guarded,
Frustrated and Very difficult. It changes how hard the patient is to interview, never the medical
facts.

## Where the patients come from

There are 44 patients, in [`app/data/seed/cases/`](app/data/seed/cases/).

| Count | Source | What is from data | What a language model wrote |
|---|---|---|---|
| 8 | The organisers' sample profiles | The profile as provided | Expansion into chart documents, disclosure rules and an answer key |
| 36 | [Synthea](https://github.com/synthetichealth/synthea) synthetic records | Name, age, sex, problem list, medications, allergies, vital signs, laboratory results, immunisations | Personality, eating pattern, social situation, what the patient holds back |

The Synthea values are written into each case by code, not by the model, and the case keeps the
record id so the values can be checked against [`app/data/synthea/records.json`](app/data/synthea/records.json).
The model was asked to vary nutrition, psychosocial profile and how readily each patient discloses.
Portraits were generated with Stable Diffusion 3.5 Large on Amazon Bedrock.

## How a visit is scored

Scoring is done by [`evaluator/`](evaluator/README.md), a Python package the app calls when a visit
ends.

- **Rubric.** The provided Patient Encounter Performance Rubric: seven domains, each scored 1 to 4,
  for a total out of 28. A domain that does not apply is marked N/A and left out of the total.
- **Evidence.** Every quote in the feedback is checked against the transcript; a quote that is not
  there is rejected and the grader is asked again.
- **Facts, not impressions.** What the student found and missed is read from the visit's disclosure
  log by code. The model judges only the domains.
- **Review flag.** If clinical reasoning (domain 6) or professionalism and safety (domain 7) scores
  1, the visit is flagged for the instructor whatever the total.
- **Voice.** Feedback is written about "the student", because the student and the instructor read
  the same text.

The grader is Claude Sonnet 5 on Amazon Bedrock. Its output is validated against
[`schemas/evaluation.schema.json`](schemas/evaluation.schema.json), and the result handed to the
interface follows [`schemas/debrief_result.schema.json`](schemas/debrief_result.schema.json).

## Run it

You need Node.js 20 or later, Python 3.11 or later with [uv](https://docs.astral.sh/uv/), and AWS
credentials that can call Claude and Stable Diffusion on Amazon Bedrock.

Install the grader, from the repository root:

```bash
uv sync --extra evaluator
```

Install the app:

```bash
cd app && npm install
```

Create the app's settings file, then put your AWS credentials and a session secret in it:

```bash
cp .env.example .env.local
```

Build and start, from `app/`:

```bash
npm run build && npm run start
```

Open http://localhost:3000. Two demo accounts, one instructor and one student, are listed on the
sign-in page. The database is created and filled on first start. After changing code, stop the
server and run the build-and-start command again.

Settings that matter:

| Variable | Used by | Meaning |
|---|---|---|
| `AWS_REGION` and the AWS credential variables | app and grader | Bedrock access |
| `EVALUATOR_PYTHON` | app | Python that runs the grader. Default: `.venv/bin/python` in the repository root |
| `POSCERE_GRADER_MODEL` | grader | Model id. Default: `us.anthropic.claude-sonnet-5` |
| `POSCERE_GRADER_EFFORT` | grader | `low` (default), `medium` or `high` |
| `ELEVENLABS_API_KEY` | app | Optional. Patient voice |

## Tests

```bash
uv run pytest
```

The grader's tests use recorded model replies, so they need no AWS access. To grade one of the
sample transcripts with the real model, see [`evaluator/README.md`](evaluator/README.md).

## What is in the repository

| Path | What it is |
|---|---|
| [`app/`](app/README.md) | The Poscere web app: Next.js, React, SQLite |
| [`evaluator/`](evaluator/README.md) | The grader and debrief builder |
| `schemas/` | JSON schemas for the grader's output |
| `examples/` | Sample transcripts and the debriefs produced from them |
| `scripts/` | Bedrock access check and sample-output builder |
| `tests/` | Python tests |
| `backend/`, `frontend/`, `infra/`, `research/` | The team's first prototype (see below) |

## The earlier prototype

Before the team settled on the app in `app/`, it built a first version under the name CaseClimb: a
FastAPI service in [`backend/`](backend/README.md) with a static front end in `frontend/`, an AWS
deployment in [`infra/`](infra/README.md), and the planning and research notes in
[`research/`](research/README.md). It is kept for reference and is not what the demo shows. Its
code, settings and notes keep the CaseClimb name, including the `CASECLIMB_*` environment variables
that code reads.

## Known limits

- No patient profile has been reviewed by a clinician, and the Synthea records are synthetic.
- Scores come from a language model applying a rubric. They are formative feedback, not a
  validated grade.
- Care journeys, live observation and the full patient editor still exist in the code but are no
  longer offered from the main screens.
- A patient created with New patient has no portrait until the portrait script is run.
- The organisers' sample profiles, rubric and portraits are included under `app/`. The health
  markers dataset, the raw sample file and the Synthea program are not in the repository.
