"""Optional LITE video: application-authored PCM, no provider conversation agent."""

import base64
import math
import uuid
from urllib.parse import urlparse

import httpx
from fastapi import HTTPException

from .store import Conflict
from .providers import ElevenLabsTTS, speech_plan

SANDBOX_AVATAR_ID = "dd73ea75-1218-4ef3-92ce-606d5f7fbc0a"
SANDBOX_SECONDS = 60
SANDBOX_NOTICE = "LiveAvatar Wayne sandbox lasts up to 60 seconds. All profiles share Wayne's rendered face; the selected fictional profile controls authored words and its ElevenLabs stock voice. Continue with voice and captions after video ends."


class LiveAvatarClient:
    def __init__(self, key, avatar_id, client=None, *, sandbox=False):
        self.sandbox = bool(sandbox)
        self.key, self.avatar_id, self.client = key, str(uuid.UUID(SANDBOX_AVATAR_ID if self.sandbox else avatar_id)), client

    def _post(self, path, *, token=None, body=None, timeout=5):
        transport = self.client or httpx
        headers = {"Authorization": f"Bearer {token}"} if token else {"X-API-KEY": self.key}
        response = transport.post(f"https://api.liveavatar.com/v1/sessions/{path}", headers=headers, json=body, timeout=timeout)
        response.raise_for_status()
        return response.json().get("data")

    def prepare(self, duration, avatar_id=None):
        # Sandbox is a server configuration, never a per-request choice. Its
        # fixed supported avatar and cap cannot be overridden by an authored case.
        avatar = SANDBOX_AVATAR_ID if self.sandbox else str(uuid.UUID(avatar_id)) if avatar_id else self.avatar_id
        duration = min(SANDBOX_SECONDS, duration) if self.sandbox else duration
        body = {"mode": "LITE", "avatar_id": avatar, "video_settings": {"quality": "low", "encoding": "H264"}, "max_session_duration": duration}
        if self.sandbox:
            body["is_sandbox"] = True
        result = self._post("token", body=body)
        if not result or not result.get("session_id") or not result.get("session_token"):
            raise ValueError("Video token response incomplete")
        return result

    def activate(self, token):
        result = self._post("start", token=token, timeout=8)
        if not result or any(not result.get(k) for k in ("livekit_url", "livekit_client_token", "ws_url")):
            raise ValueError("Custom LITE transport credentials unavailable")
        for key in ("livekit_url", "ws_url"):
            if urlparse(result[key]).scheme != "wss":
                raise ValueError("Secure WebSocket transport required")
        return result

    def stop(self, session_id, reason="USER_CLOSED"):
        return self._post("stop", body={"session_id": session_id, "reason": reason})


class VideoService:
    def __init__(self, store, clock, quotas, client, tts, *, sandbox=False):
        self.store, self.clock, self.quotas, self.client, self.tts = store, clock, quotas, client, tts
        self.sandbox = bool(sandbox)

    @property
    def sandbox_enabled(self):
        return self.sandbox and bool(getattr(self.client, "sandbox", False))

    def sandbox_metadata(self):
        return {"enabled": self.sandbox_enabled, "avatar_name": "Wayne", "max_seconds": SANDBOX_SECONDS, "notice": SANDBOX_NOTICE}

    def available(self, case=None, *, demo=False):
        if demo and not self.sandbox_enabled:
            return False
        voice = not isinstance(self.tts, ElevenLabsTTS) or bool((case.voice_id if case else None) or self.tts.voice_id)
        return self.client is not None and self.tts is not None and hasattr(self.tts, "speak_pcm") and voice and self.quotas.remaining("video_sessions") > 0 and self.quotas.remaining("video_minutes") > 0

    def _get(self, encounter_id):
        return self.store.get(f"video:{encounter_id}")

    def public_status(self, encounter_id):
        record = self._get(encounter_id)
        return {"status": record["payload"]["status"], "deadline": record["payload"].get("deadline")} if record else {"status": "off"}

    def private_credentials(self, video):
        result = {"status": "active", "video_id": video["session_id"], "livekit_url": video["livekit_url"], "livekit_client_token": video["livekit_client_token"], "ws_url": video["ws_url"], "deadline": video["deadline"]}
        if video.get("sandbox"):
            result.update(sandbox=True, avatar_name="Wayne", max_seconds=SANDBOX_SECONDS)
        return result

    def start(self, encounter, case, *, demo=False):
        eid = encounter["id"]
        if demo and not self.sandbox_enabled:
            raise HTTPException(409, "Live video in this nonclinical demo requires the explicitly configured free Wayne sandbox. Continue with voice and captions.")
        if encounter["status"] != "active" or self.clock() >= encounter["deadline"]:
            raise HTTPException(409, "Video cannot start after the encounter ends.")
        prior = self._get(eid)
        if prior:
            video = prior["payload"]
            if video["status"] == "active" and self.clock() < video["deadline"]:
                return self.private_credentials(video)
            if video["status"] == "starting" and self.clock() >= video["lease_until"]:
                self.stop(eid, "SERVER_ERROR")
            raise HTTPException(409, "A video start was already attempted for this encounter. Use text/voice if unavailable.")
        if not self.available(case, demo=demo):
            raise HTTPException(503, "Video provider is not configured or the workshop allowance is exhausted. Use text/voice.")
        # Both provider HTTP calls have bounded timeouts. Reserve a startup margin
        # so the provider's own maximum duration also fits the encounter deadline.
        sandbox = bool(getattr(self.client, "sandbox", False))
        duration = min(SANDBOX_SECONDS if sandbox else 600, int(encounter["deadline"] - self.clock()) - 30)
        if duration < 1:
            raise HTTPException(409, "Insufficient encounter time remains to start video.")
        video = {"status": "starting", "lease_until": self.clock() + 20, "deadline": self.clock() + duration, "created_at": self.clock(), "sandbox": sandbox}
        token = None
        try:
            reserved = self.store.put(f"video:{eid}", video, None, int(encounter["started_at"] + 86400))
        except Conflict:
            raise HTTPException(409, "Video start is already being processed.")
        if not self.quotas.reserve("video_sessions") or not self.quotas.reserve("video_minutes", math.ceil(duration / 60)):
            video.update(status="failed", reason="budget_exhausted")
            self.store.put(f"video:{eid}", video, reserved["revision"], int(encounter["started_at"] + 86400))
            raise HTTPException(429, "Workshop video allowance exhausted. Use text/voice.")
        try:
            token = self.client.prepare(duration, SANDBOX_AVATAR_ID if sandbox else case.avatar_id)
            video.update(session_id=token["session_id"], session_token=token["session_token"])
            reserved = self.store.put(f"video:{eid}", video, reserved["revision"], int(encounter["started_at"] + 86400))
            started = self.client.activate(token["session_token"])
            if started.get("session_id") not in (None, token["session_id"]):
                raise ValueError("Provider returned a different session")
            current = self._get(eid)
            fresh_encounter = self.store.get(f"encounter:{eid}")["payload"]
            if not current or current["payload"]["status"] != "starting" or self.clock() >= min(video["deadline"], video["lease_until"]) or fresh_encounter["status"] != "active" or self.clock() >= fresh_encounter["deadline"]:
                raise ValueError("Video start finished after cancellation/deadline")
            video.update(status="active", livekit_url=started["livekit_url"], livekit_client_token=started["livekit_client_token"], ws_url=started["ws_url"])
            self.store.put(f"video:{eid}", video, current["revision"], int(encounter["started_at"] + 86400))
            return self.private_credentials(video)
        except Exception:
            current = self._get(eid)
            # A token acquired after a concurrent cancel may never have reached
            # the record. Clean up that untracked session separately.
            if token and (not current or current["payload"].get("session_id") != token["session_id"] or current["payload"]["status"] == "stopped"):
                try:
                    self.client.stop(token["session_id"], "SERVER_ERROR")
                except Exception:
                    pass
            self.stop(eid, "SERVER_ERROR")
            raise HTTPException(502, "Video provider could not start. Use text/voice; account plan and transport access need verification.")

    def stop(self, encounter_id, reason="USER_CLOSED"):
        for _ in range(5):
            record = self._get(encounter_id)
            if not record:
                return {"status": "off"}
            video = record["payload"]
            if video["status"] == "stopped":
                return {"status": "stopped"}
            if video.get("stop_attempts", 0) >= 3 or self.clock() < video.get("next_stop_after", 0):
                return {"status": video["status"], "notice": "Provider cleanup pending; client must disconnect. Provider maximum duration remains bounded."}
            video.update(status="stopping", stop_attempts=video.get("stop_attempts", 0) + 1, next_stop_after=self.clock() + 10)
            try:
                reserved = self.store.put(f"video:{encounter_id}", video, record["revision"], int(video["created_at"] + 86400))
            except Conflict:
                continue
            try:
                if video.get("session_id") and self.client:
                    self.client.stop(video["session_id"], reason)
                video["status"] = "stopped"
            except Exception:
                video["status"] = "cleanup_required"
            # Transport credentials are never needed after a stop attempt.
            for key in ("session_token", "livekit_client_token", "ws_url", "livekit_url"):
                video.pop(key, None)
            try:
                self.store.put(f"video:{encounter_id}", video, reserved["revision"], int(video["created_at"] + 86400))
            except Conflict:
                return {"status": "cleanup_required"}
            return {"status": video["status"]}
        raise HTTPException(409, "Video cleanup changed concurrently. Retry cleanup.")

    def cleanup(self, encounter):
        record = self._get(encounter["id"])
        if record and (encounter["status"] != "active" or self.clock() >= record["payload"]["deadline"] or (record["payload"]["status"] == "starting" and self.clock() >= record["payload"]["lease_until"])):
            return self.stop(encounter["id"], "MAX_DURATION_REACHED")

    def audio(self, encounter, case, event_id, *, demo=False):
        if demo and not self.sandbox_enabled:
            raise HTTPException(409, "Live video in this nonclinical demo requires the explicitly configured free Wayne sandbox. Continue with voice and captions.")
        video_record = self._get(encounter["id"])
        video = video_record["payload"] if video_record else {}
        if encounter["status"] != "active" or video.get("status") != "active" or self.clock() >= min(encounter["deadline"], video.get("deadline", 0)):
            self.cleanup(encounter)
            raise HTTPException(409, "An active scoped video session is required.")
        event = next((e for e in encounter["events"] if e["id"] == event_id and e["actor"] == "patient"), None)
        if not event:
            raise HTTPException(404, "A stored authored patient event is required.")
        if len(event["text"]) > 500:
            raise HTTPException(422, "This response exceeds the bounded video speech path. Use captions.")
        plan = speech_plan(case, event["text"], encounter["simulated_mood"])
        key = f"audio:pcm:{encounter['id']}:{event_id}"
        prior = self.store.get(key)
        if prior:
            if prior["payload"]["status"] == "ready":
                if self.clock() + prior["payload"]["duration_seconds"] >= min(encounter["deadline"], video["deadline"]):
                    raise HTTPException(409, "Cached audio cannot finish before the video deadline. Use captions.")
                return self._audio_result(encounter["id"], event_id, prior["payload"], video["deadline"])
            raise HTTPException(409, "Video speech already requested. Use captions if unavailable.")
        try:
            reserved = self.store.put(key, {"status": "pending"}, None, int(encounter["started_at"] + 86400))
        except Conflict:
            raise HTTPException(409, "Video speech is already being prepared.")
        if not self.quotas.reserve("tts_characters", len(plan.text)):
            self.store.put(key, {"status": "failed"}, reserved["revision"], int(encounter["started_at"] + 86400))
            raise HTTPException(429, "Workshop speech allowance exhausted. Use captions.")
        try:
            if self.clock() >= min(encounter["deadline"], video["deadline"]):
                raise ValueError("Deadline elapsed before speech generation")
            pcm = self.tts.speak_plan(plan, pcm=True) if hasattr(self.tts, "speak_plan") else self.tts.speak_pcm(plan.text, case.voice_id)
            if not pcm or len(pcm) % 2 or len(pcm) > 1_440_000:
                raise ValueError("Invalid or oversized PCM24 audio")
            duration = len(pcm) / 48_000
            fresh = self._get(encounter["id"])["payload"]
            current_encounter = self.store.get(f"encounter:{encounter['id']}")["payload"]
            if fresh["status"] != "active" or current_encounter["status"] != "active" or self.clock() + duration >= min(encounter["deadline"], fresh["deadline"]):
                raise ValueError("Audio cannot finish inside the active video deadline")
            chunks = [base64.b64encode(pcm[i:i+48_000]).decode() for i in range(0, len(pcm), 48_000)]
            groups = [chunks[i:i+4] for i in range(0, len(chunks), 4)]
            for n, group in enumerate(groups):
                self.store.put(f"pcm:{encounter['id']}:{event_id}:{n}", {"chunks": group}, None, int(encounter["started_at"] + 86400))
            index = {"status": "ready", "groups": len(groups), "utterance_id": str(uuid.uuid4()), "duration_seconds": duration}
            self.store.put(key, index, reserved["revision"], int(encounter["started_at"] + 86400))
            return self._audio_result(encounter["id"], event_id, index, video["deadline"])
        except Exception:
            self.store.put(key, {"status": "failed"}, reserved["revision"], int(encounter["started_at"] + 86400))
            raise HTTPException(502, "Video speech failed or exceeded the deadline. Use captions; no automatic provider retry.")

    def _audio_result(self, encounter_id, event_id, index, deadline):
        chunks = []
        for n in range(index["groups"]):
            group = self.store.get(f"pcm:{encounter_id}:{event_id}:{n}")
            if not group:
                raise HTTPException(409, "Cached audio expired. Use captions.")
            chunks.extend(group["payload"]["chunks"])
        return {"format": "pcm_s16le", "sample_rate": 24000, "channels": 1, "utterance_id": index["utterance_id"], "chunks": chunks, "duration_seconds": index["duration_seconds"], "deadline": deadline}
