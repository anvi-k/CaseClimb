"use strict";

// Provider credentials never enter this module. WebSocket tickets and Scribe
// tokens are short lived, memory only, and obtained through the entrance gate.
const microphoneWorkletUrl = new URL("./microphone-worklet.js", document.currentScript.src).href;
function streamFailure(message, code = "stream-error") { const error = new Error(message); error.kind = code; return error; }
function streamDeferred() {
  let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  promise.catch(() => {}); return { promise, resolve, reject };
}
function decodePcmChunk(audio) {
  if (typeof audio !== "string" || audio.length > 11000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(audio)) throw streamFailure("Unexpected audio chunk.");
  const decoded = atob(audio);
  if (!decoded.length || decoded.length > 8192 || decoded.length % 2) throw streamFailure("Unexpected audio format.");
  const bytes = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
  return bytes;
}
function encodePcmChunk(buffer) {
  const bytes = new Uint8Array(buffer); let text = "";
  for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
  return btoa(text);
}

class StreamingPcmPlayer {
  constructor({ createContext = () => new (window.AudioContext || window.webkitAudioContext)(), onPlaying = () => {} } = {}) {
    this.createContext = createContext; this.onPlaying = onPlaying; this.context = null;
    this.sources = new Set(); this.generation = 0; this.operation = null;
  }
  async unlock() {
    if (!this.context || this.context.state === "closed") this.context = this.createContext();
    await this.context.resume();
  }
  async begin(metadata, { signal } = {}) {
    this.stop(); const generation = this.generation;
    if (metadata.format !== "pcm_s16le" || metadata.sample_rate !== 24000 || metadata.channels !== 1) throw streamFailure("Unexpected audio format.");
    await this.unlock();
    if (generation !== this.generation || signal?.aborted) throw streamFailure("Audio stopped.", "cancelled");
    const completed = streamDeferred();
    const operation = { generation, completed, ended: false, samples: 0, until: this.context.currentTime + .02, signal };
    operation.onAbort = () => this.stop(); signal?.addEventListener("abort", operation.onAbort, { once: true });
    this.operation = operation;
  }
  push(audio) {
    const op = this.operation;
    if (!op || op.ended || op.signal?.aborted) throw streamFailure("Audio stopped.", "cancelled");
    const bytes = decodePcmChunk(audio), samples = bytes.length / 2;
    op.samples += samples;
    if (op.samples > 720000 || op.until - this.context.currentTime > 35) throw streamFailure("Audio queue exceeded its limit.");
    const buffer = this.context.createBuffer(1, samples, 24000), output = buffer.getChannelData(0);
    const values = new DataView(bytes.buffer);
    for (let i = 0; i < samples; i++) output[i] = values.getInt16(i * 2, true) / 32768;
    const source = this.context.createBufferSource(); source.buffer = buffer; source.connect(this.context.destination);
    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source); source.disconnect();
      if (this.operation === op && op.ended && !this.sources.size) this.complete(op);
    };
    const at = Math.max(this.context.currentTime + .01, op.until);
    op.until = at + samples / 24000; source.start(at); this.onPlaying(true);
  }
  complete(op) {
    if (this.operation !== op) return;
    this.operation = null; op.signal?.removeEventListener("abort", op.onAbort);
    this.onPlaying(false); op.completed.resolve();
  }
  finish() {
    const op = this.operation;
    if (!op) return Promise.reject(streamFailure("Audio stopped.", "cancelled"));
    op.ended = true;
    if (!this.sources.size) this.complete(op);
    return op.completed.promise;
  }
  stop() {
    ++this.generation; const op = this.operation; this.operation = null;
    op?.signal?.removeEventListener("abort", op.onAbort);
    for (const source of this.sources) { source.onended = null; try { source.stop(); source.disconnect(); } catch {} }
    this.sources.clear(); this.onPlaying(false);
    op?.completed.reject(streamFailure("Audio stopped.", "cancelled"));
  }
  close() { this.stop(); const context = this.context; this.context = null; if (context) Promise.resolve(context.close()).catch(() => {}); }
}

class EncounterStreamingClient {
  constructor({ requestTicket, refreshState, canInteract, onConfirmed, createSink, cancelRequest = null, requestTimeout = () => 70000, onStatus = () => {}, socketFactory = (url) => new WebSocket(url) }) {
    Object.assign(this, { requestTicket, refreshState, canInteract, onConfirmed, createSink, cancelRequest, requestTimeout, onStatus, socketFactory });
    this.socket = null; this.connecting = null; this.operation = null; this.generation = 0; this.connectedOnce = false;
    this.heartbeat = null;
  }
  async connect() {
    if (!this.canInteract()) throw streamFailure("This conversation has ended.", "session-ended");
    if (this.socket?.readyState === WebSocket.OPEN) return;
    if (this.connecting) return this.connecting;
    const generation = this.generation;
    this.connecting = (async () => {
      if (this.connectedOnce) await this.refreshState();
      if (!this.canInteract() || generation !== this.generation) throw streamFailure("This conversation has ended.", "session-ended");
      const ticket = await this.requestTicket();
      if (!this.canInteract() || generation !== this.generation) throw streamFailure("Connection stopped.", "cancelled");
      if (typeof ticket.websocket_url !== "string" || new URL(ticket.websocket_url).protocol !== "wss:" || !Number.isFinite(ticket.deadline)) throw streamFailure("Streaming is unavailable.");
      await new Promise((resolve, reject) => {
        const socket = this.socketFactory(ticket.websocket_url); this.socket = socket;
        const timeout = setTimeout(() => { socket.close(); reject(streamFailure("The streaming connection timed out.")); }, 10000);
        socket.onopen = () => {
          clearTimeout(timeout); this.connectedOnce = true;
          clearInterval(this.heartbeat); this.heartbeat = setInterval(() => {
            if (!this.canInteract()) { this.close(); return; }
            if (socket === this.socket && socket.readyState === WebSocket.OPEN) { try { socket.send(JSON.stringify({ action: "ping" })); } catch { this.disconnected(socket); } }
          }, 30000);
          resolve();
        };
        socket.onmessage = (event) => { if (socket === this.socket) this.receive(event, generation); };
        socket.onerror = () => { clearTimeout(timeout); reject(streamFailure("The streaming connection failed.")); this.disconnected(socket); };
        socket.onclose = () => { clearTimeout(timeout); reject(streamFailure("The streaming connection ended.")); this.disconnected(socket); };
      });
    })();
    try { return await this.connecting; } finally { this.connecting = null; }
  }
  disconnected(socket) {
    if (socket !== this.socket) return;
    clearInterval(this.heartbeat); this.heartbeat = null;
    this.socket = null;
    this.cancel();
    this.fail(this.operation, streamFailure("The connection stopped. Your confirmed transcript remains available. Resume explicitly; interrupted audio will not replay.", "disconnected"));
    this.onStatus("Connection stopped. Resume explicitly to reconnect; confirmed turns remain in the transcript.");
  }
  async request(action, body, { signal } = {}) {
    if (this.operation) throw streamFailure("A reply is still processing.", "pending");
    const op = { requestId: body.request_id, action, completed: streamDeferred(), chain: Promise.resolve(), confirmed: null, sink: null, cancelled: false, sequence: 0, audioStarted: false, ended: false, signal, queuedBytes: 0 };
    this.operation = op;
    op.onAbort = () => this.cancel(op.requestId);
    signal?.addEventListener("abort", op.onAbort, { once: true });
    if (signal?.aborted) { this.fail(op, streamFailure("Reply stopped.", "cancelled")); return op.completed.promise; }
    try {
      await this.connect();
      if (this.operation !== op || signal?.aborted || !this.canInteract()) throw streamFailure("Reply stopped.", "cancelled");
      op.timer = setTimeout(() => { this.cancel(op.requestId); this.fail(op, streamFailure("Reply timed out. Review the confirmed transcript and retry explicitly.", "timeout")); }, Math.max(1, this.requestTimeout()));
      this.socket.send(JSON.stringify({ action, ...body }));
    } catch (error) { this.fail(op, error); }
    return op.completed.promise;
  }
  turn(body, options) { return this.request("turn", { request_id: body.request_id, text: body.text, audio: true }, options); }
  speak(eventId, { requestId = crypto.randomUUID(), signal } = {}) { return this.request("speak", { request_id: requestId, event_id: eventId }, { signal }); }
  receive({ data }, generation) {
    if (generation !== this.generation || typeof data !== "string" || data.length > 150000) return;
    let frame; try { frame = JSON.parse(data); } catch { this.fail(this.operation, streamFailure("Unexpected streaming response.")); return; }
    const op = this.operation;
    if (!op || frame.request_id !== op.requestId) return;
    op.queuedBytes += data.length;
    if (op.queuedBytes > 2100000) { this.cancel(op.requestId); this.fail(op, streamFailure("Audio queue exceeded its limit.")); return; }
    op.chain = op.chain.then(async () => {
      if (this.operation !== op || !this.canInteract()) { this.fail(op, streamFailure("This conversation has ended.", "session-ended")); return; }
      if (frame.type === "turn.confirmed") {
        if (op.confirmationReceived) throw streamFailure("Unexpected turn confirmation.");
        op.confirmationReceived = true; op.patientEvent = frame.patient_event;
        // Large ledgers hydrate over authenticated HTTP while PCM continues to
        // play. Confirmation is already durable; hydration is never a resubmit.
        op.hydration = Promise.resolve(frame.state_required === true || frame.refresh_required === true ? this.refreshState() : frame.state).then((state) => {
          if (!state || !Array.isArray(state.events)) throw streamFailure("Unexpected turn confirmation.");
          op.confirmed = state; if (generation === this.generation && this.canInteract()) this.onConfirmed(state);
        });
        op.hydration.catch((error) => this.fail(op, error));
        if (op.cancelled) this.fail(op, streamFailure("Reply interrupted.", "cancelled"));
      } else if (frame.type === "audio.start") {
        if (op.cancelled) return;
        if (op.audioStarted || typeof frame.utterance_id !== "string" || typeof frame.event_id !== "string") throw streamFailure("Unexpected audio response.");
        op.audioStarted = true; op.utteranceId = frame.utterance_id; op.eventId = frame.event_id;
        op.sink = this.createSink(); await op.sink.begin(frame, { signal: op.signal });
      } else if (frame.type === "audio.chunk") {
        if (op.cancelled) return;
        if (!op.audioStarted || op.ended || frame.utterance_id !== op.utteranceId || frame.sequence !== op.sequence++) throw streamFailure("Audio stream was interrupted.");
        decodePcmChunk(frame.audio); await op.sink.push(frame.audio);
      } else if (frame.type === "audio.end") {
        if (op.cancelled) { this.fail(op, streamFailure("Reply interrupted.", "cancelled")); return; }
        if (!op.audioStarted || op.ended || frame.utterance_id !== op.utteranceId) throw streamFailure("Unexpected audio completion.");
        op.ended = true; clearTimeout(op.timer);
        op.timer = setTimeout(() => this.fail(op, streamFailure("Audio playback did not finish.", "playback-error")), 90000);
        await op.sink.finish(); await op.hydration; this.complete(op);
      } else if (frame.type === "stream.error") {
        const reason = frame.code === "cancelled" ? "cancelled" : frame.code === "pending" ? "pending" : "stream-error";
        this.fail(op, streamFailure(reason === "cancelled" ? "Reply interrupted." : "The reply could not finish. Review the transcript and retry explicitly.", reason));
      }
    }).catch((error) => { this.cancel(op.requestId); this.fail(op, error); }).finally(() => { op.queuedBytes -= data.length; });
  }
  complete(op) {
    if (this.operation !== op) return;
    this.release(op);
    const patientEvent = op.patientEvent || op.confirmed?.events.find((event) => event.id === op.eventId) || { id: op.eventId };
    op.completed.resolve({ state: op.confirmed, patient_event: patientEvent, streamed: true });
  }
  release(op) {
    clearTimeout(op.timer); op.signal?.removeEventListener("abort", op.onAbort);
    if (this.operation === op) this.operation = null;
  }
  fail(op, error) {
    if (!op || this.operation !== op) return;
    op.sink?.stop(); this.release(op); op.completed.reject(error);
  }
  cancel(requestId = this.operation?.requestId) {
    const op = this.operation;
    if (!op || op.requestId !== requestId || op.cancelled) return;
    op.cancelled = true; op.sink?.stop();
    if (this.socket?.readyState === WebSocket.OPEN) { try { this.socket.send(JSON.stringify({ action: "cancel", request_id: requestId })); } catch {} }
    // The independent HTTP function remains available when all streaming
    // workers are occupied. Its acknowledgement follows durable cancellation.
    if (this.cancelRequest) Promise.resolve(this.cancelRequest(requestId)).then(() => {
      if (this.operation === op && op.cancelled) this.fail(op, streamFailure("Reply interrupted.", "cancelled"));
    }).catch(() => {});
    // A confirmed turn already owns its ledger entry. Stop output immediately;
    // an unconfirmed turn must await a terminal server frame before the next.
    if (op.confirmationReceived || op.action === "speak") this.fail(op, streamFailure("Reply interrupted.", "cancelled"));
  }
  close() {
    clearInterval(this.heartbeat); this.heartbeat = null;
    ++this.generation; this.cancel(); this.fail(this.operation, streamFailure("Streaming stopped.", "cancelled"));
    const socket = this.socket; this.socket = null;
    if (socket) { socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null; try { socket.close(); } catch {} }
  }
}

class ScribeMicrophone {
  constructor({ requestToken, canInteract, onPartial, onCommitted, onError, socketFactory = (url) => new WebSocket(url), mediaDevices = navigator.mediaDevices, createContext = () => new (window.AudioContext || window.webkitAudioContext)() }) {
    Object.assign(this, { requestToken, canInteract, onPartial, onCommitted, onError, socketFactory, mediaDevices, createContext });
    this.generation = 0; this.socket = null; this.stream = null; this.context = null; this.node = null; this.source = null; this.timer = null;
    this.socketReadyCleanup = null;
  }
  async start() {
    this.stop(); const generation = this.generation;
    const current = () => generation === this.generation && this.canInteract();
    try {
      // Create/resume in the consent click before asynchronous token requests.
      const context = this.createContext(); this.context = context; await context.resume();
      const stream = await this.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      if (!current()) { stream.getTracks().forEach((track) => track.stop()); return false; }
      this.stream = stream;
      const grant = await this.requestToken(); if (!current()) return false;
      if (typeof grant.token !== "string" || grant.model_id !== "scribe_v2_realtime" || grant.audio_format !== "pcm_16000" || grant.sample_rate !== 16000 || !Number.isFinite(grant.deadline) || grant.deadline * 1000 <= Date.now()) throw streamFailure("Speech transcription is unavailable.");
      const url = new URL("wss://api.elevenlabs.io/v1/speech-to-text/realtime");
      for (const [key, value] of Object.entries({ token: grant.token, model_id: grant.model_id, audio_format: grant.audio_format, language_code: "en", commit_strategy: "vad", vad_silence_threshold_secs: .7, min_speech_duration_ms: 150, min_silence_duration_ms: 100, include_timestamps: "false", include_language_detection: "false" })) url.searchParams.set(key, value);
      const socket = this.socketFactory(url.href); this.socket = socket;
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(streamFailure("Speech connection timed out.")), 10000);
        this.socketReadyCleanup = () => { clearTimeout(timeout); reject(streamFailure("Speech connection stopped.", "cancelled")); };
        socket.onmessage = ({ data }) => {
          if (!current() || typeof data !== "string" || data.length > 30000) return;
          let event; try { event = JSON.parse(data); } catch { return; }
          if (event.message_type === "session_started") { clearTimeout(timeout); this.socketReadyCleanup = null; resolve(); }
          else if (event.message_type === "partial_transcript" && typeof event.text === "string") this.onPartial(event.text.slice(0, 2000));
          else if (event.message_type === "committed_transcript" && typeof event.text === "string") {
            const text = event.text.trim(); if (text && text.length <= 2000) this.onCommitted(text);
            else if (text.length > 2000) this.fail("phrase-too-long");
          } else if (event.message_type !== "warning" && /error|rate_limited|quota_exceeded|session_time_limit_exceeded/.test(event.message_type || "")) {
            clearTimeout(timeout); reject(streamFailure("Speech connection is unavailable.")); this.fail("recognition-network");
          }
        };
        socket.onerror = socket.onclose = () => { clearTimeout(timeout); reject(streamFailure("Speech connection ended.")); if (current()) this.fail("recognition-network"); };
      });
      if (!current()) return false;
      await context.audioWorklet.addModule(microphoneWorkletUrl); if (!current()) return false;
      const source = context.createMediaStreamSource(stream); this.source = source;
      const node = new AudioWorkletNode(context, "caseclimb-microphone", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] }); this.node = node;
      node.port.onmessage = ({ data }) => {
        if (!current() || socket.readyState !== WebSocket.OPEN) return;
        if (socket.bufferedAmount > 64000) { this.fail("recognition-network"); return; }
        try { socket.send(JSON.stringify({ message_type: "input_audio_chunk", audio_base_64: encodePcmChunk(data), sample_rate: 16000, commit: false })); }
        catch { this.fail("recognition-network"); }
      };
      source.connect(node); node.connect(context.destination);
      this.timer = setTimeout(() => this.fail("session-ended"), Math.max(0, grant.deadline * 1000 - Date.now()));
      return true;
    } catch (error) {
      if (current()) this.fail(error.name === "NotAllowedError" ? "microphone-denied" : error.name === "NotFoundError" ? "microphone-unavailable" : "recognition-network");
      return false;
    }
  }
  fail(reason) { this.stop(); this.onError(reason); }
  stop() {
    ++this.generation; clearTimeout(this.timer); this.timer = null;
    this.socketReadyCleanup?.(); this.socketReadyCleanup = null;
    if (this.node) { this.node.port.onmessage = null; try { this.node.disconnect(); } catch {} this.node = null; }
    if (this.source) { try { this.source.disconnect(); } catch {} this.source = null; }
    this.stream?.getTracks().forEach((track) => track.stop()); this.stream = null;
    const socket = this.socket; this.socket = null;
    if (socket) { socket.onmessage = socket.onerror = socket.onclose = null; try { socket.close(); } catch {} }
    const context = this.context; this.context = null; if (context) Promise.resolve(context.close()).catch(() => {});
  }
}
