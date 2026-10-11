"""Authorization and cancellation races at the shared HTTP/stream ledger boundary."""

import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from backend.access import COOKIE
from backend.models import Turn
from backend.streaming import StreamAuthorization
from test_access import gated, login
from test_backend import harness, publish, start
from backend.case_templates import case_template


def begin(client):
    return start(client, publish(client, case_template("communication-maya").model_dump()))


def test_stream_setup_requires_app_encounter_and_same_origin(gated, monkeypatch):
    client, _, app = gated
    monkeypatch.setenv("CASECLIMB_STREAM_WS_URL", "wss://stream.example.test/stream")
    assert client.post("/api/encounters/unknown/stream-ticket").status_code == 401
    login(client)
    eid, auth, _ = begin(client)
    assert client.post(f"/api/encounters/{eid}/stream-ticket").status_code == 401
    for path in ("stream-ticket", "speech/token", "stream-cancel"):
        headers = {**auth, "Origin": "https://foreign.example.test"}
        assert client.post(f"/api/encounters/{eid}/{path}", headers=headers, json={"request_id": "x"}).status_code == 403
    result = client.post(f"/api/encounters/{eid}/stream-ticket", headers=auth)
    assert result.status_code == 200, result.text
    assert result.headers["cache-control"] == "no-store"
    assert "token_hash" not in result.text and auth["Authorization"] not in result.text


def test_stream_session_reauthorization_checks_logout_and_expiry(gated):
    client, now, app = gated
    login(client)
    sid = app.state.access._claims(client.cookies.get(COOKIE))["sid"]
    assert app.state.access.session_active(sid)
    assert not app.state.access.session_active("unknown")
    client.post("/auth/logout")
    assert not app.state.access.session_active(sid)
    login(client)
    sid = app.state.access._claims(client.cookies.get(COOKIE))["sid"]
    now[0] += 14400
    assert not app.state.access.session_active(sid)


def test_internal_stream_subject_cannot_cross_encounters(harness):
    client, _, app = harness
    eid, _, _ = begin(client)
    other, _, _ = begin(client)
    subject = StreamAuthorization(other, app.state.store.get(f"encounter:{other}")["payload"]["token_hash"])
    with pytest.raises(HTTPException) as denied:
        app.state.encounter_record(eid, subject)
    assert denied.value.status_code == 401


def test_cancelled_worker_cannot_reserve_after_acknowledgement(harness):
    client, _, app = harness
    eid, auth, _ = begin(client)
    credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials=auth["Authorization"][7:])
    app.state.cancel_turn_by_request(eid, "cancel-first", credentials)
    with pytest.raises(HTTPException):
        app.state.submit_turn(eid, Turn(text="What do you enjoy?", request_id="cancel-first"), credentials, allowed=lambda: True)
    record = app.state.store.get(f"encounter:{eid}")["payload"]
    assert record["turn_count"] == 0 and record["pending_turn"] is None


def test_cancellation_winning_reservation_cas_rejects_late_worker(harness, monkeypatch):
    client, _, app = harness
    eid, auth, _ = begin(client)
    credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials=auth["Authorization"][7:])
    original = app.state.store.put
    raced = [False]

    def intercept(key, payload, revision, expires_at=None):
        pending = payload.get("pending_turn")
        if key == f"encounter:{eid}" and pending and not raced[0]:
            raced[0] = True
            app.state.cancel_turn_by_request(eid, "reservation-race", credentials)
        return original(key, payload, revision, expires_at)

    monkeypatch.setattr(app.state.store, "put", intercept)
    with pytest.raises(HTTPException):
        app.state.submit_turn(eid, Turn(text="What do you enjoy?", request_id="reservation-race"), credentials)
    record = app.state.store.get(f"encounter:{eid}")["payload"]
    assert raced[0] and record["turn_count"] == 0 and record["pending_turn"] is None


def test_cancel_route_rejects_arbitrary_identifiers_and_preserves_confirmed_turn(harness):
    client, _, app = harness
    eid, auth, _ = begin(client)
    result = client.post(f"/api/encounters/{eid}/turns", headers=auth, json={"request_id": "confirmed", "text": "What do you enjoy?"})
    assert result.status_code == 200
    for body in ({"request_id": "x", "connection_id": "foreign"}, {"request_id": "x/y"}, {}):
        assert client.post(f"/api/encounters/{eid}/stream-cancel", headers=auth, json=body).status_code == 422
    credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials=auth["Authorization"][7:])
    app.state.cancel_turn_by_request(eid, "confirmed", credentials)
    replay = client.post(f"/api/encounters/{eid}/turns", headers=auth, json={"request_id": "confirmed", "text": "What do you enjoy?"})
    assert replay.status_code == 200 and replay.json()["replayed"]
    assert replay.json()["state"]["confirmed_turns"] == 1
