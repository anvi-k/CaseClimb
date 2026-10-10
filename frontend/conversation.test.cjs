"use strict";
// Deterministic controller tests. No real microphone or provider is contacted.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(`${__dirname}/conversation.js`, "utf8");
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

function fixture() {
  const recognitions = [], sends = [], plays = [], states = [], captions = [];
  const available = { sessionActive: true, recognition: true, voice: true, busy: false };
  let stoppedAudio = 0;
  class Recognition {
    constructor() { recognitions.push(this); }
    start() { this.started = true; this.onstart?.(); }
    abort() { this.aborted = true; this.onend?.(); }
    result(text, final = true) { const row = [{ transcript: text }]; row.isFinal = final; this.onresult?.({ results: [row], resultIndex: 0 }); }
    error(error) { this.onerror?.({ error }); }
  }
  const context = vm.createContext({ AbortController });
  vm.runInContext(`${source}\nthis.Controller = LiveSpeechConversation`, context);
  const controller = new context.Controller({
    createRecognition: () => new Recognition(), availability: () => available,
    sendFinal(text, options) { const wait = deferred(); sends.push({ text, options, wait }); return wait.promise; },
    speakReply(reply, options) { const wait = deferred(); plays.push({ reply, options, wait }); return wait.promise; },
    stopPlayback() { stoppedAudio++; }, onState: (state) => states.push(state), onTranscript: (caption) => captions.push(caption), idFactory: () => `request-${sends.length + 1}`,
  });
  return { controller, recognitions, sends, plays, states, captions, available, stoppedAudio: () => stoppedAudio };
}

test("explicit consent is required; unavailable voice or recognition uses fallback", async () => {
  const f = fixture(); assert.equal(await f.controller.start(), false); assert.equal(f.recognitions.length, 0);
  f.available.recognition = false; await f.controller.start({ consented: true });
  assert.equal(f.controller.reason, "recognition-unavailable"); assert.equal(f.recognitions.length, 0);
  f.available.recognition = true; f.available.voice = false; await f.controller.start();
  assert.equal(f.controller.reason, "voice-unavailable"); assert.equal(f.recognitions.length, 0);
});

test("interim and empty results never submit; each final is accepted only once", async () => {
  const f = fixture(); await f.controller.start({ consented: true }); const mic = f.recognitions[0];
  mic.result("Could you", false); mic.result("   "); assert.equal(f.sends.length, 0);
  const lateResult = mic.onresult; mic.result("Could you tell me more?");
  mic.result("Could you tell me more?"); const duplicate = [{ transcript: "Could you tell me more?" }]; duplicate.isFinal = true;
  lateResult({ results: [duplicate] });
  assert.equal(f.sends.length, 1); assert.equal(f.sends[0].text, "Could you tell me more?");
  assert.equal(mic.aborted, true); assert.equal(f.controller.state, "submitting");
  assert.equal(f.captions.some((c) => c.final && c.text === f.sends[0].text), true);
  f.controller.stop();
});

test("microphone stays off during pending turn and until audio completion", async () => {
  const f = fixture(); await f.controller.start({ consented: true }); f.recognitions[0].result("Hello");
  await flush(); assert.equal(f.recognitions.length, 1); assert.equal(f.plays.length, 0);
  f.sends[0].wait.resolve({ id: "e2" }); await flush();
  assert.equal(f.controller.state, "speaking"); assert.equal(f.recognitions.length, 1);
  f.plays[0].wait.resolve(); await flush();
  assert.equal(f.controller.state, "listening"); assert.equal(f.recognitions.length, 2);
  f.controller.stop();
});

test("opening reply finishes before listening begins", async () => {
  const f = fixture(); const start = f.controller.start({ consented: true, openingReply: { id: "e0" } });
  assert.equal(f.recognitions.length, 0); assert.equal(f.controller.state, "speaking");
  f.plays[0].wait.resolve(); await start;
  assert.equal(f.recognitions.length, 1); assert.equal(f.controller.state, "listening"); f.controller.stop();
});

for (const error of ["not-allowed", "service-not-allowed", "network", "audio-capture", "no-speech", "aborted", "unknown"]) {
  test(`recognition ${error} stops without restarting or leaking service errors`, async () => {
    const f = fixture(); await f.controller.start({ consented: true }); f.recognitions[0].error(error); await flush();
    assert.equal(f.controller.enabled, false); assert.equal(f.recognitions.length, 1); assert.equal(f.sends.length, 0);
    assert.equal(f.controller.state, "error");
  });
}

test("recognition end after silence stops; resume is an explicit new action", async () => {
  const f = fixture(); await f.controller.start({ consented: true }); f.recognitions[0].onend(); await flush();
  assert.equal(f.controller.enabled, false); assert.equal(f.recognitions.length, 1);
  await f.controller.start(); assert.equal(f.recognitions.length, 2); f.controller.stop();
});

for (const method of ["stop", "pageHidden", "sessionEnded"]) {
  test(`${method} cancels pending request; a late reply cannot play or reopen the mic`, async () => {
    const f = fixture(); await f.controller.start({ consented: true }); f.recognitions[0].result("Hello");
    f.controller[method](); assert.equal(f.sends[0].options.signal.aborted, true);
    f.sends[0].wait.resolve({ id: "late" }); await flush();
    assert.equal(f.plays.length, 0); assert.equal(f.recognitions.length, 1); assert.equal(f.controller.enabled, false);
  });
}

test("pause cancels playback and ignores delayed completion", async () => {
  const f = fixture(); const start = f.controller.start({ consented: true, openingReply: { id: "e0" } });
  f.controller.stop(); assert.equal(f.plays[0].options.signal.aborted, true); assert.ok(f.stoppedAudio());
  f.plays[0].wait.resolve(); await start; assert.equal(f.recognitions.length, 0);
});

test("session expiry after request finishes prevents audio and listening", async () => {
  const f = fixture(); await f.controller.start({ consented: true }); f.recognitions[0].result("Hello");
  f.available.sessionActive = false; f.sends[0].wait.resolve({ id: "e2" }); await flush();
  assert.equal(f.plays.length, 0); assert.equal(f.controller.reason, "session-ended");
});

test("network and audio failures stop; provider exception text never reaches state", async () => {
  for (const phase of ["turn", "audio"]) {
    const f = fixture(); await f.controller.start({ consented: true }); f.recognitions[0].result("Hello");
    if (phase === "turn") f.sends[0].wait.reject(new Error("private-provider-detail"));
    else { f.sends[0].wait.resolve({ id: "e2" }); await flush(); f.plays[0].wait.reject(new Error("private-provider-detail")); }
    await flush(); assert.equal(f.controller.enabled, false); assert.equal(f.recognitions.length, 1);
    assert.equal(JSON.stringify(f.states).includes("private-provider-detail"), false);
  }
});

test("busy session and overlong phrase do not make another request", async () => {
  const f = fixture(); f.available.busy = true; await f.controller.start({ consented: true });
  assert.equal(f.controller.reason, "turn-pending"); assert.equal(f.recognitions.length, 0);
  f.available.busy = false; await f.controller.start(); f.recognitions[0].result("a".repeat(2001));
  assert.equal(f.sends.length, 0); assert.equal(f.controller.reason, "phrase-too-long");
});
