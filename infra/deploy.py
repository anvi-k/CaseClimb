"""Deploy the workshop prototype; keep credentials out of arguments and output.

Uses AWS CLI's short-lived login credentials in process memory. No credential
cache or browser session is copied into the repository or deployment package.
"""

import argparse
import hashlib
import json
import os
import secrets
import subprocess
import time
from pathlib import Path

import boto3
from botocore.exceptions import ClientError

ROOT = Path(__file__).resolve().parents[1]


def private_write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as stream:
        stream.write(value)
    os.chmod(path, 0o600)


def read_env(path):
    result = {}
    if path and Path(path).exists():
        for line in Path(path).read_text().splitlines():
            key, sep, value = line.partition("=")
            if sep and not key.startswith("#"):
                result[key.strip()] = value.strip().strip("\"'")
    return result


def session(profile, region):
    # Never forward stdout from this command: it contains short-lived secrets.
    output = subprocess.run(["aws", "configure", "export-credentials", "--profile", profile, "--region", region, "--format", "process"], capture_output=True, text=True, check=True)
    credentials = json.loads(output.stdout)
    return boto3.Session(aws_access_key_id=credentials["AccessKeyId"], aws_secret_access_key=credentials["SecretAccessKey"], aws_session_token=credentials["SessionToken"], region_name=region)


def upsert_stack(cf, name, template, parameters=None, capabilities=None):
    args = {"StackName": name, "TemplateBody": json.dumps(template), "Parameters": parameters or [], "Capabilities": capabilities or [], "Tags": [{"Key": "Project", "Value": "CaseClimb"}, {"Key": "Purpose", "Value": "SyntheticHackathonDemo"}]}
    try:
        prior = cf.describe_stacks(StackName=name)["Stacks"][0]
    except ClientError as exc:
        if "does not exist" not in exc.response["Error"].get("Message", ""):
            raise
        cf.create_stack(**args)
    else:
        if prior["StackStatus"] not in {"CREATE_COMPLETE", "UPDATE_COMPLETE", "UPDATE_ROLLBACK_COMPLETE"}:
            raise RuntimeError(f"Stack requires inspection before update: {prior['StackStatus']}")
        try:
            cf.update_stack(**args)
        except ClientError as exc:
            if "No updates are to be performed" not in exc.response["Error"].get("Message", ""):
                raise
            return prior
    print(f"Waiting for {name}; CloudFormation owns the resources.", flush=True)
    for _ in range(180):
        current = cf.describe_stacks(StackName=name)["Stacks"][0]
        status = current["StackStatus"]
        if status in {"CREATE_COMPLETE", "UPDATE_COMPLETE"}:
            return current
        if "ROLLBACK" in status or status.endswith("FAILED"):
            # Failure reasons can include supplied parameter values: don't print them.
            raise RuntimeError(f"CloudFormation failed ({status}); inspect stack events privately.")
        time.sleep(4)
    raise RuntimeError("Stack is still running; inspect it before another deploy.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", required=True)
    parser.add_argument("--expected-account", required=True, help="Refuse deployment to a different AWS account")
    parser.add_argument("--region", default="us-west-2")
    parser.add_argument("--stack", default="caseclimb")
    parser.add_argument("--provider-env", help="Explicit private env file for ElevenLabs and optional sandbox LiveAvatar keys")
    parser.add_argument("--model-id", default="", help="Verified regional Bedrock Converse model; blank leaves authored engine")
    parser.add_argument("--voice-id", default="")
    parser.add_argument("--enable-stt", action="store_true", help="Enable realtime Scribe only after verifying this key's speech-to-text permission and allowance")
    parser.add_argument("--stt-second-budget", type=int, default=3600, help="Durable lifetime realtime transcription seconds allowance (1-3600; reservations count)")
    args = parser.parse_args()
    if not args.stack.replace("-", "").isalnum() or len(args.stack) > 40:
        parser.error("Use a short alphanumeric/hyphen stack name")
    if not 1 <= args.stt_second_budget <= 3600:
        parser.error("The workshop transcription seconds allowance must be between 1 and 3600")
    aws_session = session(args.profile, args.region)
    identity = aws_session.client("sts").get_caller_identity()
    if identity["Account"] != args.expected_account:
        raise RuntimeError("Account mismatch: refusing to deploy")
    env_file = ROOT / ".private" / "runtime.env"
    runtime = read_env(env_file)
    runtime.setdefault("CASECLIMB_ADMIN_TOKEN", secrets.token_urlsafe(32))
    runtime.setdefault("CASECLIMB_STUDENT_CODE", secrets.token_urlsafe(18))
    runtime.setdefault("CASECLIMB_APP_PASSWORD", secrets.token_urlsafe(18))
    runtime.setdefault("CASECLIMB_SESSION_SECRET", secrets.token_urlsafe(48))
    provider = read_env(args.provider_env)
    if provider.get("ELEVENLABS_API_KEY"):
        runtime["ELEVENLABS_API_KEY"] = provider["ELEVENLABS_API_KEY"]
    if args.enable_stt and not runtime.get("ELEVENLABS_API_KEY"):
        raise RuntimeError("Realtime transcription requires an explicitly configured ElevenLabs key")
    # Video is optional and sandbox-only in this workshop deployment. Never
    # change an existing disabled configuration into billable video implicitly.
    video_key = provider.get("LIVEAVATAR_API_KEY", "")
    video_sandbox = provider.get("CASECLIMB_LIVEAVATAR_SANDBOX", "false")
    if video_key and video_sandbox != "true":
        raise RuntimeError("Workshop deployment only supports explicitly enabled LiveAvatar sandbox")
    video_avatar = "dd73ea75-1218-4ef3-92ce-606d5f7fbc0a" if video_key else ""
    private_write(env_file, "".join(f"{key}={value}\n" for key, value in runtime.items()))
    archive = ROOT / ".private" / "caseclimb-lambda.zip"
    if not archive.exists():
        raise RuntimeError("Run infra/build.py first")
    cf = aws_session.client("cloudformation")
    artifacts = upsert_stack(cf, args.stack + "-artifacts", json.loads((ROOT / "infra" / "artifacts.json").read_text()))
    bucket = next(item["OutputValue"] for item in artifacts["Outputs"] if item["OutputKey"] == "BucketName")
    package_hash = hashlib.sha256(archive.read_bytes()).hexdigest()
    key = f"packages/{package_hash}.zip"
    aws_session.client("s3").upload_file(str(archive), bucket, key, ExtraArgs={"ServerSideEncryption": "AES256"})
    parameters = {"ArtifactBucket": bucket, "ArtifactKey": key, "AdminToken": runtime["CASECLIMB_ADMIN_TOKEN"], "StudentCode": runtime["CASECLIMB_STUDENT_CODE"], "AppPassword": runtime["CASECLIMB_APP_PASSWORD"], "SessionSecret": runtime["CASECLIMB_SESSION_SECRET"], "ElevenLabsKey": runtime.get("ELEVENLABS_API_KEY", ""), "VoiceId": args.voice_id, "BedrockModelId": args.model_id}
    parameters.update(LiveAvatarKey=video_key, LiveAvatarId=video_avatar,
                      LiveAvatarSandbox="true" if video_key else "false")
    parameters.update(SttEnabled="true" if args.enable_stt else "false",
                      SttSecondBudget=str(args.stt_second_budget))
    stack = upsert_stack(cf, args.stack, json.loads((ROOT / "infra" / "stack.json").read_text()), [{"ParameterKey": k, "ParameterValue": v} for k, v in parameters.items()], ["CAPABILITY_IAM"])
    outputs = {item["OutputKey"]: item["OutputValue"] for item in stack["Outputs"]}
    record = {"stack": args.stack, "account": identity["Account"], "region": args.region, "outputs": outputs, "artifact_bucket": bucket, "package_sha256": package_hash, "bedrock_model_id": args.model_id, "elevenlabs_configured": bool(runtime.get("ELEVENLABS_API_KEY")), "deployed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    record["liveavatar_sandbox_configured"] = bool(video_key)
    record["realtime_stt_enabled"] = bool(args.enable_stt)
    record["stt_second_budget"] = args.stt_second_budget
    record["streaming_transport"] = "apigateway-websocket"
    private_write(ROOT / ".private" / "deployment.json", json.dumps(record, indent=2) + "\n")
    private_write(ROOT / ".private" / "app-access.md", f"# CaseClimb private access\n\nLive app: {outputs['ApiUrl']}/web/\n\nShared entrance password: `{runtime['CASECLIMB_APP_PASSWORD']}`\n\nStudent practice code: `{runtime['CASECLIMB_STUDENT_CODE']}`\n\nFaculty Studio access token: `{runtime['CASECLIMB_ADMIN_TOKEN']}`\n\nThese values are private. Share the entrance password and student code only with intended demo participants. Keep the faculty token with case reviewers. This file is ignored by Git.\n")
    print(f"Deployed: {outputs['ApiUrl']}")
    print("Faculty/student access values are saved only in .private/runtime.env (mode600).")


if __name__ == "__main__":
    main()
