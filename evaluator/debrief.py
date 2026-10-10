"""The debrief conversation that follows grading."""

from __future__ import annotations

from . import prompts
from .analysis import applicable_objectives, participants_by_id
from .llm import LLM

_OPENING_CUE = "(The student has joined the debrief. Open it.)"


class DebriefSession:
    """A model-led conversation about one graded encounter.

    The session holds no state beyond `messages`, so a service can store that
    list between requests and rebuild the session with `messages=`.
    """

    def __init__(
        self,
        record: dict,
        episode: dict,
        evaluation: dict,
        llm: LLM,
        messages: list[dict] | None = None,
    ):
        role = participants_by_id(episode)[evaluation["graded_participant_id"]]["role"]
        self._system = prompts.debrief_system_prompt(
            record, episode, evaluation, applicable_objectives(record, role)
        )
        self._llm = llm
        self.messages: list[dict] = list(messages or [])

    def _respond(self) -> str:
        reply = self._llm.complete_text(self._system, self.messages)
        self.messages.append({"role": "assistant", "content": reply})
        return reply

    def open(self) -> str:
        if self.messages:
            raise RuntimeError("Debrief has already started")
        self.messages.append({"role": "user", "content": _OPENING_CUE})
        return self._respond()

    def reply(self, student_message: str) -> str:
        if not self.messages:
            raise RuntimeError("Call open() before reply()")
        self.messages.append({"role": "user", "content": student_message})
        return self._respond()

    @property
    def transcript(self) -> list[dict]:
        """The conversation as the student saw it."""
        return [m for m in self.messages if m["content"] != _OPENING_CUE]
