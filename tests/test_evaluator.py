import copy
import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

from evaluator import DebriefSession, ReplayLLM, evaluate_episode, load_checklist, load_rubric
from evaluator.analysis import analyze, pick_graded_participant, render_transcript
from evaluator.cli import main
from evaluator.evaluate import validate
from evaluator.prompts import grade_schema, grader_user_prompt
from evaluator.rubric import RUBRIC_DIR, summarize_rubric

EXAMPLES = Path(__file__).parent.parent / "examples"
NOW = datetime(2026, 10, 10, 12, 0, tzinfo=timezone.utc)


def load(name):
    return json.loads((EXAMPLES / name).read_text())


@pytest.fixture
def record():
    return load("patient_record.json")


@pytest.fixture
def episode():
    return load("episode.json")


@pytest.fixture
def raw():
    return load("grader_response.json")


class FakeLLM:
    model = "fake"

    def __init__(self, grade=None, lines=()):
        self.grade = grade
        self.lines = list(lines)
        self.calls = []

    def complete_json(self, system, user, schema):
        self.calls.append((system, user, schema))
        return copy.deepcopy(self.grade)

    def complete_text(self, system, messages):
        self.calls.append((system, copy.deepcopy(messages)))
        return self.lines.pop(0)


def grade(record, episode, raw, **kwargs):
    return evaluate_episode(record, episode, FakeLLM(raw), now=NOW, **kwargs)


def test_examples_match_the_schemas(record, episode):
    validate(record, "patient_record")
    validate(episode, "episode")


def test_log_decides_elicited_and_missed(record, episode):
    graded = pick_graded_participant(episode)
    findings = analyze(record, episode, graded)

    assert graded["participant_id"] == "p.sam"
    # Metformin was on the chart from the start, so it was not earned.
    assert findings["elicited_fact_ids"] == ["f.hpi.thirst", "f.sh.diet", "f.lab.hba1c"]
    assert findings["missed_fact_ids"] == ["f.fh.mother", "f.med.refills", "f.med.side_effects"]
    assert findings["discrepancies"][0]["contradiction_was_visible"] is False
    assert findings["duration_seconds"] == 460
    assert findings["over_time_limit"] is False


def test_transcript_carries_turn_ids_and_face_cues(episode):
    lines = render_transcript(episode).splitlines()
    assert lines[0].startswith("[t0] Sam (nurse_practitioner_student): Hi Mrs. Alvarez")
    assert lines[9].endswith("<face: fearful 0.8; wrings hands>")


def test_rubric_total_and_review_flag(record, episode, raw):
    rubric = grade(record, episode, raw).evaluation["rubric"]

    assert [d["score"] for d in rubric["domain_scores"]] == [3, 2, 2, 2, 2, 1, 3]
    assert (rubric["total"], rubric["max_total"]) == (15, 28)
    assert rubric["needs_teacher_review"] is True
    assert rubric["review_reasons"] == ["Domain 6 (Clinical reasoning and synthesis) scored 1."]


def test_review_flag_ignores_a_1_outside_domains_6_and_7():
    rubric = load_rubric()
    scores = [{"number": d["number"], "name": d["name"], "score": 4} for d in rubric["domains"]]
    scores[1]["score"] = 1
    assert summarize_rubric(scores, rubric)["needs_teacher_review"] is False
    scores[6]["score"] = 1
    assert summarize_rubric(scores, rubric)["needs_teacher_review"] is True


def test_na_domains_leave_the_total_and_the_maximum(record, episode, raw):
    raw["domain_scores"][4]["score"] = "NA"
    rubric = grade(record, episode, raw).evaluation["rubric"]

    assert rubric["domain_scores"][4]["score"] is None
    assert rubric["domain_scores"][4]["label"] == "N/A"
    assert (rubric["total"], rubric["max_total"]) == (13, 24)


def test_unscored_domain_goes_to_teacher_review(record, episode, raw):
    raw["domain_scores"] = [d for d in raw["domain_scores"] if d["domain_id"] != "opening_and_purpose"]
    raw["domain_scores"][4]["score"] = "3"  # clear the domain-6 trigger
    rubric = grade(record, episode, raw).evaluation["rubric"]

    assert rubric["domain_scores"][0]["label"] == "Not scored"
    assert rubric["needs_teacher_review"] is True
    assert rubric["review_reasons"] == ["Grader did not score: opening_and_purpose."]


def test_unverifiable_evidence_is_removed(record, episode, raw):
    result = grade(record, episode, raw)
    concern = result.evaluation["rubric"]["written_evidence"]["safety_or_accuracy_concern"]
    noticed = next(b for b in result.grading["behaviors"] if b["behavior"] == "noticed_contradiction")

    # The model wrote "increase the dose"; the student said "raise the dose".
    assert concern["evidence"] == [{"turn_id": "t12"}]
    # t99 does not exist.
    assert noticed["evidence"] == []
    assert result.evaluation["integrity"]["quotes_dropped"] == 1
    assert result.evaluation["integrity"]["evidence_items_dropped"] == 1


def test_quote_matching_tolerates_case_spacing_and_curly_quotes(record, episode, raw):
    raw["written_evidence"]["strength"]["evidence"] = [
        {"turn_id": "[t7]", "quote": "“I TAKE my  metformin every day.”", "location": ""}
    ]
    result = grade(record, episode, raw)
    assert result.evaluation["rubric"]["written_evidence"]["strength"]["evidence"][0]["turn_id"] == "t7"
    assert result.evaluation["integrity"]["quotes_dropped"] == 1  # only the planted misquote


def test_handoff_evidence_is_checked_by_location(record, episode, raw):
    episode["handoff"] = {
        "from_participant_id": "p.sam",
        "to_role": "dietitian",
        "situation": "58F with poorly controlled type 2 diabetes.",
        "background": "On metformin.",
        "assessment": "Adherent to metformin.",
        "recommendation": "Dietary counselling.",
    }
    raw["written_evidence"]["important_gap"]["evidence"] = [
        {"turn_id": "", "quote": "Adherent to metformin.", "location": "handoff.assessment"},
        {"turn_id": "", "quote": "not in the note", "location": "handoff.background"},
    ]
    gap = grade(record, episode, raw).evaluation["rubric"]["written_evidence"]["important_gap"]
    assert gap["evidence"] == [
        {"location": "handoff.assessment", "quote": "Adherent to metformin."},
        {"location": "handoff.background"},
    ]


def test_objective_cannot_be_met_with_critical_facts_missed(record, episode, raw):
    result = grade(record, episode, raw)
    history = result.grading["objective_results"][0]

    assert history["result"] == "partially_met"
    assert "Mother's diabetes" in history["feedback"]
    assert len(result.evaluation["integrity"]["adjustments"]) == 1


def test_grading_block_fits_the_episode_schema(record, episode, raw):
    result = grade(record, episode, raw)
    graded = result.graded_episode(episode)

    validate(graded, "episode")
    validate(result.evaluation, "evaluation")
    assert graded["grading"]["status"] == "graded"
    assert graded["grading"]["grader"] == {"kind": "ai", "model": "fake"}
    assert graded["grading"]["missed_fact_ids"] == ["f.fh.mother", "f.med.refills", "f.med.side_effects"]
    assert episode["grading"] == {"status": "ungraded"}  # input untouched


def test_discrepancy_finding_records_whether_the_chart_showed_it(record, episode, raw):
    finding = grade(record, episode, raw).evaluation["discrepancy_findings"][0]
    assert finding["outcome"] == "accepted_without_challenge"
    assert finding["contradiction_was_visible"] is False


def test_checklist_points_are_clamped_and_totalled(record, episode, raw):
    checklist = load_checklist(RUBRIC_DIR / "example_checklist_pediatric_hearing.json")
    raw["checklist_results"] = [
        {"item_id": "introduce_yourself", "points_awarded": 25, "evidence": [], "feedback": "ok"},
        {"item_id": "needs_assessment", "points_awarded": -5, "evidence": [], "feedback": "ok"},
        {"item_id": "review_audiogram", "points_awarded": 20, "evidence": [], "feedback": "ok"},
    ]
    result = grade(record, episode, raw, checklist=checklist).evaluation["checklist"]

    assert [i["points_awarded"] for i in result["items"]] == [10, 0, 20, 0]
    assert (result["points_awarded"], result["points_possible"]) == (30, 100)


def test_goals_reach_the_prompt_and_the_result(record, episode, raw):
    goals = [{"goal_id": "g.empathy", "description": "Respond to emotion before moving on."}]
    raw["goal_progress"] = [
        {"goal_id": "g.empathy", "progress": "not_demonstrated", "evidence": [], "feedback": "Not yet."},
        {"goal_id": "g.unknown", "progress": "achieved", "evidence": [], "feedback": "?"},
    ]
    llm = FakeLLM(raw)
    result = evaluate_episode(record, episode, llm, goals=goals, now=NOW)

    assert "Respond to emotion before moving on." in llm.calls[0][1]
    assert result.evaluation["goal_progress"] == [
        {
            "goal_id": "g.empathy",
            "description": "Respond to emotion before moving on.",
            "progress": "not_demonstrated",
            "evidence": [],
            "feedback": "Not yet.",
        }
    ]


def test_prompt_holds_the_truth_the_log_and_the_rubric(record, episode):
    rubric = load_rubric()
    graded = pick_graded_participant(episode)
    prompt = grader_user_prompt(
        record, episode, graded, record["learning_objectives"],
        analyze(record, episode, graded), rubric, None, None, "take a history",
    )
    assert "She skips most doses because of GI side effects and cost." in prompt
    assert '"missed_fact_ids"' in prompt
    assert "Clinical reasoning and synthesis" in prompt
    assert "[t7] Maria (patient): Oh yes. I take my metformin every day." in prompt
    assert "Encounter type: take a history." in prompt


def test_output_schema_is_closed_and_constrained_to_this_case(record):
    schema = grade_schema(load_rubric(), record["learning_objectives"], record["discrepancies"], None, None)

    def walk(node):
        if isinstance(node, dict):
            if node.get("type") == "object":
                assert node["additionalProperties"] is False
                assert set(node["required"]) == set(node["properties"])
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(schema)
    domain = schema["properties"]["domain_scores"]["items"]["properties"]
    assert domain["score"]["enum"] == ["4", "3", "2", "1", "NA"]
    assert len(domain["domain_id"]["enum"]) == 7
    assert "enum" not in schema["properties"]["goal_progress"]["items"]["properties"]["goal_id"]


def test_rejects_episodes_it_should_not_grade(record, episode, raw):
    running = {**episode, "status": "in_progress"}
    with pytest.raises(ValueError, match="still in progress"):
        grade(record, running, raw)

    other = {**episode, "patient_record_id": "rec.someone-else"}
    with pytest.raises(ValueError, match="not 'rec.maria-alvarez'"):
        grade(record, other, raw)

    broken = {k: v for k, v in episode.items() if k != "turns"}
    with pytest.raises(ValueError, match="episode schema"):
        grade(record, broken, raw)


def test_several_clinicians_need_an_explicit_choice(record, episode, raw):
    episode["participants"].append(
        {"participant_id": "p.lee", "kind": "human", "role": "dietitian", "display_name": "Lee", "user_id": "u.lee"}
    )
    with pytest.raises(ValueError, match="graded_participant_id"):
        grade(record, episode, raw)
    result = grade(record, episode, raw, graded_participant_id="p.sam")
    assert result.grading["graded_participant_id"] == "p.sam"


def test_debrief_session_keeps_the_conversation(record, episode, raw):
    evaluation = grade(record, episode, raw).evaluation
    llm = FakeLLM(lines=["What made you accept that? [t7]", "Here is what the chart shows."])
    session = DebriefSession(record, episode, evaluation, llm)

    with pytest.raises(RuntimeError):
        session.reply("too early")
    assert session.open() == "What made you accept that? [t7]"
    assert session.reply("She sounded sure.") == "Here is what the chart shows."

    system, sent = llm.calls[-1]
    assert "accepted_without_challenge" in system and "[t7] Maria (patient)" in system
    assert [m["role"] for m in sent] == ["user", "assistant", "user"]
    assert [m["role"] for m in session.transcript] == ["assistant", "user", "assistant"]

    resumed = DebriefSession(record, episode, evaluation, FakeLLM(lines=["Next."]), messages=session.messages)
    assert resumed.reply("ok") == "Next."
    assert len(resumed.messages) == 6


def test_cli_replay_writes_both_documents(tmp_path, capsys):
    code = main([
        "--record", str(EXAMPLES / "patient_record.json"),
        "--episode", str(EXAMPLES / "episode.json"),
        "--replay", str(EXAMPLES / "grader_response.json"),
        "--out-dir", str(tmp_path),
    ])
    assert code == 0
    assert "Rubric: 15 / 28" in capsys.readouterr().out
    validate(json.loads((tmp_path / "ep.0001.debrief_result.json").read_text()), "debrief_result")
    evaluation = json.loads((tmp_path / "ep.0001.evaluation.json").read_text())
    graded = json.loads((tmp_path / "ep.0001.graded_episode.json").read_text())
    assert evaluation["grader"]["model"] == "replay:grader_response.json"
    assert graded["grading"]["status"] == "graded"


def test_replay_llm_serves_recorded_debrief_lines():
    llm = ReplayLLM(EXAMPLES / "grader_response.json", debrief_lines=["first"])
    assert llm.complete_text("s", []) == "first"
    assert "replay mode" in llm.complete_text("s", [])


@pytest.mark.parametrize(
    "name, elicited_count, missed, contradiction_visible",
    [
        ("episode.json", 3, ["f.fh.mother", "f.med.refills", "f.med.side_effects"], False),
        ("episode_strong.json", 6, [], True),
        ("episode_confrontational.json", 4, ["f.sh.diet", "f.med.side_effects"], True),
    ],
)
def test_sample_episodes_are_valid_and_differ_as_described(
    record, name, elicited_count, missed, contradiction_visible
):
    sample = load(name)
    validate(sample, "episode")
    turn_ids = {t["turn_id"] for t in sample["turns"]}
    assert all(d["turn_id"] in turn_ids for d in sample["disclosures"])

    findings = analyze(record, sample, pick_graded_participant(sample))
    assert len(findings["elicited_fact_ids"]) == elicited_count
    assert findings["missed_fact_ids"] == missed
    assert findings["discrepancies"][0]["contradiction_was_visible"] is contradiction_visible
    assert findings["over_time_limit"] is False


def test_debrief_result_is_self_contained(record, episode, raw):
    from evaluator import build_debrief_result

    document = build_debrief_result(record, episode, grade(record, episode, raw))
    validate(document, "debrief_result")

    assert document["learner"]["display_name"] == "Sam"
    assert {t["speaker"] for t in document["transcript"]} == {"patient", "learner"}
    assert len(document["rubric"]["domains"]) == 7

    # Evidence carries what the screen needs to jump to the turn.
    lie = document["lies"][0]
    assert lie["patient_claim"] == "I take my metformin every day."
    assert lie["evidence"][0] == {
        "turn_id": "t7", "quote": "I take my metformin every day.", "turn_index": 7, "speaker": "patient",
    }

    # Facts come with labels, and missed ones say what would have unlocked them.
    assert [f["label"] for f in document["facts"]["elicited"]] == ["Thirst and urination", "Sweet tea", "HbA1c"]
    mother = document["facts"]["missed"][0]
    assert mother["label"] == "Mother's diabetes"
    assert mother["unlocked_by"] == ["family history", "what worries you"]

    t7 = document["transcript"][7]
    assert t7["face"]["emotion"] == "embarrassed"
    assert "lies.d.adherence" in t7["referenced_by"] and "debrief_questions.0" in t7["referenced_by"]
    assert document["transcript"][5]["facts_released"] == [
        {"fact_id": "f.sh.diet", "label": "Sweet tea", "channel": "patient"}
    ]


def test_committed_sample_outputs_are_current():
    import sys

    sys.path.insert(0, str(EXAMPLES.parent / "scripts"))
    from build_sample_outputs import build

    for name, document in build().items():
        committed = json.loads((EXAMPLES / "output" / name).read_text())
        assert committed == document, f"{name} is stale; run scripts/build_sample_outputs.py"
        validate(committed, "debrief_result")


def _schema(record):
    return grade_schema(load_rubric(), record["learning_objectives"], record["discrepancies"], None, None)


def test_json_reply_is_parsed_out_of_fences_and_checked(record, raw):
    from evaluator.llm import parse_json_reply

    schema = _schema(record)
    assert parse_json_reply("```json\n" + json.dumps(raw) + "\n```", schema) == raw

    with pytest.raises(ValueError, match="no JSON object"):
        parse_json_reply("I cannot do that.", schema)
    with pytest.raises(ValueError, match="invalid JSON"):
        parse_json_reply('{"domain_scores": [' + "}", schema)
    raw["domain_scores"][0]["score"] = "5"
    del raw["strengths"]
    with pytest.raises(ValueError, match="does not match the schema") as error:
        parse_json_reply(json.dumps(raw), schema)
    assert "strengths" in str(error.value) and "domain_scores/0/score" in str(error.value)


def test_bedrock_grader_retries_with_the_validation_error(record, raw):
    from evaluator.llm import BedrockLLM, LLMError

    class Scripted(BedrockLLM):
        def __init__(self, replies):
            self.model, self.effort, self.replies, self.requests = "scripted", "high", list(replies), []

        def _final_text(self, **request):
            self.requests.append(request)
            return self.replies.pop(0)

    schema = _schema(record)
    llm = Scripted(["Here you go: {not json}", json.dumps(raw)])
    assert llm.complete_json("SYSTEM", "USER", schema) == raw

    first, second = llm.requests
    assert first["system"].startswith("SYSTEM") and '"domain_scores"' in first["system"]
    assert "format" not in first["output_config"]
    assert first["messages"][0]["content"] == "USER"
    retry = second["messages"][0]["content"]
    assert retry.startswith("USER") and "invalid JSON" in retry and "{not json}" in retry

    with pytest.raises(LLMError, match="after 3 attempts"):
        Scripted(["nope"] * 3).complete_json("SYSTEM", "USER", schema)


def test_grade_is_requested_in_two_halves(record, episode, raw):
    llm = FakeLLM(raw)
    evaluate_episode(record, episode, llm, now=NOW)

    asked = sorted((sorted(schema["properties"]), schema["required"] == list(schema["properties"])) for _, _, schema in llm.calls)
    assert len(llm.calls) == 2
    assert asked[0] == (["domain_scores", "written_evidence"], True)
    assert "domain_scores" not in asked[1][0] and "debrief_questions" in asked[1][0] and asked[1][1]
    prompts_sent = {user.rsplit("\n\n", 1)[1] for _, user, _ in llm.calls}
    assert len(prompts_sent) == 2  # each half is told which part it is writing
