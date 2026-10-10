# CaseClimb

CaseClimb is a synthetic virtual patient encounter prototype for healthcare students: a faculty authoring Studio, ten-minute patient conversations, progressively disclosed charts, and evidence-linked formative feedback.

The [workshop app](https://tvgsy5zqad.execute-api.us-west-2.amazonaws.com/web/) is deployed on AWS in `us-west-2` and requires the host's shared entrance password. This temporary workshop deployment has no confirmed long-term hosting expiry. Eight imported synthetic patients are private, unreviewed drafts; faculty review and publication are required before practice.

Start with the [research index](research/README.md). It includes the October 10 meeting notes, a timestamped recording transcript, challenge requirements, clinical education evidence, and voice/avatar integration options.

The first slice is an emergency-department communication/history encounter. Faculty author and review a case before publishing an immutable version. Student answers come from the authored case; unknown findings remain unknown. Patient mood and simulated rapport are separate from educational assessment.

Run locally with `uv sync`, independently generated `CASECLIMB_ADMIN_TOKEN` and `CASECLIMB_STUDENT_CODE`, and `uv run uvicorn backend.app:app --host 127.0.0.1 --port 8015`. Open `http://127.0.0.1:8015/web/`. See the [backend contract](backend/README.md), [AWS deployment runbook](infra/README.md), and [delivery/verification record](research/implementation-and-verification-2026-10-10.md).

ElevenLabs supplies patient speech with per-case voice and delivery controls. The deployed demo also includes an ElevenLabs-generated, prerecorded patient video preview. Native ElevenLabs video jobs are asynchronous; their API requires Pro or above, while Creator supports generation in the web app. The optional LiveAvatar adapter remains disabled. Text and captions remain available.

AWS deployment includes a shared entrance password with a signed, revocable four-hour session. Faculty tokens and encounter access remain separate. The deploy script saves access values in ignored `.private/app-access.md`; no credentials or raw sponsor materials are committed. Imported patient sources stay private drafts until a qualified faculty reviewer supplies reveal rules and reviews them. No real patient data, institutional identity integration, clinical validation, or validated grades are established by this prototype.
