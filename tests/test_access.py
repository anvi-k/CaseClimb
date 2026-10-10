import copy
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient
from mangum import Mangum

from backend.access import COOKIE, SESSION_SECONDS
from backend.app import create_app
from backend.store import FileStore
from test_backend import ADMIN, publish, sample, start

PASSWORD = "synthetic-workshop-password"
SIGNING_SECRET = "synthetic-session-signing-secret-for-tests"


@pytest.fixture
def gated(tmp_path, monkeypatch):
    monkeypatch.setenv("CASECLIMB_APP_PASSWORD", PASSWORD)
    monkeypatch.setenv("CASECLIMB_SESSION_SECRET", SIGNING_SECRET)
    monkeypatch.setenv("CASECLIMB_ADMIN_TOKEN", "test-admin-secret")
    monkeypatch.setenv("CASECLIMB_STUDENT_CODE", "test-student-code")
    for name in ["CASECLIMB_BEDROCK_MODEL_ID", "CASECLIMB_DEBRIEF_MODEL_ID", "ELEVENLABS_API_KEY", "LIVEAVATAR_API_KEY", "LIVEAVATAR_AVATAR_ID", "CASECLIMB_ALLOW_LOCAL_HTTP", "AWS_LAMBDA_FUNCTION_NAME"]:
        monkeypatch.delenv(name, raising=False)
    now = [1000.0]
    store = FileStore(str(tmp_path / "access.json"))
    app = create_app(store, lambda: now[0])
    return TestClient(app, base_url="https://testserver"), now, app


def login(client, password=PASSWORD):
    return client.post("/auth/login", data={"password": password}, follow_redirects=False)


def test_gate_covers_static_apis_docs_and_preserves_health(gated):
    client, _, _ = gated
    for path in ["/", "/web", "/web/"]:
        page = client.get(path)
        assert page.status_code == 200 and "Sign in to CaseClimb" in page.text
        assert 'type="password"' in page.text and PASSWORD not in page.text
        assert page.headers["cache-control"] == "no-store"
    for path in ["/web/app.js", "/web/index.html", "/web/template.json", "/web/styles.css", "/docs", "/openapi.json", "/api/status", "/api/library", "/api/faculty/cases"]:
        denied = client.get(path, headers=ADMIN)
        assert denied.status_code == 401, path
        assert "facts" not in denied.text and "synthetic-workshop-password" not in denied.text
    assert client.post("/api/encounters", json={"case_id": "unknown", "access_code": "test-student-code"}).status_code == 401
    assert client.get("/health").json() == {"status": "ok"}
    assert client.get("/api/health").status_code == 200
    assert client.get("/auth/login").status_code == 200


def test_login_sets_secure_cookie_and_gate_keeps_second_authorization_layer(gated):
    client, _, _ = gated
    response = login(client)
    assert response.status_code == 303 and response.headers["location"] == "/web/"
    cookie = response.headers["set-cookie"]
    for attribute in ["HttpOnly", "Secure", "SameSite=strict", f"Max-Age={SESSION_SECONDS}", "Path=/"]:
        assert attribute in cookie
    assert PASSWORD not in cookie and SIGNING_SECRET not in cookie
    assert client.get("/web/").status_code == 200
    status = client.get("/api/status")
    assert status.status_code == 200 and status.json()["app_access_required"]
    assert PASSWORD not in status.text and SIGNING_SECRET not in status.text
    assert client.post("/api/faculty/cases", json=sample()).status_code == 401
    case_id = publish(client)
    eid, auth, _ = start(client, case_id)
    assert client.get(f"/api/encounters/{eid}").status_code == 401
    assert client.get(f"/api/encounters/{eid}", headers=ADMIN).status_code == 401
    assert client.get(f"/api/encounters/{eid}", headers=auth).status_code == 200
    assert client.post("/api/encounters", json={"case_id": case_id, "access_code": PASSWORD}).status_code == 403


def test_wrong_password_tamper_expiry_and_logout_revoke_cookie(gated):
    client, now, app = gated
    failed = login(client, "wrong-password")
    assert failed.status_code == 401 and "set-cookie" not in failed.headers
    assert "wrong-password" not in failed.text
    successful = login(client)
    original = successful.cookies.get(COOKIE)
    client.cookies.clear()
    client.cookies.set(COOKIE, original[:-1] + ("0" if original[-1] != "0" else "1"))
    assert client.get("/api/status").status_code == 401
    client.cookies.clear()
    client.cookies.set(COOKIE, original)
    now[0] += SESSION_SECONDS
    assert client.get("/api/status").status_code == 401
    client.cookies.clear()
    login(client)
    current = client.cookies.get(COOKIE)
    logged_out = client.post("/auth/logout", follow_redirects=False)
    assert logged_out.status_code == 303 and logged_out.headers["location"] == "/"
    assert "Max-Age=0" in logged_out.headers["set-cookie"]
    client.cookies.clear()
    client.cookies.set(COOKIE, current)
    assert client.get("/api/status").status_code == 401  # Replayed logged-out cookie is revoked.
    assert all("password" not in record["payload"] and SIGNING_SECRET not in str(record) for record in app.state.store.list("auth:"))


def test_login_rate_limit_is_durable_and_recovers_after_bucket(gated):
    client, now, app = gated
    for _ in range(20):
        assert login(client, "wrong").status_code == 401
    blocked = login(client)
    assert blocked.status_code == 429 and blocked.headers["retry-after"] == "60"
    other_app = create_app(app.state.store, app.state.clock)
    other_client = TestClient(other_app, base_url="https://testserver")
    assert login(other_client).status_code == 429
    now[0] += 61
    assert login(other_client).status_code == 303
    assert all("expires_at" in record for record in app.state.store.list("auth:login:"))


def test_login_bucket_compare_and_swap_is_bounded_under_concurrency(gated):
    client, _, app = gated
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda _: app.state.access._bucket("auth:login:race", 5, 1120), range(30)))
    assert sum(results) == 5
    assert app.state.store.get("auth:login:race")["payload"]["count"] == 5


def test_local_cookie_requires_explicit_loopback_opt_in(gated, monkeypatch):
    _, _, app = gated
    insecure = TestClient(app, base_url="http://127.0.0.1")
    assert login(insecure).status_code == 400
    monkeypatch.setenv("CASECLIMB_ALLOW_LOCAL_HTTP", "1")
    opted_in = create_app(app.state.store, app.state.clock)
    loopback = TestClient(opted_in, base_url="http://127.0.0.1")
    response = login(loopback)
    assert response.status_code == 303
    assert "Secure" not in response.headers["set-cookie"] and "HttpOnly" in response.headers["set-cookie"]
    assert loopback.get("/api/status").status_code == 200
    remote = TestClient(opted_in, base_url="http://app.example.test")
    assert login(remote).status_code == 400


def test_login_origin_body_and_content_are_bounded(gated):
    client, _, _ = gated
    assert client.post("/auth/login", json={"password": PASSWORD}, headers={"Origin": "https://evil.example.test"}).status_code == 403
    assert client.post("/auth/logout", headers={"Origin": "https://evil.example.test"}).status_code == 403
    assert client.post("/auth/login", content="x" * 4097).status_code == 413
    assert client.post("/auth/login", json={"password": PASSWORD, "extra": "ignored?"}).status_code == 401
    accepted = client.post("/auth/login", json={"password": PASSWORD}, headers={"Origin": "https://testserver"}, follow_redirects=False)
    assert accepted.status_code == 303


def test_partial_weak_or_missing_lambda_config_fails_closed(gated, monkeypatch):
    _, _, app = gated
    monkeypatch.delenv("CASECLIMB_SESSION_SECRET")
    partial = TestClient(create_app(app.state.store, app.state.clock), base_url="https://testserver")
    assert partial.get("/api/status").status_code == 503
    assert login(partial).status_code == 503
    monkeypatch.delenv("CASECLIMB_APP_PASSWORD")
    optional_local = TestClient(create_app(app.state.store, app.state.clock))
    assert optional_local.get("/api/status").status_code == 200
    monkeypatch.setenv("AWS_LAMBDA_FUNCTION_NAME", "synthetic-test-function")
    missing_cloud = TestClient(create_app(app.state.store, app.state.clock), base_url="https://testserver")
    assert missing_cloud.get("/web/").status_code == 503 and missing_cloud.get("/health").status_code == 200
    monkeypatch.setenv("CASECLIMB_APP_PASSWORD", "weak")
    monkeypatch.setenv("CASECLIMB_SESSION_SECRET", "short")
    weak = TestClient(create_app(app.state.store, app.state.clock), base_url="https://testserver")
    assert weak.get("/api/library").status_code == 503


def test_lambda_http_api_cookies_are_passed_to_gate(gated):
    client, _, app = gated
    cookie = login(client).cookies.get(COOKIE)
    handler = Mangum(app, lifespan="off")
    event = {"version": "2.0", "routeKey": "$default", "rawPath": "/api/status", "rawQueryString": "", "headers": {"host": "testserver", "x-forwarded-proto": "https"}, "requestContext": {"http": {"method": "GET", "path": "/api/status", "sourceIp": "127.0.0.1", "protocol": "HTTP/1.1"}}, "isBase64Encoded": False}
    assert handler(event, {})["statusCode"] == 401
    event["cookies"] = [f"{COOKIE}={cookie}"]
    assert handler(event, {})["statusCode"] == 200


def test_lambda_native_form_origin_survives_login_page_policy(gated):
    _, _, app = gated
    handler = Mangum(app, lifespan="off")
    origin = "https://example.execute-api.us-west-2.amazonaws.com"
    host = "example.execute-api.us-west-2.amazonaws.com"

    def event(method, path, extra_headers=None, cookie=None):
        value = {"version": "2.0", "routeKey": "$default", "rawPath": path,
                 "rawQueryString": "", "headers": {"host": host, "x-forwarded-proto": "https", **(extra_headers or {})},
                 "requestContext": {"http": {"method": method, "path": path, "sourceIp": "127.0.0.1", "protocol": "HTTP/1.1"}},
                 "isBase64Encoded": False}
        if cookie:
            value["cookies"] = [cookie]
        if method == "POST" and path == "/auth/login":
            value["body"] = f"password={PASSWORD}"
            value["headers"]["content-type"] = "application/x-www-form-urlencoded"
        return value

    for path in ["/", "/web/", "/auth/login"]:
        page = handler(event("GET", path), {})
        # no-referrer makes a native form navigation send Origin:null even
        # to this same host. Keep the real origin and suppress foreign referrers.
        assert page["headers"]["referrer-policy"] == "same-origin"
    browser_headers = {"origin": origin, "sec-fetch-site": "same-origin", "sec-fetch-mode": "navigate"}
    for invalid in ["null", "https://foreign.example.test"]:
        assert handler(event("POST", "/auth/login", {**browser_headers, "origin": invalid}), {})["statusCode"] == 403
        assert handler(event("POST", "/auth/logout", {**browser_headers, "origin": invalid}), {})["statusCode"] == 403
    assert handler(event("POST", "/auth/login", {**browser_headers, "sec-fetch-site": "cross-site"}), {})["statusCode"] == 403
    assert handler(event("POST", "/auth/login", {"sec-fetch-site": "cross-site"}), {})["statusCode"] == 403
    signed_in = handler(event("POST", "/auth/login", browser_headers), {})
    assert signed_in["statusCode"] == 303
    cookie = signed_in["cookies"][0].split(";", 1)[0]
    assert handler(event("GET", "/api/status", cookie=cookie), {})["statusCode"] == 200
    assert handler(event("POST", "/auth/logout", browser_headers, cookie), {})["statusCode"] == 303
    assert handler(event("GET", "/api/status", cookie=cookie), {})["statusCode"] == 401
