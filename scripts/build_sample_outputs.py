"""Regenerate examples/output/ from the sample episodes and saved grader responses."""

import json
from datetime import datetime, timezone
from pathlib import Path

from evaluator import ReplayLLM, build_debrief_result, evaluate_episode

EXAMPLES = Path(__file__).parent.parent / "examples"
SAMPLES = [
    ("episode.json", "grader_response.json"),
    ("episode_strong.json", "grader_response_strong.json"),
    ("episode_confrontational.json", "grader_response_confrontational.json"),
]
# Fixed so that regenerating does not change the files.
GENERATED_AT = datetime(2026, 10, 10, 12, 0, tzinfo=timezone.utc)


def build() -> dict[str, dict]:
    record = json.loads((EXAMPLES / "patient_record.json").read_text())
    outputs = {}
    for episode_file, response_file in SAMPLES:
        episode = json.loads((EXAMPLES / episode_file).read_text())
        result = evaluate_episode(record, episode, ReplayLLM(EXAMPLES / response_file), now=GENERATED_AT)
        outputs[f"{episode['episode_id']}.debrief_result.json"] = build_debrief_result(record, episode, result)
    return outputs


if __name__ == "__main__":
    for name, document in build().items():
        path = EXAMPLES / "output" / name
        path.write_text(json.dumps(document, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        rubric = document["rubric"]
        print(f"{path.relative_to(EXAMPLES.parent)}: {rubric['total']}/{rubric['max_total']}")
