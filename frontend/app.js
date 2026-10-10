"use strict";

// Access keys and encounter tokens live only in this page's memory.
// No provider credential or patient reply text is accepted by the speech endpoint.
const $ = (id) => document.getElementById(id);
const apiRoot = `${location.pathname.split("/web")[0]}/api`;
const busyContent = new WeakMap();
const app = {
  status: null, library: [], selectedCase: null, facultyKey: "", cases: [],
  currentCase: null, draftDirty: false, validation: null, template: null,
  encounter: null, encounterToken: "", clockOffset: 0, timer: null,
  expiryRefreshing: false, feedback: null, sending: false, pendingTurn: null,
  audioEnabled: false, audio: null, audioUrl: null, audioController: null,
  audioGeneration: 0, voiceMode: null, dictationConsent: false, recognition: null,
  video: null, videoAttempted: false,
  conversation: null, audioPlayback: null, turnOperation: null,
  demoStarting: null, demoGeneration: 0,
};
const introVideoUrl = new URL("./media/caseclimb-introduction.mp4", location.href).href;

async function checkIntroVideo() {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(introVideoUrl, { method: "HEAD", credentials: "same-origin", cache: "no-store", signal: controller.signal });
    const available = response.ok && response.headers.get("content-type")?.startsWith("video/");
    $("intro-preview").hidden = !available; $("intro-preview-note").hidden = !available;
    $("intro-poster-frame").hidden = !available;
    if (available) $("intro-poster").src = introVideoUrl;
  } catch { $("intro-preview").hidden = true; $("intro-preview-note").hidden = true; $("intro-poster-frame").hidden = true; }
  finally { clearTimeout(timer); }
}

function stopIntroVideo() {
  const video = $("intro-video"); video.pause(); video.removeAttribute("src"); video.load();
}

function previewIntroVideo() {
  app.conversation?.stop();
  stopAudio(); stopDictation(); $("intro-video-status").textContent = "";
  $("intro-video-dialog").showModal(); const video = $("intro-video"); video.src = introVideoUrl;
  video.play().catch(() => { $("intro-video-status").textContent = "Choose Play in the video player to begin. The transcript is below the clip."; });
}

class RequestError extends Error {
  constructor(message, status = 0, kind = "") { super(message); this.status = status; this.kind = kind; }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}

function message(id, text, kind = "") {
  const node = $(id);
  node.replaceChildren();
  node.className = `message ${kind}`.trim();
  node.textContent = text;
  node.hidden = !text;
}

function confirmDraftDiscard(description) {
  const dialog = $("discard-dialog");
  if (dialog.open) return Promise.resolve(false);
  $("discard-description").textContent = description;
  dialog.returnValue = "keep";
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "discard"), { once: true });
    dialog.showModal();
    $("keep-draft").focus();
  });
}

function errorText(status) {
  return ({
    401: "Access was denied. Check the access key for this environment.",
    403: "The student access code was denied. Check the code supplied for this environment.",
    404: "This item is no longer available. Refresh the list and try again.",
    409: "This action is no longer available or the record changed. Reload it and review the current state.",
    413: "The prototype's storage allowance was reached. Conclude the encounter or create a new reusable case.",
    422: "Some fields are missing or invalid. Check the case definition or required form fields.",
    429: "The request limit was reached. Wait before trying again; an encounter also has a confirmed-turn limit.",
    502: "The voice service could not prepare audio. Continue with captions and text.",
    503: "This service or its access settings are not configured. Continue with available features or ask the facilitator.",
  })[status] || "The server could not complete the request. Try again when the connection is available.";
}

async function api(path, { method = "GET", body, token, binary = false, signal, timeout = 28000, keepalive = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  try {
    const headers = { Accept: binary ? "audio/mpeg" : "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`${apiRoot}${path}`, {
      method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal, cache: "no-store", credentials: "same-origin", keepalive,
    });
    if (!response.ok) {
      let kind = "";
      // Classify known server states without displaying arbitrary error bodies.
      if (response.status === 409 && path.endsWith("/turns")) {
        const payload = await response.json().catch(() => ({}));
        if (typeof payload.detail === "string") {
          if (payload.detail === "This request is still being processed." || payload.detail === "Another turn is still being processed.") kind = "pending";
          if (payload.detail === "This request was abandoned or expired. Retry explicitly with a new request_id if time remains." || payload.detail === "The pending turn ended or its lease expired. Late output was discarded." || payload.detail === "Could not confirm the pending turn. Retry explicitly with a new request_id.") kind = "new_request";
        }
      }
      const text = binary && response.status === 429 ? "The speech allowance is exhausted. Continue with captions and text." : binary && response.status === 409 ? "Audio is still being prepared or unavailable for this response. Continue with captions." : errorText(response.status);
      throw new RequestError(text, response.status, kind);
    }
    return binary ? await response.blob() : await response.json();
  } catch (error) {
    if (error instanceof RequestError) throw error;
    if (signal?.aborted) throw new RequestError("Audio stopped.");
    if (error.name === "AbortError") throw new RequestError("The request timed out. Your question remains in the editor; retry it when the connection is available.");
    throw new RequestError("The server is unreachable. Check the connection and try again.");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

function setView(view) {
  if (view !== "encounter") app.conversation?.stop();
  ["practice", "encounter", "studio"].forEach((name) => { $(`${name}-view`).hidden = name !== view; });
  $("practice-nav").classList.toggle("active", view !== "studio");
  $("studio-nav").classList.toggle("active", view === "studio");
  $("practice-nav").setAttribute("aria-current", view !== "studio" ? "page" : "false");
  $("studio-nav").setAttribute("aria-current", view === "studio" ? "page" : "false");
  window.scrollTo({ top: 0, behavior: "instant" });
}

function setBusy(button, busy, busyText) {
  if (busy) {
    if (!busyContent.has(button)) busyContent.set(button, Array.from(button.childNodes));
    button.textContent = busyText;
  } else if (busyContent.has(button)) {
    button.replaceChildren(...busyContent.get(button));
    busyContent.delete(button);
  }
  button.disabled = busy;
}

async function loadLibrary() {
  checkIntroVideo();
  message("library-message", "");
  const results = await Promise.allSettled([api("/library"), api("/status")]);
  if (results[1].status === "fulfilled") {
    app.status = results[1].value;
    $("app-lock-form").hidden = !app.status.app_access_required;
    $("service-status").textContent = app.status.tts_available ? "Connected · Voice configured" : "Connected · Text practice available";
  } else {
    $("service-status").textContent = "Connection unavailable";
  }
  if (results[0].status === "fulfilled") {
    app.library = results[0].value.cases || [];
    renderLibrary();
  } else {
    $("case-library").replaceChildren();
    message("library-message", results[0].reason.message, "error");
    const empty = el("div", "empty-state");
    empty.append(el("span", "empty-icon", "↻"), el("h3", "", "The library is temporarily unavailable"), el("p", "", "Refresh the cases when your connection is restored."));
    $("case-library").append(empty);
  }
}

function renderLibrary() {
  const library = $("case-library");
  library.replaceChildren();
  if (!app.library.length) {
    const empty = el("div", "empty-state");
    empty.append(el("span", "empty-icon", "✳"), el("h3", "", "Your first encounter starts with a reviewed case"), el("p", "", "No reviewer-attested cases are available yet. Faculty can create a synthetic draft in Patient Studio, check its structure, and review it before publishing."));
    const button = el("button", "button secondary", "Open Patient Studio");
    button.type = "button";
    button.addEventListener("click", openStudio);
    empty.append(button); library.append(empty); return;
  }
  app.library.forEach((item) => {
    const card = el("article", "case-card");
    const top = el("div", "case-card-top");
    const icon = el("span", "case-icon", "✳"); icon.setAttribute("aria-hidden", "true");
    top.append(icon, el("span", "pill", `Version ${item.version}`));
    card.append(top, el("h3", "", item.title), el("p", "case-patient", `${item.patient_name} · ${item.age} years · ${item.setting}`), el("p", "case-summary", item.summary));
    const footer = el("div", "case-card-footer");
    footer.append(el("small", "", "10 min · Reviewer attested"));
    const button = el("button", "button small primary", "Begin practice ↗"); button.type = "button";
    button.disabled = app.status?.student_access_configured === false;
    if (button.disabled) button.title = "Student access is not configured in this environment.";
    button.addEventListener("click", () => {
      app.selectedCase = item;
      $("start-case-title").textContent = item.title;
      $("start-case-summary").textContent = item.summary;
      $("student-code").value = "";
      message("start-error", ""); $("start-dialog").showModal();
    });
    footer.append(button); card.append(footer); library.append(card);
  });
  if (app.status?.student_access_configured === false) message("library-message", "Cases are available, but student access has not been configured in this environment.", "warning");
}

async function startEncounter(event) {
  event.preventDefault();
  if (!app.selectedCase) return;
  const button = $("start-button"); setBusy(button, true, "Opening encounter…"); message("start-error", "");
  try {
    const result = await api("/encounters", { method: "POST", body: { case_id: app.selectedCase.case_id, version: app.selectedCase.version, access_code: $("student-code").value } });
    cleanupEncounter();
    app.encounterToken = result.token;
    app.feedback = null; app.pendingTurn = null; app.audioEnabled = false; app.dictationConsent = false;
    app.video?.stop(); app.video = null; app.videoAttempted = false;
    $("turn-text").value = ""; $("feedback-panel").hidden = true;
    message("encounter-message", "");
    updateEncounter(result.state);
    $("student-code").value = ""; $("start-dialog").close(); setView("encounter");
    app.timer = setInterval(tickTimer, 1000); tickTimer(); $("turn-text").focus();
  } catch (error) { message("start-error", error.message, "error"); }
  finally { setBusy(button, false); }
}

function isConversationDemo() { return app.encounter?.mode === "conversation_demo"; }

function openDemo() {
  message("demo-error", "");
  const supported = speechSupported(), voice = !!app.status?.tts_available;
  $("demo-speak").disabled = !supported || !voice;
  $("demo-availability").textContent = !supported ? "Speech recognition is unavailable in this browser. Open this app in Chrome for spoken turns, or start with typing." : !voice ? "Voice is unavailable in this environment. Start with typing and visible replies." : "The microphone listens between replies. Chrome supports browser speech recognition; you can stop at any time.";
  $("demo-dialog").showModal();
}

async function startDemo(spoken) {
  if (app.demoStarting) return;
  const controller = new AbortController(); app.demoStarting = controller;
  const generation = ++app.demoGeneration;
  setBusy($("demo-speak"), true, "Opening conversation…"); setBusy($("demo-type"), true, "Opening conversation…");
  message("demo-error", "");
  try {
    const result = await api("/demo/encounters", { method: "POST", body: { nonclinical_demo: true, emotion: $("demo-emotion").value }, signal: controller.signal });
    if (controller.signal.aborted || generation !== app.demoGeneration || !$("demo-dialog").open) return;
    cleanupEncounter(); app.encounterToken = result.token; app.audioEnabled = !!result.state.tts_available;
    $("turn-text").value = ""; $("feedback-panel").hidden = true; message("encounter-message", "");
    updateEncounter(result.state); createLiveConversation();
    app.demoStarting = null; $("demo-dialog").close(); setView("encounter");
    app.timer = setInterval(tickTimer, 1000); tickTimer();
    if (spoken) await app.conversation.start({ consented: true, openingReply: latestPatient() });
    else { renderLiveConversation({ state: "off", reason: "typed-start", enabled: false }); $("turn-text").focus(); }
  } catch (error) { if (!controller.signal.aborted && generation === app.demoGeneration) message("demo-error", error.message, "error"); }
  finally {
    if (app.demoStarting === controller) app.demoStarting = null;
    setBusy($("demo-speak"), false); setBusy($("demo-type"), false);
    $("demo-speak").disabled = !speechSupported() || !app.status?.tts_available;
  }
}

function createLiveConversation() {
  app.conversation = new LiveSpeechConversation({
    createRecognition: () => new (window.SpeechRecognition || window.webkitSpeechRecognition)(),
    availability: () => ({ sessionActive: app.encounter?.status === "active" && remainingSeconds() > 0 && app.encounter.confirmed_turns < app.encounter.max_turns,
      recognition: speechSupported(), voice: !!app.encounter?.tts_available && app.audioEnabled, busy: app.sending || !!app.encounter?.pending_turn }),
    sendFinal: (text, { requestId, signal }) => submitEncounterTurn(text, { requestId, signal, live: true }),
    speakReply: (reply, { signal }) => playPatientAudio(reply.id, { signal, strict: true }),
    stopPlayback: stopAudio, onState: renderLiveConversation,
    onTranscript: ({ text, final }) => {
      $("live-caption").textContent = text ? `${final ? "You said" : "Listening"}: ${text}` : "";
      $("live-caption").hidden = !text;
      if (final) $("turn-text").value = text;
    },
  });
}

function renderLiveConversation({ state, reason, enabled }) {
  const labels = { off: "Listening paused", stopped: "Listening paused", starting: "Starting microphone", listening: "Listening to you", submitting: "Preparing reply", speaking: "Character speaking", error: "Listening stopped", unavailable: "Typing available" };
  const reasons = {
    "typed-start": "Type a message below. Choose Resume listening when you want spoken turns.",
    "recognition-unavailable": "Speech recognition is unavailable here. Open this app in Chrome for spoken turns, or continue typing.",
    "voice-unavailable": "Voice is unavailable. Continue with typing and visible replies.",
    "microphone-denied": "Microphone access was denied. Adjust your browser permission, then choose Resume listening; or type a message.",
    "microphone-unavailable": "No microphone was available. Check your input device or continue typing.",
    "recognition-network": "The speech recognition connection stopped. Choose Resume listening when ready, or continue typing.",
    "no-speech": "No final phrase was heard. Choose Resume listening to try again, or type a message.",
    "turn-error": "The turn could not complete. Review the message below and retry it explicitly; listening stays paused.",
    "playback-error": "Voice could not finish. Read the visible reply; choose Resume listening when ready.",
    "turn-pending": "A turn is still processing. Wait for its result before resuming listening.",
    "session-ended": "The conversation has ended. Your transcript is available below.",
    "phrase-too-long": "That phrase was too long. Shorten it in the editor and send it explicitly.",
    "paused": "Listening is paused. Type a message or choose Resume listening.",
  };
  $("live-state").textContent = labels[state] || "Listening paused";
  $("live-state").dataset.state = state;
  const fallback = !speechSupported() ? reasons["recognition-unavailable"] : !app.encounter?.tts_available || !app.audioEnabled ? reasons["voice-unavailable"] : "";
  $("live-status").textContent = fallback || reasons[reason] || ({ starting: "Waiting for the microphone. Your browser may ask for permission.", listening: "Speak, then pause. Your final phrase sends automatically; captions stay visible.", submitting: "Microphone paused while the server prepares a reply.", speaking: "Microphone paused while the character speaks. Listening resumes when audio ends." })[state] || "Listening is paused. Type a message or choose Resume listening.";
  $("live-toggle").textContent = enabled ? "Pause conversation" : "Resume listening";
  $("live-toggle").disabled = app.encounter?.status !== "active" || remainingSeconds() <= 0 || !speechSupported() || !app.encounter?.tts_available || app.sending || !!app.encounter?.pending_turn;
  // Pause remains available while a request/audio operation is in progress.
  if (enabled) $("live-toggle").disabled = false;
}

function updateEncounter(state) {
  if (state !== app.encounter) app.clockOffset = state.server_time * 1000 - Date.now();
  app.encounter = state;
  const demo = isConversationDemo();
  $("encounter-view").classList.toggle("conversation-demo", demo);
  $("encounter-heading").textContent = state.title;
  $("encounter-context").textContent = demo ? "Live conversation · Nonclinical demo" : `Student encounter · Version ${state.version}`;
  $("patient-name").textContent = state.patient.name;
  $("patient-detail").textContent = demo ? "Synthetic character · ElevenLabs voice when available" : `${state.patient.age} years · ${state.patient.setting}`;
  $("patient-mood").hidden = demo; $("dictate").hidden = demo;
  $("live-conversation-controls").hidden = !demo;
  $("conversation-guide").hidden = !demo; $("chart-heading").closest(".chart-panel").hidden = demo;
  $("turn-label").textContent = demo ? "Or type your next message" : "Your next question";
  $("caption-label").textContent = demo ? "Latest character reply" : "Latest patient reply";
  if (!app.sending) $("send-turn").textContent = demo ? "Send message ↗" : "Send question ↗";
  $("composer-note").textContent = demo ? "Typing pauses spoken turn-taking. Ctrl/⌘ + Enter sends your message." : "Review dictated words before sending. Ctrl/⌘ + Enter sends your question.";
  if (demo) {
    $("demo-notice").textContent = state.assessment_notice || state.notice || "Original nonclinical conversation demo. No medical advice or clinical assessment.";
    const prompts = $("conversation-prompts"); prompts.replaceChildren();
    (state.conversation_prompts || []).forEach((text) => {
      const button = el("button", "conversation-prompt", text); button.type = "button";
      button.addEventListener("click", () => { app.conversation?.stop(); $("turn-text").value = text; $("turn-text").focus(); }); prompts.append(button);
    });
  }
  const mood = state.simulated_mood?.mood || "guarded";
  $("patient-mood").textContent = mood.charAt(0).toUpperCase() + mood.slice(1);
  const rapport = state.simulated_mood?.rapport ?? 0;
  $("rapport-value").textContent = `${rapport} / 100`;
  $("rapport-meter").value = rapport;
  $("turn-count").textContent = `${state.confirmed_turns} / ${state.max_turns} confirmed turns`;
  const latest = latestPatient();
  $("patient-caption").textContent = latest?.text || "";
  renderTranscript(); renderChart(); renderVoiceControls(); renderVideoControls();
  const active = state.status === "active" && remainingSeconds() > 0;
  $("encounter-view").classList.toggle("ended", !active); $("encounter-ended").hidden = active;
  const canSend = active && state.confirmed_turns < state.max_turns;
  $("turn-text").disabled = !canSend || app.sending;
  $("send-turn").disabled = !canSend || app.sending;
  $("dictate").disabled = !canSend || app.sending || !speechSupported();
  if (!speechSupported()) $("dictate").title = "Dictation is unavailable in this browser. Type your question instead.";
  $("finish-encounter").textContent = active ? (demo ? "End conversation" : "Finish & review") : (demo ? "View transcript" : "Load review");
  if (demo && app.conversation) renderLiveConversation(app.conversation);
  if (state.video?.deadline && app.video) app.video.limitDeadline(state.video.deadline);
  if (!active) { app.conversation?.sessionEnded(); stopAudio(); stopDictation(); app.video?.stop(); }
}

function latestPatient() { return app.encounter?.events.filter((event) => event.actor === "patient").at(-1); }
function remainingSeconds() {
  if (!app.encounter) return 0;
  return Math.max(0, Math.ceil((app.encounter.deadline * 1000 - (Date.now() + app.clockOffset)) / 1000));
}

async function tickTimer() {
  if (!app.encounter) return;
  const encounterId = app.encounter.encounter_id, token = app.encounterToken;
  const seconds = app.encounter.status === "active" ? remainingSeconds() : 0;
  $("encounter-timer").textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  $("timer-box").classList.toggle("urgent", seconds <= 60);
  if (seconds || app.encounter.status !== "active" || app.expiryRefreshing) return;
  clearInterval(app.timer); app.timer = null;
  app.expiryRefreshing = true; app.conversation?.sessionEnded(); stopAudio(); stopDictation(); app.video?.stop();
  $("send-turn").disabled = true; $("turn-text").disabled = true; $("dictate").disabled = true;
  try {
    const state = await api(`/encounters/${encounterId}`, { token });
    if (app.encounter?.encounter_id !== encounterId || app.encounterToken !== token) return;
    updateEncounter(state);
    if (state.status !== "active") {
      message("encounter-message", isConversationDemo() ? "Your ten-minute conversation has ended. Your transcript remains available." : "Your ten-minute encounter has ended. Review the evidence and plan your next conversation.");
      await loadFeedback();
    } else if (remainingSeconds() > 0) {
      app.timer = setInterval(tickTimer, 1000);
    }
  } catch (error) {
    if (app.encounter?.encounter_id !== encounterId || app.encounterToken !== token) return;
    message("encounter-message", "Time has ended. Reconnect, then choose Load review to recover the encounter feedback.", "warning");
    $("finish-encounter").textContent = "Load review";
  } finally { if (app.encounter?.encounter_id === encounterId && app.encounterToken === token) app.expiryRefreshing = false; }
}

function renderTranscript() {
  const container = $("transcript");
  const oldCount = container.childElementCount;
  container.replaceChildren();
  (app.encounter.events || []).forEach((event) => {
    const row = el("div", `transcript-event ${event.actor}`); row.id = `event-${event.id}`;
    const meta = el("div", "event-meta");
    const minutes = Math.max(0, Math.floor((event.timestamp - app.encounter.started_at) / 60));
    const seconds = Math.max(0, Math.floor(event.timestamp - app.encounter.started_at) % 60);
    meta.append(el("strong", "", event.actor === "patient" ? app.encounter.patient.name : "You"), el("span", "", `${minutes}:${String(seconds).padStart(2, "0")}`));
    row.append(meta, el("p", "", event.text)); container.append(row);
  });
  if (container.childElementCount > oldCount) container.scrollTop = container.scrollHeight;
}

function renderChart() {
  const target = $("chart-content"); target.replaceChildren();
  const chart = app.encounter.chart || {};
  const facts = chart.facts || []; const artifacts = chart.artifacts || [];
  if (!facts.length && !artifacts.length) {
    const empty = el("div", "chart-empty");
    empty.append(el("span", "", "▤"), el("p", "", "No chart information has been disclosed yet. Explore the patient's concerns to learn more."));
    target.append(empty); return;
  }
  facts.forEach((fact) => {
    const item = el("article", "chart-item"); const heading = el("div", "chart-item-heading");
    heading.append(el("h3", "", fact.label), el("span", "pill", ({ known: "Recorded", known_negative: "Known negative", unknown: "Not established" })[fact.state] || "Recorded"));
    item.append(heading, el("p", "", fact.text)); target.append(item);
  });
  artifacts.forEach((artifact) => {
    const item = el("article", "chart-item"); const heading = el("div", "chart-item-heading");
    heading.append(el("h3", "", artifact.title), el("span", "pill", artifact.kind.replaceAll("_", " ")));
    item.append(heading, el("p", "", artifact.body));
    if (Object.keys(artifact.metadata || {}).length) {
      const meta = el("div", "chart-metadata");
      Object.entries(artifact.metadata).forEach(([name, value]) => meta.append(el("span", "", `${name}: ${value}`)));
      item.append(meta);
    }
    target.append(item);
  });
}

async function sendTurn(event) {
  event.preventDefault();
  if (app.sending || !app.encounter || app.encounter.status !== "active" || remainingSeconds() <= 0) return;
  const text = $("turn-text").value.trim(); if (!text) return;
  app.conversation?.stop();
  try { await submitEncounterTurn(text); } catch { /* Static error and recoverable editor are shown by the shared submitter. */ }
}

async function submitEncounterTurn(text, { requestId, signal, live = false } = {}) {
  if (app.sending || !app.encounter || app.encounter.status !== "active" || remainingSeconds() <= 0) throw new RequestError("This turn is unavailable.");
  const encounterId = app.encounter.encounter_id, token = app.encounterToken;
  const operation = new AbortController(); app.turnOperation = operation;
  const onAbort = () => operation.abort(); signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) operation.abort();
  const current = () => app.encounter?.encounter_id === encounterId && app.encounterToken === token && app.turnOperation === operation;
  stopDictation(); stopAudio(); app.video?.interrupt(); app.sending = true;
  if (!app.pendingTurn || app.pendingTurn.text !== text) app.pendingTurn = { request_id: requestId || crypto.randomUUID(), text, confirmed: true };
  setBusy($("send-turn"), true, "Patient is responding…"); $("turn-text").disabled = true; $("dictate").disabled = true;
  message("encounter-message", "");
  try {
    const result = await api(`/encounters/${encounterId}/turns`, { method: "POST", token, body: app.pendingTurn, signal: operation.signal });
    if (!current() || operation.signal.aborted || app.encounter.status !== "active" || remainingSeconds() <= 0) return null;
    app.pendingTurn = null; $("turn-text").value = "";
    updateEncounter(result.state);
    if (result.patient_event && app.encounter.status === "active") {
      if (app.video?.active) app.video.speak(result.patient_event.id);
      else if (app.audioEnabled && !live) playPatientAudio(result.patient_event.id);
    }
    return result.patient_event || null;
  } catch (error) {
    if (!current() || operation.signal.aborted) throw error;
    if (error.kind === "pending") message("encounter-message", "A question is still being processed. Wait briefly, then retry the same question; a confirmed replay will not count twice.", "warning");
    else if (error.kind === "new_request") {
      app.pendingTurn = null;
      message("encounter-message", "This question did not complete. Review it, then press Send question to explicitly retry while time remains.", "warning");
    } else message("encounter-message", error.message, "error");
    if (error.status === 409 || error.status === 429) {
      try { const state = await api(`/encounters/${encounterId}`, { token }); if (current() && !operation.signal.aborted) updateEncounter(state); } catch { /* Keep the recoverable editor state. */ }
    }
    throw error;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    if (current()) {
      app.turnOperation = null; app.sending = false; setBusy($("send-turn"), false);
      updateEncounter(app.encounter);
      if (!live && !$("turn-text").disabled) $("turn-text").focus();
    }
  }
}

async function finishEncounter() {
  if (!app.encounter) return;
  const encounterId = app.encounter.encounter_id, token = app.encounterToken;
  const current = () => app.encounter?.encounter_id === encounterId && app.encounterToken === token;
  app.conversation?.sessionEnded(); app.turnOperation?.abort(); stopAudio(); stopDictation(); app.video?.stop();
  const button = $("finish-encounter"); setBusy(button, true, "Preparing review…");
  message("encounter-message", "");
  try {
    const result = await api(`/encounters/${encounterId}/conclude`, { method: "POST", token });
    if (!current()) return;
    updateEncounter(result.state); app.feedback = result.feedback; renderFeedback();
    clearInterval(app.timer); app.timer = null; tickTimer();
    $("feedback-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) { if (current()) message("encounter-message", error.message, "error"); }
  finally {
    if (!current()) return;
    setBusy(button, false);
    updateEncounter(app.encounter);
  }
}

async function loadFeedback() {
  const encounterId = app.encounter.encounter_id, token = app.encounterToken;
  const feedback = await api(`/encounters/${encounterId}/feedback`, { token });
  if (app.encounter?.encounter_id !== encounterId || app.encounterToken !== token) return;
  app.feedback = feedback;
  clearInterval(app.timer); app.timer = null; renderFeedback();
  $("feedback-panel").scrollIntoView({ behavior: "smooth", block: "start" });
}

function revealEvidence(event, eventId) {
  const row = $(`event-${eventId}`); if (!row) return;
  event.preventDefault(); history.replaceState(null, "", `#event-${encodeURIComponent(eventId)}`);
  row.tabIndex = -1; row.scrollIntoView({ behavior: "auto", block: "center" }); row.focus({ preventScroll: true });
}

function renderFeedback() {
  const feedback = app.feedback; if (!feedback) return;
  const target = $("feedback-content"); target.replaceChildren();
  const demo = feedback.mode === "conversation_demo";
  $("feedback-heading").textContent = demo ? "Your conversation, in your words." : "What to take into the next conversation";
  $("feedback-heading").previousElementSibling.textContent = demo ? "A transcript to return to" : "Reflection, grounded in this encounter";
  $("feedback-panel").querySelector(".notice").textContent = demo ? feedback.notice : "Formative feedback uses authored criteria and disclosed evidence. It requires faculty review and does not establish clinical competence.";
  if (demo) {
    target.append(el("p", "small-note", feedback.transcript_notice || "The full conversation remains above. No clinical or empathy assessment is produced."));
    (feedback.transcript || []).forEach((event) => {
      const row = el("article", "transcript-event"); row.append(el("strong", "", event.actor === "patient" ? app.encounter.patient.name : "You"), el("p", "", `${event.text}${event.excerpt ? "…" : ""}`));
      const link = el("a", "evidence-link", "Find this turn in the full conversation ↗"); link.href = `#event-${encodeURIComponent(event.id)}`;
      link.addEventListener("click", (click) => revealEvidence(click, event.id)); row.append(link); target.append(row);
    });
    $("feedback-panel").hidden = false; $("feedback-heading").focus({ preventScroll: true }); return;
  }
  const summary = el("div", "feedback-next");
  summary.append(el("span", "eyebrow", "Try this in your next encounter"), el("p", "", feedback.next_attempt));
  target.append(summary);
  const debrief = feedback.critical_thinking_debrief;
  if (debrief) {
    const section = el("section", "critical-debrief");
    section.append(el("h3", "", "Where to think more deeply"));
    const modelSelected = debrief.provider === "bedrock_selection";
    section.append(el("p", "fine-print", modelSelected ? "A model prioritized these available opportunities. The wording and next questions are authored case guidance." : "Authored priorities are shown. Model prioritization was not used for this review."));
    const priorities = el("ol", "debrief-priorities");
    const focusLabels = { missed_follow_up: "Follow up on a disclosed cue", clarify_available_inconsistency: "Clarify information already available", acknowledge_emotion: "Acknowledge an expressed concern", summarize_next_step: "Make the next step clear" };
    (debrief.priorities || []).forEach((priority) => {
      const item = el("li", "debrief-priority");
      item.append(el("span", "eyebrow", focusLabels[priority.focus] || "Reflect on this opportunity"), el("h4", "", priority.label), el("p", "", priority.guidance));
      (priority.evidence || []).forEach((evidence) => {
        const quote = el("blockquote", "", `${evidence.text}${evidence.excerpt ? "…" : ""}`);
        const link = el("a", "evidence-link", "Review the recorded moment ↗"); link.href = `#event-${encodeURIComponent(evidence.event_id)}`;
        link.addEventListener("click", (event) => revealEvidence(event, evidence.event_id));
        quote.append(el("br"), link); item.append(quote);
      });
      item.append(el("p", "next-question", `A next question: ${priority.next_question}`)); priorities.append(item);
    });
    if (!priorities.children.length) section.append(el("p", "small-note", "No additional missed opportunities were assessable from the disclosed evidence."));
    else section.append(priorities);
    section.append(el("p", "fine-print", debrief.notice)); target.append(section);
  }
  const grid = el("div", "feedback-grid");
  (feedback.assessments || []).forEach((assessment) => {
    const card = el("article", "assessment-card");
    const labels = { observed: "✓ Observed", missed: "◐ Available opportunity missed", not_assessable: "– Not assessable" };
    card.append(el("span", `pill ${assessment.result}`, labels[assessment.result] || assessment.result), el("h3", "", assessment.label), el("p", "", assessment.explanation), el("p", "", assessment.guidance));
    (assessment.evidence || []).forEach((evidence) => {
      const quote = el("blockquote", "", evidence.text);
      const link = el("a", "evidence-link", "Review the recorded moment ↗"); link.href = `#event-${encodeURIComponent(evidence.event_id)}`;
      link.addEventListener("click", (event) => revealEvidence(event, evidence.event_id));
      quote.append(el("br"), link); card.append(quote);
    });
    if (assessment.result !== "observed") card.append(el("p", "", `A next question: ${assessment.next_question}`));
    grid.append(card);
  });
  target.append(grid);
  if (feedback.simulated_rapport) target.append(el("p", "notice rapport-notice", `Simulated rapport: ${feedback.simulated_rapport.initial} → ${feedback.simulated_rapport.final}. ${feedback.simulated_rapport.label}.`));
  $("feedback-panel").hidden = false;
  $("feedback-heading").focus({ preventScroll: true });
}

function renderVoiceControls() {
  const active = app.encounter?.status === "active" && remainingSeconds() > 0;
  const available = !!app.encounter?.tts_available;
  const videoActive = !!app.video?.active;
  const videoBusy = videoActive || !!app.video?.starting;
  $("enable-audio").closest(".voice-controls").hidden = !available && !videoBusy;
  $("enable-audio").textContent = app.audioEnabled ? "Disable patient voice" : "Enable patient voice";
  $("enable-audio").disabled = !available || !active || videoBusy;
  $("enable-audio").title = videoBusy ? "Turn off video to use audio-only playback." : "";
  $("play-response").disabled = !active || !(videoActive || (available && app.audioEnabled)) || !latestPatient();
  if (videoActive) $("stop-audio").disabled = !app.video.speaking;
  if (!available) $("audio-status").textContent = isConversationDemo() ? "Voice is unavailable here. Type a message and read the character's reply below." : app.encounter?.video_available ? "Patient voice plays through the video feed when enabled. Captions remain available." : "Voice and live video are unavailable here. Continue with the illustrated patient and captions.";
  else if (videoBusy) $("audio-status").textContent = "Patient voice plays through the video feed. Captions remain available.";
  else if (!app.audioEnabled) $("audio-status").textContent = "Captions are always available. Voice is optional.";
  renderPresentationLabel();
}

function renderPresentationLabel() {
  $("patient-scene").querySelector(".scene-label").textContent = app.video?.visual ? "Live rendered video · stored replies" : app.audioEnabled ? "Illustrated patient · voice on" : "Illustrated patient · captions";
}

function renderVideoControls() {
  const active = app.encounter?.status === "active" && remainingSeconds() > 0;
  const videoBusy = !!(app.video?.active || app.video?.starting);
  $("enable-video").closest(".video-controls").hidden = !app.encounter?.video_available && !videoBusy && !app.videoAttempted;
  $("enable-video").textContent = videoBusy ? "Turn off video" : "Enable video patient";
  $("enable-video").disabled = !active || (!videoBusy && (!app.encounter?.video_available || app.videoAttempted));
  $("allow-video-playback").hidden = !active || !app.video?.needsPlayback;
  $("video-stage").hidden = !app.video?.visual;
  $("patient-scene").classList.toggle("video-live", !!app.video?.visual);
  renderPresentationLabel();
  if (!videoBusy && !app.videoAttempted) $("video-status").textContent = app.encounter?.video_available ? "Video is optional. Enable it to receive a live synthetic patient feed." : "Live video is unavailable here. The illustrated patient and captions remain available.";
}

async function startPatientVideo() {
  if (!app.encounter?.video_available || app.videoAttempted || app.encounter.status !== "active" || remainingSeconds() <= 0) return;
  stopAudio(); app.audioEnabled = false;
  const encounterId = app.encounter.encounter_id; const token = app.encounterToken;
  const renderer = new PatientVideoRenderer({
    request: (suffix, options) => api(`/encounters/${encounterId}${suffix}`, { ...options, token }),
    secondsRemaining: remainingSeconds, serverNow: () => Date.now() + app.clockOffset,
    videoElement: $("patient-video"), audioContainer: $("video-audio"),
    onAttempt: () => { if (app.video === renderer) app.videoAttempted = true; },
    onStatus: (text) => { if (app.video === renderer) $("video-status").textContent = text; },
    onChange: () => { if (app.video === renderer) { renderVoiceControls(); renderVideoControls(); } },
  });
  app.video = renderer;
  await renderer.start();
  if (app.video === renderer && renderer.active && latestPatient()) renderer.speak(latestPatient().id);
}

function stopAudio() {
  app.audioGeneration += 1;
  app.audioPlayback?.reject(new RequestError("Audio stopped.")); app.audioPlayback = null;
  app.audioController?.abort(); app.audioController = null;
  if (app.audio) { app.audio.pause(); app.audio.removeAttribute("src"); app.audio.load(); app.audio = null; }
  if (app.audioUrl) { URL.revokeObjectURL(app.audioUrl); app.audioUrl = null; }
  $("patient-scene").classList.remove("speaking"); $("stop-audio").disabled = true;
}

async function playPatientAudio(eventId, { signal, strict = false } = {}) {
  if (!app.audioEnabled || !app.encounter?.tts_available || app.encounter.status !== "active" || remainingSeconds() <= 0) {
    if (strict) throw new RequestError("Patient voice is unavailable."); return;
  }
  stopAudio(); const generation = app.audioGeneration;
  const encounterId = app.encounter.encounter_id, token = app.encounterToken;
  const controller = new AbortController(); app.audioController = controller;
  const onAbort = () => { if (generation === app.audioGeneration) stopAudio(); };
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) { controller.abort(); signal?.removeEventListener("abort", onAbort); if (strict) throw new RequestError("Audio stopped."); return; }
  const current = () => generation === app.audioGeneration && app.encounter?.encounter_id === encounterId && app.encounterToken === token && !signal?.aborted;
  $("audio-status").textContent = "Preparing patient audio…"; $("stop-audio").disabled = false;
  try {
    const blob = await api(`/encounters/${encounterId}/tts`, { method: "POST", token, body: { event_id: eventId }, binary: true, signal: controller.signal, timeout: 30000 });
    if (!current() || !app.audioEnabled || app.encounter.status !== "active" || remainingSeconds() <= 0) { if (strict) throw new RequestError("Audio stopped."); return; }
    app.audioUrl = URL.createObjectURL(blob); app.audio = new Audio(app.audioUrl);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => fail(new RequestError("Audio playback timed out. Continue with captions.")), Math.min(90000, remainingSeconds() * 1000));
      let settled = false;
      const done = () => { if (!settled) { settled = true; clearTimeout(timeout); resolve(); } };
      const fail = (error) => { if (!settled) { settled = true; clearTimeout(timeout); reject(error); } };
      app.audioPlayback = { resolve: done, reject: fail };
      app.audio.addEventListener("play", () => {
        if (current()) { $("patient-scene").classList.add("speaking"); $("audio-status").textContent = "Patient voice is playing. You can stop audio at any time."; }
      });
      app.audio.addEventListener("ended", () => {
        if (current()) { app.audioPlayback = null; done(); stopAudio(); $("audio-status").textContent = "Patient audio finished. Captions remain available."; }
      }, { once: true });
      app.audio.addEventListener("error", () => { if (current()) fail(new RequestError("This browser could not play the audio. Continue with captions.")); }, { once: true });
      app.audio.play().catch(() => fail(new RequestError("Playback was blocked. Choose Replay response, or continue with captions.")));
    });
  } catch (error) {
    if (current() && !controller.signal.aborted) { stopAudio(); $("audio-status").textContent = error.message; }
    if (strict) throw error;
  } finally { signal?.removeEventListener("abort", onAbort); }
}

function speechSupported() { return !!(window.SpeechRecognition || window.webkitSpeechRecognition); }
function requestVoiceConsent(mode) {
  app.voiceMode = mode;
  if (mode === "audio") {
    $("voice-dialog-title").textContent = "Enable patient voice";
    $("voice-dialog-description").textContent = "Each patient reply can be sent to ElevenLabs for speech generation. Only the stored patient reply is spoken. You can stop playback or disable voice at any point.";
    $("voice-confirm").textContent = "Enable patient voice";
  } else if (mode === "video") {
    $("voice-dialog-title").textContent = "Enable the video patient";
    $("voice-dialog-description").textContent = "Stored patient replies are sent to ElevenLabs for speech, then the resulting audio is sent to LiveAvatar to render synchronized video. Your browser connects to the provider's LiveKit video room. This sends no webcam or microphone feed. Video ends with this encounter; captions remain available if it fails.";
    $("voice-confirm").textContent = "Enable video patient";
  } else if (mode === "conversation") {
    $("voice-dialog-title").textContent = "Resume spoken conversation";
    $("voice-dialog-description").textContent = "Your browser requests microphone access and may transmit microphone audio to its speech recognition service. Final recognized phrases automatically send to this nonclinical encounter. ElevenLabs generates the character's voice; the microphone pauses during each reply. Captions remain visible. No webcam is used.";
    $("voice-confirm").textContent = "Agree & start listening";
  } else {
    $("voice-dialog-title").textContent = "Dictate with your browser";
    $("voice-dialog-description").textContent = "Your browser will request microphone access and may send audio to its speech recognition service. Recognized words will appear in the question editor. Review them before choosing Send question. No webcam is used.";
    $("voice-confirm").textContent = "Start dictation";
  }
  $("voice-dialog").showModal();
}

function stopDictation() {
  if (app.recognition) { const recognition = app.recognition; app.recognition = null; recognition.abort(); }
  $("dictation-status").textContent = "";
  $("dictate").textContent = "Dictate a question";
}

function startDictation() {
  if (!speechSupported() || app.sending || app.encounter?.status !== "active" || remainingSeconds() <= 0) return;
  stopAudio(); stopDictation(); app.video?.interrupt();
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognition = new Recognition(); app.recognition = recognition;
  recognition.lang = "en-US"; recognition.continuous = false; recognition.interimResults = true;
  const existing = $("turn-text").value.trim();
  recognition.onstart = () => { $("dictation-status").textContent = "Listening. Your words are not sent as a question until you confirm them."; $("dictate").textContent = "Stop dictation"; };
  recognition.onresult = (event) => {
    if (app.recognition !== recognition) return;
    let final = ""; let interim = "";
    for (let index = 0; index < event.results.length; index += 1) {
      if (event.results[index].isFinal) final += event.results[index][0].transcript;
      else interim += event.results[index][0].transcript;
    }
    if (final) $("turn-text").value = `${existing}${existing ? " " : ""}${final}`.slice(0, 2000);
    $("dictation-status").textContent = interim ? `Listening: ${interim}` : "Dictation captured. Review the words, then send your question.";
  };
  recognition.onerror = (event) => {
    if (app.recognition !== recognition) return;
    $("dictation-status").textContent = event.error === "not-allowed" || event.error === "service-not-allowed" ? "Microphone or speech-service access was denied. Type your question instead." : "Dictation is unavailable right now. Type your question instead.";
  };
  recognition.onend = () => {
    if (app.recognition === recognition) { app.recognition = null; $("dictate").textContent = "Dictate a question"; if ($("dictation-status").textContent.startsWith("Listening")) $("dictation-status").textContent = "Dictation stopped. Review the question editor before sending."; }
  };
  try { recognition.start(); } catch { app.recognition = null; $("dictation-status").textContent = "This browser could not start dictation. Type your question instead."; }
}

function cleanupEncounter() {
  app.conversation?.stop(); app.conversation = null; app.turnOperation?.abort(); app.turnOperation = null; app.sending = false; setBusy($("send-turn"), false);
  clearInterval(app.timer); app.timer = null; stopAudio(); stopDictation();
  app.video?.stop(); app.video = null; app.videoAttempted = false;
  app.encounter = null; app.encounterToken = ""; app.feedback = null;
  app.expiryRefreshing = false;
  app.audioEnabled = false; app.dictationConsent = false; app.pendingTurn = null;
  if (location.hash.startsWith("#event-")) history.replaceState(null, "", location.pathname + location.search);
}

function openStudio() {
  setView("studio");
  if (!app.facultyKey) $("faculty-key").focus();
}

async function facultyLogin(event) {
  event.preventDefault();
  const button = event.submitter; setBusy(button, true, "Opening Studio…");
  message("faculty-message", ""); app.facultyKey = $("faculty-key").value; $("faculty-key").value = "";
  try {
    await loadFaculty(); $("faculty-login").hidden = true; $("faculty-workspace").hidden = false;
    if (app.cases.length) await loadCase(app.cases[0].id);
    else await newCase();
  } catch (error) {
    clearFaculty(); message("faculty-message", error.message, "error");
  } finally { setBusy(button, false); }
}

async function loadFaculty() {
  const results = await Promise.allSettled([api("/faculty/cases", { token: app.facultyKey }), api("/faculty/analytics", { token: app.facultyKey })]);
  if (results[0].status === "rejected") throw results[0].reason;
  app.cases = results[0].value.cases || []; renderFacultyCases();
  const analytics = $("analytics"); analytics.replaceChildren();
  if (results[1].status === "fulfilled") {
    const counts = results[1].value;
    [[counts.encounters, "Encounters"], [counts.confirmed_turns, "Confirmed turns"], [app.cases.length, "Authored cases"]].forEach(([count, label]) => {
      const item = el("div"); item.append(el("strong", "", count), el("span", "", label)); analytics.append(item);
    });
    analytics.title = "Operational counts only. They do not measure educational outcomes.";
  }
}

function renderFacultyCases() {
  const target = $("faculty-cases"); target.replaceChildren();
  if (!app.cases.length) { target.append(el("p", "small-note", "Create a synthetic draft to begin. It stays off the student library until reviewed.")); return; }
  app.cases.forEach((record) => {
    const button = el("button", "faculty-case-button"); button.type = "button";
    button.classList.toggle("active", app.currentCase?.id === record.id);
    button.append(el("strong", "", record.draft.title), el("small", "", record.draft_status === "published" ? `Reviewer attested · ${record.versions.length} version(s)` : "Unreviewed draft"));
    button.addEventListener("click", async () => {
      if (app.draftDirty && !await confirmDraftDiscard("Opening this case loads its saved content. Choose whether to keep editing or discard your unsaved changes.")) return;
      try { await loadCase(record.id); } catch (error) { message("faculty-message", error.message, "error"); }
    });
    target.append(button);
  });
}

async function loadCase(id) {
  const record = await api(`/faculty/cases/${encodeURIComponent(id)}`, { token: app.facultyKey });
  app.currentCase = record; setDraft(record.draft); renderFacultyCases();
}

async function getTemplate() {
  if (app.template) return structuredClone(app.template);
  const response = await fetch(new URL("./template.json", location.href), { cache: "no-store" });
  if (!response.ok) throw new RequestError("The authoring template is unavailable. Reload this page.");
  app.template = await response.json();
  return structuredClone(app.template);
}

async function newCase() {
  if (app.draftDirty && !await confirmDraftDiscard("Starting a new draft replaces the editor content. Choose whether to keep editing or discard your unsaved changes.")) return;
  try {
    app.currentCase = null; setDraft(await getTemplate()); app.draftDirty = true; updateDraftHeading(); renderFacultyCases();
    message("faculty-message", "This is an authoring template. Replace the placeholders with your own synthetic case, then complete a qualified clinical review.");
  } catch (error) { message("faculty-message", error.message, "error"); }
}

function setDraft(draft) {
  $("case-json").value = JSON.stringify(draft, null, 2); app.draftDirty = false; app.validation = null;
  $("validation-result").hidden = true; $("open-approval").disabled = true;
  syncDraftControls(); renderDraftPreview(); updateDraftHeading();
}

function parseDraft() {
  const draft = JSON.parse($("case-json").value);
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) throw new Error("Case definition must be a JSON object.");
  return draft;
}

function syncDraftControls() {
  try {
    const draft = parseDraft(); $("draft-mood").value = draft.behavior?.mood || "guarded";
    $("draft-rapport").value = draft.behavior?.initial_rapport ?? 30;
    $("draft-rapport-output").textContent = $("draft-rapport").value;
    const delivery = draft.voice_delivery || {};
    $("draft-voice-id").value = draft.voice_id || ""; $("draft-avatar-id").value = draft.avatar_id || "";
    $("draft-voice-model").value = delivery.model_id || "eleven_multilingual_v2";
    $("draft-emotion").value = delivery.emotion || "neutral"; $("draft-emotion-source").value = delivery.emotion_source || "faculty";
    $("draft-stability").value = delivery.stability ?? 0.5; $("draft-similarity").value = delivery.similarity_boost ?? 0.75;
    $("draft-style").value = delivery.style ?? 0; $("draft-speed").value = delivery.speed ?? 1;
    ["stability", "similarity", "style", "speed"].forEach((name) => { $(`draft-${name}-output`).textContent = Number($(`draft-${name}`).value).toFixed(2); });
    const turbo = $("draft-voice-model").value === "eleven_v4_turbo";
    $("draft-style").disabled = turbo; $("draft-speed").disabled = turbo;
    $("voice-model-note").textContent = turbo ? "Turbo v4 uses fixed emotion tags. Style and speed are unavailable for this model and must be null in the case JSON." : "Multilingual v2 uses authored wording, stability, and style. The emotion selection applies to Turbo v4; v2 does not support emotion tags.";
  } catch { /* Leave the last valid controls while JSON is being edited. */ }
}

function changeVoiceControl() {
  try {
    const draft = parseDraft(); const turbo = $("draft-voice-model").value === "eleven_v4_turbo";
    draft.voice_id = $("draft-voice-id").value.trim() || null; draft.avatar_id = $("draft-avatar-id").value.trim() || null;
    draft.voice_delivery = {
      model_id: $("draft-voice-model").value, emotion: $("draft-emotion").value, emotion_source: $("draft-emotion-source").value,
      stability: Number($("draft-stability").value), similarity_boost: Number($("draft-similarity").value),
      style: turbo ? null : Number($("draft-style").value), speed: turbo ? null : Number($("draft-speed").value),
    };
    $("case-json").value = JSON.stringify(draft, null, 2); markDraftChanged();
  } catch { message("faculty-message", "Correct the JSON before changing the voice controls.", "error"); }
}

function markDraftChanged() {
  app.draftDirty = true; app.validation = null; $("open-approval").disabled = true; $("validation-result").hidden = true;
  syncDraftControls(); renderDraftPreview(); updateDraftHeading();
}

function updateDraftHeading() {
  let title = "Case definition"; try { title = parseDraft().title || title; } catch { /* Render the recoverable editor label. */ }
  $("editor-title").textContent = title;
  const published = app.currentCase?.draft_status === "published" && !app.draftDirty;
  $("draft-state").textContent = app.draftDirty ? "Unsaved draft changes" : published ? "Published · Reviewer attested" : "Unreviewed draft";
  $("save-draft").textContent = app.currentCase ? "Save draft" : "Create draft";
  const currentStep = app.draftDirty || !app.currentCase ? 0 : app.validation?.valid || published ? 2 : 1;
  [...$("publishing-workflow").children].forEach((step, index) => {
    step.dataset.state = index < currentStep || published ? "done" : index === currentStep ? "current" : "todo";
    if (index === currentStep && !published) step.setAttribute("aria-current", "step"); else step.removeAttribute("aria-current");
  });
}

function addPreviewSection(target, title, items, renderItem) {
  const section = el("section", "preview-section");
  const heading = el("h3", "", title); heading.append(el("span", "preview-count", `(${items.length})`)); section.append(heading);
  if (!items.length) section.append(el("p", "small-note", "Add authored entries in Edit case JSON before reviewing this case."));
  items.forEach((item) => section.append(renderItem(item))); target.append(section);
}

function renderDraftPreview() {
  const target = $("draft-preview"); target.replaceChildren();
  try {
    const draft = parseDraft(); const intro = el("div", "preview-intro");
    intro.append(el("h3", "", draft.title || "Untitled case"), el("p", "", `${draft.patient_name || "Patient name needed"} · ${draft.age ?? "Age needed"} years · ${draft.setting || "Setting needed"}`), el("p", "", draft.summary || "Public learner-facing brief needed."));
    intro.append(el("p", "", `Opening: ${draft.opening || "Add an authored opening."}`)); target.append(intro);
    if (draft.author_note) target.append(el("p", "fine-print", draft.author_note));
    addPreviewSection(target, "Authored facts and disclosure", Array.isArray(draft.facts) ? draft.facts : [], (fact) => {
      const row = el("div", "preview-row"); row.append(el("strong", "", fact.label || fact.id || "Fact"), el("p", "", fact.text || "Fact content needed."));
      row.append(el("p", "small-note", `${fact.state || "known"} · ${fact.audience || "both"} · ${fact.initially_released ? "Initially available" : `Released by: ${(fact.keywords || []).join(", ") || "Add release keywords"}`}`));
      if (fact.requires?.length) row.append(el("p", "small-note", `Prerequisites: ${fact.requires.join(", ")}`));
      if (fact.patient_answer) row.append(el("p", "", `Patient answer: ${fact.patient_answer}`));
      if (fact.nondisclosure_answer) row.append(el("p", "", `Withheld answer: ${fact.nondisclosure_answer}. Clarify with: ${(fact.clarification_keywords || []).join(", ")}`));
      return row;
    });
    addPreviewSection(target, "Chart artifacts", Array.isArray(draft.artifacts) ? draft.artifacts : [], (artifact) => {
      const row = el("div", "preview-row"); row.append(el("strong", "", artifact.title || artifact.id || "Artifact"), el("p", "", artifact.body || "Artifact content needed."), el("p", "small-note", `${artifact.kind || "note"} · ${artifact.initially_released ? "Initially available" : `Released by: ${(artifact.keywords || []).join(", ")}`}`)); return row;
    });
    addPreviewSection(target, "Learning objectives", Array.isArray(draft.objectives) ? draft.objectives : [], (objective) => {
      const row = el("div", "preview-row"); row.append(el("strong", "", objective.label || objective.id || "Objective"), el("p", "", objective.guidance || "Faculty guidance needed."), el("p", "small-note", `Observable phrases: ${(objective.keywords || []).join(", ") || "None"}. Required facts: ${(objective.required_fact_ids || []).join(", ") || "None"}.`));
      if (objective.next_question) row.append(el("p", "", `Next attempt: ${objective.next_question}`)); return row;
    });
  } catch {
    target.append(el("div", "message error", "The JSON is incomplete or invalid. Open Edit case JSON and correct it; your edits remain available."));
  }
}

function setEditorTab(tab) {
  const preview = tab === "preview";
  $("draft-preview").hidden = !preview; $("json-panel").hidden = preview;
  $("preview-tab").classList.toggle("active", preview); $("json-tab").classList.toggle("active", !preview);
  $("preview-tab").setAttribute("aria-selected", String(preview)); $("json-tab").setAttribute("aria-selected", String(!preview));
  $("preview-tab").tabIndex = preview ? 0 : -1; $("json-tab").tabIndex = preview ? -1 : 0;
}

async function saveDraft() {
  let draft;
  try { draft = parseDraft(); } catch { throw new RequestError("The case JSON is incomplete or invalid. Correct it before saving."); }
  const path = app.currentCase ? `/faculty/cases/${encodeURIComponent(app.currentCase.id)}?expected_revision=${encodeURIComponent(app.currentCase.revision)}` : "/faculty/cases";
  const record = await api(path, { method: app.currentCase ? "PUT" : "POST", body: draft, token: app.facultyKey });
  app.currentCase = record; setDraft(record.draft); await loadFaculty(); renderFacultyCases();
  message("faculty-message", "Draft saved. Complete the structure check and qualified clinical review before publishing.");
  return record;
}

async function saveDraftClick() {
  const button = $("save-draft"); setBusy(button, true, "Saving…"); message("faculty-message", "");
  try { await saveDraft(); } catch (error) { message("faculty-message", error.message, "error"); }
  finally { setBusy(button, false); updateDraftHeading(); }
}

async function validateDraft() {
  const button = $("validate-draft"); setBusy(button, true, "Checking…"); message("faculty-message", "");
  try {
    if (!app.currentCase || app.draftDirty) await saveDraft();
    app.validation = await api(`/faculty/cases/${encodeURIComponent(app.currentCase.id)}/validate`, { method: "POST", token: app.facultyKey });
    const box = $("validation-result"); box.replaceChildren(); box.hidden = false;
    box.className = `validation-result${app.validation.valid ? "" : " error"}`;
    box.append(el("strong", "", app.validation.valid ? "Structure checked. Clinical review is still required." : "This draft needs structural changes."));
    if (app.validation.issues?.length) {
      const list = el("ul"); app.validation.issues.forEach((issue) => list.append(el("li", "", issue))); box.append(list);
    }
    box.append(el("p", "", "A qualified reviewer must assess the content, permissions, disclosure logic, and learning objectives."));
    $("open-approval").disabled = !app.validation.valid;
    updateDraftHeading();
  } catch (error) { message("faculty-message", error.message, "error"); }
  finally { setBusy(button, false); }
}

async function approveDraft(event) {
  event.preventDefault();
  if (!app.currentCase || app.draftDirty || !app.validation?.valid) { message("approval-error", "Save and check the current draft before publishing.", "error"); return; }
  const button = $("publish-button"); setBusy(button, true, "Publishing version…"); message("approval-error", "");
  try {
    const result = await api(`/faculty/cases/${encodeURIComponent(app.currentCase.id)}/approve`, { method: "POST", token: app.facultyKey, body: { reviewer: $("reviewer-name").value.trim(), review_note: $("review-note").value.trim(), clinical_review_confirmed: $("clinical-confirmation").checked, synthetic_confirmed: $("synthetic-confirmation").checked, expected_revision: app.currentCase.revision } });
    $("approval-dialog").close(); await loadCase(app.currentCase.id); await loadFaculty(); await loadLibrary();
    message("faculty-message", `Version ${result.version} is published with reviewer attestation. Independent clinical validation has not been established.`);
  } catch (error) {
    if (error.status === 409) {
      app.validation = null;
      $("open-approval").disabled = true;
      $("clinical-confirmation").checked = false;
      $("synthetic-confirmation").checked = false;
      updateDraftHeading();
      message("approval-error", "The draft changed after your review. Close this dialog, select the case again to load its current content, then check and review it before publishing.", "error");
    } else { message("approval-error", error.message, "error"); }
  }
  finally { setBusy(button, false); }
}

function clearFaculty() {
  app.facultyKey = ""; app.cases = []; app.currentCase = null; app.draftDirty = false; app.validation = null;
  $("faculty-key").value = ""; $("case-json").value = ""; $("draft-preview").replaceChildren(); $("faculty-cases").replaceChildren(); $("analytics").replaceChildren();
  $("faculty-workspace").hidden = true; $("faculty-login").hidden = false;
  $("approval-form").reset(); $("validation-result").hidden = true;
}

$("practice-nav").addEventListener("click", () => setView(app.encounter ? "encounter" : "practice"));
$("intro-preview").addEventListener("click", previewIntroVideo);
$("demo-open").addEventListener("click", openDemo);
$("demo-speak").addEventListener("click", () => startDemo(true));
$("demo-type").addEventListener("click", () => startDemo(false));
$("demo-dialog").addEventListener("close", () => {
  if (app.demoStarting) { ++app.demoGeneration; app.demoStarting.abort(); app.demoStarting = null; }
});
$("live-toggle").addEventListener("click", () => {
  if (!app.conversation) return;
  if (app.conversation.enabled) app.conversation.stop();
  else if (app.conversation.consent) { stopDictation(); app.conversation.start(); }
  else requestVoiceConsent("conversation");
});
$("intro-video-dialog").addEventListener("close", stopIntroVideo);
$("intro-video").addEventListener("error", () => { $("intro-video-status").textContent = "The introduction could not play. Continue with text practice; the transcript is above."; });
$("app-lock-form").addEventListener("submit", async (event) => {
  event.preventDefault(); setBusy($("app-lock"), true, "Locking…");
  app.demoStarting?.abort(); ++app.demoGeneration; app.conversation?.stop(); app.turnOperation?.abort();
  stopAudio(); stopDictation(); await app.video?.stop();
  cleanupEncounter(); clearFaculty(); $("app-lock-form").submit();
});
$("studio-nav").addEventListener("click", openStudio);
$("refresh-library").addEventListener("click", loadLibrary);
$("start-form").addEventListener("submit", startEncounter);
$("turn-form").addEventListener("submit", sendTurn);
$("turn-text").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); $("turn-form").requestSubmit(); }
});
$("finish-encounter").addEventListener("click", finishEncounter);
$("return-library").addEventListener("click", () => { cleanupEncounter(); setView("practice"); loadLibrary(); });
$("enable-audio").addEventListener("click", () => {
  if (app.audioEnabled) { app.conversation?.stop(); app.audioEnabled = false; stopAudio(); renderVoiceControls(); }
  else requestVoiceConsent("audio");
});
$("play-response").addEventListener("click", () => { app.conversation?.stop(); if (latestPatient()) { if (app.video?.active) app.video.speak(latestPatient().id); else playPatientAudio(latestPatient().id); } });
$("stop-audio").addEventListener("click", () => { app.conversation?.stop(); stopAudio(); app.video?.interrupt(); $("audio-status").textContent = "Response stopped. Continue reading the captions."; });
$("enable-video").addEventListener("click", () => {
  if (app.video?.active || app.video?.starting) { app.video.stop(); $("video-status").textContent = "Video stopped. A new video session cannot be started in this encounter. Continue with captions or enable audio-only playback."; }
  else requestVoiceConsent("video");
});
$("allow-video-playback").addEventListener("click", () => app.video?.allowPlayback());
$("dictate").addEventListener("click", () => {
  if (app.recognition) stopDictation();
  else if (app.dictationConsent) startDictation();
  else requestVoiceConsent("dictation");
});
$("voice-confirm").addEventListener("click", () => {
  $("voice-dialog").close();
  if (app.voiceMode === "audio") { app.audioEnabled = true; renderVoiceControls(); if (latestPatient()) playPatientAudio(latestPatient().id); }
  else if (app.voiceMode === "video") startPatientVideo();
  else if (app.voiceMode === "conversation") { app.audioEnabled = true; stopDictation(); app.conversation?.start({ consented: true }); }
  else { app.dictationConsent = true; startDictation(); }
});
$("faculty-login").addEventListener("submit", facultyLogin);
$("faculty-logout").addEventListener("click", () => { clearFaculty(); message("faculty-message", "Faculty access closed for this tab."); });
$("new-case").addEventListener("click", newCase);
$("save-draft").addEventListener("click", saveDraftClick);
$("validate-draft").addEventListener("click", validateDraft);
$("case-json").addEventListener("input", markDraftChanged);
$("draft-mood").addEventListener("change", () => {
  try { const draft = parseDraft(); draft.behavior ||= {}; draft.behavior.mood = $("draft-mood").value; $("case-json").value = JSON.stringify(draft, null, 2); markDraftChanged(); }
  catch { message("faculty-message", "Correct the JSON before changing the mood controls.", "error"); }
});
$("draft-rapport").addEventListener("input", () => {
  try { const draft = parseDraft(); draft.behavior ||= {}; draft.behavior.initial_rapport = Number($("draft-rapport").value); $("case-json").value = JSON.stringify(draft, null, 2); markDraftChanged(); }
  catch { message("faculty-message", "Correct the JSON before changing the rapport control.", "error"); }
});
["voice-id", "avatar-id", "voice-model", "emotion", "emotion-source"].forEach((name) => { $(`draft-${name}`).addEventListener("change", changeVoiceControl); });
["stability", "similarity", "style", "speed"].forEach((name) => { $(`draft-${name}`).addEventListener("input", changeVoiceControl); });
$("preview-tab").addEventListener("click", () => setEditorTab("preview"));
$("json-tab").addEventListener("click", () => setEditorTab("json"));
[$("preview-tab"), $("json-tab")].forEach((tab) => tab.addEventListener("keydown", (event) => {
  if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
    event.preventDefault(); const toPreview = event.key === "Home" || (event.key !== "End" && tab.id === "json-tab");
    setEditorTab(toPreview ? "preview" : "json"); $(toPreview ? "preview-tab" : "json-tab").focus();
  }
}));
$("open-approval").addEventListener("click", () => { $("approval-form").reset(); message("approval-error", ""); $("approval-dialog").showModal(); });
$("approval-form").addEventListener("submit", approveDraft);
document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => $(button.dataset.close).close()));
$("start-dialog").addEventListener("close", () => { $("student-code").value = ""; });
$("approval-dialog").addEventListener("close", () => { $("approval-form").reset(); });
window.addEventListener("beforeunload", (event) => {
  if (app.encounter?.status === "active" || app.draftDirty) { event.preventDefault(); event.returnValue = ""; }
});
window.addEventListener("pagehide", () => { app.conversation?.pageHidden(); app.turnOperation?.abort(); app.demoStarting?.abort(); ++app.demoGeneration; app.video?.stop({ keepalive: true }); stopIntroVideo(); stopAudio(); stopDictation(); });
setEditorTab("preview");
loadLibrary();
