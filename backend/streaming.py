"""Encounter-scoped streaming jobs; durable claims precede every paid attempt."""

import base64
import hashlib
import json
import math
import os
import re
import secrets
import uuid
from dataclasses import dataclass
from urllib.parse import urlencode, urlparse

import httpx
from fastapi import HTTPException

from .models import Turn
from .providers import speech_plan
from .store import Conflict

PROTOCOL = "caseclimb.stream.v1"
FRAME_BYTES = 8192
MAX_PCM_BYTES = 1_440_000
REQUEST_ID = re.compile(r"^[a-zA-Z0-9_-]{1,100}$")


def _digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


@dataclass(frozen=True)
class StreamAuthorization:
    encounter_id: str
    token_hash: str


class StreamService:
    def __init__(self, app, send=None, dispatch=None):
        self.app, self.send, self.invoke = app, send, dispatch
        self.store, self.clock, self.quotas = app.state.store, app.state.clock, app.state.quotas

    def _ttl(self, encounter):
        return int(encounter["started_at"] + 86400)

    def _encounter(self, connection):
        auth = StreamAuthorization(connection["encounter_id"], connection["token_hash"])
        record = self.app.state.encounter_record(connection["encounter_id"], auth)
        encounter = record["payload"]
        if encounter["status"] != "active" or self.clock() >= encounter["deadline"]:
            raise HTTPException(409, "The encounter has ended.")
        if not self.app.state.access.session_active(connection["sid"]):
            raise HTTPException(401, "App session is no longer active.")
        return encounter, auth

    def _connection(self, connection_id, job_id=None):
        record = self.store.get(f"stream:connection:{connection_id}")
        if not record or record["payload"].get("status") != "connected":
            raise HTTPException(401, "Streaming connection is not active.")
        connection = record["payload"]
        owner = self.store.get(f"stream:owner:{connection['encounter_id']}")
        if not owner or owner["payload"].get("connection_id") != connection_id or owner["payload"].get("generation") != connection["generation"]:
            raise HTTPException(401, "Streaming connection was replaced.")
        if job_id is not None and connection.get("current_job") != job_id:
            raise HTTPException(409, "Streaming request was interrupted.")
        encounter, auth = self._encounter(connection)
        return record, encounter, auth

    def _emit(self, connection_id, event):
        encoded = json.dumps(event, ensure_ascii=False).encode()
        if len(encoded) > 31_000:
            raise HTTPException(413, "Streaming frame exceeds the transport limit.")
        if self.send is None:
            raise HTTPException(503, "Streaming transport is not configured.")
        self.send(connection_id, event)

    def _count(self, key, maximum, ttl):
        for _ in range(10):
            record = self.store.get(key)
            used = record["payload"]["used"] if record else 0
            if used >= maximum:
                raise HTTPException(429, "Streaming attempt allowance exhausted.")
            try:
                self.store.put(key, {"used": used + 1}, record["revision"] if record else None, ttl)
                return
            except Conflict:
                continue
        raise HTTPException(409, "Streaming allowance changed concurrently.")

    def mint_ticket(self, record, sid, origin):
        encounter = record["payload"]
        self._encounter({"encounter_id": encounter["id"], "token_hash": encounter["token_hash"], "sid": sid})
        ws_url = os.getenv("CASECLIMB_STREAM_WS_URL", "")
        configured_origin = os.getenv("CASECLIMB_APP_ORIGIN")
        parsed = urlparse(origin)
        if parsed.scheme not in {"https", "http"} or not parsed.netloc or parsed.path not in {"", "/"} or parsed.query or parsed.fragment:
            raise HTTPException(403, "A valid app origin is required.")
        if configured_origin and origin.rstrip("/") != configured_origin.rstrip("/"):
            raise HTTPException(403, "Streaming requires the configured app origin.")
        if urlparse(ws_url).scheme not in {"wss", "ws"}:
            raise HTTPException(503, "Streaming transport is not configured.")
        self._count(f"stream:tickets:{encounter['id']}", 8, self._ttl(encounter))
        token = secrets.token_urlsafe(32)
        expiry = min(self.clock() + 60, encounter["deadline"])
        claims = {"encounter_id": encounter["id"], "token_hash": encounter["token_hash"], "sid": sid, "origin": origin.rstrip("/"), "expires_at": expiry, "generation": str(uuid.uuid4()), "used": False}
        self.store.put(f"stream:ticket:{_digest(token)}", claims, None, self._ttl(encounter))
        separator = "&" if "?" in ws_url else "?"
        return {"websocket_url": ws_url + separator + urlencode({"ticket": token}), "expires_at": expiry, "deadline": encounter["deadline"], "protocol": PROTOCOL}

    def connect(self, connection_id, ticket, origin):
        if not isinstance(ticket, str) or not 1 <= len(ticket) <= 200:
            raise HTTPException(401, "A streaming ticket is required.")
        key = f"stream:ticket:{_digest(ticket)}"
        record = self.store.get(key)
        claims = record["payload"] if record else {}
        if not record or claims.get("used") or self.clock() >= claims.get("expires_at", 0) or origin.rstrip("/") != claims.get("origin"):
            raise HTTPException(401, "Streaming ticket is invalid or expired.")
        encounter, _ = self._encounter(claims)
        claims["used"] = True
        try:
            self.store.put(key, claims, record["revision"], self._ttl(encounter))
        except Conflict:
            raise HTTPException(401, "Streaming ticket was already consumed.")
        connection = {k: claims[k] for k in ("encounter_id", "token_hash", "sid", "origin", "generation")}
        connection.update(status="connected", connected_at=self.clock(), current_job=None, expires_at=self._ttl(encounter))
        try:
            self.store.put(f"stream:connection:{connection_id}", connection, None, self._ttl(encounter))
        except Conflict:
            raise HTTPException(409, "Streaming connection already exists.")
        for _ in range(10):
            owner = self.store.get(f"stream:owner:{encounter['id']}")
            try:
                self.store.put(f"stream:owner:{encounter['id']}", {"connection_id": connection_id, "generation": claims["generation"]}, owner["revision"] if owner else None, self._ttl(encounter))
                if owner and owner["payload"].get("connection_id") != connection_id:
                    # Ownership changes before cleanup, invalidating every old
                    # worker guard. Release its turn nonce before acknowledging
                    # the replacement, so a fresh turn can start immediately.
                    self.disconnect(owner["payload"]["connection_id"])
                return {"status": "connected", "protocol": PROTOCOL}
            except Conflict:
                continue
        raise HTTPException(409, "Streaming connection ownership changed concurrently.")

    def _release(self, connection_id, job_id, *, disconnect=False):
        for _ in range(10):
            record = self.store.get(f"stream:connection:{connection_id}")
            if not record:
                return
            connection = record["payload"]
            if job_id is not None and connection.get("current_job") != job_id:
                return
            connection["current_job"] = None
            if disconnect:
                connection["status"] = "disconnected"
            try:
                self.store.put(f"stream:connection:{connection_id}", connection, record["revision"], connection["expires_at"])
                return
            except Conflict:
                continue

    def disconnect(self, connection_id):
        record = self.store.get(f"stream:connection:{connection_id}")
        if not record:
            return
        connection = record["payload"]
        job_id = connection.get("current_job")
        # Mark disconnected first: a worker cannot create a late turn reservation.
        self._release(connection_id, job_id, disconnect=True)
        if job_id:
            self._cancel_job(connection_id, job_id, emit=False)

    def _job_status(self, job_id, status, **fields):
        for _ in range(10):
            record = self.store.get(f"stream:job:{job_id}")
            if not record or record["payload"]["status"] in {"done", "cancelled", "failed"}:
                return
            payload = record["payload"]
            payload.update(status=status, **fields)
            try:
                self.store.put(f"stream:job:{job_id}", payload, record["revision"], payload["expires_at"])
                return
            except Conflict:
                continue

    def _cancel_job(self, connection_id, job_id, *, emit=True):
        record = self.store.get(f"stream:job:{job_id}")
        if not record or record["payload"]["connection_id"] != connection_id:
            return
        job = record["payload"]
        if job["status"] in {"done", "failed", "cancelled"}:
            self._release(connection_id, job_id)
            if emit:
                self._emit(connection_id, {"type": "stream.error", "request_id": job["request_id"], "code": "cancelled", "message": "Response interrupted."})
            return
        self._job_status(job_id, "cancelled")
        auth = StreamAuthorization(job["encounter_id"], job["token_hash"])
        self.app.state.cancel_turn_by_request(job["encounter_id"], job["request_id"], auth)
        self._release(connection_id, job_id)
        if emit:
            self._emit(connection_id, {"type": "stream.error", "request_id": job["request_id"], "code": "cancelled", "message": "Response interrupted."})

    def cancel(self, encounter_id, request_id, auth):
        if not isinstance(request_id, str) or not REQUEST_ID.fullmatch(request_id):
            raise HTTPException(422, "A valid request_id is required.")
        self.app.state.encounter_record(encounter_id, auth)
        pointer = self.store.get(f"stream:request:{encounter_id}:{request_id}")
        if pointer:
            job = self.store.get(f"stream:job:{pointer['payload']['job_id']}")
            if job:
                # HTTP cancellation names one durable request; it cannot release
                # a replacement connection's different pending request.
                self._cancel_job(job["payload"]["connection_id"], pointer["payload"]["job_id"], emit=False)
        self.app.state.cancel_turn_by_request(encounter_id, request_id, auth)
        return {"status": "cancelled", "request_id": request_id}

    def dispatch(self, connection_id, message):
        connection_record, encounter, auth = self._connection(connection_id)
        if not isinstance(message, dict) or len(json.dumps(message).encode()) > 8192:
            raise HTTPException(422, "A bounded streaming message is required.")
        action = message.get("action")
        if action == "ping" and set(message) == {"action"}:
            self._emit(connection_id, {"type": "pong", "server_time": self.clock()})
            return
        request_id = message.get("request_id")
        if not isinstance(request_id, str) or not REQUEST_ID.fullmatch(request_id):
            raise HTTPException(422, "A valid request_id is required.")
        if action == "cancel" and set(message) == {"action", "request_id"}:
            pointer = self.store.get(f"stream:request:{encounter['id']}:{request_id}")
            if pointer:
                job = self.store.get(f"stream:job:{pointer['payload']['job_id']}")
                if job and job["payload"]["connection_id"] == connection_id:
                    self._cancel_job(connection_id, pointer["payload"]["job_id"])
                    return
            # A cancellation that races dispatch is a durable tombstone too.
            self.app.state.cancel_turn_by_request(encounter["id"], request_id, auth)
            self._emit(connection_id, {"type": "stream.error", "request_id": request_id, "code": "cancelled", "message": "Response interrupted."})
            return
        if action == "turn" and set(message) <= {"action", "request_id", "text", "audio"}:
            request = Turn(request_id=request_id, text=message.get("text", ""))
            body = {"action": action, "request_id": request_id, "text": request.text.strip(), "audio": message.get("audio", True)}
            if not body["text"] or type(body["audio"]) is not bool:
                raise HTTPException(422, "A confirmed turn and boolean audio flag are required.")
        elif action == "speak" and set(message) == {"action", "request_id", "event_id"}:
            event_id = message["event_id"]
            if not isinstance(event_id, str) or not 1 <= len(event_id) <= 100:
                raise HTTPException(422, "A valid stored event_id is required.")
            if not any(e["id"] == event_id and e["actor"] == "patient" for e in encounter["events"]):
                raise HTTPException(404, "A stored patient event is required.")
            body = dict(message)
        else:
            raise HTTPException(422, "Unsupported streaming message.")
        body_hash = _digest(json.dumps(body, sort_keys=True))
        request_key = f"stream:request:{encounter['id']}:{request_id}"
        existing = self.store.get(request_key)
        if existing:
            if existing["payload"]["body_hash"] != body_hash:
                raise HTTPException(409, "request_id was already used for different content.")
            # A lost acknowledgement never authorizes another provider attempt.
            raise HTTPException(409, "Streaming request was already submitted. Read the encounter ledger before retrying explicitly.")
        self._count(f"stream:attempts:{encounter['id']}", 128, self._ttl(encounter))
        job_id = str(uuid.uuid4())
        connection = connection_record["payload"]
        current = connection.get("current_job")
        if current:
            current_record = self.store.get(f"stream:job:{current}")
            if current_record and current_record["payload"]["status"] in {"queued", "working"} and self.clock() < current_record["payload"]["lease_until"]:
                raise HTTPException(409, "Another response is still streaming.")
            if current_record:
                self._cancel_job(connection_id, current, emit=False)
            connection_record, _, _ = self._connection(connection_id)
            connection = connection_record["payload"]
        connection["current_job"] = job_id
        try:
            self.store.put(f"stream:connection:{connection_id}", connection, connection_record["revision"], self._ttl(encounter))
            self.store.put(request_key, {"job_id": job_id, "body_hash": body_hash}, None, self._ttl(encounter))
            job = {**body, "job_id": job_id, "connection_id": connection_id, "encounter_id": encounter["id"], "token_hash": encounter["token_hash"], "generation": connection["generation"], "status": "queued", "lease_until": min(self.clock() + 60, encounter["deadline"]), "expires_at": self._ttl(encounter)}
            self.store.put(f"stream:job:{job_id}", job, None, self._ttl(encounter))
        except Conflict:
            self._release(connection_id, job_id)
            raise HTTPException(409, "Streaming request changed concurrently.")
        try:
            if self.invoke is None:
                raise RuntimeError("Worker dispatch unavailable")
            self.invoke({"caseclimb_stream_worker": True, "connection_id": connection_id, "job_id": job_id})
        except Exception:
            self._job_status(job_id, "failed", reason="dispatch_failed")
            self._release(connection_id, job_id)
            raise HTTPException(503, "Streaming worker could not start. Read the ledger before an explicit retry.")

    def _guard(self, connection_id, job_id, worker_deadline):
        if self.clock() >= worker_deadline:
            raise HTTPException(409, "Streaming worker deadline elapsed.")
        record = self.store.get(f"stream:job:{job_id}")
        if not record or record["payload"]["status"] != "working":
            raise HTTPException(409, "Streaming request was interrupted.")
        _, encounter, auth = self._connection(connection_id, job_id)
        if record["payload"]["request_id"] in encounter.get("cancelled_stream_requests", []):
            raise HTTPException(409, "Streaming request was interrupted.")
        return encounter, auth

    def _allowed(self, connection_id, job_id, worker_deadline):
        try:
            self._guard(connection_id, job_id, worker_deadline)
            return True
        except HTTPException:
            return False

    def _audio(self, connection_id, job, event_id, worker_deadline):
        encounter, _ = self._guard(connection_id, job["job_id"], worker_deadline)
        event = next((e for e in encounter["events"] if e["id"] == event_id and e["actor"] == "patient"), None)
        if not event or not 1 <= len(event["text"]) <= 1000:
            raise HTTPException(422, "A bounded stored patient event is required for speech.")
        provider = self.app.state.tts
        if provider is None or not hasattr(provider, "stream_plan"):
            raise HTTPException(503, "Streaming speech provider is not configured.")
        case = self.app.state.case_snapshot(encounter)
        plan = speech_plan(case, event["text"], encounter["simulated_mood"])
        cache_key = f"stream:audio:{encounter['id']}:{event_id}"
        cached = self.store.get(cache_key)
        utterance_id = str(uuid.uuid4())
        envelope = {"request_id": job["request_id"], "event_id": event_id, "utterance_id": utterance_id}
        self._guard(connection_id, job["job_id"], worker_deadline)
        if cached:
            if cached["payload"]["status"] != "ready":
                raise HTTPException(409, "Speech was already attempted. No automatic provider retry is allowed.")
            if self.clock() + cached["payload"]["duration_seconds"] >= encounter["deadline"]:
                raise HTTPException(409, "Cached speech cannot finish before the encounter deadline.")
            # Explicit replay streams the existing audio without a paid request.
            self._emit(connection_id, {"type": "audio.start", **envelope, "format": "pcm_s16le", "sample_rate": 24000, "channels": 1, "deadline": encounter["deadline"], "cached": True})
            sequence = 0
            for group in range(cached["payload"]["groups"]):
                item = self.store.get(f"stream:pcm:{encounter['id']}:{event_id}:{group}")
                if not item:
                    raise HTTPException(409, "Cached speech has expired.")
                for audio in item["payload"]["chunks"]:
                    self._guard(connection_id, job["job_id"], worker_deadline)
                    self._emit(connection_id, {"type": "audio.chunk", **envelope, "sequence": sequence, "audio": audio})
                    sequence += 1
            self._guard(connection_id, job["job_id"], worker_deadline)
            self._emit(connection_id, {"type": "audio.end", **envelope, "chunks": sequence, "duration_seconds": cached["payload"]["duration_seconds"]})
            return
        try:
            reservation = self.store.put(cache_key, {"status": "pending", "job_id": job["job_id"]}, None, self._ttl(encounter))
        except Conflict:
            raise HTTPException(409, "Speech is already being streamed.")
        stream, outcome, reason = None, "failed", "speech_failed"
        total, sequence, groups, group, playback_started = 0, 0, 0, [], None
        try:
            if not self.quotas.reserve("tts_characters", len(plan.text)):
                raise HTTPException(429, "Workshop speech allowance exhausted.")
            self._guard(connection_id, job["job_id"], worker_deadline)
            self._emit(connection_id, {"type": "audio.start", **envelope, "format": "pcm_s16le", "sample_rate": 24000, "channels": 1, "deadline": encounter["deadline"]})
            stream = provider.stream_plan(plan, chunk_bytes=FRAME_BYTES)
            for pcm in stream:
                encounter, _ = self._guard(connection_id, job["job_id"], worker_deadline)
                if not isinstance(pcm, bytes) or not pcm or len(pcm) % 2 or len(pcm) > FRAME_BYTES:
                    raise ValueError("Invalid bounded PCM frame")
                total += len(pcm)
                if playback_started is None:
                    playback_started = self.clock()
                playback_end = max(playback_started + total / 48_000, self.clock() + len(pcm) / 48_000)
                if total > MAX_PCM_BYTES or playback_end >= encounter["deadline"]:
                    raise HTTPException(409, "Speech cannot finish before the encounter deadline.")
                audio = base64.b64encode(pcm).decode()
                self._emit(connection_id, {"type": "audio.chunk", **envelope, "sequence": sequence, "audio": audio})
                self._guard(connection_id, job["job_id"], worker_deadline)
                sequence += 1
                group.append(audio)
                if len(group) == 12:
                    self.store.put(f"stream:pcm:{encounter['id']}:{event_id}:{groups}", {"chunks": group}, None, self._ttl(encounter))
                    groups, group = groups + 1, []
            if not total:
                raise ValueError("Speech provider returned no audio")
            self._guard(connection_id, job["job_id"], worker_deadline)
            if group:
                self.store.put(f"stream:pcm:{encounter['id']}:{event_id}:{groups}", {"chunks": group}, None, self._ttl(encounter))
                groups += 1
            outcome, reason = "ready", None
            self.store.put(cache_key, {"status": outcome, "groups": groups, "duration_seconds": total / 48_000}, reservation["revision"], self._ttl(encounter))
            self._guard(connection_id, job["job_id"], worker_deadline)
            self._emit(connection_id, {"type": "audio.end", **envelope, "chunks": sequence, "duration_seconds": total / 48_000})
        finally:
            if stream is not None and hasattr(stream, "close"):
                stream.close()
            if outcome != "ready":
                try:
                    self.store.put(cache_key, {"status": outcome, "reason": reason}, reservation["revision"], self._ttl(encounter))
                except Conflict:
                    pass

    def worker(self, connection_id, job_id, *, seconds=55):
        record = self.store.get(f"stream:job:{job_id}")
        if not record or record["payload"]["status"] != "queued" or record["payload"]["connection_id"] != connection_id:
            return
        job = record["payload"]
        deadline = min(self.clock() + min(55, max(1, seconds)), job["lease_until"])
        if self.clock() >= job["lease_until"]:
            self._job_status(job_id, "failed", reason="queue_expired")
            self._release(connection_id, job_id)
            try:
                self._connection(connection_id)
                self._emit(connection_id, {"type": "stream.error", "request_id": job["request_id"], "code": "queue_expired", "message": "Streaming request expired before it could start. Retry explicitly if time remains."})
            except Exception:
                pass
            return
        try:
            self._connection(connection_id, job_id)
            job.update(status="working", lease_until=deadline)
            self.store.put(f"stream:job:{job_id}", job, record["revision"], job["expires_at"])
        except Conflict:
            # Another invocation owns the claim; never release its connection.
            return
        except HTTPException:
            self._job_status(job_id, "failed", reason="authorization_expired")
            self._release(connection_id, job_id)
            return
        try:
            encounter, auth = self._guard(connection_id, job_id, deadline)
            if job["action"] == "turn":
                result = self.app.state.submit_turn(encounter["id"], Turn(request_id=job["request_id"], text=job["text"]), auth, allowed=lambda: self._allowed(connection_id, job_id, deadline))
                self._guard(connection_id, job_id, deadline)
                confirmation = {"type": "turn.confirmed", "request_id": job["request_id"], **result, "audio_requested": job["audio"]}
                if len(json.dumps(confirmation, ensure_ascii=False).encode()) > 24_000:
                    confirmation.pop("state", None)
                    confirmation.update(refresh_required=True, confirmed_turns=result["state"]["confirmed_turns"], latestlearner_event=next((e for e in reversed(result["state"]["events"]) if e["actor"] == "learner"), None))
                self._emit(connection_id, confirmation)
                event_id = result["patient_event"]["id"]
                if job["audio"]:
                    self._audio(connection_id, job, event_id, deadline)
            else:
                self._audio(connection_id, job, job["event_id"], deadline)
            self._job_status(job_id, "done")
        except Exception as error:
            self._job_status(job_id, "failed", reason="stream_failed")
            try:
                self.app.state.cancel_turn_by_request(job["encounter_id"], job["request_id"], StreamAuthorization(job["encounter_id"], job["token_hash"]))
                self._connection(connection_id)
                status = error.status_code if isinstance(error, HTTPException) else 502
                code = {401: "authorization", 403: "authorization", 429: "quota_exhausted", 422: "invalid_request", 409: "interrupted", 503: "unavailable"}.get(status, "provider_failed")
                self._emit(connection_id, {"type": "stream.error", "request_id": job["request_id"], "code": code, "message": "Streaming response stopped. Your confirmed transcript is retained; retry explicitly if time remains."})
            except Exception:
                pass
        finally:
            self._release(connection_id, job_id)

    def speech_token(self, record, sid, origin=None):
        encounter = record["payload"]
        self._encounter({"encounter_id": encounter["id"], "token_hash": encounter["token_hash"], "sid": sid})
        provider = self.app.state.tts
        if os.getenv("CASECLIMB_STT_ENABLED", "").lower() != "true" or provider is None or not hasattr(provider, "realtime_token"):
            raise HTTPException(503, "Realtime transcription is not enabled. Use browser speech recognition or typing.")
        self._count(f"stream:scribe:{encounter['id']}", 2, self._ttl(encounter))
        seconds = math.ceil(encounter["deadline"] - self.clock())
        if seconds < 1 or not self.quotas.reserve("stt_seconds", seconds):
            raise HTTPException(429, "Workshop transcription allowance exhausted.")
        try:
            token = provider.realtime_token()
            self._encounter({"encounter_id": encounter["id"], "token_hash": encounter["token_hash"], "sid": sid})
        except httpx.HTTPStatusError as error:
            status = 503 if error.response.status_code in {401, 403} else 502
            raise HTTPException(status, "Realtime transcription provider permission or allowance is unavailable. Use typing.") from None
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(502, "Realtime transcription token could not be created. Use typing.") from None
        # Provider tokens are intentionally never persisted in the shared store.
        return {"token": token, "deadline": encounter["deadline"], "model_id": "scribe_v2_realtime", "audio_format": "pcm_16000", "sample_rate": 16000, "reserved_seconds": seconds}
