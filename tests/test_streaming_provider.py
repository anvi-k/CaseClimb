import contextlib

import pytest

from backend.providers import ElevenLabsTTS, SpeechPlan


PLAN = SpeechPlan("[calm] Authored words.", "patient-voice", "eleven_v4_turbo", {"stability": 0.4}, "Authored words.", "calm")


class StreamHTTP:
    def __init__(self, chunks):
        self.chunks = chunks
        self.reads, self.closed, self.calls = 0, False, []

    @contextlib.contextmanager
    def stream(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs))
        parent = self

        class Response:
            @property
            def content(self):
                raise AssertionError("Streaming must never read the complete body")

            def raise_for_status(self):
                pass

            def iter_bytes(self, chunk_size):
                for chunk in parent.chunks:
                    parent.reads += 1
                    yield chunk

        try:
            yield Response()
        finally:
            self.closed = True


def test_tts_yields_before_complete_response_and_closes_on_interrupt():
    http = StreamHTTP([b"\x01\x02" * 4096, b"\x03\x04" * 4096])
    frames = ElevenLabsTTS("private-key", "fallback", http).stream_plan(PLAN)
    assert next(frames) == b"\x01\x02" * 4096
    assert http.reads == 1 and not http.closed
    frames.close()
    assert http.closed and http.reads == 1
    method, url, options = http.calls[0]
    assert method == "POST" and url.endswith("/patient-voice/stream")
    assert options["params"] == {"output_format": "pcm_24000"}
    assert options["json"] == {"text": PLAN.text, "model_id": PLAN.model_id, "voice_settings": PLAN.voice_settings}


def test_stream_preserves_samples_across_odd_http_boundaries():
    http = StreamHTTP([b"a", b"bcd", b"efghi", b"j"])
    frames = list(ElevenLabsTTS("private-key", client=http).stream_plan(PLAN, chunk_bytes=4))
    assert b"".join(frames) == b"abcdefghij"
    assert all(0 < len(frame) <= 4 and len(frame) % 2 == 0 for frame in frames)
    assert http.closed


@pytest.mark.parametrize("chunks", [[], [b"x"], [b"xx" * 720_001]])
def test_empty_odd_and_oversized_streams_fail_and_close(chunks):
    http = StreamHTTP(chunks)
    with pytest.raises(ValueError):
        list(ElevenLabsTTS("private-key", client=http).stream_plan(PLAN))
    assert http.closed


def test_stream_provider_exception_closes_upstream():
    class Broken(StreamHTTP):
        @contextlib.contextmanager
        def stream(self, *args, **kwargs):
            try:
                class Response:
                    def raise_for_status(self): pass
                    def iter_bytes(self, chunk_size):
                        yield b"xx"
                        raise RuntimeError("private provider error")
                yield Response()
            finally:
                self.closed = True
    http = Broken([])
    generator = ElevenLabsTTS("private-key", client=http).stream_plan(PLAN)
    assert next(generator) == b"xx"
    with pytest.raises(RuntimeError):
        next(generator)
    assert http.closed
