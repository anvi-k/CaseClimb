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

function fixture() {
  const nodes = new Map();
  const document = {
    getElementById(id) { if (!nodes.has(id)) nodes.set(id, new Node()); return nodes.get(id); },
    createElement: (tag) => new Node(tag), createElementNS: (_, tag) => new Node(tag),
  };
  const context = vm.createContext({ document, URL, AbortController, setTimeout, clearTimeout, setInterval: () => 1, clearInterval() {}, location: { pathname: "/web/", href: "https://example.test/web/" }, window: { webkitSpeechRecognition: class {} } });
  vm.runInContext(`${source}\nthis.appState = app; this.portrait = createConversationPortrait; this.newPatientCase = newCase; this.useTemplate = useCaseTemplate; this.startPatientEncounter = startEncounter;`, context);
  context.appState.facultyKey = "synthetic-faculty-key";
  return { context, nodes, document };
}

test("template chooser lists patient case starters without launching an encounter", async () => {
  const { context, nodes } = fixture();
  const requests = []; context.recordRequest = (path) => requests.push(path);
  vm.runInContext(`api = async (path) => { recordRequest(path); return { templates: [{ id: "communication-maya", name: "Communication · Maya", description: "Anxious and thoughtful", focus: "communication" }] }; };`, context);
  await context.newPatientCase();
  assert.deepEqual(requests, ["/faculty/templates"]);
  assert.equal(nodes.get("template-dialog").open, true);
  const card = nodes.get("case-templates").children[0];
  assert.equal(card.children[1].textContent, "Communication · Maya");
  assert.equal(context.appState.encounter, null);
});

test("using a communication starter loads an editable draft without publication", async () => {
  const { context, nodes, document } = fixture(); document.getElementById("template-dialog").open = true;
  context.recordDraft = (draft) => { context.loaded = draft; };
  vm.runInContext(`
    api = async (path) => { if (path !== "/faculty/templates/communication-maya") throw Error("Unexpected mutation"); return { draft: { title: "Getting to know Maya", learning_focus: "communication" } }; };
    setDraft = (draft) => { recordDraft(draft); app.draftDirty = false; };
    updateDraftHeading = renderFacultyCases = () => {};
  `, context);
  await context.useTemplate("communication-maya");
  assert.equal(context.loaded.title, "Getting to know Maya");
  assert.equal(context.appState.currentCase, null);
  assert.equal(context.appState.draftDirty, true);
  assert.equal(nodes.get("template-dialog").open, false);
});

test("declining replacement or a failed template fetch preserves the current draft", async () => {
  const { context, document } = fixture(); document.getElementById("template-dialog").open = true;
  context.appState.currentCase = { id: "saved-case" }; context.appState.draftDirty = true;
  let requests = 0; context.recordRequest = () => requests++;
  vm.runInContext(`confirmDraftDiscard = async () => false; api = async () => { recordRequest(); throw Error("Unavailable"); };`, context);
  await context.useTemplate("communication-maya"); assert.equal(requests, 0);
  vm.runInContext(`confirmDraftDiscard = async () => true;`, context);
  await context.useTemplate("communication-maya");
  assert.equal(requests, 1); assert.equal(context.appState.currentCase.id, "saved-case");
  assert.equal(context.appState.draftDirty, true);
});

test("all patient cases initialize spoken controls while starting with typing", async () => {
  const { context, nodes, document } = fixture();
  context.appState.selectedCase = { case_id: "reviewed-case", version: 2 };
  document.getElementById("student-code").value = "synthetic-code";
  const requests = []; context.recordRequest = (path, options) => requests.push({ path, body: options.body });
  context.LiveSpeechConversation = class {};
  vm.runInContext(`
    api = async (path, options) => { recordRequest(path, options); return { token: "scoped-token", state: { encounter_id: "patient-encounter", status: "active" } }; };
    cleanupEncounter = () => {}; updateEncounter = (state) => { app.encounter = state; };
    createLiveConversation = () => { app.conversation = { start() { throw Error("Unexpected microphone start"); } }; };
    setView = tickTimer = renderLiveConversation = () => {};
  `, context);
  await context.startPatientEncounter({ preventDefault() {} });
  assert.equal(requests[0].path, "/encounters");
  assert.deepEqual(JSON.parse(JSON.stringify(requests[0].body)), { case_id: "reviewed-case", version: 2, access_code: "synthetic-code" });
  assert.ok(context.appState.conversation); assert.equal(context.appState.audioEnabled, false);
  assert.equal(nodes.get("turn-text").focused, true);
});

test("patient portraits keep distinct appearances with allowlisted local SVG shapes", () => {
  const { context } = fixture();
  const shapes = ["alex", "maya", "jordan", "evelyn"].map((key) => context.portrait(key, key));
  assert.equal(new Set(shapes.map((svg) => JSON.stringify(svg.children.map((node) => node.attributes)))).size, 4);
  const hostile = context.portrait('<script>alert(1)</script>', '<img onerror="alert(1)">');
  assert.deepEqual(hostile.children.map((node) => node.attributes), shapes[0].children.map((node) => node.attributes));
});
