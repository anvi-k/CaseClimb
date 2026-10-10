import json
from pathlib import Path

from backend.models import CaseDraft
from scripts.simulate_case import main, simulate

DEMO = Path(__file__).resolve().parents[1] / "backend" / "demo-case.json"


def demo_case():
    return CaseDraft.model_validate(json.loads(DEMO.read_text()))


def test_withheld_fact_needs_a_clarifying_question():
    result = simulate(demo_case(), [
        "Are you taking your medication?",
        "Could you walk me through your medication routine yesterday?",
    ])
    first, second = result["turns"]
    assert first["answer"] == "I think I've been following the routine."
    assert first["released_facts"] == []
    assert second["released_facts"] == ["routine"]


def test_reports_facts_no_question_reached():
    result = simulate(demo_case(), ["Hello there."])
    assert result["unreleased_facts"] == ["routine", "unknown_lab"]
    assert result["turns"][0]["released_facts"] == []


def test_cli_prints_json_and_exits_zero_for_a_valid_case(tmp_path, capsys):
    questions = tmp_path / "questions.txt"
    questions.write_text("Do you have any lab results?\n\n")
    assert main(["--case", str(DEMO), "--questions", str(questions), "--json"]) == 0
    result = json.loads(capsys.readouterr().out)
    assert result["issues"] == []
    assert result["turns"][0]["released_facts"] == ["unknown_lab"]
