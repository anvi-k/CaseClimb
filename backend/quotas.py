"""Finite workshop lifetime allowances; reservations count uncertain charges."""

import os

from .store import Conflict

LIMITS = {
    "sessions": ("CASECLIMB_SESSION_BUDGET", 200, 10_000),
    "bedrock": ("CASECLIMB_BEDROCK_CALL_BUDGET", 300, 10_000),
    "tts_characters": ("CASECLIMB_TTS_CHARACTER_BUDGET", 20_000, 1_000_000),
    "video_sessions": ("CASECLIMB_VIDEO_SESSION_BUDGET", 2, 100),
    "video_minutes": ("CASECLIMB_VIDEO_MINUTE_BUDGET", 20, 1000),
}


class Quotas:
    def __init__(self, store):
        self.store = store
        self.limits = {}
        for name, (env, default, maximum) in LIMITS.items():
            try:
                value = int(os.getenv(env, str(default)))
            except ValueError:
                raise RuntimeError(f"{env} must be a positive bounded integer") from None
            if not 1 <= value <= maximum:
                raise RuntimeError(f"{env} must be between 1 and {maximum}")
            self.limits[name] = value

    def remaining(self, name):
        record = self.store.get(f"quota:{name}")
        used = record["payload"]["used"] if record else 0
        return max(0, self.limits[name] - used)

    def reserve(self, name, amount=1):
        if amount < 1:
            raise ValueError("Reservations must be positive")
        for _ in range(20):
            record = self.store.get(f"quota:{name}")
            used = record["payload"]["used"] if record else 0
            if used + amount > self.limits[name]:
                return False
            try:
                self.store.put(f"quota:{name}", {"used": used + amount}, record["revision"] if record else None)
                return True
            except Conflict:
                continue
        # Fail closed under contention rather than exceeding the allowance.
        return False


class BudgetedSelector:
    def __init__(self, selector, quotas, allowed=None):
        self.selector, self.quotas = selector, quotas
        self.allowed = allowed or (lambda: True)

    def choose(self, text, candidates):
        if not candidates:
            return [], "authored"
        if not self.allowed():
            return [c["id"] for c in candidates], "authored_deadline_fallback"
        if not self.quotas.reserve("bedrock"):
            return [c["id"] for c in candidates], "authored_budget_fallback"
        if not self.allowed():
            return [c["id"] for c in candidates], "authored_deadline_fallback"
        return self.selector.choose(text, candidates)
