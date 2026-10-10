"""Model access. Everything else in the package talks to the `LLM` protocol."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Protocol

# The best Claude model the challenge's workshop AWS accounts are allowed to call.
DEFAULT_MODEL = "us.anthropic.claude-sonnet-5"
DEFAULT_CLIENT = "runtime"
DEFAULT_REGION = "us-east-1"


class LLMError(RuntimeError):
    pass


class LLM(Protocol):
    model: str

    def complete_json(self, system: str, user: str, schema: dict) -> dict: ...

    def complete_text(self, system: str, messages: list[dict]) -> str: ...


class BedrockLLM:
    """Claude on Amazon Bedrock.

    Credentials come from the usual AWS chain (env vars, profile, role).
    Environment overrides: CASECLIMB_GRADER_MODEL for the model id,
    AWS_REGION or AWS_DEFAULT_REGION for the region, and
    CASECLIMB_BEDROCK_CLIENT for the endpoint: "runtime" (default), which
    takes inference-profile ids such as "us.anthropic.claude-sonnet-5", or
    "mantle" for the newer endpoint, which takes ids such as
    "anthropic.claude-opus-5-5". The model must support adaptive thinking
    (Claude Sonnet 4.6 or later); scripts/check_bedrock.py shows what an
    account allows.
    """

    def __init__(
        self,
        model: str | None = None,
        region: str | None = None,
        effort: str = "high",
        client: str | None = None,
    ):
        from anthropic import AnthropicBedrock, AnthropicBedrockMantle

        self.model = model or os.environ.get("CASECLIMB_GRADER_MODEL", DEFAULT_MODEL)
        self.effort = effort
        kind = client or os.environ.get("CASECLIMB_BEDROCK_CLIENT", DEFAULT_CLIENT)
        if kind not in ("mantle", "runtime"):
            raise ValueError(f"Unknown Bedrock client {kind!r}; use 'mantle' or 'runtime'")
        make = AnthropicBedrockMantle if kind == "mantle" else AnthropicBedrock
        self._client = make(
            aws_region=region
            or os.environ.get("AWS_REGION")
            or os.environ.get("AWS_DEFAULT_REGION")
            or DEFAULT_REGION
        )

    def _final_text(self, **request) -> str:
        with self._client.messages.stream(
            model=self.model, thinking={"type": "adaptive"}, **request
        ) as stream:
            message = stream.get_final_message()
        if message.stop_reason == "refusal":
            raise LLMError("The model declined this request")
        if message.stop_reason == "max_tokens":
            raise LLMError("The model ran out of output tokens before finishing")
        return next(b.text for b in message.content if b.type == "text")

    def complete_json(self, system: str, user: str, schema: dict) -> dict:
        text = self._final_text(
            max_tokens=32000,
            system=system,
            messages=[{"role": "user", "content": user}],
            output_config={
                "effort": self.effort,
                "format": {"type": "json_schema", "schema": schema},
            },
        )
        return json.loads(text)

    def complete_text(self, system: str, messages: list[dict]) -> str:
        return self._final_text(
            max_tokens=4000,
            system=system,
            messages=messages,
            output_config={"effort": "medium"},
        ).strip()


class ReplayLLM:
    """Returns a saved grader response instead of calling a model.

    Lets the rest of the stack be built and demoed without AWS credentials.
    """

    def __init__(self, grade_path: str | Path, debrief_lines: list[str] | None = None):
        self.model = f"replay:{Path(grade_path).name}"
        self._grade_path = Path(grade_path)
        self._debrief_lines = list(debrief_lines or [])

    def complete_json(self, system: str, user: str, schema: dict) -> dict:
        with open(self._grade_path, encoding="utf-8") as f:
            return json.load(f)

    def complete_text(self, system: str, messages: list[dict]) -> str:
        if self._debrief_lines:
            return self._debrief_lines.pop(0)
        return "(replay mode: no further debrief lines were recorded)"
