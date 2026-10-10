"""FastAPI application and AWS Lambda handler; no secret has a default value."""

import base64
import copy
import hashlib
import json
import os
import secrets
import time
import uuid
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import RedirectResponse, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from mangum import Mangum

from .access import AppAccess
from .conversation_demo import NOTICE as DEMO_NOTICE, PROMPTS as DEMO_PROMPTS, PROFILES as DEMO_PROFILES, StartDemo, demo_feedback, is_demo, public_event, public_profile
from .case_templates import TEMPLATES, case_template
from .debrief import BedrockDebriefSelector, enrich_feedback
from .engine import disclosed_chart, feedback, reply, validate_case
from .models import Approval, CaseDraft, SpeechRequest, StartEncounter, StreamCancel, Turn
from .providers import BedrockSelector, ElevenLabsTTS, speech_plan
from .quotas import BudgetedSelector, Quotas
from .store import Conflict, configured_store
from .streaming import StreamAuthorization, StreamService
from .video import LiveAvatarClient, SANDBOX_AVATAR_ID, VideoService

CAP_SECONDS = 600
MAX_TURNS = 60
TURN_LEASE_SECONDS = 30
bearer = HTTPBearer(auto_error=False)


def digest(value: str):
    return hashlib.sha256(value.encode()).hexdigest()


def create_app(store=None, clock=None, selector=None, tts=None, liveavatar=None, debrief_selector=None):
    app = FastAPI(title="CaseClimb synthetic patient API", version="0.1.0")
    app.state.store = store or configured_store()
    app.state.quotas = Quotas(app.state.store)
    app.state.clock = clock or time.time
    app.state.access = AppAccess(app.state.store, app.state.clock)
    app.state.selector = selector
    app.state.tts = tts
    app.state.debrief_selector = debrief_selector
    if selector is None and os.getenv("CASECLIMB_BEDROCK_MODEL_ID"):
        app.state.selector = BedrockSelector(os.environ["CASECLIMB_BEDROCK_MODEL_ID"])
    if tts is None and os.getenv("ELEVENLABS_API_KEY"):
        app.state.tts = ElevenLabsTTS(os.environ["ELEVENLABS_API_KEY"], os.getenv("CASECLIMB_VOICE_ID"))
    if debrief_selector is None and os.getenv("CASECLIMB_DEBRIEF_MODEL_ID"):
        app.state.debrief_selector = BedrockDebriefSelector(os.environ["CASECLIMB_DEBRIEF_MODEL_ID"])
    video_sandbox = os.getenv("CASECLIMB_LIVEAVATAR_SANDBOX", "").lower() == "true"
    if liveavatar is None and os.getenv("LIVEAVATAR_API_KEY") and (os.getenv("LIVEAVATAR_AVATAR_ID") or video_sandbox):
        liveavatar = LiveAvatarClient(os.environ["LIVEAVATAR_API_KEY"], os.getenv("LIVEAVATAR_AVATAR_ID", SANDBOX_AVATAR_ID), sandbox=video_sandbox)
    app.state.video = VideoService(app.state.store, app.state.clock, app.state.quotas, liveavatar, app.state.tts, sandbox=video_sandbox)

    def admin(auth: HTTPAuthorizationCredentials | None = Depends(bearer)):
        configured = os.getenv("CASECLIMB_ADMIN_TOKEN")
        if not configured:
            raise HTTPException(503, "Faculty authentication is not configured.")
        if not auth or not secrets.compare_digest(auth.credentials, configured):
            raise HTTPException(401, "Faculty authentication required.", headers={"WWW-Authenticate": "Bearer"})

    def get_case(case_id):
        record = app.state.store.get(f"case:{case_id}")
        if not record:
            raise HTTPException(404, "Case not found.")
        return record

    def persist_case(case_id, payload, revision):
        if len(json.dumps(payload, ensure_ascii=False).encode()) > 340_000:
            raise HTTPException(413, "Case version history exceeds the prototype storage limit. Create a new reusable case.")
        return app.state.store.put(f"case:{case_id}", payload, revision)

    def persist_encounter(encounter, revision):
        if len(json.dumps(encounter, ensure_ascii=False).encode()) > 340_000:
            raise HTTPException(413, "Encounter ledger storage limit reached. Conclude this session.")
        return app.state.store.put(f"encounter:{encounter['id']}", encounter, revision, int(encounter["started_at"] + 86400))

    def case_snapshot(encounter):
        if is_demo(encounter):
            return CaseDraft.model_validate(encounter["demo_snapshot"])
        record = get_case(encounter["case_id"])
        snapshot = next((v for v in record["payload"]["versions"] if v["version"] == encounter["version"]), None)
        if not snapshot:
            raise HTTPException(409, "Pinned case version is unavailable.")
        return CaseDraft.model_validate(snapshot["case"])

    def encounter_record(encounter_id, auth):
        record = app.state.store.get(f"encounter:{encounter_id}")
        if not record:
            raise HTTPException(404, "Encounter not found.")
        if isinstance(auth, StreamAuthorization):
            supplied_hash = auth.token_hash if auth.encounter_id == encounter_id else ""
        else:
            supplied = auth.credentials if auth else ""
            supplied_hash = digest(supplied) if supplied else ""
        if not supplied_hash or not secrets.compare_digest(supplied_hash, record["payload"]["token_hash"]):
            raise HTTPException(401, "This encounter's bearer token is required.", headers={"WWW-Authenticate": "Bearer"})
        return record

    def expire(encounter):
        if encounter["status"] == "active" and app.state.clock() >= encounter["deadline"]:
            encounter["status"] = "expired"
            encounter["ended_at"] = encounter["deadline"]
            cancel_pending(encounter, "encounter_expired")
            encounter["feedback"] = demo_feedback(encounter) if is_demo(encounter) else feedback(case_snapshot(encounter), encounter)

    def cancel_pending(encounter, reason):
        pending = encounter.get("pending_turn")
        if pending:
            request_record = encounter["requests"][pending["request_id"]]
            request_record.update(status="failed", reason=reason)
            encounter["pending_turn"] = None

    def recover_pending(encounter):
        pending = encounter.get("pending_turn")
        if pending and app.state.clock() >= pending["lease_until"]:
            cancel_pending(encounter, "reservation_expired")

    def abort_pending(encounter_id, nonce, reason):
        for _ in range(5):
            record = app.state.store.get(f"encounter:{encounter_id}")
            if not record:
                return
            encounter = record["payload"]
            pending = encounter.get("pending_turn")
            if not pending or pending["nonce"] != nonce:
                return
            cancel_pending(encounter, reason)
            expire(encounter)
            try:
                persist_encounter(encounter, record["revision"])
                return
            except Conflict:
                continue

    def cancel_turn_by_request(encounter_id, request_id, auth):
        # Cancellation and nonce release share the ledger CAS, preventing a
        # cancelled worker from reserving after its acknowledgement.
        for _ in range(5):
            record = encounter_record(encounter_id, auth)
            encounter = record["payload"]
            cancelled = encounter.setdefault("cancelled_stream_requests", [])
            if request_id not in cancelled:
                if len(cancelled) >= 120:
                    raise HTTPException(429, "Stream interruption limit reached.")
                cancelled.append(request_id)
            pending = encounter.get("pending_turn")
            if pending and pending["request_id"] == request_id:
                cancel_pending(encounter, "stream_interrupted")
            try:
                persist_encounter(encounter, record["revision"])
                return state(encounter)
            except Conflict:
                continue
        raise HTTPException(409, "Could not confirm interruption. Refresh this encounter.")

    def streaming_status():
        return {"streaming_configured": bool(os.getenv("CASECLIMB_STREAM_WS_URL")),
                "stt_available": bool(app.state.tts and os.getenv("CASECLIMB_STT_ENABLED", "").lower() == "true" and app.state.quotas.remaining("stt_seconds") > 0)}

    def finished_feedback(encounter_id, auth):
        """Reserve one optional debrief attempt, including uncertain failures."""
        nonce = secrets.token_urlsafe(20)
        reserved = None
        for _ in range(5):
            record = encounter_record(encounter_id, auth)
            encounter = record["payload"]
            previous_status = encounter["status"]
            expire(encounter)
            if encounter["status"] == "active":
                raise HTTPException(409, "Feedback is available after the encounter ends.")
            if is_demo(encounter):
                if previous_status != encounter["status"] or "feedback" not in encounter:
                    encounter["feedback"] = demo_feedback(encounter)
                    try:
                        persist_encounter(encounter, record["revision"])
                    except Conflict:
                        continue
                return encounter
            encounter.setdefault("feedback", feedback(case_snapshot(encounter), encounter))
            if "critical_thinking_debrief" in encounter["feedback"]:
                return encounter
            pending = encounter.get("pending_debrief")
            if encounter.get("debrief_attempted"):
                if pending and app.state.clock() < pending["lease_until"]:
                    return encounter  # Authored assessments remain usable during selection.
                encounter["feedback"] = enrich_feedback(case_snapshot(encounter), encounter, encounter["feedback"])
                encounter["feedback"]["critical_thinking_debrief"]["provider"] = "authored_abandoned_fallback"
                encounter["pending_debrief"] = None
                try:
                    persist_encounter(encounter, record["revision"])
                    return encounter
                except Conflict:
                    continue
            encounter.update(debrief_attempted=True, pending_debrief={"nonce": nonce, "lease_until": app.state.clock() + 30})
            try:
                persist_encounter(encounter, record["revision"])
            except Conflict:
                continue
            reserved = copy.deepcopy(encounter)
            break
        if reserved is None:
            raise HTTPException(409, "Debrief changed concurrently. Retry to read its cached result.")
        try:
            enriched = enrich_feedback(case_snapshot(reserved), reserved, reserved["feedback"], app.state.debrief_selector, app.state.quotas)
        except Exception:
            enriched = enrich_feedback(case_snapshot(reserved), reserved, reserved["feedback"])
            enriched["critical_thinking_debrief"]["provider"] = "authored_provider_fallback"
        for _ in range(5):
            record = encounter_record(encounter_id, auth)
            encounter = record["payload"]
            if "critical_thinking_debrief" in encounter["feedback"]:
                return encounter
            pending = encounter.get("pending_debrief")
            if not pending or pending["nonce"] != nonce:
                return encounter
            if app.state.clock() >= pending["lease_until"]:
                enriched = enrich_feedback(case_snapshot(encounter), encounter, encounter["feedback"])
                enriched["critical_thinking_debrief"]["provider"] = "authored_abandoned_fallback"
            encounter.update(feedback=enriched, pending_debrief=None)
            try:
                persist_encounter(encounter, record["revision"])
                return encounter
            except Conflict:
                continue
        raise HTTPException(409, "Debrief cache changed concurrently. Retry to read its result.")

    def state(encounter):
        case = case_snapshot(encounter)
        now = app.state.clock()
        result = {
            "encounter_id": encounter["id"], "case_id": encounter["case_id"], "version": encounter["version"],
            "patient": {"name": case.patient_name, "age": case.age, "setting": case.setting, "presentation_key": case.presentation_key},
            "learning_focus": case.learning_focus,
            "title": case.title, "status": encounter["status"], "started_at": encounter["started_at"], "deadline": encounter["deadline"],
            "server_time": now, "remaining_seconds": max(0, int(encounter["deadline"] - now)),
            "events": encounter["events"], "chart": disclosed_chart(case, encounter),
            "simulated_mood": encounter["simulated_mood"], "confirmed_turns": encounter["turn_count"], "max_turns": MAX_TURNS,
            "tts_available": app.state.tts is not None and (not isinstance(app.state.tts, ElevenLabsTTS) or bool(case.voice_id or app.state.tts.voice_id)) and app.state.quotas.remaining("tts_characters") > 0,
            "video_available": app.state.video.available(case), "video_sandbox": app.state.video.sandbox_metadata(), "video": app.state.video.public_status(encounter["id"]),
            "pending_turn": ({"request_id": encounter["pending_turn"]["request_id"], "lease_until": encounter["pending_turn"]["lease_until"]} if encounter.get("pending_turn") else None),
            "assessment_notice": "Synthetic practice only. Rapport is simulated; feedback is unvalidated and requires faculty review.",
        }
        result["mode"] = encounter.get("mode", "clinical_practice")
        result.update(streaming_status())
        if is_demo(encounter):
            result.update(events=[public_event(e) for e in encounter["events"]], chart={"facts": [], "artifacts": []},
                          video_available=app.state.video.available(case, demo=True), video_sandbox=app.state.video.sandbox_metadata(),
                          conversation_prompts=list(encounter.get("conversation_prompts", DEMO_PROMPTS)),
                          conversation_profile=copy.deepcopy(encounter.get("conversation_profile", public_profile())), assessment_notice=DEMO_NOTICE,
                          simulated_mood={"mood": encounter["simulated_mood"]["mood"], "label": "Preset fictional delivery; no learner score"})
            result["patient"]["age"] = None
        return result

    @app.get("/health")
    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    @app.get("/api/status")
    def status():
        return {**streaming_status(), "status": "ok", "storage": os.getenv("CASECLIMB_STORE", "file"), "app_access_required": app.state.access.required, "faculty_access_configured": bool(os.getenv("CASECLIMB_ADMIN_TOKEN")), "student_access_required": True, "student_access_configured": bool(os.getenv("CASECLIMB_STUDENT_CODE")), "bedrock_configured": app.state.selector is not None, "debrief_configured": app.state.debrief_selector is not None, "tts_configured": app.state.tts is not None, "tts_available": app.state.tts is not None and app.state.quotas.remaining("tts_characters") > 0, "video_configured": app.state.video.client is not None, "video_available": app.state.video.available(), "demo_video_available": app.state.video.available(demo=True), "video_sandbox": app.state.video.sandbox_metadata(), "encounter_seconds": CAP_SECONDS, "max_turns": MAX_TURNS, "synthetic_only": True, "budgets_remaining": {name: app.state.quotas.remaining(name) for name in app.state.quotas.limits}, "budget_notice": "Finite workshop lifetime quotas. Reserved unsuccessful provider attempts count; use authored text/captions when exhausted."}

    @app.get("/api/library")
    def library():
        result = []
        for record in app.state.store.list("case:"):
            c = record["payload"]
            if c["versions"]:
                v = c["versions"][-1]
                case = v["case"]
                result.append({"case_id": c["id"], "version": v["version"], "title": case["title"], "patient_name": case["patient_name"], "age": case["age"], "setting": case["setting"], "summary": case["summary"], "learning_focus": case.get("learning_focus", "clinical_history"), "synthetic": True, "review_status": "Reviewer-attested; independent clinical validation not established"})
        return {"cases": result}

    @app.get("/api/faculty/templates", dependencies=[Depends(admin)])
    def templates():
        return {"templates": TEMPLATES}

    @app.get("/api/faculty/templates/{template_id}", dependencies=[Depends(admin)])
    def template(template_id: str):
        try:
            return {"draft": case_template(template_id).model_dump()}
        except KeyError:
            raise HTTPException(404, "Patient case template not found.")

    @app.get("/api/faculty/cases", dependencies=[Depends(admin)])
    def faculty_cases():
        return {"cases": [{**r["payload"], "revision": r["revision"]} for r in app.state.store.list("case:")]}

    @app.post("/api/faculty/cases", dependencies=[Depends(admin)], status_code=201)
    def create_case(case: CaseDraft):
        case_id = str(uuid.uuid4())
        payload = {"id": case_id, "draft": case.model_dump(), "draft_status": "unreviewed", "versions": [], "created_at": app.state.clock()}
        saved = persist_case(case_id, payload, None)
        return {**payload, "revision": saved["revision"]}

    @app.get("/api/faculty/cases/{case_id}", dependencies=[Depends(admin)])
    def faculty_case(case_id: str):
        record = get_case(case_id)
        return {**record["payload"], "revision": record["revision"]}

    @app.put("/api/faculty/cases/{case_id}", dependencies=[Depends(admin)])
    def edit_case(case_id: str, case: CaseDraft, expected_revision: int = Query(..., ge=1)):
        record = get_case(case_id)
        if record["revision"] != expected_revision:
            raise HTTPException(409, "The reviewed draft changed. Reload before editing.")
        payload = record["payload"]
        payload.update(draft=case.model_dump(), draft_status="unreviewed")
        try:
            saved = persist_case(case_id, payload, expected_revision)
        except Conflict:
            raise HTTPException(409, "Case changed concurrently. Reload before saving.")
        return {**payload, "revision": saved["revision"]}

    @app.post("/api/faculty/cases/{case_id}/validate", dependencies=[Depends(admin)])
    def validate(case_id: str):
        return validate_case(CaseDraft.model_validate(get_case(case_id)["payload"]["draft"]))

    @app.post("/api/faculty/cases/{case_id}/approve", dependencies=[Depends(admin)])
    def approve(case_id: str, approval: Approval):
        record = get_case(case_id)
        if record["revision"] != approval.expected_revision:
            raise HTTPException(409, "The reviewed draft changed. Reload and review before approval.")
        payload = record["payload"]
        report = validate_case(CaseDraft.model_validate(payload["draft"]))
        if not report["valid"]:
            raise HTTPException(422, report)
        published = {"version": len(payload["versions"]) + 1, "case": copy.deepcopy(payload["draft"]), "approval": approval.model_dump(), "approved_at": app.state.clock()}
        payload["versions"].append(published)
        payload["draft_status"] = "published"
        try:
            persist_case(case_id, payload, record["revision"])
        except Conflict:
            raise HTTPException(409, "Case changed concurrently. Reload and review again.")
        return {"case_id": case_id, "version": published["version"], "review_status": "faculty_attested", "validation": report}

    @app.get("/api/faculty/analytics", dependencies=[Depends(admin)])
    def analytics():
        encounters = [r["payload"] for r in app.state.store.list("encounter:") if not is_demo(r["payload"])]
        statuses = {}
        for e in encounters:
            effective = "expired" if e["status"] == "active" and app.state.clock() >= e["deadline"] else e["status"]
            statuses[effective] = statuses.get(effective, 0) + 1
        return {"encounters": len(encounters), "statuses": statuses, "confirmed_turns": sum(e["turn_count"] for e in encounters), "notice": "Operational counts, not educational outcomes. No learner identifiers are collected."}

    @app.post("/api/encounters", status_code=201)
    def start(request: StartEncounter):
        code = os.getenv("CASECLIMB_STUDENT_CODE")
        if not code:
            raise HTTPException(503, "Student access is not configured.")
        if not secrets.compare_digest(request.access_code, code):
            raise HTTPException(403, "Student access code is invalid.")
        stored_case = get_case(request.case_id)["payload"]
        versions = stored_case["versions"]
        published = next((v for v in versions if v["version"] == request.version), None) if request.version else (versions[-1] if versions else None)
        if published is None:
            raise HTTPException(409, "Only a published, reviewer-attested case version can be launched.")
        return begin_encounter(CaseDraft.model_validate(published["case"]), request.case_id, published["version"])

    def begin_encounter(case, case_id, version):
        if not app.state.quotas.reserve("sessions"):
            raise HTTPException(429, "Workshop session allowance exhausted. Ask the administrator to review the deployment budget.")
        encounter_id, token, now = str(uuid.uuid4()), secrets.token_urlsafe(32), app.state.clock()
        initial_facts = [f.id for f in case.facts if f.initially_released]
        initial_artifacts = [a.id for a in case.artifacts if a.initially_released]
        opening = " ".join(dict.fromkeys([case.opening, *[f.patient_answer for f in case.facts if f.initially_released and f.audience != "chart" and f.patient_answer]]))
        encounter = {"id": encounter_id, "case_id": case_id, "version": version, "token_hash": digest(token), "started_at": now, "deadline": now + CAP_SECONDS, "status": "active", "turn_count": 0, "provider_attempts": 0, "pending_turn": None, "requests": {}, "disclosed_fact_ids": initial_facts, "disclosed_artifact_ids": initial_artifacts, "simulated_mood": {"mood": case.behavior.mood, "label": "Simulated state, not an empathy score"}, "events": [{"id": "e0", "actor": "patient", "text": opening, "timestamp": now, "confirmed": True, "disclosed_fact_ids": initial_facts, "disclosed_artifact_ids": initial_artifacts, "provider": "authored"}]}
        encounter["initial_rapport"] = case.behavior.initial_rapport
        encounter["simulated_mood"]["rapport"] = case.behavior.initial_rapport
        persist_encounter(encounter, None)
        return {"encounter_id": encounter_id, "token": token, "state": state(encounter)}

    @app.get("/api/demo/profiles", deprecated=True)
    def demo_profiles():
        return {"profiles": [public_profile(profile_id) for profile_id in DEMO_PROFILES]}

    @app.post("/api/demo/encounters", deprecated=True)
    def start_demo(request: StartDemo):
        raise HTTPException(410, "Practice chat has been retired. Create a patient case from a communication template in Patient Studio, then review and publish it before starting an encounter.")

    @app.get("/api/encounters/{encounter_id}")
    def get_encounter(encounter_id: str, auth: HTTPAuthorizationCredentials | None = Depends(bearer)):
        for _ in range(4):
            record = encounter_record(encounter_id, auth)
            encounter = record["payload"]
            before = (encounter["status"], encounter.get("pending_turn"))
            expire(encounter)
            recover_pending(encounter)
            if before != (encounter["status"], encounter.get("pending_turn")):
                try:
                    persist_encounter(encounter, record["revision"])
                except Conflict:
                    continue
            app.state.video.cleanup(encounter)
            return state(encounter)
        raise HTTPException(409, "Encounter changed concurrently. Retry.")

    @app.post("/api/encounters/{encounter_id}/turns")
    def turn(encounter_id: str, request: Turn, auth: HTTPAuthorizationCredentials | None = Depends(bearer)):
        return submit_turn(encounter_id, request, auth)

    def submit_turn(encounter_id, request, auth, allowed=None):
        text = request.text.strip()
        if not text:
            raise HTTPException(422, "A confirmed nonempty turn is required.")
        nonce = secrets.token_urlsafe(20)
        reserved = None
        for _ in range(5):
            if allowed is not None and not allowed():
                raise HTTPException(409, "Response interrupted before turn reservation.")
            record = encounter_record(encounter_id, auth)
            encounter = record["payload"]
            expire(encounter)
            recover_pending(encounter)
            prior = encounter["requests"].get(request.request_id)
            if prior:
                if prior["text_hash"] != digest(text):
                    raise HTTPException(409, "request_id was already used for different content.")
                if prior.get("event_id"):
                    event = next(e for e in encounter["events"] if e["id"] == prior["event_id"])
                    return {"state": state(encounter), "patient_event": public_event(event) if is_demo(encounter) else event, "replayed": True}
                if prior["status"] == "failed":
                    # Persist a recovered lease before allowing a new explicit request.
                    try:
                        persist_encounter(encounter, record["revision"])
                    except Conflict:
                        continue
                    raise HTTPException(409, "This request was abandoned or expired. Retry explicitly with a new request_id if time remains.")
                raise HTTPException(409, "This request is still being processed.", headers={"Retry-After": "2"})
            if request.request_id in encounter.get("cancelled_stream_requests", []):
                raise HTTPException(409, "This stream request was interrupted. Use a new request_id.")
            if encounter["status"] != "active":
                raise HTTPException(409, "Encounter has ended; no new turns are accepted.")
            if encounter.get("pending_turn"):
                raise HTTPException(409, "Another turn is still being processed.", headers={"Retry-After": "2"})
            if encounter["turn_count"] >= MAX_TURNS or encounter.get("provider_attempts", 0) >= MAX_TURNS:
                raise HTTPException(429, "Turn/attempt limit reached.")
            encounter["requests"][request.request_id] = {"status": "pending", "text_hash": digest(text)}
            encounter["pending_turn"] = {"request_id": request.request_id, "nonce": nonce, "lease_until": min(app.state.clock() + TURN_LEASE_SECONDS, encounter["deadline"])}
            encounter["provider_attempts"] = encounter.get("provider_attempts", 0) + 1
            try:
                persist_encounter(encounter, record["revision"])
            except Conflict:
                continue
            reserved = copy.deepcopy(encounter)
            break
        if reserved is None:
            raise HTTPException(409, "Concurrent turn conflict. Retry with the same request_id.")
        try:
            case = case_snapshot(reserved)
            selector = BudgetedSelector(app.state.selector, app.state.quotas, lambda: app.state.clock() < min(reserved["deadline"], reserved["pending_turn"]["lease_until"])) if app.state.selector else None
            answer, fact_ids, artifact_ids, provider, mood_change = reply(case, reserved, text, selector, track_rapport=not is_demo(reserved))
        except Exception:
            abort_pending(encounter_id, nonce, "response_failed")
            raise HTTPException(502, "Patient response failed. Retry explicitly with a new request_id, or use the debrief.")
        for _ in range(5):
            record = encounter_record(encounter_id, auth)
            encounter = record["payload"]
            pending = encounter.get("pending_turn")
            now = app.state.clock()
            if allowed is not None and not allowed():
                abort_pending(encounter_id, nonce, "stream_interrupted")
                raise HTTPException(409, "Response interrupted. Late output was discarded.")
            if not pending or pending["nonce"] != nonce or encounter["status"] != "active" or now >= min(pending["lease_until"], encounter["deadline"]):
                abort_pending(encounter_id, nonce, "reply_expired")
                raise HTTPException(409, "The pending turn ended or its lease expired. Late output was discarded.")
            encounter["disclosed_fact_ids"] = reserved["disclosed_fact_ids"]
            encounter["disclosed_artifact_ids"] = reserved["disclosed_artifact_ids"]
            encounter["simulated_mood"] = reserved["simulated_mood"]
            n = len(encounter["events"])
            learner = {"id": f"e{n}", "actor": "learner", "text": text, "timestamp": now, "confirmed": True, "request_id": request.request_id}
            patient = {"id": f"e{n+1}", "actor": "patient", "text": answer, "timestamp": now, "confirmed": True, "disclosed_fact_ids": fact_ids, "disclosed_artifact_ids": artifact_ids, "provider": provider}
            if not is_demo(encounter):
                patient["rapport_change"] = mood_change
            encounter["events"].extend([learner, patient])
            encounter["turn_count"] += 1
            encounter["requests"][request.request_id] = {"status": "confirmed", "text_hash": digest(text), "event_id": patient["id"]}
            encounter["pending_turn"] = None
            if len(json.dumps(encounter, ensure_ascii=False).encode()) > 260_000:
                abort_pending(encounter_id, nonce, "ledger_limit")
                raise HTTPException(413, "Encounter ledger limit reached. Conclude this session; space is reserved for its debrief.")
            try:
                persist_encounter(encounter, record["revision"])
            except Conflict:
                continue
            return {"state": state(encounter), "patient_event": public_event(patient) if is_demo(encounter) else patient, "replayed": False}
        abort_pending(encounter_id, nonce, "confirmation_conflict")
        raise HTTPException(409, "Could not confirm the pending turn. Retry explicitly with a new request_id.")

    @app.post("/api/encounters/{encounter_id}/conclude")
    def conclude(encounter_id: str, auth: HTTPAuthorizationCredentials | None = Depends(bearer)):
        for _ in range(5):
            record = encounter_record(encounter_id, auth)
            encounter = record["payload"]
            expire(encounter)
            if encounter["status"] == "active":
                encounter["status"] = "completed"
                encounter["ended_at"] = app.state.clock()
            cancel_pending(encounter, "encounter_concluded")
            encounter.setdefault("feedback", demo_feedback(encounter) if is_demo(encounter) else feedback(case_snapshot(encounter), encounter))
            try:
                persist_encounter(encounter, record["revision"])
            except Conflict:
                continue
            app.state.video.cleanup(encounter)
            encounter = finished_feedback(encounter_id, auth)
            return {"state": state(encounter), "feedback": encounter["feedback"]}
        raise HTTPException(409, "Concurrent update. Retry.")

    @app.get("/api/encounters/{encounter_id}/feedback")
    def get_feedback(encounter_id: str, auth: HTTPAuthorizationCredentials | None = Depends(bearer)):
        encounter = finished_feedback(encounter_id, auth)
        app.state.video.cleanup(encounter)
        return encounter["feedback"]

    @app.post("/api/encounters/{encounter_id}/video/start")
    def video_start(encounter_id: str, auth: HTTPAuthorizationCredentials | None = Depends(bearer)):
        encounter = encounter_record(encounter_id, auth)["payload"]
        return app.state.video.start(encounter, case_snapshot(encounter), demo=is_demo(encounter))

    @app.post("/api/encounters/{encounter_id}/video/stop")
    def video_stop(encounter_id: str, auth: HTTPAuthorizationCredentials | None = Depends(bearer)):
        encounter_record(encounter_id, auth)
        return app.state.video.stop(encounter_id)

    @app.post("/api/encounters/{encounter_id}/video/audio")
    def video_audio(encounter_id: str, request: SpeechRequest, auth: HTTPAuthorizationCredentials | None = Depends(bearer)):
        encounter = encounter_record(encounter_id, auth)["payload"]
        return app.state.video.audio(encounter, case_snapshot(encounter), request.event_id, demo=is_demo(encounter))

    @app.post("/api/encounters/{encounter_id}/tts")
    def speech(encounter_id: str, request: SpeechRequest, auth: HTTPAuthorizationCredentials | None = Depends(bearer)):
        encounter = encounter_record(encounter_id, auth)["payload"]
        if encounter["status"] != "active" or app.state.clock() >= encounter["deadline"]:
            raise HTTPException(409, "Speech generation is unavailable for an ended encounter.")
        event = next((e for e in encounter["events"] if e["id"] == request.event_id and e["actor"] == "patient"), None)
        if event is None:
            raise HTTPException(404, "A stored patient event is required.")
        if len(event["text"]) > 1000:
            raise HTTPException(422, "This response is too long for the bounded speech path. Use captions.")
        if app.state.tts is None:
            raise HTTPException(503, "Speech provider is not configured. Use text or browser speech.")
        case = case_snapshot(encounter)
        plan = speech_plan(case, event["text"], encounter["simulated_mood"])
        if isinstance(app.state.tts, ElevenLabsTTS) and not (case.voice_id or app.state.tts.voice_id):
            raise HTTPException(503, "Patient voice is not configured. Use captions or browser speech.")
        key = f"audio:{encounter_id}:{request.event_id}"
        cached = app.state.store.get(key)
        if cached:
            if cached["payload"].get("status") == "ready":
                return Response(base64.b64decode(cached["payload"]["audio"]), media_type="audio/mpeg", headers={"Cache-Control": "no-store"})
            raise HTTPException(409, "Speech generation already requested; use captions if unavailable.")
        try:
            reservation = app.state.store.put(key, {"status": "pending"}, None, int(encounter["started_at"] + 86400))
        except Conflict:
            raise HTTPException(409, "Speech generation already requested.")
        if not app.state.quotas.reserve("tts_characters", len(plan.text)):
            app.state.store.put(key, {"status": "failed", "reason": "workshop_budget_exhausted"}, reservation["revision"], int(encounter["started_at"] + 86400))
            raise HTTPException(429, "Workshop speech allowance exhausted. Use captions or browser speech.")
        if app.state.clock() >= encounter["deadline"]:
            app.state.store.put(key, {"status": "failed", "reason": "encounter_expired"}, reservation["revision"], int(encounter["started_at"] + 86400))
            raise HTTPException(409, "Encounter expired before speech generation.")
        try:
            audio = app.state.tts.speak_plan(plan) if hasattr(app.state.tts, "speak_plan") else app.state.tts.speak(plan.text, case.voice_id)
            fresh = encounter_record(encounter_id, auth)["payload"]
            if fresh["status"] != "active" or app.state.clock() >= fresh["deadline"]:
                raise ValueError("Speech finished after the encounter ended")
            app.state.store.put(key, {"status": "ready", "audio": base64.b64encode(audio).decode()}, reservation["revision"], int(encounter["started_at"] + 86400))
        except Exception:
            app.state.store.put(key, {"status": "failed"}, reservation["revision"], int(encounter["started_at"] + 86400))
            raise HTTPException(502, "Speech provider failed. Use text or browser speech.")
        return Response(audio, media_type="audio/mpeg", headers={"Cache-Control": "no-store"})

    def stream_scope(request, encounter_id, auth):
        if not app.state.access.same_origin(request):
            raise HTTPException(403, "Same-origin stream setup is required.")
        record = encounter_record(encounter_id, auth)
        sid = app.state.access.session_id(request)
        if not app.state.access.session_active(sid):
            raise HTTPException(401, "App sign-in required.")
        origin = f"{request.url.scheme}://{request.url.netloc}"
        return record, sid, origin

    @app.post("/api/encounters/{encounter_id}/stream-ticket")
    def stream_ticket(encounter_id: str, request: Request, auth: HTTPAuthorizationCredentials | None = Depends(bearer)):
        record, sid, origin = stream_scope(request, encounter_id, auth)
        return app.state.stream.mint_ticket(record, sid, origin)

    @app.post("/api/encounters/{encounter_id}/speech/token")
    def speech_token(encounter_id: str, request: Request, auth: HTTPAuthorizationCredentials | None = Depends(bearer)):
        record, sid, origin = stream_scope(request, encounter_id, auth)
        return app.state.stream.speech_token(record, sid, origin)

    @app.post("/api/encounters/{encounter_id}/stream-cancel")
    def stream_cancel(encounter_id: str, body: StreamCancel, request: Request, auth: HTTPAuthorizationCredentials | None = Depends(bearer)):
        stream_scope(request, encounter_id, auth)
        return app.state.stream.cancel(encounter_id, body.request_id, auth)

    app.state.encounter_record = encounter_record
    app.state.case_snapshot = case_snapshot
    app.state.public_state = state
    app.state.submit_turn = submit_turn
    app.state.cancel_turn_by_request = cancel_turn_by_request
    app.state.stream = StreamService(app)

    @app.middleware("http")
    async def response_headers(request: Request, call_next):
        if request.method in ("POST", "PUT", "PATCH"):
            body = await request.body()
            if len(body) > 256_000:
                return Response("Request body exceeds prototype limit.", status_code=413)
        response = await call_next(request)
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(self)"
        return response

    frontend = Path(__file__).resolve().parent.parent / "frontend"
    if frontend.exists():
        app.mount("/web", StaticFiles(directory=str(frontend), html=True), name="web")

        @app.get("/", include_in_schema=False)
        def root():
            return RedirectResponse("/web/")

    app.state.access.install(app)
    return app


app = create_app()
handler = Mangum(app, lifespan="off")
