"""Grade one finished episode.

The model scores and explains; this module decides what it is allowed to
claim. Disclosure facts come from the event log, every quote is checked
against the transcript, and totals and review flags are computed here.
"""

from __future__ import annotations

import copy
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path

from jsonschema import Draft202012Validator

from . import prompts
from .analysis import analyze, applicable_objectives, pick_graded_participant
from .llm import LLM
from .rubric import NOT_APPLICABLE, load_json, load_rubric, summarize_rubric

SCHEMA_DIR = Path(__file__).parent.parent / "schemas"


@lru_cache
def _validator(name: str) -> Draft202012Validator:
    return Draft202012Validator(load_json(SCHEMA_DIR / f"{name}.schema.json"))


def validate(document: dict, schema_name: str) -> None:
    errors = sorted(_validator(schema_name).iter_errors(document), key=lambda e: list(e.path))
    if errors:
        shown = "; ".join(
            f"{'/'.join(map(str, e.path)) or '(root)'}: {e.message}" for e in errors[:5]
        )
        more = f" (+{len(errors) - 5} more)" if len(errors) > 5 else ""
        raise ValueError(f"Does not match {schema_name} schema: {shown}{more}")


@dataclass
class EvaluationResult:
    evaluation: dict
    """Rubric scores, checklist, debrief material. Matches evaluation.schema.json."""
    grading: dict
    """Drop-in value for the episode's `grading` field."""

    def graded_episode(self, episode: dict) -> dict:
        graded = copy.deepcopy(episode)
        graded["grading"] = self.grading
        return graded


_QUOTE_MARKS = str.maketrans({"‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-"})


def _normalize(text: str) -> str:
    text = text.translate(_QUOTE_MARKS).lower()
    text = re.sub(r"\s+", " ", text).strip()
    return text.strip("\"'").removesuffix("...").removesuffix("…").strip()


class _EvidenceChecker:
    """Keeps only evidence that points at something real."""

    def __init__(self, episode: dict, write_up: list[dict] | None = None):
        self._turns = {t["turn_id"]: _normalize(t["text"]) for t in episode["turns"]}
        # Evidence outside the conversation: the SBAR handoff and the written write-up.
        self._documents = {
            f"handoff.{k}": _normalize(v)
            for k, v in episode.get("handoff", {}).items()
            if isinstance(v, str)
        }
        self._documents.update({f"write_up.{f['id']}": _normalize(f["text"]) for f in write_up or []})
        self.dropped_items = 0
        self.dropped_quotes = 0

    def clean(self, items: list[dict]) -> list[dict]:
        kept = []
        for item in items:
            turn_id = item.get("turn_id", "").strip().strip("[]")
            location = item.get("location", "").strip()
            quote = item.get("quote", "").strip()

            if turn_id in self._turns:
                source, out = self._turns[turn_id], {"turn_id": turn_id}
            elif location and not turn_id:
                # Non-turn evidence can only be checked when it names a known document field.
                source, out = self._documents.get(location), {"location": location}
            else:
                self.dropped_items += 1
                continue

            if quote:
                if source is not None and _normalize(quote) in source:
                    out["quote"] = quote
                else:
                    self.dropped_quotes += 1
            kept.append(out)
        return kept


def _domain_scores(raw: list[dict], rubric: dict, check: _EvidenceChecker) -> tuple[list[dict], list[str]]:
    by_id = {d["domain_id"]: d for d in raw}
    scores, unscored = [], []
    for domain in rubric["domains"]:
        entry = by_id.get(domain["domain_id"])
        base = {
            "domain_id": domain["domain_id"],
            "number": domain["number"],
            "name": domain["name"],
        }
        if entry is None:
            unscored.append(domain["domain_id"])
            scores.append(
                {**base, "score": None, "label": "Not scored",
                 "rationale": "The grader returned no score for this domain.", "evidence": []}
            )
            continue
        na = entry["score"] == NOT_APPLICABLE
        scores.append(
            {
                **base,
                "score": None if na else int(entry["score"]),
                "label": "N/A" if na else rubric["scale"][entry["score"]],
                "rationale": entry["rationale"],
                "evidence": check.clean(entry["evidence"]),
            }
        )
    return scores, unscored


def _objective_results(
    raw: list[dict], objectives: list[dict], record: dict, missed: list[str], check: _EvidenceChecker
) -> tuple[list[dict], list[str]]:
    labels = {f["fact_id"]: f["label"] for f in record["clinical_facts"]}
    by_id = {o["objective_id"]: o for o in objectives}
    results, adjustments, seen = [], [], set()
    for entry in raw:
        objective = by_id.get(entry["objective_id"])
        if objective is None or entry["objective_id"] in seen:
            continue
        seen.add(entry["objective_id"])
        result, feedback = entry["result"], entry["feedback"]
        gaps = [f for f in objective.get("critical_fact_ids", []) if f in missed]
        # An objective cannot be fully met while facts it names were never elicited.
        if result == "met" and gaps:
            result = "partially_met"
            names = ", ".join(labels[f] for f in gaps)
            feedback = f"{feedback} Marked partially met because the log shows these were not elicited: {names}."
            adjustments.append(
                f"Objective {entry['objective_id']} lowered from met to partially_met; "
                f"critical facts not elicited: {', '.join(gaps)}."
            )
        results.append(
            {
                "objective_id": entry["objective_id"],
                "result": result,
                "evidence": check.clean(entry["evidence"]),
                "feedback": feedback,
            }
        )
    return results, adjustments


def _checklist(raw: list[dict], checklist: dict, check: _EvidenceChecker) -> dict:
    by_id = {r["item_id"]: r for r in raw}
    items = []
    for item in checklist["items"]:
        entry = by_id.get(item["item_id"])
        awarded = min(max(entry["points_awarded"], 0), item["points"]) if entry else 0
        items.append(
            {
                "item_id": item["item_id"],
                "description": item["description"],
                "points_possible": item["points"],
                "points_awarded": awarded,
                "evidence": check.clean(entry["evidence"]) if entry else [],
                "feedback": entry["feedback"] if entry else "The grader returned no result for this item.",
            }
        )
    return {
        "checklist_id": checklist["checklist_id"],
        "title": checklist["title"],
        "items": items,
        "points_awarded": sum(i["points_awarded"] for i in items),
        "points_possible": sum(i["points_possible"] for i in items),
    }


def evaluate_episode(
    record: dict,
    episode: dict,
    llm: LLM,
    *,
    rubric: dict | None = None,
    checklist: dict | None = None,
    goals: list[dict] | None = None,
    graded_participant_id: str | None = None,
    encounter_type: str | None = None,
    write_up: list[dict] | None = None,
    now: datetime | None = None,
) -> EvaluationResult:
    """Grade `episode` against `record`.

    `goals` are the student's personal goals as `[{"goal_id", "description"}]`.
    `encounter_type` is free text such as "take a history" or "explain or counsel".
    `write_up` is what the student wrote after the visit, as `[{"id", "label", "text"}]`.
    """
    validate(record, "patient_record")
    validate(episode, "episode")
    if episode["status"] == "in_progress":
        raise ValueError("Episode is still in progress; grade it after it ends")
    if episode["patient_record_id"] != record["record_id"]:
        raise ValueError(
            f"Episode ran against record {episode['patient_record_id']!r}, not {record['record_id']!r}"
        )

    rubric = rubric or load_rubric()
    graded = pick_graded_participant(episode, graded_participant_id)
    objectives = applicable_objectives(record, graded["role"])
    findings = analyze(record, episode, graded)

    raw = llm.complete_json(
        prompts.GRADER_SYSTEM,
        prompts.grader_user_prompt(
            record, episode, graded, objectives, findings, rubric, checklist, goals, encounter_type,
            write_up,
        ),
        prompts.grade_schema(rubric, objectives, record.get("discrepancies", []), checklist, goals),
    )

    check = _EvidenceChecker(episode, write_up)
    domain_scores, unscored = _domain_scores(raw["domain_scores"], rubric, check)
    summary = summarize_rubric(domain_scores, rubric)
    if unscored:
        summary["needs_teacher_review"] = True
        summary["review_reasons"].append(f"Grader did not score: {', '.join(unscored)}.")

    objective_results, adjustments = _objective_results(
        raw["objective_results"], objectives, record, findings["missed_fact_ids"], check
    )
    unassessed = sorted(
        {o["objective_id"] for o in objectives} - {r["objective_id"] for r in objective_results}
    )

    def with_evidence(entries: list[dict]) -> list[dict]:
        return [{**e, "evidence": check.clean(e["evidence"])} for e in entries]

    written = raw["written_evidence"]
    log_view = {d["discrepancy_id"]: d for d in findings["discrepancies"]}
    discrepancy_findings = [
        {**d, "contradiction_was_visible": log_view[d["discrepancy_id"]]["contradiction_was_visible"]}
        for d in with_evidence(raw["discrepancy_findings"])
        if d["discrepancy_id"] in log_view
    ]
    goal_ids = {g["goal_id"]: g["description"] for g in goals or []}
    fact_ids = {f["fact_id"] for f in record["clinical_facts"]}

    graded_at = (now or datetime.now(timezone.utc)).isoformat(timespec="seconds")
    grader = {"kind": "ai", "model": llm.model}
    behaviors = with_evidence(raw["behaviors"])

    grading = {
        "status": "graded",
        "graded_at": graded_at,
        "grader": grader,
        "graded_participant_id": graded["participant_id"],
        "elicited_fact_ids": findings["elicited_fact_ids"],
        "missed_fact_ids": findings["missed_fact_ids"],
        "objective_results": objective_results,
        "behaviors": behaviors,
        "strengths": raw["strengths"],
        "improvements": raw["improvements"],
        "next_attempt_suggestions": raw["next_attempt_suggestions"],
    }

    evaluation = {
        "episode_id": episode["episode_id"],
        "patient_record_id": record["record_id"],
        "patient_record_version": record["version"],
        "graded_participant_id": graded["participant_id"],
        "evaluated_at": graded_at,
        "grader": grader,
        "rubric": {
            "rubric_id": rubric["rubric_id"],
            "domain_scores": domain_scores,
            **summary,
            "written_evidence": {
                "strength": with_evidence([written["strength"]])[0],
                "important_gap": with_evidence([written["important_gap"]])[0],
                "safety_or_accuracy_concern": with_evidence(
                    [written["safety_or_accuracy_concern"]]
                )[0],
            },
        },
        "elicited_fact_ids": findings["elicited_fact_ids"],
        "missed_fact_ids": findings["missed_fact_ids"],
        "discrepancy_findings": discrepancy_findings,
        "under_probing": [
            {**u, "related_fact_ids": [f for f in u["related_fact_ids"] if f in fact_ids]}
            for u in with_evidence(raw["under_probing"])
        ],
        "goal_progress": [
            {**g, "description": goal_ids[g["goal_id"]]}
            for g in with_evidence(raw["goal_progress"])
            if g["goal_id"] in goal_ids
        ],
        "debrief_questions": with_evidence(raw["debrief_questions"]),
        "encounter": {
            "duration_seconds": findings["duration_seconds"],
            "over_time_limit": findings["over_time_limit"],
            "student_turn_count": findings["student_turn_count"],
        },
        "integrity": {
            "evidence_items_dropped": check.dropped_items,
            "quotes_dropped": check.dropped_quotes,
            "adjustments": adjustments,
            "objectives_not_assessed": unassessed,
            "record_version_mismatch": episode["patient_record_version"] != record["version"],
        },
    }
    if checklist:
        evaluation["checklist"] = _checklist(raw["checklist_results"], checklist, check)

    result = EvaluationResult(evaluation=evaluation, grading=grading)
    validate(evaluation, "evaluation")
    validate(result.graded_episode(episode), "episode")
    return result
