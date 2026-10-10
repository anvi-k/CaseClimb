# AWS workshop deployment

The stack serves the web client and FastAPI through Lambda (Python 3.12, Linux ARM64), HTTP API v2, and encrypted DynamoDB. Its runtime role can read/write/scan only its own table, write its own log streams, and optionally invoke the selected regional Bedrock foundation model. API requests are throttled to 5/second with a 10-request burst; Lambda reserves 2 concurrent executions. These are workshop limits, not classroom capacity evidence.

Use an explicitly verified workshop account. Authenticate with AWS CLI 2.36+ using `aws login --profile caseclimb-workshop --region us-west-2`; a local installation may need its full executable path. Do not deploy through an unrelated default personal profile. The deploy command refuses an account mismatch. AWS/Kiro student credits are separate from this hosting account.

```sh
uv sync
uv run pytest -q
uv run python infra/build.py
uv run python infra/deploy.py --profile caseclimb-workshop --expected-account YOUR_WORKSHOP_ACCOUNT --region us-west-2
```

For optional providers, supply `--model-id` only after a successful regional Converse probe, `--provider-env /absolute/private/provider.env` for an explicitly provided key file, and `--voice-id` for a verified stock voice. The current template's Bedrock IAM resource supports a direct regional foundation model ID, not a cross-region inference profile. Keep any additional provider keys in that private file. Never add it to Git.

`infra/build.py` exports frozen production dependencies from `uv.lock`, installs Linux ARM64/Python 3.12 binary wheels, and packages only backend/frontend plus those dependencies. It excludes private originals, research sources, local credentials, tests, and the unreviewed backend example. The deployed handler must be tested on Lambda to verify native imports; passing host tests alone is insufficient.

`infra/deploy.py` uses official CLI credential export in process memory, creates a separate private S3 artifact stack, uploads a content-hashed archive, and creates/updates the app stack. S3 blocks public access, encrypts at rest, denies insecure transport, and expires build archives after 14 days. Rebuild/reupload an old revision before attempting a rollback after archive expiry. CloudFormation retains the artifact bucket on stack deletion; separately inspect it before any cleanup.

Entrance password, session-signing secret, and faculty/student access values are randomly generated once and saved in ignored `.private/runtime.env` with mode 600. The private user handoff is `.private/app-access.md`; the deployment record is `.private/deployment.json`. Both are ignored. The entrance uses a revocable four-hour HttpOnly, Secure, SameSite=Strict cookie; all app assets and APIs require it. Faculty and encounter authorization remain separate. Logout revokes the server session. Secrets enter CloudFormation as NoEcho parameters and server-only Lambda environment values; operators with appropriate Lambda permissions can still read environment configuration. The client receives only encounter-scoped tokens. Do not place any access value in a URL or committed file. These shared gates are a prototype, not institutional identity or verified faculty authorization.

Published cases persist. Encounters and audio have 24-hour DynamoDB TTL timestamps; service deletion is asynchronous. Application deadlines stop new actions at 600 seconds independently of TTL. Logs are retained 7 days; request text/authorization headers are not deliberately logged. Local JSON storage has no automatic expiry. Confirm institutional retention and provider controls before a pilot.

Atomic lifetime quotas prevent a new encounter from resetting provider allowances. The stack allows 200 sessions, 300 Bedrock attempts, and 5,000 TTS characters; unsuccessful reserved calls count. Video has a separate small allowance when configured. Lower the allowance before enabling a smaller provider plan. Quotas remain across redeployments and have no TTL. Exhausted paid services fall back to authored feedback/text/captions. These caps are not a currency budget or a promise about provider billing. The scoped ElevenLabs key has its own 5,000-credit limit; characters and credits are different units.

Verify the password form, rejected unauthenticated asset/API requests, login/logout and cookie revocation, `/api/status`, the authenticated Studio flow, progressive-disclosure/timeout rules, unauthorized responses, deployed storage revisions, and a synthetic provider response after deployment. Student practice requires a reviewer-attested published case. Imported/sample drafts must remain unpublished until an actual qualified reviewer checks content, disclosure, objectives, and teaching permissions. Do not substitute an automated test attestation for clinical review.

This is an event account. Its exact expiry/timezone must be confirmed with the organizers; do not assume the URL persists beyond the workshop. Export portable source and required synthetic state before access ends. Destructive stack/data cleanup is a separate explicit action. Pause paid services by removing their provider configuration without deleting cases.
