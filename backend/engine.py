"""Deterministic disclosure and formative, evidence-linked feedback."""

import re

from .models import CaseDraft


def matches(text: str, keywords: list[str]) -> bool:
    normalized = " ".join(re.findall(r"[\w']+", text.casefold()))
    for keyword in keywords:
        phrase = " ".join(re.findall(r"[\w']+", keyword.casefold()))
        if phrase and re.search(r"(?<!\w)" + re.escape(phrase) + r"(?!\w)", normalized):
            return True
    return False


def validate_case(case: CaseDraft):
    issues = []
    facts = {f.id: f for f in case.facts}
    ids = [f.id for f in case.facts] + [a.id for a in case.artifacts] + [o.id for o in case.objectives]
    if len(set(ids)) != len(ids):
        issues.append("Fact, artifact, and objective IDs must be unique.")
    if not case.facts:
        issues.append("At least one authored fact is required.")
    if not case.objectives:
        issues.append("At least one observable learning objective is required.")
    feedback_text = " ".join(o.label + o.guidance + o.next_question for o in case.objectives)
    if len(feedback_text.encode()) > 20_000:
        issues.append("Authored objective guidance exceeds the 20KB feedback budget. Use fewer, more focused objectives.")
    initial_text = case.opening + " ".join(f.patient_answer or "" for f in case.facts if f.initially_released and f.audience != "chart")
    if len(initial_text) > 4000:
        issues.append("Initial patient disclosure exceeds 4000 characters. Move details into progressively released facts.")
    for fact in case.facts:
        if not fact.initially_released and not fact.keywords:
            issues.append(f"Fact {fact.id} needs a release keyword or initial release.")
        if fact.initially_released and fact.requires:
            issues.append(f"Initially released fact {fact.id} cannot have prerequisites.")
        if fact.audience != "chart" and not fact.patient_answer:
            issues.append(f"Fact {fact.id} needs an authored patient_answer.")
        if fact.nondisclosure_answer and not fact.clarification_keywords:
            issues.append(f"Fact {fact.id} needs clarification keywords for nondisclosure.")
        if fact.nondisclosure_answer and fact.initially_released:
            issues.append(f"Fact {fact.id} cannot be initially released and withheld.")
        if any(r not in facts or r == fact.id for r in fact.requires):
            issues.append(f"Fact {fact.id} has an invalid prerequisite.")
    colors = {}
    def visit(key):
        if colors.get(key) == "visiting":
            return True
        if colors.get(key) == "visited":
            return False
        colors[key] = "visiting"
        if any(visit(r) for r in facts[key].requires if r in facts):
            return True
        colors[key] = "visited"
        return False
    if any(visit(key) for key in facts):
        issues.append("Fact prerequisites contain a cycle.")
    for item in [*case.artifacts, *case.objectives]:
        refs = item.requires if hasattr(item, "requires") else item.required_fact_ids + item.opportunity_fact_ids
        if any(r not in facts for r in refs):
            issues.append(f"{item.id} references an unknown fact.")
        if hasattr(item, "requires") and not item.initially_released and not item.keywords:
            issues.append(f"Artifact {item.id} needs a release keyword or initial release.")
        if hasattr(item, "requires") and item.initially_released and item.requires:
            issues.append(f"Initially released artifact {item.id} cannot have prerequisites.")
        if hasattr(item, "required_fact_ids") and not item.keywords and not item.required_fact_ids:
            issues.append(f"Objective {item.id} needs observable keywords or required facts.")
    return {"valid": not issues, "issues": issues, "review_warning": "Structural checks cannot establish clinical validity. A qualified reviewer must review clinical content and permissions."}


def disclosed_chart(case: CaseDraft, encounter: dict):
    released = set(encounter["disclosed_fact_ids"])
    return {
        "facts": [f.model_dump(include={"id", "label", "text", "state"}) for f in case.facts if f.id in released and f.audience in ("chart", "both")],
        "artifacts": [a.model_dump(include={"id", "title", "kind", "body", "metadata"}) for a in case.artifacts if a.id in encounter["disclosed_artifact_ids"]],
    }


def reply(case: CaseDraft, encounter: dict, text: str, selector=None):
    released = set(encounter["disclosed_fact_ids"])
    candidates, withheld = [], []
    for fact in case.facts:
        if not set(fact.requires) <= released or not matches(text, fact.keywords):
            continue
        if fact.nondisclosure_answer and fact.id not in released and not matches(text, fact.clarification_keywords):
            withheld.append(fact)
        else:
            candidates.append(fact)
    selected = [f.id for f in candidates]
    provider = "authored"
    if selector:
        selected, provider = selector.choose(text, [f.model_dump() for f in candidates])
    # Defense in depth: an injected selector can never expand the authorized set.
    allowed = {f.id for f in candidates}
    if not set(selected) <= allowed:
        selected, provider = [f.id for f in candidates], "authored_fallback"
    # Render at most 1000 authored characters; skipped patient facts stay hidden.
    # Chart-only facts may be released without adding spoken clinical content.
    answers, bounded = [], []
    for fact in candidates:
        if fact.id not in selected:
            continue
        answer = fact.patient_answer if fact.audience != "chart" else None
        if answer and len(" ".join(answers + [answer])) > 1000:
            continue
        bounded.append(fact.id)
        if answer:
            answers.append(answer)
    selected = bounded
    for fact in withheld:
        answer = fact.nondisclosure_answer if fact.audience != "chart" else None
        if answer and len(" ".join(answers + [answer])) <= 1000:
            answers.append(answer)
    newly = [i for i in selected if i not in released]
    encounter["disclosed_fact_ids"] = sorted(released | set(selected))
    released.update(selected)
    artifacts = [a.id for a in case.artifacts if a.id not in encounter["disclosed_artifact_ids"] and set(a.requires) <= released and matches(text, a.keywords)]
    encounter["disclosed_artifact_ids"].extend(artifacts)
    if not answers and (selected or artifacts):
        answers = ["You can review the information now available in my chart."]
    rapport = encounter["simulated_mood"]["rapport"]
    change = 0
    if matches(text, case.behavior.dismissive_keywords):
        change = -5
        if not answers:
            answers = [case.behavior.dismissive_response]
    elif matches(text, case.behavior.supportive_keywords):
        change = 5
        if not answers:
            answers = [case.behavior.supportive_response]
    encounter["simulated_mood"]["rapport"] = min(100, max(0, rapport + change))
    rendered = " ".join(dict.fromkeys(a for a in answers if a)) or case.fallback_answer
    return rendered, newly, artifacts, provider, change


def feedback(case: CaseDraft, encounter: dict):
    released = set(encounter["disclosed_fact_ids"])
    learner_events = [e for e in encounter["events"] if e["actor"] == "learner"]
    assessments = []
    for objective in case.objectives:
        evidence = [e for e in learner_events if matches(e["text"], objective.keywords)]
        facts_observed = set(objective.required_fact_ids) <= released
        observed = facts_observed and (bool(evidence) if objective.keywords else bool(objective.required_fact_ids))
        opportunity = set(objective.opportunity_fact_ids) <= released
        status = "observed" if observed else "missed" if opportunity else "not_assessable"
        if not objective.keywords and observed:
            evidence = [e for e in encounter["events"] if set(objective.required_fact_ids) & set(e.get("disclosed_fact_ids", []))]
        opportunity_events = [e for e in encounter["events"] if set(objective.opportunity_fact_ids) & set(e.get("disclosed_fact_ids", []))]
        assessments.append({
            "objective_id": objective.id, "label": objective.label, "result": status,
            "evidence": [{"event_id": e["id"], "text": e["text"][:250], "excerpt": len(e["text"]) > 250} for e in evidence[:2]],
            "opportunity_evidence_ids": [e["id"] for e in opportunity_events[:5]],
            "explanation": ("Authored observable criteria were recorded." if observed else "No adequate evidence of the authored criterion was recorded despite an available opportunity." if opportunity else "The authored prerequisite cue was not available; this objective cannot be assessed."),
            "guidance": objective.guidance, "next_question": objective.next_question,
            "uncertainty": "Keyword/disclosure rules support formative review; they do not establish clinical competence or internal empathy.",
        })
    strengths = [a["label"] for a in assessments if a["result"] == "observed"]
    return {
        "status": "completed", "assessments": assessments,
        "strengths": strengths, "next_attempt": next((a["next_question"] for a in assessments if a["result"] == "missed"), "Repeat the encounter and ask faculty to review your reasoning."),
        "simulated_rapport": {"initial": encounter["initial_rapport"], "final": encounter["simulated_mood"]["rapport"], "label": "Simulation state, not an empathy or alliance score"},
        "assessment_kind": "Unvalidated formative authored-rule feedback; faculty review required",
    }
