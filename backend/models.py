"""Faculty-authored case contract. Unknown and known-negative are explicit."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Fact(StrictModel):
    id: str = Field(min_length=1, max_length=80, pattern=r"^[a-zA-Z0-9_-]+$")
    label: str = Field(min_length=1, max_length=160)
    text: str = Field(min_length=1, max_length=1200)
    state: Literal["known", "known_negative", "unknown"] = "known"
    audience: Literal["patient", "chart", "both"] = "both"
    initially_released: bool = False
    keywords: list[str] = Field(default_factory=list, max_length=30)
    requires: list[str] = Field(default_factory=list, max_length=20)
    patient_answer: str | None = Field(default=None, max_length=1000)
    nondisclosure_answer: str | None = Field(default=None, max_length=1000)
    clarification_keywords: list[str] = Field(default_factory=list, max_length=30)
    source: str = Field(default="Faculty-authored synthetic example", max_length=400)


class Artifact(StrictModel):
    id: str = Field(min_length=1, max_length=80, pattern=r"^[a-zA-Z0-9_-]+$")
    title: str = Field(min_length=1, max_length=160)
    kind: Literal["note", "lab", "image_description", "document"] = "note"
    body: str = Field(min_length=1, max_length=3000)
    metadata: dict[str, str] = Field(default_factory=dict, max_length=10)
    initially_released: bool = False
    keywords: list[str] = Field(default_factory=list, max_length=30)
    requires: list[str] = Field(default_factory=list, max_length=20)
    source: str = Field(default="Faculty-authored synthetic example", max_length=400)


class Objective(StrictModel):
    id: str = Field(min_length=1, max_length=80, pattern=r"^[a-zA-Z0-9_-]+$")
    label: str = Field(min_length=1, max_length=160)
    keywords: list[str] = Field(default_factory=list, max_length=30)
    required_fact_ids: list[str] = Field(default_factory=list, max_length=20)
    opportunity_fact_ids: list[str] = Field(default_factory=list, max_length=20)
    guidance: str = Field(min_length=1, max_length=1000)
    next_question: str = Field(default="Ask a relevant open question and clarify the patient's concerns.", max_length=500)
    debrief_focus: Literal["missed_follow_up", "clarify_available_inconsistency", "acknowledge_emotion", "summarize_next_step"] = "missed_follow_up"


class Behavior(StrictModel):
    mood: Literal["receptive", "guarded", "frustrated", "anxious"] = "guarded"
    initial_rapport: int = Field(default=30, ge=0, le=100)
    supportive_keywords: list[str] = Field(default_factory=lambda: ["understand", "sounds difficult", "concern", "thank you"])
    dismissive_keywords: list[str] = Field(default_factory=lambda: ["just calm down", "you are lying"])
    supportive_response: str = Field(default="Thank you for listening. What would you like to know?", max_length=1000)
    dismissive_response: str = Field(default="That makes me less comfortable talking. Please listen to my concerns.", max_length=1000)


class VoiceDelivery(StrictModel):
    model_id: Literal["eleven_multilingual_v2", "eleven_v4_turbo"] = "eleven_multilingual_v2"
    emotion: Literal["neutral", "worried", "frustrated", "curious", "calm"] = "neutral"
    emotion_source: Literal["faculty", "simulated_mood"] = "faculty"
    stability: float = Field(default=0.5, ge=0, le=1, allow_inf_nan=False)
    similarity_boost: float = Field(default=0.75, ge=0, le=1, allow_inf_nan=False)
    style: float | None = Field(default=None, ge=0, le=1, allow_inf_nan=False)
    speed: float | None = Field(default=None, ge=0.7, le=1.2, allow_inf_nan=False)

    @model_validator(mode="after")
    def compatible_model_settings(self):
        if self.model_id == "eleven_v4_turbo" and (self.style is not None or self.speed is not None):
            raise ValueError("Eleven v4 Turbo supports stability/similarity only; style and speed must be null.")
        return self


class CaseDraft(StrictModel):
    learning_focus: Literal["clinical_history", "communication"] = "clinical_history"
    presentation_key: Literal["clinical", "alex", "maya", "jordan", "evelyn"] = "clinical"
    title: str = Field(min_length=1, max_length=160)
    patient_name: str = Field(min_length=1, max_length=100)
    age: int = Field(ge=0, le=120)
    setting: str = Field(default="Emergency department", max_length=100)
    summary: str = Field(min_length=1, max_length=500, description="Public learner-facing brief; never place hidden answers here.")
    synthetic: Literal[True] = True
    opening: str = Field(min_length=1, max_length=1000)
    fallback_answer: str = Field(default="I'm not sure what you mean. Could you ask about a specific concern?", max_length=1000)
    facts: list[Fact] = Field(default_factory=list, max_length=80)
    artifacts: list[Artifact] = Field(default_factory=list, max_length=20)
    objectives: list[Objective] = Field(default_factory=list, max_length=20)
    behavior: Behavior = Field(default_factory=Behavior)
    voice_id: str | None = Field(default=None, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    voice_delivery: VoiceDelivery = Field(default_factory=VoiceDelivery)
    avatar_id: str | None = Field(default=None, max_length=36, pattern=r"^[a-fA-F0-9-]{36}$")
    author_note: str = Field(default="Draft synthetic teaching case; requires clinical review.", max_length=1000)


class Approval(StrictModel):
    expected_revision: int = Field(ge=1, description="Revision of the exact draft the reviewer inspected.")
    reviewer: str = Field(min_length=1, max_length=160)
    review_note: str = Field(min_length=1, max_length=1000)
    clinical_review_confirmed: Literal[True]
    synthetic_confirmed: Literal[True]


class StartEncounter(StrictModel):
    case_id: str
    version: int | None = Field(default=None, ge=1)
    access_code: str = Field(min_length=1, max_length=500)


class Turn(StrictModel):
    request_id: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    text: str = Field(min_length=1, max_length=2000)
    confirmed: Literal[True] = True


class SpeechRequest(StrictModel):
    event_id: str = Field(min_length=1, max_length=100)


class StreamCancel(StrictModel):
    request_id: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
