"use strict";
// Profile interactions without a microphone, account, or provider request.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(`${__dirname}/app.js`, "utf8").split('$("practice-nav").addEventListener')[0];

class Node {
  constructor(tag = "div") { this.tagName = tag; this.children = []; this.attributes = {}; this.listeners = {}; this.style = { setProperty() {} }; this.dataset = {}; this.open = true; this.value = ""; }
  get childNodes() { return this.children; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key]; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  addEventListener(name, handler) { this.listeners[name] = handler; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  focus() { this.focused = true; }
  cloneNode() { const clone = new Node(this.tagName); clone.attributes = { ...this.attributes }; return clone; }
}
const profiles = [
  { id: "alex", name: "Alex", style: "Guarded", presentation_key: "alex", description: "Values patience.", voice_label: "George · ElevenLabs stock voice", default_emotion: "worried" },
  { id: "maya", name: "Maya", style: "Thoughtful", presentation_key: "maya", description: "Enjoys sketching.", voice_label: "Jessica · ElevenLabs stock voice", default_emotion: "worried" },
  { id: "jordan", name: "Jordan", style: "Direct", presentation_key: "jordan", description: "Enjoys cycling.", voice_label: "River · ElevenLabs stock voice", default_emotion: "curious" },
  { id: "evelyn", name: "Evelyn", style: "Reflective", presentation_key: "evelyn", description: "Enjoys gardening.", voice_label: "Matilda · ElevenLabs stock voice", default_emotion: "calm" },
];
function fixture() {
  const nodes = new Map();
  const document = {
    getElementById(id) { if (!nodes.has(id)) nodes.set(id, new Node()); return nodes.get(id); },
    createElement: (tag) => new Node(tag), createElementNS: (_, tag) => new Node(tag),
    querySelectorAll() { return (nodes.get("demo-profile-choices")?.children || []).map((label) => label.children[0]); },
  };
  const context = vm.createContext({ document, URL, AbortController, setTimeout, clearTimeout, setInterval: () => 1, clearInterval() {}, location: { pathname: "/web/", href: "https://example.test/web/" }, window: { webkitSpeechRecognition: class {} } });
  vm.runInContext(`${source}\nthis.appState = app; this.portrait = createConversationPortrait; this.selectProfile = selectDemoProfile; this.renderProfiles = renderDemoProfiles; this.startConversation = startDemo;`, context);
  context.appState.demoProfiles = structuredClone(profiles);
  return { context, nodes, document };
}

test("selectable cards and radios use the same server profile and update voice delivery", () => {
  const { context, nodes } = fixture(); context.renderProfiles();
  assert.equal(nodes.get("demo-profile-library").children.length, 4);
  assert.equal(nodes.get("demo-profile-choices").children.length, 4);
  const jordan = nodes.get("demo-profile-choices").children[2].children[0]; jordan.listeners.change();
  assert.equal(context.appState.selectedDemoProfile, "jordan");
  assert.equal(jordan.checked, true);
  assert.equal(nodes.get("demo-emotion").value, "curious");
  assert.equal(nodes.get("demo-profile-name").textContent, "A conversation with Jordan");
  assert.match(nodes.get("demo-profile-voice").textContent, /River/);
  context.selectProfile("evelyn"); assert.equal(nodes.get("demo-emotion").value, "calm");
});

test("portraits have distinct appearances and use only local allowlisted SVG shapes", () => {
  const { context } = fixture();
  const shapes = profiles.map((profile) => context.portrait(profile.presentation_key, profile.name));
  const signatures = shapes.map((svg) => JSON.stringify(svg.children.map((node) => node.attributes)));
  assert.equal(new Set(signatures).size, 4);
  assert.equal(shapes[3].children.filter((node) => node.tagName === "rect").length, 2, "Evelyn has glasses");
  const hostile = context.portrait('<script>alert(1)</script>', '<img onerror="alert(1)">');
  assert.equal(hostile.getAttribute("aria-label"), 'Original illustrated conversation partner: <img onerror="alert(1)">');
  assert.deepEqual(hostile.children.map((node) => node.attributes), shapes[0].children.map((node) => node.attributes));
  assert.equal(shapes.every((svg) => svg.children.some((node) => node.attributes.class === "avatar-mouth")), true);
});

test("a missing conversation asset shows a recoverable error before creating a session", async () => {
  const { context, nodes } = fixture(); context.renderProfiles();
  let requests = 0; context.recordRequest = () => { requests++; };
  vm.runInContext('api = async () => { recordRequest(); throw new Error("unexpected API request"); };', context);
  await context.startConversation(false);
  assert.equal(requests, 0);
  assert.match(nodes.get("demo-error").textContent, /controls did not finish loading.*Reload/);
  assert.equal(context.appState.demoStarting, null);
});

test("typing starts the selected profile with its requested delivery and no microphone start", async () => {
  const { context, nodes } = fixture(); context.renderProfiles(); context.selectProfile("maya");
  const requests = []; context.recordRequest = (path, options) => requests.push({ path, body: options.body });
  context.LiveSpeechConversation = class {};
  context.appState.status = { tts_available: true };
  vm.runInContext(`
    api = async (path, options) => { recordRequest(path, options); return { token: "scoped-demo-token", state: { tts_available: true, mode: "conversation_demo" } }; };
    cleanupEncounter = () => {};
    updateEncounter = (state) => { app.encounter = state; };
    createLiveConversation = () => { app.conversation = { start() { throw new Error("Unexpected microphone start"); } }; };
    setView = () => {}; tickTimer = () => {}; renderLiveConversation = () => {};
  `, context);
  await context.startConversation(false);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].path, "/demo/encounters");
  assert.deepEqual(JSON.parse(JSON.stringify(requests[0].body)), { nonclinical_demo: true, profile_id: "maya", emotion: "worried" });
  assert.equal(nodes.get("demo-dialog").open, false);
  assert.equal(nodes.get("turn-text").focused, true);
});

test("unavailable profile metadata disables launch and leaves no fabricated profile", () => {
  const { context, nodes } = fixture(); context.appState.demoProfiles = []; context.renderProfiles();
  assert.equal(nodes.get("demo-open").disabled, true);
  assert.equal(context.appState.selectedDemoProfile, null);
  assert.equal(nodes.get("demo-profile-library").children.length, 0);
  assert.match(nodes.get("demo-profiles-message").textContent, /profiles are unavailable/);
});
