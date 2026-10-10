"""Rubric and case-checklist loading, plus the arithmetic that needs no model."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

RUBRIC_DIR = Path(__file__).parent / "rubrics"
DEFAULT_RUBRIC_PATH = RUBRIC_DIR / "patient_encounter_performance.json"

NOT_APPLICABLE = "NA"


def load_json(path: str | Path) -> Any:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


_DEFAULT_SCALE = {"4": "Strong", "3": "Competent", "2": "Developing", "1": "Unsafe or absent"}


def normalize_rubric(raw: dict) -> dict:
    """Bring a rubric into this package's shape.

    Accepts the organisers' `encounter_evaluation_rubric.json` (domains with
    `key`, `descriptors`, `triggers_review_if_score_1`) and Poscere's own
    domain rubrics (`type: "domain4"`, `reviewIfOne`) as well as the native form.
    """
    if "rubric_id" in raw:
        return raw
    if raw.get("type") == "checklist" or "domains" not in raw:
        raise ValueError("Only domain rubrics scored 1 to 4 are supported, not points checklists")
    title = raw.get("title") or raw.get("name") or "Rubric"
    name = raw["id"] if isinstance(raw.get("id"), str) else title
    domains, review = [], []
    for position, d in enumerate(raw["domains"], start=1):
        number = d["id"] if isinstance(d.get("id"), int) else position
        domain = {"number": number, "domain_id": d["key"], "name": d["name"]}
        if d.get("descriptors"):
            domain["descriptors"] = d["descriptors"]
        domains.append(domain)
        if d.get("triggers_review_if_score_1") or d.get("reviewIfOne"):
            review.append(number)
    rubric = {
        "rubric_id": re.sub(r"[^A-Za-z0-9_.:-]+", "_", name).strip("_").lower() or "rubric",
        "title": title,
        "scale": {str(s["score"]): s["label"] for s in raw.get("rating_scale", [])} or dict(_DEFAULT_SCALE),
        "allow_not_applicable": True,
        "domains": domains,
        "written_evidence": ["strength", "important_gap", "safety_or_accuracy_concern"],
        "teacher_review": {"domain_numbers": review, "at_or_below_score": 1},
    }
    if raw.get("instructions"):
        rubric["instructions"] = raw["instructions"]
    return rubric


def load_rubric(path: str | Path | None = None) -> dict:
    rubric = normalize_rubric(load_json(path or DEFAULT_RUBRIC_PATH))
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
