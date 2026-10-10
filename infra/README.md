# AWS workshop deployment and team setup

This setup serves the current CaseClimb web client and FastAPI through Lambda (Python 3.12, Linux ARM64), HTTP API v2, and encrypted DynamoDB. It includes a private deployment-artifact bucket, seven-day application logs, a project CloudWatch dashboard, four alarms without notification actions, and seven-day DynamoDB point-in-time recovery (PITR). The deployment operator verified the updated stack at **2026-10-10 22:09:58 UTC**: CloudFormation `UPDATE_COMPLETE`, the six-widget `caseclimb-us-west-2-operations` dashboard, four alarms with actions disabled, and DynamoDB PITR `ENABLED` with `RecoveryPeriodInDays=7`. The new recovery window had only just begun; seven days of historical backups were not yet available. Alarms initially showed `INSUFFICIENT_DATA`, so this confirms configuration rather than observed incident detection. Local JSON/reference checks also passed.

The runtime role can read/write/scan only its own table, write its own log streams, and optionally invoke the selected regional Bedrock foundation model. API requests are throttled to 5/second with a 10-request burst; Lambda reserves 2 concurrent executions. These are workshop limits, not classroom capacity evidence. Account concurrency availability and permissions for new CloudWatch resources and `dynamodb:UpdateContinuousBackups` must be verified during deployment; the template does not grant the operator additional account permissions.

## Reproduce the setup

Work from the reviewed repository checkout. Install `uv`, Python 3.12, Node.js 22 for frontend checks, and a current AWS CLI supporting `aws login` and credential export. Use the team's intended workshop profile and region explicitly. Verify the account in the workshop console before using its ID below; AWS/Kiro student credits are separate from this hosting account. AWS CLI login is local and short lived; repeat it when credentials expire. Keep credentials out of GitHub Actions and committed files.

```sh
aws login --profile caseclimb-workshop --region us-west-2
aws sts get-caller-identity --profile caseclimb-workshop --region us-west-2 --query Account --output text
uv sync --frozen
uv run --frozen pytest -q
node --check frontend/app.js
node --check frontend/video.js
node --check frontend/conversation.js
node --test frontend/*.test.cjs
uv run python infra/build.py
uv run python infra/deploy.py --profile caseclimb-workshop --expected-account YOUR_VERIFIED_WORKSHOP_ACCOUNT --region us-west-2
```

A local AWS CLI installation may need its full executable path. The deploy script exports official CLI credentials only into process memory, verifies STS account identity, and refuses an account mismatch before creating resources. Do not use an unrelated personal profile. Keep `--stack caseclimb` and the region consistent for subsequent deployments; creating a different stack creates separate storage and allowances.

Optional provider flags are `--model-id` for a successfully probed regional Converse model, `--provider-env /absolute/private/provider.env` for an explicitly provided key file, and `--voice-id` for a verified stock voice. Keys belong in the private file, never command arguments. The template's Bedrock IAM resource supports a direct regional foundation model ID, not a cross-region inference profile. The same configured model can select approved fact IDs and prioritize authored debrief guidance; it cannot generate clinical patient prose. A deployment without provider configuration still supports authored text.

`infra/build.py` exports frozen production dependencies from `uv.lock`, installs Linux ARM64/Python 3.12 binary wheels, and packages backend/frontend and those dependencies. It excludes private originals, credentials, research sources, tests, and the unreviewed backend case example. Host tests do not prove Lambda native imports work; the deployed handler needs a health request. The optional packaged introduction clip is bounded separately by the build script.

`infra/deploy.py` creates/updates a separate artifact stack, uploads a content-hashed archive, then creates/updates the app stack. S3 blocks public access, encrypts at rest, denies insecure transport, and expires build archives after 14 days. Rebuild/reupload an old revision before attempting a rollback after archive expiry. The artifact bucket is retained on stack deletion.

The source-defined `.github/workflows/checks.yml` runs locked backend tests, browser syntax/controller tests, and infrastructure JSON checks with pinned Actions and read-only repository permissions. It contains no AWS keys and does not deploy. A hosted CI run is not established by local checks; inspect the relevant commit's GitHub Actions result before merging. Teammates without upstream write access should use a fork and pull request.

## Access, outputs, and smoke checks

Entrance password, session-signing secret, and faculty/student access values are generated once and saved in ignored `.private/runtime.env` with mode 600. `.private/app-access.md` is the private participant handoff; `.private/deployment.json` records the account, region, package hash, and outputs. Keep the faculty token with reviewers and share only the intended participant values privately. Do not put access values in URLs or public documents.

Secrets enter CloudFormation as NoEcho parameters and server-only Lambda environment values. Authorized Lambda operators can still read environment configuration. The client receives encounter-scoped bearer tokens. The entrance uses a revocable four-hour HttpOnly, Secure, SameSite=Strict cookie; all application assets and APIs require it except the minimal health/auth routes. Faculty and encounter authorization remain separate. Logout revokes the server session. These shared gates are a prototype, not institutional identity or verified faculty authorization.

CloudFormation outputs include `ApiUrl`, `FunctionName`, `TableName`, `LogGroupName`, `DashboardName`, `DashboardUrl`, and four alarm names. Read them from the ignored deployment record or the intended account's stack; output names contain no secrets. To check the intended deployment without exposing credentials, use its verified URL:

```sh
CASECLIMB_API_URL=https://YOUR_API_ID.execute-api.us-west-2.amazonaws.com
curl --fail "${CASECLIMB_API_URL}/health"
curl --silent --output /dev/null --write-out '%{http_code}\n' "${CASECLIMB_API_URL}/api/status"
```

Health should return `{"status":"ok"}`; unauthenticated status should return 401 when the required app gate is configured. Health proves the handler responds, not that storage, providers, or microphone recognition work. In a browser, check the password form, protected assets/API, successful sign-in, logout, and rejection of the previous cookie. After sign-in, inspect `/api/status` and its remaining allowances. Use the original nonclinical conversation demo for a bounded microphone/audio test, with captions and pause/stop controls. Browser speech recognition support and its speech-processing service depend on the browser. The introduction video is a generated clip, not a responsive live avatar.

The same deployment check exercised actual HTTPS opening/reply audio and Bedrock ID selection, confirmed cached replay without extra quota use, and concluded with transcript-only feedback while the clinical library stayed unchanged. This validates the bounded server/provider path; it does not establish browser microphone compatibility or responsive live video.

Test Studio authorization, revision conflicts, stored state, the 600-second deadline, encounter-token isolation, a synthetic provider reply, and ended-session refusal before a demonstration. Clinical practice still requires the student code and a published reviewer-attested case version. Imported/sample drafts must remain unpublished until an actual qualified reviewer checks content, disclosure, objectives, and teaching permissions. The nonclinical demo is separate and returns transcript-only feedback without a clinical grade or numeric rapport score.

## Monitoring and operating limits

The dashboard uses service-provided metrics and five-minute display periods. Metric names/dimensions were checked against official AWS documentation on 2026-10-10:

| Service | Metrics/statistic | Dimensions |
| --- | --- | --- |
| `AWS/Lambda` | `Errors`, `Throttles`: Sum; `Duration`: p95 milliseconds | `FunctionName` |
| `AWS/ApiGateway` HTTP API | `Count`, lowercase `5xx`: Sum; `Latency`, `IntegrationLatency`: p95 milliseconds | `ApiId`, `Stage=$default` |
| `AWS/DynamoDB` | `ReadThrottleEvents`, `WriteThrottleEvents`: Sum | `TableName` |

The HTTP API uses its own `5xx` metric, rather than the REST API name. API/stage metrics need no paid route-level detailed metrics. Lambda runtime errors differ from application HTTP 5xx responses, so both are shown. DynamoDB throttle events count table events; this table has no global secondary indexes. Missing error/throttle series can be normal when idle. Allow metric publication time after traffic before judging a blank chart. See [HTTP API metrics](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-metrics.html), [Lambda metric types](https://docs.aws.amazon.com/lambda/latest/dg/monitoring-metrics-types.html), and [DynamoDB metrics/dimensions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/metrics-dimensions.html).

Four standard-resolution alarms evaluate one five-minute window: Lambda errors >=1, Lambda throttles >=1, HTTP API server errors >=3, and the sum of table read/write throttle events >=1. Missing data is treated as nonbreaching. All alarm actions are disabled; no email, SNS subscriptions, messages, or automated remediation are configured. An operator must inspect the console. An alarm's OK state does not validate security, clinical correctness, or provider billing. Request text and authorization headers are not deliberately logged; keep log inspection private.

The stack allows 200 sessions, 300 Bedrock attempts, and 5,000 TTS characters through atomic lifetime quotas. Unsuccessful reserved calls count. Quotas survive ordinary redeployments and have no TTL. Exhausted providers fall back to authored feedback/text/captions. These are usage caps, not currency budgets. The scoped ElevenLabs key has an independent credit limit; characters and credits are different units. Creator subscription credit/minute entitlements, key permission/credit allowance, and the workshop AWS account have separate expiry/renewal rules. Check their actual dashboards before increasing any allowance; no provider-plan upgrade is part of this setup.

One dashboard, four alarms, PITR storage, and log storage can add small charges to this prototype; free-tier/credit eligibility depends on the account and region. Retained resources can continue to incur charges after stack deletion. No high-resolution metrics, route-level detailed metrics, anomaly detection, or notification services are enabled. Review [CloudWatch pricing](https://aws.amazon.com/cloudwatch/pricing/) and [DynamoDB PITR behavior/pricing basis](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/PointInTimeRecovery_Howitworks.html) against the account's remaining credits.

## Backup, recovery, expiry, and teardown

DynamoDB PITR is explicitly enabled with a **seven-day recovery window**. Encounters, audio, and access sessions still have their individual TTL/application expiry rules; encounter/audio TTL timestamps are 24 hours after launch, while provider quotas and published cases do not expire. TTL deletion is asynchronous. The 600-second encounter deadline and four-hour entrance expiry are enforced independently by the application. A seven-day backup window can retain earlier table contents after live-item TTL deletion, so live TTL is not a promise that all backup copies disappear after 24 hours. Local JSON storage has no automatic expiry. Confirm institutional retention before a pilot.

`DeletionPolicy: Retain` and `UpdateReplacePolicy: Retain` protect the table from stack deletion/replacement. They do not prevent authorized manual table deletion and do not make an application-wide backup. PITR includes all table records, including case drafts, transcript/audio payloads, access records, and usage counters. Credentials, application code, CloudFormation definitions, and provider configuration require separate private/source handoff. Restoring old session/authentication state needs operator review and secret/session invalidation before reopening access.

Confirm `PointInTimeRecoveryStatus=ENABLED`, `RecoveryPeriodInDays=7`, and the actual earliest/latest restorable timestamps in the intended account after deployment. Recovery only covers available backups since enablement; AWS's latest restore point typically trails current time. PITR restores into a **new table**. Validate its data, then deliberately configure application table access and restore TTL, PITR, IAM scope, monitoring, and other required settings before routing users to it. The deploy script does not automatically attach a restored or retained table. See [PITR configuration](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-dynamodb-table-pointintimerecoveryspecification.html) and [restore steps/settings](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/PointInTimeRecovery.Tutorial.html).

Before workshop access ends, export portable source and only the required synthetic case state privately. A logical faculty-case export is narrower than a full table export. Native [DynamoDB export to private S3](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/S3DataExport_Requesting.html) is available with PITR and appropriate operator/S3 permissions, but is not scheduled by this stack and may include sensitive access/transcript records. Do not publish raw exports or use the 14-day artifact bucket as an assumed long-term backup. Test any selected recovery/export before relying on it.

The event account's exact expiry/timezone must be confirmed with organizers; a retained table does not guarantee access after the workshop expires. Save the approved source revision, dependency lock, template, private configuration handoff, and any authorized portable state before that deadline. Pause paid providers by clearing their configuration in a deliberate redeployment while preserving case storage; provider keys already retained in `.private/runtime.env` must also be removed privately if disabling them. Omitting `--provider-env` alone does not clear a previously saved key.

Destructive cleanup is a separate explicit action. First confirm backup/export and the account/region, then remove the app stack only when authorized. Its Lambda/API/dashboard/alarms/log group are deleted; its retained DynamoDB table remains detached and continues its TTL/PITR behavior. The artifact stack retains its private S3 bucket. Inventory those retained resources, exports, backups, and provider credentials separately before authorized deletion; stack deletion is not complete data erasure. Retained table/storage/PITR charges can continue, and a fresh stack will create a different table. Do not reset usage caps by recreating storage during a running workshop.

Future setup should follow a concrete requirement: institutional identity for a real cohort, private object storage if media outgrows the bounded prototype, a persistent streaming adapter if native ElevenLabs Agents replaces browser turn-taking, and reviewed capacity/retention rules before clinical use. These are roadmap decisions, not deployed services or approved clinical validation.
