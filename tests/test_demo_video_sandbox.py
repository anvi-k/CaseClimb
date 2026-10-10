"""The nonclinical live demo must never fall through to a paid video session."""

import json

import pytest
from fastapi.testclient import TestClient

from backend.app import create_app
from backend.conversation_demo import PROFILES
from backend.video import LiveAvatarClient, SANDBOX_AVATAR_ID
from test_backend import ADMIN, harness, turn
from test_video import FakePCM, FakeVideo


def begin(client, profile_id="alex"):
    response = client.post("/api/demo/encounters", json={"nonclinical_demo": True, "profile_id": profile_id})
    assert response.status_code == 201, response.text
    data = response.json()
    return data["encounter_id"], {"Authorization": "Bearer " + data["token"]}, data


def configure(app, *, sandbox=True):
    video, pcm = FakeVideo(), FakePCM()
    video.sandbox = sandbox
    app.state.video.client = video
    app.state.video.sandbox = sandbox
    app.state.video.tts = app.state.tts = pcm
    return video, pcm


def test_adapter_forces_sandbox_wayne_cap_without_provider_agent():
    calls = []

    class HTTP:
        def post(self, url, **kwargs):
            calls.append((url, kwargs))

            class Response:
                def raise_for_status(self): pass
                def json(self): return {"data": {"session_id": "sandbox-one", "session_token": "private-session-token"}}

            return Response()

    provider = LiveAvatarClient("private-api-key", "invalid-override", HTTP(), sandbox=True)
    provider.prepare(600, "00000000-0000-4000-8000-000000000001")
    body = calls[0][1]["json"]
    assert body == {"mode": "LITE", "avatar_id": SANDBOX_AVATAR_ID, "is_sandbox": True,
                    "video_settings": {"quality": "low", "encoding": "H264"}, "max_session_duration": 60}
    assert calls[0][1]["headers"] == {"X-API-KEY": "private-api-key"}
    assert "agent" not in json.dumps(body) and "elevenlabs" not in json.dumps(body)


def test_explicit_configuration_builds_sandbox_without_default_avatar(harness, monkeypatch):
    _, now, prior_app = harness
    monkeypatch.setenv("CASECLIMB_LIVEAVATAR_SANDBOX", "true")
    monkeypatch.setenv("LIVEAVATAR_API_KEY", "private-test-key")
    monkeypatch.delenv("LIVEAVATAR_AVATAR_ID", raising=False)
    app = create_app(prior_app.state.store, lambda: now[0], tts=FakePCM())
    assert isinstance(app.state.video.client, LiveAvatarClient)
    assert app.state.video.client.sandbox and app.state.video.client.avatar_id == SANDBOX_AVATAR_ID
    status = TestClient(app).get("/api/status")
    assert status.json()["demo_video_available"]
    assert status.json()["video_sandbox"]["enabled"]
    assert "private-test-key" not in status.text


def test_demo_cannot_use_ordinary_paid_client_or_flag_without_sandbox_client(harness):
    client, _, app = harness
    provider, _ = configure(app, sandbox=False)
    eid, auth, data = begin(client)
    assert not data["state"]["video_available"]
    assert not client.get("/api/status").json()["demo_video_available"]
    # An accidentally enabled service flag must not make an ordinary client free.
    app.state.video.sandbox = True
    for suffix, body in [("start", None), ("audio", {"event_id": "e0"})]:
        assert client.post(f"/api/encounters/{eid}/video/{suffix}", headers=auth, json=body).status_code == 409
    assert provider.prepared == [] and provider.activated == []
    assert app.state.quotas.remaining("video_sessions") == 2


def test_demo_sandbox_has_separate_deadline_and_idempotent_start(harness):
    client, now, app = harness
    provider, _ = configure(app)
    eid, auth, data = begin(client)
    assert data["state"]["video_available"]
    metadata = data["state"]["video_sandbox"]
    assert metadata["enabled"] and metadata["avatar_name"] == "Wayne" and metadata["max_seconds"] == 60
    assert "share Wayne" in metadata["notice"] and "selected fictional profile" in metadata["notice"]
    url = f"/api/encounters/{eid}/video/start"
    response = client.post(url, headers=auth)
    assert response.status_code == 200, response.text
    video = response.json()
    assert video["sandbox"] and video["avatar_name"] == "Wayne" and video["max_seconds"] == 60
    assert video["deadline"] == now[0] + 60 < data["state"]["deadline"]
    assert provider.prepared == [(60, SANDBOX_AVATAR_ID)]
    assert client.post(url, headers=auth).json() == video
    assert len(provider.activated) == 1
    assert app.state.quotas.remaining("video_sessions") == 1
    assert app.state.quotas.remaining("video_minutes") == 19
    public = client.get(f"/api/encounters/{eid}", headers=auth)
    for private in ["private-provider-jwt", "private-agent-token", "scoped-room-token", "wss://"]:
        assert private not in public.text


@pytest.mark.parametrize("profile_id", ["alex", "maya", "jordan", "evelyn"])
def test_demo_pcm_uses_pinned_stock_voice_and_stored_words(harness, profile_id):
    client, _, app = harness
    _, pcm = configure(app)
    eid, auth, data = begin(client, profile_id)
    assert client.post(f"/api/encounters/{eid}/video/start", headers=auth).status_code == 200
    url = f"/api/encounters/{eid}/video/audio"
    assert client.post(url, headers=auth, json={"event_id": "e0", "voice_id": "invented", "text": "arbitrary"}).status_code == 422
    audio = client.post(url, headers=auth, json={"event_id": "e0"})
    assert audio.status_code == 200, audio.text
    # v4's server-owned delivery tag precedes the exact captioned words.
    profile = PROFILES[profile_id]
    assert pcm.calls == [(f"[{profile['default_emotion']}] {data['state']['events'][0]['text']}", profile["voice_id"])]
    assert client.post(url, headers=auth, json={"event_id": "e0"}).json() == audio.json()
    assert len(pcm.calls) == 1


def test_video_ends_without_ending_conversation_or_restarting_provider(harness):
    client, now, app = harness
    provider, pcm = configure(app)
    eid, auth, _ = begin(client)
    started = client.post(f"/api/encounters/{eid}/video/start", headers=auth).json()
    now[0] = started["deadline"]
    state = client.get(f"/api/encounters/{eid}", headers=auth).json()
    assert state["status"] == "active" and state["remaining_seconds"] == 540
    assert state["video"]["status"] == "stopped" and len(provider.stopped) == 1
    assert state["tts_available"]
    assert turn(client, eid, auth, "What do you enjoy?", "after-video").status_code == 200
    assert client.post(f"/api/encounters/{eid}/video/start", headers=auth).status_code == 409
    assert client.post(f"/api/encounters/{eid}/video/audio", headers=auth, json={"event_id": "e0"}).status_code == 409
    assert len(provider.prepared) == 1 and pcm.calls == []


def test_sandbox_respects_remaining_encounter_startup_margin(harness):
    client, now, app = harness
    provider, _ = configure(app)
    eid, auth, data = begin(client)
    now[0] = data["state"]["deadline"] - 45
    response = client.post(f"/api/encounters/{eid}/video/start", headers=auth)
    assert response.status_code == 200
    assert provider.prepared == [(15, SANDBOX_AVATAR_ID)]
    assert response.json()["deadline"] == data["state"]["deadline"] - 30


def test_sandbox_rejects_short_window_before_reserving_provider_work(harness):
    client, now, app = harness
    provider, _ = configure(app)
    eid, auth, data = begin(client)
    now[0] = data["state"]["deadline"] - 30
    assert client.post(f"/api/encounters/{eid}/video/start", headers=auth).status_code == 409
    assert provider.prepared == [] and app.state.quotas.remaining("video_sessions") == 2


def test_sandbox_late_start_cleans_up_and_never_retries_provider(harness):
    client, now, app = harness
    provider, _ = configure(app)
    eid, auth, _ = begin(client)
    provider.on_activate = lambda: now.__setitem__(0, now[0] + 61)
    response = client.post(f"/api/encounters/{eid}/video/start", headers=auth)
    assert response.status_code == 502
    assert provider.stopped == [("video-one", "SERVER_ERROR")]
    assert client.post(f"/api/encounters/{eid}/video/start", headers=auth).status_code == 409
    assert len(provider.prepared) == 1
    assert "session_token" not in app.state.store.get(f"video:{eid}")["payload"]


def test_sandbox_token_acquired_after_cancel_is_cleaned_up(harness):
    client, _, app = harness
    provider, _ = configure(app)
    eid, auth, _ = begin(client)
    prepare = provider.prepare

    def cancel_during_token_request(duration, avatar_id=None):
        assert client.post(f"/api/encounters/{eid}/video/stop", headers=auth).status_code == 200
        return prepare(duration, avatar_id)

    provider.prepare = cancel_during_token_request
    response = client.post(f"/api/encounters/{eid}/video/start", headers=auth)
    assert response.status_code == 502
    assert provider.activated == []
    assert provider.stopped == [("video-one", "SERVER_ERROR")]
    record = app.state.store.get(f"video:{eid}")["payload"]
    assert record["status"] == "stopped" and "session_token" not in record


def test_sandbox_encounter_token_and_lifetime_quota_still_apply(harness):
    client, _, app = harness
    provider, pcm = configure(app)
    eid, auth, _ = begin(client)
    _, other_auth, _ = begin(client)
    for suffix, body in [("start", None), ("stop", None), ("audio", {"event_id": "e0"})]:
        assert client.post(f"/api/encounters/{eid}/video/{suffix}", headers=other_auth, json=body).status_code == 401
        assert client.post(f"/api/encounters/{eid}/video/{suffix}", headers=ADMIN, json=body).status_code == 401
    app.state.quotas.reserve("video_minutes", 20)
    assert not client.get(f"/api/encounters/{eid}", headers=auth).json()["video_available"]
    assert client.post(f"/api/encounters/{eid}/video/start", headers=auth).status_code == 503
    assert provider.prepared == [] and pcm.calls == []
