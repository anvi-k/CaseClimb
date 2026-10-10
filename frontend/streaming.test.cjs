"use strict";
// Transport/playback tests use controllable sockets and PCM sources. No device
// audio or provider request is made by this suite.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(`${__dirname}/streaming.js`, "utf8");
const conversation = fs.readFileSync(`${__dirname}/conversation.js`, "utf8");
const flush = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

class Socket {
  static OPEN = 1;
  constructor(url) { this.url = url; this.readyState = 0; this.bufferedAmount = 0; this.sent = []; queueMicrotask(() => { this.readyState = 1; this.onopen?.(); }); }
  send(text) { this.sent.push(JSON.parse(text)); }
  receive(frame) { this.onmessage?.({ data: JSON.stringify(frame) }); }
  close() { this.readyState = 3; this.onclose?.(); }
}
function context(extra = {}) {
  const env = vm.createContext({ document: { currentScript: { src: "https://example.test/web/streaming.js" } }, window: {}, navigator: { mediaDevices: {} }, URL, WebSocket: Socket, AbortController, Date, crypto: { randomUUID: () => "local-request-id" }, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, atob, btoa, ...extra });
  vm.runInContext(`${source}\n${conversation}\nthis.classes = { EncounterStreamingClient, StreamingPcmPlayer, ScribeMicrophone, StreamingSpeechConversation };`, env);
  return env;
}
function fixture() {
  const env = context(), sockets = [], confirmed = [], chunks = [], statuses = [], drains = [], starts = [];
  let tickets = 0, refreshes = 0, active = true, refresh = async () => state;
  const state = { confirmed_turns: 1, events: [{ id: "e2", actor: "patient", text: "I enjoy cycling." }] };
  const sink = { begin: async (frame) => starts.push(frame), push: async (audio) => chunks.push(audio), finish: () => { const wait = deferred(); drains.push(wait); return wait.promise; }, stop: () => { for (const drain of drains) drain.reject(new Error("stopped")); } };
  const client = new env.classes.EncounterStreamingClient({ requestTicket: async () => { ++tickets; return { websocket_url: "wss://example.test/live?ticket=local-test-ticket", deadline: Date.now() / 1000 + 600 }; }, refreshState: () => { ++refreshes; return refresh(); }, canInteract: () => active, onConfirmed: (value) => confirmed.push(value), createSink: () => sink, onStatus: (text) => statuses.push(text), socketFactory: (url) => { const socket = new Socket(url); sockets.push(socket); return socket; } });
  const frames = (id = "r1") => ({
    confirmed: { type: "turn.confirmed", request_id: id, state, patient_event: state.events[0] },
    start: { type: "audio.start", request_id: id, utterance_id: `u-${id}`, event_id: "e2", format: "pcm_s16le", sample_rate: 24000, channels: 1 },
    chunk: { type: "audio.chunk", request_id: id, utterance_id: `u-${id}`, sequence: 0, audio: "AAA=" },
    end: { type: "audio.end", request_id: id, utterance_id: `u-${id}` },
  });
  return { env, client, sockets, confirmed, chunks, statuses, drains, starts, state, frames, counts: () => ({ tickets, refreshes }), setActive: (value) => { active = value; }, setRefresh: (handler) => { refresh = handler; } };
}

test("PCM arrives before generation EOF and completion waits for actual playback drain", async () => {
  const f = fixture(); let completed = false;
  const reply = f.client.turn({ request_id: "r1", text: "What do you enjoy?", confirmed: true }).then((result) => { completed = true; return result; });
  await flush(); assert.equal(f.sockets.length, 1);
  assert.equal(f.sockets[0].sent[0].action, "turn"); assert.equal(f.sockets[0].sent[0].audio, true);
  assert.deepEqual(Object.keys(f.sockets[0].sent[0]).sort(), ["action", "audio", "request_id", "text"]);
  const frames = f.frames(); f.sockets[0].receive(frames.confirmed); f.sockets[0].receive(frames.start); f.sockets[0].receive(frames.chunk); await flush();
  assert.equal(f.confirmed.length, 1); assert.equal(f.chunks.length, 1); assert.equal(f.drains.length, 0); assert.equal(completed, false);
  f.sockets[0].receive(frames.end); await flush(); assert.equal(f.drains.length, 1); assert.equal(completed, false);
  f.drains[0].resolve(); const result = await reply;
  assert.equal(completed, true); assert.equal(result.patient_event.id, "e2"); assert.equal(result.streamed, true); f.client.close();
});

test("large ledger hydration runs beside PCM and never resubmits the question", async () => {
  const f = fixture(), hydration = deferred(); f.setRefresh(() => hydration.promise);
  const reply = f.client.turn({ request_id: "r1", text: "Hello" }); await flush();
  const frames = f.frames(); f.sockets[0].receive({ ...frames.confirmed, state: null, refresh_required: true });
  f.sockets[0].receive(frames.start); f.sockets[0].receive(frames.chunk); f.sockets[0].receive(frames.end); await flush();
  assert.equal(f.chunks.length, 1, "audio must not wait for a large-ledger GET"); assert.equal(f.confirmed.length, 0); assert.equal(f.counts().refreshes, 1);
  f.drains[0].resolve(); await flush(); assert.notEqual(f.client.operation, null);
  hydration.resolve(f.state); await reply;
  assert.equal(f.confirmed.length, 1); assert.equal(f.sockets[0].sent.filter((frame) => frame.action === "turn").length, 1); f.client.close();
});

test("unconfirmed cancellation waits for server terminal release and discards later audio", async () => {
  const f = fixture(), abort = new AbortController(); let settled = false;
  const reply = f.client.turn({ request_id: "r1", text: "Hello" }, { signal: abort.signal });
  const rejected = assert.rejects(reply, (error) => error.kind === "cancelled").then(() => { settled = true; });
  await flush(); abort.abort(); await flush();
  assert.equal(settled, false); assert.equal(f.sockets[0].sent.at(-1).action, "cancel");
  await assert.rejects(f.client.turn({ request_id: "r2", text: "Again" }), (error) => error.kind === "pending");
  const frames = f.frames(); f.sockets[0].receive(frames.start); f.sockets[0].receive(frames.chunk); await flush(); assert.equal(f.chunks.length, 0);
  f.sockets[0].receive({ type: "stream.error", request_id: "r1", code: "cancelled", message: "private-provider-detail" }); await rejected;
  assert.equal(f.statuses.join(" ").includes("private-provider-detail"), false); f.client.close();
});

test("independent HTTP cancellation releases an unconfirmed job while its socket worker is busy", async () => {
  const f = fixture(), acknowledgement = deferred(); let cancelledId;
  f.client.cancelRequest = (id) => { cancelledId = id; return acknowledgement.promise; };
  const reply = f.client.turn({ request_id: "r1", text: "Hello" }); const rejected = assert.rejects(reply, (error) => error.kind === "cancelled"); await flush();
  f.client.cancel(); await flush(); assert.equal(cancelledId, "r1"); assert.notEqual(f.client.operation, null);
  acknowledgement.resolve({ cancelled: true }); await rejected; assert.equal(f.client.operation, null); f.client.close();
});

test("confirmed interruption preserves the ledger and rejects stale or misordered audio", async () => {
  const f = fixture(), abort = new AbortController();
  const reply = f.client.turn({ request_id: "r1", text: "Hello" }, { signal: abort.signal }); const rejected = assert.rejects(reply, (error) => error.kind === "cancelled"); await flush();
  const frames = f.frames(); f.sockets[0].receive(frames.confirmed); f.sockets[0].receive(frames.start); f.sockets[0].receive(frames.chunk); await flush(); abort.abort(); await rejected;
  assert.equal(f.confirmed.length, 1);
  f.sockets[0].receive({ ...frames.chunk, sequence: 1 }); await flush(); assert.equal(f.chunks.length, 1);
  const second = f.client.speak("e2", { requestId: "r2" }); const secondRejected = assert.rejects(second, /interrupted/); await flush();
  const next = f.frames("r2"); f.sockets[0].receive(next.start); f.sockets[0].receive({ ...next.chunk, sequence: 3 }); await secondRejected; f.client.close();
});

test("reconnect refreshes the ledger and sends only a newly explicit request", async () => {
  const f = fixture(); const first = f.client.turn({ request_id: "r1", text: "Hello" }); const rejected = assert.rejects(first, (error) => error.kind === "disconnected"); await flush();
  f.sockets[0].close(); await rejected; assert.equal(f.counts().tickets, 1);
  const second = f.client.speak("e2", { requestId: "r2" }); await flush(); assert.equal(f.counts().refreshes, 1); assert.equal(f.counts().tickets, 2);
  assert.deepEqual(f.sockets[1].sent.map((frame) => frame.action), ["speak"]);
  const frames = f.frames("r2"); f.sockets[1].receive(frames.start); f.sockets[1].receive(frames.chunk); f.sockets[1].receive(frames.end); await flush(); f.drains[0].resolve(); await second; f.client.close();
});

test("ending freezes delivery and close cancels every outstanding operation", async () => {
  const f = fixture(); const reply = f.client.turn({ request_id: "r1", text: "Hello" }); const rejected = assert.rejects(reply, /ended|stopped/); await flush();
  f.setActive(false); f.sockets[0].receive(f.frames().confirmed); await rejected;
  assert.equal(f.confirmed.length, 0); assert.equal(f.chunks.length, 0); f.client.close();
  await assert.rejects(f.client.speak("e2"), /ended/);
});

class AudioContext {
  constructor() { this.currentTime = 0; this.state = "running"; this.destination = {}; this.sources = []; }
  resume() { return Promise.resolve(); }
  close() { this.state = "closed"; return Promise.resolve(); }
  createBuffer(channels, samples, rate) { return { channels, samples, rate, values: new Float32Array(samples), getChannelData() { return this.values; } }; }
  createBufferSource() { const source = { connect() {}, disconnect() {}, start(at) { this.at = at; }, stop() { this.stopped = true; } }; this.sources.push(source); return source; }
}
test("WebAudio schedules aligned PCM incrementally and waits for the last audible source", async () => {
  const audio = new AudioContext(), env = context(); const player = new env.classes.StreamingPcmPlayer({ createContext: () => audio });
  await player.begin({ format: "pcm_s16le", sample_rate: 24000, channels: 1 });
  player.push("AIAAQA=="); player.push("AAA="); assert.equal(audio.sources.length, 2);
  assert.equal(audio.sources[0].buffer.values[0], -1); assert.equal(audio.sources[0].buffer.values[1], .5);
  assert.ok(audio.sources[1].at >= audio.sources[0].at + 2 / 24000);
  let ended = false; const finished = player.finish().then(() => { ended = true; }); await flush(); assert.equal(ended, false);
  audio.sources[0].onended(); await flush(); assert.equal(ended, false); audio.sources[1].onended(); await finished; assert.equal(ended, true); player.close();
});

test("WebAudio cancellation stops all scheduled samples and rejects odd PCM byte counts", async () => {
  const audio = new AudioContext(), env = context(); const player = new env.classes.StreamingPcmPlayer({ createContext: () => audio });
  await player.begin({ format: "pcm_s16le", sample_rate: 24000, channels: 1 });
  assert.throws(() => player.push("AA=="), /format/); player.push("AAA=");
  const rejected = assert.rejects(player.finish(), (error) => error.kind === "cancelled"); player.stop(); await rejected;
  assert.equal(audio.sources[0].stopped, true); assert.equal(player.sources.size, 0); player.close();
});

function microphoneFixture(overrides = {}) {
  const sockets = [], nodes = [], tracks = [{ stop() { this.stopped = true; } }], partials = [], committed = [], errors = [];
  const audio = new AudioContext(); audio.audioWorklet = { addModule: async (url) => { audio.module = url; } };
  audio.createMediaStreamSource = (stream) => ({ stream, connect(node) { this.node = node; }, disconnect() { this.disconnected = true; } });
  class Worklet { constructor(context, name, options) { this.context = context; this.name = name; this.options = options; this.port = {}; nodes.push(this); } connect() {} disconnect() { this.disconnected = true; } }
  const env = context({ AudioWorkletNode: Worklet }); let microphoneOptions;
  const microphone = new env.classes.ScribeMicrophone({
    requestToken: overrides.requestToken || (async () => ({ token: "synthetic-single-use-token", deadline: Date.now() / 1000 + 600, model_id: "scribe_v2_realtime", audio_format: "pcm_16000", sample_rate: 16000 })),
    canInteract: () => true, onPartial: (text) => partials.push(text), onCommitted: (text) => committed.push(text), onError: (reason) => errors.push(reason),
    socketFactory: (url) => { const socket = new Socket(url); sockets.push(socket); return socket; },
    mediaDevices: { getUserMedia: overrides.getUserMedia || (async (options) => { microphoneOptions = options; return { getTracks: () => tracks }; }) }, createContext: () => audio,
  });
  return { microphone, sockets, nodes, tracks, partials, committed, errors, audio, options: () => microphoneOptions };
}
test("Scribe streams only microphone PCM, exposes partials, and commits a phrase only once", async () => {
  const f = microphoneFixture(); const starting = f.microphone.start(); await flush();
  const url = new URL(f.sockets[0].url); assert.equal(url.protocol, "wss:"); assert.equal(url.searchParams.get("audio_format"), "pcm_16000"); assert.equal(url.searchParams.get("include_timestamps"), "false");
  f.sockets[0].receive({ message_type: "session_started" }); assert.equal(await starting, true);
  assert.equal(f.options().video, false); assert.equal(f.options().audio.echoCancellation, true); assert.match(f.audio.module, /microphone-worklet.js$/);
  f.nodes[0].port.onmessage({ data: new Int16Array([0, 10, -10]).buffer }); assert.equal(f.sockets[0].sent[0].message_type, "input_audio_chunk"); assert.equal(f.sockets[0].sent[0].sample_rate, 16000); assert.equal(f.sockets[0].sent[0].commit, false);
  f.sockets[0].receive({ message_type: "partial_transcript", text: "Tell me" }); assert.deepEqual(f.partials, ["Tell me"]); assert.equal(f.committed.length, 0);
  f.sockets[0].receive({ message_type: "committed_transcript", text: "Tell me more" });
  f.sockets[0].receive({ message_type: "committed_transcript_with_timestamps", text: "Tell me more" }); assert.deepEqual(f.committed, ["Tell me more"]);
  f.microphone.stop(); assert.equal(f.tracks[0].stopped, true); assert.equal(f.nodes[0].disconnected, true); assert.equal(f.audio.state, "closed"); assert.equal(f.sockets[0].readyState, 3);
});

test("pausing during microphone permission or Scribe handshake cleans up delayed device access", async () => {
  const permission = deferred(), f = microphoneFixture({ getUserMedia: () => permission.promise });
  const starting = f.microphone.start(); await flush(); f.microphone.stop(); permission.resolve({ getTracks: () => f.tracks });
  assert.equal(await starting, false); assert.equal(f.tracks[0].stopped, true); assert.equal(f.sockets.length, 0);
  const g = microphoneFixture(); const handshake = g.microphone.start(); await flush(); g.microphone.stop();
  assert.equal(await handshake, false); assert.equal(g.tracks[0].stopped, true); assert.equal(g.errors.length, 0);
});

test("microphone denial and provider faults are static and never leak arbitrary provider details", async () => {
  const denial = new Error("private-device-detail"); denial.name = "NotAllowedError";
  const f = microphoneFixture({ getUserMedia: async () => { throw denial; } }); assert.equal(await f.microphone.start(), false); assert.deepEqual(f.errors, ["microphone-denied"]);
  const g = microphoneFixture(); const starting = g.microphone.start(); await flush(); g.sockets[0].receive({ message_type: "auth_error", error: "private-provider-detail" });
  assert.equal(await starting, false); assert.equal(g.errors.join(" ").includes("private-provider-detail"), false); assert.equal(g.tracks[0].stopped, true);
});

function speechFixture() {
  const env = context(), sends = [], states = [], transcripts = [], microphones = [], plays = [];
  const available = { sessionActive: true, voice: true, recognition: true, busy: false };
  let stops = 0;
  const controller = new env.classes.StreamingSpeechConversation({ availability: () => available,
    createTranscriber: (callbacks) => { const microphone = { callbacks, start: async () => true, stop() { this.stopped = true; } }; microphones.push(microphone); return microphone; },
    sendFinal: (text, options) => { const request = { text, options, ...deferred() }; sends.push(request); return request.promise; },
    speakReply: (reply, options) => { const play = { reply, options, ...deferred() }; plays.push(play); return play.promise; },
    stopPlayback: () => { ++stops; }, onState: (state) => states.push(state), onTranscript: (text) => transcripts.push(text), idFactory: () => `r${sends.length + 1}`,
  });
  return { controller, sends, states, transcripts, microphones, plays, available, stops: () => stops };
}
test("streaming speech keeps one microphone, submits only committed text and waits for audible drain", async () => {
  const f = speechFixture(); await f.controller.start(); assert.equal(f.microphones.length, 0);
  await f.controller.start({ consented: true }); const mic = f.microphones[0];
  mic.callbacks.onPartial("What do you"); assert.equal(f.sends.length, 0); mic.callbacks.onCommitted("What do you enjoy?"); await flush();
  assert.equal(f.sends.length, 1); assert.equal(mic.stopped, undefined); f.controller.replySpeaking(); assert.equal(f.controller.state, "speaking");
  f.sends[0].resolve({ id: "e2" }); await flush(); assert.equal(f.controller.state, "listening"); assert.equal(f.plays.length, 0, "streamed reply must not play twice");
  assert.equal(f.microphones.length, 1); f.controller.stop(); assert.equal(mic.stopped, true);
});

test("barge-in cancels output, queues one committed phrase and awaits previous job settlement", async () => {
  const f = speechFixture(); await f.controller.start({ consented: true }); const mic = f.microphones[0];
  mic.callbacks.onCommitted("Hello"); await flush(); f.controller.replySpeaking();
  mic.callbacks.onPartial("Wait"); assert.equal(f.sends[0].options.signal.aborted, true);
  const stops = f.stops(); mic.callbacks.onPartial("Wait"); assert.equal(f.stops(), stops, "repeated keepalive partial must not interrupt again");
  mic.callbacks.onCommitted("Wait, can we slow down?"); assert.equal(f.sends.length, 1);
  const cancelled = new Error("cancelled"); cancelled.kind = "cancelled"; f.sends[0].reject(cancelled); await flush();
  assert.equal(f.sends.length, 2); assert.equal(f.sends[1].text, "Wait, can we slow down?"); assert.equal(f.sends[1].options.requestId, "r2");
  f.sends[1].resolve({ id: "e3" }); await flush(); assert.equal(f.controller.state, "listening"); f.controller.stop();
});

test("ending during streaming prevents queued speech or late completion from reopening capture", async () => {
  const f = speechFixture(); await f.controller.start({ consented: true }); const mic = f.microphones[0];
  mic.callbacks.onCommitted("Hello"); await flush(); mic.callbacks.onPartial("Wait"); mic.callbacks.onCommitted("Tell me more");
  f.available.sessionActive = false; f.controller.sessionEnded(); f.sends[0].resolve({ id: "e2" }); await flush();
  assert.equal(f.sends.length, 1); assert.equal(f.controller.enabled, false); assert.equal(f.controller.reason, "session-ended"); assert.equal(mic.stopped, true);
  mic.callbacks.onCommitted("Late phrase"); await flush(); assert.equal(f.sends.length, 1);
});

for (const rate of [44100, 48000]) {
  test(`microphone worklet preserves 16 kHz PCM cadence across ${rate} Hz render quanta`, () => {
    const packets = [];
    class Processor { constructor() { this.port = { postMessage: (buffer) => packets.push(new Int16Array(buffer.slice(0))) }; } }
    const env = vm.createContext({ AudioWorkletProcessor: Processor, sampleRate: rate, registerProcessor: (name, Constructor) => { env.Constructor = Constructor; } });
    vm.runInContext(fs.readFileSync(`${__dirname}/microphone-worklet.js`, "utf8"), env);
    const processor = new env.Constructor();
    let processed = 0;
    while (processed < rate) {
      const size = Math.min(128, rate - processed), input = new Float32Array(size).fill(.5), output = new Float32Array(size).fill(1);
      assert.equal(processor.process([[input]], [[output]]), true); assert.equal(output.every((sample) => sample === 0), true);
      processed += size;
    }
    assert.equal(packets.length, 10); assert.equal(packets.every((packet) => packet.length === 1600), true);
    assert.equal(packets.every((packet) => packet.every((sample) => sample === 16384)), true);
  });
}

test("actual app uses streamed audio once with legacy recognition and hydrates the ledger before playback ends", async () => {
  const sockets = [], contexts = [], recognitions = [], requests = [], nodes = new Map();
  class AppSocket extends Socket { constructor(url) { super(url); sockets.push(this); } }
  class AppAudio extends AudioContext { constructor() { super(); contexts.push(this); } }
  class Recognition { constructor() { recognitions.push(this); } start() { this.onstart?.(); } abort() { this.aborted = true; } }
  const node = (id) => {
    if (!nodes.has(id)) nodes.set(id, { children: [], childNodes: [], dataset: {}, value: "", classList: { add() {}, remove() {}, toggle() {} }, replaceChildren() {}, closest() { return {}; }, focus() {}, append() {}, setAttribute() {} });
    return nodes.get(id);
  };
  const env = context({ WebSocket: AppSocket, window: { AudioContext: AppAudio, SpeechRecognition: Recognition }, location: { pathname: "/web/", href: "https://example.test/web/", hash: "", search: "" } });
  env.document.getElementById = node; env.document.createElement = () => node(`created-${nodes.size}`);
  const appSource = fs.readFileSync(`${__dirname}/app.js`, "utf8").split('$("practice-nav").addEventListener')[0];
  vm.runInContext(`${appSource}
    this.appState = app; this.createConversation = createLiveConversation;
    renderLiveConversation = renderVoiceControls = renderVideoControls = () => {};
    updateEncounter = (state) => { app.encounter = state; };
  `, env);
  const state = { encounter_id: "streaming-app-test", deadline: Date.now() / 1000 + 600, server_time: Date.now() / 1000, status: "active", mode: "conversation_demo", tts_available: true, confirmed_turns: 0, max_turns: 60, events: [{ id: "e0", actor: "patient", text: "Hello." }] };
  env.appState.encounter = state; env.appState.encounterToken = "local-scoped-token"; env.appState.audioEnabled = true;
  env.appState.status = { streaming_configured: true, stt_available: false, tts_available: true };
  env.localRequest = async (path) => { requests.push(path); if (path.endsWith("/stream-ticket")) return { websocket_url: "wss://example.test/live?ticket=local-test", deadline: state.deadline }; if (path.endsWith("/stream-cancel")) return {}; throw new Error(`Unexpected request ${path}`); };
  vm.runInContext("api = (path) => localRequest(path);", env); env.createConversation();
  await env.appState.conversation.start({ consented: true });
  const result = [{ transcript: "What do you enjoy?" }]; result.isFinal = true; recognitions[0].onresult({ results: [result] }); await flush();
  const requestId = sockets[0].sent[0].request_id;
  assert.deepEqual(Object.keys(sockets[0].sent[0]).sort(), ["action", "audio", "request_id", "text"], "HTTP-only confirmed flag must not leak into strict WebSocket dispatch");
  const confirmed = { ...state, confirmed_turns: 1, events: [...state.events, { id: "e2", actor: "patient", text: "I enjoy music." }] };
  sockets[0].receive({ type: "turn.confirmed", request_id: requestId, state: confirmed, patient_event: confirmed.events[1] });
  sockets[0].receive({ type: "audio.start", request_id: requestId, utterance_id: "u-app", event_id: "e2", format: "pcm_s16le", sample_rate: 24000, channels: 1 });
  sockets[0].receive({ type: "audio.chunk", request_id: requestId, utterance_id: "u-app", sequence: 0, audio: "AAA=" }); await flush();
  assert.equal(env.appState.encounter.confirmed_turns, 1); assert.equal(contexts[0].sources.length, 1); assert.equal(recognitions.length, 1);
  assert.match(node("audio-status").textContent, /Streaming ElevenLabs voice/);
  sockets[0].receive({ type: "audio.end", request_id: requestId, utterance_id: "u-app" }); await flush(); assert.equal(recognitions.length, 1);
  assert.match(node("audio-status").textContent, /Streaming ElevenLabs voice/, "EOF must not claim audible playback has finished");
  contexts[0].sources[0].onended(); await flush();
  assert.equal(node("audio-status").textContent, "Patient audio finished. Captions remain available.");
  assert.equal(recognitions.length, 2, "legacy microphone resumes only after streamed audio drains");
  assert.equal(sockets[0].sent.filter((frame) => frame.action === "turn").length, 1);
  assert.deepEqual(requests, ["/encounters/streaming-app-test/stream-ticket"], "streamed reply must not also fetch buffered MP3 or synthesize twice");
  // A drain resolving immediately before cancellation must not publish a
  // success into the paused UI from a later continuation.
  const replay = env.appState.streamClient.speak("e2", { requestId: "replay" }); const interrupted = assert.rejects(replay, (error) => error.kind === "cancelled"); await flush();
  sockets[0].receive({ type: "audio.start", request_id: "replay", utterance_id: "u-replay", event_id: "e2", format: "pcm_s16le", sample_rate: 24000, channels: 1 });
  sockets[0].receive({ type: "audio.chunk", request_id: "replay", utterance_id: "u-replay", sequence: 0, audio: "AAA=" });
  sockets[0].receive({ type: "audio.end", request_id: "replay", utterance_id: "u-replay" }); await flush();
  contexts[0].sources[1].onended(); env.appState.streamClient.cancel(); node("audio-status").textContent = "Response stopped.";
  await interrupted; await flush(); assert.equal(node("audio-status").textContent, "Response stopped.");
  env.appState.conversation.stop(); env.appState.streamClient.close(); env.appState.pcmPlayer.close();
});
