# Care Journeys: architecture and integration

Challenge 2, "The Connected Care Journey". This document describes what is built in the Poscere
repository: how one virtual patient moves through several professional encounters, how the team's
shared understanding of that patient is stored and traced, how information moves between
encounters, and how interprofessional communication is evaluated.

It is written for judges and for engineers who have not seen the code. File paths are given so
every claim can be checked.

## 1. What the system does

A faculty member picks one published patient case and defines an ordered list of encounters, each
with a professional role, a faculty-provided clinician persona, a focus and a simulated time. A
student opens the journey and chooses "Join as ..." for one encounter. The run then proceeds:

```
existing record ─► encounter 1 ─► SBAR ─► encounter 2 ─► SBAR ─► encounter 3 ─► ... ─► huddle ─► integrated view
                     │                      │                      │                     │
                     ▼                      ▼                      ▼                     ▼
              ┌──────────────────────────────────────────────────────────────────────────────┐
              │  shared patient state: append-only entries + typed relations between them    │
              └──────────────────────────────────────────────────────────────────────────────┘
```

- For the encounter the student chose, the student interviews the virtual patient in the normal
  Poscere visit screen, with a "Care team" tab showing the shared state and the handoff received.
- For every other encounter, an AI clinician (one of the five provided personas) conducts the
  visit while the student watches it stream.
- After every encounter the shared patient state is updated and the professional writes an SBAR
  to the next one.
- At any time the student can message any colleague, earlier or later in the order.
- After the last encounter the team holds a huddle over whatever is still disputed, uncertain or
  unanswered, then the integrated patient view, the coordinated care plan and the student's
  teamwork trace are produced.

Two journeys are seeded from the provided patients and personas
(`data/seed/journeys/*.json`): Marcus Ramirez (emergency medicine, cardiology, clinical pharmacy,
dietetics) and Walter Greene (emergency medicine, hospital medicine, dietetics).

### Challenge levels

| Level | Requirement | Where |
|---|---|---|
| Base | Three or more encounters, same patient, provided personas, student in one role, AI in the rest | `runner.ts`, `clinician.ts` |
| Base | Shared state updated after each encounter, record plus discovered information | `extract.ts` |
| Base | Earlier information influences a later encounter | `createStageEncounter`, `runAiVisit`, `uses` links |
| Base | Established / uncertain / disagreement / unanswered distinguished | entry `status`, derived `effectiveStatus` |
| Base | Provenance: source, role, encounter, timing | columns on every `state_entries` row |
| Base | Integrated representation and coherent care plan | `view.ts`, `synthesis.ts`, `FinalView.tsx` |
| Enhanced | SBAR handoffs, TeamSTEPPS-aligned explainable behavioural trace | `handoff.ts` |
| Stretch | Reach forward and backward, consults, call-outs, check-backs, closed loops, huddle, reconciliation, collaborative plan change | `collab.ts` |

All paths below are under `src/lib/journey/` unless stated.

## 2. Patient-state architecture

The shared patient state is not a document and not a chat log. It is a set of small typed
**entries** plus typed **relations** between them.

### Entries (`state_entries`, defined in `src/lib/db.ts`)

One row is one piece of knowledge about the patient. Fields:

| Field | Meaning |
|---|---|
| `kind` | `record`, `finding`, `result`, `goal`, `assessment`, `interpretation`, `recommendation`, `referral`, `plan_item`, `uncertainty`, `open_question`, `disagreement`, `follow_up`, `consult`, `callout`, `resolution`, `plan_change` |
| `status` | `established`, `patient_reported`, `uncertain`, `disputed`, `open_question`, `resolved` |
| `source` | `record`, `patient`, `exam`, `test`, `clinician`, `consult`, `huddle` |
| `contributor_role`, `contributor_name`, `contributor_is_ai` | who added it, in which professional role, and whether that was an AI colleague or the student |
| `stage_id`, `stage_order`, `encounter_id` | which encounter of the journey, and the engine encounter that carried it |
| `sim_time`, `created_at` | simulated time of the encounter and the real time of recording |
| `fact_id` | the case fact it corresponds to, when it came from the disclosure ledger |
| `evidence` | JSON: where the supporting words are (visit turn, note, record, consult, huddle), the quote, and whether the quote was verified |
| `meta` | flags such as values not found in the approved case file, importance, follow-up owner |

Entries are **append-only**. `addEntry()` in `store.ts` is the only writer and there is no update
or delete path. When knowledge changes, a new entry is added and linked to the old one.

### Relations (`state_links`, defined in `src/lib/schema/journeys.ts`)

`from_entry → to_entry` with a `relation` (`uses`, `confirms`, `contradicts`, `updates`, `answers`,
`resolves`), the stage in which the relation was made, and its own evidence quote. A relation is
what turns a pile of notes into a traceable story: "the cardiologist's question in turn 3 *uses*
the emergency physician's finding; the patient's answer is a new entry; the pharmacist's
recommendation *uses* that".

### Status that changes without editing

An entry's stored `status` is never changed. The status shown to users is **derived** when the
state is read (`entriesOf()` in `store.ts`):

- any inbound `resolves` or `answers` relation makes it read as `resolved`;
- otherwise any inbound `contradicts` relation makes it read as `disputed`;
- otherwise it reads as written.

The provenance panel shows both ("recorded as established; changed by a later entry") and the
relation history, so the earlier view of the patient is always recoverable. The "how the state
evolved" chart recomputes this derived status as of each point in the journey.

### What goes into the state, and how

After each encounter `extractStage()` (`extract.ts`) runs two passes.

1. **Deterministic, from the engine's disclosure ledger.** The single-encounter engine
   (`src/lib/engine/`) records exactly which faculty-approved facts the patient disclosed and
   which approved exam or test results were returned. Each disclosed fact becomes an entry with
   `source = patient`, `status = patient_reported`, its `fact_id`, and the patient's reply in that
   turn as evidence. Each result becomes an entry with `source = exam | test | record`,
   `status = established`. The chart-at-start items and documents on file become `record` entries
   at stage 0 when the run is created (`seedRecord()`). Faculty-authored patient-versus-record
   mismatches become `disputed` entries when the patient's claim is disclosed. No model is involved
   in this pass, so a patient fact or a lab value can only enter the state if the case file contains it.

2. **Model-extracted clinician contributions.** One structured call (the "smart" model) reads the
   transcript and the clinician's note and proposes assessments, interpretations,
   recommendations, referrals, care-plan items, goals, uncertainties, open questions,
   disagreements with earlier entries, and follow-ups. Each proposal must carry a quote and a
   location. The code then checks it:
   - the quote must occur in the stated turn or in the note (punctuation and case are ignored;
     a wrong turn number is repaired if the quote is found elsewhere);
   - a claim about something that happened (a disagreement, a follow-up, a patient goal) with no
     verifiable quote is **dropped**; a judgement with no verifiable quote is kept but
     **downgraded to `uncertain`** and marked "evidence not verified";
   - a dose or lab-style value that appears nowhere in the case file, the record, the transcript
     or the note causes the entry to be dropped; a value that the clinician did say but that is
     not in the approved case file is kept and flagged in `meta.unverifiedValues`;
   - `relates_to` must name an existing entry; `answers` and `resolves` are only accepted
     against an entry that is actually open.
   Model-extracted entries can never be of kind `finding`, `result` or `record`.

3. **"Uses" relations.** The same call lists each turn in which the clinician's words drew on a
   specific earlier entry (quote verified against the clinician's line in that turn). AI clinicians
   also declare, with each question they ask, which earlier entries prompted it. For every such
   turn, the facts and results disclosed in that turn are linked `uses → earlier entry`. If
   nothing new was disclosed, a `follow_up` entry records that the earlier information was checked.

## 3. Workflow and information-transfer strategy

Information reaches a later encounter through four channels, all fed from the same entries.

| Channel | Receives | Mechanism |
|---|---|---|
| The patient | Everything already disclosed, plus a memory of who they saw | `createEncounter({ initialDisclosed, journey.patientMemory })` |
| The next clinician's chart | Shared state so far with provenance, and the handoff | `cfg.journey.priorContext`; `JourneyChartTab` for the student; prompt context for an AI clinician |
| The next clinician's instructions | The SBAR addressed to them | `handoffs` table |
| Out-of-sequence messages | Consults, clarifications and call-outs sent to them | `team_messages`, injected into an AI clinician's context by `inboxFor()` |

### Patient continuity

Every stage is a fresh engine encounter on the **same case snapshot**, so facts, approved results
and persona are identical across the journey. `createStageEncounter()` (`clinician.ts`) passes:

- `initialDisclosed`: the fact ids already disclosed in earlier stages. The engine marks them as
  on record, shows them in the chart, and includes them in "what you have already told" in the
  patient prompt, so the patient stays consistent and later clinicians cannot "discover" them again.
- `patientMemory`: a short patient's-eye account built without a model (`context.ts`): who they
  spoke to, when, which topics came up and which checks were done, and who they are speaking to today.

### AI clinician encounters stay inside the engine

`runAiVisit()` (`clinician.ts`) does not let a model write the patient. For each of 5 exchanges
(configurable with `JOURNEY_AI_TURNS`):

1. the clinician model (persona brief from the faculty profile, the stage focus, the shared state
   with short labels, the SBAR it received, messages from colleagues, and what the ledger has
   confirmed so far in this visit) returns the next thing to say, the labels of earlier entries
   that prompted it, and optionally one check to request;
2. the line is passed to the engine's `runTurn()`, exactly as a student's message would be, so the
   gatekeeper and the tier and rapport rules decide what the patient discloses;
3. a requested check goes through `runAction()`, which can only return an approved result.

The clinician then writes a note and an SBAR from **the entries recorded for that stage only**
(`writeNoteAndHandoff()`); the transcript is deliberately not given to that call, so anything the
patient model said that the ledger did not back cannot reach the note. The note is then run
through the same evidence-checked extraction as a student's note.

### Orchestration

`runner.ts` holds one background worker per run. It advances whatever a machine can do (AI stages,
state extraction) and stops whenever the student has to act (their visit, their SBAR, the huddle).
Stage progress is persisted in `journey_stage_runs` (`pending → running → visit_done → complete`
for AI stages; `ready → awaiting_handoff → complete` for the student's), so a restart resumes: an
interrupted AI visit is discarded and re-run (nothing from it had been written to the state), and an
interrupted extraction is repeated idempotently.

Events from the worker are buffered and served as Server-Sent Events
(`GET /api/journeys/runs/:id/stream`, resumable with `?after=`), which is how the student watches a
colleague's visit unfold. The run does not depend on the browser being connected. All other slow
calls return through `longJson` (whitespace heartbeats, then JSON) to survive proxy idle timeouts.

The student's own visit happens on the standard `/encounter/:id` screen. When it is scored, that
screen redirects to `/journey/:runId`; the hub sees the scored encounter, extracts state, and asks
for the SBAR.

## 4. State persistence

SQLite (better-sqlite3), one file. Tables used by this feature:

| Table | Holds |
|---|---|
| `journeys` | definition: case id, title, `spec` JSON with the ordered stages |
| `clinicians` | the faculty-provided personas, loaded from `data/clinicians/*.json` |
| `journey_runs` | one student's run: chosen stage, status, `huddle`, `synthesis` and `evaluation` JSON |
| `journey_stage_runs` | per-stage progress and the engine encounter id |
| `state_entries` | the shared patient state |
| `state_links` | relations between entries |
| `handoffs` | SBARs with their evaluation |
| `team_messages` | consult threads, call-outs, huddle positions and proposals, plan-change proposals |
| `encounters`, `messages` | the engine's own tables: one encounter per stage, full transcripts |

Everything the final view shows is recomputed from these rows by `buildView()` (`view.ts`); nothing
is cached in memory except the live event buffer.

## 5. Provenance model

The question "who said this, when, during which encounter?" is answered per entry by stored
columns, not by inference:

```
Finding:        Takes OTC ibuprofen 400mg 2-3 times weekly for chronic back/joint pain
Source:         Patient
Contributed by: Dr. Priya Narang (AI colleague)
Role:           Hospitalist (internal medicine)
Encounter:      Encounter 2
Simulated time: Week 1, Thu 13:30
Status:         Patient-reported
Evidence:       Visit transcript, turn 3 (patient): "I take Advil for my back, maybe two three times a week..."
History:        Builds on → "Medications: ... Ibuprofen 400 mg PRN ..." (existing record)
                Used by   → "NSAID use is contraindicated in this patient ..." (Dr. Narang)
                Used by   → consult reply to the dietitian (encounter 3)
```

Selecting any entry anywhere in the interface (chart tab, stage pages, huddle, care plan chips,
influence chains) opens this panel (`ProvenancePanel` in `src/components/journey/shared.tsx`).
When a later professional changes or interprets a piece of information, that is a new entry with
its own provenance and a relation back, so both contributions remain traceable.

**Influence chains** (`buildChains()` in `view.ts`) are computed only from stored relations and
handoff citations: an entry, the SBAR that passed it on (AI SBARs cite the entries they pass on),
the later question that drew on it (with the quoted words and turn), the new information that
question produced, who built on that, and the care-plan item that rests on it. No model is asked
to narrate how information flowed.

## 6. Data-sharing strategy

- **What a professional sees.** Entries from the existing record and from encounters before their
  own, plus consult replies and call-outs. Later encounters do not exist yet when the student is
  in theirs, so nothing has to be hidden.
- **What an AI colleague knows.** In a consult, an AI clinician is given the shared state and, only
  if their stage has already happened, their own transcript. A clinician who has not seen the
  patient is told so in the prompt and answers from the record only. The entry created from the
  exchange is marked `uncertain` when the colleague has not seen the patient or cites nothing.
- **What the student's browser receives.** The run view contains entries, handoffs and
  transcripts. It never contains the case profile, undisclosed facts or the answer key.
- **Access.** A run is readable by its owner and by faculty; only the owner can act on it
  (`access.ts`).
- **Clinical guardrails.** Patient statements and results reach the state only from the engine's
  ledger. Model-written text (clinician notes, SBARs, consult replies, huddle outcomes, plan items)
  is checked for dose and lab-style values that do not occur in approved content
  (`unverifiedValues()` in `context.ts`); such values are dropped or visibly flagged depending on
  where they appear. Clinicians' assessments are stored with `source = clinician` and labelled as
  judgement, never as findings.

## 7. Communication evaluation design

The output is a behavioural trace, not a score. The behaviours are data
(`BEHAVIOURS` in `types.ts`), aligned to four TeamSTEPPS areas:

- **Communication** (judged from an SBAR): situation; relevant background; important findings;
  findings distinguished from interpretation; uncertainty stated; next action requested.
- **Situation monitoring:** reviewed prior information; recognised changes; noticed
  contradictions; identified unresolved concerns; recognised missing information.
- **Mutual support:** asked for clarification; responded to requests; acknowledged a colleague's
  contribution; escalated appropriately.
- **Leadership and coordination:** responsibilities; next steps; patient goals; coordinated
  recommendations.

For each behaviour the trace stores `observed` (yes / no / no opportunity), the **evidence
location** in words ("SBAR → Recommendation", "Visit, turn 4", "Consult with Dr. Bennet", "Team
huddle", "Written note"), the **quote**, and **actionable feedback**.

How it is produced (`handoff.ts`):

- `evaluateSbar()` runs on every handoff. The model sees the SBAR and what was actually learned
  in the author's encounter (so "important findings" and "uncertainty" are judged against what
  there was to pass on). The student's SBAR is evaluated as soon as it is sent. The AI colleagues'
  SBARs are evaluated the same way and shown as worked examples.
- `evaluateStudent()` runs when the huddle closes and covers the remaining thirteen behaviours
  across five labelled sources: the student's visit, written note, SBAR, messages with colleagues
  and huddle contributions. It is also given system-recorded facts: which turns were linked to
  earlier entries, the handoff the student received, and what was open when they started.
- Every quote is verified by code against the stated source. If it is found in a different source
  the location is corrected. A behaviour marked "observed" whose quote cannot be found is **not
  credited** and says so. Only the student's own words count as evidence.

Closed-loop communication is detected structurally. Each consult message is classified as a
request, information, question, check-back, confirmation, read-back or answer; a loop is marked
closed when a request or piece of information is read back and then confirmed, or when the
student checks back and the colleague confirms.

Faculty see each student's trace per journey at `/faculty/journeys/:id`.

## 8. Active collaboration (Stretch)

All in `collab.ts`; all exchanges are stored in `team_messages` and also enter the shared state as
entries with relations.

- **Reach backward / forward, consults.** From the chart's Care team tab during the visit, or from
  the hub, the student messages any colleague. Replies are grounded as described in section 6. A
  message to a colleague who has not yet seen the patient is placed in that clinician's context
  when their encounter runs, so a forward heads-up changes what they ask.
- **Call-outs.** A message to the whole team; each colleague acknowledges with a read-back; it is
  shown to every later AI clinician.
- **Check-backs and closed loops.** Detected as above and labelled in the thread.
- **Huddle and reconciliation.** The agenda is built deterministically: entries still `disputed`,
  `open_question` or `uncertain`, most serious first (five by default). Each AI colleague whose role
  an item touches states a position citing entries. The student proposes how to settle each item;
  the best-placed colleague responds, agreeing or pushing back, and the outcome is written as a new
  entry: `resolution` with `resolves` relations to the original (and to both sides of a
  disagreement), or a new `open_question` with an owner and an `updates` relation when the team
  does not have the information to settle it. The model is instructed never to settle a question by
  inventing a fact, and an outcome containing an unverified value cannot be recorded as resolved.
- **Collaborative care-plan change.** After the plan is written the student can propose a change to
  any item; the owning colleague accepts (with refined wording) or declines with a reason. An
  accepted change keeps the previous wording as a revision on the item and adds a `plan_change`
  entry linked to the entries involved.

## 9. Final integrated representation and care plan

`/journey/:runId`, "Integrated patient view" (`FinalView.tsx`), built from `buildView()`:

1. a summary and a Use / Contribute / Identify / Communicate table per encounter, counted from
   entries, relations and handoffs;
2. the coordinated care plan;
3. what each profession contributed, grouped by role and by kind of contribution;
4. influence chains drawn as flows;
5. a board of established, patient-reported, uncertain, disputed, still unanswered and resolved items;
6. how the state evolved after each encounter.

The care plan (`synthesis.ts`) is model-written under constraints that are enforced by code:

- it is organised by patient problem or goal with the patient's own goal stated, not by profession;
- each action names owner roles and must cite entries; citations that do not resolve to real
  entries are removed, and an action left with none, or containing a value not present in the
  state, is dropped (the page says how many were dropped);
- for each action the code computes which professions' entries it rests on and shows "combines N
  professions", which makes synthesis versus compilation visible;
- huddle resolutions override the entries they resolve; open items become actions to close the gap
  with an owner.

## 10. Extensibility

- **A new journey** is data: a row in `journeys` (or a JSON file in `data/seed/journeys/`). Faculty
  build one at `/faculty/journeys/new`, where a guide model proposes stages from the case, the
  persona roster and the role catalog, and faculty edit and publish.
- **A new profession** is an entry in `data/professions.json`. Stages reference roles by id and are
  resolved at runtime (`resolveProfession()`), with a fallback if an id is not in the catalog; the
  stage's own role title is what is displayed.
- **A new clinician persona** is a JSON file in `data/clinicians/`; `personaBrief()` reads the
  provided profile structure.
- **A new teamwork behaviour** is one line in `BEHAVIOURS`; evaluation and display iterate over it.
- **A new kind of entry or relation** is a string; the store, view and provenance panel are
  generic over them.
- **Any case** that runs in the single-encounter engine can be used in a journey unchanged,
  because a stage is an ordinary engine encounter with two extra inputs.
- The engine itself (`src/lib/engine/`) was not modified for this feature.

### Routes

Pages: `/student/journeys`, `/student/journeys/:id` (choose a role; accepts `?assignment=`),
`/journey/:runId` (hub and final view), `/faculty/journeys`, `/faculty/journeys/new`,
`/faculty/journeys/:id`.

API (`src/app/api/journeys/`): `GET/POST /api/journeys`, `POST /api/journeys/propose`,
`GET/PATCH /api/journeys/:id`, `POST /api/journeys/runs`, `GET /api/journeys/runs/:runId`,
`GET .../stream` (SSE), `POST .../retry`, `POST .../handoff`, `POST .../consult`,
`POST .../huddle` (`start` | `resolve` | `close`), `POST .../plan`.

## 11. Limitations

- **One human per run.** A run has one student and AI colleagues. Two students cannot yet take
  two roles in the same run, although nothing in the state model assumes a single human.
- **The cases were written for one profession.** The provided patients are nutrition-visit cases.
  Their facts and approved results are reused for every professional, so an emergency physician
  or cardiologist can only uncover what that case file contains, and the patient's opening framing
  is the case's own. Role-specific fact sets per stage would make non-nutrition encounters richer.
- **The patient model can say things the ledger did not approve.** The engine restricts what is
  *disclosed*, but the patient's wording is generated and occasionally adds a symptom or a
  biographical detail when asked a leading question. Such statements never become entries (only
  ledger facts do), AI clinicians are told to treat them as unconfirmed, and the AI note is written
  without the transcript, but a student can still read them in the conversation, and a clinician's
  in-visit remark built on one can be extracted as an `uncertain` interpretation.
- **Clinician interpretations are model-generated.** Assessments and recommendations by AI
  colleagues are labelled as judgement, value-checked and evidence-checked, but they are not
  faculty-reviewed clinical content.
- **Extraction and evaluation depend on a model.** Quote verification removes fabricated evidence;
  it cannot guarantee that every contribution was captured or that a "not observed" is right.
  "Uses" relations in particular depend on the model recognising that a question drew on an
  earlier entry, and can over- or under-link.
- **Timing.** An AI encounter takes roughly 80 to 110 seconds (five exchanges, then note, handoff
  and extraction). A student who joins as the fourth professional watches about five minutes of
  colleagues' visits first.
- **Simulated time is a label**, not a clock; it orders encounters and appears in provenance.
- **In-process worker.** The run worker lives in the Node process (state is in SQLite, so a restart
  resumes, but there is no multi-instance coordination).
- **AI-stage encounters are stored under the student's user id** with status `abandoned` so they
  do not appear as the student's attempts; they are identified through `journey_stage_runs`.
