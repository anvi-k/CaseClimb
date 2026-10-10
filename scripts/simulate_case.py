"""Dry-run a case: validate it, then play scripted learner questions through the engine.

Shows which facts and artifacts each question can release, so authors can catch
keyword collisions and unreachable facts before publishing. It runs the engine
without the Bedrock selector, so it reports every fact the rules allow. A deployed
encounter with a selector may release only a subset of these on a given turn, so a
fact listed here is reachable, not guaranteed. No provider, network, or store is used.
Run `uv run python scripts/simulate_case.py --case <case.json> --questions <file>`,
one learner question per line.
"""

import argparse
import json
import sys
import unicodedata
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.engine import reply, validate_case
from backend.models import CaseDraft


def printable(value) -> str:
    """Escape control and format characters so case text cannot drive the terminal."""
    return "".join(
        ch.encode("unicode_escape").decode() if unicodedata.category(ch) in ("Cc", "Cf") else ch
        for ch in str(value)
    )


def simulate(case: CaseDraft, questions: list[str]):
    encounter = {
        "disclosed_fact_ids": [f.id for f in case.facts if f.initially_released],
        "disclosed_artifact_ids": [a.id for a in case.artifacts if a.initially_released],
        "simulated_mood": {"mood": case.behavior.mood, "rapport": case.behavior.initial_rapport},
    }
    turns = []
    for question in questions:
        answer, facts, artifacts, _, change = reply(case, encounter, question)
        turns.append({"question": question, "answer": answer, "released_facts": facts,
                      "released_artifacts": artifacts, "rapport_change": change,
                      "rapport": encounter["simulated_mood"]["rapport"]})
    unreleased = sorted({f.id for f in case.facts} - set(encounter["disclosed_fact_ids"]))
    unreleased_artifacts = sorted({a.id for a in case.artifacts} - set(encounter["disclosed_artifact_ids"]))
    return {"turns": turns, "unreleased_facts": unreleased, "unreleased_artifacts": unreleased_artifacts}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--case", type=Path, required=True)
    parser.add_argument("--questions", type=Path, required=True)
    parser.add_argument("--json", action="store_true", help="print the result as JSON")
    args = parser.parse_args(argv)

    case = CaseDraft.model_validate(json.loads(args.case.read_text()))
    issues = validate_case(case)["issues"]
    questions = [line.strip() for line in args.questions.read_text().splitlines() if line.strip()]
    result = {"issues": issues, **simulate(case, questions)}
    if args.json:
        # ASCII-only JSON escapes every control character, including C1 codes.
        print(json.dumps(result, indent=2))
    else:
        print("Validation issues:", printable("; ".join(issues) or "none"))
        print("Authored rules only: a deployed Bedrock selector may release a subset of each turn's facts.")
        for turn in result["turns"]:
            print(f"\nQ: {printable(turn['question'])}\nA: {printable(turn['answer'])}")
            print(f"   can release facts {printable(turn['released_facts'])}, "
                  f"artifacts {printable(turn['released_artifacts'])}, "
                  f"rapport {turn['rapport_change']:+d} -> {turn['rapport']}")
        print("\nNever released: facts", printable(result["unreleased_facts"]),
              "artifacts", printable(result["unreleased_artifacts"]))
    return 1 if issues else 0


if __name__ == "__main__":
    raise SystemExit(main())
