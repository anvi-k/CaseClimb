"use strict";
// Local transport contract tests; these do not contact or validate providers.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(`${__dirname}/video.js`, "utf8");

function fixture(overrides = {}) {
  const requests = [], sockets = [], rooms = [], statuses = [], timers = new Map();
  let now = 0, timerId = 0;
  class Socket {
    static OPEN = 1; static CONNECTING = 0;
    constructor(url) { this.url = url; this.readyState = 0; this.bufferedAmount = 0; this.sent = []; sockets.push(this); }
    send(text) { if (this.readyState !== 1) throw new Error("closed"); this.sent.push(JSON.parse(text)); }
    close() { this.readyState = 3; this.closed = true; }
    receive(event) { this.readyState = 1; this.onmessage?.({ data: JSON.stringify(event) }); }
  }
  class Room {
    constructor(options) { this.options = options; this.handlers = new Map(); this.canPlaybackAudio = true; this.canPlaybackVideo = true; rooms.push(this); }
    on(event, handler) { this.handlers.set(event, handler); return this; }
    emit(event, track) { this.handlers.get(event)?.(track); }
    connect(url, token, options) { this.connection = { url, token, options }; return Promise.resolve(); }
    removeAllListeners() { this.handlers.clear(); }
    disconnect(stopTracks) { this.disconnected = stopTracks; return Promise.resolve(); }
    startAudio() { this.audioStarted = true; return Promise.resolve(); }
    startVideo() { this.videoStarted = true; return Promise.resolve(); }
  }
  const sdk = { Room, RoomEvent: { TrackSubscribed: "track", TrackUnsubscribed: "untrack", AudioPlaybackStatusChanged: "audio", VideoPlaybackStatusChanged: "video", Disconnected: "disconnect", TrackSubscriptionFailed: "failed" }, Track: { Kind: { Video: "video", Audio: "audio" } }, isBrowserSupported: () => true, LogLevel: { silent: 5 }, setLogLevel(level) { this.logLevel = level; } };
  const video = { readyState: 2, play: () => Promise.resolve(), pause() { this.paused = true; }, srcObject: null };
  const audio = { elements: [], append(element) { this.elements.push(element); }, querySelectorAll() { return this.elements; } };
  const context = vm.createContext({ window: { LivekitClient: sdk }, document: { currentScript: { src: "https://example.test/web/video.js" } }, URL, AbortController, WebSocket: Socket, Date, crypto: { randomUUID: () => "11111111-1111-4111-8111-111111111111" }, setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; }, clearTimeout(id) { timers.delete(id); }, setInterval(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms, interval: true }); return id; }, clearInterval(id) { timers.delete(id); } });
  vm.runInContext(`${source}\nthis.Renderer = PatientVideoRenderer;`, context);
  const packet = { format: "pcm_s16le", sample_rate: 24000, channels: 1, utterance_id: "22222222-2222-4222-8222-222222222222", chunks: ["AAAA", "AQAB"], deadline: 90 };
  const renderer = new context.Renderer({ request: async (path, options) => {
    requests.push({ path, options });
    if (overrides.request) return overrides.request(path, options);
    if (path === "/video/start") return { deadline: 100, livekit_url: "wss://room.example.test", livekit_client_token: "synthetic-client-token", ws_url: "wss://render.example.test" };
    if (path === "/video/audio") return packet;
    return {};
  }, secondsRemaining: () => 600, serverNow: () => now, videoElement: video, audioContainer: audio, onChange: () => {}, onStatus: (value) => statuses.push(value), onAttempt: () => {} });
  return { renderer, requests, sockets, rooms, sdk, timers, video, audio, statuses, setNow: (value) => { now = value; } };
}
async function connect(f) {
  const pending = f.renderer.start();
  for (let i = 0; i < 6 && !f.sockets.length; i++) await Promise.resolve();
  assert.equal(f.sockets.length, 1);
  assert.equal(f.renderer.active, false);
  f.sockets[0].receive({ type: "session.state_updated", state: "connected" });
  await pending;
  assert.equal(f.renderer.active, true);
}

test("waits for renderer readiness and subscribes without creating local tracks", async () => {
  const f = fixture(); await connect(f);
  assert.equal(f.sdk.logLevel, 5);
  assert.equal(f.rooms[0].connection.options.autoSubscribe, true);
  assert.equal(f.renderer.remaining(), 100);
  assert.equal(f.sockets[0].sent.length, 0);
  f.renderer.stop();
});

test("requests only recorded event ID and sends fixed PCM envelopes", async () => {
  const f = fixture(); await connect(f); await f.renderer.speak("e2");
  const request = f.requests.find((r) => r.path === "/video/audio");
  assert.equal(JSON.stringify(request.options.body), '{"event_id":"e2"}');
  assert.deepEqual(f.sockets[0].sent.map((p) => p.type), ["agent.interrupt", "agent.speak", "agent.speak", "agent.speak_end"]);
  assert.equal(f.sockets[0].sent[1].event_id, f.sockets[0].sent[3].event_id);
  assert.equal(f.renderer.remaining(), 90);
  f.renderer.stop();
});

test("interruption prevents delayed audio from reaching the renderer", async () => {
  let resolveAudio;
  const f = fixture({ request: (path) => {
    if (path === "/video/start") return Promise.resolve({ deadline: 100, livekit_url: "wss://room.example.test", livekit_client_token: "synthetic-client-token", ws_url: "wss://render.example.test" });
    if (path === "/video/audio") return new Promise((resolve) => { resolveAudio = resolve; });
    return Promise.resolve({});
  } });
  await connect(f); const speaking = f.renderer.speak("e2"); f.renderer.interrupt();
  resolveAudio({ format: "pcm_s16le", sample_rate: 24000, channels: 1, utterance_id: "synthetic", chunks: ["AAAA"] }); await speaking;
  assert.equal(f.sockets[0].sent.some((p) => p.type === "agent.speak"), false);
  assert.equal(f.renderer.speaking, false); f.renderer.stop();
});

test("earlier video deadline closes tracks, socket and server session once", async () => {
  const f = fixture(); await connect(f);
  const track = { kind: "video", attach: () => {}, detach() { this.detached = true; return []; }, mediaStreamTrack: { stop() { this.stopped = true; } } };
  f.rooms[0].emit("track", track); assert.equal(f.renderer.visual, true);
  f.renderer.limitDeadline(10); const deadline = [...f.timers.values()].find((t) => t.ms === 10000);
  assert.ok(deadline); f.setNow(10000); deadline.fn(); f.renderer.stop();
  assert.equal(f.renderer.active, false); assert.equal(f.renderer.visual, false);
  assert.equal(track.detached, true); assert.equal(track.mediaStreamTrack.stopped, true);
  assert.equal(f.sockets[0].closed, true); assert.equal(f.rooms[0].disconnected, true);
  assert.equal(f.video.paused, true); assert.equal(f.video.srcObject, null);
  assert.equal(f.requests.filter((r) => r.path === "/video/stop").length, 1);
  assert.equal(f.timers.size, 0);
});

test("cleanup survives a failed detach and playback requires a user action", async () => {
  const f = fixture(); await connect(f);
  const track = { kind: "video", attach: () => {}, detach: () => { throw new Error("unavailable"); }, mediaStreamTrack: { stop() { this.stopped = true; } } };
  f.rooms[0].emit("track", track);
  assert.equal(f.rooms[0].audioStarted, undefined); await f.renderer.allowPlayback();
  assert.equal(f.rooms[0].audioStarted, true); assert.equal(f.rooms[0].videoStarted, true);
  f.renderer.stop(); assert.equal(track.mediaStreamTrack.stopped, true);
  assert.equal(f.requests.filter((r) => r.path === "/video/stop").length, 1);
});

test("provider errors remain static and do not disclose provider details", async () => {
  const f = fixture({ request: () => Promise.reject(new Error("private-provider-detail")) });
  await f.renderer.start();
  assert.equal(f.renderer.active, false);
  assert.equal(f.statuses.some((s) => s.includes("private-provider-detail")), false);
  assert.equal(f.statuses.some((s) => s.includes("Continue")), true);
});
