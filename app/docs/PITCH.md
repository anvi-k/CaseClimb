# Poscere: pitch and demo plan

RU Health Hack 2026, School of Health Professions track. One pitch covers both entries: Challenge 1
(Virtual Patient Encounter System) and Challenge 2 (Connected Care Journey).

Contents: (1) the four-minute script, (2) what each brief asks the pitch to explain and where the
script covers it, (3) demo run-of-show, (4) likely questions with honest answers.

Live URL: https://d3k6ssmfceay1x.cloudfront.net. Demo accounts share the password `poscere-demo`.

## 1. Four-minute script

About 595 spoken words, which is four minutes at about 150 words a minute. There is no optional
paragraph any more: if a rehearsal runs over, drop the last sentence of the 1:20 section (episodes
and MCP) first. Rehearse with a timer; the section times are targets.

### 0:00 to 0:20. The problem and what Poscere is

> Standardized-patient sessions are expensive and hard to schedule, so students get few
> repetitions. Poscere is a telehealth simulator. The student talks with a virtual patient on the
> left, a chart fills in on the right, and feedback follows. One engine serves both challenges.

### 0:20 to 1:20. Challenge 1: solution, architecture, technical approach

> A faculty member describes a patient in a paragraph. In about eighty seconds a staged generator
> drafts the case: an outline fixes the clinical story and every number, then four writers fill
> in the parts in parallel. Faculty edit it, run a consistency check, and publish.
>
> A case is only data. There is no patient-specific code, so a patient created now runs now. The
> library has 81 patients across 63 roles.
>
> On every student message, a fast model proposes which locked facts were asked about. Then plain
> code decides what is released, from the fact's tier, the student's rapport and the difficulty
> level. After the patient replies, a second model checks the reply against the whole case. A fact
> the patient did not actually say goes back to locked, and any clinical claim outside the case
> is flagged. The chart is written from the case's wording, never
> from model output, and an order can only return an approved result.

### 1:20 to 2:05. Challenge 1: educational value, and what goes past the brief

> Because we keep a ledger of what was disclosed, "what you found and what you missed" is a record,
> not an impression. Every rubric score comes with a quote and a turn number, and code checks that
> the quote exists. A running score for every turn is plain arithmetic, so an instructor can watch
> it live.
>
> Patients also remember. A student can book a follow-up where the patient knows them. And one patient can be shared by a whole class: when a nursing student contradicts the
> dietetics student before her, the patient says, "Riley told me the opposite." Every visit is a
> searchable episode, and an MCP endpoint lets an AI assistant query them with the user's own
> permissions.

### 2:05 to 3:25. Challenge 2: journey, architecture, continuity, SBAR, collaboration, level

> In Challenge 2 one patient moves through several encounters. Walter Greene sees an emergency
> physician, a hospitalist and a dietitian. The student plays one; the AI plays the others from the provided personas, through
> the same patient engine and disclosure rules.
>
> The shared patient state is a set of append-only entries. Each stores its source, the
> contributor's role, the encounter, the simulated time, a status and the quoted evidence. The
> status separates established from uncertain, disputed and unanswered, and typed links record
> how one entry led to another.
>
> Information moves forward three ways: disclosed facts are on record in the next encounter, the patient remembers who they have seen, and each clinician writes an SBAR to the next.
>
> We evaluate every SBAR, and the student's teamwork, against nineteen TeamSTEPPS-aligned
> behaviours, each marked observed or not, with the quote it rests on.
>
> We built all three levels. For Stretch, the student can page any colleague or call out to the
> team, and the team holds a huddle over whatever is still disputed. The final view shows each
> profession's contribution and a care plan whose every action cites its entries.

### 3:25 to 3:50. Limitations

> No clinician has reviewed the patients, and they are labelled that way. The
> patient can still say something outside the case; we flag it afterwards, we do not prevent it.
> The chart is an Epic-style layout, not an EHR integration, and there is no Canvas connector.
> It runs on one server with SQLite, supports one human per
> journey, and has not been tested with students.

### 3:50 to 4:00. Close

> One engine, cases as data, and a ledger that makes the chart, the feedback and the team's shared
> record traceable. Thank you.

## 2. What the briefs ask the pitch to explain

| Brief | Item | Where in the script |
|---|---|---|
| Challenge 1 | The solution | 0:00 and 0:20 |
| Challenge 1 | Architecture | 0:20 (case as data; gatekeeper, policy, patient, reconciliation, chart) |
| Challenge 1 | Technical approach | 0:20 (staged generation, deterministic disclosure, approved results) |
| Challenge 1 | Educational value | 1:20 (ledger, checked quotes, running score, memory, shared patient) |
| Challenge 2 | The patient journey | 2:05, first paragraph |
| Challenge 2 | System architecture | 2:05, second paragraph (entries, provenance fields, links) |
| Challenge 2 | Which challenge level was achieved | 2:05, last paragraph (Base, Enhanced and Stretch) |
| Challenge 2 | How patient continuity works | 2:05, first and third paragraphs (same engine, facts on record, patient memory) |
| Challenge 2 | How information moves between encounters | 2:05, third paragraph |
| Challenge 2 | How SBAR and communication evaluation works | 2:05, fourth paragraph |
| Challenge 2 | How interprofessional collaboration works | 2:05, last paragraph |
| Challenge 2 | Limitations | 3:25 |

Voice and the models are no longer in the script; they are in the Q&A (section 4) and are heard
in the demo.

## 3. Demo run-of-show

The Challenge 1 brief says a faculty member on the judging panel will create a new patient and then
run an encounter with it. Two waits are unavoidable and are planned for below: drafting a patient
takes about 80 seconds and scoring a visit takes about 1 minute. A patient reply starts in about 3
to 5 seconds. A full care journey takes about 15 minutes (each AI colleague's visit is 80 to 100
seconds), so the Challenge 2 demo uses a run completed beforehand plus a short live start.

### Before the session

1. Use Chrome. Open https://d3k6ssmfceay1x.cloudfront.net/api/health and confirm it returns
   `"ok": true`. Do not push to `main` from now until the session is over: a deploy restarts the
   server, and although the restart takes about two seconds it drops any reply that is streaming.
2. **Window A, faculty.** Sign in as `faculty@poscere.demo`. Two tabs:
   - A1: **Patient Studio**, the library.
   - A2: open the seed patient **Helen Kowalczyk** ("Progressive Fatigue and Exertional Dyspnea in
     a 67-Year-Old on Chronic NSAIDs") in the editor and click **Check consistency** once, so the
     Consistency check section has results to show. This tab is what you talk over during drafting.
3. **Window B, student.** A separate browser profile or a private window, because the session is a
   cookie. Sign in as `student@poscere.demo`. Three tabs:
   - B1: a **finished care journey run**. Do this at least 20 minutes ahead: **Care Journeys** >
     Walter Greene > **Choose your role** > **Join as hospitalist (internal medicine)**, then
     complete your visit, the SBAR, the huddle and the care plan. Leave the tab on the journey page.
   - B2: **Progress**, after at least two scored practice visits so the rating chart has points.
   - B3: the feedback page of one of those scored visits, as a fallback if live scoring is slow.
4. In Window A, start one **Test visit** on any patient, allow the microphone when the browser asks,
   and end it. This grants the permission before the judges are watching.
5. The demo accounts are shared. Check the library for patients left by other people with similar
   names to the one you expect the judge to create.
6. **For Part 1b, a class-shared patient.** In Window A: **Courses**, create a course, **New
   assignment** (homework or practice), choose one patient, turn on **One shared patient for the
   class**, **Create assignment**, and note the join code. In a third browser profile sign in as
   `dietetics@poscere.demo` (the account is named Riley), join the course from the student home
   page, and complete and submit one visit on that assignment in which Riley gives the patient one
   clear, specific piece of advice. Wait for it to be scored. Then sign in there as
   `nursing@poscere.demo`, join the same course, and leave the tab on the assignment (tab C1). Run
   this once in rehearsal to choose a piece of advice the patient reliably repeats.
7. **For Part 1b, episodes.** In Window A open **Episodes** (tab A3) and search for a word you
   know was said in Riley's visit, so the result is on screen.

### Part 1: Challenge 1, about 8 minutes

| Time | Who | Clicks | Say |
|---|---|---|---|
| 0:00 | Judge, Window A tab A1 | **New patient**. In **Describe the patient**, pick the learner role and type a paragraph about a patient. Optional: learning goals, target difficulty, a source document. **Continue**. | "Describe anyone you teach with. Details you give are kept as written; the model fills in the rest." |
| 0:40 | Judge | If **A few quick questions** appears: click answers, then **Draft the patient**. | "It asks only about things that would change the case clinically." |
| 1:00 | Presenter, switch to tab A2 | Drafting is running (about 80 seconds; the progress page says one to two minutes). In Helen Kowalczyk's editor click **Facts and disclosure**. | "While that is being written, this is what will come back. Each fact has the patient's wording, the chart's wording and a tier: volunteered, when asked, needs trust, guarded. The generator first fixes the clinical story and every number, then writes these lists in parallel from it." |
| 1:30 | Presenter | **Documents**, open a lab report. Point at "When does this document appear in the student's chart?" | "Documents are released from the start, by an order, or by a disclosure." |
| 1:55 | Presenter | **Consistency check**. Open one issue and its proposed fix. | "Rules catch structure. A model review compares every place the same value appears and proposes a patch. Nothing is applied until the faculty member accepts it." |
| 2:25 | Presenter, back to tab A1 | The new patient's editor has opened. Point at the "AI-drafted, not faculty-reviewed" notice. Click **Facts and disclosure** briefly, then **Check consistency**. If drafting is still running, show **Student preview** in tab A2 first. | "This is the judge's patient. No code was written or deployed for it." While the check runs: "It stays labelled as not reviewed until a faculty member says otherwise." |
| 3:15 | Judge | **Publish**. Read the dialog. Leave the review box unticked unless the judge has actually reviewed it. **Publish**. | "Publishing is blocked on open high-severity issues unless you acknowledge them." |
| 3:35 | Judge | **Test visit**. Tick **Use my microphone**. **Join visit**. | "Same visit screen a student gets. The clock starts now, not when the visit was created." |
| 3:45 | Judge | Talk to the patient for about three minutes. Prompt them: an open question; a specific question; a sensitive question asked bluntly, then again with empathy; a closed question about a symptom they did not put in the case. | Point at the right side each time a fact is filed under **This visit**. On the deflection: "The comfort meter moved; that fact needs trust." On the made-up symptom: "The patient should say no. If the model does add something, a second model flags it as outside the case record, after the reply, and it is not filed." |
| 5:45 | Judge | Chart tab **Results & orders**: request a test that is in the case, then one that is not. Open **Chart review** to see the released document. | "Only approved results can come back." |
| 6:30 | Judge | Red **End visit** button. One line in each write-up box. **Submit for feedback**. | |
| 6:45 | Presenter | Scoring is running (about 1 minute). Switch to Window B tab B2, **Progress**. | "While it scores: what was elicited and missed is already known from the ledger. The model is scoring the seven rubric domains and has to quote the transcript; code then checks each quote. Meanwhile, this is a student's rating per rubric domain. It is an Elo-style update with the patient's difficulty level as the opponent, and it picks the next level at an expected score near 70 percent. No language model chooses it." |
| 7:45 | Presenter, back to Window A | Feedback page. Scroll: rubric with evidence, **Findings you missed**, **Learning objectives**, **Safety and accuracy**, **The visit, turn by turn**, **Transcript**. | "Every score points at a turn. Missed findings come from the disclosure record. An objective counts as met only when that record and the examiner agree. This chart is the running score for each turn: arithmetic over findings covered, communication signals and patient comfort, with no model call, so an instructor sees the same line live." |

### Part 1b: past the brief, about 2 minutes

Everything here was prepared before the session (steps 6 and 7). Skip it if time is short; the
script already mentions each item.

| Time | Who | Clicks | Say |
|---|---|---|---|
| 0:00 | Presenter, Window A | On the feedback page just shown, point at **Start over with this patient** and **Book a follow-up visit**. Do not start one. | "Start over is a clean repetition. A follow-up continues the relationship: what the patient already told you is in the chart, the tests are done, trust is where you left it, and the patient remembers the last conversation." |
| 0:20 | Presenter, tab C1 (signed in as the nursing student) | Start the visit on the shared-patient assignment. Open **Chart review** and show "Visit 1 note". | "This assignment uses one patient for the whole class. Riley, a dietetics student, saw this patient earlier. Riley's write-up is in the chart, and what the patient told Riley is already on record." |
| 0:45 | Presenter | Tell the patient the opposite of what Riley advised. | Let the patient answer. If the patient names Riley: "That is the patient's own memory of the earlier visit, by name." If not, say what the mechanism is and move on; it depends on a model and is not guaranteed. |
| 1:20 | Presenter, tab A3 | **Episodes**, the search prepared earlier. Scroll to the access-key section and the MCP configuration. | "Every recorded visit is an episode, searchable by patient, participant, role and what was said. The same search is a REST endpoint and an MCP endpoint with four tools, so an AI assistant can query it with a personal key and sees only what that account may see. A student's private practice is not in this list." |

If drafting fails: click **Try again** on the same page (the description is kept). If it fails
twice, run Part 1 from 3:35 using Helen Kowalczyk and say so. If scoring has not returned after two
minutes, show tab B3 and return later; a submitted visit can be scored again from its feedback page
with **Score this visit**.

### Part 2: Challenge 2, about 5 minutes

Use Window B (student).

| Time | Clicks | Say |
|---|---|---|
| 0:00 | New tab: **Care Journeys** > "Marcus Ramirez: heart failure, new diabetes and weight loss across four professions" > **Choose your role**. | "One patient, four encounters. The student picks a role; the AI plays the other three from the provided personas." |
| 0:20 | **Join as cardiologist**. Encounter 1 starts; the AI emergency physician's conversation streams. Let it run for about 40 seconds. | "This is an AI clinician interviewing the same patient engine. Its questions go through the same gatekeeper and tier rules as a student's, so it only learns what the case allows." |
| 1:00 | Switch to tab B1, the finished Walter Greene run. Open Encounter 1. Show "What this encounter added to the shared patient state" and the SBAR with its review. | "After each encounter the state is updated. Patient statements and results come straight from the engine's ledger. Clinicians' assessments are extracted by a model and kept only if their quote is found." |
| 1:40 | Open your own encounter. Show "Earlier information this encounter drew on". Click one entry to open the provenance panel. | "Who said it, in which role, in which encounter, at what simulated time, with what status, and the words it rests on." |
| 2:20 | Show **Your SBAR handoff** and **Review of the handoff**. | "Six communication behaviours per SBAR. Observed or not, the SBAR section, the quote, the feedback." |
| 2:50 | Open the huddle section. | "The agenda is built by code from what is still disputed, uncertain or unanswered. The student proposes; a colleague agrees or pushes back; the outcome is a new entry linked to the old ones. The team is told never to settle a question by inventing a fact." |
| 3:30 | **Integrated patient view** tab. Scroll: care plan ("Rests on", combines N professions), contributions by profession, influence chains, status board. | "The plan is organised by problem, not by profession. Every action cites entries; actions that cite nothing real are dropped." |
| 4:20 | **Teamwork evaluation** tab. | "The remaining thirteen behaviours across the visit, the note, the messages and the huddle. Only the student's own words count as evidence." |
| 4:50 | Optional: in Window A (faculty), **Care Journeys** > the Walter Greene journey > **Open run**. | "Faculty see the same run and trace." |

### Lines to avoid

Do not say the patient "cannot hallucinate", that the cases are "clinically validated", that it
"integrates with Epic" or Canvas, that the MCP endpoint is an LMS integration, or that it has been
tested with students. None of those is true. Do not promise that the shared patient will name the
earlier student; say that it can.

## 4. Likely questions, honest answers

**How do you stop the patient from inventing clinical facts?**
Three layers, and only the first is hard. Code decides which facts are released, and the chart and
order results are the case's own text that no model writes. The patient model is given the released
facts and the record the clinician can see, and is told to deny everything else. After each reply a
second model checks it against all the case facts: a released fact the patient did not actually say
goes back to locked, a true fact the patient said early is filed, and a clinical claim that is in no
case fact or contradicts one is shown to the student as "Outside the case record". The patient can
still say something outside the case, the flag arrives after the sentence is shown, the checker can
miss one, and if the audit call fails nothing is flagged. What we can promise is that such a
statement never reaches the chart, the feedback's findings or the shared patient state.

**Has a clinician reviewed the patients?**
No. All 81 library patients are stored as unreviewed. 73 are labelled "AI-drafted, not
faculty-reviewed". The other 8 start from the sample patient details we were given and were
expanded by the same generator. A patient a student makes for their own practice is not reviewed
either, and says so. The consistency check finds contradictions inside a case; it does not
establish that the medicine is right.

**How do you know the rubric scores are right?**
We do not know yet. They are a model's judgement and have not been compared with faculty raters.
What we did is limit how much depends on it: findings come from the ledger, an objective counts as
met only when the ledger and the examiner agree, each score must quote the transcript and the quote
is checked, a reply with no scores is retried and never stored as zero, low scores on two domains
and any safety concern flag the visit for instructor review, and faculty can adjust the score.

**What is the running score?**
A number for every turn, computed without a model: 45 percent findings covered against a steady
pace, 35 percent a smoothed communication mark built from the per-turn signals, 20 percent patient
comfort. It is on the feedback page and in the instructor's live console. It is separate from the
rubric score, does not feed the gradebook, and its weights have not been calibrated.

**What does the patient remember?**
After a scored practice visit we store which facts were disclosed, which tests were done, the level
of trust, and a short first-person memory written from the transcript. "Start over" ignores all of
that. "Follow-up visit" starts from it. With the assignment setting "One shared patient for the
class", that record belongs to the class instead of one student: each student acts in their own
profession, the patient remembers each of them by name, and earlier students' write-ups are notes in
the chart. The record updates when a visit is scored, so students see the patient in turn, and
whether the patient points out a contradiction depends on a model.

**Is that a real EHR? Is it connected to Canvas?**
Neither. The chart is an Epic-style layout drawn from the case data. There is no LTI launch, Canvas
connector or grade passback. What exists as an integration surface: an MCP endpoint and a REST
endpoint for searching and reading stored visits and patient records, authenticated by a personal
access key and limited to what that account can see; gradebook export as CSV; and case export and
import as JSON. The endpoints are read-only.

**Is the avatar a video?**
No. It is a still portrait in a call frame with a speaking state and captions. Most portraits were
generated with Stable Diffusion 3.5 Large. The voice is ElevenLabs when a key is configured, chosen
by the patient's age and sex, with Amazon Polly generative voices as the fallback. There is no
lip-sync.

**Does voice work everywhere?**
Speech input uses the browser's speech recognition, so Chrome, Edge and Safari. In other browsers
the student types. Patient speech works wherever audio plays.

**What do the knowledge sources do? Is this RAG?**
No retrieval. A source document is given to the case drafter so the case agrees with it, and to the
feedback scorer, which judges clinical accuracy only against the answer key and those sources. The
patient does not read them.

**What happens when a student orders a test you did not anticipate?**
It comes back as "no approved result is available for this in the case file", and feedback lists it
under requests that were not part of the case. We chose a refusal over a generated value.

**Why does creating a patient take more than a minute?**
It used to be one call that took two to four minutes. Now a short call fixes the clinical story and
every number, four calls write the persona, the two halves of the history and the chart in parallel
from that story, and a last call links the objectives to the items that exist. That takes about 80
seconds. The parallel writers do not see each other's output, so the consistency check is still
worth running. Scoring is about a minute: one call with the whole transcript and rubric.

**Which models, and why not the largest?**
Claude Haiku 4.5 for the per-turn gatekeeper, order matching, reply check and patient memory; Claude
Sonnet 4.5 for the patient's and clinicians' voices; Claude Sonnet 5 for drafting, review, scoring
and synthesis, all on Amazon Bedrock. Opus-class models were not available on the hackathon account.

**How would this scale?**
As built it would not: one EC2 instance, one SQLite file, background workers in the same process.
The encounter state is already a row per visit, so moving to PostgreSQL and more than one server is
conventional work, but it has not been done.

**How do you add a new profession, or a new patient?**
A profession is one entry in `data/professions.json`. A patient is created in the studio or
imported as JSON. Neither needs code.

**In Challenge 2, does earlier information really change later encounters, or is it just shown?**
Both are recorded separately. Facts already disclosed are on record in the next encounter's chart.
When a later clinician's question draws on an earlier entry, that is stored as a "uses" link with
the quoted words, and the influence chains in the final view are built only from those links.
Linking depends on a model recognising the connection, so it can over- or under-link.

**Can two students take two roles in the same journey?**
Not yet. A run has one student and AI colleagues. Several real students can see one continuing
patient in turn through the class-shared patient setting, but that has no shared state with
provenance, no SBAR and no huddle.

**The provided patients are nutrition cases. Does a cardiologist get a real cardiology visit?**
Only as far as the case file goes. Every professional draws on the same approved facts and results,
so a non-nutrition role can only uncover what that case contains.

**What about privacy?**
All patients are synthetic. Practice a student starts on their own is private: faculty cannot open
it and it is not in the episode search. Assignment and care-journey visits are labelled "Recorded
for instructor". Students never see case titles, which often name the diagnosis. Transcripts are
stored in the application database on the hackathon AWS account. Registration is open, there is no
SSO, and access keys are stored unhashed, so this is not ready for real student data.

**How long will the demo URL stay up?**
Until the hackathon AWS account is closed. The repository runs locally with your own Bedrock and
Polly access; the commands used to stand up the server are in `infra/`.
