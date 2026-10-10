import copy
import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

from evaluator import evaluate_episode, load_rubric
from evaluator.analysis import analyze, pick_graded_participant
from evaluator.app_bridge import episode_from_encounter, record_from_case
from evaluator.evaluate import validate

APP = Path(__file__).parent.parent / "examples" / "app"
NOW = datetime(2026, 10, 10, 17, 0, tzinfo=timezone.utc)


@pytest.fixture
def case():
    # The app's own demo case (main: backend/demo-case.json).
    return json.loads((APP / "demo_case.json").read_text())


@pytest.fixture
def encounter():
    # Produced by running the app's engine.reply on the demo case.
    return json.loads((APP / "demo_encounter.json").read_text())


@pytest.fixture
def record(case):
    return record_from_case(case, case_id="case-demo", version=1, published_at=NOW)


@pytest.fixture
def episode(encounter, case):
    return episode_from_encounter(encounter, case, student_id="u.jo", student_name="Jo")


class FakeLLM:
    model = "fake"

    def __init__(self, grade):
        self.grade = grade

    def complete_json(self, system, user, schema):
        return copy.deepcopy(self.grade)


def ev(turn_id, quote):
    return {"turn_id": turn_id, "quote": quote, "location": ""}


def test_converted_documents_match_the_schemas(record, episode):
    validate(record, "patient_record")
    validate(episode, "episode")


def test_release_rules_carry_over(record):
    facts = {f["fact_id"]: f for f in record["clinical_facts"]}
    assert facts["concern"]["disclosure"]["release"] == "at_start"
    assert facts["routine"]["disclosure"] == {
        "channel": "both",
        "release": "after_fact",
        "trigger_topics": ["medication", "medications", "medicine", "medicines", "routine", "doses"],
        "requires_fact_ids": ["concern"],
    }
    assert facts["unknown_lab"]["disclosure"]["release"] == "when_asked"
    assert facts["unknown_lab"]["patient_knows"] is False
    assert facts["unknown_lab"]["value"].endswith("(unknown)")


def test_withheld_fact_becomes_a_discrepancy(record):
    (d,) = record["discrepancies"]
    assert d["discrepancy_id"] == "routine-withheld"
    assert d["patient_claim"] == "I think I've been following the routine."
    assert d["contradicting_fact_ids"] == ["routine"]


def test_objectives_keep_required_facts(record):
    objectives = {o["objective_id"]: o for o in record["learning_objectives"]}
    assert objectives["clarify_routine"]["critical_fact_ids"] == ["routine"]
    assert objectives["clarify_routine"]["description"].startswith("Clarify the medication routine respectfully.")


def test_event_log_drives_findings(record, episode):
    graded = pick_graded_participant(episode)
    findings = analyze(record, episode, graded)

    assert graded["participant_id"] == "student"
    # The opening concern was released at start, so it is not credited.
    assert findings["elicited_fact_ids"] == ["routine", "unknown_lab"]
    assert findings["missed_fact_ids"] == []
    assert findings["discrepancies"][0]["contradiction_was_visible"] is True
    assert findings["duration_seconds"] == 200
    assert findings["student_turn_count"] == 4


def test_disclosures_point_at_the_patient_turn(episode):
    by_item = {d["item_id"]: d for d in episode["disclosures"]}
    assert by_item["routine"]["turn_id"] == "e6"
    assert by_item["routine"]["trigger"].startswith("Asked: I understand.")
    assert by_item["unknown_lab"]["channel"] == "chart"
    assert by_item["instruction_note"] == {
        "item_id": "instruction_note",
        "item_type": "artifact",
        "channel": "chart",
        "turn_id": "e0",
        "trigger": "Released at start",
    }


def test_active_encounter_cannot_be_graded(record, encounter, case):
    encounter = {**encounter, "status": "active"}
    encounter.pop("ended_at")
    episode = episode_from_encounter(encounter, case)
    assert episode["status"] == "in_progress"
    with pytest.raises(ValueError, match="still in progress"):
        evaluate_episode(record, episode, FakeLLM({}), now=NOW)


def test_app_encounter_grades_end_to_end(record, episode):
    domains = [d["domain_id"] for d in load_rubric()["domains"]]
    clarify = ev("e5", "Could you walk me through your medication routine yesterday?")
    raw = {
        "domain_scores": [
            {"domain_id": d, "score": "3", "rationale": "Adequate.", "evidence": [clarify]} for d in domains
        ],
        "written_evidence": {
            "strength": {"text": "Concrete, nonjudgmental clarification.", "evidence": [clarify]},
            "important_gap": {"text": "Closed adherence question first.", "evidence": [ev("e3", "Are you taking your medication as prescribed?")]},
            "safety_or_accuracy_concern": {"present": False, "text": "", "evidence": []},
        },
        "objective_results": [
            {"objective_id": "clarify_routine", "result": "met", "evidence": [clarify], "feedback": "Good."},
            {"objective_id": "explore_concern", "result": "partially_met",
             "evidence": [ev("e1", "I said something the student never said")], "feedback": "Ok."},
        ],
        "behaviors": [],
        "discrepancy_findings": [
            {"discrepancy_id": "routine-withheld", "outcome": "uncovered", "evidence": [clarify], "feedback": "Uncovered."}
        ],
        "under_probing": [],
        "checklist_results": [],
        "goal_progress": [],
        "strengths": ["Respectful clarification"],
        "improvements": ["Open with a broad question"],
        "next_attempt_suggestions": ["Ask what worries them most before asking about medicines"],
        "debrief_questions": [],
    }

    result = evaluate_episode(record, episode, FakeLLM(raw), now=NOW)
    graded = result.graded_episode(episode)

    validate(graded, "episode")
    assert result.evaluation["rubric"]["total"] == 21
    objectives = {o["objective_id"]: o for o in graded["grading"]["objective_results"]}
    assert objectives["clarify_routine"]["result"] == "met"
    # A quote that is not in the cited turn is dropped; the turn reference stays.
    assert objectives["explore_concern"]["evidence"] == [{"turn_id": "e1"}]
