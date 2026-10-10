# CaseClimb backend

Run `uv sync`, set independently generated `CASECLIMB_ADMIN_TOKEN` and `CASECLIMB_STUDENT_CODE`, then run `uv run uvicorn backend.app:app --host 127.0.0.1 --port 8000`. No insecure default credential exists. API documentation is at `/docs`; the typed case contract is in [models.py](models.py). If `frontend/` exists, it is served at `/web/`.

The deployed app also requires `CASECLIMB_APP_PASSWORD` (at least twelve characters) and independently generated `CASECLIMB_SESSION_SECRET` (at least thirty-two characters). Sign-in uses a backend-rendered form at `/` or `/web/`, then a signed four-hour HttpOnly/Secure/SameSite=Strict host cookie backed by a revocable server session. `POST /auth/login` accepts the form or `{password}`; successful login redirects to `/web/`. `POST /auth/logout` revokes the session and clears the cookie. Passwords and signing secrets are never returned in status or stored in login records. API calls, static assets, docs, and OpenAPI require app sign-in; health and auth routes remain accessible. Faculty, student start-code, and encounter bearer checks still apply after app sign-in.

Both entrance secrets may be unset for local development; partial configuration or missing/weak Lambda configuration fails closed. HTTPS is required for sign-in unless `CASECLIMB_ALLOW_LOCAL_HTTP=1` is explicitly set and the request is to loopback. Durable login buckets cap attempts at twenty per source IP and sixty globally per minute and reset naturally; source IP is HMAC-hashed before storage. Auth records have TTLs, with application expiry authoritative even before DynamoDB deletes them. Rotate the session secret to invalidate existing signed cookies. This shared entrance is a workshop access gate, not institutional identity or verified user enrollment.

`backend/demo-case.json` is an **unreviewed draft**, never automatically imported or published. Faculty create a draft through `POST /api/faculty/cases`, inspect/edit it, validate its structure, and attest to review before publishing. Structural validation does not establish clinical validity; an approval records a reviewer's attestation, not an independently verified credential or clinical outcome. Published versions are immutable; editing the draft leaves existing versions and encounters intact.

| Route | Authorization / behavior |
| --- | --- |
| `GET /auth/login`, `POST /auth/login`, `POST /auth/logout` | Entrance form, bounded shared-password login, server-session logout |
| `GET /api/status`, `/api/library` | App cookie when gate configured; configuration booleans and published learner-facing summaries only |
| `GET/POST /api/faculty/cases` | Faculty bearer; full drafts and immutable version records |
| `GET/PUT /api/faculty/cases/{id}` | Faculty bearer; PUT requires `?expected_revision=` from the reviewed GET; edit draft only |
| `POST /api/faculty/cases/{id}/validate` | Faculty bearer; structural references/cycle checks |
| `POST /api/faculty/cases/{id}/approve` | Faculty bearer; `expected_revision`, `reviewer`, `review_note`, `clinical_review_confirmed:true`, `synthetic_confirmed:true` |
| `GET /api/faculty/analytics` | Faculty bearer; operational aggregate counts only |
| `POST /api/encounters` | `{case_id, version?, access_code}`; published version only; returns scoped random bearer once |
| `GET /api/encounters/{id}` | Scoped bearer; released chart and confirmed ledger, server timer |
| `POST /api/encounters/{id}/turns` | Scoped bearer; `{request_id,text,confirmed:true}`; 60-turn cap, content-bound idempotency |
| `POST /api/encounters/{id}/conclude`, `GET .../feedback` | Scoped bearer; post-encounter authored-rule feedback with event evidence |
| `POST /api/encounters/{id}/tts` | Scoped bearer; `{event_id}` from stored patient messages; active session only, bounded one-call cache |
| `POST /api/encounters/{id}/video/start` | Scoped bearer; optional custom LITE transport credentials and earlier video deadline; one start attempt per encounter |
| `POST /api/encounters/{id}/video/audio` | Scoped bearer; `{event_id}` only; cached authored PCM16 mono 24kHz chunks, at most 30 seconds/500 characters |
| `POST /api/encounters/{id}/video/stop` | Scoped bearer; idempotent provider cleanup; disconnect client transports too |

Only currently matched, prerequisite-authorized fact IDs can be selected. Authored nondisclosure requires an approved clarification keyword; no new clinical prose is generated. Artifact bodies are authored text/metadata: no uploaded file or external URL is fetched. Unknown and known-negative facts remain distinct. Feedback is an unvalidated formative rule result; simulated rapport is a separate engine state, with no camera or gaze grading. Learner turns are explicitly confirmed by the client; the backend does not verify that an audio reply was heard.

The server caps encounters at 600 seconds including pauses and provider time. New turns and speech requests stop at expiry. An idempotent replay can retrieve its already-confirmed response after expiry and makes no provider call. Each turn is reserved before invoking a provider, with one in-flight turn per encounter and a thirty-second lease. Duplicate pending requests return 409 without invoking the provider again. Abandoned/failed IDs remain failed; an explicit retry needs a new ID, and there are at most sixty attempts per session. Expired leases recover on a read/new request, without replaying uncertain paid work. Conclude cancels pending work. Late output is discarded. Debrief is outside the cap. A patient event's speech is generated at most once; if generation fails, use captions/browser speech rather than automatically spending again. No classroom capacity or educational benefit has been validated.

Optional Bedrock debrief selects up to three existing missed objective IDs, each faculty-authored focus enum, and visible evidence event IDs. Guidance and next questions remain exact authored text. All authored opportunity cue IDs must be visible before a missed objective is assessable. No model prose, scores, hidden cues, or inferred deception enter feedback. One CAS-reserved debrief attempt is cached; concurrent reads use authored assessments while it runs. An abandoned thirty-second lease falls back to authored priorities without repeating uncertain charges. Its Bedrock call shares the same lifetime quota as fact selection.

Optional video uses [LiveAvatar LITE custom audio](https://docs.liveavatar.com/docs/lite-mode/lifecycle): the backend creates a LITE session with a provider maximum duration, then returns only its scoped LiveKit client token and custom-audio WebSocket URL. The browser receives LiveKit tracks and sends authored [PCM24 speech chunks](https://docs.liveavatar.com/docs/lite-mode/events) using `agent.speak` / `agent.speak_end` after the provider reports `connected`. ElevenLabs produces [PCM 24kHz](https://elevenlabs.io/docs/api-reference/text-to-speech/convert) from confirmed stored patient text. Provider API keys, session JWT, and agent token stay server-side. This uses a separately billed video provider; it does not register an unconstrained ElevenLabs conversation agent. Live provider entitlement, avatar access, protocol acceptance, and rendering have not been verified by fake-provider tests.

Approved `voice_id` and typed `voice_delivery` settings are pinned with each case version and used by both cached audio formats. [ElevenLabs documents](https://elevenlabs.io/docs/eleven-creative/playground/text-to-speech) model-specific controls: Multilingual v2 uses stability, similarity, style, and speed (0.7–1.2); v4 Turbo uses stability/similarity and audio tags, with unsupported style/speed rejected. A bounded emotion enum selects fixed v4 delivery tags. Faculty-set emotion is the default; optional simulated mood maps only the authored engine mood. Provider text includes those tags, while the event ledger and captions preserve authored words; the speech quota counts all submitted characters. v2 uses authored wording and voice settings without emotion tags. Delivery remains nondeterministic and does not establish patient emotion or a student score. Choose an explicit stable case voice ID for reproducibility; an unset ID uses the configured server fallback.

Video stays off until the API key, default avatar ID, and PCM-capable authored voice are configured. One start attempt per encounter is reserved before provider calls; start failures remain spent. Video ends at least thirty seconds before the encounter deadline to cover bounded startup time, with an additional provider maximum-duration limit and a twenty-second application start lease. Conclude and reads after expiry request cleanup; browsers also stop/disconnect at the returned video deadline and on navigation. The Lambda backend does not hold a persistent WebSocket. Provider cleanup failures use bounded retry/backoff and expose a cleanup state; the provider duration limit bounds a disconnected or abandoned session. No guaranteed immediate stop is claimed. Client transport credentials necessarily permit that scoped renderer to send custom audio; the backend never treats rendered audio as proof of clinical correctness or assessment evidence.

## Configuration

| Variable | Purpose |
| --- | --- |
| `CASECLIMB_ADMIN_TOKEN` | Required faculty bearer; inject securely, never commit |
| `CASECLIMB_APP_PASSWORD` | Required deployed shared entrance password; at least twelve characters, never commit |
| `CASECLIMB_SESSION_SECRET` | Required deployed independent cookie-signing secret; at least thirty-two characters, never commit |
| `CASECLIMB_ALLOW_LOCAL_HTTP` | Explicit `1` allows non-Secure app cookie/sign-in only on HTTP loopback; unset in deployment |
| `CASECLIMB_STUDENT_CODE` | Required student start code; separate from admin token |
| `CASECLIMB_STORE` | `file` (default) or `dynamodb` |
| `CASECLIMB_DATA_FILE` | Local JSON path, default `.private/caseclimb-data.json`; use one shared local filesystem |
| `CASECLIMB_TABLE_NAME` | Required DynamoDB table when selected |
| `CASECLIMB_BEDROCK_MODEL_ID` | Optional Bedrock Converse model; unset keeps fully authored deterministic engine |
| `CASECLIMB_DEBRIEF_MODEL_ID` | Optional ID-only debrief selector; unset renders authored priorities |
| `ELEVENLABS_API_KEY` | Optional server-only key explicitly supplied by the user; no automatic lookup |
| `CASECLIMB_VOICE_ID` | Optional stable fallback voice, overridden by approved case voice |
| `CASECLIMB_TTS_MODEL` | Legacy standalone-adapter fallback; encounter audio uses the model pinned in `voice_delivery` (default `eleven_multilingual_v2`) |
| `CASECLIMB_SESSION_BUDGET` | Lifetime session admission allowance, default 200, range 1–10,000 |
| `CASECLIMB_BEDROCK_CALL_BUDGET` | Lifetime Bedrock attempt allowance, default 300, range 1–10,000 |
| `CASECLIMB_TTS_CHARACTER_BUDGET` | Lifetime authored TTS characters, default 20,000, range 1–1,000,000 |
| `LIVEAVATAR_API_KEY` | Optional server-only video provider key; no automatic lookup or registration |
| `LIVEAVATAR_AVATAR_ID` | Default provider avatar UUID; approved cases may set `avatar_id` |
| `CASECLIMB_VIDEO_SESSION_BUDGET` | Lifetime video start attempts, default 2, range 1–100 |
| `CASECLIMB_VIDEO_MINUTE_BUDGET` | Lifetime reserved video minutes, default 20, range 1–1,000 |

Lambda handler: `backend.app.handler`. DynamoDB uses `pk` (String hash key, no sort/index), `revision` (Number), `payload` (JSON String), and optional `expires_at` (Number TTL). Key prefixes are `case:`, `encounter:`, `audio:`, `video:`, `pcm:`, `quota:`, `auth:`. PCM is cached in small chunk groups so each item stays below DynamoDB's 400KB limit. Conditional revisions protect writes and reservations. Deployment-wide lifetime quota counters have no TTL and count unsuccessful/uncertain provider attempts without refunds; video minutes reserve the entire bounded start duration rounded up. Session exhaustion returns 429; Bedrock exhaustion uses an explicit authored fallback; speech/video exhaustion uses captions/browser speech. Only an explicit administrator budget change can add allowance. Enable encryption and TTL; configure IAM to this table and selected Bedrock models. TTL is asynchronous; application deadlines remain authoritative. Cases persist until explicitly removed through a separately authorized maintenance action; encounters/audio/video carry a 24-hour TTL, which does not promise immediate deletion. Local storage does not automatically delete records.

This small prototype uses prefix-filtered table scans for faculty listings/aggregate analytics, so larger deployments should add indexes and an explicit retention/deletion workflow. It uses one faculty secret and a shared student code rather than institutional identity/rosters; do not equate these gates with verified faculty identity. Only synthetic content is permitted by the case schema; applications must also instruct learners not to enter real patient data. Provider retention settings and institutional approval need separate verification before a pilot. No provider account, contract, clinical case approval, or PHI-processing authorization is established by this implementation.

Payloads are bounded for DynamoDB: 256KB request bodies, 340KB case/version records, and 260KB active encounter ledgers with space reserved for the final debrief. Approval limits authored objective guidance to a combined 20KB. Debrief evidence links to the full stored event and displays short excerpts. Large Unicode content or a long version history can reach these storage limits before the turn cap; the API reports the limit explicitly.

Verify locally with `uv run pytest`. These are backend checks, not evidence of AWS deployment or actual provider entitlement.
