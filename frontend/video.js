"use strict";

// Receive-only LiveKit + LiveAvatar LITE transport. Clinical state stays on the
// encounter server. This transport never sends learner text or creates tracks.
const patientVideoSdkUrl = new URL("./vendor/livekit-client-2.22.4.umd.js", document.currentScript.src).href;
let patientVideoSdkPromise = null;

function loadPatientVideoSdk() {
  if (window.LivekitClient) {
    window.LivekitClient.setLogLevel(window.LivekitClient.LogLevel.silent);
    return Promise.resolve(window.LivekitClient);
  }
  if (patientVideoSdkPromise) return patientVideoSdkPromise;
  patientVideoSdkPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const timeout = setTimeout(() => fail(), 10000);
    const fail = () => {
      clearTimeout(timeout); script.remove(); patientVideoSdkPromise = null;
      reject(new Error("The video player could not load. Continue with captions."));
    };
    script.src = patientVideoSdkUrl;
    script.onload = () => {
      clearTimeout(timeout);
      if (!window.LivekitClient) { fail(); return; }
      window.LivekitClient.setLogLevel(window.LivekitClient.LogLevel.silent);
      resolve(window.LivekitClient);
    };
    script.onerror = fail;
    document.head.append(script);
  });
  return patientVideoSdkPromise;
}

class PatientVideoRenderer {
  constructor({ request, secondsRemaining, serverNow, videoElement, audioContainer, onChange, onStatus, onAttempt }) {
    Object.assign(this, { request, secondsRemaining, serverNow, videoElement, audioContainer, onChange, onStatus, onAttempt });
    this.active = false; this.starting = false; this.visual = false; this.speaking = false;
    this.needsPlayback = false; this.room = null; this.socket = null;
    this.tracks = new Set(); this.generation = 0; this.speechGeneration = 0;
    this.deadline = null; this.serverAttempted = false; this.serverStopped = false; this.stopPromise = null; this.audioController = null;
    this.deadlineTimer = null; this.heartbeat = null; this.frameTimer = null;
    this.utterance = null; this.sandbox = false; this.avatarName = ""; this.socketReadyCleanup = null;
    this.streamingOperation = null;
  }

  changed() { this.onChange(this); }
  remaining() { return Math.max(0, Math.min(this.secondsRemaining(), this.deadline ? (this.deadline * 1000 - this.serverNow()) / 1000 : Infinity)); }
  stillCurrent(generation) { return generation === this.generation && this.remaining() > 0; }
  limitDeadline(deadline) {
    if (!Number.isFinite(deadline)) return;
    this.deadline = Math.min(this.deadline || Infinity, deadline);
    if (this.active || this.starting) {
      clearTimeout(this.deadlineTimer);
      this.deadlineTimer = setTimeout(() => this.endAtDeadline(), this.remaining() * 1000);
    }
  }

  endAtDeadline() {
    this.stop();
    this.onStatus(this.sandbox ? "The 60-second Wayne video preview ended. Continue with your selected profile's ElevenLabs voice, illustration, and captions. Choose Resume listening if it was paused." : "The video session ended. Voice, illustration, and captions remain available.");
  }

  settleUtterance(error) {
    const utterance = this.utterance; this.utterance = null;
    if (!utterance) return;
    clearTimeout(utterance.timer);
    this.speaking = false; this.changed();
    if (error) utterance.reject(error); else utterance.resolve();
  }

  async start() {
    if (this.active || this.starting || this.remaining() <= 0) return;
    this.starting = true; this.changed(); this.onStatus("Connecting the video patient…");
    const generation = ++this.generation;
    try {
      const sdk = await loadPatientVideoSdk();
      if (!this.stillCurrent(generation)) return;
      if (!sdk.isBrowserSupported()) throw new Error("This browser cannot receive live video.");
      this.onAttempt(); this.serverAttempted = true;
      const session = await this.request("/video/start", { method: "POST", timeout: 28000 });
      if (!this.stillCurrent(generation)) { this.stop({ notifyServer: true }); return; }
      if (!Number.isFinite(session.deadline)) throw new Error("Missing video deadline.");
      this.deadline = session.deadline;
      this.sandbox = session.sandbox === true; this.avatarName = this.sandbox ? "Wayne" : "";
      if (!this.stillCurrent(generation)) { this.stop(); return; }
      if (new URL(session.livekit_url).protocol !== "wss:" || new URL(session.ws_url).protocol !== "wss:") throw new Error("Invalid secure video transport.");
      const room = new sdk.Room({ adaptiveStream: true }); this.room = room;
      room.on(sdk.RoomEvent.TrackSubscribed, (track) => {
        if (!this.stillCurrent(generation)) { track.detach(); return; }
        this.tracks.add(track);
        if (track.kind === sdk.Track.Kind.Video) {
          track.attach(this.videoElement); this.visual = true; this.changed();
          this.videoElement.onloadeddata = () => {
            if (!this.stillCurrent(generation)) return;
            clearTimeout(this.frameTimer);
            this.onStatus(this.sandbox ? "Wayne live video preview connected. Your selected profile supplies the words and ElevenLabs voice; this rendered face is shared. Video lasts up to 60 seconds." : "Live video connected. Stored replies use synchronized ElevenLabs voice; captions remain available.");
          };
          this.videoElement.play().catch(() => { if (this.stillCurrent(generation)) { this.needsPlayback = true; this.changed(); } });
        } else if (track.kind === sdk.Track.Kind.Audio) {
          const element = track.attach(); element.autoplay = true;
          this.audioContainer.append(element);
          Promise.resolve(element.play()).catch(() => {
            if (!this.stillCurrent(generation)) return;
            this.needsPlayback = true; this.changed();
            this.settleUtterance(new Error("Allow video playback before replaying the reply."));
            this.onStatus("Your browser paused video audio. Choose Allow video playback, then Replay response. Captions remain visible.");
          });
        }
      });
      room.on(sdk.RoomEvent.TrackUnsubscribed, (track) => {
        track.detach().forEach((element) => { if (element !== this.videoElement) element.remove(); });
        this.tracks.delete(track);
        if (track.kind === sdk.Track.Kind.Video && this.stillCurrent(generation)) {
          this.visual = false; this.changed(); this.onStatus("The video feed paused. Continue with captions.");
        }
      });
      const playbackChanged = () => {
        if (this.stillCurrent(generation)) { this.needsPlayback = !room.canPlaybackAudio || !room.canPlaybackVideo; this.changed(); }
      };
      room.on(sdk.RoomEvent.AudioPlaybackStatusChanged, playbackChanged);
      room.on(sdk.RoomEvent.VideoPlaybackStatusChanged, playbackChanged);
      room.on(sdk.RoomEvent.Disconnected, () => {
        if (this.stillCurrent(generation)) { this.stop(); this.onStatus("The video connection ended. Continue with ElevenLabs voice, illustration, and captions; choose Resume listening if it was paused."); }
      });
      if (sdk.RoomEvent.Reconnecting) room.on(sdk.RoomEvent.Reconnecting, () => {
        if (this.stillCurrent(generation)) { this.stop(); this.onStatus("The video connection was interrupted. Continue with ElevenLabs voice and captions. Start a new encounter to try video again."); }
      });
      room.on(sdk.RoomEvent.TrackSubscriptionFailed, () => {
        if (this.stillCurrent(generation)) { this.stop(); this.onStatus("The video feed could not be received. Continue with captions."); }
      });
      const connect = Promise.all([room.connect(session.livekit_url, session.livekit_client_token, { autoSubscribe: true }), this.openSocket(session.ws_url, generation)]);
      let connectionTimer;
      try {
        await Promise.race([connect, new Promise((_, reject) => { connectionTimer = setTimeout(() => reject(new Error("Video connection timed out.")), 20000); })]);
      } finally { clearTimeout(connectionTimer); }
      if (!this.stillCurrent(generation)) return;
      this.active = true; this.starting = false; this.changed();
      this.onStatus("Video connected. Waiting for the patient feed…");
      this.deadlineTimer = setTimeout(() => this.endAtDeadline(), Math.max(0, this.remaining()) * 1000);
      this.frameTimer = setTimeout(() => { if (this.videoElement.readyState < 2) { this.stop(); this.onStatus("The video feed did not arrive. Continue with captions."); } }, 20000);
      this.heartbeat = setInterval(() => {
        if (this.remaining() <= 0) { this.endAtDeadline(); return; }
        if (this.socket?.readyState === WebSocket.OPEN) {
          try { this.socket.send(JSON.stringify({ type: "session.keep_alive", event_id: crypto.randomUUID() })); }
          catch { this.stop(); this.onStatus("The video connection ended. Continue with captions."); }
        }
      }, 30000);
    } catch {
      if (generation !== this.generation) return;
      this.stop(); this.onStatus("Live video could not connect. Continue with the illustrated patient, captions, and text.");
    } finally {
      if (generation === this.generation) { this.starting = false; this.changed(); }
    }
  }

  openSocket(url, generation) {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url); this.socket = socket;
      let ready = false;
      const timeout = setTimeout(() => reject(new Error("Video transport timed out.")), 15000);
      this.socketReadyCleanup = () => { clearTimeout(timeout); if (!ready) reject(new Error("Video transport ended.")); };
      socket.onmessage = ({ data }) => {
        if (!this.stillCurrent(generation) || typeof data !== "string" || data.length > 1048576) return;
        let event; try { event = JSON.parse(data); } catch { return; }
        if (event.type === "session.state_updated" && event.state === "connected") { ready = true; clearTimeout(timeout); this.socketReadyCleanup = null; resolve(); }
        if (event.type === "session.state_updated" && event.state === "disconnected" && ready) { this.stop(); this.onStatus("The video transport ended. Continue with ElevenLabs voice, illustration, and captions."); return; }
        // The provider's event_id identifies its response. source_event_id is
        // the first-chunk ID that identifies OUR utterance. An old completion
        // must never finish a later reply or reopen the learner's microphone.
        const matched = this.utterance?.id && event.source_event_id === this.utterance.id;
        if (event.type === "agent.speak_started" && matched) { this.speaking = true; this.changed(); this.onStatus("The live avatar is speaking with ElevenLabs voice. Stop response to interrupt."); }
        if (event.type === "agent.speak_ended" && matched) { this.settleUtterance(); this.onStatus("Live video reply finished. Captions remain available."); }
        if (event.type === "agent.speak_interrupted" && matched) { this.settleUtterance(new Error("Video reply interrupted.")); this.onStatus("Video reply stopped. Captions remain available."); }
        if (event.type === "error") {
          if (!ready) { clearTimeout(timeout); reject(new Error("Video renderer unavailable.")); }
          else if (!event.source_event_id || matched) { this.stop(); this.onStatus("The live avatar could not finish the reply. Continue with ElevenLabs voice, illustration, and captions; listening stays paused until you resume it."); }
        }
      };
      socket.onerror = () => {
        if (!ready) { clearTimeout(timeout); reject(new Error("Video transport unavailable.")); }
        else if (this.stillCurrent(generation)) { this.stop(); this.onStatus("The video connection failed. Continue with ElevenLabs voice and captions."); }
      };
      socket.onclose = () => {
        clearTimeout(timeout);
        if (!ready) reject(new Error("Video transport ended."));
        if (this.stillCurrent(generation)) { this.stop(); this.onStatus("The video connection ended. Continue with ElevenLabs voice, illustration, and captions; choose Resume listening if it was paused."); }
      };
    });
  }

  async allowPlayback() {
    if (!this.room || !this.active) return;
    try {
      await Promise.all([this.room.startAudio(), this.room.startVideo()]);
      this.needsPlayback = !this.room.canPlaybackAudio || !this.room.canPlaybackVideo;
      this.changed();
      this.onStatus(this.needsPlayback ? "This browser blocked playback. Continue with captions." : "Video and patient audio playback are enabled.");
    } catch { this.needsPlayback = true; this.changed(); this.onStatus("This browser blocked playback. Continue with captions."); }
  }

  interrupt() {
    if (this.streamingOperation) {
      this.streamingOperation.signal?.removeEventListener("abort", this.streamingOperation.onAbort);
      this.streamingOperation = null;
    }
    this.speechGeneration += 1; this.audioController?.abort(); this.audioController = null;
    this.settleUtterance(new Error("Video reply stopped."));
    if (this.socket?.readyState === WebSocket.OPEN) {
      try { this.socket.send(JSON.stringify({ type: "agent.interrupt", event_id: crypto.randomUUID() })); }
      catch { this.stop(); this.onStatus("The video connection ended. Continue with captions."); }
    }
    this.speaking = false; this.changed();
  }

  beginStreaming(frame, { signal } = {}) {
    if (!this.active || this.socket?.readyState !== WebSocket.OPEN || this.remaining() <= 0 || signal?.aborted) throw new Error("Live video is unavailable.");
    if (this.needsPlayback) throw new Error("Allow video playback before replaying the reply.");
    if (frame.format !== "pcm_s16le" || frame.sample_rate !== 24000 || frame.channels !== 1 || typeof frame.utterance_id !== "string") throw new Error("Unexpected audio format.");
    this.interrupt();
    const operation = { generation: this.generation, speechGeneration: this.speechGeneration, id: frame.utterance_id, signal, ended: false };
    let resolve, reject; operation.finished = new Promise((yes, no) => { resolve = yes; reject = no; }); operation.finished.catch(() => {});
    operation.onAbort = () => { if (this.streamingOperation === operation) this.interrupt(); };
    signal?.addEventListener("abort", operation.onAbort, { once: true });
    this.streamingOperation = operation;
    this.utterance = { id: operation.id, resolve, reject, timer: setTimeout(() => {
      if (this.streamingOperation !== operation) return;
      this.stop(); this.onStatus("The video reply timed out. Continue with voice and captions.");
    }, Math.min(90000, this.remaining() * 1000)) };
    this.speaking = true; this.changed(); this.onStatus("ElevenLabs audio is streaming to the live avatar. Speak to interrupt.");
  }

  streamingCurrent(operation) {
    return this.streamingOperation === operation && this.stillCurrent(operation.generation) && operation.speechGeneration === this.speechGeneration && !operation.signal?.aborted && this.socket?.readyState === WebSocket.OPEN;
  }

  async pushStreaming(audio) {
    const operation = this.streamingOperation;
    if (!operation || operation.ended || !this.streamingCurrent(operation)) throw new Error("Video reply stopped.");
    if (typeof audio !== "string" || audio.length > 11000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(audio)) throw new Error("Unexpected audio chunk.");
    const deadline = Date.now() + 5000;
    while (this.socket.bufferedAmount > 250000) {
      if (!this.streamingCurrent(operation) || Date.now() > deadline) throw new Error("Audio transport interrupted.");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!this.streamingCurrent(operation)) throw new Error("Video reply stopped.");
    this.socket.send(JSON.stringify({ type: "agent.speak", event_id: operation.id, audio }));
  }

  async finishStreaming() {
    const operation = this.streamingOperation;
    if (!operation || operation.ended || !this.streamingCurrent(operation)) throw new Error("Video reply stopped.");
    operation.ended = true;
    this.socket.send(JSON.stringify({ type: "agent.speak_end", event_id: operation.id }));
    try { await operation.finished; }
    finally {
      operation.signal?.removeEventListener("abort", operation.onAbort);
      if (this.streamingOperation === operation) this.streamingOperation = null;
    }
  }

  async speak(eventId, { signal } = {}) {
    if (!this.active || this.socket?.readyState !== WebSocket.OPEN || this.remaining() <= 0) throw new Error("Live video is unavailable.");
    if (this.needsPlayback) throw new Error("Allow video playback before replaying the reply.");
    if (signal?.aborted) throw new Error("Video reply stopped.");
    this.interrupt(); const generation = this.generation; const speechGeneration = this.speechGeneration;
    const controller = new AbortController(); this.audioController = controller;
    const onAbort = () => { if (generation === this.generation && speechGeneration === this.speechGeneration) this.interrupt(); };
    signal?.addEventListener("abort", onAbort, { once: true });
    let resolveSpeech, rejectSpeech;
    const finished = new Promise((resolve, reject) => { resolveSpeech = resolve; rejectSpeech = reject; });
    // Cancellation can arrive while the HTTP audio request is pending.
    finished.catch(() => {});
    this.utterance = { id: null, resolve: resolveSpeech, reject: rejectSpeech, timer: null };
    this.speaking = true; this.changed(); this.onStatus("Preparing ElevenLabs voice for the live avatar…");
    try {
      const packet = await this.request("/video/audio", { method: "POST", body: { event_id: eventId }, signal: controller.signal, timeout: 28000 });
      if (!this.stillCurrent(generation) || speechGeneration !== this.speechGeneration) throw new Error("Video reply stopped.");
      this.limitDeadline(packet.deadline);
      if (!this.stillCurrent(generation)) throw new Error("Video reply stopped.");
      if (packet.format !== "pcm_s16le" || packet.sample_rate !== 24000 || packet.channels !== 1 || !Array.isArray(packet.chunks) || !packet.chunks.length || packet.chunks.length > 30 || typeof packet.utterance_id !== "string") throw new Error("Unexpected audio format.");
      this.utterance.id = packet.utterance_id;
      this.utterance.timer = setTimeout(() => {
        if (generation !== this.generation || speechGeneration !== this.speechGeneration) return;
        this.stop(); this.onStatus("The video reply timed out. Continue with ElevenLabs voice and captions; choose Resume listening when ready.");
      }, Math.min(90000, this.remaining() * 1000));
      for (const chunk of packet.chunks) {
        if (typeof chunk !== "string" || chunk.length > 100000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(chunk)) throw new Error("Unexpected audio chunk.");
        const bufferDeadline = Date.now() + 5000;
        while (this.socket?.readyState === WebSocket.OPEN && this.socket.bufferedAmount > 250000) {
          if (!this.stillCurrent(generation) || speechGeneration !== this.speechGeneration || Date.now() > bufferDeadline) throw new Error("Audio transport interrupted.");
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        if (!this.stillCurrent(generation) || speechGeneration !== this.speechGeneration || this.socket?.readyState !== WebSocket.OPEN) throw new Error("Video reply stopped.");
        this.socket.send(JSON.stringify({ type: "agent.speak", event_id: packet.utterance_id, audio: chunk }));
      }
      this.socket.send(JSON.stringify({ type: "agent.speak_end", event_id: packet.utterance_id }));
      this.onStatus("The live avatar is preparing this reply. Listening stays paused until the video audio finishes.");
      await finished;
    } catch {
      if (this.stillCurrent(generation) && !controller.signal.aborted && speechGeneration === this.speechGeneration && !this.needsPlayback) {
        this.stop(); this.onStatus("The live avatar could not finish this reply. Continue with ElevenLabs voice, illustration, and captions; listening stays paused until you resume it.");
      }
      const error = new Error("Live video reply did not finish. Read the captions or replay with voice.");
      // A local interrupt keeps the same video session and only advances its
      // speech generation. Session failures/expiry advance the session too.
      if (generation === this.generation && speechGeneration !== this.speechGeneration) error.kind = "video-interrupted";
      throw error;
    } finally { signal?.removeEventListener("abort", onAbort); if (this.audioController === controller) this.audioController = null; }
  }

  stop({ notifyServer = true, keepalive = false } = {}) {
    if (this.streamingOperation) {
      this.streamingOperation.signal?.removeEventListener("abort", this.streamingOperation.onAbort);
      this.streamingOperation = null;
    }
    this.generation += 1; this.speechGeneration += 1;
    this.audioController?.abort(); this.audioController = null;
    this.settleUtterance(new Error("Video session ended."));
    clearTimeout(this.deadlineTimer); clearTimeout(this.frameTimer); clearInterval(this.heartbeat);
    this.deadlineTimer = null; this.frameTimer = null; this.heartbeat = null;
    this.socketReadyCleanup?.(); this.socketReadyCleanup = null;
    if (this.socket) {
      this.socket.onmessage = null; this.socket.onerror = null; this.socket.onclose = null;
      try { if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) this.socket.close(); } catch {}
      this.socket = null;
    }
    this.tracks.forEach((track) => { try { track.detach(); } catch {} try { track.mediaStreamTrack?.stop(); } catch {} }); this.tracks.clear();
    this.videoElement.onloadeddata = null; this.videoElement.pause(); this.videoElement.srcObject = null;
    this.audioContainer.querySelectorAll("audio").forEach((element) => { element.pause(); element.srcObject = null; element.remove(); });
    if (this.room) { try { this.room.removeAllListeners(); Promise.resolve(this.room.disconnect(true)).catch(() => {}); } catch {} this.room = null; }
    this.active = false; this.starting = false; this.visual = false; this.speaking = false; this.needsPlayback = false; this.changed();
    if (notifyServer && this.serverAttempted && !this.serverStopped) {
      this.serverStopped = true;
      this.stopPromise = this.request("/video/stop", { method: "POST", keepalive, timeout: 10000 }).catch(() => {
        if (!keepalive) this.onStatus("Video closed locally. The server also limits it to the encounter deadline.");
      });
    }
    return this.stopPromise || Promise.resolve();
  }
}
