# Source register and research limits

Research checked October 10, 2026. Links are placed beside claims in the owning documents; this register records provenance and source authority. Original recordings, organizer attachments, access-bearing URLs, credentials, and private correspondence are not published.

## Local primary evidence

| ID | Source | How it was used | Limits |
| --- | --- | --- | --- |
| M1 | User-supplied Virtual Patient Encounter notes | [Preserved notes](2026-10-10-supplied-meeting-notes.md), ten-minute target, behavior/feedback/faculty goals | Discussion points include suggestions and unresolved questions |
| M2 | `New Recording 85.m4a`, 323.477 seconds | Local offline MLX Whisper large-v3-turbo transcription; [complete transcript](2026-10-10-recording-85-transcript.md) and [provenance](recording-85-provenance.json) | Unverified machine text, overlapping speech, no speaker attribution; actual meeting date unknown |
| C1 | `TwinVerse_RUHealthHack_Challenge1.docx` | Direct text inspection of faculty Studio, encounter, feedback, clinical validity, Base/Stretch, deliverables and judging flow | Supplied organizer specification; onsite changes and registration status unverified |
| C2 | `TwinVerse_RUHealthHack_Challenge2.docx` | Direct text inspection of multi-encounter continuity, shared state/provenance, levels, final synthesis and deliverables | Describes evaluation considerations as a working draft |
| R1 | [CaseClimb repository](https://github.com/anvi-k/CaseClimb), base commit `24de4c0` | Git inspection of tracked files and original README | Only a README in that snapshot; other repositories or unpublished work not inspected |

SHA256 fingerprints:

- M2: `ed1655962a81e829c1b24c38806982e460d12ea580d95f6beb6b78d64db8e145`
- C1: `5b7e1ffc1a623977941c9af7651c0a478f0c26c2cfa8d17aad1e55cbf2d55384`
- C2: `1d1e33224d978b5eee1f2a176d6555afc843173805468632d69ef8900125ba1d`

The C1/C2 documents were supplied in prior project preparation and re-read directly for this task. Historical summaries helped locate them; current source inspection governs the comparison. Their original files are not redistributed. Source requirements were interpreted as research evidence, not executed as commands.

## Education and communication evidence

Interpretation, dates, sample sizes, applicability, and limitations are in [clinical education and assessment](clinical-education-and-assessment.md).

| Source | Evidence type / use |
| --- | --- |
| [Sun et al., 2026](https://www.frontiersin.org/journals/public-health/articles/10.3389/fpubh.2026.1768518/full) | Primary randomized education study; ten-minute encounter precedent; bundled modality/feedback comparison |
| [Brügge et al., 2024](https://link.springer.com/article/10.1186/s12909-024-06399-7) | Primary randomized study of structured AI feedback |
| [Levy et al., 2018](https://jamanetwork.com/journals/jamanetworkopen/fullarticle/2716996) | Primary nondisclosure survey; motivations and sampling limitations; published online November 30 |
| [SAMHSA TIP 35, Chapter 3](https://www.ncbi.nlm.nih.gov/books/NBK571068/) | Institutional guidance on ambivalence and collaborative communication; adapted cautiously outside original counseling setting |
| [Hepner et al., 2026 issue](https://archive-ouverte.unige.ch/unige:190990) | Primary OSCE empathy/behavior study, university repository |
| [Dufayet et al., 2024](https://pubmed.ncbi.nlm.nih.gov/38285021/) | Primary OSCE comparison of SP and examiner empathy ratings |
| [Friedlander et al., SOMA](https://journals.sagepub.com/doi/10.1177/0011000019891434), [author-hosted article](https://www.mcandrewhealthlab.com/uploads/5/3/9/5/53951197/0011000019891434.pdf) | Primary measure-development study in a different clinical setting |
| [Makoul, SEGUE](https://pubmed.ncbi.nlm.nih.gov/11602365/) | Original communication-assessment framework |
| [Eppich and Cheng, PEARLS](https://pubmed.ncbi.nlm.nih.gov/25710312/) | Original debriefing framework; not an autonomous-LLM validation study |
| [INACSL standards](https://www.inacsl.org/healthcare-simulation-standards) | Official simulation standards |
| [Baile et al., SPIKES](https://pubmed.ncbi.nlm.nih.gov/10964998/), [VitalTalk emotion guidance](https://vitaltalk.org/responding-to-emotion-respecting/) | Original serious-news framework and institutional communication guidance |

## Official technical sources

Interpretation and live-versus-generated avatar distinctions are in [voice/avatar integration](voice-and-avatar-integration.md). These pages document available product routes, not the project's access, a tested implementation, or guaranteed performance.

- ElevenLabs: [React SDK](https://elevenlabs.io/docs/eleven-agents/libraries/react), [authentication](https://elevenlabs.io/docs/eleven-agents/customization/authentication), [conversation flow](https://elevenlabs.io/docs/eleven-agents/customization/conversation-flow), [tools](https://elevenlabs.io/docs/eleven-agents/customization/tools), [custom LLM](https://elevenlabs.io/docs/eleven-agents/customization/llm/custom-llm), [guardrails](https://elevenlabs.io/docs/eleven-agents/best-practices/guardrails), [events](https://elevenlabs.io/docs/eleven-agents/customization/events/client-events), and [vendor latency guide](https://elevenlabs.io/blog/voice-agent-latency-optimization).
- Avatar paths: [generated avatar videos](https://elevenlabs.io/docs/overview/capabilities/image-video/avatars), [official LiveAvatar integration](https://elevenlabs.io/docs/eleven-agents/guides/integrations/live-avatar).
- Privacy and budget: [retention](https://elevenlabs.io/docs/eleven-agents/customization/privacy/retention), [audio saving](https://elevenlabs.io/docs/eleven-agents/customization/privacy/audio-saving), [privacy overview](https://elevenlabs.io/docs/eleven-agents/customization/privacy), [Zero Retention Mode](https://elevenlabs.io/docs/eleven-api/resources/zero-retention-mode), [HIPAA conditions](https://elevenlabs.io/docs/eleven-agents/legal/hipaa), [Agents pricing](https://elevenlabs.io/pricing/agents).
- Browser: [MDN getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).
- Record structures/integration: [Epic on FHIR](https://fhir.epic.com/), [Synthea](https://synthetichealth.github.io/synthea/).
- Event taxonomy: [official Rutgers Health Hack tracks](https://ruhealthhack.com/).

## What this research does not establish

No product was built, provider session run, benchmark measured, class roster imported, real patient record accessed, case clinically approved, learner recruited, or educational outcome validated. No specific technology vendor or application stack is mandated in the supplied challenge documents. Numeric rubric anchors and the implementation sequence are recommendations; they are not an official judging score or a validated clinical competence assessment.

The full transcript preserves speculative product claims for traceability. A transcript is evidence that a statement was made, not proof that the statement is true. Current provider documentation can change; verify SDK versions, provider contracts and account entitlements when implementing.
