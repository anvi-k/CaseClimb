"""Rubric and case-checklist loading, plus the arithmetic that needs no model."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

RUBRIC_DIR = Path(__file__).parent / "rubrics"
DEFAULT_RUBRIC_PATH = RUBRIC_DIR / "patient_encounter_performance.json"

NOT_APPLICABLE = "NA"


def load_json(path: str | Path) -> Any:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def load_rubric(path: str | Path | None = None) -> dict:
    rubric = load_json(path or DEFAULT_RUBRIC_PATH)
    ids = [d["domain_id"] for d in rubric["domains"]]
    if len(ids) != len(set(ids)):
        raise ValueError("Rubric has duplicate domain_id values")
    return rubric


def load_checklist(path: str | Path) -> dict:
    checklist = load_json(path)
    ids = [i["item_id"] for i in checklist["items"]]
    if len(ids) != len(set(ids)):
        raise ValueError("Checklist has duplicate item_id values")
    return checklist


def summarize_rubric(domain_scores: list[dict], rubric: dict) -> dict:
    """Total the domain scores and decide whether a teacher must review.

    N/A domains are left out of both the total and the maximum, so a
    history-taking encounter is not penalised for having nothing to explain.
    """
    top = max(int(k) for k in rubric["scale"])
    scored = [d for d in domain_scores if d["score"] is not None]
    review = rubric.get("teacher_review", {})
    review_numbers = set(review.get("domain_numbers", []))
    threshold = review.get("at_or_below_score", 1)

    reasons = [
        f"Domain {d['number']} ({d['name']}) scored {d['score']}."
        for d in scored
        if d["number"] in review_numbers and d["score"] <= threshold
    ]
    return {
        "total": sum(d["score"] for d in scored),
        "max_total": top * len(scored),
        "needs_teacher_review": bool(reasons),
        "review_reasons": reasons,
    }
