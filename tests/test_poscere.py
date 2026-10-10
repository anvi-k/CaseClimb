import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

from evaluator.evaluate import validate
from evaluator.poscere import episode_from_visit, grade_visit, main, record_from_case
from evaluator.rubric import normalize_rubric

BUNDLE = Path(__file__).parent.parent / "examples" / "poscere" / "visit_bundle.json"
NOW = datetime(2026, 10, 10, 22, 0, tzinfo=timezone.utc)


@pytest.fixture
def bundle():
    # A seed case from the app with a hand-written visit in the app's stored shapes.
    return json.loads(BUNDLE.read_text())


def ev(turn_id, quote, location=""):
    return {"turn_id": turn_id, "quote": quote, "location": location}


class Grader:
    """Replies with a valid grade for whatever case and rubric the schema was built from."""

    model = "fake"

    def complete_json(self, system, user, schema):
        self.prompt = user
        ids = lambda key, field: schema["properties"][key]["items"]["properties"][field].get("enum", [])
        told = ev("T3-student", "You'll need to start metformin.")
        return {
            "domain_scores": [
                {"domain_id": d, "score": "1" if i == 5 else "2", "rationale": f"Reason {i}.", "evidence": [told]}
                for i, d in enumerate(ids("domain_scores", "domain_id"))
            ],
            "written_evidence": {
                "strength": {"text": "You opened with an open question.", "evidence": [ev("T1-student", "how have you been feeling?")]},
                "important_gap": {
                    "text": "Your write-up says she is adherent to follow-up; the chart says otherwise.",
                    "evidence": [ev("", "She is adherent to follow-up.", "write_up.assessment"), ev("", "not what was written", "write_up.plan")],
                },
                "safety_or_accuracy_concern": {"present": True, "text": "Her fear went unanswered.", "evidence": [ev("T4-student", "Metformin is very safe.")]},
            },
            "objective_results": [
                {"objective_id": o, "result": "met" if o == "o5" else "not_met", "evidence": [], "feedback": f"About {o}."}
                for o in ids("objective_results", "objective_id")
            ],
            "behaviors": [
                {"behavior": "open_ended_opening", "category": "interview_structure", "observed": True, "evidence": [], "feedback": "Open start."},
                {"behavior": "empathic_response", "category": "empathy", "observed": False, "evidence": [], "feedback": "Fear not acknowledged."},
            ],
            "discrepancy_findings": [
                {"discrepancy_id": "m1", "outcome": "accepted_without_challenge", "evidence": [], "feedback": "Taken at face value."},
                {"discrepancy_id": "m2", "outcome": "not_raised", "evidence": [], "feedback": "Never came up."},
            ],
            "under_probing": [{"topic": "Shift drinks", "why_it_mattered": "Main sugar source.", "related_fact_ids": ["f8", "nope"], "evidence": []}],
            "checklist_results": [],
            "goal_progress": [],
            "strengths": ["Clear introduction."],
            "improvements": ["Respond to fear."],
            "next_attempt_suggestions": ["Ask what a shift looks like."],
            "debrief_questions": [{"question": "What did you notice at T3?", "evidence": [ev("T3-patient", "it scares me to death")]}],
        }


def test_case_and_visit_convert_to_valid_documents(bundle):
    record, episode = record_from_case(bundle), episode_from_visit(bundle)
    validate(record, "patient_record")
    validate(episode, "episode")

    facts = {f["fact_id"]: f for f in record["clinical_facts"]}
    assert facts["f8"]["label"] == "shift drinks" and facts["f8"]["disclosure"]["release"] == "when_asked"
    # Exams and orders become chart facts earned by ordering.
    assert facts["a2"]["disclosure"] == {"channel": "chart", "release": "when_ordered", "trigger_topics": ["lab (importance: critical)"]}
    assert record["learning_objectives"][0]["critical_fact_ids"] == ["f2", "f4", "f5", "f6", "a2", "a3", "a6"]
    assert [d["contradicting_fact_ids"] for d in record["discrepancies"]] == [["d5"], ["d2"]]
    assert record["knowledge_sources"][0]["notes"].startswith("Primary problem:")

    assert episode["status"] == "completed" and episode["ended_at"] == "2026-10-10T21:07:10Z"
    assert [t["turn_id"] for t in episode["turns"]][:5] == ["T1-student", "T1-patient", "T2-student", "T2-chart", "T2-patient"]
    scared = episode["turns"][6]["avatar"]
    assert scared == {"emotion": "fearful", "gestures": ["scared", "comfort 48/100 (-4)"]}
    by_item = {d["item_id"]: d for d in episode["disclosures"]}
    assert by_item["f6"]["turn_id"] == "T3-patient" and by_item["a2"]["turn_id"] == "T2-chart"
    assert by_item["d5"]["item_type"] == "artifact"


def test_facts_known_from_an_earlier_visit_are_not_credited(bundle):
    bundle["state"]["disclosed"]["f9"] = {"turn": 0, "how": "record"}
    record = record_from_case(bundle)
    f9 = next(f for f in record["clinical_facts"] if f["fact_id"] == "f9")
    assert f9["disclosure"]["release"] == "at_start"
    validate(episode_from_visit(bundle), "episode")


def test_red_herrings_and_variants_follow_the_visit_config(bundle):
    bundle["case"]["facts"].append({"id": "x1", "category": "other", "topic": "t", "chart": "c", "says": "s", "tier": "initial", "importance": "minor", "distractor": True})
    bundle["case"]["variants"] = [{"id": "v1", "label": "l", "description": "d", "approved": True, "factOverrides": {"f8": {"chart": "Drinks only water."}}}]
    bundle["config"]["variantId"] = "v1"
    facts = {f["fact_id"]: f for f in record_from_case(bundle)["clinical_facts"]}
    assert "x1" not in facts and facts["f8"]["value"] == "Drinks only water."


def test_visit_is_graded_into_the_apps_feedback_shape(bundle):
    grader = Grader()
    out = grade_visit(bundle, grader, now=NOW)
    feedback = out["feedback"]
    validate(out["debrief_result"], "debrief_result")

    # The grader saw the answer key, the write-up, the role and the comfort meter.
    for needle in ["Answer key (faculty-approved)", "<student_write_up>", "nurse practitioner student", "comfort 48/100 (-4)"]:
        assert needle in grader.prompt

    assert [d["score"] for d in feedback["domains"]] == [2, 2, 2, 2, 2, 1, 2]
    assert (feedback["total"], feedback["max"], feedback["percent"]) == (13, 28, 46)
    assert feedback["domains"][0]["evidence"] == [{"turn": 3, "quote": "You'll need to start metformin.", "note": ""}]
    assert feedback["needsReview"] is True
    assert feedback["reviewReasons"] == ["Domain 6 (Clinical reasoning and synthesis) scored 1.", "Safety or accuracy concern flagged"]

    # Findings are read from the app's ledger the way its own scorer reads it.
    assert [f["id"] for f in feedback["elicited"]] == ["f1", "f2", "f3", "f5", "f6", "f26"]
    assert feedback["missed"][0]["importance"] == "critical" and feedback["missed"][-1]["importance"] == "minor"
    assert [a["id"] for a in feedback["actionsDone"]] == ["a2", "a3"]
    assert "a8" not in [a["id"] for a in feedback["actionsMissed"]]  # minor

    # o5 names f26 and the chart review a11; a11 was never done, so "met" cannot stand.
    o5 = next(o for o in feedback["objectives"] if o["id"] == "o5")
    assert o5["met"] == "partial"
    assert [m["noticed"] for m in feedback["mismatches"]] == [False, False]
    assert feedback["strengths"][0] == {"text": "You opened with an open question.", "turn": 1}
    assert feedback["safetyConcerns"] == [{"text": "Her fear went unanswered.", "turn": 4}]
    assert feedback["interview"]["questionMix"] == "1 open, 0 focused, 2 closed, 1 leading, 0 multiple"
    assert feedback["debrief"]["questions"] == [{"question": "What did you notice at T3?", "turn": 3}]
    assert feedback["debrief"]["underProbing"][0]["factIds"] == ["f8"]

    # Write-up quotes are checked too: the real one is kept, the invented one loses its quote.
    gap = out["debrief_result"]["written_evidence"]["important_gap"]["evidence"]
    assert gap == [{"location": "write_up.assessment", "quote": "She is adherent to follow-up."}, {"location": "write_up.plan"}]


def test_app_rubric_with_descriptors_is_used(bundle):
    bundle["rubric"] = {
        "id": "custom-1",
        "name": "Two things",
        "type": "domain4",
        "domains": [
            {"key": "listening", "name": "Listening", "descriptors": {"4": "a", "3": "b", "2": "c", "1": "d"}},
            {"key": "safety", "name": "Safety", "descriptors": {"4": "a", "3": "b", "2": "c", "1": "d"}, "reviewIfOne": True},
        ],
    }
    grader = Grader()
    feedback = grade_visit(bundle, grader, now=NOW)["feedback"]
    assert [d["key"] for d in feedback["domains"]] == ["listening", "safety"]
    assert '"descriptors"' in grader.prompt
    assert feedback["max"] == 8


def test_organisers_rubric_file_format_is_accepted():
    raw = {
        "title": "Patient Encounter Performance Rubric",
        "instructions": "Rate only what the scenario makes possible to observe.",
        "rating_scale": [{"score": 4, "label": "Strong"}, {"score": 3, "label": "Competent"}, {"score": 2, "label": "Developing"}, {"score": 1, "label": "Unsafe or absent"}],
        "domains": [
            {"id": 1, "key": "opening_and_purpose", "name": "Opening and purpose", "triggers_review_if_score_1": False, "descriptors": {"4": "w", "3": "x", "2": "y", "1": "z"}},
            {"id": 6, "key": "clinical_reasoning", "name": "Clinical reasoning", "triggers_review_if_score_1": True, "descriptors": {"4": "w", "3": "x", "2": "y", "1": "z"}},
        ],
    }
    rubric = normalize_rubric(raw)
    assert rubric["rubric_id"] == "patient_encounter_performance_rubric"
    assert rubric["scale"]["1"] == "Unsafe or absent"
    assert rubric["domains"][1] == {"number": 6, "domain_id": "clinical_reasoning", "name": "Clinical reasoning", "descriptors": {"4": "w", "3": "x", "2": "y", "1": "z"}}
    assert rubric["teacher_review"] == {"domain_numbers": [6], "at_or_below_score": 1}
    with pytest.raises(ValueError, match="points checklists"):
        normalize_rubric({"id": "peds", "name": "Checklist", "type": "checklist", "items": []})


def test_unfinished_visit_is_refused(bundle):
    bundle["encounter"]["status"] = "active"
    with pytest.raises(ValueError, match="still in progress"):
        grade_visit(bundle, Grader(), now=NOW)


def test_command_reads_a_bundle_and_prints_json(bundle, tmp_path, capsys, monkeypatch):
    saved = tmp_path / "grade.json"
    import evaluator.poscere as module

    class Replay(Grader):
        def __init__(self, path):
            pass

    monkeypatch.setattr(module, "ReplayLLM", Replay)
    assert main(["--bundle", str(BUNDLE), "--replay", str(saved)]) == 0
    printed = json.loads(capsys.readouterr().out)
    assert set(printed) == {"feedback", "debrief_result"}
    assert printed["feedback"]["rubricType"] == "domain4"
