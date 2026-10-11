# CaseClimb research

Captured and researched October 10, 2026, America/New_York. The meeting date is inferred from the documentation session, not confirmed by the recording. Source statements, challenge requirements, research evidence, and recommendations are distinguished throughout.

**Recommended first slice:** a ten-minute ED communication/history encounter, reusable faculty-approved synthetic cases, progressively disclosed chart information, and feedback linked to learning objectives and transcript evidence. Voice and a visible avatar are requested design goals; a complete text encounter provides a useful fallback.

| Document | Purpose |
| --- | --- |
| [Supplied meeting notes](2026-10-10-supplied-meeting-notes.md) | Preserves the user's notes as source material |
| [Recording transcript](2026-10-10-recording-85-transcript.md) | Complete timestamped, unverified local machine transcription of the 5:23 recording |
| [Transcription provenance](recording-85-provenance.json) | Audio hash, duration, model, and method; original audio is not published |
| [Meeting record](2026-10-10-virtual-patient-encounter.md) | Combined factual discussion, proposals, constraints, and open questions |
| [Codebase impact](2026-10-10-virtual-patient-encounter-codebase-impact.md) | Current repository evidence and proposed implementation consequences |
| [Challenge scope](challenge-scope.md) | Resolves Challenge 1 versus Challenge 2 and lists required deliverables |
| [Encounter design and implementation plan](encounter-design-and-plan.md) | State, disclosure, faculty controls, evaluator, and acceptance checks |
| [Clinical education and assessment](clinical-education-and-assessment.md) | Evidence, observable formative rubric, uncertainty, and validation |
| [Voice and avatar integration](voice-and-avatar-integration.md) | Current official ElevenLabs options, visual-avatar dependencies, privacy, and cost checks |
| [Sponsor resources](sponsor-resources-2026-10-10.md) | ElevenLabs redemption, AWS/Kiro separation, Anakin and Vlada offers and limits |
| [Resource and dataset review](resource-and-dataset-review-2026-10-10.md) | Challenge packages, patient assets, rubric, Sevaro kit, thesis relevance and provenance |
| [Implementation and verification](implementation-and-verification-2026-10-10.md) | Built behavior, actual AWS/provider checks, remaining delivery limits |
| [Backend APIs and remaining work](backend-api-status-and-next-steps.md) | Existing API contract, actual streaming boundaries, and prioritized backend acceptance |
| [Streaming backend](streaming-backend.md) | Realtime transcription, incremental PCM, interruption, scoped WebSockets, recovery, and AWS setup |
| [Source register](sources.md) | Provenance and limits of the sources used |

Three conclusions change how the brainstorm should be implemented: an avatar-facing gaze check does not establish empathy; discrepant patient reports need authored evidence and respectful clarification rather than automatic accusations of lying; and an LLM must not invent clinical facts or approve its own generated cases. Claims in the recording that work was already nearly complete are unverified: the repository's initial inspected snapshot contained only a README. Subsequent implementation and deployment checks are recorded separately above.
