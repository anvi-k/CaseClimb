# Sponsor resources for the narrow virtual-patient encounter

**Reviewed:** 2026-10-10. **Scope:** supplied sponsor PDFs plus current official provider documentation. This is a sanitized research record. Original documents, redemption values, participant details, private access links, contacts, account identifiers, and credentials are excluded.

The documents describe offers and setup workflows; they do not independently prove account activation, provider API success, or AWS deployment. This research review created no accounts, subscriptions, provider agents, or resources. Later user activation and account observations are distinguished below; provider/deployment checks belong in the [implementation record](implementation-and-verification-2026-10-10.md).

## Supplied evidence and duplicates

Seven PDF files were reviewed, representing five unique documents. Full extracted text, link annotations, hashes, and selected instruction/catalog-page renders are retained only in the ignored local `.private/resource-review/` directory.

| Supplied document | Pages | Relevant evidence |
| --- | ---: | --- |
| RU HealthHack ElevenLabs participant guide | 2 | Participant Creator offer; Discord eligibility and coupon workflow; future prize offers |
| AWS Kiro Access | 2 | Student verification and development-tool setup; proposed Workshop Studio use; synthetic/public deidentified-data restriction |
| AWS Kiro Access, second download | 2 | SHA-256 byte-identical to the first copy; no additional evidence |
| RU hacks Anakin credit guide | 2 | Promotion redemption through the pricing flow; one month free; second page is effectively blank |
| Vlada Rutgers Health Hack guide | 2 | Event access, explicit expiry, supported aggregate-data areas, limitations and discovery workflow |
| Vlada all data sources | 5 | Vendor inventory claiming 80 available products and their source/coverage metadata |
| Vlada all data sources, second download | 5 | SHA-256 byte-identical to the first copy; no additional evidence |

Do not count duplicate downloads as independent verification. The data-source inventory says its products were checked from a customer account on October 8-9, 2026. That is the vendor's reported check, not a result independently reproduced by this project.

## ElevenLabs: Creator activated by the user; native video UI available

The supplied guide's participant offer is **one month of Creator**, described as including **131,000 credits**. Its exact setup order is:

1. Join the provider's Discord using the intended Discord identity.
2. Open the designated hackathon redemption channel.
3. Click **Start Redemption**.
4. Select **RU HealthHack** and complete the form using the same email used for hackathon registration. The guide says this is how eligibility is verified.
5. Receive a unique coupon from the ElevenLabs bot and follow the provider's instructions to redeem the free Creator plan.

The guide does **not** establish a direct API-key creation path, a signed-in-account bypass of the eligibility form, an explicit redemption deadline, or the exact start/end clock of the free month. Its Pro/Scale prize offers are conditional future awards, not current project capacity.

**Observed October 10, 2026:** after the eligibility workflow, the user activated Creator. The implementation owner inspected the signed-in dashboard, which showed **131,000 credits** and **renewal November 10, 2026**. The research agent did not activate the subscription. This records account state at observation, not the remaining balance after generation, a renewal charge amount, or a validated provider call. Private account, payment, and redemption details are excluded.

The user specifically requests native ElevenLabs video. Current [Image & Video documentation](https://elevenlabs.io/docs/overview/capabilities/image-video) permits video generation in the app on paid plans; the [Avatar UI](https://elevenlabs.io/docs/overview/capabilities/image-video/avatars) pairs an avatar with reviewed speech and a script. Creator supports that UI path. However, the [Image & Video API quickstart](https://elevenlabs.io/docs/eleven-api/guides/cookbooks/image-and-video) requires **Pro or above**, and the Avatar library's own API is separately documented as unavailable at launch. The recently released generic API is asynchronous; it is not native live streaming. No paid API-plan upgrade is authorized. The optional HeyGen LiveAvatar integration remains disabled. See the [voice/avatar note](voice-and-avatar-integration.md) for current native endpoint/input contracts and caching recommendations.

The [current official Agents pricing page](https://elevenlabs.io/pricing/agents) describes voice-agent capacity in call minutes and concurrent calls, with LLM usage charged separately. Do not automatically convert the guide's Creator credit figure into Agents minutes or assume it covers a live video-avatar provider. Current account entitlements must resolve the difference between the dated event offer and current product accounting.

For the encounter backend, the useful integration is a server-authenticated session-credential route, with approved case/dialogue logic kept in the application. ElevenLabs documents [WebSocket signed URLs and agent authentication](https://elevenlabs.io/docs/eleven-agents/customization/authentication) and a [React SDK supporting WebRTC conversation tokens](https://elevenlabs.io/docs/eleven-agents/libraries/react). API keys stay server-side. See [voice-and-avatar-integration.md](voice-and-avatar-integration.md) for retention, avatar alternatives, transport details, and rollout checks.

**Operational prerequisites still to verify:** actual Agents quota/concurrency and post-promotion renewal terms; scoped voice credentials held privately if used; successful synthetic speech/video generation and playback; actual per-job credit cost and remaining allowance; retention/audio-saving settings appropriate to the intended student pilot. Creator activation and the displayed renewal date are already observed; they do not establish these runtime checks.

## Kiro and AWS: separate development-tool access from hosting access

The supplied AWS PDF explains Kiro as a tool for turning an idea into requirements, design, and tasks. Its student setup is: use the student signup flow with a Rutgers university email, complete SheerID verification, install/sign in to Kiro, and create a project spec. It expressly restricts the hackathon work to synthetic or publicly available deidentified data and says not to use real patient data or PHI.

The [current Kiro student page](https://kiro.dev/students/) says a university-affiliated email must be associated with the Kiro account, including when signing in with Google, GitHub, or AWS Builder ID. Verification uses SheerID; the published student benefit is 1,000 Kiro credits per month for one full year after verification. Organization sign-in is excluded from that student program. A Kiro benefit is development-tool capacity, not an AWS service-spend allowance or an ElevenLabs grant.

The PDF proposes deploying through event Workshop Studio accounts, but it supplies no evidence of this project's AWS account allocation, IAM role, allowed Region, service quotas, approved spend, access expiry, or deployment URL. It has no explicit workshop expiry/timezone. These must come from the actual event account-access workflow and current account status. Do not infer an AWS entitlement from successful Kiro student verification.

For optional Bedrock-based dialogue or debrief, [AWS's current model-access documentation](https://docs.aws.amazon.com/bedrock/latest/userguide/model-access.html) says access depends on model/account permissions and provider prerequisites. Third-party model invocation can initiate Marketplace subscription in the background; temporary success during setup does not establish lasting entitlement. Anthropic models have an additional first-use form for the usual runtime path. The [model compatibility guide](https://docs.aws.amazon.com/bedrock/latest/userguide/models.html) also requires checking model, API, endpoint, and Region compatibility. Treat console login and successful model invocation as separate checks; do not choose a model from a stale example without checking its current ID and availability.

Kiro can consume source code and prompts. Its [data-protection documentation](https://kiro.dev/docs/privacy-and-security/data-protection/) describes content collection for service improvement for Free/individual users and opt-out controls; enterprise treatment differs. Keep private participant material, transcripts, coupons, and credentials outside its project context and review the account's data-sharing settings before using it with sensitive inputs.

**Operational prerequisites still to verify:** event AWS account allocated and accessible; role/Region allow the chosen backend services; actual expiry and timezone recorded; temporary credentials can be obtained through the permitted flow; quota/spend limits known; optional model invocation tested; deployment and cleanup permissions present. Export the portable source/configuration before event access ends.

## Anakin: optional research acquisition, not the patient engine

The supplied Anakin guide directs participants to its pricing/promotion flow and describes **one month free**. It does not establish a fixed credit allowance, an explicit redemption cutoff/timezone, API access already enabled for this project, or post-promotion renewal terms. Keep the promotion value private and inspect the account's final offer before relying on capacity.

The [official Anakin API reference](https://anakin.io/docs/api-reference) describes website actions, URL scraping, crawling, mapping, search, browser sessions, and completion webhooks, authenticated with a server-held API key. This is relevant to acquiring permitted public reference material; it is not evidence of clinical patient simulation, voice-agent hosting, or approved patient cases. Use curated official sources and respect their terms rather than allowing live scraping to determine patient answers.

The [pricing page](https://anakin.io/pricing) and the [older pricing documentation](https://anakin.io/docs/documentation/pricing) currently differ in some plan allowances and Wire-action accounting. Account checkout and a verified usage response must settle cost assumptions. Avoid publishing a guaranteed request allowance based on either a sponsor coupon or an older documentation table.

**Operational prerequisites still to verify:** intended account eligible for the promotion; redeemed plan/quota and expiry understood; API key held privately; applicable source terms and acquisition permissions checked. This provider is optional for the first encounter demo.

## Vlada: bounded aggregate context with an explicit event expiry

The supplied event guide grants participant/mentor access until **Monday, October 12, 2026, 9:00 AM ET**, with no card required. With the user's America/New_York timezone and daylight saving in effect on that date, this corresponds to **09:00 EDT / 13:00 UTC**. The guide gives an Eastern clock time; do not substitute the execution host's timezone. Activation duration outside that event offer and post-event entitlements remain unverified.

The setup instructions say to open the event access link first, sign in, and then connect the AI client. Each person needs their own account. If a connected AI reports a missing plan, the guide says to complete the link/sign-in step, wait briefly, and retry. For busy responses, wait about ten seconds and avoid repeated request loops. The private event access link is intentionally absent from this record.

The guide explicitly describes **public aggregate data**, including prices, payer/plan benefits, provider identity, drug payment references, and hospital quality. It says there are **no patient records, clinical notes, or claims** in that event resource. For a synthetic ED encounter, useful optional additions are an evidence-labeled cost/coverage discussion or contextual hospital-quality reference. These datasets cannot supply an individual patient's hidden history, vitamin level, examination, lab result, or encounter truth.

The [current official catalog](https://www.vladahealth.com/catalog) lists 80 products and their provenance/coverage. The [REST/MCP quickstart](https://www.vladahealth.com/tools/rest-quickstart) describes schema discovery, typed results, source/vintage/methodology/hash metadata, account entitlement checks, and guarded read-only SQL. Preserve those metadata and data grain when importing a small reference result. A negotiated price is not an individual patient's out-of-pocket amount, and rating year, plan year, measurement period, and retrieval date are distinct.

Use a bounded discovery sequence: find relevant sources, inspect their schema and required filters, run a narrow read-only query, then save only permitted aggregate evidence with its retrieval date. The guide's example market/enrollment figures have not been re-queried here and are not used as validated results. Do not put live Vlada dependence on the critical path of a ten-minute patient interview; expiry, throttling, or missing data should leave the approved case intact.

**Operational prerequisites still to verify:** individual event entitlement active; intended REST/MCP access available; requested dataset/year/filters entitled; export/reuse terms understood; permitted evidence captured before the event expiry; graceful handling of unavailable access.

## Consequences for the first backend build

Prioritize the application-owned case version, session timer/state, authorized student/faculty access, transcript event log, and evidence-linked debrief. Make provider adapters replaceable and keep a synthetic text/local fallback usable. Use the user's activated ElevenLabs Creator plan for bounded native UI video preparation, checking cost before generation and recording the result separately. API video automation would require a separately authorized plan upgrade. AWS allocation, permissions, budget, and Bedrock invocation require their own evidence; later results are in the implementation record. Kiro aids implementation, while Anakin and Vlada remain optional research/context inputs.

The first deployment acceptance record should distinguish: local tests, provider synthetic API checks, deployed backend checks, and a student/faculty browser encounter. Neither a sponsor guide nor a generated spec proves those checks passed.
