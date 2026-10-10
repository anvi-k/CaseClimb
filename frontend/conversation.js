"use strict";

// Half-duplex conversation: browser recognition listens only between authored
// server replies. Adapters own the HTTP request and audio playback; speakReply
// must resolve at audio END, rather than when HTMLMediaElement.play() resolves.
class LiveSpeechConversation {
  constructor({ createRecognition, sendFinal, speakReply, stopPlayback, availability,
    onState = () => {}, onTranscript = () => {}, idFactory = () => crypto.randomUUID() }) {
    Object.assign(this, { createRecognition, sendFinal, speakReply, stopPlayback, availability, onState, onTranscript, idFactory });
    this.state = "off"; this.reason = ""; this.enabled = false; this.consent = false;
    this.generation = 0; this.recognition = null; this.operation = null;
  }

  changed(state, reason = "") {
    this.state = state; this.reason = reason;
    this.onState({ state, reason, enabled: this.enabled });
  }

  available() {
    const value = this.availability();
    if (!value.sessionActive) return "session-ended";
    if (!value.recognition) return "recognition-unavailable";
    if (!value.voice) return "voice-unavailable";
    if (value.busy) return "turn-pending";
    return "";
  }

  current(generation) { return this.enabled && this.generation === generation; }

  releaseRecognition() {
    const recognition = this.recognition; this.recognition = null;
    if (!recognition) return;
    recognition.onstart = recognition.onresult = recognition.onerror = recognition.onend = null;
    try { recognition.abort(); } catch {}
  }

  stop(reason = "paused") {
    this.enabled = false; ++this.generation;
    this.releaseRecognition(); this.operation?.abort(); this.operation = null;
    this.stopPlayback(); this.onTranscript({ text: "", final: false });
    this.changed("stopped", reason);
  }

  fail(reason) {
    this.stop(reason); this.changed("error", reason);
  }

  async start({ consented = false, openingReply = null } = {}) {
    if (!consented && !this.consent) { this.changed("off", "consent-required"); return false; }
    if (this.enabled) return true;
    this.consent = true;
    const unavailable = this.available();
    if (unavailable) { this.changed("unavailable", unavailable); return false; }
    this.enabled = true; const generation = ++this.generation;
    this.changed("starting");
    if (openingReply) await this.play(openingReply, generation);
    else this.listen(generation);
    return this.current(generation);
  }

  listen(generation) {
    if (!this.current(generation)) return;
    const unavailable = this.available();
    if (unavailable) { this.stop(unavailable); return; }
    let recognition;
    try { recognition = this.createRecognition(); }
    catch { this.fail("recognition-unavailable"); return; }
    if (!recognition) { this.fail("recognition-unavailable"); return; }
    this.recognition = recognition;
    recognition.continuous = false; recognition.interimResults = true; recognition.lang = "en-US";
    let accepted = false;
    const valid = () => this.current(generation) && this.recognition === recognition && !accepted;
    recognition.onstart = () => { if (valid()) this.changed("listening"); };
    recognition.onresult = (event) => {
      if (!valid()) return;
      if (!this.availability().sessionActive) { this.stop("session-ended"); return; }
      const finals = [], interim = [];
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        const text = typeof result?.[0]?.transcript === "string" ? result[0].transcript.trim() : "";
        if (text) (result.isFinal ? finals : interim).push(text);
      }
      const text = finals.join(" ").trim();
      if (!text) { this.onTranscript({ text: interim.join(" ").slice(0, 2000), final: false }); return; }
      if (text.length > 2000) { this.fail("phrase-too-long"); return; }
      accepted = true; this.releaseRecognition();
      this.onTranscript({ text, final: true });
      this.submit(text, generation);
    };
    recognition.onerror = (event) => {
      if (!valid()) return;
      const reason = ({ "not-allowed": "microphone-denied", "service-not-allowed": "microphone-denied",
        "audio-capture": "microphone-unavailable", network: "recognition-network", "no-speech": "no-speech", aborted: "paused" })[event.error] || "recognition-error";
      this.fail(reason);
    };
    recognition.onend = () => {
      if (!valid()) return;
      this.stop("no-speech"); // No restart loop after silence or a service stop.
    };
    this.changed("starting");
    try { recognition.start(); } catch { if (valid()) this.fail("recognition-unavailable"); }
  }

  async submit(text, generation) {
    if (!this.current(generation)) return;
    this.changed("submitting");
    const controller = new AbortController(); this.operation = controller;
    try {
      const reply = await this.sendFinal(text, { requestId: this.idFactory(), signal: controller.signal });
      if (!this.current(generation)) return;
      this.operation = null;
      if (!this.availability().sessionActive) { this.stop("session-ended"); return; }
      if (!reply) { this.fail("reply-unavailable"); return; }
      await this.play(reply, generation);
    } catch {
      if (this.current(generation)) this.fail("turn-error");
    } finally { if (this.operation === controller) this.operation = null; }
  }

  async play(reply, generation) {
    if (!this.current(generation)) return;
    this.releaseRecognition(); this.changed("speaking");
    const controller = new AbortController(); this.operation = controller;
    try {
      await this.speakReply(reply, { signal: controller.signal });
      if (!this.current(generation)) return;
      this.operation = null; this.listen(generation);
    } catch {
      if (this.current(generation)) this.fail("playback-error");
    } finally { if (this.operation === controller) this.operation = null; }
  }

  sessionEnded() { this.stop("session-ended"); }
  pageHidden() { this.stop("page-hidden"); }
}
