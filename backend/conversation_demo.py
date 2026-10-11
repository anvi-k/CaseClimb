"""Legacy conversation snapshots and shared synthetic personality source."""

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

# Only this server-owned catalogue can determine persona text, presentation,
# delivery defaults, and voice. It contains no imported patient material.
PROFILES = {
    "alex": {
        "id": "alex", "name": "Alex", "style": "Guarded",
        "description": "Quiet at first; values patience, short explanations, and room to think.",
        "presentation_key": "alex", "default_emotion": "worried",
        "voice_label": "George · ElevenLabs stock voice", "voice_id": "JBFqnCBsd6RMkjVDRZzb",
        "opening": "I'm Alex, a fictional person here for a practice conversation. I'm feeling a little overwhelmed. Could we start slowly?",
        "introduction": "I'm Alex. I'm a fictional conversation partner, and I'm happy to practice talking with you.",
        "feelings": "I feel a little overwhelmed because I don't know what to expect from this practice conversation. Going slowly would help.",
        "preferences": "I prefer one question at a time, a short explanation, and a moment to think. It's easier when we check that we've understood each other.",
        "interests": "I enjoy listening to music, reading fiction, and going for nature walks. Talking about ordinary interests helps me settle into a conversation.",
        "support": "It helps when you listen without rushing and ask what I need. Thank you for making this a low-pressure conversation.",
        "closing": "Thank you for practicing with me. I'd like to finish by summarizing what we talked about in simple words.",
        "supportive_response": "Thank you for listening. That makes this practice feel easier. What would you like to talk about?",
        "dismissive_response": "I'd be more comfortable if we slowed down and listened to one another.",
        "prompts": PROMPTS,
    },
    "maya": {
        "id": "maya", "name": "Maya", "style": "Anxious and thoughtful",
        "description": "Thinks carefully before answering; appreciates a clear outline and reassurance.",
        "presentation_key": "maya", "default_emotion": "worried",
        "voice_label": "Jessica · ElevenLabs stock voice", "voice_id": "cgSgspJ2msm6clMCkdW9",
        "opening": "Hi, I'm Maya, a fictional conversation partner. I tend to overthink new situations. Could you tell me how our practice conversation will go?",
        "introduction": "I'm Maya. I'm here for this fictional practice, and I like knowing a little about someone before I open up.",
        "feelings": "I'm a little anxious about saying the wrong thing. I have lots of thoughts, and sometimes I need a pause to put them into words.",
        "preferences": "Please give me a simple outline first and let me finish my thought. Gentle follow-up questions help me work out what I mean.",
        "interests": "I enjoy sketching, baking bread, and tending to my houseplants. Doing something with my hands helps me slow down and focus.",
        "support": "It helps when you remind me that there is no perfect answer here. A little reassurance and an unhurried pause make me feel supported.",
        "closing": "Could we finish by naming one thing we understood about each other? That would help me leave the conversation feeling settled.",
        "supportive_response": "Thank you for making space for my thoughts. I feel more comfortable taking a moment to answer.",
        "dismissive_response": "Being told to calm down makes it harder to find my words. Could you give me a little time instead?",
        "prompts": ["Could you introduce yourself?", "What feels uncertain about this practice?", "Would an outline make this easier?", "How much time do you like to think?", "What do you enjoy making?", "What reassurance would help you feel supported?"],
    },
    "jordan": {
        "id": "jordan", "name": "Jordan", "style": "Curious and direct",
        "description": "Asks questions freely; prefers straightforward answers and a clear purpose.",
        "presentation_key": "jordan", "default_emotion": "curious",
        "voice_label": "River · ElevenLabs stock voice", "voice_id": "SAz9YHcvj6GT2YYXdXww",
        "opening": "Hey, I'm Jordan, a fictional conversation partner. I'm curious about this practice. What's the goal, and where should we start?",
        "introduction": "I'm Jordan. In this fictional practice I like asking questions, comparing ideas, and getting to the point.",
        "feelings": "I feel curious and ready to try this. I get restless if I don't understand the purpose, so I may ask a few direct questions.",
        "preferences": "I prefer straightforward explanations and a clear reason for a question. Tell me the main point first, then we can explore details together.",
        "interests": "I enjoy cycling, strategy board games, and trying new recipes. I like activities where I can experiment and see what changes.",
        "support": "I feel supported when you invite my questions and give me a choice about what we discuss. Clear answers work better for me than vague reassurance.",
        "closing": "Let's finish with the main takeaway and one question we could explore next. I like leaving with something concrete.",
        "supportive_response": "Thanks for hearing me out. Let's be direct with each other and keep the questions coming.",
        "dismissive_response": "I'd rather you explain what you mean than tell me how to feel. Could we get back to a clear conversation?",
        "prompts": ["Could you introduce yourself?", "What are you curious about in this practice?", "Do you prefer the main point or the details first?", "How do you like to ask questions?", "What do you enjoy experimenting with?", "What choices would help you feel supported?"],
    },
    "evelyn": {
        "id": "evelyn", "name": "Evelyn", "style": "Calm and reflective",
        "description": "Enjoys thoughtful discussion; values listening, shared understanding, and a steady pace.",
        "presentation_key": "evelyn", "default_emotion": "calm",
        "voice_label": "Matilda · ElevenLabs stock voice", "voice_id": "XrExE9yKIg1WjnnlVkGX",
        "opening": "Hello, I'm Evelyn, a fictional conversation partner. I'm happy to take our time. What would you like us to understand about one another today?",
        "introduction": "I'm Evelyn. I'm part of this fictional practice, and I enjoy conversations that leave room for reflection.",
        "feelings": "I feel calm and interested in listening. I don't mind a quiet moment; sometimes that is when I figure out what matters most to me.",
        "preferences": "I prefer an open question and a steady pace. Listening to each other's answers and briefly summarizing what we heard helps us understand one another.",
        "interests": "I enjoy gardening, visiting local museums, and writing letters to friends. I like noticing small details and staying connected to people.",
        "support": "I feel supported when you listen with interest and check whether your summary fits what I meant. I appreciate being included in how the conversation moves forward.",
        "closing": "Let's reflect on what we learned about each other and leave a little room for anything we haven't said yet.",
        "supportive_response": "Thank you for listening so carefully. It gives us room to think together.",
        "dismissive_response": "I'd like us to speak with a little more care. Let's pause and make sure we understand each other.",
        "prompts": ["Could you introduce yourself?", "How are you feeling about this practice?", "What makes an open question useful to you?", "Do you like a quiet moment to reflect?", "What do you enjoy noticing in your free time?", "How can we check that you feel understood?"],
    },
}

PUBLIC_PROFILE_FIELDS = ("id", "name", "description", "style", "presentation_key", "voice_label", "default_emotion")


def public_profile(profile_id="alex"):
    profile = PROFILES[profile_id]
    return {key: copy.deepcopy(profile[key]) for key in PUBLIC_PROFILE_FIELDS}


def profile_prompts(profile_id="alex"):
    return list(PROFILES[profile_id]["prompts"])


class StartDemo(StrictModel):
    nonclinical_demo: Literal[True]
    profile_id: Literal["alex", "maya", "jordan", "evelyn"] = "alex"
    emotion: Literal["neutral", "worried", "frustrated", "curious", "calm"] | None = None

    @field_validator("nonclinical_demo", mode="before")
    @classmethod
    def explicit_confirmation(cls, value):
        if value is not True:
            raise ValueError("Explicit nonclinical_demo:true is required.")
        return value


def demo_case(voice_id=None, emotion=None, profile_id="alex"):
    """Internal adapter to reuse disclosure/audio; never validate or publish it."""
    profile = PROFILES[profile_id]
    emotion = emotion or profile["default_emotion"]
    source = "Original CaseClimb nonclinical synthetic conversation demonstration"
    topics = [
        ("introduction", "Introduction", ["hello", "hi", "hey", "name", "introduce", "who are you"]),
        ("feelings", "Feelings about practice", ["feel", "feeling", "how are you", "overwhelmed", "nervous", "worried", "anxious", "concern", "difficult", "uncertain", "curious"]),
        ("preferences", "Communication preferences", ["prefer", "preference", "question", "explain", "explanation", "slow", "pace", "easier", "communication", "understand", "outline", "time", "think", "main point", "details", "reflect"]),
        ("interests", "Ordinary interests", ["enjoy", "interest", "interests", "hobby", "hobbies", "free time", "fun", "music", "read", "reading", "books", "walk", "walks", "making", "experimenting", "noticing"]),
        ("support", "Helpful support", ["support", "help", "listen", "listening", "comfort", "comfortable", "need", "thank you", "reassure", "reassurance", "choices", "understood"]),
        ("closing", "Closing the practice", ["goodbye", "bye", "finish", "finished", "wrap up", "next step"]),
    ]
    boundary = "This demonstration only covers communication and ordinary interests. Could we return to how we make a practice conversation feel comfortable?"
    facts = [{"id": key, "label": label, "text": profile[key], "patient_answer": profile[key], "audience": "patient", "keywords": words, "source": source} for key, label, words in topics]
    facts.append({"id": "boundary", "label": "Nonclinical boundary", "text": boundary, "patient_answer": boundary, "audience": "patient", "keywords": ["diagnosis", "diagnose", "medicine", "medication", "medications", "meds", "symptom", "symptoms", "test", "tests", "results", "treatment", "clinical"], "source": source})
    mood = {"neutral": "guarded", "worried": "anxious", "frustrated": "frustrated", "curious": "receptive", "calm": "receptive"}[emotion]
    return CaseDraft.model_validate({
        "title": f"A conversation with {profile['name']}", "patient_name": f"{profile['name']} · fictional conversation partner", "age": 35,
        "setting": "Nonclinical conversation practice", "summary": profile["description"],
        "synthetic": True, "opening": profile["opening"],
        "fallback_answer": "Could you ask about how I feel, how I prefer to communicate, what helps me feel supported, or what I enjoy in my free time?",
        "facts": facts, "artifacts": [], "objectives": [], "voice_id": profile["voice_id"] or voice_id,
        "voice_delivery": {"model_id": "eleven_v4_turbo", "emotion": emotion, "emotion_source": "faculty", "stability": 0.4, "similarity_boost": 0.75},
        "behavior": {"mood": mood, "supportive_response": profile["supportive_response"], "dismissive_response": profile["dismissive_response"]},
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
            "conversation_profile": copy.deepcopy(encounter.get("conversation_profile", public_profile())),
            "notice": NOTICE, "transcript_notice": "Long turns are excerpted here; the full confirmed transcript remains in the encounter ledger.",
            "assessment_kind": "Transcript only; no clinical or empathy assessment"}
