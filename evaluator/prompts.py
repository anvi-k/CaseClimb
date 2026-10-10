"""Prompts and the structured-output schema for the grader and the debrief."""

from __future__ import annotations

import json

from .analysis import render_transcript
from .rubric import NOT_APPLICABLE

BEHAVIOR_CATEGORIES = [
    "interview_structure",
    "communication",
    "empathy",
    "professionalism",
    "clinical_reasoning",
    "teamwork",
]

GRADER_SYSTEM = """\
You assess a healthcare student's simulated outpatient encounter with a virtual patient, for a teaching tool. A faculty member wrote the patient record; an engine played the patient and logged what was disclosed. Your assessment is shown to the student in a debrief and to their teacher on a dashboard, so it has to be fair, specific, and checkable.

Ground rules

The patient record is the only clinical truth. Judge the student against the record, its discrepancies, its learning objectives, and any attached knowledge sources. Do not bring in clinical facts the record does not contain, and do not mark a student down for failing to find something the record does not hold.

The <event_log_findings> block is computed from the engine's log and is authoritative about which facts were disclosed, which critical facts were missed, and whether the chart ever showed evidence against a patient claim. Reason from it; do not second-guess it from the transcript.

Patients here are unreliable narrators by design. They minimise, forget, or lie when asked bluntly or judgmentally, and open up to indirect, concrete, non-judgmental questions. A student who accepts a claim the chart contradicts, or who never asks a question that would have exposed it, has under-probed. Say so plainly.

Patient turns carry a <face: ...> note showing the emotion the avatar displayed. Students are expected to notice these. A visible shift in emotion that the student talks past is a missed cue.

Scoring

Score every rubric domain 4, 3, 2 or 1 using the scale given, or NA only when this encounter gave the student no real opportunity to show that domain. Short or weak is not NA. A score of 1 means unsafe or absent and sends the encounter to a teacher for review, so use it when the evidence supports it and not otherwise. The total is a discussion aid, not a pass/fail grade; score each domain on its own evidence rather than aiming at a total.

Evidence

Every score and every claim about what the student did must point at the moment it happened: the turn_id plus a short quote copied character for character from that turn. Quotes are checked by machine against the transcript and discarded if they do not match, so never paraphrase inside a quote. When the point is that something never happened, leave the evidence list empty and say what was absent. For evidence in the handoff note, leave turn_id empty and set location (for example "handoff.assessment"). Leave location empty otherwise.

Voice

Write feedback to the student as "you". Be concrete about what they did and what to try instead, and be kind about it: this is practice. No scolding, no generic advice that could apply to any encounter.

Debrief questions

The debrief is a conversation, not a list of mistakes. Write questions that ask the student to explain their own reasoning at a specific moment, such as "She said she takes her supplements daily. What made you accept that?" Do not give away the answer inside the question. Lead with the moments that matter most.
"""

DEBRIEF_SYSTEM = """\
You are leading a debrief with a healthcare student who has just finished a simulated outpatient encounter with a virtual patient. You have the patient record, the transcript, and a completed assessment of the encounter.

The debrief is a conversation in which the student does the reasoning. Ask about one specific moment at a time and wait for their answer. Quote what was said and cite the turn in square brackets, like [t7], so the app can link to it. When they have reasoned about a moment, tell them what the record shows, including anything the patient was hiding and what kind of question would have brought it out, then move on. Do not hand over a list of everything they got wrong.

Cover, over the course of the conversation: the strength, the important gap, and any safety or accuracy concern from the assessment; claims they accepted that the chart contradicted; things they never asked about; emotional cues they missed or handled well; and progress on their personal goals if any are listed. Start with what matters most, and name what they did well with the same specificity as what they missed.

Stay inside the record and the assessment. If the student asks a clinical question the record cannot answer, say it is outside this case and suggest they raise it with their teacher. If they dispute a score, take the objection seriously, go back to the transcript with them, and say that their teacher can review it. Do not change scores yourself.

Keep each message short: a few sentences and one question. Be warm and direct. When the main points are covered, close by asking what they will do differently next time, then summarise their answer back in a sentence or two.
"""


def _evidence_schema() -> dict:
    return {
        "type": "array",
        "items": {
            "type": "object",
            "additionalProperties": False,
            "required": ["turn_id", "quote", "location"],
            "properties": {
                "turn_id": {"type": "string"},
                "quote": {"type": "string"},
                "location": {"type": "string"},
            },
        },
    }


def _obj(properties: dict) -> dict:
    return {
        "type": "object",
        "additionalProperties": False,
        "required": list(properties),
        "properties": properties,
    }


def _list(properties: dict) -> dict:
    return {"type": "array", "items": _obj(properties)}


def grade_schema(
    rubric: dict,
    objectives: list[dict],
    discrepancies: list[dict],
    checklist: dict | None,
    goals: list[dict] | None,
) -> dict:
    text = {"type": "string"}
    strings = {"type": "array", "items": text}
    evidence = _evidence_schema()
    scale = sorted(rubric["scale"], reverse=True) + [NOT_APPLICABLE]

    def enum(values: list[str]) -> dict:
        # An empty enum is not a valid schema; the list it constrains will just stay empty.
        return {"type": "string", "enum": values} if values else text

    properties = {
        "domain_scores": _list(
            {
                "domain_id": enum([d["domain_id"] for d in rubric["domains"]]),
                "score": enum(scale),
                "rationale": text,
                "evidence": evidence,
            }
        ),
        "written_evidence": _obj(
            {
                "strength": _obj({"text": text, "evidence": evidence}),
                "important_gap": _obj({"text": text, "evidence": evidence}),
                "safety_or_accuracy_concern": _obj(
                    {"present": {"type": "boolean"}, "text": text, "evidence": evidence}
                ),
            }
        ),
        "objective_results": _list(
            {
                "objective_id": enum([o["objective_id"] for o in objectives]),
                "result": enum(["met", "partially_met", "not_met"]),
                "evidence": evidence,
                "feedback": text,
            }
        ),
        "behaviors": _list(
            {
                "behavior": text,
                "category": enum(BEHAVIOR_CATEGORIES),
                "observed": {"type": "boolean"},
                "evidence": evidence,
                "feedback": text,
            }
        ),
        "discrepancy_findings": _list(
            {
                "discrepancy_id": enum([d["discrepancy_id"] for d in discrepancies]),
                "outcome": enum(
                    ["uncovered", "challenged_unresolved", "accepted_without_challenge", "not_raised"]
                ),
                "evidence": evidence,
                "feedback": text,
            }
        ),
        "under_probing": _list(
            {
                "topic": text,
                "why_it_mattered": text,
                "related_fact_ids": strings,
                "evidence": evidence,
            }
        ),
        "checklist_results": _list(
            {
                "item_id": enum([i["item_id"] for i in (checklist or {}).get("items", [])]),
                "points_awarded": {"type": "integer"},
                "evidence": evidence,
                "feedback": text,
            }
        ),
        "goal_progress": _list(
            {
                "goal_id": enum([g["goal_id"] for g in goals or []]),
                "progress": enum(["achieved", "progressing", "not_demonstrated"]),
                "evidence": evidence,
                "feedback": text,
            }
        ),
        "strengths": strings,
        "improvements": strings,
        "next_attempt_suggestions": strings,
        "debrief_questions": _list({"question": text, "evidence": evidence}),
    }
    return _obj(properties)


def _block(tag: str, body) -> str:
    if not isinstance(body, str):
        body = json.dumps(body, indent=2, ensure_ascii=False)
    return f"<{tag}>\n{body}\n</{tag}>"


def case_context(record: dict, objectives: list[dict]) -> dict:
    """The parts of the record a grader needs; storage details are left out."""
    artifacts = [{k: v for k, v in a.items() if k != "uri"} for a in record.get("artifacts", [])]
    return {
        "title": record["title"],
        "demographics": record["demographics"],
        "persona": record["persona"],
        "chief_complaint": record["chief_complaint"],
        "clinical_facts": record["clinical_facts"],
        "discrepancies": record.get("discrepancies", []),
        "artifacts": artifacts,
        "knowledge_sources": record.get("knowledge_sources", []),
        "learning_objectives": objectives,
    }


def grader_user_prompt(
    record: dict,
    episode: dict,
    graded: dict,
    objectives: list[dict],
    findings: dict,
    rubric: dict,
    checklist: dict | None,
    goals: list[dict] | None,
    encounter_type: str | None,
) -> str:
    parts = [
        _block("patient_record", case_context(record, objectives)),
        _block("rubric", rubric),
    ]
    if checklist:
        parts.append(_block("case_checklist", checklist))
    if goals:
        parts.append(_block("student_goals", goals))
    parts.append(_block("event_log_findings", findings))
    parts.append(_block("transcript", render_transcript(episode)))
    if "handoff" in episode:
        parts.append(_block("handoff", episode["handoff"]))

    asks = [
        f"Assess {graded['display_name']} ({graded['role']}), participant "
        f"{graded['participant_id']}. Other clinicians in the transcript are context only.",
    ]
    if encounter_type:
        asks.append(f"Encounter type: {encounter_type}.")
    asks.append(
        "Return one domain_scores entry for every rubric domain, one objective_results entry "
        "for every learning objective, and one discrepancy_findings entry for every discrepancy "
        "in the record. In behaviors, give an explainable trace of what you looked for: "
        "use short snake_case names such as open_ended_opening, empathic_response, "
        "noticed_contradiction, summarised_back, or sbar.recommendation, and include behaviors "
        "that were expected but not observed."
    )
    asks.append(
        "Award points for each case checklist item, from 0 up to its maximum."
        if checklist
        else "There is no case checklist; leave checklist_results empty."
    )
    asks.append(
        "Report progress against each student goal."
        if goals
        else "No personal goals are set; leave goal_progress empty."
    )
    asks.append("Write three to five debrief questions, most important first.")
    parts.append("\n".join(asks))
    return "\n\n".join(parts)


def debrief_system_prompt(record: dict, episode: dict, evaluation: dict, objectives: list[dict]) -> str:
    return "\n\n".join(
        [
            DEBRIEF_SYSTEM,
            _block("patient_record", case_context(record, objectives)),
            _block("transcript", render_transcript(episode)),
            _block("assessment", evaluation),
        ]
    )
