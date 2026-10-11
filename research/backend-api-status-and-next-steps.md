# Backend API status and next steps

Observed October 10, 2026. This is a source and deployed-MVP assessment, with proposed next steps kept separate from implemented behavior. The interface can be redesigned against the existing APIs without changing case/version ownership or encounter tokens.

## Implemented API groups

| Group | Routes | Current behavior |
| --- | --- | --- |
| App access | `GET/POST /auth/login`, `POST /auth/logout` | Shared entrance password, secure HttpOnly cookie, same-origin form checks, login limits, revocation. Separate faculty and encounter authorization remains required. |
| Discovery | `GET /api/health`, `/api/status`, `/api/library`, `/api/demo/profiles` | Health/provider availability, reviewed clinical case library, four original nonclinical profiles. |
| Faculty authoring | `GET/POST /api/faculty/cases`, `GET/PUT /api/faculty/cases/{id}`, `POST …/validate`, `POST …/approve`, `GET /api/faculty/analytics` | Schema validation, optimistic revisions, approval bound to the reviewed revision, immutable published versions, basic aggregate analytics. |
| Encounters | `POST /api/encounters`, `POST /api/demo/encounters`, `GET /api/encounters/{id}`, `POST …/turns`, `POST …/conclude`, `GET …/feedback` | Scoped encounter tokens, pinned profile/case versions, ten-minute deadline, one pending turn, idempotent confirmed replies, transcript and chart disclosure, formative authored feedback and optional constrained Bedrock debrief. |
| Voice | `POST /api/encounters/{id}/tts` | ElevenLabs speech from stored patient event IDs, pinned voice/delivery, bounded generation, cached MP3 replay, durable provider allowance. |
| Video | `POST /api/encounters/{id}/video/start`, `POST …/video/audio`, `POST …/video/stop` | Scoped LiveAvatar LITE session, authored ElevenLabs PCM24 packets, renderer completion events, bounded cleanup. Current deployment forces the free Wayne sandbox. |

Implementation: [application routes](../backend/app.py), [app access](../backend/access.py), [provider adapters](../backend/providers.py), [video coordinator](../backend/video.py), and [backend contract](../backend/README.md). FastAPI also provides an authenticated OpenAPI schema at `/openapi.json` for the new interface.

The current frontend and API share an origin. If the redesigned frontend moves to another domain, CORS, cookie/session behavior, and CSRF/authentication need an explicit contract; the current strict cookie is not a ready-made cross-domain sign-in solution. Keep the new frontend on the API origin initially, or complete that identity integration before treating a separate deployment as connected.

## Buffered release audit

This section records the earlier `0b42252` release. The newer [streaming backend](streaming-backend.md) implements realtime Scribe, an authenticated AWS WebSocket service, incremental TTS forwarding, spoken interruption, and recovery without automatic paid replay. Clinical case review, institutional identity, validated assessment, and pilot operations below remain separate work.

The browser receives actual avatar video/audio through LiveKit/WebRTC and sends PCM to LiveAvatar over a WebSocket. Signed-in AWS Chrome checks decoded a 640×360 avatar, played actual ElevenLabs speech for a typed question, and reached the renderer's reply-completion status. The user separately confirmed that spoken start reaches Listening. That confirms microphone startup; it does not by itself prove a recognized spoken question and a heard reply.

The rest of the current path is **buffered, turn-based**:

1. Browser speech recognition supplies a final phrase; the backend does not receive a live microphone stream.
2. `/turns` returns a completed JSON result. Bedrock selects allowlisted authored content; it does not stream an unrestricted patient response.
3. ElevenLabs generates a complete MP3 or PCM result. `/video/audio` returns completed PCM chunks, which the browser then sends to the renderer.
4. Listening pauses while a reply is prepared and played, then resumes. Explicit stop/pause cancels playback. Automatic spoken interruption of the patient's reply is not implemented.

There is no Scribe token endpoint, hosted ElevenAgents session integration, backend WebSocket conversation service, SSE/token-stream endpoint, or incremental TTS forwarding in the current application. Free video lasts approximately sixty seconds with a shared Wayne face; the encounter continues with profile voice, illustration, and captions.

## Recommended sequence

| Priority | Backend work | Acceptance evidence |
| --- | --- | --- |
| 1 | Add authenticated, encounter-scoped ElevenLabs Scribe Realtime token issuance with its own minute budget; keep browser recognition as a fallback. | A physical spoken question produces exactly one committed learner event; partial transcripts never create turns; no provider key reaches the client; expiry and denied permissions recover visibly. |
| 2 | Add incremental speech delivery and a scoped stream event contract for turn/reply IDs, cancellation, end-of-audio, and recoverable errors. | Measure end-of-speech to first-audio latency on AWS; interruption cancels the old utterance; reconnect does not replay an uncertain paid call or duplicate a ledger event. |
| 3 | Connect a reviewed clinical scenario and strengthen the patient behavior model: disclosure, resistance, authored contradictions, faculty mood, and learning objectives. | A faculty-reviewed version supports a complete spoken ten-minute encounter; replies stay consistent with its visible/hidden facts and prompts; an unreviewed draft cannot launch. |
| 4 | Extend feedback and assignment APIs for student-specific goals, evidence-linked missed probes, and hard-news practice. | Each finding links to a confirmed event and an authored criterion; a reviewer can inspect and revise the result. Numerical empathy/competence claims require separate validation. |
| 5 | Add individual student/faculty identity, assignments, encounter-history access, exports/deletion, and application-level audit events. | Role and cross-user isolation checks pass, and the redesigned client can recover its own authorized history without accessing another learner's record. |
| 6 | Qualify operations for the intended class size and account lifetime. | Concurrent real-provider runs, latency/error metrics, alert delivery, backup restore, provider-key rotation, and hosting migration are exercised against explicit budgets. Current ten reserved Lambda executions are not classroom-capacity proof. |

For the immediate voice upgrade, Scribe plus the existing controlled encounter engine preserves case consistency. [ElevenAgents](https://elevenlabs.io/docs/eleven-agents/overview) is an alternative managed speech/LLM/turn-taking system; it is not already configured here and would need a deliberate integration with our encounter ledger, disclosure rules, provider budget, and custom response source.

The official [Scribe client-streaming guide](https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/realtime/client-side-streaming) documents server-minted single-use tokens and partial/committed transcripts. [ElevenLabs streaming TTS](https://elevenlabs.io/docs/api-reference/text-to-speech/stream) can provide incremental audio, but our current adapter uses the complete conversion endpoint. The current AWS stack uses API Gateway **HTTP API** and a buffered Python/Mangum Lambda integration. AWS [response streaming](https://docs.aws.amazon.com/apigateway/latest/developerguide/response-transfer-mode.html) is supported for **REST APIs**, so an SSE/TTS-stream service needs an explicit integration/runtime change or a separate streaming service. Adding a FastAPI `StreamingResponse` alone does not change the deployed gateway behavior.

## Operational evidence and limits

The [setup runbook](../infra/README.md) covers account-verified deployment, private provider settings, storage, quotas, logs, metrics, and recovery procedures. The core release has 141 passing backend tests; actual provider/browser evidence is recorded in [implementation and verification](implementation-and-verification-2026-10-10.md). Tests and one rendered encounter establish bounded behavior, not clinical validity, classroom load, or a completed production identity system. Imported clinical drafts remain unreviewed and unpublished.
