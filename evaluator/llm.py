"""Model access. Everything else in the package talks to the `LLM` protocol."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Protocol

DEFAULT_MODEL = "anthropic.claude-opus-5-5"
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
    Override the model with CASECLIMB_GRADER_MODEL and the region with AWS_REGION.
    """

    def __init__(self, model: str | None = None, region: str | None = None, effort: str = "high"):
        from anthropic import AnthropicBedrockMantle

        self.model = model or os.environ.get("CASECLIMB_GRADER_MODEL", DEFAULT_MODEL)
        self.effort = effort
        self._client = AnthropicBedrockMantle(
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
