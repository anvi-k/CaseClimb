"""Editable patient case starters. Templates never confer reviewer approval."""

import json
from pathlib import Path

from .conversation_demo import PROFILES, demo_case
from .models import CaseDraft


TEMPLATES = [{"id": "clinical-history", "name": "Clinical history", "description": "An empty teaching case with placeholders for patient facts and learning objectives.", "focus": "clinical_history"}, *[
    {"id": f"communication-{key}", "name": f"Communication · {profile['name']}", "description": profile["description"], "focus": "communication"}
    for key, profile in PROFILES.items()
]]


def case_template(template_id: str) -> CaseDraft:
    if template_id == "clinical-history":
        return CaseDraft.model_validate(json.loads((Path(__file__).resolve().parent.parent / "frontend/template.json").read_text()))
    if template_id not in {item["id"] for item in TEMPLATES}:
        raise KeyError(template_id)
    profile_id = template_id.removeprefix("communication-")
    profile = PROFILES[profile_id]
    draft = demo_case(profile_id=profile_id).model_dump()
    draft.update(
        learning_focus="communication", presentation_key=profile_id,
        title=f"Getting to know {profile['name']}", patient_name=profile["name"],
        age={"alex": 35, "maya": 28, "jordan": 32, "evelyn": 68}[profile_id],
        setting="Outpatient clinic · first conversation",
        summary=f"Meet {profile['name']}, a synthetic patient. Explore their concerns, communication preferences, and what helps them feel supported.",
        opening={
            "alex": "I'm Alex. I'm feeling a little overwhelmed being here. Could we start slowly?",
            "maya": "Hi, I'm Maya. I tend to overthink new situations. Could you tell me how our conversation will go?",
            "jordan": "Hey, I'm Jordan. What's the purpose of today's visit, and where should we start?",
            "evelyn": "Hello, I'm Evelyn. I'm happy to take our time. What would you like to know about me today?",
        }[profile_id],
        author_note="Unreviewed synthetic communication case template. Ages and clinic context are fictional starter details; edit them as needed. No symptoms, diagnosis, medications, or tests are authored. Review all facts, disclosure rules, and objectives before publication.",
    )
    for fact in draft["facts"]:
        fact["source"] = "Original CaseClimb synthetic communication case template; requires faculty review"
        fact["audience"] = "both"
        text = fact["text"]
        for phrase in ["this practice conversation", "this fictional practice", "this practice", "a practice conversation"]:
            text = text.replace(phrase, "our conversation")
        if fact["id"] == "introduction":
            text = f"I'm {profile['name']}. This is my first conversation with you at the clinic."
        elif fact["id"] == "boundary":
            fact.update(label="Clinical details not authored", state="unknown")
            text = "Those medical details haven't been provided for this case. Could we talk about my concerns and how I prefer to communicate?"
        fact["text"] = fact["patient_answer"] = text
        fact["label"] = {"feelings": "Feelings about the visit", "closing": "Closing the conversation"}.get(fact["id"], fact["label"])
    draft["behavior"]["mood"] = {"alex": "guarded", "maya": "anxious", "jordan": "receptive", "evelyn": "receptive"}[profile_id]
    draft["behavior"]["supportive_response"] = profile["supportive_response"].replace("this practice", "this conversation")
    draft["behavior"]["dismissive_response"] = profile["dismissive_response"]
    draft["objectives"] = [
        {"id": "explore_preferences", "label": "Explore communication preferences", "required_fact_ids": ["preferences"], "keywords": ["prefer", "pace", "explain"], "guidance": "Ask the patient how they prefer to communicate and adapt your approach to their stated needs.", "next_question": "How would you like me to explain what happens next?"},
        {"id": "acknowledge_concerns", "label": "Acknowledge concerns and support needs", "required_fact_ids": ["feelings", "support"], "opportunity_fact_ids": ["feelings"], "keywords": ["understand", "sounds difficult", "support"], "guidance": "Explore what concerns the patient and what support they would find helpful. Discuss observable conversation evidence rather than judging internal empathy.", "next_question": "What feels most uncertain, and what would help you feel supported?", "debrief_focus": "acknowledge_emotion"},
        {"id": "summarize_together", "label": "Check shared understanding", "required_fact_ids": ["closing"], "keywords": ["summarize", "understood", "next step"], "guidance": "Summarize what you heard and invite the patient to correct or add to it.", "next_question": "Let me summarize what I heard. What would you change or add?", "debrief_focus": "summarize_next_step"},
    ]
    return CaseDraft.model_validate(draft)
