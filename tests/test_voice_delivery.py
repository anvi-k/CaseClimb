import os

import pytest
from pydantic import ValidationError

from backend.models import CaseDraft, VoiceDelivery
from backend.providers import ElevenLabsTTS, speech_plan
from test_backend import ADMIN, approval_body, harness, publish, sample, start
from test_video import FakeVideo


@pytest.mark.parametrize("change", [{"model_id": "eleven_v3"}, {"model_id": "eleven_v4_turbo", "speed": 1.0}, {"model_id": "eleven_v4_turbo", "style": 0}, {"speed": 0.69}, {"speed": 1.21}, {"stability": -0.01}, {"similarity_boost": 1.01}, {"style": float("nan")}, {"emotion": "[shout private instructions]"}, {"emotion_source": "learner"}])
def test_voice_delivery_rejects_unsupported_models_fields_and_bounds(change):
    with pytest.raises(ValidationError):
        VoiceDelivery.model_validate(change)


def test_voice_plan_preserves_words_and_uses_bounded_fixed_emotion_tags():
    draft = sample()
    draft["voice_delivery"] = {"model_id": "eleven_v4_turbo", "emotion": "curious", "stability": 0.4, "similarity_boost": 0.8}
    case = CaseDraft.model_validate(draft)
    plan = speech_plan(case, "Authored clinical words remain exact.", {"mood": "frustrated"})
    assert plan.text == "[curious] Authored clinical words remain exact."
    assert plan.display_text == "Authored clinical words remain exact."
    assert plan.voice_settings == {"stability": 0.4, "similarity_boost": 0.8}
    case.voice_delivery.emotion_source = "simulated_mood"
    assert speech_plan(case, plan.display_text, {"mood": "anxious"}).text == "[worried] Authored clinical words remain exact."
    case.voice_delivery = VoiceDelivery.model_validate({"model_id": "eleven_multilingual_v2", "emotion": "frustrated", "style": 0.3, "speed": 0.9})
    v2 = speech_plan(case, plan.display_text)
    assert v2.text == v2.display_text
    assert v2.voice_settings == {"stability": 0.5, "similarity_boost": 0.75, "style": 0.3, "speed": 0.9}


def test_elevenlabs_plan_overrides_environment_and_applies_same_mp3_pcm_delivery(monkeypatch):
    calls = []

    class HTTP:
        def post(self, url, **kwargs):
            calls.append((url, kwargs))
            class Response:
                content = b"\x00\x00" * 24_000
                def raise_for_status(self): pass
            return Response()

    draft = sample()
    draft.update(voice_id="case-specific-voice", voice_delivery={"model_id": "eleven_v4_turbo", "emotion": "worried"})
    plan = speech_plan(CaseDraft.model_validate(draft), "Authored patient answer.")
    monkeypatch.setenv("CASECLIMB_TTS_MODEL", "unsupported-environment-model")
    provider = ElevenLabsTTS("server-private-key", "fallback-voice", HTTP())
    provider.speak_plan(plan)
    provider.speak_plan(plan, pcm=True)
    for url, body in calls:
        assert url.endswith("/case-specific-voice")
        assert body["json"] == {"text": "[worried] Authored patient answer.", "model_id": "eleven_v4_turbo", "voice_settings": {"stability": 0.5, "similarity_boost": 0.75}}
    assert calls[0][1]["params"]["output_format"] == "mp3_22050_32"
    assert calls[1][1]["params"]["output_format"] == "pcm_24000"


class PlannedSpeech:
    def __init__(self):
        self.calls = []

    def speak_pcm(self, text, voice_id):
        raise AssertionError("Typed plan must be used")

    def speak_plan(self, plan, pcm=False):
        self.calls.append((plan, pcm))
        return b"\x00\x00" * 24_000


def test_case_version_pins_voice_and_model_and_both_formats_charge_tags(harness):
    client, _, app = harness
    speech = app.state.tts = app.state.video.tts = PlannedSpeech()
    app.state.video.client = FakeVideo()
    draft = sample()
    draft.update(voice_id="original-voice", voice_delivery={"model_id": "eleven_v4_turbo", "emotion": "frustrated", "stability": 0.35})
    case_id = publish(client, draft)
    eid, auth, data = start(client, case_id)
    revised = sample()
    revised.update(voice_id="new-voice", voice_delivery={"model_id": "eleven_multilingual_v2", "style": 0.1, "speed": 0.9})
    revision = client.get(f"/api/faculty/cases/{case_id}", headers=ADMIN).json()["revision"]
    assert client.put(f"/api/faculty/cases/{case_id}?expected_revision={revision}", headers=ADMIN, json=revised).status_code == 200
    assert client.post(f"/api/faculty/cases/{case_id}/approve", headers=ADMIN, json=approval_body(client, case_id)).status_code == 200
    assert client.post(f"/api/encounters/{eid}/tts", headers=auth, json={"event_id": "e0"}).status_code == 200
    assert client.post(f"/api/encounters/{eid}/video/start", headers=auth).status_code == 200
    assert client.post(f"/api/encounters/{eid}/video/audio", headers=auth, json={"event_id": "e0"}).status_code == 200
    assert len(speech.calls) == 2
    authored = data["state"]["events"][0]["text"]
    for plan, pcm in speech.calls:
        assert plan.voice_id == "original-voice" and plan.model_id == "eleven_v4_turbo"
        assert plan.display_text == authored and plan.text == f"[frustrated] {authored}"
    assert [pcm for _, pcm in speech.calls] == [False, True]
    assert app.state.quotas.remaining("tts_characters") == 20_000 - 2 * len(f"[frustrated] {authored}")
    state = client.get(f"/api/encounters/{eid}", headers=auth).json()
    assert state["events"][0]["text"] == authored and "[frustrated]" not in state["events"][0]["text"]
    client.post(f"/api/encounters/{eid}/tts", headers=auth, json={"event_id": "e0"})
    client.post(f"/api/encounters/{eid}/video/audio", headers=auth, json={"event_id": "e0"})
    assert len(speech.calls) == 2


def test_speech_late_after_expiry_is_discarded_without_paid_retry(harness):
    client, now, app = harness
    class Late:
        calls = 0
        def speak(self, text, voice_id):
            self.calls += 1
            now[0] += 601
            return b"audio"
    provider = app.state.tts = Late()
    eid, auth, _ = start(client, publish(client))
    assert client.post(f"/api/encounters/{eid}/tts", headers=auth, json={"event_id": "e0"}).status_code == 502
    assert client.post(f"/api/encounters/{eid}/tts", headers=auth, json={"event_id": "e0"}).status_code == 409
    assert provider.calls == 1
