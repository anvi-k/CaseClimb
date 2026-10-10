"use strict";
// Exercise application lifecycle and the real speech controller with deferred
// local requests. These tests never open a microphone or contact a provider.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const appSource = fs.readFileSync(`${__dirname}/app.js`, "utf8").split('$("practice-nav").addEventListener')[0];
const speechSource = fs.readFileSync(`${__dirname}/conversation.js`, "utf8");
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

class Node {
  constructor() {
    this.children = []; this.dataset = {}; this.value = ""; this.open = false;
    this.style = { setProperty() {} }; this.classList = { add() {}, remove() {}, toggle() {} };
    this.closestNode = { hidden: false };
  }
  get childNodes() { return this.children; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  addEventListener() {}
  setAttribute() {}
  closest() { return this.closestNode; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  focus() { this.focused = true; }
  scrollIntoView() {}
}

function fixture() {
  const nodes = new Map(), recognitions = [], requests = [];
  const node = (id) => { if (!nodes.has(id)) nodes.set(id, new Node()); return nodes.get(id); };
  class Recognition {
    constructor() { recognitions.push(this); }
    start() { this.started = true; this.onstart?.(); }
    abort() { this.aborted = true; }
  }
  const context = vm.createContext({
    document: { getElementById: node, createElement: () => new Node() },
    location: { pathname: "/web/", href: "https://example.test/web/", hash: "", search: "" },
    window: { SpeechRecognition: Recognition }, URL, AbortController, Date,
    crypto: { randomUUID: () => "local-request-id" },
    setTimeout, clearTimeout, setInterval: () => 1, clearInterval() {},
  });
  vm.runInContext(`${speechSource}\n${appSource}
    this.appState = app;
    this.actions = { createLiveConversation, updateEncounter, finishEncounter,
      tickTimer, toggleLiveConversation, confirmVoiceConsent, requestVoiceConsent,
      submitEncounterTurn, startDictation, startPatientVideo, playPatientReply,
      renderLiveConversation, startEncounter };
    renderEncounterPortrait = renderTranscript = renderChart = renderFeedback = renderPresentationLabel = () => {};
    setView = () => {};
  `, context);
  let handler = () => { throw new Error("Unexpected local request"); };
  context.localRequest = (path, options) => { requests.push({ path, options }); return handler(path, options); };
  vm.runInContext("api = (path, options) => localRequest(path, options);", context);
  const profile = { id: "maya", name: "Maya", style: "Thoughtful", voice_label: "Jessica", default_emotion: "worried" };
  const state = {
    encounter_id: "local-demo", status: "active", server_time: Date.now() / 1000,
    deadline: Date.now() / 1000 + 600, mode: "clinical_practice", version: 1, learning_focus: "communication", title: "Getting to know Maya",
    patient: { name: "Maya", age: 28, setting: "Outpatient clinic", presentation_key: "maya" }, conversation_profile: profile,
    confirmed_turns: 0, max_turns: 60, tts_available: true, video_available: true,
    events: [{ id: "e0", actor: "patient", text: "Hello, I'm Maya." }], conversation_prompts: [],
  };
  context.appState.encounterToken = "local-scoped-token";
  context.appState.audioEnabled = true;
  context.actions.updateEncounter(state); context.actions.createLiveConversation();
  context.actions.renderLiveConversation(context.appState.conversation);
  const closed = () => ({ ...state, status: "concluded", server_time: Date.now() / 1000 });
  return { context, app: context.appState, actions: context.actions, node, recognitions, requests,
    state, closed, api: (next) => { handler = next; } };
}

function assertFrozen(f, ending) {
  for (const id of ["turn-text", "send-turn", "dictate", "live-toggle", "play-response", "enable-audio", "enable-video", "stop-audio"]) {
    assert.equal(f.node(id).disabled, true, `${id} must be unavailable`);
  }
  assert.equal(f.node("live-toggle").textContent, ending ? "Ending conversation…" : "Conversation ended");
}

test("finishing immediately freezes actions and an old consent confirmation cannot reopen speech", async () => {
  const f = fixture(), conclude = deferred();
  f.api(() => conclude.promise);
  await f.app.conversation.start({ consented: true });
  assert.equal(f.recognitions.length, 1);
  f.actions.requestVoiceConsent("conversation");
  const finishing = f.actions.finishEncounter();
  assertFrozen(f, true);
  assert.equal(f.recognitions[0].aborted, true);
  assert.equal(f.node("voice-dialog").open, false);
  assert.equal(f.app.voiceMode, null);
  assert.equal(f.node("finish-encounter").disabled, true);
  f.actions.toggleLiveConversation(); f.actions.confirmVoiceConsent(); f.actions.startDictation();
  await f.actions.startPatientVideo(); await f.actions.playPatientReply("e0");
  await f.app.conversation.start({ consented: true });
  await assert.rejects(f.actions.submitEncounterTurn("A late question"), /unavailable/);
  await f.actions.finishEncounter();
  assert.equal(f.recognitions.length, 1);
  assert.equal(f.requests.length, 1, "only one conclude request is allowed");
  conclude.resolve({ state: f.closed(), feedback: {} }); await finishing;
  assert.equal(f.app.finishOperation, null); assertFrozen(f, false);
  // A delayed speech callback or fallback cannot override the terminal message.
  f.app.encounter.tts_available = false;
  f.actions.renderLiveConversation({ state: "listening", reason: "paused", enabled: true });
  assertFrozen(f, false);
  assert.match(f.node("live-status").textContent, /conversation has ended.*transcript/);
});

test("a failed finish restores active controls but keeps speech paused until an explicit resume", async () => {
  const f = fixture(), conclude = deferred(); f.api(() => conclude.promise);
  await f.app.conversation.start({ consented: true });
  f.actions.requestVoiceConsent("conversation");
  const finishing = f.actions.finishEncounter();
  conclude.reject(new Error("The review could not load. Try again.")); await finishing;
  assert.equal(f.app.encounter.status, "active"); assert.equal(f.app.finishOperation, null);
  assert.equal(f.app.conversation.enabled, false); assert.equal(f.app.conversation.reason, "paused");
  assert.equal(f.recognitions.length, 1, "failed conclude must never restart a microphone");
  for (const id of ["turn-text", "send-turn", "live-toggle", "play-response", "enable-audio", "finish-encounter"]) assert.equal(f.node(id).disabled, false, id);
  assert.equal(f.node("live-toggle").textContent, "Resume listening");
  assert.match(f.node("encounter-message").textContent, /could not load/);
  f.actions.confirmVoiceConsent();
  assert.equal(f.recognitions.length, 1, "the cleared consent mode stays invalid after failure");
  f.actions.toggleLiveConversation(); await flush();
  assert.equal(f.recognitions.length, 2, "explicit resume may start the mocked recognition again");
  assert.equal(f.node("live-toggle").textContent, "Pause conversation");
  f.app.conversation.stop();
});

test("typing-first speech action says Start speaking until the user consents", () => {
  const f = fixture();
  assert.equal(f.node("live-toggle").textContent, "Start speaking");
  assert.match(f.node("live-status").textContent, /Start speaking/);
  f.actions.toggleLiveConversation();
  assert.equal(f.node("voice-dialog").open, true);
  assert.equal(f.node("voice-dialog-title").textContent, "Start spoken conversation");
  assert.equal(f.recognitions.length, 0);
});

test("a delayed active timer snapshot cannot resurrect a successfully concluded session", async () => {
  const f = fixture(), refresh = deferred(), conclude = deferred();
  f.app.encounter.deadline = Date.now() / 1000 - 1;
  f.api((path) => path.endsWith("/conclude") ? conclude.promise : refresh.promise);
  const refreshing = f.actions.tickTimer();
  assert.equal(f.requests[0].path, "/encounters/local-demo");
  const finishing = f.actions.finishEncounter();
  conclude.resolve({ state: f.closed(), feedback: {} }); await finishing;
  refresh.resolve({ ...f.state, status: "active", deadline: Date.now() / 1000 + 600, server_time: Date.now() / 1000 }); await refreshing;
  assert.equal(f.app.encounter.status, "concluded"); assertFrozen(f, false);
  // Also exercise the shared renderer's monotonic guard directly.
  f.actions.updateEncounter({ ...f.state, status: "active", deadline: Date.now() / 1000 + 600 });
  assert.equal(f.app.encounter.status, "concluded"); assertFrozen(f, false);
});

test("an aborted turn arriving during finish cannot reenable composer or play a reply", async () => {
  const f = fixture(), turn = deferred(), conclude = deferred();
  f.api((path) => path.endsWith("/turns") ? turn.promise : conclude.promise);
  const sending = f.actions.submitEncounterTurn("What do you enjoy?");
  const turnRequest = f.requests[0];
  const finishing = f.actions.finishEncounter();
  assert.equal(turnRequest.options.signal.aborted, true); assert.equal(f.app.turnOperation, null);
  turn.resolve({ state: { ...f.state, confirmed_turns: 1 }, patient_event: { id: "e1", text: "I sketch." } });
  assert.equal(await sending, null); assertFrozen(f, true);
  assert.equal(f.app.encounter.confirmed_turns, 0); assert.equal(f.requests.length, 2);
  conclude.resolve({ state: f.closed(), feedback: {} }); await finishing;
  assertFrozen(f, false);
});
