"""Findings read straight from the record and the event log, with no model involved.

What was and was not disclosed is a matter of record, so the grader model is
told these answers rather than asked for them.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

ENCOUNTER_LIMIT_SECONDS = 10 * 60

# Facts the student could never have been expected to earn by asking.
_NOT_EARNED = {"at_start", "never"}


def participants_by_id(episode: dict) -> dict[str, dict]:
    return {p["participant_id"]: p for p in episode["participants"]}


def pick_graded_participant(episode: dict, participant_id: str | None = None) -> dict:
    people = participants_by_id(episode)
    if participant_id:
        if participant_id not in people:
            raise ValueError(f"No participant {participant_id!r} in episode {episode['episode_id']}")
        if people[participant_id]["role"] == "patient":
            raise ValueError("The patient cannot be the graded participant")
        return people[participant_id]

    clinicians = [p for p in episode["participants"] if p["role"] != "patient"]
    humans = [p for p in clinicians if p["kind"] == "human"]
    candidates = humans or clinicians
    if len(candidates) != 1:
        raise ValueError(
            "Episode has several clinicians; pass graded_participant_id to say which one to grade"
        )
    return candidates[0]


def applicable_objectives(record: dict, role: str) -> list[dict]:
    return [
        o
        for o in record["learning_objectives"]
        if not o.get("applies_to_roles") or role in o["applies_to_roles"]
    ]


def ordered_turns(episode: dict) -> list[dict]:
    return sorted(episode["turns"], key=lambda t: t["index"])


def render_transcript(episode: dict) -> str:
    """One line per turn, tagged with its turn_id so the grader can cite it."""
    people = participants_by_id(episode)
    lines = []
    for turn in ordered_turns(episode):
        speaker = people.get(turn["participant_id"], {})
        label = f"{speaker.get('display_name', '?')} ({speaker.get('role', '?')})"
        line = f"[{turn['turn_id']}] {label}: {turn['text']}"
        avatar = turn.get("avatar")
        if avatar:
            cue = avatar["emotion"]
            if "intensity" in avatar:
                cue += f" {avatar['intensity']:.1f}"
            if avatar.get("gestures"):
                cue += "; " + ", ".join(avatar["gestures"])
            line += f"  <face: {cue}>"
        lines.append(line)
    return "\n".join(lines)


def _duration_seconds(episode: dict) -> int | None:
    if "ended_at" not in episode:
        return None
    start = datetime.fromisoformat(episode["started_at"].replace("Z", "+00:00"))
    end = datetime.fromisoformat(episode["ended_at"].replace("Z", "+00:00"))
    return int((end - start).total_seconds())


def analyze(record: dict, episode: dict, graded: dict) -> dict[str, Any]:
    facts = {f["fact_id"]: f for f in record["clinical_facts"]}
    objectives = applicable_objectives(record, graded["role"])

    disclosed: dict[str, dict] = {}
    for d in episode["disclosures"]:
        disclosed.setdefault(d["item_id"], d)

    def earned(fact_id: str) -> bool:
        return facts[fact_id]["disclosure"]["release"] not in _NOT_EARNED

    elicited = [
        d["item_id"]
        for d in disclosed.values()
        if d["item_type"] == "fact" and d["item_id"] in facts and earned(d["item_id"])
    ]

    critical: list[str] = []
    for o in objectives:
        for fact_id in o.get("critical_fact_ids", []):
            if fact_id in facts and fact_id not in critical:
                critical.append(fact_id)
    missed = [f for f in critical if f not in disclosed and earned(f)]

    discrepancies = []
    for d in record.get("discrepancies", []):
        seen = [f for f in d["contradicting_fact_ids"] if f in disclosed]
        discrepancies.append(
            {
                "discrepancy_id": d["discrepancy_id"],
                "contradicting_facts_disclosed": seen,
                "contradicting_facts_not_disclosed": [
                    f for f in d["contradicting_fact_ids"] if f not in disclosed
                ],
                # The student only had grounds to challenge the claim if the chart showed otherwise.
                "contradiction_was_visible": bool(seen),
            }
        )

    duration = _duration_seconds(episode)
    return {
        "elicited_fact_ids": elicited,
        "missed_fact_ids": missed,
        "disclosures": [
            {
                "item_id": d["item_id"],
                "item_type": d["item_type"],
                "channel": d["channel"],
                "turn_id": d["turn_id"],
                "trigger": d.get("trigger"),
            }
            for d in disclosed.values()
        ],
        "discrepancies": discrepancies,
        "duration_seconds": duration,
        "over_time_limit": duration is not None and duration > ENCOUNTER_LIMIT_SECONDS,
        "student_turn_count": sum(
            1 for t in episode["turns"] if t["participant_id"] == graded["participant_id"]
        ),
    }
