# Voice and avatar integration for a virtual patient

**Sources checked:** 2026-10-10. **Status:** current provider research, account-access observation, and proposed acceptance criteria. Actual provider jobs, speech checks, and deployment results belong in the [implementation record](implementation-and-verification-2026-10-10.md).

## Recommended sequence

The user now specifically requests ElevenLabs' native video tools. Prioritize an original synthetic patient introduction and reusable, faculty-approved reply clips generated in ElevenLabs, while keeping the ten-minute encounter, captions, and authored case engine usable during video preparation or failure. A visible illustration with voice remains a useful fallback.

ElevenLabs offers both voice infrastructure and an asynchronous Image & Video API. Its native generated clips and its documented real-time integration have different contracts. The latter uses HeyGen LiveAvatar and remains optional and disabled for this project; no additional provider setup or paid API-plan upgrade is authorized by the native-video request.

## Native video, Avatar library, and current access

ElevenLabs [announced Image, Video, and Templates APIs on September 26, 2026](https://elevenlabs.io/blog/introducing-the-image-video-and-templates-apis), with the announcement updated October 5. Any earlier blanket statement that ElevenLabs has no video API is superseded by this release.

The [Image & Video overview](https://elevenlabs.io/docs/overview/capabilities/image-video) separates access: free users can generate images only, up to three requests per day; video in the app needs a paid plan. Models with a listed API ID can be called programmatically; others are app-only. Creatify Aurora is listed as `creatify-aurora`, takes an image plus speech audio, and produces audio-driven avatar video at 480p or 720p. Its listed expression/movement capabilities are vendor descriptions, not validated patient affect or empathy measurements.

The [API quickstart](https://elevenlabs.io/docs/eleven-api/guides/cookbooks/image-and-video) requires **Pro or above** and Image & Video or Flows key permissions; lower-tier workspaces receive `402 paid_plan_required`. Jobs are asynchronous and can take minutes. Collect completed MP4s through webhooks or bounded polling at intervals of at least ten seconds. A result's signed URL expires after roughly an hour, so retain a generation ID and retrieve a fresh URL when needed. This is not a documented native real-time face stream.

The [video creation endpoint](https://elevenlabs.io/docs/api-reference/flows/video/create) is `POST /v1/flows/video`. The `creatify-aurora` request requires `image` and `audio`. [Media references](https://elevenlabs.io/docs/eleven-api/guides/how-to/image-and-video/references) can point to an uploaded asset, an earlier generation, or inline base64 content; inline audio accepts MP3 or WAV and is capped at 25 MB after decoding. Validate the authored reply before generating its speech, then supply that audio rather than prompting a video model to invent patient dialogue.

The separate [Avatar library documentation](https://elevenlabs.io/docs/overview/capabilities/image-video/avatars) describes a paid-plan UI workflow: choose a persistent avatar/style and voice, generate and review speech from a script, then generate lip-sync video. It still states its own API was unavailable at launch. That statement does not negate the generic Image & Video API above.

**Observed account state, October 10:** the user activated Creator; the signed-in dashboard showed 131,000 credits and renewal on November 10, 2026. This supports the paid-plan UI route. It does not establish Pro API access, remaining credits after generation, or a completed video/speech check. No API-plan upgrade is authorized. PAYG funds do not remove [subscription API-access restrictions](https://elevenlabs.io/docs/overview/administration/pay-as-you-go).

**Proposed integration:** prepare approved reply clips ahead of encounters and cache by case version, authored answer, portrait, voice, and video settings. Faculty review the finished audio and video before publishing the clip association. Play only a clip matching the current authorized reply; otherwise use its authored audio/text. This recommendation follows the asynchronous processing contract; actual generation latency, cost, quality, and upload/playback support still need measured acceptance evidence. Do not send unreleased clinical facts, student transcripts, or imported source portraits to the video provider by default.

## Verified voice capabilities

The current [ElevenAgents React SDK documentation](https://elevenlabs.io/docs/eleven-agents/libraries/react) uses `@elevenlabs/react`, a `ConversationProvider`, and conversation hooks. Voice sessions default to WebRTC; text-only sessions default to WebSocket. Authorized sessions use a server-issued conversation token for WebRTC or signed URL for WebSocket. The SDK exposes connection/error events, transcripts, speaking/listening state, microphone mute, and output-volume/frequency measurements that can drive a basic visual indicator.

Keep the ElevenLabs API key on the server. Authenticate the student in the application before minting a session credential. For WebSocket, the [authentication guide](https://elevenlabs.io/docs/eleven-agents/customization/authentication) says signed URLs expire after fifteen minutes **for establishing a connection**; an established conversation can continue longer. This expiry is not the encounter time limit. Issue a fresh credential per authorized session and apply application rate limits.

The [conversation-flow documentation](https://elevenlabs.io/docs/eleven-agents/customization/conversation-flow) provides a maximum duration setting, interruption events, silence timeouts, and turn eagerness. Set the encounter limit explicitly to 600 seconds rather than relying on the documented default. Use normal/patient turn-taking initially; interview pauses and difficult-news conversations need room for students and patients to finish speaking. Enable interruption behavior and verify that audio playback actually stops when the student interrupts.

Latency must be measured across the complete interaction. The [vendor's latency guide](https://elevenlabs.io/blog/voice-agent-latency-optimization) distinguishes time-to-first-audio from individual model inference time. Capture student speech end, transcript finalization, case/tool response, first audible reply, and first corresponding avatar frame. Report p50/p95 under the intended classroom network and concurrency. No end-to-end latency guarantee was established by this research.

## Keep clinical truth separate from performance

**Proposed CaseClimb design, not a provider guarantee:** the application owns an immutable case version containing approved history, findings, intended concealments/inconsistencies, disclosure rules, and assessment objectives. A session owns mutable rapport, mood, and revealed-fact state. The voice system expresses that state; it does not invent or rewrite the clinical record.

Faculty mood controls should select bounded, reviewed behavior presets. A resistant patient may decline an answer or make an explicitly authored inconsistent claim. The transcript/event log should retain the relevant authored fact identifier and disclosure decision so a debrief can explain what evidence was available. Keep clinical scoring and feedback outside the patient persona.

ElevenLabs documents [webhook and client tools](https://elevenlabs.io/docs/eleven-agents/customization/tools) and a [custom LLM endpoint](https://elevenlabs.io/docs/eleven-agents/customization/llm/custom-llm) compatible with Chat Completions or Responses formats. These offer integration routes to an application-owned case engine. They do not prove factual consistency. Student utterances, tool parameters, and client updates must not authorize access to unrevealed facts or changes to the case.

Provider [guardrails](https://elevenlabs.io/docs/eleven-agents/best-practices/guardrails) are supplementary: in streaming mode, part of a reply can be delivered before a block takes effect; blocking waits before delivery and adds latency. The documentation labels Content and Custom guardrails Alpha. If validation must prevent a contradictory clinical statement from being spoken, validate the authorized reply before speech generation rather than assuming a streaming guardrail will retract it.

## Visual implementation choices

| Option | What it supports | Conditions and limits |
| --- | --- | --- |
| Application-rendered illustration or 2-D/3-D character | Visible patient, authored expressions, speaking animation | Lowest initial complexity. Output amplitude can animate a mouth but is not accurate phoneme/viseme lip sync. Requires licensed/consented artwork and expression mapping. |
| ElevenLabs native video generation, current priority | Lip-synchronized talking-head clips; persistent identities in the app | Creator supports the paid-plan UI route. Generic Image & Video API requires Pro+; the Avatar library API is separately documented as unavailable at launch. Generated clips are asynchronous. Some models/reference uploads have US restrictions; check the chosen model. |
| HeyGen LiveAvatar with ElevenAgents, optional and disabled | Real-time rendered video and audio-driven lip sync | The [official integration guide](https://elevenlabs.io/docs/eleven-agents/guides/integrations/live-avatar) uses LiveAvatar LITE mode: ElevenLabs orchestrates audio; LiveAvatar renders/streams the face. It requires both providers' API access and PCM 24 kHz input/output settings. The guide requires registering an ElevenLabs key with LiveAvatar, scoped to `convai_read`, `user_read`, and `voices_read`. Treat this as a separate vendor, credential, billing, and privacy decision. No proof of reliable faculty-controlled emotional expressions was established. |

Character-level alignment is documented for [client audio events](https://elevenlabs.io/docs/eleven-agents/customization/events/client-events); WebRTC transports audio through LiveKit rather than the WebSocket `audio` event. Alignment alone is not a phoneme-to-face animation system. Verify the chosen transport's actual animation data path before promising lip sync.

Displaying a face does not establish where a student is looking. Do not infer gaze or empathy from the avatar's presence, microphone level, or SDK speaking state. Any camera/gaze assessment is a separate research and validation question; provide an accessible way to participate without it.

## Browser and privacy requirements

Browser microphone access needs a secure context and user permission. An embedded app also needs permission from its parent frame's Permissions Policy. Provide a deliberate start action, permission-denied recovery, mute/end controls, captions, and a text fallback. [MDN's browser API documentation](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia) describes the HTTPS/localhost and iframe requirements. A patient avatar does not itself require a student webcam.

Current official retention documentation is particularly relevant to a student pilot:

- [Retention](https://elevenlabs.io/docs/eleven-agents/customization/privacy/retention) says conversation data defaults to **two years**, with separate transcript/audio controls. It documents a day count, `-1` for unlimited retention, and `0` for scheduled deletion. Applying a shorter period to existing data may delete older records immediately.
- [Audio saving](https://elevenlabs.io/docs/eleven-agents/customization/privacy/audio-saving) says call audio is enabled by default. Disabling it prevents **new** audio recordings from being saved; transcripts remain viewable and existing recordings remain until removed through retention settings.
- The [privacy overview](https://elevenlabs.io/docs/eleven-agents/customization/privacy) describes audio-saving off plus zero-day retention as its maximum-privacy configuration, while its dedicated retention page calls zero days scheduled deletion. Verify the actual deletion behavior rather than assuming zero days means no processing or no transient storage.
- [Enterprise Zero Retention Mode](https://elevenlabs.io/docs/eleven-api/resources/zero-retention-mode) is a separate feature. It covers eligible API traffic, not web UI/playground traffic, even when enabled for an agent in the dashboard. It does not cover support submissions or other material outside eligible payloads. The page says ordinary retained-data backups can persist for up to thirty days after deletion when ZRM is not used.

Use synthetic patient data. Explain to participants which services receive their voice/text and how recordings, transcripts, debriefs, application logs, and any avatar-provider data are retained. The vendor's [HIPAA page](https://elevenlabs.io/docs/eleven-agents/legal/hipaa) conditions PHI use on an executed BAA and engaged ZRM; an ordinary account or retention toggle does not establish that authorization. This project has not established eligibility for PHI processing. Institutional requirements must be resolved before any real clinical material is considered.

## Budget and version uncertainty

The [current Agents pricing page](https://elevenlabs.io/pricing/agents) describes included call minutes, plan concurrency limits, additional minutes, higher-cost burst usage, and separate LLM/telephony usage. Native video consumes credits according to the selected model/settings; the UI displays cost before generation. The observed Creator allowance above is account evidence at that time, not a current remaining balance, an inspected invoice, or permission to upgrade. A second live-avatar provider would add separate costs.

For planning, calculate `voice_minutes = students × sessions_per_student × actual_session_minutes`. Twenty students with three ten-minute sessions require 600 voice minutes before retakes and setup overhead. Estimate total spend as subscription + excess minutes + LLM usage + avatar usage + application hosting/storage. Test planned simultaneous use separately from total minutes and set a project spending cap before the pilot.

The current docs describe newer SDK hooks and voice products; older examples may differ. At implementation time, record the installed SDK/package lock versions, selected model IDs, voice ID, agent version, transport, audio formats, privacy settings, and date. This source research does not validate their compatibility; consult the implementation record for subsequent tests and measured results.

## Application-owned live speech path

The user subsequently requested an immediately usable live conversation. The implemented path uses opt-in [browser SpeechRecognition](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition) to finalize an utterance, the existing bounded application encounter engine to select authored replies, and the current TTS-scoped ElevenLabs key to speak the stored response. Recognition stops during requests/playback and resumes after playback; explicit pause/end and failures stop the loop. Browser recognition has limited support and may transmit audio to the browser vendor. This is live audio interaction using ElevenLabs speech, not a hosted ElevenAgent or a native responsive video renderer.

An original nonclinical conversation demo is separate from the faculty-reviewed clinical library. It uses fixed authored conversation topics, scoped encounter tokens, ten-minute deadlines, lifetime provider quotas, and transcript-only completion. Imported clinical drafts remain unpublished. Worried, calm, curious, frustrated, and neutral delivery presets use the supported v4 Turbo parameters and fixed tags. Current measured checks are recorded in the [implementation record](implementation-and-verification-2026-10-10.md).

A future fully hosted ElevenAgent can use a [custom LLM adapter](https://elevenlabs.io/docs/eleven-agents/customization/llm/custom-llm) and [private-session credentials](https://elevenlabs.io/docs/eleven-agents/customization/authentication), but needs appropriately scoped API access rather than the existing TTS-only key. [Speech Engine](https://elevenlabs.io/docs/eleven-api/guides/cookbooks/speech-engine) offers provider-owned transcription/turn-taking around application logic and requires a persistent WebSocket upstream; the current HTTP API/Mangum deployment does not supply one. These are future integration routes, not current deployment claims or authorization to expand credentials/subscriptions.

## Proposed rollout acceptance checks

1. **Authorized entry:** an unauthenticated or unassigned student cannot obtain a session credential; another student's session is inaccessible; no API key or signed credential appears in source, analytics, or logs.
2. **Case consistency:** direct, indirect, repeated, contradictory, and adversarial questions retain the same case truth. Every intentional concealment or inconsistent claim maps to an approved scenario rule. Unreleased findings and the assessment key cannot be retrieved by requesting a prompt/tool/state change.
3. **Ten-minute limit:** backend/provider and UI end the encounter at 600 seconds, clean up audio/video tracks, and preserve the permitted debrief record. Reconnection behavior and pause policy are explicitly tested.
4. **Voice usability:** student interruption stops the patient's audio and animation; long thinking pauses do not create repeated prompts; microphone denial, device change, disconnection, and provider failure have a usable recovery/text path.
5. **Avatar usability:** mouth activity matches the selected audio path; expressions match authored mood states; delayed video, missing frames, or render failure do not corrupt the conversation or imply the patient said something different.
6. **Debrief evidence:** only completed transcript turns and logged case decisions inform feedback; interruptions and revised speech-recognition partials do not count as completed statements. Faculty inspect examples before scoring is used consequentially.
7. **Privacy:** verify actual audio/transcript defaults, deletion schedule, role access, application log exclusions, and each participating provider's settings with synthetic test sessions. Document any discrepancy from the desired policy.
8. **Capacity and cost:** measure p50/p95 reply/visual delays and failure rates at planned concurrency; verify usage accounting, retake overhead, and the spending cap. Report results rather than claiming success from SDK setup alone.
