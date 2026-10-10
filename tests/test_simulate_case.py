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


def test_text_output_escapes_terminal_control_characters(tmp_path, capsys):
    questions = tmp_path / "questions.txt"
    questions.write_text("Hello \x1b]0;pwned\x07 there \x9b31m\n")
    assert main(["--case", str(DEMO), "--questions", str(questions)]) == 0
    out = capsys.readouterr().out
    assert "\x1b" not in out and "\x07" not in out and "\x9b" not in out
    assert "\\x1b]0;pwned\\x07" in out
    assert "a deployed Bedrock selector may release a subset" in out


def test_json_output_is_ascii_only(tmp_path, capsys):
    questions = tmp_path / "questions.txt"
    questions.write_text("Hi \x9b31m\n")
    main(["--case", str(DEMO), "--questions", str(questions), "--json"])
    out = capsys.readouterr().out
    assert out.isascii()
    assert json.loads(out)["turns"][0]["question"] == "Hi \x9b31m"


def test_cli_prints_json_and_exits_zero_for_a_valid_case(tmp_path, capsys):
    questions = tmp_path / "questions.txt"
    questions.write_text("Do you have any lab results?\n\n")
    assert main(["--case", str(DEMO), "--questions", str(questions), "--json"]) == 0
    result = json.loads(capsys.readouterr().out)
    assert result["issues"] == []
    assert result["turns"][0]["released_facts"] == ["unknown_lab"]
