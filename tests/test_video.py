import base64
import json
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest

from backend.providers import ElevenLabsTTS
from backend.video import LiveAvatarClient
from test_backend import ADMIN, harness, publish, sample, start, turn


class FakeVideo:
    def __init__(self):
        self.prepared, self.activated, self.stopped = [], [], []
        self.on_activate = None
        self.fail_stop = False

    def prepare(self, duration, avatar_id=None):
        self.prepared.append((duration, avatar_id))
        return {"session_id": "video-one", "session_token": "private-provider-jwt"}

    def activate(self, token):
        self.activated.append(token)
        if self.on_activate:
            self.on_activate()
        return {"session_id": "video-one", "livekit_url": "wss://video.example.test", "livekit_client_token": "scoped-room-token", "livekit_agent_token": "private-agent-token", "ws_url": "wss://audio.example.test/scoped"}

    def stop(self, session_id, reason):
        self.stopped.append((session_id, reason))
        if self.fail_stop:
            raise RuntimeError("private-provider-error")


class FakePCM:
    def __init__(self):
        self.calls = []
        self.audio = b"\x00\x00" * 48_000
        self.on_speak = None

    def speak_pcm(self, text, voice_id):
        self.calls.append((text, voice_id))
        if self.on_speak:
            self.on_speak()
        return self.audio


def configure(app):
    video, pcm = FakeVideo(), FakePCM()
    app.state.video.client = video
    app.state.video.tts = app.state.tts = pcm
    return video, pcm


def test_video_off_and_encounter_tokens_scope_all_routes(harness):
    client, _, app = harness
    case_id = publish(client)
    eid, auth, _ = start(client, case_id)
    other, other_auth, _ = start(client, case_id)
    assert not client.get(f"/api/encounters/{eid}", headers=auth).json()["video_available"]
    assert client.post(f"/api/encounters/{eid}/video/start", headers=auth).status_code == 503
    video, _ = configure(app)
    for path, body in [("start", None), ("stop", None), ("audio", {"event_id": "e0"})]:
        assert client.post(f"/api/encounters/{eid}/video/{path}", headers=other_auth, json=body).status_code == 401
        assert client.post(f"/api/encounters/{eid}/video/{path}", headers=ADMIN, json=body).status_code == 401
    assert video.prepared == [] and video.stopped == []


def test_video_start_is_cached_private_and_provider_deadline_bounded(harness):
    client, now, app = harness
    video, _ = configure(app)
    eid, auth, encounter = start(client, publish(client))
    first = client.post(f"/api/encounters/{eid}/video/start", headers=auth)
    assert first.status_code == 200, first.text
    data = first.json()
    assert data["deadline"] == now[0] + 570 < encounter["state"]["deadline"]
    assert video.prepared == [(570, None)]
    assert "private-provider-jwt" not in first.text and "private-agent-token" not in first.text
    assert client.post(f"/api/encounters/{eid}/video/start", headers=auth).json() == data
    assert len(video.activated) == 1
    public = client.get(f"/api/encounters/{eid}", headers=auth)
    assert public.json()["video"] == {"status": "active", "deadline": data["deadline"]}
    for hidden in ["scoped-room-token", "private-provider-jwt", "wss://", "private-agent-token"]:
        assert hidden not in public.text and hidden not in client.get("/api/status").text
    assert app.state.quotas.remaining("video_sessions") == 1
    assert app.state.quotas.remaining("video_minutes") == 10
    assert client.post(f"/api/encounters/{eid}/conclude", headers=auth).status_code == 200
    assert len(video.stopped) == 1
    assert client.post(f"/api/encounters/{eid}/video/stop", headers=auth).json()["status"] == "stopped"
    assert len(video.stopped) == 1
    assert client.post(f"/api/encounters/{eid}/video/start", headers=auth).status_code == 409
    stored = app.state.store.get(f"video:{eid}")["payload"]
    assert "session_token" not in stored and "livekit_client_token" not in stored


def test_video_expiry_stops_and_prevents_audio_provider_cost(harness):
    client, now, app = harness
    video, pcm = configure(app)
    eid, auth, _ = start(client, publish(client))
    deadline = client.post(f"/api/encounters/{eid}/video/start", headers=auth).json()["deadline"]
    now[0] = deadline
    assert client.get(f"/api/encounters/{eid}", headers=auth).json()["video"]["status"] == "stopped"
    assert len(video.stopped) == 1
    assert client.post(f"/api/encounters/{eid}/video/audio", headers=auth, json={"event_id": "e0"}).status_code == 409
    assert pcm.calls == []


def test_video_concurrent_start_reserves_one_provider_attempt(harness):
    client, _, app = harness
    video, _ = configure(app)
    eid, auth, _ = start(client, publish(client))
    entered, release = threading.Event(), threading.Event()
    video.on_activate = lambda: (entered.set(), release.wait(5))
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(client.post, f"/api/encounters/{eid}/video/start", headers=auth)
        assert entered.wait(2)
        second = client.post(f"/api/encounters/{eid}/video/start", headers=auth)
        assert second.status_code == 409
        release.set()
        assert first.result().status_code == 200
    assert len(video.prepared) == len(video.activated) == 1
    assert app.state.quotas.remaining("video_sessions") == 1


def test_video_late_activation_and_uncertain_cleanup_are_bounded(harness):
    client, now, app = harness
    video, _ = configure(app)
    eid, auth, _ = start(client, publish(client))
    video.on_activate = lambda: now.__setitem__(0, now[0] + 601)
    video.fail_stop = True
    failed = client.post(f"/api/encounters/{eid}/video/start", headers=auth)
    assert failed.status_code == 502 and "private-provider-error" not in failed.text
    assert app.state.quotas.remaining("video_sessions") == 1
    assert client.post(f"/api/encounters/{eid}/video/start", headers=auth).status_code == 409
    before = len(video.stopped)
    client.post(f"/api/encounters/{eid}/video/stop", headers=auth)
    assert len(video.stopped) == before  # Backoff prevents rapid uncertain cleanup calls.
    for _ in range(4):
        now[0] += 11
        client.post(f"/api/encounters/{eid}/video/stop", headers=auth)
    assert app.state.store.get(f"video:{eid}")["payload"]["stop_attempts"] == 3
    assert "session_token" not in app.state.store.get(f"video:{eid}")["payload"]


def test_abandoned_video_start_recovers_without_restart(harness):
    client, now, app = harness
    video, _ = configure(app)
    eid, auth, _ = start(client, publish(client))
    app.state.store.put(f"video:{eid}", {"status": "starting", "created_at": now[0], "deadline": now[0] + 585, "lease_until": now[0] + 20, "session_id": "pending-video"}, None)
    now[0] += 21
    assert client.post(f"/api/encounters/{eid}/video/start", headers=auth).status_code == 409
    assert video.stopped == [("pending-video", "SERVER_ERROR")]
    assert video.prepared == []


def test_video_audio_is_authored_pcm_cached_and_not_arbitrary_text(harness):
    client, _, app = harness
    _, pcm = configure(app)
    eid, auth, encounter = start(client, publish(client))
    client.post(f"/api/encounters/{eid}/video/start", headers=auth)
    url = f"/api/encounters/{eid}/video/audio"
    assert client.post(url, headers=auth, json={"event_id": "e0", "text": "invented clinical answer"}).status_code == 422
    assert client.post(url, headers=auth, json={"event_id": "hidden-fact"}).status_code == 404
    audio = client.post(url, headers=auth, json={"event_id": "e0"})
    assert audio.status_code == 200, audio.text
    data = audio.json()
    assert (data["format"], data["sample_rate"], data["channels"], data["duration_seconds"]) == ("pcm_s16le", 24000, 1, 2.0)
    assert len(data["chunks"]) == 2
    assert b"".join(base64.b64decode(c) for c in data["chunks"]) == pcm.audio
    assert pcm.calls == [(encounter["state"]["events"][0]["text"], None)]
    assert client.post(url, headers=auth, json={"event_id": "e0"}).json() == data
    assert len(pcm.calls) == 1
    used = len(encounter["state"]["events"][0]["text"])
    assert app.state.quotas.remaining("tts_characters") == 20_000 - used


def test_cached_pcm_cannot_play_past_deadline_or_after_stop(harness):
    client, now, app = harness
    _, pcm = configure(app)
    eid, auth, _ = start(client, publish(client))
    deadline = client.post(f"/api/encounters/{eid}/video/start", headers=auth).json()["deadline"]
    url = f"/api/encounters/{eid}/video/audio"
    assert client.post(url, headers=auth, json={"event_id": "e0"}).status_code == 200
    now[0] = deadline - 1
    assert client.post(url, headers=auth, json={"event_id": "e0"}).status_code == 409
    client.post(f"/api/encounters/{eid}/video/stop", headers=auth)
    assert client.post(url, headers=auth, json={"event_id": "e0"}).status_code == 409
    assert len(pcm.calls) == 1


@pytest.mark.parametrize("bad_audio", [b"odd", b"", b"\x00" * 1_440_002])
def test_invalid_or_oversized_pcm_fails_without_automatic_retry(harness, bad_audio):
    client, _, app = harness
    _, pcm = configure(app)
    pcm.audio = bad_audio
    eid, auth, _ = start(client, publish(client))
    client.post(f"/api/encounters/{eid}/video/start", headers=auth)
    url = f"/api/encounters/{eid}/video/audio"
    assert client.post(url, headers=auth, json={"event_id": "e0"}).status_code == 502
    assert client.post(url, headers=auth, json={"event_id": "e0"}).status_code == 409
    assert len(pcm.calls) == 1


def test_video_global_minute_quota_denies_before_provider(harness):
    client, _, app = harness
    video, _ = configure(app)
    app.state.quotas.limits["video_minutes"] = 1
    eid, auth, _ = start(client, publish(client))
    denied = client.post(f"/api/encounters/{eid}/video/start", headers=auth)
    assert denied.status_code == 429
    assert video.prepared == []
    assert app.state.quotas.remaining("video_sessions") == 1  # Partial reservation is never refunded.
    assert client.post(f"/api/encounters/{eid}/video/start", headers=auth).status_code == 409


def test_liveavatar_adapter_uses_custom_lite_protocol_and_server_credentials():
    calls = []
    avatar = "00000000-0000-4000-8000-000000000001"

    class HTTP:
        def post(self, url, **kwargs):
            calls.append((url, kwargs))
            data = {"session_id": "s", "session_token": "jwt"} if url.endswith("/token") else {"livekit_url": "wss://room.example.test", "livekit_client_token": "room", "ws_url": "wss://audio.example.test"}
            class Response:
                def raise_for_status(self): pass
                def json(self): return {"data": data}
            return Response()

    provider = LiveAvatarClient("private-api-key", avatar, HTTP())
    token = provider.prepare(585)
    provider.activate(token["session_token"])
    provider.stop("s")
    body = calls[0][1]["json"]
    assert body == {"mode": "LITE", "avatar_id": avatar, "video_settings": {"quality": "low", "encoding": "H264"}, "max_session_duration": 585}
    assert calls[0][1]["headers"] == {"X-API-KEY": "private-api-key"}
    assert calls[1][1]["headers"] == {"Authorization": "Bearer jwt"}
    assert calls[2][1]["json"] == {"session_id": "s", "reason": "USER_CLOSED"}
    assert "eleven" not in json.dumps(body).lower() and "agent" not in json.dumps(body).lower()


def test_elevenlabs_pcm24_format_and_voice_requirement(harness):
    _, _, app = harness
    app.state.video.client = FakeVideo()
    app.state.video.tts = ElevenLabsTTS("private-key")
    assert not app.state.video.available()
    calls = []

    class HTTP:
        def post(self, url, **kwargs):
            calls.append((url, kwargs))
            class Response:
                content = b"\x00\x00" * 24_000
                def raise_for_status(self): pass
            return Response()

    audio = ElevenLabsTTS("private-key", "authored-voice", HTTP()).speak_pcm("Authored caption", None)
    assert len(audio) == 48_000
    assert calls[0][1]["params"] == {"output_format": "pcm_24000"}
    assert calls[0][1]["headers"]["xi-api-key"] == "private-key"
