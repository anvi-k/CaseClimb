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
  }

  changed() { this.onChange(this); }
  remaining() { return Math.max(0, Math.min(this.secondsRemaining(), this.deadline ? (this.deadline * 1000 - this.serverNow()) / 1000 : Infinity)); }
  stillCurrent(generation) { return generation === this.generation && this.remaining() > 0; }
  limitDeadline(deadline) {
    if (!Number.isFinite(deadline)) return;
    this.deadline = Math.min(this.deadline || Infinity, deadline);
    if (this.active || this.starting) {
      clearTimeout(this.deadlineTimer);
      this.deadlineTimer = setTimeout(() => { this.stop(); this.onStatus("The video session ended. Captions remain available."); }, this.remaining() * 1000);
    }
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
            this.onStatus("Live video connected. Replies use the recorded patient response; captions remain available.");
          };
          this.videoElement.play().catch(() => { if (this.stillCurrent(generation)) { this.needsPlayback = true; this.changed(); } });
        } else if (track.kind === sdk.Track.Kind.Audio) {
          const element = track.attach(); element.autoplay = true;
          this.audioContainer.append(element);
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
        if (this.stillCurrent(generation)) { this.stop(); this.onStatus("The video connection ended. Continue with captions and text."); }
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
      this.deadlineTimer = setTimeout(() => { this.stop(); this.onStatus("The video session ended with the encounter. Captions remain available."); }, Math.max(0, this.remaining()) * 1000);
      this.frameTimer = setTimeout(() => { if (this.videoElement.readyState < 2) { this.stop(); this.onStatus("The video feed did not arrive. Continue with captions."); } }, 20000);
      this.heartbeat = setInterval(() => {
        if (this.remaining() <= 0) { this.stop(); return; }
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
      socket.onmessage = ({ data }) => {
        if (!this.stillCurrent(generation) || typeof data !== "string" || data.length > 1048576) return;
        let event; try { event = JSON.parse(data); } catch { return; }
        if (event.type === "session.state_updated" && event.state === "connected") { ready = true; clearTimeout(timeout); resolve(); }
        if (event.type === "agent.speak_started") { this.speaking = true; this.changed(); this.onStatus("The video patient is speaking. Stop response to interrupt."); }
        if (event.type === "agent.speak_ended" || event.type === "agent.speak_interrupted") { this.speaking = false; this.changed(); this.onStatus("Patient response finished. Captions remain available."); }
        if (event.type === "error") {
          if (!ready) { clearTimeout(timeout); reject(new Error("Video renderer unavailable.")); }
          else { this.interrupt(); this.onStatus("The video renderer could not complete this response. Continue reading the captions."); }
        }
      };
      socket.onerror = () => { if (!ready) { clearTimeout(timeout); reject(new Error("Video transport unavailable.")); } };
      socket.onclose = () => {
        clearTimeout(timeout);
        if (!ready) reject(new Error("Video transport ended."));
        if (this.stillCurrent(generation)) { this.stop(); this.onStatus("The video connection ended. Continue with captions."); }
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
    this.speechGeneration += 1; this.audioController?.abort(); this.audioController = null;
    if (this.socket?.readyState === WebSocket.OPEN) {
      try { this.socket.send(JSON.stringify({ type: "agent.interrupt", event_id: crypto.randomUUID() })); }
      catch { this.stop(); this.onStatus("The video connection ended. Continue with captions."); }
    }
    this.speaking = false; this.changed();
  }

  async speak(eventId) {
    if (!this.active || this.socket?.readyState !== WebSocket.OPEN || this.remaining() <= 0) return;
    this.interrupt(); const generation = this.generation; const speechGeneration = this.speechGeneration;
    const controller = new AbortController(); this.audioController = controller;
    this.speaking = true; this.changed(); this.onStatus("Preparing the recorded patient response for video…");
    try {
      const packet = await this.request("/video/audio", { method: "POST", body: { event_id: eventId }, signal: controller.signal, timeout: 28000 });
      if (!this.stillCurrent(generation) || speechGeneration !== this.speechGeneration) return;
      this.limitDeadline(packet.deadline);
      if (!this.stillCurrent(generation)) return;
      if (packet.format !== "pcm_s16le" || packet.sample_rate !== 24000 || packet.channels !== 1 || !Array.isArray(packet.chunks) || !packet.chunks.length || packet.chunks.length > 30 || typeof packet.utterance_id !== "string") throw new Error("Unexpected audio format.");
      for (const chunk of packet.chunks) {
        if (typeof chunk !== "string" || chunk.length > 100000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(chunk)) throw new Error("Unexpected audio chunk.");
        const bufferDeadline = Date.now() + 5000;
        while (this.socket?.readyState === WebSocket.OPEN && this.socket.bufferedAmount > 250000) {
          if (!this.stillCurrent(generation) || speechGeneration !== this.speechGeneration || Date.now() > bufferDeadline) throw new Error("Audio transport interrupted.");
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        if (!this.stillCurrent(generation) || speechGeneration !== this.speechGeneration || this.socket?.readyState !== WebSocket.OPEN) return;
        this.socket.send(JSON.stringify({ type: "agent.speak", event_id: packet.utterance_id, audio: chunk }));
      }
      this.socket.send(JSON.stringify({ type: "agent.speak_end", event_id: packet.utterance_id }));
      this.onStatus("Patient response sent to the video renderer. Captions remain available.");
    } catch {
      if (!this.stillCurrent(generation) || controller.signal.aborted || speechGeneration !== this.speechGeneration) return;
      this.interrupt(); this.onStatus("The patient response could not be rendered as video. Continue with captions.");
    } finally { if (this.audioController === controller) this.audioController = null; }
  }

  stop({ notifyServer = true, keepalive = false } = {}) {
    this.generation += 1; this.speechGeneration += 1;
    this.audioController?.abort(); this.audioController = null;
    clearTimeout(this.deadlineTimer); clearTimeout(this.frameTimer); clearInterval(this.heartbeat);
    this.deadlineTimer = null; this.frameTimer = null; this.heartbeat = null;
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
