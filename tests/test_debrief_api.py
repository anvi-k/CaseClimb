import threading
from concurrent.futures import ThreadPoolExecutor

from test_backend import harness, publish, sample, start


class FakeDebrief:
    def __init__(self):
        self.calls = 0
        self.on_choose = None

    def choose(self, context):
        self.calls += 1
        if self.on_choose:
            self.on_choose()
        candidate = context["candidates"][0]
        return [{"objective_id": candidate["objective_id"], "focus": candidate["allowed_focuses"][0], "evidence_event_ids": candidate["allowed_event_ids"][:1]}], "untrusted_metadata"


def test_conclude_and_feedback_cache_one_grounded_debrief_attempt(harness):
    client, _, app = harness
    selector = app.state.debrief_selector = FakeDebrief()
    eid, auth, _ = start(client, publish(client))
    result = client.post(f"/api/encounters/{eid}/conclude", headers=auth)
    assert result.status_code == 200
    enriched = result.json()["feedback"]
    priority = enriched["critical_thinking_debrief"]["priorities"][0]
    assert priority["objective_id"] == "explore_concern"
    assert priority["evidence_event_ids"] == ["e0"]
    assert enriched["critical_thinking_debrief"]["provider"] == "bedrock_selection"
    assert client.get(f"/api/encounters/{eid}/feedback", headers=auth).json() == enriched
    assert client.post(f"/api/encounters/{eid}/conclude", headers=auth).json()["feedback"] == enriched
    assert selector.calls == 1
    assert app.state.quotas.remaining("bedrock") == 299


def test_concurrent_debrief_and_abandoned_lease_do_not_repeat_paid_call(harness):
    client, now, app = harness
    selector = app.state.debrief_selector = FakeDebrief()
    eid, auth, _ = start(client, publish(client))
    entered, release = threading.Event(), threading.Event()
    selector.on_choose = lambda: (entered.set(), release.wait(5))
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(client.post, f"/api/encounters/{eid}/conclude", headers=auth)
        assert entered.wait(2)
        pending = client.get(f"/api/encounters/{eid}/feedback", headers=auth)
        assert pending.status_code == 200
        assert "critical_thinking_debrief" not in pending.json()
        assert selector.calls == 1
        now[0] += 31
        recovered = client.get(f"/api/encounters/{eid}/feedback", headers=auth).json()
        assert recovered["critical_thinking_debrief"]["provider"] == "authored_abandoned_fallback"
        release.set()
        assert first.result().json()["feedback"] == recovered
    assert selector.calls == 1 and app.state.quotas.remaining("bedrock") == 299
    assert client.post(f"/api/encounters/{eid}/conclude", headers=auth).json()["feedback"] == recovered


def test_expiry_feedback_persists_and_uses_authored_budget_fallback(harness):
    client, now, app = harness
    selector = app.state.debrief_selector = FakeDebrief()
    app.state.quotas.limits["bedrock"] = 1
    assert app.state.quotas.reserve("bedrock")
    eid, auth, data = start(client, publish(client))
    now[0] = data["state"]["deadline"]
    result = client.get(f"/api/encounters/{eid}/feedback", headers=auth)
    assert result.status_code == 200
    assert result.json()["critical_thinking_debrief"]["provider"] == "authored_budget_fallback"
    record = app.state.store.get(f"encounter:{eid}")["payload"]
    assert record["status"] == "expired" and record["debrief_attempted"]
    assert selector.calls == 0


def test_partially_visible_authored_cue_set_is_not_assessable(harness):
    client, _, app = harness
    selector = app.state.debrief_selector = FakeDebrief()
    draft = sample()
    draft["objectives"] = [{"id": "check_two_cues", "label": "Clarify both authored cues", "keywords": ["clarify"], "opportunity_fact_ids": ["concern", "routine"], "guidance": "Both cues must be available before assessing this opportunity.", "debrief_focus": "clarify_available_inconsistency"}]
    eid, auth, _ = start(client, publish(client, draft))
    result = client.post(f"/api/encounters/{eid}/conclude", headers=auth).json()["feedback"]
    assert result["assessments"][0]["result"] == "not_assessable"
    assert result["critical_thinking_debrief"]["priorities"] == []
    assert selector.calls == 0 and app.state.quotas.remaining("bedrock") == 300
