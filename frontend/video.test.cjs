"use strict";
// Local transport contract tests; these do not contact or validate providers.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(`${__dirname}/video.js`, "utf8");
const conversationSource = fs.readFileSync(`${__dirname}/conversation.js`, "utf8");
const appSource = fs.readFileSync(`${__dirname}/app.js`, "utf8").split('$("practice-nav").addEventListener')[0];
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

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
  const sdk = { Room, RoomEvent: { TrackSubscribed: "track", TrackUnsubscribed: "untrack", AudioPlaybackStatusChanged: "audio", VideoPlaybackStatusChanged: "video", Disconnected: "disconnect", Reconnecting: "reconnecting", TrackSubscriptionFailed: "failed" }, Track: { Kind: { Video: "video", Audio: "audio" } }, isBrowserSupported: () => true, LogLevel: { silent: 5 }, setLogLevel(level) { this.logLevel = level; } };
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
  return { renderer, requests, sockets, rooms, sdk, timers, video, audio, statuses, context, packet, setNow: (value) => { now = value; } };
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
  const f = fixture(); await connect(f); const pending = f.renderer.speak("e2"); await flush();
  const request = f.requests.find((r) => r.path === "/video/audio");
  assert.equal(JSON.stringify(request.options.body), '{"event_id":"e2"}');
  assert.deepEqual(f.sockets[0].sent.map((p) => p.type), ["agent.interrupt", "agent.speak", "agent.speak", "agent.speak_end"]);
  assert.equal(f.sockets[0].sent[1].event_id, f.sockets[0].sent[3].event_id);
  assert.equal(f.renderer.remaining(), 90);
  f.sockets[0].receive({ type: "agent.speak_ended", source_event_id: f.packet.utterance_id }); await pending;
  f.renderer.stop();
});

test("interruption prevents delayed audio from reaching the renderer", async () => {
  let resolveAudio;
  const f = fixture({ request: (path) => {
    if (path === "/video/start") return Promise.resolve({ deadline: 100, livekit_url: "wss://room.example.test", livekit_client_token: "synthetic-client-token", ws_url: "wss://render.example.test" });
    if (path === "/video/audio") return new Promise((resolve) => { resolveAudio = resolve; });
    return Promise.resolve({});
  } });
  await connect(f); const speaking = f.renderer.speak("e2"); const rejected = assert.rejects(speaking, /did not finish/); f.renderer.interrupt();
  resolveAudio({ format: "pcm_s16le", sample_rate: 24000, channels: 1, utterance_id: "synthetic", chunks: ["AAAA"] }); await rejected;
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

test("completion waits for the matching utterance end, not submission or buffer acknowledgement", async () => {
  const f = fixture(); await connect(f); let finished = false;
  const pending = f.renderer.speak("e2").then(() => { finished = true; }); await flush();
  assert.equal(finished, false); assert.equal(f.renderer.speaking, true);
  for (const event of [
    { type: "agent.audio_buffer_committed", source_event_id: f.packet.utterance_id },
    { type: "agent.speak_started", source_event_id: f.packet.utterance_id },
    { type: "agent.speak_ended", event_id: f.packet.utterance_id, source_event_id: "older-utterance" },
    { type: "agent.speak_interrupted", source_event_id: "older-utterance" },
  ]) { f.sockets[0].receive(event); await flush(); assert.equal(finished, false); }
  f.sockets[0].receive({ type: "agent.speak_ended", event_id: "provider-response-id", source_event_id: f.packet.utterance_id }); await pending;
  assert.equal(finished, true); assert.equal(f.renderer.speaking, false); f.renderer.stop();
});

test("abort rejects video playback and a delayed completion cannot finish a new utterance", async () => {
  const f = fixture(); await connect(f); const controller = new AbortController();
  const oldId = f.packet.utterance_id;
  const first = f.renderer.speak("e2", { signal: controller.signal }); const rejected = assert.rejects(first, /did not finish/); await flush(); controller.abort(); await rejected;
  assert.equal(f.renderer.speaking, false); assert.equal(f.renderer.active, true);
  f.packet.utterance_id = "33333333-3333-4333-8333-333333333333";
  let finished = false; const second = f.renderer.speak("e3").then(() => { finished = true; }); await flush();
  f.sockets[0].receive({ type: "agent.speak_ended", source_event_id: oldId }); await flush(); assert.equal(finished, false);
  f.sockets[0].receive({ type: "agent.speak_ended", source_event_id: f.packet.utterance_id }); await second; f.renderer.stop();
});

for (const end of ["disconnect", "reconnecting", "timeout", "socket-error"]) {
  test(`${end} rejects a pending utterance, closes transport, and leaves no provider details`, async () => {
    const f = fixture(); await connect(f);
    const pending = f.renderer.speak("e2"); const rejected = assert.rejects(pending, /did not finish/); await flush();
    if (end === "timeout") f.renderer.utterance && f.timers.get(f.renderer.utterance.timer).fn();
    else if (end === "socket-error") f.sockets[0].onerror();
    else f.rooms[0].emit(end);
    await rejected;
    assert.equal(f.renderer.active, false); assert.equal(f.renderer.speaking, false);
    assert.equal(f.rooms[0].disconnected, true); assert.equal(f.sockets[0].closed, true);
    assert.equal(f.requests.filter((r) => r.path === "/video/stop").length, 1);
    assert.equal(f.statuses.some((s) => /ElevenLabs voice/.test(s)), true);
  });
}

test("blocked audio pauses the reply and requires explicit Allow playback, without losing captions", async () => {
  const f = fixture(); await connect(f);
  const pending = f.renderer.speak("e2"); const rejected = assert.rejects(pending, /did not finish/); await flush();
  const element = { play: () => Promise.reject(new Error("autoplay blocked")), pause() {}, remove() {} };
  f.rooms[0].emit("track", { kind: "audio", attach: () => element, detach: () => [] }); await flush(); await rejected;
  assert.equal(f.renderer.active, true); assert.equal(f.renderer.needsPlayback, true);
  const audioRequests = f.requests.filter((r) => r.path === "/video/audio").length;
  await assert.rejects(f.renderer.speak("e2"), /Allow video playback/);
  assert.equal(f.requests.filter((r) => r.path === "/video/audio").length, audioRequests);
  await f.renderer.allowPlayback(); assert.equal(f.renderer.needsPlayback, false); f.renderer.stop();
});

test("a sandbox deadline is explicitly labeled and clears the video while preserving voice fallback", async () => {
  const f = fixture({ request: (path) => {
    if (path === "/video/start") return Promise.resolve({ deadline: 60, livekit_url: "wss://room.example.test", livekit_client_token: "synthetic-client-token", ws_url: "wss://render.example.test", sandbox: true, avatar_name: "Wayne", max_seconds: 60 });
    return Promise.resolve({});
  } }); await connect(f);
  assert.equal(f.renderer.sandbox, true); assert.equal(f.renderer.avatarName, "Wayne");
  f.setNow(60000); f.timers.get(f.renderer.deadlineTimer).fn();
  assert.equal(f.renderer.active, false); assert.equal(f.video.srcObject, null);
  assert.match(f.statuses.at(-1), /60-second Wayne.*selected profile's ElevenLabs voice.*captions/);
});

function conversationFixture(f) {
  const recognitions = [], nodes = new Map(), mp3Requests = [];
  class Recognition {
    constructor() { recognitions.push(this); }
    start() { this.started = true; this.onstart?.(); }
    abort() { this.aborted = true; }
    final(text) { const row = [{ transcript: text }]; row.isFinal = true; this.onresult?.({ results: [row] }); }
  }
  f.context.window.webkitSpeechRecognition = Recognition;
  f.context.document.getElementById = (id) => {
    if (!nodes.has(id)) nodes.set(id, { value: "", hidden: false, dataset: {}, classList: { add() {}, remove() {}, toggle() {} }, replaceChildren() {}, focus() {}, closest() { return {}; } });
    return nodes.get(id);
  };
  f.context.location = { pathname: "/web/", href: "https://example.test/web/" };
  vm.runInContext(conversationSource, f.context);
  vm.runInContext(`${appSource}\nthis.appState = app; this.createConversation = createLiveConversation; this.playReply = playPatientReply;`, f.context);
  f.context.appState.encounter = { encounter_id: "original-demo", deadline: Date.now() / 1000 + 600, status: "active", mode: "conversation_demo", tts_available: true, confirmed_turns: 0, max_turns: 60, events: [{ id: "e0", actor: "patient", text: "Hello." }] };
  f.context.appState.encounterToken = "scoped-token"; f.context.appState.audioEnabled = true; f.context.appState.video = f.renderer;
  f.context.replyResponse = { state: f.context.appState.encounter, patient_event: { id: "e2", text: "I enjoy cycling." } };
  f.context.recordMp3 = (id) => { mp3Requests.push(id); };
  vm.runInContext(`
    renderLiveConversation = () => {}; setBusy = () => {};
    updateEncounter = (state) => { app.encounter = state; };
    api = async () => replyResponse;
    playPatientAudio = async (id) => { recordMp3(id); };
  `, f.context);
  f.context.createConversation();
  return { controller: f.context.appState.conversation, recognitions, nodes, mp3Requests };
}

test("actual app and speech controller play one video reply and do not resume mic before utterance end", async () => {
  const f = fixture(); await connect(f); const c = conversationFixture(f);
  await c.controller.start({ consented: true }); c.recognitions[0].final("What do you enjoy?"); await flush();
  assert.equal(c.controller.state, "speaking"); assert.equal(c.recognitions.length, 1); assert.equal(c.recognitions[0].aborted, true);
  assert.equal(f.requests.filter((r) => r.path === "/video/audio").length, 1);
  assert.equal(c.mp3Requests.length, 0); assert.equal(f.sockets[0].sent.filter((p) => p.type === "agent.speak_end").length, 1);
  f.sockets[0].receive({ type: "agent.audio_buffer_committed", source_event_id: f.packet.utterance_id }); await flush();
  assert.equal(c.recognitions.length, 1);
  f.sockets[0].receive({ type: "agent.speak_ended", source_event_id: f.packet.utterance_id }); await flush();
  assert.equal(c.controller.state, "listening"); assert.equal(c.recognitions.length, 2); assert.equal(c.mp3Requests.length, 0);
  c.controller.stop(); f.renderer.stop();
});

test("intentionally interrupting opening video leaves status intact, while strict playback still rejects", async () => {
  const f = fixture(); await connect(f); const c = conversationFixture(f);
  const status = f.context.document.getElementById("audio-status"); status.textContent = "Patient voice plays through the video feed.";
  const opening = f.context.playReply("e0"); await flush(); f.renderer.interrupt(); await opening;
  assert.equal(status.textContent, "Patient voice plays through the video feed.");
  assert.equal(f.renderer.active, true); assert.equal(c.recognitions.length, 0);
  const strict = f.context.playReply("e2", { strict: true });
  const rejected = assert.rejects(strict, (error) => error.kind === "video-interrupted");
  await flush(); f.renderer.interrupt(); await rejected;
  assert.equal(status.textContent, "Patient voice plays through the video feed.");
  assert.equal(c.recognitions.length, 0); f.renderer.stop();
});

test("a real provider failure still displays the static playback warning", async () => {
  const f = fixture(); await connect(f); conversationFixture(f);
  const status = f.context.document.getElementById("audio-status"); status.textContent = "Patient voice plays through the video feed.";
  const opening = f.context.playReply("e0"); await flush();
  f.sockets[0].receive({ type: "error", source_event_id: f.packet.utterance_id, error: { message: "private-provider-detail" } }); await opening;
  assert.match(status.textContent, /^Video audio did not finish\./);
  assert.equal(status.textContent.includes("private-provider-detail"), false);
  assert.equal(f.renderer.active, false);
});

test("video expiry pauses mic during reply, keeps visible text, then resumes ordinary voice only by user action", async () => {
  const f = fixture(); await connect(f); const c = conversationFixture(f);
  await c.controller.start({ consented: true }); c.recognitions[0].final("Hello"); await flush();
  f.renderer.endAtDeadline(); await flush();
  assert.equal(c.controller.enabled, false); assert.equal(c.controller.reason, "playback-error"); assert.equal(c.recognitions.length, 1);
  assert.equal(f.context.appState.encounter.events[0].text, "Hello.");
  assert.equal(c.mp3Requests.length, 0, "Do not replay the interrupted reply through a second audio path");
  await c.controller.start(); c.recognitions[1].final("Tell me more"); await flush();
  assert.equal(c.mp3Requests.length, 1); assert.equal(c.controller.state, "listening");
  assert.equal(f.requests.filter((r) => r.path === "/video/audio").length, 1);
  c.controller.stop(); f.renderer.stop();
});
