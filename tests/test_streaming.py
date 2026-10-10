import base64
import copy
import threading
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from fastapi import HTTPException

from backend.streaming import StreamAuthorization, StreamService
from test_backend import harness, publish, start


class PCMStream:
    def __init__(self):
        self.calls, self.closed, self.completed, self.reads = [], False, False, 0
        self.on_next = None

    def stream_plan(self, plan, *, chunk_bytes):
        self.calls.append(plan)
        try:
            for n in range(3):
                if self.on_next:
                    self.on_next(n)
                self.reads += 1
                yield bytes([n, 0]) * 2400
            self.completed = True
        finally:
            self.closed = True


@pytest.fixture
def streaming(harness, monkeypatch):
    client, now, app = harness
    monkeypatch.setenv("CASECLIMB_STREAM_WS_URL", "wss://stream.example.test/stream")
    monkeypatch.setenv("CASECLIMB_APP_ORIGIN", "http://testserver")
    eid, auth, _ = start(client, publish(client))
    record = app.state.encounter_record(eid, type("Bearer", (), {"credentials": auth["Authorization"].split()[1]})())
    pcm = app.state.tts = PCMStream()
    frames, queued = [], []
    service = StreamService(app, lambda cid, data: frames.append((cid, copy.deepcopy(data))), queued.append)
    ticket = service.mint_ticket(record, None, "http://testserver")
    token = parse_qs(urlparse(ticket["websocket_url"]).query)["ticket"][0]
    service.connect("connection-one", token, "http://testserver")
    return service, frames, queued, pcm, client, now, app, eid, auth, record


def enqueue(streaming, message=None):
    service, _, queued, *_ = streaming
    service.dispatch("connection-one", message or {"action": "turn", "request_id": "r1", "text": "How are you feeling?", "audio": True})
    return queued[-1]


def test_ticket_origin_single_use_deadline_and_revocation(streaming, monkeypatch):
    service, _, _, _, _, now, app, _, _, record = streaming
    ticket = service.mint_ticket(record, None, "http://testserver")
    token = parse_qs(urlparse(ticket["websocket_url"]).query)["ticket"][0]
    with pytest.raises(HTTPException) as error:
        service.connect("bad-origin", token, "https://untrusted.test")
    assert error.value.status_code == 401
    service.connect("fresh", token, "http://testserver")
    with pytest.raises(HTTPException):
        service.connect("reused", token, "http://testserver")
    ticket = service.mint_ticket(record, None, "http://testserver")
    token = parse_qs(urlparse(ticket["websocket_url"]).query)["ticket"][0]
    now[0] += 61
    with pytest.raises(HTTPException):
        service.connect("expired", token, "http://testserver")
    monkeypatch.setattr(app.state.access, "session_active", lambda sid: False)
    with pytest.raises(HTTPException):
        service.dispatch("fresh", {"action": "ping"})


def test_incremental_audio_precedes_provider_completion_and_cache_replay(streaming):
    service, frames, _, pcm, _, _, app, eid, _, _ = streaming
    job = enqueue(streaming)
    observations = []
    original_send = service.send
    def send(cid, frame):
        if frame["type"] == "audio.chunk":
            observations.append(pcm.completed)
        original_send(cid, frame)
    service.send = send
    before = app.state.quotas.remaining("tts_characters")
    service.worker(job["connection_id"], job["job_id"])
    types = [frame["type"] for _, frame in frames]
    assert types == ["turn.confirmed", "audio.start", "audio.chunk", "audio.chunk", "audio.chunk", "audio.end"]
    assert observations == [False, False, False]
    assert pcm.closed and pcm.completed
    chunks = [frame for _, frame in frames if frame["type"] == "audio.chunk"]
    assert [chunk["sequence"] for chunk in chunks] == [0, 1, 2]
    assert all(len(base64.b64decode(chunk["audio"])) == 4800 for chunk in chunks)
    assert len(pcm.calls) == 1
    used = len(pcm.calls[0].text)
    assert app.state.quotas.remaining("tts_characters") == before - used
    event_id = frames[0][1]["patient_event"]["id"]
    replay = enqueue(streaming, {"action": "speak", "request_id": "replay1", "event_id": event_id})
    service.worker(replay["connection_id"], replay["job_id"])
    assert len(pcm.calls) == 1
    assert app.state.quotas.remaining("tts_characters") == before - used
    assert frames[-5][1]["cached"] is True
    assert app.state.store.get(f"encounter:{eid}")["payload"]["turn_count"] == 1


def test_duplicate_dispatch_and_duplicate_worker_never_charge_twice(streaming):
    service, frames, _, pcm, _, _, app, eid, _, _ = streaming
    job = enqueue(streaming)
    with pytest.raises(HTTPException):
        enqueue(streaming)
    with pytest.raises(HTTPException):
        enqueue(streaming, {"action": "turn", "request_id": "r1", "text": "different", "audio": True})
    entered, release = threading.Event(), threading.Event()
    pcm.on_next = lambda n: (entered.set(), release.wait(3)) if n == 0 else None
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(service.worker, job["connection_id"], job["job_id"])
        assert entered.wait(2)
        service.worker(job["connection_id"], job["job_id"])
        release.set()
        first.result()
    assert len(pcm.calls) == 1
    assert app.state.store.get(f"encounter:{eid}")["payload"]["turn_count"] == 1
    assert sum(frame["type"] == "audio.end" for _, frame in frames) == 1


def test_cancel_mid_audio_closes_upstream_and_never_paid_retries(streaming):
    service, frames, _, pcm, _, _, app, eid, _, _ = streaming
    job = enqueue(streaming)
    original = service.send
    def interrupt(cid, frame):
        original(cid, frame)
        if frame["type"] == "audio.chunk":
            service.dispatch(cid, {"action": "cancel", "request_id": "r1"})
    service.send = interrupt
    service.worker(job["connection_id"], job["job_id"])
    assert pcm.closed and pcm.reads == 1 and not pcm.completed
    assert not any(frame["type"] == "audio.end" for _, frame in frames)
    assert any(frame.get("code") == "cancelled" for _, frame in frames)
    assert app.state.store.get(f"stream:job:{job['job_id']}")["payload"]["status"] == "cancelled"
    service.send = original
    event_id = frames[0][1]["patient_event"]["id"]
    replay = enqueue(streaming, {"action": "speak", "request_id": "retry1", "event_id": event_id})
    service.worker(replay["connection_id"], replay["job_id"])
    assert len(pcm.calls) == 1


def test_cancel_before_reservation_prevents_late_commit_and_frees_next_request(streaming):
    service, frames, _, pcm, _, _, app, eid, _, _ = streaming
    job = enqueue(streaming)
    entered, release = threading.Event(), threading.Event()
    original = app.state.submit_turn
    def delayed(*args, **kwargs):
        entered.set()
        release.wait(3)
        return original(*args, **kwargs)
    app.state.submit_turn = delayed
    with ThreadPoolExecutor(max_workers=2) as pool:
        active = pool.submit(service.worker, job["connection_id"], job["job_id"])
        assert entered.wait(2)
        service.dispatch("connection-one", {"action": "cancel", "request_id": "r1"})
        release.set()
        active.result()
    stored = app.state.store.get(f"encounter:{eid}")["payload"]
    assert stored["turn_count"] == 0 and stored["pending_turn"] is None
    assert pcm.calls == []
    app.state.submit_turn = original
    next_job = enqueue(streaming, {"action": "turn", "request_id": "next1", "text": "How are you?", "audio": False})
    service.worker(next_job["connection_id"], next_job["job_id"])
    assert app.state.store.get(f"encounter:{eid}")["payload"]["turn_count"] == 1


def test_reconnect_invalidates_old_worker_and_old_cancel_cannot_touch_new_work(streaming):
    service, _, queued, pcm, _, _, app, eid, _, record = streaming
    old = enqueue(streaming)
    ticket = service.mint_ticket(record, None, "http://testserver")
    token = parse_qs(urlparse(ticket["websocket_url"]).query)["ticket"][0]
    service.connect("connection-two", token, "http://testserver")
    with pytest.raises(HTTPException):
        service.dispatch("connection-one", {"action": "cancel", "request_id": "new1"})
    service.worker(old["connection_id"], old["job_id"])
    assert pcm.calls == []
    service.dispatch("connection-two", {"action": "turn", "request_id": "new1", "text": "How are you?", "audio": False})
    new = queued[-1]
    service.disconnect("connection-one")
    service.worker(new["connection_id"], new["job_id"])
    assert app.state.store.get(f"encounter:{eid}")["payload"]["turn_count"] == 1


def test_reconnect_releases_active_provider_nonce_before_accepting_new_turn(streaming):
    service, _, queued, pcm, _, _, app, eid, _, record = streaming
    entered, release = threading.Event(), threading.Event()
    class DelayedSelector:
        def choose(self, text, candidates):
            entered.set()
            release.wait(3)
            return [item["id"] for item in candidates], "test_selection"
    app.state.selector = DelayedSelector()
    old = enqueue(streaming, {"action": "turn", "request_id": "old1", "text": "What are you worried about?", "audio": True})
    with ThreadPoolExecutor(max_workers=2) as pool:
        worker = pool.submit(service.worker, old["connection_id"], old["job_id"])
        assert entered.wait(2)
        assert app.state.store.get(f"encounter:{eid}")["payload"]["pending_turn"]["request_id"] == "old1"
        ticket = service.mint_ticket(record, None, "http://testserver")
        token = parse_qs(urlparse(ticket["websocket_url"]).query)["ticket"][0]
        service.connect("connection-two", token, "http://testserver")
        snapshot = app.state.store.get(f"encounter:{eid}")["payload"]
        assert snapshot["pending_turn"] is None
        assert "old1" in snapshot["cancelled_stream_requests"]
        app.state.selector = None
        service.dispatch("connection-two", {"action": "turn", "request_id": "new1", "text": "How are you?", "audio": False})
        new = queued[-1]
        service.worker(new["connection_id"], new["job_id"])
        release.set()
        worker.result()
    final = app.state.store.get(f"encounter:{eid}")["payload"]
    assert final["turn_count"] == 1 and final["pending_turn"] is None
    assert not pcm.calls
    assert final["requests"]["old1"]["status"] == "failed"
    assert final["requests"]["new1"]["status"] == "confirmed"


@pytest.mark.parametrize("mode", ["expired", "revoked", "closed"])
def test_authorization_rechecked_before_every_audio_chunk(streaming, monkeypatch, mode):
    service, frames, _, pcm, client, now, app, eid, auth, _ = streaming
    job = enqueue(streaming)
    def change(n):
        if n != 1:
            return
        if mode == "expired":
            now[0] += 601
        elif mode == "revoked":
            monkeypatch.setattr(app.state.access, "session_active", lambda sid: False)
        else:
            client.post(f"/api/encounters/{eid}/conclude", headers=auth)
    pcm.on_next = change
    service.worker(job["connection_id"], job["job_id"])
    assert sum(frame["type"] == "audio.chunk" for _, frame in frames) == 1
    assert not any(frame["type"] == "audio.end" for _, frame in frames)
    assert pcm.closed


def test_large_ledger_confirmation_uses_refresh_pointer_not_oversized_gateway_frame(streaming):
    service, frames, _, _, _, _, app, eid, _, _ = streaming
    record = app.state.store.get(f"encounter:{eid}")
    encounter = record["payload"]
    encounter["events"].extend({"id": f"old{i}", "actor": "learner", "text": "x" * 1000, "timestamp": 1000, "confirmed": True} for i in range(30))
    app.state.store.put(f"encounter:{eid}", encounter, record["revision"])
    job = enqueue(streaming, {"action": "turn", "request_id": "r1", "text": "How are you?", "audio": False})
    service.worker(job["connection_id"], job["job_id"])
    confirmation = frames[0][1]
    assert confirmation["type"] == "turn.confirmed" and confirmation["refresh_required"]
    assert "state" not in confirmation and confirmation["patient_event"]["actor"] == "patient"


def test_scribe_tokens_reserve_full_remaining_seconds_and_never_persist_secret(streaming, monkeypatch):
    service, _, _, _, _, now, app, eid, _, record = streaming
    monkeypatch.setenv("CASECLIMB_STT_ENABLED", "true")
    calls = []
    class Tokens:
        def realtime_token(self):
            calls.append(True)
            return "secret-single-use-token"
    app.state.tts = Tokens()
    before = app.state.quotas.remaining("stt_seconds")
    result = service.speech_token(record, None)
    assert result["token"] == "secret-single-use-token" and result["reserved_seconds"] == 600
    assert app.state.quotas.remaining("stt_seconds") == before - 600
    now[0] += 100
    assert service.speech_token(record, None)["reserved_seconds"] == 500
    with pytest.raises(HTTPException) as error:
        service.speech_token(record, None)
    assert error.value.status_code == 429 and len(calls) == 2
    assert "secret-single-use-token" not in str(app.state.store.list("stream:"))


def test_scribe_permission_error_is_sanitized_and_attempt_stays_reserved(streaming, monkeypatch):
    service, _, _, _, _, _, app, _, _, record = streaming
    monkeypatch.setenv("CASECLIMB_STT_ENABLED", "true")
    class MissingPermission:
        def realtime_token(self):
            request = httpx.Request("POST", "https://api.elevenlabs.io/token")
            response = httpx.Response(401, request=request)
            raise httpx.HTTPStatusError("private-provider-details", request=request, response=response)
    app.state.tts = MissingPermission()
    before = app.state.quotas.remaining("stt_seconds")
    with pytest.raises(HTTPException) as error:
        service.speech_token(record, None)
    assert error.value.status_code == 503 and "private-provider-details" not in error.value.detail
    assert app.state.quotas.remaining("stt_seconds") == before - 600


def test_fake_clinical_text_or_bad_action_cannot_trigger_speech(streaming):
    service, _, _, pcm, *_ = streaming
    for message in [{"action": "speak", "request_id": "r1", "event_id": "hidden-fact"}, {"action": "speak", "request_id": "r1", "event_id": "e0", "text": "invented clinical content"}, {"action": "turn", "request_id": "../bad", "text": "Hi"}]:
        with pytest.raises(HTTPException):
            service.dispatch("connection-one", message)
    assert pcm.calls == []


def test_ttl_survives_worker_claim_finish_cancel_and_disconnect(streaming):
    service, _, _, _, _, _, app, _, _, record = streaming
    ttl = int(record["payload"]["started_at"] + 86400)
    job = enqueue(streaming, {"action": "turn", "request_id": "r1", "text": "How are you?", "audio": False})
    service.worker(job["connection_id"], job["job_id"])
    assert app.state.store.get(f"stream:job:{job['job_id']}")["expires_at"] == ttl
    assert app.state.store.get("stream:connection:connection-one")["expires_at"] == ttl
    another = enqueue(streaming, {"action": "speak", "request_id": "s1", "event_id": "e0"})
    service.dispatch("connection-one", {"action": "cancel", "request_id": "s1"})
    assert app.state.store.get(f"stream:job:{another['job_id']}")["expires_at"] == ttl
    service.disconnect("connection-one")
    assert app.state.store.get("stream:connection:connection-one")["expires_at"] == ttl


def test_cancel_before_speak_job_creation_prevents_billing_after_ack(streaming, monkeypatch):
    service, _, queued, pcm, _, _, app, eid, auth, _ = streaming
    real_put = app.state.store.put
    before = app.state.quotas.remaining("tts_characters")
    interrupted = []
    def racing_put(key, *args, **kwargs):
        if key.startswith("stream:job:") and not interrupted:
            interrupted.append(True)
            service.cancel(eid, "s1", type("Bearer", (), {"credentials": auth["Authorization"].split()[1]})())
        return real_put(key, *args, **kwargs)
    monkeypatch.setattr(app.state.store, "put", racing_put)
    service.dispatch("connection-one", {"action": "speak", "request_id": "s1", "event_id": "e0"})
    job = queued[-1]
    service.worker(job["connection_id"], job["job_id"])
    assert interrupted and not pcm.calls
    assert app.state.quotas.remaining("tts_characters") == before


def test_cumulative_audio_cannot_queue_playback_past_encounter_deadline(streaming):
    service, frames, _, pcm, _, now, app, eid, _, _ = streaming
    now[0] = app.state.store.get(f"encounter:{eid}")["payload"]["deadline"] - 0.25
    job = enqueue(streaming, {"action": "speak", "request_id": "s1", "event_id": "e0"})
    service.worker(job["connection_id"], job["job_id"])
    assert sum(frame["type"] == "audio.chunk" for _, frame in frames) == 2
    assert not any(frame["type"] == "audio.end" for _, frame in frames)
    assert pcm.closed


def test_expired_queue_emits_terminal_error_and_releases_slot(streaming):
    service, frames, _, pcm, _, now, app, _, _, _ = streaming
    job = enqueue(streaming)
    now[0] += 61
    service.worker(job["connection_id"], job["job_id"])
    assert frames[-1][1]["code"] == "queue_expired" and not pcm.calls
    assert app.state.store.get("stream:connection:connection-one")["payload"]["current_job"] is None


def test_connection_token_rotation_invalidates_queued_worker(streaming):
    service, _, _, pcm, _, _, app, eid, _, _ = streaming
    job = enqueue(streaming)
    record = app.state.store.get(f"encounter:{eid}")
    record["payload"]["token_hash"] = "new-encounter-token-hash"
    app.state.store.put(f"encounter:{eid}", record["payload"], record["revision"])
    service.worker(job["connection_id"], job["job_id"])
    assert not pcm.calls
    assert app.state.store.get(f"stream:job:{job['job_id']}")["payload"]["status"] == "failed"


def test_lambda_dispatches_gateway_messages_and_limits_worker_runtime(monkeypatch):
    from backend import streaming_lambda
    calls = []
    class Runtime:
        def connect(self, *args): calls.append(("connect", args))
        def disconnect(self, *args): calls.append(("disconnect", args))
        def dispatch(self, *args): calls.append(("dispatch", args))
        def worker(self, *args, **kwargs): calls.append(("worker", args, kwargs))
    monkeypatch.setattr(streaming_lambda, "_service", Runtime())
    class Context:
        def get_remaining_time_in_millis(self): return 20_000
    event = {"requestContext": {"connectionId": "cid", "routeKey": "$connect"}, "headers": {"Origin": "https://app.test"}, "queryStringParameters": {"ticket": "one-use-token"}}
    assert streaming_lambda.handler(event, Context())["statusCode"] == 200
    assert calls[-1] == ("connect", ("cid", "one-use-token", "https://app.test"))
    event.update(requestContext={"connectionId": "cid", "routeKey": "$default"}, body='{"action":"ping"}')
    assert streaming_lambda.handler(event, Context())["statusCode"] == 200
    assert calls[-1] == ("dispatch", ("cid", {"action": "ping"}))
    assert streaming_lambda.handler({"caseclimb_stream_worker": True, "connection_id": "cid", "job_id": "jid"}, Context())["statusCode"] == 200
    assert calls[-1] == ("worker", ("cid", "jid"), {"seconds": 15.0})


def test_lambda_rejects_invalid_and_oversized_bodies_without_provider_details(monkeypatch):
    from backend import streaming_lambda
    class Runtime:
        def dispatch(self, *args): raise RuntimeError("private-api-key-or-provider-error")
        def _connection(self, *args): raise HTTPException(401, "private-session")
    monkeypatch.setattr(streaming_lambda, "_service", Runtime())
    context = {"connectionId": "cid", "routeKey": "$default"}
    for raw, status in [('not-json', 422), ('x' * 8193, 422), ('{"action":"ping"}', 503)]:
        result = streaming_lambda.handler({"requestContext": context, "body": raw}, None)
        assert result["statusCode"] == status
        assert "private" not in str(result)
