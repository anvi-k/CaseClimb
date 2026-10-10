"""Shared app entrance with signed, revocable, expiring server-side sessions."""

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
from urllib.parse import parse_qs

from fastapi import Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response

from .store import Conflict

COOKIE = "caseclimb_app_session"
SESSION_SECONDS = 4 * 60 * 60
LOGIN_BODY_LIMIT = 4096
BUCKET_SECONDS = 60


def login_page(message=""):
    # Only fixed application-authored messages are accepted here.
    error = f'<p role="alert">{message}</p>' if message else ""
    return f'''<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in · CaseClimb</title>
<style>body{{font:18px system-ui,sans-serif;line-height:1.5;margin:0;background:#eef3f3;color:#142e32}}main{{max-width:420px;margin:12vh auto;padding:32px;background:white;border-radius:18px}}h1{{font-size:30px}}label{{display:block;font-weight:650}}input,button{{box-sizing:border-box;font:inherit;width:100%;padding:12px;margin-top:8px;border-radius:8px;border:1px solid #59777b}}button{{background:#174d55;color:white;cursor:pointer;margin-top:20px}}input:focus,button:focus{{outline:3px solid #d5a44c;outline-offset:3px}}[role=alert]{{color:#932a24}}@media(max-width:500px){{main{{margin:6vh 16px;padding:24px}}}}</style></head>
<body><main><h1>Sign in to CaseClimb</h1><p>Enter the shared app password provided by your workshop host.</p>{error}
<form action="/auth/login" method="post"><label for="password">App password</label>
<input id="password" name="password" type="password" autocomplete="current-password" maxlength="512" required autofocus>
<button type="submit">Continue</button></form><p>Faculty and encounter access use separate authorization after sign-in.</p></main></body></html>'''


class AppAccess:
    def __init__(self, store, clock):
        self.store, self.clock = store, clock
        self.password = os.getenv("CASECLIMB_APP_PASSWORD")
        self.secret = os.getenv("CASECLIMB_SESSION_SECRET")
        self.required = bool(self.password or self.secret or os.getenv("AWS_LAMBDA_FUNCTION_NAME"))
        self.configured = bool(self.password and len(self.password) >= 12 and self.secret and len(self.secret) >= 32)
        self.local_http = os.getenv("CASECLIMB_ALLOW_LOCAL_HTTP") == "1"

    def secure(self, request):
        local = request.url.hostname in {"127.0.0.1", "localhost", "::1"}
        return not (self.local_http and local and request.url.scheme == "http")

    def same_origin(self, request):
        origin = request.headers.get("origin")
        if request.headers.get("sec-fetch-site") == "cross-site":
            return False
        return not origin or origin.rstrip("/") == f"{request.url.scheme}://{request.url.netloc}"

    def _signature(self, payload):
        return hmac.new(self.secret.encode(), payload.encode(), hashlib.sha256).hexdigest()

    def _claims(self, cookie):
        if not self.configured or not cookie or len(cookie) > 2048:
            return None
        try:
            encoded, signature = cookie.split(".")
            if not secrets.compare_digest(self._signature(encoded), signature):
                return None
            claims = json.loads(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)))
            if set(claims) != {"v", "sid", "issued", "expires"} or claims["v"] != 1:
                return None
            if not isinstance(claims["sid"], str) or not re.fullmatch(r"[A-Za-z0-9_-]{32}", claims["sid"]):
                return None
            if type(claims["issued"]) is not int or type(claims["expires"]) is not int:
                return None
            if not claims["issued"] <= self.clock() < claims["expires"] or claims["expires"] - claims["issued"] != SESSION_SECONDS:
                return None
            return claims
        except (ValueError, TypeError, KeyError, UnicodeError):
            return None

    def authorized(self, request):
        if not self.required:
            return True
        claims = self._claims(request.cookies.get(COOKIE))
        if not claims:
            return False
        record = self.store.get(f"auth:session:{claims['sid']}")
        return bool(record and record["payload"].get("active") and record["payload"].get("expires") == claims["expires"])

    def _bucket(self, key, limit, expiry):
        for _ in range(10):
            record = self.store.get(key)
            count = record["payload"]["count"] if record else 0
            if count >= limit:
                return False
            try:
                self.store.put(key, {"count": count + 1}, record["revision"] if record else None, expiry)
                return True
            except Conflict:
                continue
        return False

    def reserve_login(self, request):
        window = int(self.clock()) // BUCKET_SECONDS
        expiry = (window + 2) * BUCKET_SECONDS
        ip = request.client.host if request.client else "unknown"
        ip_hash = hmac.new(self.secret.encode(), ip.encode(), hashlib.sha256).hexdigest()[:32]
        return self._bucket(f"auth:login:global:{window}", 60, expiry) and self._bucket(f"auth:login:ip:{ip_hash}:{window}", 20, expiry)

    def install(self, app):
        @app.get("/auth/login", include_in_schema=False)
        def entrance():
            return HTMLResponse(login_page(), headers={"Cache-Control": "no-store"})

        @app.post("/auth/login", include_in_schema=False)
        async def login(request: Request):
            if not self.required:
                return RedirectResponse("/web/", status_code=303)
            if not self.configured:
                return HTMLResponse(login_page("App access is not configured. Contact the workshop host."), status_code=503)
            if self.secure(request) and request.url.scheme != "https":
                return HTMLResponse(login_page("Use the secure HTTPS app address to sign in."), status_code=400)
            if not self.same_origin(request):
                return Response("Same-origin sign-in is required.", status_code=403)
            body = await request.body()
            if len(body) > LOGIN_BODY_LIMIT:
                return Response("Sign-in request is too large.", status_code=413)
            if not self.reserve_login(request):
                return HTMLResponse(login_page("Too many sign-in attempts. Wait one minute and try again."), status_code=429, headers={"Retry-After": "60"})
            try:
                content_type = request.headers.get("content-type", "").split(";", 1)[0]
                if content_type == "application/json":
                    value = json.loads(body)
                    password = value["password"] if isinstance(value, dict) and set(value) == {"password"} else None
                elif content_type == "application/x-www-form-urlencoded":
                    values = parse_qs(body.decode(), max_num_fields=2)
                    password = values["password"][0] if set(values) == {"password"} and len(values["password"]) == 1 else None
                else:
                    password = None
                valid = isinstance(password, str) and 0 < len(password) <= 512
                supplied = hashlib.sha256(password.encode()).digest() if valid else b"\x00" * 32
                expected = hashlib.sha256(self.password.encode()).digest()
                matches = secrets.compare_digest(supplied, expected)
            except (ValueError, TypeError, KeyError, UnicodeError):
                matches = False
            if not matches:
                return HTMLResponse(login_page("The app password was not accepted. Try again."), status_code=401)
            now = int(self.clock())
            sid = secrets.token_urlsafe(24)
            claims = {"v": 1, "sid": sid, "issued": now, "expires": now + SESSION_SECONDS}
            encoded = base64.urlsafe_b64encode(json.dumps(claims, separators=(",", ":")).encode()).decode().rstrip("=")
            cookie = f"{encoded}.{self._signature(encoded)}"
            self.store.put(f"auth:session:{sid}", {"active": True, "expires": claims["expires"]}, None, claims["expires"])
            response = RedirectResponse("/web/", status_code=303)
            response.set_cookie(COOKIE, cookie, max_age=SESSION_SECONDS, expires=SESSION_SECONDS, httponly=True, secure=self.secure(request), samesite="strict", path="/")
            return response

        @app.post("/auth/logout", include_in_schema=False)
        def logout(request: Request):
            if not self.same_origin(request):
                return Response("Same-origin logout is required.", status_code=403)
            claims = self._claims(request.cookies.get(COOKIE))
            if claims:
                for _ in range(5):
                    record = self.store.get(f"auth:session:{claims['sid']}")
                    if not record or not record["payload"].get("active"):
                        break
                    try:
                        self.store.put(f"auth:session:{claims['sid']}", {"active": False, "expires": claims["expires"]}, record["revision"], claims["expires"])
                        break
                    except Conflict:
                        continue
                else:
                    return Response("Session changed concurrently. Retry logout.", status_code=409)
            response = RedirectResponse("/", status_code=303)
            response.delete_cookie(COOKIE, httponly=True, secure=self.secure(request), samesite="strict", path="/")
            return response

        @app.middleware("http")
        async def app_entrance(request, call_next):
            exempt = request.url.path in {"/health", "/api/health"} or request.url.path.startswith("/auth/")
            if not exempt and self.required and not self.configured:
                response = HTMLResponse(login_page("App access is not configured. Contact the workshop host."), status_code=503)
            elif not exempt and not self.authorized(request):
                if request.method == "GET" and request.url.path.rstrip("/") in {"", "/web"}:
                    response = HTMLResponse(login_page())
                elif request.url.path.startswith("/api/"):
                    response = JSONResponse({"detail": "App sign-in required."}, status_code=401)
                else:
                    response = Response("App sign-in required.", status_code=401)
            else:
                response = await call_next(request)
            if self.required or request.url.path.startswith("/auth/"):
                response.headers["Cache-Control"] = "no-store"
            response.headers["X-Content-Type-Options"] = "nosniff"
            response.headers["Referrer-Policy"] = "no-referrer"
            response.headers["Permissions-Policy"] = "camera=(), microphone=(self)"
            return response
