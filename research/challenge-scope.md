# Challenge scope: Virtual Patient Encounter versus Connected Care

Checked October 10, 2026. **The digital patient encounter is TwinVerse Challenge 1.** Challenge 2 is connected interprofessional care across multiple encounters. “Track 1/Track 2” in the meeting is imprecise shorthand; the event website calls TwinVerse one track and lists other tracks separately. [Official event track descriptions](https://ruhealthhack.com/).

## Source authority

The organizer-supplied `TwinVerse_RUHealthHack_Challenge1.docx` and `TwinVerse_RUHealthHack_Challenge2.docx` were read directly in this research session. Their titles, core components, and deliverables support this comparison. The original attachments are not redistributed. Fingerprints and limitations appear in the [source register](sources.md). Requirements in those documents are source requirements, not instructions for this documentation task to implement a product.

| Area | Challenge 1: Virtual Patient Encounter System | Challenge 2: Connected Care Journey |
| --- | --- | --- |
| Core experience | Reusable faculty-authored patient, student interview plus dynamic chart, objective-linked debrief | Same patient across at least three encounters, student in a professional role and AI in remaining roles |
| Faculty side | Create profile; manage knowledge/artifacts; define release rules; review/correct; check consistency; approve/publish; reusable library | Faculty provides case/scenarios; professional personas support the journey |
| State | Consistent patient identity, approved facts, conversation state and disclosure record | Evolving shared state: facts, patient goals/context, interpretations, uncertainty, disagreement, unanswered questions and provenance |
| Evidence of success | Faculty creates a new patient and immediately runs it without patient-specific code changes | Earlier findings demonstrably influence later encounters; integrated final patient representation and coherent care plan |
| Advanced features | Voice, avatar, adaptive behavior, advanced memory, multimodal artifacts and SaaS integration are Stretch | Enhanced adds TeamSTEPPS-aligned communication/SBAR; Stretch adds active collaboration beyond the fixed sequence |

## Challenge 1 Base obligations to retain

The narrow ED setting should still demonstrate faculty authoring, knowledge and artifact management, review/publication, multiple reusable profiles, complete student encounter, split-screen patient/chart, progressive disclosure, memory/state, clinical grounding, encounter logs, and explainable assessment. Prevent unsupported clinical facts and keep history, medications, diagnoses, labs, and artifacts consistent. Faculty learning objectives govern feedback, including strengths, missed findings, interview quality, communication and actionable next-attempt advice.

Voice/avatar is encouraged and is an advanced feature in the written specification. The meeting's desire for an avatar is an additional design goal, not proof that a mandatory provider or avatar SDK is specified.

Required submission: working prototype; implementation repository plus infrastructure code if used; short video **or** live demo; **four-minute pitch**. The document lists evaluation areas but gives no numerical scoring weights. Team registration, final onsite amendments, and portal fields remain unverified in this task.

## Recommended scope

Focus on **one ten-minute ED interview type**, with at least a small reusable reviewed case library and a held-out faculty-created case. Treat ten minutes as the current product constraint. Avoid adding admissions forecasting, whole-hospital operations, real EHR connectivity, a class-management replacement, or Challenge 2's three-encounter journey to the first build.

Keep a bounded next module for delivering hard news or demonstrating clinician behaviors if faculty considers it useful. A synthetic education simulator is not established as a calibrated digital twin of a real patient or hospital.
