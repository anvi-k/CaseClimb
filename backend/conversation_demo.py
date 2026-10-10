"""Original nonclinical conversation demo; never a clinical published case."""

import copy
from typing import Literal

from pydantic import field_validator

from .models import CaseDraft, StrictModel

DEMO_ID = "caseclimb-original-conversation-demo"
DEMO_MODE = "conversation_demo"
NOTICE = "Original fictional, nonclinical conversation demonstration. No faculty clinical approval, clinical advice, empathy score, or competence assessment. Replies are authored demonstration text."
PROMPTS = [
    "Could you introduce yourself?",
    "How are you feeling about this practice conversation?",
    "What makes it easier for you to talk?",
    "Would you prefer one question at a time?",
    "What do you enjoy in your free time?",
    "What would help you feel supported?",
]


class StartDemo(StrictModel):
    nonclinical_demo: Literal[True]
    emotion: Literal["neutral", "worried", "frustrated", "curious", "calm"] = "worried"

    @field_validator("nonclinical_demo", mode="before")
    @classmethod
    def explicit_confirmation(cls, value):
        if value is not True:
            raise ValueError("Explicit nonclinical_demo:true is required.")
        return value


def demo_case(voice_id=None, emotion="worried"):
    """Internal adapter to reuse disclosure/audio; never validate or publish it."""
    opening = "I'm Alex, a fictional person here for a practice conversation. I'm feeling a little overwhelmed. Could we start slowly?"
    source = "Original CaseClimb nonclinical synthetic conversation demonstration"
    topics = [
        ("introduction", "Introduction", ["hello", "hi", "hey", "name", "introduce", "who are you"], "I'm Alex. I'm a fictional conversation partner, and I'm happy to practice talking with you."),
        ("feelings", "Feelings about practice", ["feel", "feeling", "how are you", "overwhelmed", "nervous", "worried", "anxious", "concern", "difficult"], "I feel a little overwhelmed because I don't know what to expect from this practice conversation. Going slowly would help."),
        ("preferences", "Communication preferences", ["prefer", "preference", "question", "explain", "explanation", "slow", "pace", "easier", "communication", "understand"], "I prefer one question at a time, a short explanation, and a moment to think. It's easier when we check that we've understood each other."),
        ("interests", "Ordinary interests", ["enjoy", "interest", "interests", "hobby", "hobbies", "free time", "fun", "music", "read", "reading", "books", "walk", "walks"], "I enjoy listening to music, reading fiction, and going for nature walks. Talking about ordinary interests helps me settle into a conversation."),
        ("support", "Helpful support", ["support", "help", "listen", "listening", "comfort", "comfortable", "need", "thank you", "reassure"], "It helps when you listen without rushing and ask what I need. Thank you for making this a low-pressure conversation."),
        ("closing", "Closing the practice", ["goodbye", "bye", "finish", "finished", "wrap up", "next step"], "Thank you for practicing with me. I'd like to finish by summarizing what we talked about in simple words."),
        ("boundary", "Nonclinical boundary", ["diagnosis", "diagnose", "medicine", "medication", "medications", "meds", "symptom", "symptoms", "test", "tests", "results", "treatment", "clinical"], "This demonstration only covers communication and ordinary interests. Could we return to how we make a practice conversation feel comfortable?"),
    ]
    mood = {"neutral": "guarded", "worried": "anxious", "frustrated": "frustrated", "curious": "receptive", "calm": "receptive"}[emotion]
    return CaseDraft.model_validate({
        "title": "Live spoken conversation demo", "patient_name": "Alex · fictional conversation partner", "age": 35,
        "setting": "Nonclinical conversation practice", "summary": "Original fictional communication demonstration with authored replies; no clinical content or grades.",
        "synthetic": True, "opening": opening,
        "fallback_answer": "Could you ask about how I feel, how I prefer to communicate, what helps me feel supported, or what I enjoy in my free time?",
        "facts": [{"id": key, "label": label, "text": answer, "patient_answer": answer, "audience": "patient", "keywords": words, "source": source} for key, label, words, answer in topics],
        "artifacts": [], "objectives": [], "voice_id": voice_id,
        "voice_delivery": {"model_id": "eleven_v4_turbo", "emotion": emotion, "emotion_source": "faculty", "stability": 0.4, "similarity_boost": 0.75},
        "behavior": {"mood": mood,
                     "supportive_response": "Thank you for listening. That makes this practice feel easier. What would you like to talk about?",
                     "dismissive_response": "I'd be more comfortable if we slowed down and listened to one another."},
        "author_note": source + "; not imported, faculty-reviewed, or a clinical case.",
    })


def is_demo(encounter):
    return encounter.get("mode") == DEMO_MODE


def public_event(event):
    result = copy.deepcopy(event)
    result.pop("rapport_change", None)
    return result


def demo_feedback(encounter):
    transcript = [{"id": e["id"], "actor": e["actor"], "text": e["text"][:250], "excerpt": len(e["text"]) > 250, "timestamp": e["timestamp"], "confirmed": True} for e in encounter["events"]]
    return {"status": "completed", "mode": DEMO_MODE, "transcript": transcript,
            "notice": NOTICE, "transcript_notice": "Long turns are excerpted here; the full confirmed transcript remains in the encounter ledger.",
            "assessment_kind": "Transcript only; no clinical or empathy assessment"}
