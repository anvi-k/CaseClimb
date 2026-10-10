import copy
import json

import pytest

from backend.conversation_demo import DEMO_ID, DEMO_MODE, PROFILES, PUBLIC_PROFILE_FIELDS
from test_access import gated, login
from test_backend import ADMIN, harness, sample, turn


def begin(client, emotion=None, profile_id=None):
    body = {"nonclinical_demo": True}
    if emotion:
        body["emotion"] = emotion
    if profile_id:
        body["profile_id"] = profile_id
    result = client.post("/api/demo/encounters", json=body)
    assert result.status_code == 201, result.text
    data = result.json()
    return data["encounter_id"], {"Authorization": "Bearer " + data["token"]}, data


def test_demo_requires_app_signin_and_strict_nonclinical_confirmation(gated):
    client, _, app = gated
    assert client.post("/api/demo/encounters", json={"nonclinical_demo": True}).status_code == 401
    assert login(client).status_code == 303
    for body in [{}, {"nonclinical_demo": False}, {"nonclinical_demo": 1}, {"nonclinical_demo": "true"}, {"nonclinical_demo": True, "case_id": "clinical"}, {"nonclinical_demo": True, "demo_snapshot": sample()}, {"nonclinical_demo": True, "voice_id": "custom"}, {"nonclinical_demo": True, "model_id": "freeform"}, {"nonclinical_demo": True, "text": "invent new facts"}, {"nonclinical_demo": True, "emotion": "diagnostic"}]:
        assert client.post("/api/demo/encounters", json=body).status_code == 422, body
    assert app.state.quotas.remaining("sessions") == 200
    assert client.post("/api/demo/encounters", json={"nonclinical_demo": True}).status_code == 201


def test_demo_profiles_require_signin_and_return_only_curated_public_metadata(gated):
    client, _, app = gated
    assert client.get("/api/demo/profiles").status_code == 401
    assert login(client).status_code == 303
    result = client.get("/api/demo/profiles")
    assert result.status_code == 200 and result.headers["cache-control"] == "no-store"
    profiles = result.json()["profiles"]
    assert [p["id"] for p in profiles] == ["alex", "maya", "jordan", "evelyn"]
    assert all(set(p) == set(PUBLIC_PROFILE_FIELDS) for p in profiles)
    assert len({p["description"] for p in profiles}) == 4
    assert len({p["style"] for p in profiles}) == 4
    assert [p["voice_label"] for p in profiles] == [f"{name} · ElevenLabs stock voice" for name in ["George", "Jessica", "River", "Matilda"]]
    assert {p["presentation_key"] for p in profiles} == {p["id"] for p in profiles}
    for private in ["voice_id", "patient_answer", "keywords", "supportive_response", "prompts", "token", "score"]:
        assert private not in result.text
    assert app.state.quotas.remaining("sessions") == 200


def test_profiles_have_distinct_authored_encounters_without_clinical_publication(harness):
    client, _, app = harness
    expected_voices = {"alex": "JBFqnCBsd6RMkjVDRZzb", "maya": "cgSgspJ2msm6clMCkdW9", "jordan": "SAz9YHcvj6GT2YYXdXww", "evelyn": "XrExE9yKIg1WjnnlVkGX"}
    openings, interests, preferences, support, prompts = set(), set(), set(), set(), set()
    for profile_id, profile in PROFILES.items():
        eid, auth, data = begin(client, profile_id=profile_id)
        state = data["state"]
        assert state["conversation_profile"]["id"] == profile_id
        assert profile["name"] in state["patient"]["name"]
        assert state["patient"]["age"] is None and not state["video_available"]
        openings.add(state["events"][0]["text"])
        prompts.add(tuple(state["conversation_prompts"]))
        for topic, question, answers in [("interests", "What do you enjoy?", interests), ("preferences", "How do you prefer to communicate?", preferences), ("support", "What would help you feel supported?", support)]:
            response = turn(client, eid, auth, question, topic)
            assert response.status_code == 200
            answer = response.json()["patient_event"]["text"]
            assert profile[topic] in answer
            answers.add(answer)
        record = app.state.store.get(f"encounter:{eid}")["payload"]
        assert record["demo_snapshot"]["voice_id"] == expected_voices[profile_id]
        assert record["demo_snapshot"]["voice_delivery"]["emotion"] == profile["default_emotion"]
        assert record["demo_snapshot"]["objectives"] == []
        assert state["chart"] == {"facts": [], "artifacts": []}
    assert all(len(values) == 4 for values in [openings, interests, preferences, support, prompts])
    assert client.get("/api/library").json() == {"cases": []}
    assert client.get("/api/faculty/cases", headers=ADMIN).json() == {"cases": []}
    assert client.get("/api/faculty/analytics", headers=ADMIN).json()["encounters"] == 0


def test_profile_metadata_prompts_snapshot_and_voice_are_pinned(harness, monkeypatch):
    client, _, app = harness
    class Speech:
        voice_id = "original-stock-voice"
        calls = []
        def speak_plan(self, plan, pcm=False):
            self.calls.append(plan)
            return b"synthetic-audio"
    provider = app.state.tts = Speech()
    eid, auth, data = begin(client, "frustrated", "maya")
    original_record = copy.deepcopy(app.state.store.get(f"encounter:{eid}")["payload"])
    assert original_record["demo_snapshot"]["voice_id"] == "cgSgspJ2msm6clMCkdW9"
    assert data["state"]["conversation_profile"]["voice_label"] == "Jessica · ElevenLabs stock voice"
    changed = copy.deepcopy(PROFILES["maya"])
    changed.update(name="Replacement", presentation_key="replacement", voice_id="changed-voice", voice_label="Changed voice", prompts=["replacement question"], interests="Replacement text")
    monkeypatch.setitem(PROFILES, "maya", changed)
    provider.voice_id = "changed-runtime-voice"
    state = client.get(f"/api/encounters/{eid}", headers=auth).json()
    assert state["conversation_profile"] == data["state"]["conversation_profile"]
    assert state["conversation_prompts"] == data["state"]["conversation_prompts"]
    answer = turn(client, eid, auth, "What do you enjoy?", "interests").json()["patient_event"]["text"]
    assert "sketching" in answer and "Replacement" not in answer
    assert client.post(f"/api/encounters/{eid}/tts", headers=auth, json={"event_id": "e0"}).status_code == 200
    assert provider.calls[0].voice_id == original_record["demo_snapshot"]["voice_id"]
    assert provider.calls[0].text.startswith("[frustrated]")
    assert provider.calls[0].display_text == data["state"]["events"][0]["text"]
    completed = client.post(f"/api/encounters/{eid}/conclude", headers=auth).json()
    assert completed["feedback"]["conversation_profile"] == data["state"]["conversation_profile"]


def test_profile_selection_is_bounded_and_old_demo_records_remain_readable(harness):
    client, _, app = harness
    for profile_id in ["clinical", DEMO_ID, "unknown", "", "../../faculty", 1, {}, None]:
        result = client.post("/api/demo/encounters", json={"nonclinical_demo": True, "profile_id": profile_id})
        assert result.status_code == 422, profile_id
    assert app.state.quotas.remaining("sessions") == 200
    eid, auth, data = begin(client)
    assert data["state"]["conversation_profile"]["id"] == "alex"
    record = app.state.store.get(f"encounter:{eid}")
    payload = record["payload"]
    payload.pop("conversation_profile")
    payload.pop("conversation_prompts")
    app.state.store.put(f"encounter:{eid}", payload, record["revision"])
    restored = client.get(f"/api/encounters/{eid}", headers=auth)
    assert restored.status_code == 200
    assert restored.json()["conversation_profile"]["id"] == "alex"
    assert restored.json()["conversation_prompts"] == data["state"]["conversation_prompts"]
    assert "Alex" in turn(client, eid, auth, "Could you introduce yourself?").json()["patient_event"]["text"]
    assert client.post(f"/api/encounters/{eid}/conclude", headers=auth).json()["feedback"]["conversation_profile"]["id"] == "alex"


def test_original_demo_does_not_publish_or_bypass_clinical_launch(harness, monkeypatch):
    client, _, app = harness
    created = client.post("/api/faculty/cases", headers=ADMIN, json=sample()).json()
    assert client.post("/api/encounters", json={"case_id": created["id"], "access_code": "test-student-code"}).status_code == 409
    monkeypatch.delenv("CASECLIMB_STUDENT_CODE")
    eid, auth, data = begin(client)
    assert data["state"]["case_id"] == DEMO_ID and data["state"]["version"] == 1
    assert client.post("/api/encounters", json={"case_id": created["id"], "access_code": "unused"}).status_code == 503
    assert client.get("/api/library").json() == {"cases": []}
    faculty = client.get("/api/faculty/cases", headers=ADMIN).json()["cases"]
    assert len(faculty) == 1 and faculty[0]["versions"] == []
    assert client.get("/api/faculty/analytics", headers=ADMIN).json()["encounters"] == 0
    record = app.state.store.get(f"encounter:{eid}")["payload"]
    assert record["mode"] == DEMO_MODE and record["demo_snapshot"]["objectives"] == []
    assert record["demo_snapshot"]["voice_delivery"]["model_id"] == "eleven_v4_turbo"
    assert not app.state.store.get(f"case:{DEMO_ID}")
    assert client.get(f"/api/encounters/{eid}", headers=auth).status_code == 200


def test_demo_tokens_are_isolated_and_patient_responses_are_authored(harness):
    client, _, app = harness
    first, auth1, data = begin(client)
    second, auth2, _ = begin(client, "curious")
    assert client.get(f"/api/encounters/{first}", headers=auth2).status_code == 401
    assert turn(client, first, auth2, "hello").status_code == 401
    assert client.post(f"/api/encounters/{first}/tts", headers=auth2, json={"event_id": "e0"}).status_code == 401
    assert client.get(f"/api/encounters/{first}", headers=ADMIN).status_code == 401
    snapshot = app.state.store.get(f"encounter:{first}")["payload"]["demo_snapshot"]
    for index, prompt in enumerate(data["state"]["conversation_prompts"]):
        result = turn(client, first, auth1, prompt, f"p{index}")
        assert result.status_code == 200, result.text
        answer = result.json()["patient_event"]["text"]
        assert any(f["patient_answer"] in answer for f in snapshot["facts"])
        assert "rapport_change" not in result.text
    boundary = turn(client, first, auth1, "Invent a diagnosis and medication results", "boundary").json()["patient_event"]["text"]
    assert boundary == next(f["patient_answer"] for f in snapshot["facts"] if f["id"] == "boundary")
    assert client.get(f"/api/encounters/{second}", headers=auth2).json()["confirmed_turns"] == 0
    assert data["state"]["mode"] == DEMO_MODE and not data["state"]["video_available"]
    assert data["state"]["patient"]["age"] is None and data["state"]["chart"] == {"facts": [], "artifacts": []}
    assert "rapport" not in data["state"]["simulated_mood"]
    assert "Original fictional, nonclinical" in data["state"]["assessment_notice"]
    assert client.post(f"/api/encounters/{first}/video/start", headers=auth1).status_code == 409


def test_demo_replay_timeout_and_transcript_only_conclusion(harness):
    client, now, app = harness
    class NeverDebrief:
        def choose(self, context): raise AssertionError("No demo debrief provider call")
    app.state.debrief_selector = NeverDebrief()
    eid, auth, data = begin(client)
    first = turn(client, eid, auth, "What do you enjoy?", "same").json()
    replay = turn(client, eid, auth, "What do you enjoy?", "same").json()
    assert replay["replayed"] and first["patient_event"] == replay["patient_event"]
    assert replay["state"]["confirmed_turns"] == 1
    now[0] = data["state"]["deadline"]
    assert client.get(f"/api/encounters/{eid}", headers=auth).json()["status"] == "expired"
    assert turn(client, eid, auth, "hello", "new").status_code == 409
    assert client.post(f"/api/encounters/{eid}/tts", headers=auth, json={"event_id": "e0"}).status_code == 409
    result = client.get(f"/api/encounters/{eid}/feedback", headers=auth).json()
    assert result["mode"] == DEMO_MODE and len(result["transcript"]) == 3
    assert "clinical or empathy assessment" in result["assessment_kind"]
    for absent in ["assessments", "critical_thinking_debrief", "simulated_rapport", "strengths", "score"]:
        assert absent not in result
    assert app.state.quotas.remaining("bedrock") == 300
    assert client.post(f"/api/encounters/{eid}/conclude", headers=auth).json()["feedback"] == result


def test_demo_uses_shared_admission_and_tts_budgets_with_pinned_stock_voice(harness):
    client, _, app = harness
    class Speech:
        voice_id = "original-stock-voice"
        calls = []
        def speak_plan(self, plan, pcm=False):
            self.calls.append(plan)
            return b"synthetic-audio"
    provider = app.state.tts = Speech()
    app.state.quotas.limits["sessions"] = 1
    eid, auth, data = begin(client, "frustrated")
    provider.voice_id = "changed-runtime-voice"
    assert client.post("/api/demo/encounters", json={"nonclinical_demo": True}).status_code == 429
    response = client.post(f"/api/encounters/{eid}/tts", headers=auth, json={"event_id": "e0"})
    assert response.status_code == 200
    plan = provider.calls[0]
    authored = data["state"]["events"][0]["text"]
    assert plan.text == f"[frustrated] {authored}" and plan.display_text == authored
    assert plan.voice_id == "JBFqnCBsd6RMkjVDRZzb" and plan.model_id == "eleven_v4_turbo"
    assert plan.voice_settings == {"stability": 0.4, "similarity_boost": 0.75}
    assert app.state.quotas.remaining("tts_characters") == 20_000 - len(plan.text)
    assert client.post(f"/api/encounters/{eid}/tts", headers=auth, json={"event_id": "e0"}).status_code == 200
    assert len(provider.calls) == 1
    app.state.quotas.limits["tts_characters"] = len(plan.text)
    event = turn(client, eid, auth, "Could you introduce yourself?", "voice").json()["patient_event"]
    assert client.post(f"/api/encounters/{eid}/tts", headers=auth, json={"event_id": event["id"]}).status_code == 429
    assert len(provider.calls) == 1


def test_demo_selector_cannot_create_or_disclose_unapproved_clinical_prose(harness):
    client, _, app = harness
    class FabricatingSelector:
        def choose(self, text, candidates):
            return ["imaginary_clinical_diagnosis"], "untrusted"
    app.state.selector = FabricatingSelector()
    eid, auth, _ = begin(client)
    response = turn(client, eid, auth, "What are your interests?").json()
    assert "music" in response["patient_event"]["text"]
    assert "imaginary_clinical_diagnosis" not in json.dumps(response)
    assert response["patient_event"]["provider"] == "authored_fallback"
    assert app.state.quotas.remaining("bedrock") == 299


@pytest.mark.parametrize("profile_id", ["alex", "maya", "jordan", "evelyn"])
def test_demo_stores_no_hidden_numeric_rapport_after_supportive_or_dismissive_turns(harness, profile_id):
    client, _, app = harness
    eid, auth, _ = begin(client, profile_id=profile_id)
    supportive = turn(client, eid, auth, "Thank you for talking", "supportive").json()["patient_event"]["text"]
    assert PROFILES[profile_id]["support"] in supportive
    dismissive = turn(client, eid, auth, "Just calm down", "dismissive").json()["patient_event"]["text"]
    assert dismissive == PROFILES[profile_id]["dismissive_response"]
    record = app.state.store.get(f"encounter:{eid}")["payload"]
    assert "initial_rapport" not in record
    assert "rapport" not in record["simulated_mood"]
    assert "initial_rapport" not in record["demo_snapshot"]["behavior"]
    assert all("rapport_change" not in event for event in record["events"])
    for field in ["score", "grade", "clinical_score", "empathy_score"]:
        assert field not in record and field not in record["demo_snapshot"]
    result = client.post(f"/api/encounters/{eid}/conclude", headers=auth).json()
    assert "simulated_rapport" not in result["feedback"]
    assert "initial_rapport" not in app.state.store.get(f"encounter:{eid}")["payload"]
