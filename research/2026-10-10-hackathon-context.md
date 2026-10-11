# Rutgers Health Hackathon 2026: TwinVerse track context

Collected Oct 10, 2026. This summarizes the event, the track, and the organizer materials. Following the team's convention for this public repo, original organizer files are not committed. Where they live locally is listed at the end.

## Event
- **When and where:** Fri Oct 9, 6:00 PM to Sun Oct 11, 6:00 PM, at Rutgers Robert Wood Johnson Medical School and RWJ University Hospital, New Brunswick, NJ. Contact: Jay Naik, naikjh@rwjms.rutgers.edu. Sites: [ruhealthhack.com](https://ruhealthhack.com/), [rutgers.edu event page](https://www.rutgers.edu/event/rutgers-health-hackathon).
- **Sunday schedule:**

  | Time | What |
  | --- | --- |
  | 8:00 AM | Breakfast |
  | Morning | Finalization |
  | **12:00 PM** | **Presentations and submissions due** |
  | 12:30 PM | Lunch |
  | 1:00 PM | Track judging |
  | 5:00 PM | Awards |
- **Tracks:** TwinVerse (BMIHAI and SHP), Wellness Reimagined, Ops Unleashed, Sevaro. Each pays a $2,000 grand prize and a $500 runner-up.
- **Sponsors:** AWS, Microsoft, Sevaro, Cigna, Anakin. AWS gave Bedrock credits and a talk covering working backwards (PR/FAQ), Bedrock, Knowledge Bases, Guardrails (including contextual grounding checks), Model Evaluation (LLM-as-judge), Kiro (Rutgers students get a free year), and Strands Agents plus AgentCore (Runtime, Memory, Gateway, Identity).

## Track: TwinVerse
The track is run by Rutgers SHP and the BMIHAI center (Biomedical Informatics and Health AI). It builds on SHP's existing **Virtual Health Care Simulator (VHS)**, a fictional academic health system in Newark where faculty already use AI prompts to run role-play patients ([shp.rutgers.edu/vhs](https://shp.rutgers.edu/vhs/)). VHS lists Walter Green as a patient persona, Rebecca Brody, PhD, as PI, and VHS@shp.rutgers.edu as the contact.

### Challenge 1: Virtual Patient Encounter System
- **Patient Studio (faculty):**
  - create a profile, using a structured or descriptive approach
  - add knowledge sources
  - attach artifacts (labs, ECG, X-ray, CT, prior notes)
  - define when information is released
  - review and correct
  - consistency check
  - approve and publish
  - keep multiple reusable profiles
- **Encounter (student):**
  - split screen: patient on the left, chart that fills in on the right
  - runs any published profile without patient-specific code
  - text required; voice and avatar encouraged
  - consistent identity and state
  - progressive disclosure
  - no invented clinical facts
  - a log of what was disclosed
- **Feedback:**
  - findings elicited and missed
  - interview structure
  - communication, empathy, professionalism
  - explainable and linked to evidence
  - strengths, improvements, next-attempt suggestions
  - driven by faculty learning objectives
  - every encounter logged
- **Stretch:** real-time voice, avatar ("ideal"), multimodal, adaptive behavior, advanced memory/state, richer artifacts, integration APIs (e.g. Canvas).
- **Judged on:** architecture and reusability, profile quality and clinical validity, technical innovation, user experience, encounter quality, feedback effectiveness and explainability.
- **Key demo:** a faculty member creates a NEW patient in your Studio and immediately runs an encounter with it, with no code changes.
- **Deliverables:** working prototype, repository, demo video or live demo, 4-minute pitch.

### Challenge 2: Connected Care Journey
- **Base:**
  - one patient across at least 3 encounters
  - a student plays one professional role; AI plays the patient and the other professionals, using the provided personas
  - a shared patient state updated after each encounter
  - provenance: source, role, encounter, time
  - distinguishes established, uncertain, disputed and unanswered information
  - an integrated patient representation and coherent care plan at the end
- **Enhanced:** TeamSTEPPS-aligned communication with SBAR handoffs, evaluated explainably (observed yes/no, evidence location, feedback; never a bare score).
- **Stretch:** collaboration outside the fixed sequence (huddles, check-backs, reconciliation).
- **Extra deliverables:** architecture and integration document, final patient representation, integrated care plan.

### Rules in both challenges
- "The LLM drives the chat, the templates drive the truth." Clinical facts stay within faculty-approved content.
- The explainer videos add one idea: the patient's story can deliberately conflict with the chart to test reasoning, for example "says they take their meds, but the A1c is high".

## Organizer materials (summary only)
- **8 synthetic patient profiles**, the VHS nutrition-education set: Dominic Rivera, Yvette Armstrong, Nisha Patel, Omar Sinclair, Marcus Ramirez, Walter Greene, Wyatt Nelson, Vladko Bareche.
  - **Sections:** overview, demographics, clinical (free-text strings such as "HbA1c: 9.8%"), medications with adherence, nutrition, psychosocial (goals, fears, beliefs, readiness to change).
  - **Disclosure tiers:** initial, discoverable, reluctant, hidden.
  - **Learning opportunities:** each has expected discoveries and possible patient reactions.
  - **Format quirk:** the file named `.jsonl` is actually concatenated pretty-printed JSON objects.
  - **Data quirk:** stated BMIs often disagree with height and weight.
  - **Source:** [Hugging Face dataset](https://huggingface.co/datasets/joeljames270/virtual-patient-profiles-sample), CC BY 4.0.
- **CSV** of the same 8, with UUIDs, short summaries and S3 portrait keys. It spells one name "Vladko"; the image file says "Vadko".
- **8 portraits**, photorealistic 1024×1536, mostly front-facing headshots. Image rights were not established.
- **5 clinician personas** for Challenge 2:
  - Dr. Brian Lee (emergency medicine)
  - Dr. David Bennet (interventional cardiology)
  - Dr. Nasir Mahmoud, PharmD (cardiology pharmacy)
  - Dr. Priya Narang (hospitalist)
  - Tasha Dunbar, RD (ICU/oncology dietitian)

  Each has behavior notes (what they share up front, when asked, or reluctantly), SBAR preferences, friction points and learning opportunities.
- **Encounter rubric**, 7 domains each scored 1–4 or N/A, maximum 28:
  1. Opening and purpose
  2. Rapport and empathy
  3. Information gathering
  4. Listening and cues
  5. Explanation and shared decisions
  6. Clinical reasoning
  7. Professionalism, safety and closure

  A 1 in domain 6 or 7 triggers review. Evidence fields: strength, gap, safety concern. The total is "a discussion aid, not pass/fail".
- **Other material:**
  - a points-based pediatric hearing (SLP) rubric
  - a Hematology II syllabus
  - a [Kaggle pathology results dataset](https://www.kaggle.com/datasets/pareshbadnore/diagnostic-pathology-test-results) (login required)
  - a 60k-line [patient-doctor dialogue dataset](https://huggingface.co/datasets/Postzeun/Patient-Doctor) with no license stated
- **Explainer videos**, about 7–8 minutes each, one per challenge. Their running example is Denise, 58, with new type 2 diabetes and early kidney involvement, seen by primary care, nephrology and nutrition.

## Where the originals are (not in Git)
On the original machine:
- `~/Downloads/TwinVerse/`: challenge DOCX files, the two videos, and `transcripts/` (video transcripts).
- `~/Downloads/RU Health Hack 2026 SHP (public)/`: data, rubrics, personas, portraits, and `datasets/patients.json` (the 8 profiles converted to a JSON array).
- `~/Downloads/Rutgers Health Hack 2026 - AWS Presentation.pdf`

Teammates should get these from the organizers or the team drive, then place them under the gitignored `.private/`.
