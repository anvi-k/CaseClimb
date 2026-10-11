"""Grade a visit from the Poscere app and return feedback in the app's own shape.

The app (TypeScript, SQLite) stores a visit as an encounter row with a case
snapshot, a config, a state holding the disclosure ledger, and message rows.
`grade_visit` takes those as one JSON bundle, grades the visit with this
evaluator, and returns a `Feedback` object the app's feedback page can render
unchanged, with the debrief material added under `debrief`.

Bundle, built on the app side from `loadEncounter(id)` and `messagesOf(id)`:

    {
      "encounter": {"id", "user_id", "case_id", "status", "started_at", "ended_at"},
      "case":      CaseProfile,          # row.case_snapshot
      "config":    EncounterConfig,      # row.config
      "state":     EncounterState,       # row.state
      "messages":  [{"id", "turn", "speaker", "text", "meta", "created_at"}],
      "write_up":  {fieldId: text},      # row.wrapup
      "student":   {"name"},
      "profession": Profession,          # profession(config.professionId)
      "rubric":    Rubric                # getRubric(case.rubricId); optional
    }

Run as `python -m evaluator.poscere < bundle.json > result.json`.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from datetime import datetime, timezone

from .evaluate import evaluate_episode
from .llm import BedrockLLM, ReplayLLM
from .report import build_debrief_result
from .rubric import load_rubric, normalize_rubric

_ID = re.compile(r"[^A-Za-z0-9_.:-]+")

_CATEGORY = {
    "chief_complaint": "history_of_present_illness",
    "hpi": "history_of_present_illness",
    "pmh": "past_medical_history",
    "psh": "surgical_history",
    "medications": "medication",
    "allergies": "allergy",
    "family": "family_history",
    "ros": "review_of_systems",
    "social": "social_history",
    "substance": "social_history",
    "sexual": "social_history",
    "nutrition": "social_history",
    "function": "social_history",
    "psychosocial": "social_history",
    "goals": "social_history",
    "adherence": "social_history",
}
_ACTION_CATEGORY = {
    "exam": "physical_exam",
    "vitals": "vital_sign",
    "lab": "lab_result",
    "imaging": "imaging",
    "procedure": "procedure",
}
_ARTIFACT_TYPE = {
    "lab_report": "lab_report",
    "ecg": "ecg",
    "note": "prior_note",
    "medication_list": "medication_list",
}
_SEX = {"female": "female", "f": "female", "woman": "female", "male": "male", "m": "male", "man": "male", "intersex": "intersex"}
# The app describes the patient's feeling in free text; the episode schema has a fixed list.
_EMOTION_WORDS = [
    ("in_pain", ("pain", "hurting", "aching")),
    ("angry", ("angry", "furious", "hostile")),
    ("frustrated", ("frustrat", "irritat", "annoyed", "defensive", "impatient")),
    ("fearful", ("scared", "afraid", "fear", "frightened", "terrified")),
    ("embarrassed", ("embarrass", "ashamed", "guilty", "sheepish")),
    ("sad", ("sad", "tearful", "down", "grief", "discouraged", "hopeless")),
    ("confused", ("confus", "unsure", "uncertain", "puzzled")),
    ("relieved", ("relie", "reassured")),
    ("hopeful", ("hopeful", "motivated", "encouraged", "optimistic")),
    ("anxious", ("anxious", "worried", "nervous", "overwhelm", "tense", "guarded", "wary", "uneasy")),
    ("calm", ("calm", "comfortable", "at ease", "relaxed", "trusting", "open")),
]
_SPEAKERS = {
    "system": ("chart", "ai", "chart_system", "Chart"),
    "coach": ("coach", "ai", "coach_hint", "Coach hint"),
    "instructor": ("instructor", "ai", "instructor_note", "Instructor note"),
    "clinician": ("colleague", "ai", "colleague", "Colleague"),
}
STUDENT = "student"
PATIENT = "patient"


def _id(value) -> str:
    return _ID.sub("_", str(value)).strip("_") or "x"


def _iso(value: str | None) -> str | None:
    """SQLite's `datetime('now')` is UTC without a zone: 'YYYY-MM-DD HH:MM:SS'."""
    if not value:
        return None
    text = value.strip().replace(" ", "T")
    if not re.search(r"(Z|[+-]\d\d:?\d\d)$", text):
        text += "Z"
    return text


def _emotion(text: str | None) -> str:
    lowered = (text or "").lower()
    for emotion, words in _EMOTION_WORDS:
        if any(w in lowered for w in words):
            return emotion
    return "neutral"


def _meta(message: dict) -> dict:
    meta = message.get("meta")
    if isinstance(meta, str):
        try:
            meta = json.loads(meta)
        except json.JSONDecodeError:
            meta = None
    return meta if isinstance(meta, dict) else {}


def case_facts(case: dict, config: dict) -> list[dict]:
    """The facts in play this visit: variant wording applied, red herrings only when enabled."""
    variant = next(
        (v for v in case.get("variants") or [] if v["id"] == config.get("variantId") and v.get("approved")),
        None,
    )
    overrides = (variant or {}).get("factOverrides") or {}
    facts = [{**f, **overrides.get(f["id"], {})} for f in case["facts"]]
    distractors = (config.get("knobs") or {}).get("distractors")
    return [f for f in facts if not (f.get("distractor") and not distractors)]


def record_from_case(bundle: dict) -> dict:
    """Build a `patient_record` from the visit's case snapshot."""
    case, config, state = bundle["case"], bundle.get("config") or {}, bundle["state"]
    stamp = _iso(bundle["encounter"]["started_at"])
    patient, persona, scenario = case["patient"], case["persona"], case["scenario"]
    # Anything on record at turn 0 came from an earlier visit, so it was not earned in this one.
    known_before = {k for k, v in state.get("disclosed", {}).items() if v.get("turn", 0) == 0}
    known_before |= {k for k, v in state.get("actions", {}).items() if v.get("turn", 0) == 0}

    facts = []
    for f in case_facts(case, config):
        if f.get("distractor"):
            continue
        facts.append(
            {
                "fact_id": _id(f["id"]),
                "category": _CATEGORY.get(f["category"], "other"),
                "label": f["topic"],
                "value": f["chart"],
                "patient_phrasing": f["says"],
                "disclosure": {
                    "channel": "patient",
                    "release": "at_start" if f["id"] in known_before else "when_asked",
                    "trigger_topics": [f"{f['topic']} (tier: {f['tier']}, importance: {f['importance']})"],
                },
            }
        )
    # Exams and orders have fixed results; to the evaluator they are chart facts earned by ordering.
    for a in case.get("actions", []):
        facts.append(
            {
                "fact_id": _id(a["id"]),
                "category": _ACTION_CATEGORY.get(a["kind"], "other"),
                "label": a["name"],
                "value": a["result"],
                "patient_knows": False,
                "disclosure": {
                    "channel": "chart",
                    "release": "at_start" if a["id"] in known_before else "when_ordered",
                    "trigger_topics": [f"{a['kind']} (importance: {a['importance']})"],
                },
            }
        )

    artifacts = []
    for d in case.get("artifacts", []):
        release = d.get("release") or {"when": "start"}
        disclosure = {"channel": "chart", "release": "at_start"}
        if release["when"] == "action":
            disclosure = {"channel": "chart", "release": "when_ordered"}
        elif release["when"] == "fact" and release.get("ref"):
            disclosure = {"channel": "chart", "release": "after_fact", "requires_fact_ids": [_id(release["ref"])]}
        body = d.get("body") or ""
        if d.get("table"):
            rows = [" | ".join(d["table"]["columns"])] + [" | ".join(r["cells"]) for r in d["table"]["rows"]]
            body = (body + "\n" + "\n".join(rows)).strip()
        artifact = {
            "artifact_id": _id(d["id"]),
            "type": _ARTIFACT_TYPE.get(d["type"], "other"),
            "title": d["title"],
            "disclosure": disclosure,
        }
        if body:
            artifact["approved_interpretation"] = body
        if d.get("date"):
            artifact["dated"] = d["date"]
        artifacts.append(artifact)

    fact_ids = {f["fact_id"] for f in facts}
    item_ids = fact_ids | {a["artifact_id"] for a in artifacts}
    discrepancies = []
    for m in case.get("mismatches") or []:
        # The record evidence is the document when there is one, otherwise the fact itself.
        against = [_id(m[k]) for k in ("artifactId", "factId") if m.get(k) and _id(m[k]) in item_ids][:1]
        if not against:
            continue
        discrepancies.append(
            {
                "discrepancy_id": _id(m["id"]),
                "patient_claim": m["patientClaim"],
                "contradicting_fact_ids": against,
                "truth": m["recordEvidence"],
                "reveal_condition": m["teachingPoint"],
            }
        )

    key = case["answerKey"]
    answer_key = "\n".join(
        f"{label}: {'; '.join(key[field]) if isinstance(key[field], list) else key[field]}"
        for label, field in [
            ("Primary problem", "primaryProblem"),
            ("Differential", "differential"),
            ("Key findings", "keyFindings"),
            ("Plan", "plan"),
            ("Red flags", "redFlags"),
            ("Education points", "educationPoints"),
        ]
        if key.get(field)
    )
    sources = [{"source_id": "answer-key", "type": "other", "title": "Answer key (faculty-approved)", "notes": answer_key}]
    sources += [
        {"source_id": _id(k["id"]), "type": "other", "title": k["title"], "notes": k["text"][:6000]}
        for k in case.get("knowledge", [])
    ]
    if case.get("chartAtStart"):
        chart = "\n".join(f"{i['label']}: {i['value']}" for i in case["chartAtStart"])
        sources.append({"source_id": "chart-at-start", "type": "other", "title": "In the chart before the visit", "notes": chart})

    objectives = [
        {
            "objective_id": _id(o["id"]),
            "description": o["text"],
            "competency": "other",
            "critical_fact_ids": [
                _id(i) for i in [*o.get("factIds", []), *o.get("actionIds", [])] if _id(i) in fact_ids
            ],
        }
        for o in case["objectives"]
    ]

    demographics = {
        "name": patient["name"],
        "age": int(patient["age"]),
        "sex": _SEX.get(str(patient.get("sex", "")).strip().lower(), "unknown"),
    }
    for target, source in [("pronouns", "pronouns"), ("race_ethnicity", "ethnicity"), ("preferred_language", "language"), ("occupation", "occupation")]:
        if patient.get(source):
            demographics[target] = patient[source]

    record = {
        "record_id": _id(bundle["encounter"]["case_id"]),
        "version": 1,
        "status": "published",
        "title": case["title"],
        "created_at": stamp,
        "updated_at": stamp,
        "demographics": demographics,
        "persona": {
            "personality": f"{persona['personality']} Emotional state: {persona['emotionalState']}",
            "speech_style": persona["communicationStyle"],
            "health_literacy": persona["healthLiteracy"],
            "concerns": list(persona.get("concerns", [])),
        },
        "chief_complaint": scenario["chiefComplaint"],
        "clinical_facts": facts,
        "knowledge_sources": sources,
        "learning_objectives": objectives,
    }
    if discrepancies:
        record["discrepancies"] = discrepancies
    if artifacts:
        record["artifacts"] = artifacts
    return record


def episode_from_visit(bundle: dict) -> dict:
    """Build an ungraded `episode` from the visit's messages and disclosure ledger."""
    encounter, case, state = bundle["encounter"], bundle["case"], bundle["state"]
    config = bundle.get("config") or {}
    profession = bundle.get("profession") or {}

    participants = {
        PATIENT: {"participant_id": PATIENT, "kind": "ai", "role": "patient", "display_name": case["patient"]["name"], "model": "poscere"},
        STUDENT: {
            "participant_id": STUDENT,
            "kind": "human",
            "role": _id(config.get("professionId") or profession.get("id") or "student"),
            "display_name": (bundle.get("student") or {}).get("name") or "Student",
            "user_id": _id(encounter["user_id"]),
        },
    }

    turns, used = [], set()
    for index, m in enumerate(bundle["messages"]):
        speaker = m["speaker"]
        if speaker not in (STUDENT, PATIENT):
            pid, kind, role, name = _SPEAKERS.get(speaker, (_id(speaker), "ai", _id(speaker), speaker))
            participants.setdefault(pid, {"participant_id": pid, "kind": kind, "role": role, "display_name": name, "model": "poscere"})
            speaker = pid
        # The app numbers a question and its reply with the same turn, so the id carries the speaker.
        turn_id = f"T{m['turn']}-{speaker}"
        while turn_id in used:
            turn_id += "b"
        used.add(turn_id)
        turn = {
            "turn_id": turn_id,
            "index": index,
            "participant_id": speaker,
            "at": _iso(m.get("created_at")) or _iso(encounter["started_at"]),
            "text": m["text"],
        }
        meta = _meta(m)
        if speaker == PATIENT and meta:
            feeling = (meta.get("state") or {}).get("emotion")
            cues = [feeling] if feeling else []
            if isinstance(meta.get("rapport"), (int, float)):
                delta = meta.get("rapportDelta") or 0
                cues.append(f"comfort {round(meta['rapport'])}/100 ({delta:+g})")
            turn["avatar"] = {"emotion": _emotion(feeling)}
            if cues:
                turn["avatar"]["gestures"] = cues
        turns.append(turn)

    def turn_for(number: int, prefer: str) -> str | None:
        """The message a ledger entry belongs to: the reply of that turn, else the nearest one."""
        same = [t for t, m in zip(turns, bundle["messages"]) if m["turn"] == number]
        for t in same:
            if t["participant_id"] == prefer:
                return t["turn_id"]
        if same:
            return same[-1]["turn_id"]
        return turns[0]["turn_id"] if turns else None

    kept = {f["id"] for f in case_facts(case, config) if not f.get("distractor")}
    disclosures = []
    for fact_id, entry in state.get("disclosed", {}).items():
        on_record = entry.get("how") == "record"
        turn_id = turn_for(entry.get("turn", 0), "chart" if on_record else PATIENT)
        if fact_id in kept and turn_id:
            disclosures.append({"item_id": _id(fact_id), "item_type": "fact", "channel": "chart" if on_record else "patient", "turn_id": turn_id, "trigger": entry.get("how", "asked")})
    action_ids = {a["id"] for a in case.get("actions", [])}
    for action_id, entry in state.get("actions", {}).items():
        turn_id = turn_for(entry.get("turn", 0), "chart")
        if action_id in action_ids and turn_id:
            disclosures.append({"item_id": _id(action_id), "item_type": "fact", "channel": "chart", "turn_id": turn_id, "trigger": f"requested: {entry.get('request', '')}"[:200]})
    artifact_ids = {d["id"] for d in case.get("artifacts", [])}
    for artifact_id, number in state.get("artifacts", {}).items():
        turn_id = turn_for(number, "chart")
        if artifact_id in artifact_ids and turn_id:
            disclosures.append({"item_id": _id(artifact_id), "item_type": "artifact", "channel": "chart", "turn_id": turn_id, "trigger": "in the chart from the start" if number == 0 else "released during the visit"})
    order = {t["turn_id"]: t["index"] for t in turns}
    disclosures.sort(key=lambda d: order[d["turn_id"]])

    status = {"active": "in_progress", "paused": "in_progress", "abandoned": "abandoned"}.get(encounter["status"], "completed")
    episode = {
        "episode_id": _id(encounter["id"]),
        "patient_record_id": _id(encounter["case_id"]),
        "patient_record_version": 1,
        "status": status,
        "started_at": _iso(encounter["started_at"]),
        "participants": list(participants.values()),
        "turns": turns,
        "disclosures": disclosures,
        "grading": {"status": "ungraded"},
    }
    if encounter.get("ended_at"):
        episode["ended_at"] = _iso(encounter["ended_at"])
    return episode


def _write_up(bundle: dict) -> list[dict]:
    written = bundle.get("write_up") or {}
    fields = (bundle.get("profession") or {}).get("wrapUp") or [{"id": k, "label": k} for k in written]
    return [
        {"id": _id(f["id"]), "label": f["label"], "text": written[f["id"]]}
        for f in fields
        if str(written.get(f["id"]) or "").strip()
    ]


def _context(bundle: dict) -> str:
    case, config = bundle["case"], bundle.get("config") or {}
    profession = bundle.get("profession") or {}
    parts = [f"{case['encounterType']} ({case['setting']})"]
    if profession.get("roleTitle"):
        parts.append(f"The student is acting as a {profession['roleTitle']}")
    if profession.get("rubricEmphasis"):
        parts.append(f"Expected of this role: {profession['rubricEmphasis']}")
    if case["scenario"].get("tasks"):
        parts.append("Tasks given to the student: " + "; ".join(case["scenario"]["tasks"]))
    level = (config.get("knobs") or {}).get("level")
    if level:
        parts.append(f"Difficulty level {level} of 5")
    stats = bundle["state"].get("stats")
    if stats:
        parts.append(
            "The app's own count of the student's turns: "
            + ", ".join(f"{stats.get(k, 0)} {k}" for k in ("open", "focused", "closed", "leading", "multiple", "empathy", "jargon", "judgmental"))
        )
    return ". ".join(p.rstrip(".") for p in parts)


def feedback_from_result(bundle: dict, result, debrief_result: dict) -> dict:
    """Shape an evaluation as the app's `Feedback` type (src/lib/types.ts)."""
    case, state, config = bundle["case"], bundle["state"], bundle.get("config") or {}
    evaluation, grading = result.evaluation, result.grading
    rubric = evaluation["rubric"]
    turn_number = {
        t["turn_id"]: m["turn"]
        for t, m in zip(debrief_result["transcript"], bundle["messages"])
    }

    def cited(items: list[dict]) -> list[dict]:
        return [
            {"turn": turn_number[e["turn_id"]], "quote": e.get("quote", ""), "note": ""}
            for e in items
            if "turn_id" in e
        ]

    def first_turn(items: list[dict]) -> dict:
        turns = [turn_number[e["turn_id"]] for e in items if "turn_id" in e]
        return {"turn": turns[0]} if turns else {}

    domains = [
        {"key": d["domain_id"], "name": d["name"], "score": d["score"], "max": 4, "rationale": d["rationale"], "evidence": cited(d["evidence"])}
        for d in rubric["domain_scores"]
    ]
    scored_max = rubric["max_total"]
    written = rubric["written_evidence"]
    concern = written["safety_or_accuracy_concern"]
    reasons = list(rubric["review_reasons"])
    if concern["present"]:
        reasons.append("Safety or accuracy concern flagged")

    # Findings come from the app's ledger, exactly as its own scorer reads it.
    rank = {"critical": 0, "important": 1, "minor": 2}
    facts = [f for f in case_facts(case, config) if not f.get("distractor")]
    disclosed, actions = state.get("disclosed", {}), state.get("actions", {})
    missed = sorted(
        ({"id": f["id"], "topic": f["topic"], "chart": f["chart"], "importance": f["importance"]} for f in facts if f["id"] not in disclosed),
        key=lambda f: rank.get(f["importance"], 3),
    )
    observed = {b["behavior"]: b for b in grading["behaviors"]}
    structure = " ".join(b["feedback"] for b in grading["behaviors"] if b.get("category") == "interview_structure")
    stats = state.get("stats") or {}
    outcomes = {d["discrepancy_id"]: d for d in evaluation["discrepancy_findings"]}
    results = {o["objective_id"]: o for o in grading["objective_results"]}
    met = {"met": "met", "partially_met": "partial", "not_met": "not_met"}

    return {
        "rubricId": case.get("rubricId") or "default",
        "rubricType": "domain4",
        "domains": domains,
        "total": rubric["total"],
        "max": scored_max,
        "percent": round(100 * rubric["total"] / scored_max) if scored_max else 0,
        "needsReview": bool(reasons),
        "reviewReasons": reasons,
        "elicited": [
            {"id": f["id"], "chart": f["chart"], "importance": f["importance"], "turn": disclosed[f["id"]].get("turn", 0)}
            for f in facts
            if f["id"] in disclosed
        ],
        "missed": missed,
        "actionsDone": [{"id": a["id"], "name": a["name"], "importance": a["importance"]} for a in case.get("actions", []) if a["id"] in actions],
        "actionsMissed": [
            {"id": a["id"], "name": a["name"], "importance": a["importance"]}
            for a in case.get("actions", [])
            if a["id"] not in actions and a["importance"] != "minor"
        ],
        "unnecessaryOrders": [u["request"] for u in state.get("unmatchedOrders", [])],
        "objectives": [
            {
                "id": o["id"],
                "text": o["text"],
                "met": met[results[_id(o["id"])]["result"]] if _id(o["id"]) in results else "not_met",
                "comment": results[_id(o["id"])]["feedback"] if _id(o["id"]) in results else "",
            }
            for o in case["objectives"]
        ],
        "interview": {
            "structure": structure,
            "sequencing": "",
            "questionMix": ", ".join(f"{stats[k]} {k}" for k in ("open", "focused", "closed", "leading", "multiple") if k in stats),
        },
        "strengths": [{"text": written["strength"]["text"], **first_turn(written["strength"]["evidence"])}]
        + [{"text": s} for s in grading["strengths"]],
        "improvements": [{"text": written["important_gap"]["text"], **first_turn(written["important_gap"]["evidence"])}]
        + [{"text": s} for s in grading["improvements"]],
        "safetyConcerns": [{"text": concern["text"], **first_turn(concern["evidence"])}] if concern["present"] else [],
        "accuracyIssues": [],
        "wrapUpReview": "",
        "mismatches": [
            {
                "id": m["id"],
                "patientClaim": m["patientClaim"],
                "recordEvidence": m["recordEvidence"],
                "noticed": outcomes.get(_id(m["id"]), {}).get("outcome") in ("uncovered", "challenged_unresolved"),
                "comment": outcomes.get(_id(m["id"]), {}).get("feedback", ""),
            }
            for m in case.get("mismatches") or []
        ],
        "nextAttempt": grading["next_attempt_suggestions"],
        "summary": f"{written['strength']['text']} {written['important_gap']['text']}".strip(),
        # Not part of the app's Feedback type: material for a debrief conversation.
        "debrief": {
            "questions": [{"question": q["question"], **first_turn(q["evidence"])} for q in evaluation["debrief_questions"]],
            "underProbing": [
                {"topic": u["topic"], "whyItMattered": u["why_it_mattered"], "factIds": [f["fact_id"] for f in u["related_facts"]]}
                for u in debrief_result["under_probing"]
            ],
            "behaviors": [{"behavior": name, "observed": b["observed"], "feedback": b["feedback"]} for name, b in observed.items()],
            "grader": evaluation["grader"],
            "integrity": evaluation["integrity"],
        },
    }


def grade_visit(bundle: dict, llm, *, now: datetime | None = None) -> dict:
    """Grade one Poscere visit. Returns `feedback` (the app's shape) and `debrief_result`."""
    record = record_from_case(bundle)
    episode = episode_from_visit(bundle)
    rubric = normalize_rubric(bundle["rubric"]) if bundle.get("rubric") else load_rubric()
    result = evaluate_episode(
        record,
        episode,
        llm,
        rubric=rubric,
        graded_participant_id=STUDENT,
        encounter_type=_context(bundle),
        write_up=_write_up(bundle),
        now=now or datetime.now(timezone.utc),
    )
    debrief_result = build_debrief_result(record, episode, result)
    return {
        "feedback": feedback_from_result(bundle, result, debrief_result),
        "debrief_result": debrief_result,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m evaluator.poscere", description="Grade a Poscere visit bundle.")
    parser.add_argument("--bundle", help="bundle JSON file (default: read from standard input)")
    parser.add_argument("--model", help="Bedrock model id (default: $POSCERE_GRADER_MODEL)")
    parser.add_argument("--replay", help="use a saved grader response instead of calling Bedrock")
    args = parser.parse_args(argv)

    if args.bundle:
        with open(args.bundle, encoding="utf-8") as f:
            bundle = json.load(f)
    else:
        bundle = json.load(sys.stdin)
    llm = ReplayLLM(args.replay) if args.replay else BedrockLLM(model=args.model)
    started = time.monotonic()
    json.dump(grade_visit(bundle, llm), sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    print(f"Graded with {llm.model} in {time.monotonic() - started:.0f} seconds.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
