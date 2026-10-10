"""Command line: grade an episode file, then optionally talk through the debrief."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .debrief import DebriefSession
from .evaluate import evaluate_episode
from .llm import BedrockLLM, ReplayLLM
from .report import build_debrief_result
from .rubric import load_checklist, load_json, load_rubric


def _write(path: Path, document: dict) -> None:
    path.write_text(json.dumps(document, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def _summary(evaluation: dict) -> str:
    rubric = evaluation["rubric"]
    lines = [f"Rubric: {rubric['total']} / {rubric['max_total']}"]
    for d in rubric["domain_scores"]:
        score = "N/A" if d["score"] is None else d["score"]
        lines.append(f"  {d['number']}. {d['name']}: {score} ({d['label']})")
    if "checklist" in evaluation:
        c = evaluation["checklist"]
        lines.append(f"Checklist: {c['points_awarded']} / {c['points_possible']}")
    if rubric["needs_teacher_review"]:
        lines.append("Flagged for teacher review: " + " ".join(rubric["review_reasons"]))
    lines.append(f"Missed facts: {', '.join(evaluation['missed_fact_ids']) or 'none'}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="caseclimb-evaluate", description=__doc__)
    parser.add_argument("--record", required=True, help="patient record JSON")
    parser.add_argument("--episode", required=True, help="finished episode JSON")
    parser.add_argument("--rubric", help="rubric JSON (default: the built-in seven-domain rubric)")
    parser.add_argument("--checklist", help="optional case checklist JSON")
    parser.add_argument("--goals", help='optional student goals JSON: [{"goal_id", "description"}]')
    parser.add_argument("--participant", help="participant_id to grade, if there are several clinicians")
    parser.add_argument("--encounter-type", help='e.g. "take a history" or "explain or counsel"')
    parser.add_argument("--out-dir", default="out", help="where to write results (default: out/)")
    parser.add_argument("--model", help="Bedrock model id (default: $CASECLIMB_GRADER_MODEL)")
    parser.add_argument("--replay", help="use a saved grader response instead of calling Bedrock")
    parser.add_argument("--debrief", action="store_true", help="start the debrief chat after grading")
    args = parser.parse_args(argv)

    record, episode = load_json(args.record), load_json(args.episode)
    llm = ReplayLLM(args.replay) if args.replay else BedrockLLM(model=args.model)

    print(f"Grading {episode['episode_id']} with {llm.model}. This can take a few minutes...", file=sys.stderr)
    result = evaluate_episode(
        record,
        episode,
        llm,
        rubric=load_rubric(args.rubric),
        checklist=load_checklist(args.checklist) if args.checklist else None,
        goals=load_json(args.goals) if args.goals else None,
        graded_participant_id=args.participant,
        encounter_type=args.encounter_type,
    )

    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    stem = episode["episode_id"].replace(":", "_")
    _write(out / f"{stem}.evaluation.json", result.evaluation)
    _write(out / f"{stem}.graded_episode.json", result.graded_episode(episode))
    _write(out / f"{stem}.debrief_result.json", build_debrief_result(record, episode, result))
    print(_summary(result.evaluation))
    print(f"Wrote {stem}.debrief_result.json, {stem}.evaluation.json and {stem}.graded_episode.json to {out}/")

    if args.debrief:
        session = DebriefSession(record, episode, result.evaluation, llm)
        print("\nDebrief (blank line or Ctrl-D to finish)\n")
        print(session.open())
        while True:
            try:
                line = input("\n> ").strip()
            except EOFError:
                break
            if not line:
                break
            print("\n" + session.reply(line))
        _write(out / f"{stem}.debrief.json", {"messages": session.transcript})
    return 0


if __name__ == "__main__":
    sys.exit(main())
