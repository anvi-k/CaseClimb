# CaseClimb plan: what's left to build (v2)

**Written:** Sat Oct 10, 2026, 6:40 PM EDT. **Deadline:** submissions and presentations due **Sun Oct 11, 12:00 PM**; track judging 1:00 PM. About 17 hours remain.

This replaces a first draft that assumed an empty repository. An independent adversarial review failed that draft (summary at the end). v2 builds on what teammates have already shipped on `main`, the `evaluator` branch, and the `schemas` branch.

## The product

An avatar voices a virtual patient and visibly reacts during long conversations with health-professions students. A second model grades the conversation, and the student and faculty see a timeline of how it went. Patients remember earlier visits: a later student may hear "Dr. Lee told me last week that…", citing a real earlier episode. Faculty can create patients from scratch or generate drafts, review them, and publish.

## What already exists

| Area | Where | State |
| --- | --- | --- |
| FastAPI backend on Lambda, DynamoDB, S3, CloudFormation, CloudWatch | `main` | Deployed in us-west-2 behind a shared password ([README](../README.md)) |
| Patient Studio: draft, edit raw JSON, validate, reviewer attestation, immutable publish | `main` | Built; no structured form, no knowledge sources, text-only artifacts |
| Encounter: 10-minute timer, transcript, chart panel with keyword/prerequisite progressive disclosure, nondisclosure and clarification, event log | `main` | Built |
| Patient replies | `main` `backend/engine.py` | **Always faculty-authored text.** Bedrock (Nova Lite) only selects among already-allowed fact IDs. No generative patient. |
| Feedback | `main` `backend/engine.py`, `backend/debrief.py` | Objectives marked observed/missed/not assessable from keywords; no rubric scores |
| Voice | `main` | ElevenLabs TTS with per-case voice and emotion presets; browser dictation |
| Avatar | `main` | SVG patient plus a prerecorded ElevenLabs clip; LiveAvatar adapter disabled. A reactive SVG face plan is in progress: `research/reactive-avatar-plan.md` (uncommitted on `main` at time of writing) |
| 8 sample patients | `scripts/import_patients.py` | Imported to the cloud as **unreviewed drafts with no reveal rules. The published case library is empty.** |
| Evaluator: 7-domain 1–4 rubric, quote checking, review flag, Socratic debrief | `evaluator` branch | Built on `schemas`; branched from the initial commit, so it will conflict with `main` on `pyproject.toml` and `.gitignore` |
| Patient record and episode JSON Schemas | `schemas` branch | Pushed; not used by `main` |

## Decisions the team needs to make now

1. **Which challenge we submit to.** Recommendation: **Challenge 1** (Virtual Patient Encounter). The track has one grand prize, and neither brief says a team can target both. Present patient memory as C1 Stretch ("advanced memory/state architectures"). Claim C2 only if we also add AI clinicians built from the 5 provided personas, at least 3 encounters, a shared team state, an integrated care plan, and the architecture document. `research/challenge-scope.md` on `main` reached the same conclusion.
2. **Whether the patient's words are authored or generated.** `main` only plays authored text, which is the safest possible answer to the briefs' "never invent clinical facts" rule. The vision of "Claude plays the patient" needs generated phrasing. Recommended middle ground, call it **grounded phrasing**:
   - The engine still decides which facts are released, exactly as now.
   - Claude writes the reply using only the persona, the released facts' approved wording, and approved memory entries.
   - Then check the output: any clinical value or claim not traceable to a released fact sends the reply back to the authored text.
   - Keep authored-only mode as a per-case faculty switch.
3. **One data model.** `main` uses the pydantic `CaseDraft`; the evaluator uses `patient_record.schema.json`. Recommendation: keep `CaseDraft` as the source of truth, because it is deployed and tested. Write one adapter from `CaseDraft` plus encounter events to the evaluator's record and episode shapes. Extend the schemas only where memory or grading needs a field.

## Work list, in priority order

Each item has the check that shows it is done.

### P0: needed for the judged demo
1. **Publish 2–3 reviewed cases** from the 8 imports. Convert their disclosure tiers into keywords and prerequisites:
   - initial → released at start
   - discoverable → released when asked
   - reluctant → needs a rapport signal or a clarification keyword
   - hidden → only through specific questions

   Fix stated BMI values that disagree with height and weight: the reviewer found 6 of 8 off by more than 1.0, for example Omar 29 stated vs about 32.7 computed.
   *Check:* the library lists the published cases and a student can complete one.
2. **Merge the evaluator into `main`'s feedback.**
   - Switch its Bedrock call from the Mantle client's `output_config.format` to Converse or `InvokeModel` on bedrock-runtime. Per AWS docs, the Mantle endpoint rejects that parameter with a 400 error. This has not been confirmed with a live call.
   - Strip JSON Schema keywords Bedrock structured output doesn't support (`minimum`, `maximum`, `minLength`, `minItems` above 1).
   - Load the organizers' `encounter_evaluation_rubric.json` in place of the stand-in rubric. It cannot be committed, so load it from configuration.

   *Check:* a finished deployed encounter shows domain scores with quoted evidence.
3. **Studio: knowledge sources and artifact attachment.** Both are C1 Base bullets and neither exists today. Add file upload (lab report, ECG, imaging, prior note) stored in S3, linked to facts, with a release rule. Rendered in the chart panel when released.
   *Check:* attach a lab PDF in Studio, publish, and see it appear mid-encounter.
4. **Rehearse the key demo as the judges will run it.** A judge (not us) creates a new patient in Studio, publishes it, and immediately runs an encounter with that patient, with no code changes.
   *Check:* someone outside the team does this unaided in under 5 minutes.

### P1: what makes us stand out
5. **Conversation timeline.** Build it from the event log `main` already stores (turns, disclosed facts, mood).
   - **Lanes:** patient mood and rapport, disclosure tier unlocks, and markers for missed cues, noticed or missed contradictions, and safety flags.
   - **Live during the encounter:** event markers only. **At the end:** the 7 domain scores. The rubric says to "rate only what the scenario makes possible to observe", so closure and shared-plan domains cannot be scored mid-conversation.
   - Clicking a marker jumps to that turn.

   *Check:* the timeline updates during an encounter and links to transcript turns.
6. **Grounded phrasing** (decision 2), behind a per-case switch.
   *Check:* a hostile prompt asking the patient to state a new lab value or reveal the answer key gets the authored fallback.
7. **Reactive avatar:** SVG face steps 1–3 of `research/reactive-avatar-plan.md`.

### P2: the vision features
8. **Patient memory across episodes.**
   - Today encounters expire after 24 hours. Persist completed, graded episodes, or a memory summary, without the TTL.
   - Store a short first-person memory per episode: what each clinician said, by name and role, whether the patient trusts it, and whether they followed the advice.
   - Inject approved memory into the next encounter's grounded-phrasing context. Memory never adds clinical facts.
   - For the demo, seed one graded prior episode ahead of time.

   *Check:* a second student's encounter has the patient cite the first clinician by name, linked to the real earlier turn.
9. **Generate a patient draft.**
   - Input: a one-liner plus learning objectives, with 2 sample profiles as examples.
   - Claude writes a `CaseDraft` as structured output.
   - Lab and vital numbers come from reference-range tables with joint constraints, such as A1c and average glucose (ADAG: 28.7 × A1c − 46.7), not chosen independently.
   - Every generated item is marked as an AI draft until faculty approve it. A model never approves its own case.

   *Check:* a generated draft opens in Studio with flagged items and cannot be published without review.
10. **Portraits** for generated patients. Amazon Nova Canvas reached end of life on Bedrock on 2026-09-30, so use another image model or pick from a stock portrait set.

### Pitch and submission (budget 1.5 hours)
- Short demo video as a fallback for the live demo.
- 4-minute pitch: problem (30 s), live key demo (2 min), architecture and grounding guarantees (45 s), educational value and limits (45 s).
- README run instructions.

## Risks
- **Empty published library.** Nothing can be demoed clinically until P0 item 1 is done.
- **Mood is not an empathy score.** Simulated rapport and mood reflect the engine's state. Present them as a timeline, not as a grade.
- **Grounded phrasing loosens the guarantee `main` has today.** Ship it behind a switch, with the output check and the hostile-prompt test.
- **Evaluator latency and cost** with Opus at high effort have not been measured. Measure on one deployed encounter before the demo.
- **Organizer materials** (patient profiles, portraits, rubric, briefs) are kept out of this public repo by team convention. Load them from `.private/` or S3 configuration.

## What the review found in v1

An independent Opus reviewer checked 17 claims from the first draft against the briefs, the data and the repo: 4 verified, 9 refuted, 3 disputed, 1 unverifiable. The main corrections:
- **Wrong stack:** v1 proposed rebuilding on Next.js/Postgres, duplicating what `main` already ships.
- **Scope:** v1 straddled C1 and C2 without the C2 Base pieces (AI clinicians from the provided personas, 3 encounters, care plan, architecture document).
- **Studio:** v1 omitted knowledge sources and artifact attachment.
- **Patient record schema:** cannot hold the source profiles' reluctant/hidden tiers, patient reactions, beliefs and fears, or expected discoveries. Its required `chief_complaint` does not exist in the source data.
- **Fact gating:** v1's free-text patient had no output check, a regression from `main`.
- **Live grading:** per-turn scores for all 7 rubric domains are not observable.
- **Build order:** v1's tasks summed to 18 hours against 17 available.
- **Key demo:** v1's script had the team, not a judge, create the patient.
- **Portraits:** v1 relied on Nova Canvas, which is past end of life.
