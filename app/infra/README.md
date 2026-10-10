# Infrastructure

The app runs as one Node process on a single EC2 instance behind CloudFront. These are the files
used to stand it up with the AWS CLI; nothing here is run by the application.

| File | What it is |
|---|---|
| `provision.sh` | The CLI commands, in order: IAM role and instance profile, key pair, security group, instance, Elastic IP, CloudFront distribution. |
| `userdata.sh` | Instance bootstrap: installs Node, writes the environment file, the systemd service, and the deploy timer. Replace the two `<generate: ...>` placeholders before use. |
| `ec2-trust-policy.json` | Trust policy for the instance role. |
| `cloudfront.json` | Distribution config: HTTPS at the edge, no caching, all methods, origin = the instance on port 3000 with a 60 s read timeout. Replace the origin domain with your instance's public DNS name. |

## How deploys work

`userdata.sh` installs `/opt/rounds/deploy.sh` and a systemd timer that runs it every minute. The
script compares `main` on GitHub with the running commit; on a change it clones into
`/opt/rounds/releases/<sha>`, runs `npm ci` and `npm run build`, repoints `/opt/rounds/current` and
restarts the service. A failed build is recorded and skipped, leaving the previous release running.
The SQLite database and uploads live outside the release directories (`/var/lib/rounds`).

The instance role grants Bedrock, Polly and SSM access, so no AWS keys are stored on the server.
`GET /api/health` reports the running commit.
