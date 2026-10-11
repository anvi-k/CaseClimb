"""The debrief result: one self-contained document for the debrief screen.

Everything the screen shows is here with names and text already resolved, so
the front end does not have to join against the record or the episode.
"""

from __future__ import annotations

from .analysis import applicable_objectives, ordered_turns, participants_by_id
from .evaluate import EvaluationResult, validate


def _speaker(participant: dict, learner_id: str) -> str:
    if participant["role"] == "patient":
        return "patient"
    return "learner" if participant["participant_id"] == learner_id else "other"


def build_debrief_result(record: dict, episode: dict, result: EvaluationResult) -> dict:
    evaluation, grading = result.evaluation, result.grading
    learner_id = evaluation["graded_participant_id"]
    people = participants_by_id(episode)
    learner = people[learner_id]
    facts = {f["fact_id"]: f for f in record["clinical_facts"]}
    turns = {t["turn_id"]: t for t in episode["turns"]}
    references: dict[str, list[str]] = {t: [] for t in turns}

    def linked(items: list[dict], ref: str) -> list[dict]:
        """Add what the screen needs to jump to each piece of evidence."""
        out = []
        for item in items:
            if "turn_id" in item:
                turn = turns[item["turn_id"]]
                item = {
                    **item,
                    "turn_index": turn["index"],
                    "speaker": _speaker(people[turn["participant_id"]], learner_id),
                }
                if ref not in references[turn["turn_id"]]:
                    references[turn["turn_id"]].append(ref)
            out.append(item)
        return out

    def point(entry: dict, ref: str) -> dict:
        return {**entry, "evidence": linked(entry["evidence"], ref)}

    rubric = evaluation["rubric"]
    written = rubric["written_evidence"]
    disclosed_at = {d["item_id"]: d for d in reversed(episode["disclosures"])}

    def fact_card(fact_id: str) -> dict:
        fact = facts[fact_id]
        return {
            "fact_id": fact_id,
            "label": fact["label"],
            "value": fact["value"],
            "category": fact["category"],
        }

    elicited = []
    for fact_id in evaluation["elicited_fact_ids"]:
        disclosure = disclosed_at[fact_id]
        elicited.append(
            {
                **fact_card(fact_id),
                "channel": disclosure["channel"],
                "turn_id": disclosure["turn_id"],
                "turn_index": turns[disclosure["turn_id"]]["index"],
                "trigger": disclosure.get("trigger", ""),
            }
        )
    missed = [
        {**fact_card(f), "unlocked_by": facts[f]["disclosure"].get("trigger_topics", [])}
        for f in evaluation["missed_fact_ids"]
    ]

    claims = {d["discrepancy_id"]: d for d in record.get("discrepancies", [])}
    lies = [
        {
            **point(finding, f"lies.{finding['discrepancy_id']}"),
            "patient_claim": claims[finding["discrepancy_id"]]["patient_claim"],
            "truth": claims[finding["discrepancy_id"]].get("truth", ""),
            "reveal_condition": claims[finding["discrepancy_id"]].get("reveal_condition", ""),
        }
        for finding in evaluation["discrepancy_findings"]
    ]

    described = {o["objective_id"]: o for o in applicable_objectives(record, learner["role"])}
    objectives = [
        {
            **point(r, f"objectives.{r['objective_id']}"),
            "description": described[r["objective_id"]]["description"],
            "competency": described[r["objective_id"]]["competency"],
        }
        for r in grading["objective_results"]
    ]

    document = {
        "episode_id": episode["episode_id"],
        "generated_at": evaluation["evaluated_at"],
        "grader": evaluation["grader"],
        "learner": {
            "participant_id": learner_id,
            "display_name": learner["display_name"],
            "role": learner["role"],
        },
        "patient": {
            "record_id": record["record_id"],
            "case_title": record["title"],
            "name": record["demographics"]["name"],
            "age": record["demographics"]["age"],
            "sex": record["demographics"]["sex"],
            "chief_complaint": record["chief_complaint"],
        },
        "encounter": evaluation["encounter"],
        "rubric": {
            "total": rubric["total"],
            "max_total": rubric["max_total"],
            "needs_teacher_review": rubric["needs_teacher_review"],
            "review_reasons": rubric["review_reasons"],
            "domains": [point(d, f"rubric.{d['domain_id']}") for d in rubric["domain_scores"]],
        },
        "written_evidence": {
            "strength": point(written["strength"], "written_evidence.strength"),
            "important_gap": point(written["important_gap"], "written_evidence.important_gap"),
            "safety_or_accuracy_concern": point(
                written["safety_or_accuracy_concern"], "written_evidence.safety_or_accuracy_concern"
            ),
        },
        "facts": {"elicited": elicited, "missed": missed},
        "lies": lies,
        "under_probing": [
            {
                "topic": u["topic"],
                "why_it_mattered": u["why_it_mattered"],
                "related_facts": [fact_card(f) for f in u["related_fact_ids"]],
                "evidence": linked(u["evidence"], f"under_probing.{i}"),
            }
            for i, u in enumerate(evaluation["under_probing"])
        ],
        "objectives": objectives,
        "behaviors": [point(b, f"behaviors.{b['behavior']}") for b in grading["behaviors"]],
        "goal_progress": [point(g, f"goal_progress.{g['goal_id']}") for g in evaluation["goal_progress"]],
        "strengths": grading["strengths"],
        "improvements": grading["improvements"],
        "next_attempt_suggestions": grading["next_attempt_suggestions"],
        "debrief_questions": [
            point(q, f"debrief_questions.{i}") for i, q in enumerate(evaluation["debrief_questions"])
        ],
    }
    if "checklist" in evaluation:
        checklist = evaluation["checklist"]
        document["checklist"] = {
            **checklist,
            "items": [point(i, f"checklist.{i['item_id']}") for i in checklist["items"]],
        }

    released: dict[str, list[dict]] = {}
    for d in episode["disclosures"]:
        if d["item_type"] == "fact" and d["item_id"] in facts:
            released.setdefault(d["turn_id"], []).append(
                {"fact_id": d["item_id"], "label": facts[d["item_id"]]["label"], "channel": d["channel"]}
            )

    transcript = []
    for turn in ordered_turns(episode):
        speaker = people[turn["participant_id"]]
        line = {
            "turn_id": turn["turn_id"],
            "index": turn["index"],
            "speaker": _speaker(speaker, learner_id),
            "display_name": speaker["display_name"],
            "at": turn["at"],
            "text": turn["text"],
            "facts_released": released.get(turn["turn_id"], []),
            # Which sections of this document cite the turn, e.g. "rubric.information_gathering".
            "referenced_by": references[turn["turn_id"]],
        }
        if "avatar" in turn:
            line["face"] = turn["avatar"]
        transcript.append(line)
    document["transcript"] = transcript

    validate(document, "debrief_result")
    return document
