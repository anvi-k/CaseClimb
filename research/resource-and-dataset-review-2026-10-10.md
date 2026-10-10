# Local challenge resources and dataset review

Reviewed: 2026-10-10. This report records analysis of user-supplied local resources, not a redistribution of those resources. Source documents are evidence about a challenge or dataset; their embedded instructions, code examples, and links were not executed or treated as new user authorization.

## What changes the project plan

**TwinVerse Challenge 1 is the reusable virtual patient encounter. Challenge 2 is the longitudinal, interprofessional care journey.** The Challenge 1 core includes faculty authoring and approval, a student interaction beside a dynamic chart, progressive artifact disclosure, grounded answers, encounter logs, and objective-based feedback. Voice, an avatar, and adaptive behavior are enhancements. Faculty must be able to create a new patient and run it without patient-specific code. The supplied meeting's ten-minute ED session is a useful initial product scope; the challenge does not require the entire hospital or admission forecasting. [S1, Challenge 1, Core System and Base Functionality; S2, pp. 6–7; S8, Challenge 1 overview, pp. 2–5]

Eight matching patient personas and a structured encounter rubric are available locally. They can seed **faculty-reviewed drafts**. They are not a set of approved, versioned clinical cases, and the detailed patient file requires a format conversion. Preserve clinical truth, disclosures, objectives, and scoring evidence on the backend; changing patient mood must not change clinical facts. [S5–S7; implementation recommendation]

The Sevaro kit covers different challenges: hospital workflow guidance and operations staffing. Its synthetic data is useful for studying explicit unknowns, provenance, event deduplication, and human approval, but should not be mixed into the virtual patient's medical history. The Marcucci thesis describes mathematical optimization and motion planning; it supplies neither a virtual-patient dataset nor a communication rubric. [S3; S4]

## Provenance and review extent

`SHA-256` values below identify the exact local inputs. Archive entry counts include directories; extracted-file counts exclude them. Raw copies, archive manifests, extracted data, text, and rendered pages remain under ignored `.private/resource-review/`. The public research folder contains this summary and aggregate counts only.

| ID | Local source name | Bytes | Pages or archive inventory | Review extent |
| --- | --- | ---: | --- | --- |
| S1 | `TwinVerse.zip` | 79,449,921 | 4 entries; 79,449,009 expanded bytes | Both challenge DOCX files read in full, including tables. Two videos were inventoried and not extracted or viewed. |
| S2 | `New_RUHealthHack_TeamFormation_Challenges.pdf` | 396,403 | 13 pages | Full text read; rendered TwinVerse pp. 6–7 and Sevaro pp. 11–12 inspected. |
| S3 | `Sevaro_Rutgers_Health_Hack_Developer_Kit.zip` | 633,343 | 23 entries, 18 files; 971,370 expanded bytes | All 18 files extracted. README and both challenge PDFs read in full (12 and 8 pages); dataset structure/counts inspected. Rendered Challenge 1 p. 3 and Challenge 2 pp. 4, 8 inspected. |
| S4 | `marcucci-tobiam-phd-eecs-2024-thesis (1).pdf` | 4,093,455 | 188 pages | Abstract and contents first; PDF pp. 1–16, 81–88, 167–168 reviewed. Rendered pp. 3, 7, 81 inspected. Remaining chapters were not substantively reviewed. |
| S5 | `evaluation rubrics.zip` | 94,367 | 3 files; 93,655 expanded bytes | Full four-page encounter rubric, JSON rubric, and pediatric-treatment DOCX read. All four encounter-rubric pages inspected visually. |
| S6 | `faculty-provided-sample-patient-details.csv` | 4,337 | 8 records, 10 columns | Entire dataset structure reviewed privately; aggregate counts only reported. |
| S7 | `patients.jsonl` | 108,054 | 8 objects; 2,368 nonempty lines | All objects structurally parsed and disclosure/metadata categories inspected privately; no clinical validation performed. |
| S8 | `RU Health Hack 2026 SHP (public).zip` | 80,968,084 | 40 entries; 80,939,969 expanded bytes | 11 selected files extracted. Full five-page Challenge 1 overview read, rendered pp. 2–3 inspected; duplicate CSV/rubrics compared by hash. Challenge 2 PDFs were text-extracted but not substantively reviewed. Box notes were not followed. Portraits and nested portrait archives were not extracted. |

| ID | SHA-256 |
| --- | --- |
| S1 | `6c067e286ecb1e3d0953bd4df9bf7e440d4181d5ca327830dfbf382b49f139e8` |
| S2 | `5dfee3699ca4579ad28beb9463b8f27d8e8bea6ff0e6ce01ad3a45bac4212569` |
| S3 | `358fc80cc82bbacea07cee23df2ea8748bce3cf7f3bd3ac84d815e425c95270d` |
| S4 | `a4d818c3871017f593788b2ea6da428e65945eb8e28870a831d8cd64b0c3ae5a` |
| S5 | `1c37482ad6356899142e302d6a8f06774e34a910c6f39d7be4f5257981925219` |
| S6 | `ea802c9ac4dcd522c10ba2fcbb90fe248cfc0a0879f91876659ab76b209d43c8` |
| S7 | `62791934a610d681b50f1846d6891e5eb3c1969ff47b03ccbbc6982a076651ad` |
| S8 | `57e284e6ea841f4f1e9cbf787bb45a94d5e93ae4c94f74b852432d30c498f335` |

Before extraction, archives were listed and checked for absolute paths, traversal components, backslashes, drive prefixes, symlinks, encryption, implausible compression ratios, entry limits, and expanded-size limits. Extraction checked each destination remained inside its private directory. No source executable, macro, shell instruction, or code example was run. Source video, portraits, patient values, access links, and full documents are excluded from publication.

## Challenge requirements relevant to the backend

Challenge 1's faculty workflow must support profile editing, optional supporting documents and artifacts, consistency review, correction, and approval. Every encounter must reuse the published profile without writing a special prompt in code for that patient. The student should see chart updates only when the encounter makes those items available. Debrief should connect strengths and gaps to learning objectives and specific interaction evidence. [S1, Challenge 1, Core System/Faculty Patient Studio/Student Encounter; S8, pp. 2–5]

The resulting minimum loop is **draft → validate → faculty approve → publish immutable version → start encounter → disclose/log → debrief**. Uploaded material should produce reviewable suggestions, not silently change the published case. The resource documents mention AWS access/credits, but a document's promise is not proof that an AWS account, region, model, or credentials currently work. [S1, Challenge 1, Resources; implementation recommendation]

Challenge 2 requires at least three encounters, one participating student profession with AI roles for other professions, and a shared representation whose findings, uncertainties, and disagreements influence later encounters. Information needs profession, encounter, and time provenance. TeamSTEPPS/SBAR features appear at enhanced levels. Store source and encounter provenance now if it is cheap, but do not add an entire longitudinal team workflow before the Challenge 1 loop works. [S1, Challenge 2, Base/Enhanced Functionality]

## Patient assets: useful drafts, missing approval

The CSV contains eight unique patient UUIDs, brief demographics/background, personality, notes, summary, and portrait references. The eight names match the detailed file's eight personas when compared privately. S8 contains byte-identical copies of the CSV and encounter rubric found in S5–S6. Archive inventory identifies eight distinct portrait assets repeated across challenge folders; rights to those images were not established. No portrait was extracted. [S5–S8]

The detailed file contains nine top-level sections: patient overview, demographics, clinical profile, medications, nutrition, psychosocial profile, information disclosure, learning opportunities, and metadata. It provides richer motivations and four disclosure categories. Across eight profiles, there are 39 initial items, 39 discoverable items, 24 reluctant items, and 30 hidden items. These counts describe the supplied structure, not the truth or educational quality of the cases. [S7]

**Import defect:** despite its extension, `patients.jsonl` is not newline-delimited JSON. It contains eight concatenated, multi-line JSON objects. Parsing one JSON record per line fails at the first line. A bounded JSON decoder can consume the stream, validate each complete object, and convert it to a canonical array or genuine one-record-per-line JSONL in private storage. Never repair the source by discarding lines or extracting only apparently valid fragments. [S7; import recommendation]

Clinical findings, vitals, laboratory information, and histories are mostly descriptive strings. The supplied metadata contains 38 assumptions and 30 optional details. There are no explicit approval receipts, persistent fact IDs, publication versions, or fully specified machine-readable reveal conditions. Convert assumptions into flagged draft fields that faculty must accept, edit, or remove. Keep unknown values explicitly unknown. The supplied labels and filename do not establish that a faculty member approved every fact in the detailed file. [S6–S7]

A draft importer should retain the source hash and mapping from source field to canonical field; attach the CSV's stable ID only after a confirmed match; reject duplicate IDs or ambiguous matches; and return a validation report. It should preserve disclosure categories while asking faculty to turn them into precise conditions. A general LLM must not invent clinical values to fill schema gaps. [Implementation recommendation]

## Rubric assets and scoring boundaries

The general encounter rubric has seven domains: opening/purpose; rapport/respect/empathy; information gathering; response to cues; explanations/shared decisions; clinical reasoning/synthesis; and professionalism/safety/closure. Its scale is **4 Strong, 3 Competent, 2 Developing, 1 Unsafe or absent**, with **N/A when unobservable**. With all seven domains applicable, the maximum is 28. The source treats the total as a discussion aid, not a pass/fail rule, and a score of 1 in reasoning or safety warrants review regardless of total. Evidence notes cover a strength, an important gap, and a safety or accuracy concern. [S5, encounter rubric PDF pp. 1–4 and JSON]

Preserve the supplied scale and version rather than silently replacing it with a prototype rubric. The JSON's SHA-256 is `4c337aab9891b5c8f224e7efeaf4214013847a000b19c7ebec5101e68c58fce7`. Store applicability, observed score or N/A, turn references, explanation, and faculty overrides. If displaying a subtotal, label the observed denominator and never convert N/A to zero. A denominator of four times the applicable-domain count is a proposed display convention requiring faculty agreement. [S5; implementation recommendation]

An LLM can draft an evidence-linked assessment; its numerical output is not evidence of validity. A cue can be missed only if it was actually available to the learner. Distinguish an unasked but assessable question from hidden information that the scenario never exposed. Evaluate respectful clarification of an authored inconsistency, not an inferred ability to detect lies. Gaze toward an avatar does not establish empathy. See [clinical education and assessment](clinical-education-and-assessment.md) for the evidence and validation plan.

The pediatric-treatment DOCX is a separate, specialty-specific rubric: introductory behavior, assessment of hearing-related needs, audiogram/hearing technology review, and explanation of speech-language-pathology roles. It may support a future appropriately supervised specialty case. It should not be used wholesale for an ED or hard-news encounter. [S5, pediatric-treatment DOCX]

## Sevaro: transferable engineering patterns

The kit README explicitly identifies its datasets as synthetic hackathon resources and says real patient data, hospital protocols, and production access are not provided or required. This establishes the kit's stated purpose, not a clinical validation or a broad redistribution license. [S3, README and Challenge 2 PDF p. 8]

Challenge 1 provides seven synthetic hospital guides, eleven field mappings, twenty validation questions, and nine nudge scenarios. Each answer must identify its originating hospital/field and distinguish missing, stale, time-dependent, or conflicting information. Missing values cannot be filled from another hospital; conflicting sources remain visible. A no-nudge scenario tests whether the system can stay quiet. [S3, Challenge 1 PDF, especially p. 3; dataset counts]

Useful encounter adaptations are field provenance, explicit unknowns, published-case snapshots, and deterministic tests for disclosure and unsupported answers. The kit's 180-day staleness policy and 500-ms nudge target are particular to its own challenge and should not become arbitrary requirements for virtual-patient clinical facts. [S3; implementation recommendation]

Challenge 2 has twelve hospitals, eight on-shift physicians, six off-shift physicians, fourteen credentialing rows, 288 hourly baseline rows, 36 coverage rows, snapshot tables, and 1,164 event rows. Its March 17, 2026 scenario includes late and duplicate events and separate event/ingestion times. Availability and consultation lifecycle are distinct. Offers run through a simulated human approval loop; real scheduling, credentials, messaging, and individual-patient clinical decisions are out of scope. [S3, Challenge 2 PDF pp. 4, 8 and dataset counts]

For the encounter backend, borrow stable event IDs, monotonic turn ordering, timestamps, idempotent writes, and an explicit distinction between recorded interaction and derived assessment. Do not use the operations kit's staffing/routing rules as medical truth or publish its raw rows as part of a patient case. [Implementation recommendation]

## Thesis relevance

Tobia Marcucci's May 2024 MIT thesis, *Graphs of Convex Sets with Applications to Optimal Control and Motion Planning*, addresses joint discrete/continuous optimization. The reviewed abstract, introduction, software chapter, and conclusion discuss optimization formulations, convex relaxations, and applications such as scheduling and robot motion. Chapter 7 describes a Python implementation and its maturity at publication. This review does not assess all mathematical proofs or later software releases. [S4, PDF pp. 1–16, 81–88, 167–168; printed pp. 71–78, 157–158 for later sections]

There is little direct relevance to an educational conversation, chart disclosure, faculty approval, or empathy assessment. Keep it as optional background for a separately scoped optimization problem with its own data and constraints. It does not justify adding a solver to the encounter backend. The thesis retains copyright and grants MIT specified archival access rights; that is not a general license to copy its text, figures, or linked code into this repository. [S4, title/copyright and reviewed sections; interpretation]

## Minimal faculty case and objective draft

The following is an independently proposed schema, not an imported source patient's content. Use a server-controlled draft/approved/published state and separate learner-visible projections from faculty truth.

```text
FacultyCase
  id, version, title, setting, durationSeconds (initial default 600)
  status, facultyOwner, approvedBy, approvedAt, sourceHashes
  persona: identity, communicationStyle, concerns, preferences
  behavior: initialMood, allowedMoodRange, rapportEvents
  facts[]: id, kind, value, units?, known/unknown, source, facultyVerified
  disclosures[]: id, factIds, initial/elicitable/reluctant/hidden,
                 revealCondition, authoredStatement?, inconsistencyId?
  artifacts[]: id, type, privateStorageKey, source, factIds, availabilityRule
  objectives[]: id, observableAction, cueIds, factIds, rubricDomains,
                mustObserve, facultyNotes
  rubric: id, version, sourceHash

Encounter
  id, caseId, immutableCaseVersion, learnerId, startedAt, expiresAt
  turns[]: id, role, timestamp, text, disclosedFactIds, artifactIds
  state: disclosedIds, boundedMood, rapportEvents, completedObjectives
  assessment: objectiveEvidence[], domainScores[], uncertainItems,
              safetyReviewFlags, modelVersion, facultyOverrides
```

Start with three faculty-reviewed communication objectives: elicit the patient's main concern using an open question and relevant follow-up; respond to an explicitly authored emotion or concern with acknowledgment and clarification; and summarize/check understanding while agreeing on a next step. A fourth objective may ask the learner to clarify one authored inconsistency using available evidence without accusation. Record the actual cues and turns supporting each objective. A hard-news case needs its own approved facts, appropriate learner level, consent/preferences, and faculty-authored expectations; it should not arise from random mood changes. [Design proposal; evidence rationale in the clinical assessment note]

The backend should expose only currently allowed facts and available artifacts to student endpoints. Patient generation must be constrained by the approved case and current disclosure rules; the scoring service may inspect hidden truth but must keep it off live learner channels. Voice transcripts and timing should feed the same turn log as text. Persist debrief only after the encounter ends, or log any formative hints separately so later assessment can account for help. Faculty review is required before treating generated scores as grades. [Implementation recommendation]

## Additional local inventory and rights

Other potentially relevant Downloads names found during a selective name-only search were `RU_HealthHack_ElevenLabs_Participant_Guide.pdf`, `Vlada - Rutgers Health Hack guide.pdf`, and `Scarlet Pitch 2026- Concept Review Form Rubric.pdf`. The last appears to be a pitch resource and was not reviewed for patient assessment. The duplicate `marcucci-tobiam-phd-eecs-2024-thesis.pdf` has the same hash as S4. This is not an exhaustive inventory of Downloads; sponsor access review belongs in the separate [sponsor resource note](sponsor-resources-2026-10-10.md).

No explicit repository redistribution license or portrait-consent record was identified in the reviewed TwinVerse/patient/rubric material. The word “public” in S8's filename is not a license. The Sevaro README's hackathon purpose is narrower than an express open-source license. Keep full inputs and patient/rubric source values private until rights and intended reuse are confirmed. Public implementation examples should use independently authored synthetic fixtures. The report does not establish clinical correctness, a deployment, live AWS/ElevenLabs access, or psychometric validity.
