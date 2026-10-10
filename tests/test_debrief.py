import copy
import json
from pathlib import Path

import pytest

from backend.debrief import BedrockDebriefSelector, enrich_feedback, strict_json_object
from backend.engine import feedback
from backend.models import CaseDraft


def case_and_encounter():
    case = CaseDraft.model_validate(json.loads((Path(__file__).parent.parent / "backend/demo-case.json").read_text()))
    encounter = {"disclosed_fact_ids": ["concern"], "initial_rapport": 30, "simulated_mood": {"rapport": 30},
                 "events": [{"id": "e0", "actor": "patient", "text": case.opening, "disclosed_fact_ids": ["concern"]},
                            {"id": "e1", "actor": "learner", "text": "Hello."}]}
    return case, encounter


class Quota:
    def __init__(self, available=True):
        self.available, self.calls = available, []

    def reserve(self, name):
        self.calls.append(name)
        return self.available


class Client:
    def __init__(self, answer):
        self.answer, self.calls = answer, []

    def converse(self, **kwargs):
        self.calls.append(kwargs)
        return {"output": {"message": {"content": [{"text": self.answer}]}}}


def selection(**changes):
    priority = {"objective_id": "clarify_routine", "focus": "missed_follow_up", "evidence_event_ids": ["e0"]}
    priority.update(changes)
    return json.dumps({"priorities": [priority]})


@pytest.mark.parametrize("fence", [False, True])
def test_nova_selection_renders_authored_text_and_preserves_assessment(fence):
    case, encounter = case_and_encounter()
    authored = feedback(case, encounter)
    original = copy.deepcopy(authored)
    answer = selection()
    client = Client("```json\n" + answer + "\n```" if fence else answer)
    quota = Quota()
    enriched = enrich_feedback(case, encounter, authored, BedrockDebriefSelector(client=client), quota)
    block = enriched["critical_thinking_debrief"]
    assert block["provider"] == "bedrock_selection"
    assert block["priorities"][0]["objective_id"] == "clarify_routine"
    objective = next(o for o in case.objectives if o.id == "clarify_routine")
    assert block["priorities"][0]["guidance"] == objective.guidance
    assert block["priorities"][0]["next_question"] == objective.next_question
    assert block["priorities"][0]["evidence"][0]["text"] == encounter["events"][0]["text"][:250]
    assert authored == original and enriched["assessments"] == original["assessments"]
    assert quota.calls == ["bedrock"] and len(client.calls) == 1
    assert client.calls[0]["modelId"] == "amazon.nova-lite-v1:0"
    assert client.calls[0]["inferenceConfig"]["maxTokens"] == 384
    assert "untrusted" in client.calls[0]["system"][0]["text"]


@pytest.mark.parametrize("answer", [
    selection(objective_id="invented"),
    selection(evidence_event_ids=["not_in_ledger"]),
    selection(evidence_event_ids=["e1"]),  # not evidence of this objective's cue
    selection(focus="diagnose_cancer"),
    selection(focus="clarify_available_inconsistency"),  # not authored for this objective
    selection(clinical_text="UNAPPROVED CLINICAL PROSE"),
    '{"priorities": [], "score": 99}',
    '{"priorities": []}',
    "Explanation\n```json\n" + selection() + "\n```",
    "```json\n" + selection() + "\n```\nExplanation",
    "not JSON",
])
def test_unapproved_output_falls_back_without_exposing_model_text(answer):
    case, encounter = case_and_encounter()
    client = Client(answer)
    result = enrich_feedback(case, encounter, feedback(case, encounter), BedrockDebriefSelector(client=client), Quota())
    assert result["critical_thinking_debrief"]["provider"] == "authored_provider_fallback"
    assert result["critical_thinking_debrief"]["priorities"]
    assert "UNAPPROVED CLINICAL PROSE" not in json.dumps(result)
    assert "raw_response" not in result["critical_thinking_debrief"]


def test_hidden_objective_and_partially_available_cues_are_not_candidates():
    case, encounter = case_and_encounter()
    objective = next(o for o in case.objectives if o.id == "clarify_routine")
    objective.opportunity_fact_ids = ["concern", "unknown_lab"]
    authored = feedback(case, encounter)
    authored["assessments"] = [a for a in authored["assessments"] if a["objective_id"] == objective.id]
    # Defense in depth even if an upstream assessment wrongly labels it missed.
    authored["assessments"][0]["result"] = "missed"
    quota, client = Quota(), Client(selection())
    result = enrich_feedback(case, encounter, authored, BedrockDebriefSelector(client=client), quota)
    assert result["critical_thinking_debrief"]["priorities"] == []
    assert quota.calls == [] and client.calls == []
    authored["assessments"][0]["result"] = "not_assessable"
    assert enrich_feedback(case, encounter, authored)["critical_thinking_debrief"]["priorities"] == []


def test_released_cue_without_ledger_evidence_is_not_judged_available():
    case, encounter = case_and_encounter()
    encounter["events"][0]["disclosed_fact_ids"] = []
    authored = feedback(case, encounter)
    result = enrich_feedback(case, encounter, authored)
    assert "clarify_routine" not in [p["objective_id"] for p in result["critical_thinking_debrief"]["priorities"]]


@pytest.mark.parametrize("available", [False, None])
def test_exhausted_or_missing_quota_never_calls_provider(available):
    case, encounter = case_and_encounter()
    quota = Quota(False) if available is False else None
    client = Client(selection())
    result = enrich_feedback(case, encounter, feedback(case, encounter), BedrockDebriefSelector(client=client), quota)
    assert result["critical_thinking_debrief"]["provider"] == "authored_budget_fallback"
    assert client.calls == []


def test_provider_exception_and_injected_selector_cannot_leak_or_expand():
    case, encounter = case_and_encounter()
    class BrokenClient:
        def converse(self, **kwargs):
            raise RuntimeError("secret-account-detail")
    result = enrich_feedback(case, encounter, feedback(case, encounter), BedrockDebriefSelector(client=BrokenClient()), Quota())
    assert result["critical_thinking_debrief"]["provider"] == "authored_provider_fallback"
    assert "secret-account-detail" not in json.dumps(result)
    class InjectedSelector:
        def choose(self, context):
            return [{"objective_id": "invented", "focus": "missed_follow_up", "evidence_event_ids": ["e0"]}], "bedrock_selection"
    result = enrich_feedback(case, encounter, feedback(case, encounter), InjectedSelector(), Quota())
    assert result["critical_thinking_debrief"]["provider"] == "authored_provider_fallback"
    assert "invented" not in json.dumps(result)


def test_inconsistency_focus_needs_authored_two_cues_both_disclosed():
    case, encounter = case_and_encounter()
    objective = next(o for o in case.objectives if o.id == "clarify_routine")
    # Supports the optional typed field while remaining compatible during integration.
    object.__setattr__(objective, "debrief_focus", "clarify_available_inconsistency")
    objective.opportunity_fact_ids = ["concern", "routine"]
    encounter["disclosed_fact_ids"].append("routine")
    encounter["events"].append({"id": "e2", "actor": "patient", "text": "An independently authored second cue.", "disclosed_fact_ids": ["routine"]})
    client = Client(selection(focus="clarify_available_inconsistency", evidence_event_ids=["e0", "e2"]))
    result = enrich_feedback(case, encounter, feedback(case, encounter), BedrockDebriefSelector(client=client), Quota())
    assert result["critical_thinking_debrief"]["provider"] == "bedrock_selection"
    assert result["critical_thinking_debrief"]["priorities"][0]["focus"] == "clarify_available_inconsistency"
    objective.opportunity_fact_ids = ["concern"]
    result = enrich_feedback(case, encounter, feedback(case, encounter))
    assert "clarify_routine" not in [p["objective_id"] for p in result["critical_thinking_debrief"]["priorities"]]


@pytest.mark.parametrize("focus", ["acknowledge_emotion", "summarize_next_step"])
def test_other_focuses_must_be_authored_before_selection(focus):
    case, encounter = case_and_encounter()
    objective = next(o for o in case.objectives if o.id == "clarify_routine")
    object.__setattr__(objective, "debrief_focus", focus)
    client = Client(selection(focus=focus))
    result = enrich_feedback(case, encounter, feedback(case, encounter), BedrockDebriefSelector(client=client), Quota())
    assert result["critical_thinking_debrief"]["provider"] == "bedrock_selection"
    assert result["critical_thinking_debrief"]["priorities"][0]["focus"] == focus


@pytest.mark.parametrize("text", ['{"a":1,"a":2}', '{"a":NaN}', '["array"]', '```python\n{}\n```', '{}' * 5000])
def test_shared_parser_is_strict_and_bounded(text):
    with pytest.raises((ValueError, json.JSONDecodeError)):
        strict_json_object(text)
