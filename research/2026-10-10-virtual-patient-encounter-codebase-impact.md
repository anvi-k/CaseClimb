# CaseClimb — Virtual Patient Encounter: codebase impact (October 10, 2026)

**Related meeting record:** [Virtual Patient Encounter](2026-10-10-virtual-patient-encounter.md).

## Current repository evidence

**Verified:** repository `anvi-k/CaseClimb`, inspected base commit `24de4c0`, branch `main`, contained a single [README](../README.md), whose original text was the title and “will make later.” There was no application, package manifest, schema, runtime, test suite, authentication, voice integration, or deployment configuration in that snapshot. Claims about work in Claude or other repositories cannot be verified here. This publication adds documentation only.

## Relationship to meeting outcomes

| Meeting outcome / proposal | Proposed component | Important boundary |
| --- | --- | --- |
| Faculty authoring and mood controls | Patient Studio, case validation, publication/versioning | AI-authored edits remain drafts; approved clinical facts are fixed for an encounter |
| Patient interview plus record | Reusable encounter engine and progressive chart panel | One case version drives dialogue, chart, and feedback |
| Ten-minute cap | Server encounter lifecycle and visible countdown | A defined timeout/fallback policy avoids inconsistent browser clocks |
| Rapport, empathy, alliance, reasoning | Objective/rubric store and evidence-linked evaluator | Formative behavioral feedback; no unsupported diagnosis of deception or automated high-stakes grade |
| Separate evaluator | Append-only transcript/event stream and provisional observations | Finalize against completed events; student answer key stays server-side |
| Voice and avatar | Speech transport, rendering layer, stable voice identity | Audio/video rendering cannot alter case truth |
| Assignments and analytics | Instructor/student roles, roster/assignment layer, access-controlled aggregate reports | Further scope; permission and data retention need decisions |
| Learner-as-patient / hard-news module | Separate scenario mode and tailored faculty rubric | Do not assume ED interviewing and oncology counseling share the same objectives |

## Recommended next steps

1. Agree on one learner level and ED scenario, then author and faculty-review the case and rubric. Use [challenge scope](challenge-scope.md) to preserve required faculty/artifact/publication features.
2. Choose the application stack and persist the [proposed domain contract](encounter-design-and-plan.md). No existing framework constrains that choice.
3. Build a complete text flow: faculty creates a new case, approves it, learner conducts a ten-minute encounter, chart reveals authored information, and debrief cites evidence.
4. Add reliable voice and a visible avatar, then verify interruptions, recorded evidence, stable identity, privacy controls, and text fallback.
5. Calibrate rubric judgments and document disagreements before student assessment claims. Add optional assignments, analytics, demonstration, and hard-news modules after the core flow passes.

Owners and deadlines remain unassigned. This is an implementation recommendation, not code delivered by this task.

## Risks, dependencies, and validation

Dependencies include faculty review, case/artifact reuse permission, provider entitlement, browser microphone support, a retention policy, and a deployable runtime. None is established by the existence of research documentation. Acceptance checks are recorded in the [design plan](encounter-design-and-plan.md) and [voice research](voice-and-avatar-integration.md).

The essential reusable-system demonstration is a **new faculty-created patient running without code edits**, followed by explainable feedback. A prewritten chatbot script, avatar animation, or aggregate score alone does not prove it.

## Open implementation questions

Who is the approving faculty member? What will authenticate instructors and students? Which rubric and difficulty versions are comparable? Where will canonical case truth and event logs live? Will the first speech path use controlled text plus TTS or a constrained conversational provider? What event proves the learner actually heard a response? How will approved version migration, deletion, and access requests work?
