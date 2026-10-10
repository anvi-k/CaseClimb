"""Communication starters follow the same review and encounter contract as cases."""

import pytest

from backend.case_templates import case_template
from backend.engine import validate_case
from test_backend import ADMIN, approval_body, harness, start, turn


def test_templates_require_faculty_access_and_do_not_create_cases(harness):
    client, _, app = harness
    for path in ("/api/faculty/templates", "/api/faculty/templates/communication-alex"):
        assert client.get(path).status_code == 401
    templates = client.get("/api/faculty/templates", headers=ADMIN).json()["templates"]
    assert [t["id"] for t in templates] == ["clinical-history", "communication-alex", "communication-maya", "communication-jordan", "communication-evelyn"]
    assert client.get("/api/faculty/templates/missing", headers=ADMIN).status_code == 404
    assert client.get("/api/library").json() == {"cases": []}
    assert app.state.quotas.remaining("sessions") == 200


@pytest.mark.parametrize("profile_id", ["alex", "maya", "jordan", "evelyn"])
def test_template_becomes_reviewed_patient_case_with_chart_and_feedback(harness, profile_id):
    client, _, app = harness
    draft = client.get(f"/api/faculty/templates/communication-{profile_id}", headers=ADMIN).json()["draft"]
    assert draft["learning_focus"] == "communication"
    assert draft["presentation_key"] == profile_id
    assert len(draft["objectives"]) == 3
    assert validate_case(case_template(f"communication-{profile_id}"))["valid"]
    assert not any("fictional conversation partner" in fact["patient_answer"] for fact in draft["facts"])
    case = client.post("/api/faculty/cases", headers=ADMIN, json=draft).json()
    case_id = case["id"]
    assert case["draft_status"] == "unreviewed" and case["versions"] == []
    assert client.get("/api/library").json() == {"cases": []}
    assert client.post("/api/encounters", json={"case_id": case_id, "access_code": "test-student-code"}).status_code == 409
    result = client.post(f"/api/faculty/cases/{case_id}/approve", headers=ADMIN, json=approval_body(client, case_id))
    assert result.status_code == 200
    assert client.post("/api/encounters", json={"case_id": case_id, "access_code": "wrong"}).status_code == 403
    library = client.get("/api/library").json()["cases"]
    assert library[0]["learning_focus"] == "communication"
    assert "facts" not in library[0] and "objectives" not in library[0]
    eid, auth, launched = start(client, case_id)
    assert launched["state"]["mode"] == "clinical_practice"
    assert launched["state"]["patient"]["presentation_key"] == profile_id
    assert launched["state"]["patient"]["age"] == draft["age"]
    response = turn(client, eid, auth, "How do you prefer to communicate?").json()
    assert any(f["id"] == "preferences" for f in response["state"]["chart"]["facts"])
    boundary = turn(client, eid, auth, "What medications and test results do you have?", "medical-details").json()
    assert "haven't been provided" in boundary["patient_event"]["text"]
    completed = client.post(f"/api/encounters/{eid}/conclude", headers=auth).json()
    assert len(completed["feedback"]["assessments"]) == 3
    assert "critical_thinking_debrief" in completed["feedback"]
    assert client.get("/api/faculty/analytics", headers=ADMIN).json()["encounters"] == 1
    assert "demo_snapshot" not in app.state.store.get(f"encounter:{eid}")["payload"]


def test_templates_are_independent_and_existing_cases_keep_default_focus(harness):
    first = case_template("communication-alex")
    first.facts[0].text = "An edited fact"
    assert case_template("communication-alex").facts[0].text != first.facts[0].text
    default = case_template("clinical-history")
    assert default.learning_focus == "clinical_history" and default.presentation_key == "clinical"
