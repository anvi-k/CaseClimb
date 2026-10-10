"""Convert the app's case and encounter records into evaluator inputs.

The deployed app (main branch, backend/) stores a faculty case as a
`CaseDraft` and a session as an encounter dict with an event log. The
evaluator grades a `patient_record` and an `episode` (schemas/). These
functions map one to the other so finished app encounters can be graded
without changing either side.

Both functions take plain dicts (a CaseDraft's `model_dump()` and the
stored encounter payload), so this module does not import the app.
"""

from __future__ import annotations

from datetime import datetime, timezone

PATIENT_ID = "patient"

_EMOTION = {"receptive": "calm", "guarded": "neutral", "frustrated": "frustrated", "anxious": "anxious"}
_TENDENCY = {"receptive": "open", "guarded": "guarded", "frustrated": "guarded", "anxious": "neutral"}
_COMPETENCY = {
    "missed_follow_up": "history_taking",
    "clarify_available_inconsistency": "clinical_reasoning",
    "acknowledge_emotion": "empathy",
    "summarize_next_step": "patient_education",
}
_ARTIFACT_TYPE = {"note": "prior_note", "lab": "lab_report", "image_description": "other", "document": "other"}


def _iso(value: float | str | datetime) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float)):
        value = datetime.fromtimestamp(value, tz=timezone.utc)
    return value.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _disclosure(item: dict, channel: str) -> dict:
    if item.get("initially_released"):
        release = "at_start"
    elif item.get("requires"):
        release = "after_fact"
    else:
        release = "when_asked"
    disclosure = {"channel": channel, "release": release}
    if item.get("keywords"):
        disclosure["trigger_topics"] = list(item["keywords"])
    if item.get("requires"):
        disclosure["requires_fact_ids"] = list(item["requires"])
    return disclosure


def record_from_case(
    case: dict, *, case_id: str, version: int, published_at: float | str | datetime
) -> dict:
    """Build a `patient_record` from a published CaseDraft dict."""
    behavior = case.get("behavior", {})
    mood = behavior.get("mood", "guarded")

    facts = []
    for f in case["facts"]:
        audience = f.get("audience", "both")
        fact = {
            "fact_id": f["id"],
            "category": "other",
            "label": f["label"],
            "value": f["text"] if f.get("state", "known") == "known" else f"{f['text']} ({f['state']})",
            "patient_knows": audience != "chart",
            "disclosure": _disclosure(f, audience),
        }
        if f.get("patient_answer"):
            fact["patient_phrasing"] = f["patient_answer"]
        facts.append(fact)

    # The app models a withheld fact as a cover answer the patient gives until
    # the student clarifies. That is the record's story-vs-truth discrepancy.
    discrepancies = [
        {
            "discrepancy_id": f"{f['id']}-withheld",
            "patient_claim": f["nondisclosure_answer"],
            "contradicting_fact_ids": [f["id"]],
            "truth": f.get("patient_answer") or f["text"],
            "reveal_condition": "Asked respectfully about: " + ", ".join(f.get("clarification_keywords", [])),
        }
        for f in case["facts"]
        if f.get("nondisclosure_answer")
    ]

    artifacts = [
        {
            "artifact_id": a["id"],
            "type": _ARTIFACT_TYPE.get(a.get("kind", "note"), "other"),
            "title": a["title"],
            "approved_interpretation": a["body"],
            "disclosure": _disclosure(a, "chart"),
        }
        for a in case.get("artifacts", [])
    ]

    objectives = [
        {
            "objective_id": o["id"],
            "description": f"{o['label']}. {o['guidance']}",
            "competency": _COMPETENCY.get(o.get("debrief_focus", "missed_follow_up"), "other"),
            "critical_fact_ids": list(o.get("required_fact_ids", [])),
        }
        for o in case["objectives"]
    ]

    stamp = _iso(published_at)
    record = {
        "record_id": case_id,
        "version": version,
        "status": "published",
        "title": case["title"],
        "created_at": stamp,
        "updated_at": stamp,
        "demographics": {"name": case["patient_name"], "age": case["age"], "sex": "unknown"},
        "persona": {
            "personality": f"Simulated mood preset: {mood}.",
            "speech_style": "Speaks only faculty-authored replies.",
            "disclosure_tendency": _TENDENCY.get(mood, "neutral"),
            "baseline_emotion": _EMOTION.get(mood, "neutral"),
        },
        "chief_complaint": case["opening"],
        "clinical_facts": facts,
        "learning_objectives": objectives,
    }
    if discrepancies:
        record["discrepancies"] = discrepancies
    if artifacts:
        record["artifacts"] = artifacts
    if case.get("voice_id"):
        record["avatar"] = {"voice_ref": case["voice_id"]}
    return record


def episode_from_encounter(
    encounter: dict,
    case: dict,
    *,
    student_id: str = "student",
    student_name: str = "Student",
    student_role: str = "clinician",
) -> dict:
    """Build an ungraded `episode` from a stored app encounter."""
    student_pid = "student"
    audience = {f["id"]: f.get("audience", "both") for f in case["facts"]}

    turns, disclosures = [], []
    for index, event in enumerate(encounter["events"]):
        is_patient = event["actor"] == "patient"
        turns.append(
            {
                "turn_id": event["id"],
                "index": index,
                "participant_id": PATIENT_ID if is_patient else student_pid,
                "at": _iso(event["timestamp"]),
                "text": event["text"],
            }
        )
        if not is_patient:
            continue
        asked = encounter["events"][index - 1]["text"] if index else None
        trigger = f"Asked: {asked[:200]}" if asked else "Released at start"
        for fact_id in event.get("disclosed_fact_ids") or []:
            disclosures.append(
                {
                    "item_id": fact_id,
                    "item_type": "fact",
                    "channel": "chart" if audience.get(fact_id) == "chart" else "patient",
                    "turn_id": event["id"],
                    "trigger": trigger,
                }
            )
        for artifact_id in event.get("disclosed_artifact_ids") or []:
            disclosures.append(
                {
                    "item_id": artifact_id,
                    "item_type": "artifact",
                    "channel": "chart",
                    "turn_id": event["id"],
                    "trigger": trigger,
                }
            )

    episode = {
        "episode_id": encounter["id"],
        "patient_record_id": encounter["case_id"],
        "patient_record_version": encounter["version"],
        "status": "in_progress" if encounter["status"] == "active" else "completed",
        "started_at": _iso(encounter["started_at"]),
        "participants": [
            {
                "participant_id": PATIENT_ID,
                "kind": "ai",
                "role": "patient",
                "display_name": case["patient_name"],
                "model": "authored",
            },
            {
                "participant_id": student_pid,
                "kind": "human",
                "role": student_role,
                "display_name": student_name,
                "user_id": student_id,
            },
        ],
        "turns": turns,
        "disclosures": disclosures,
        "grading": {"status": "ungraded"},
    }
    if encounter.get("ended_at") is not None:
        episode["ended_at"] = _iso(encounter["ended_at"])
    return episode
