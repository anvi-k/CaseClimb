"""Find out which Claude models this AWS account may call, and how.

For every Anthropic inference profile the account lists, sends a tiny plain
request. For each one that answers, also checks the two features the grader
uses: JSON-schema output, and adaptive thinking with an effort level.
Prints no credentials.
"""

import os

import boto3
from anthropic import AnthropicBedrock

REGION = os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION") or "us-east-1"
ASK = [{"role": "user", "content": "Reply with ok set to true."}]
FORMAT = {
    "type": "json_schema",
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["ok"],
        "properties": {"ok": {"type": "boolean"}},
    },
}
CHECKS = {
    "plain": {},
    "json_schema": {"output_config": {"format": FORMAT}},
    "thinking+effort": {
        "thinking": {"type": "adaptive"},
        "output_config": {"effort": "low", "format": FORMAT},
    },
}


def attempt(client, model: str, extra: dict) -> str | None:
    """None when the call works, otherwise a short reason."""
    try:
        with client.messages.stream(model=model, max_tokens=2000, messages=ASK, **extra) as stream:
            stream.get_final_message()
        return None
    except Exception as error:  # every failure is a result here
        text = str(error)
        if "not authorized" in text or "access is denied" in text.lower():
            return "not allowed for this account"
        return f"{getattr(error, 'status_code', '')} {text[:200]}"


profiles = sorted(
    p["inferenceProfileId"]
    for p in boto3.client("bedrock", region_name=REGION).list_inference_profiles(maxResults=1000)[
        "inferenceProfileSummaries"
    ]
    if "anthropic" in p["inferenceProfileId"]
)
client = AnthropicBedrock(aws_region=REGION, max_retries=0)
print(f"region: {REGION}, {len(profiles)} profiles")

usable = []
for model in profiles:
    problem = attempt(client, model, CHECKS["plain"])
    print(f"{model:48} {'WORKS' if problem is None else problem}")
    if problem is None:
        usable.append(model)

print("\nfeatures on the models that work:")
for model in usable:
    for name in ("json_schema", "thinking+effort"):
        problem = attempt(client, model, CHECKS[name])
        print(f"{model:48} {name:16} {'WORKS' if problem is None else problem}")
if not usable:
    print("(none worked)")
