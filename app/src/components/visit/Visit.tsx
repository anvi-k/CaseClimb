"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Logo } from "@/components/Brand";
import JourneyChartTab from "@/components/journey/JourneyChartTab";
import type { ChartView } from "@/lib/engine/encounter";
import ChartPanel from "./ChartPanel";

interface Msg {
  id: number;
  turn: number;
  speaker: "student" | "patient" | "system" | "instructor" | "coach" | "clinician";
  text: string;
}
interface VisitData {
  id: string;
  status: "active" | "paused" | "submitted" | "scored" | "abandoned";
  mode: string;
  attempt: number;
  visitNumber: number;
  recorded: boolean;
  level: number;
  hints: boolean;
  canRewind: boolean;
  liveAssist: boolean;
  timeLimitMin: number | null;
  startedAt: string;
  pauseNote: string | null;
  pausedAt: string | null;
  role: { name: string; roleTitle: string; noteFormat: string; wrapUp: { id: string; label: string; placeholder?: string }[] };
  journeyRunId: string | null;
  priorContext: string | null;
  chart: ChartView;
  messages: Msg[];
}

// How long the student must stop talking before their turn is sent.
const SILENCE_MS = 2500;
// Goals shown in the waiting room before "Show all".
const GOALS_SHOWN = 3;

// Minimal typing for the browser speech recognition API (Chrome, Edge, Safari).
interface SpeechRec {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: { length: number; [i: number]: { isFinal: boolean; 0: { transcript: string } } } }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}

const MODE_LABEL: Record<string, string> = { practice: "Practice", adaptive: "Adaptive practice", homework: "Homework", exam: "Exam", journey: "Care journey" };
const fmt = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, s) % 60).padStart(2, "0")}`;
const initials = (n: string) => n.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const stripCues = (t: string) => t.replace(/\*[^*]*\*/g, " ").replace(/\s+/g, " ").trim();

function Icon({ d, className = "h-5 w-5" }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={d} />
    </svg>
  );
}
const ICON = {
  mic: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3ZM5 11a7 7 0 0 0 14 0M12 18v3",
  micOff: "M3 3l18 18M9 9v3a3 3 0 0 0 5.1 2.1M15 11V6a3 3 0 0 0-5.7-1.3M5 11a7 7 0 0 0 11.4 5.4M19 11a7 7 0 0 1-.5 2.6M12 18v3",
  cam: "M3 7h11a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1ZM15 10l6-3v10l-6-3",
  camOff: "M3 3l18 18M15 10l6-3v10l-3.5-1.75M10 7h4a1 1 0 0 1 1 1v4M15 15.5V16a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h3.5",
  vol: "M4 9v6h4l5 4V5L8 9H4ZM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12",
  volOff: "M4 9v6h4l5 4V5L8 9H4ZM17 9l5 6M22 9l-5 6",
  cc: "M3 6h18v12H3zM7.5 13.5a2 2 0 1 1 0-3M14.5 13.5a2 2 0 1 1 0-3",
  hang: "M3 14c5-5 13-5 18 0l-2 3-4-1.5v-2.2a9 9 0 0 0-6 0v2.2L5 17l-2-3Z",
};

export default function Visit({ id, viewerName }: { id: string; viewerName: string }) {
  const router = useRouter();
  const [data, setData] = useState<VisitData | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [chart, setChart] = useState<ChartView | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<string | null>(null); // patient reply being streamed
  const [busy, setBusy] = useState(false);
  const [ordering, setOrdering] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [joined, setJoined] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [micSupported, setMicSupported] = useState(true);
  const [interim, setInterim] = useState("");
  const [speakerOn, setSpeakerOn] = useState(true);
  const [captionsOn, setCaptionsOn] = useState(true);
  const [camOn, setCamOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [wrapOpen, setWrapOpen] = useState(false);
  const [wrap, setWrap] = useState<Record<string, string>>({});
  const [scoring, setScoring] = useState(false);
  const [lastDelta, setLastDelta] = useState(0);
  const [recTick, setRecTick] = useState(0);
  const [endClickedAt, setEndClickedAt] = useState<number | null>(null);
  const [allGoals, setAllGoals] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recRef = useRef<SpeechRec | null>(null);
  const selfRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);
  const live = useRef({ busy: false });
  live.current = { busy };

  const load = useCallback(async () => {
    const res = await fetch(`/api/encounters/${id}`, { cache: "no-store" });
    if (!res.ok) return setError((await res.json().catch(() => ({}))).error || "Could not load this visit.");
    const d: VisitData = await res.json();
    setData(d);
    setChart((c) => (live.current.busy && c ? c : d.chart));
    // Keep optimistic local messages while a turn is in flight.
    setMessages((m) => (live.current.busy ? m : d.messages));
    if (d.messages.length) setJoined(true);
    return d;
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Live assist: the instructor may pause or send a note at any time.
  useEffect(() => {
    if (!data?.liveAssist || data.status === "scored") return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [data?.liveAssist, data?.status, load]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, pending]);
  useEffect(() => {
    setMicSupported(typeof window !== "undefined" && ("SpeechRecognition" in window || "webkitSpeechRecognition" in window));
  }, []);

  const paused = data?.status === "paused";
  const ended = data?.status === "submitted" || data?.status === "scored";
  const utc = (t: string) => new Date(t.replace(" ", "T") + "Z").getTime();
  // The clock does not run in the waiting room, while an instructor has the visit paused, or once
  // the student has clicked End visit (it resumes if they go back to the patient).
  const clockNow = data?.pausedAt ? utc(data.pausedAt) : endClickedAt ?? now;
  const elapsed = data && joined ? Math.max(0, Math.floor((clockNow - utc(data.startedAt)) / 1000)) : 0;
  const remaining = data?.timeLimitMin ? data.timeLimitMin * 60 - elapsed : null;

  // When the clock runs out, open the write-up; the student can still go back for a closing sentence.
  const timeUp = remaining !== null && remaining <= 0;
  useEffect(() => {
    if (timeUp && joined && !ended) setWrapOpen(true);
  }, [timeUp, joined, ended]);
  useEffect(() => {
    if (wrapOpen) setEndClickedAt((t) => t ?? Date.now());
    else if (!scoring && !ended) setEndClickedAt(null);
  }, [wrapOpen, scoring, ended]);

  // Speech is synthesised sentence by sentence so the patient starts talking while the reply is still arriving.
  const voice = useRef<{ gen: number; queue: Promise<string | null>[]; playing: boolean }>({ gen: 0, queue: [], playing: false });
  function stopVoice() {
    voice.current.gen += 1;
    voice.current.queue = [];
    voice.current.playing = false;
    audioRef.current?.pause();
    setSpeaking(false);
  }
  function pump() {
    const v = voice.current;
    if (v.playing) return;
    const next = v.queue.shift();
    if (!next) return setSpeaking(false);
    v.playing = true;
    setSpeaking(true);
    const gen = v.gen;
    next.then((url) => {
      if (gen !== voice.current.gen) return;
      const a = audioRef.current;
      if (!url || !a) {
        v.playing = false;
        return pump();
      }
      a.src = url;
      a.play().catch(() => {
        v.playing = false;
        pump();
      });
    });
  }
  function speak(text: string) {
    if (!speakerOn || !text.replace(/\*[^*]*\*/g, "").trim()) return;
    const gen = voice.current.gen;
    voice.current.queue.push(
      fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ e: id, text }) })
        .then((r) => (r.ok && r.status !== 204 ? r.blob() : null))
        .then((b) => (b && gen === voice.current.gen ? URL.createObjectURL(b) : null))
        .catch(() => null),
    );
    pump();
  }
  function onAudioDone() {
    voice.current.playing = false;
    pump();
  }

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || live.current.busy) return;
      setError(null);
      setBusy(true);
      setInput("");
      setInterim("");
      stopVoice();
      const turn = (chart?.turn || 0) + 1;
      setMessages((m) => [...m, { id: -Date.now(), turn, speaker: "student", text }]);
      setPending("");
      try {
        const res = await fetch(`/api/encounters/${id}/message`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
        if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error || "The message could not be sent.");
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        let acc = "";
        let spokenTo = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const line = buf.slice(0, i).trim();
            buf = buf.slice(i + 2);
            if (!line.startsWith("data:")) continue;
            const ev = JSON.parse(line.slice(5));
            if (ev.type === "delta") {
              acc += ev.text;
              setPending(acc);
              // Hand each finished sentence to the voice as soon as it is complete.
              const rest = acc.slice(spokenTo);
              const m = rest.match(/^[\s\S]*[.!?]["']?(?=\s)/);
              if (m && m[0].trim().length > 12) {
                speak(m[0]);
                spokenTo += m[0].length;
              }
            } else if (ev.type === "done") {
              setMessages((m) => [...m, { id: ev.messageId, turn, speaker: "patient", text: ev.text }, ...(ev.notice ? [{ id: ev.messageId + 0.5, turn, speaker: "system" as const, text: ev.notice }] : [])]);
              setPending(null);
              const before = new Set([...(chart?.sections.flatMap((s) => s.items.map((x) => x.id)) || []), ...(chart?.artifacts.map((a) => a.id) || [])]);
              const after: ChartView = ev.chart;
              setFresh(new Set([...after.sections.flatMap((s) => s.items.map((x) => x.id)), ...after.artifacts.map((a) => a.id)].filter((x) => !before.has(x))));
              setChart(after);
              setLastDelta(ev.rapportDelta);
              speak(acc.slice(spokenTo));
            } else if (ev.type === "error") {
              throw new Error(ev.message);
            }
          }
        }
      } catch (e) {
        setPending(null);
        setMessages((m) => m.filter((x) => x.id > 0));
        setInput(text);
        setError((e as Error).message);
        load();
      } finally {
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, chart, speakerOn],
  );

  // Hands-free mic: listen whenever the patient is not talking and nothing is in flight.
  useEffect(() => {
    const idle = micOn && joined && !busy && !speaking && !paused && !ended && !wrapOpen;
    if (!idle) return;
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "en-US";
    // Keep listening through short pauses; the turn is sent only after SILENCE_MS without speech.
    rec.continuous = true;
    rec.interimResults = true;
    let finalText = "";
    let quiet: ReturnType<typeof setTimeout> | null = null;
    rec.onresult = (e) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
        else live += e.results[i][0].transcript;
      }
      setInterim(finalText + live);
      if (quiet) clearTimeout(quiet);
      if ((finalText + live).trim()) quiet = setTimeout(() => rec.stop(), SILENCE_MS);
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        setMicOn(false);
        setError("Microphone access was blocked. Allow it in the browser, or type instead.");
      }
    };
    rec.onend = () => {
      if (quiet) clearTimeout(quiet);
      recRef.current = null;
      if (finalText.trim()) send(finalText);
      // Silence timed out: start listening again.
      else setRecTick((n) => n + 1);
    };
    recRef.current = rec;
    try {
      rec.start();
    } catch {}
    return () => {
      if (quiet) clearTimeout(quiet);
      rec.onend = null;
      rec.abort();
      recRef.current = null;
    };
  }, [micOn, joined, busy, speaking, paused, ended, wrapOpen, send, recTick]);

  async function toggleCam() {
    if (camOn) {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setCamOn(false);
      return;
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 } });
      streamRef.current = s;
      setCamOn(true);
      setTimeout(() => {
        if (selfRef.current) selfRef.current.srcObject = s;
      }, 0);
    } catch {
      setError("Camera access was blocked. The visit works without it.");
    }
  }
  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);

  async function order(request: string) {
    setOrdering(true);
    setError(null);
    try {
      const res = await fetch(`/api/encounters/${id}/action`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ request }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error);
      const before = new Set([...(chart?.results.map((r) => r.id) || []), ...(chart?.artifacts.map((a) => a.id) || [])]);
      setFresh(new Set([...j.chart.results.map((r: { id: string }) => r.id), ...j.chart.artifacts.map((a: { id: string }) => a.id)].filter((x: string) => !before.has(x))));
      setChart(j.chart);
      const d = await load();
      if (d) setMessages(d.messages);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOrdering(false);
    }
  }

  async function askHint() {
    const res = await fetch(`/api/encounters/${id}/hint`, { method: "POST" });
    const j = await res.json();
    if (j.text) setMessages((m) => [...m, { id: Date.now(), turn: chart?.turn || 0, speaker: "coach", text: j.text }]);
  }

  async function rewindTo(turn: number) {
    if (!confirm("Go back to just before this message and try it a different way? Your current visit stays saved.")) return;
    const res = await fetch(`/api/encounters/${id}/rewind`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ turn }) });
    const j = await res.json();
    if (j.id) router.push(`/encounter/${j.id}`);
    else setError(j.error || "Could not rewind.");
  }

  async function submit() {
    setScoring(true);
    setMicOn(false);
    stopVoice();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    try {
      const res = await fetch(`/api/encounters/${id}/submit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wrapup: wrap }) });
      const j = await res.json();
      if (j.error) throw new Error(j.error);
      router.push(data?.journeyRunId ? `/journey/${data.journeyRunId}` : `/encounter/${id}/feedback`);
    } catch (e) {
      setScoring(false);
      setError("Scoring did not finish: " + (e as Error).message + " Your visit and notes are saved; try again.");
    }
  }

  if (error && !data) return <div className="grid h-screen place-items-center text-slate-600">{error}</div>;
  if (!data || !chart) return <div className="grid h-screen place-items-center text-slate-500">Connecting to the visit…</div>;
  if (ended && !scoring) {
    return (
      <div className="grid h-screen place-items-center">
        <div className="text-center">
          <p className="mb-3 text-slate-700">This visit has ended.</p>
          <a href={data.journeyRunId ? `/journey/${data.journeyRunId}` : `/encounter/${id}/feedback`} className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white">
            {data.status === "scored" ? "View feedback" : "Finish scoring"}
          </a>
        </div>
      </div>
    );
  }

  const p = chart.patient;
  const caption = pending !== null ? pending : speaking ? [...messages].reverse().find((m) => m.speaker === "patient")?.text || "" : "";
  const patientTalking = speaking || (pending !== null && pending.length > 0);
  const firstName = p.name.split(" ")[0];

  return (
    <div className="flex h-screen flex-col bg-slate-200">
      <audio ref={audioRef} onEnded={onAudioDone} onError={onAudioDone} hidden />

      {/* Top bar */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-slate-300 bg-white px-4 text-sm">
        <a href="/"><Logo compact /></a>
        <span className="text-slate-300">|</span>
        <span className="truncate text-slate-700">
          Video visit with <span className="font-medium text-slate-900">{p.name}</span>
        </span>
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[14px] font-medium text-slate-600">{MODE_LABEL[data.mode] || data.mode}</span>
        <span className="hidden rounded bg-slate-100 px-1.5 py-0.5 text-[14px] text-slate-600 sm:inline">Level {data.level}</span>
        {data.visitNumber > 1 ? <span className="hidden rounded bg-sky-100 px-1.5 py-0.5 text-[14px] font-medium text-sky-800 sm:inline">Follow-up · visit {data.visitNumber}</span> : data.attempt > 1 && <span className="hidden rounded bg-slate-100 px-1.5 py-0.5 text-[14px] text-slate-600 sm:inline">Attempt {data.attempt}</span>}
        <span className={`hidden rounded px-1.5 py-0.5 text-[14px] font-medium md:inline ${data.recorded ? "bg-violet-100 text-violet-800" : "bg-slate-100 text-slate-600"}`}>{data.recorded ? "Recorded for instructor" : "Private practice"}</span>
        {data.liveAssist && <span className="hidden rounded bg-violet-100 px-1.5 py-0.5 text-[14px] font-medium text-violet-800 md:inline">Instructor can join</span>}
        <div className="flex-1" />
        <span className={`tabular-nums ${remaining !== null && remaining < 120 ? "font-semibold text-rose-600" : "text-slate-600"}`}>{remaining !== null ? `${fmt(remaining)} left` : fmt(elapsed)}</span>
        {data.hints && joined && (
          <button onClick={askHint} disabled={busy} className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100">
            Coach hint
          </button>
        )}
        <button onClick={() => setWrapOpen(true)} disabled={!joined} className="rounded-md bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700 disabled:bg-slate-300">
          End visit
        </button>
      </header>

      <div className="grid min-h-0 flex-1 gap-3 p-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        {/* LEFT: the call */}
        <div className="flex min-h-0 flex-col gap-3">
          <div className="relative h-[44%] min-h-[220px] shrink-0 overflow-hidden rounded-lg bg-slate-900">
            {p.portrait ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.portrait} alt={p.name} className={`h-full w-full object-cover object-[50%_30%] transition-transform duration-700 ${patientTalking ? "scale-[1.02]" : ""}`} />
            ) : (
              <div className="grid h-full place-items-center bg-gradient-to-br from-slate-700 to-slate-900">
                <div className={`grid h-28 w-28 place-items-center rounded-full bg-brand-600 text-4xl font-semibold text-white ${patientTalking ? "ring-4 ring-emerald-400/70" : ""}`}>{initials(p.name)}</div>
              </div>
            )}
            <div className={`pointer-events-none absolute inset-0 rounded-lg transition-shadow ${patientTalking ? "shadow-[inset_0_0_0_3px_rgba(52,211,153,0.9)]" : ""}`} />
            <div className="absolute left-3 top-3 flex items-center gap-2">
              <span className="flex items-center gap-1.5 rounded bg-black/55 px-2 py-1 text-[14px] font-medium text-white">
                <span className="h-1.5 w-1.5 rounded-full bg-rose-500" /> LIVE
              </span>
              {chart.rapport !== null && joined && (
                <span className="flex items-center gap-2 rounded bg-black/55 px-2 py-1 text-[14px] text-white" title="How comfortable the patient is with you. Shown in practice only.">
                  Comfort
                  <span className="h-1.5 w-20 overflow-hidden rounded-full bg-white/25">
                    <span className={`block h-full rounded-full transition-all duration-700 ${chart.rapport >= 60 ? "bg-emerald-400" : chart.rapport >= 40 ? "bg-amber-400" : "bg-rose-400"}`} style={{ width: `${chart.rapport}%` }} />
                  </span>
                  {lastDelta !== 0 && <span className={lastDelta > 0 ? "text-emerald-300" : "text-rose-300"}>{lastDelta > 0 ? "+" : ""}{lastDelta}</span>}
                </span>
              )}
            </div>
            {/* Self view */}
            <div className="absolute right-3 top-3 h-20 w-28 overflow-hidden rounded-md border border-white/20 bg-slate-800">
              {camOn ? <video ref={selfRef} autoPlay muted playsInline className="h-full w-full -scale-x-100 object-cover" /> : <div className="grid h-full place-items-center text-lg font-semibold text-slate-400">{initials(viewerName)}</div>}
              <span className="absolute bottom-0.5 left-1 text-[14px] text-white/80">You</span>
            </div>
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/50 to-transparent px-4 pb-3 pt-10">
              {captionsOn && caption && <p className="mb-2 text-[16px] leading-snug text-white">{(() => { const t = stripCues(caption); return t.length > 190 ? "… " + t.slice(t.length - 190).replace(/^\S*\s/, "") : t || "…"; })()}</p>}
              {micOn && !patientTalking && !busy && <p className="mb-2 text-sm italic text-emerald-200">{interim ? `You: ${interim}` : "Listening… speak to the patient"}</p>}
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-white">
                  {p.name}
                  <span className="ml-2 text-xs font-normal text-white/70">{patientTalking ? "speaking" : busy ? "thinking…" : chart.emotion}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  {[
                    { on: micOn, set: () => setMicOn((v) => !v), a: ICON.mic, b: ICON.micOff, label: micSupported ? (micOn ? "Mute microphone" : "Talk with your microphone") : "Voice input needs Chrome, Edge or Safari", disabled: !micSupported },
                    { on: camOn, set: toggleCam, a: ICON.cam, b: ICON.camOff, label: camOn ? "Turn camera off" : "Turn camera on" },
                    { on: speakerOn, set: () => (setSpeakerOn((v) => !v), stopVoice()), a: ICON.vol, b: ICON.volOff, label: speakerOn ? "Mute patient voice" : "Hear the patient" },
                    { on: captionsOn, set: () => setCaptionsOn((v) => !v), a: ICON.cc, b: ICON.cc, label: captionsOn ? "Hide captions" : "Show captions" },
                  ].map((c, i) => (
                    <button key={i} onClick={c.set} disabled={c.disabled} title={c.label} aria-label={c.label} className={`grid h-9 w-9 place-items-center rounded-full transition-colors disabled:opacity-40 ${c.on ? "bg-white/20 text-white hover:bg-white/30" : "bg-white text-slate-800"}`}>
                      <Icon d={c.on ? c.a : c.b} />
                    </button>
                  ))}
                  <button onClick={() => setWrapOpen(true)} title="End visit" aria-label="End visit" className="grid h-9 w-11 place-items-center rounded-full bg-rose-600 text-white hover:bg-rose-700">
                    <Icon d={ICON.hang} />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Conversation */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-300 bg-white">
            <div ref={logRef} className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-3">
              {messages.length === 0 && <p className="py-6 text-center text-sm text-slate-500">Start by introducing yourself to {firstName}.</p>}
              {messages.map((m) =>
                m.speaker === "student" ? (
                  <div key={m.id} className="group flex justify-end gap-2">
                    {data.canRewind && m.id > 0 && !busy && (
                      <button onClick={() => rewindTo(m.turn - 1)} className="self-center whitespace-nowrap text-[14px] text-slate-400 underline decoration-dotted hover:text-brand-600">
                        Try this again
                      </button>
                    )}
                    <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-brand-600 px-3.5 py-2 text-sm text-white">{m.text}</div>
                  </div>
                ) : m.speaker === "patient" ? (
                  <div key={m.id} className="flex">
                    <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-slate-100 px-3.5 py-2 text-sm text-slate-900">
                      {m.text.split(/(\*[^*]+\*)/).map((part, i) => (part.startsWith("*") ? <em key={i} className="text-slate-500">{part.slice(1, -1)} </em> : <span key={i}>{part}</span>))}
                    </div>
                  </div>
                ) : (
                  <div key={m.id} className={`whitespace-pre-wrap rounded-md border px-3 py-2 text-[16px] ${m.speaker === "coach" ? "border-amber-200 bg-amber-50 text-amber-900" : m.speaker === "instructor" ? "border-violet-200 bg-violet-50 text-violet-900" : "border-slate-200 bg-slate-50 font-mono text-[15px] text-slate-700"}`}>
                    <span className="mr-1.5 font-sans text-[14px] font-semibold uppercase tracking-wide opacity-70">{m.speaker === "coach" ? "Coach:" : m.speaker === "instructor" ? "Instructor" : m.speaker === "clinician" ? "Colleague" : "Chart"}</span>
                    {m.text}
                  </div>
                ),
              )}
              {pending !== null && (
                <div className="flex">
                  <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-slate-100 px-3.5 py-2 text-sm text-slate-900">{stripCues(pending) || <span className="text-slate-400">{firstName} is thinking…</span>}</div>
                </div>
              )}
            </div>
            {error && <div className="border-t border-rose-200 bg-rose-50 px-3 py-1.5 text-xs text-rose-700">{error}</div>}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
              className="flex gap-2 border-t border-slate-200 p-2.5"
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={busy || paused || !joined}
                placeholder={paused ? "Paused by your instructor" : micOn ? "Speak, or type here" : `Say something to ${firstName}`}
                className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:bg-slate-100"
                autoFocus
              />
              <button disabled={busy || paused || !input.trim()} className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:bg-slate-300">
                Send
              </button>
            </form>
          </div>
        </div>

        {/* RIGHT: the chart */}
        <ChartPanel chart={chart} fresh={fresh} onOrder={order} ordering={ordering} locked={paused || !joined} teamTab={data.journeyRunId ? <JourneyChartTab runId={data.journeyRunId} encounterId={id} /> : undefined} />
      </div>

      {/* Waiting room */}
      {!joined && (
        <div className="fixed inset-0 z-20 grid place-items-center bg-slate-900/70 p-4">
          <div className="flex max-h-full w-full max-w-xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">
           <div className="min-h-0 flex-1 overflow-y-auto p-6 pb-2">
            <div className="text-xs font-medium uppercase tracking-wide text-brand-600">Waiting room · {MODE_LABEL[data.mode] || data.mode}</div>
            <h1 className="mt-1 text-xl font-semibold text-slate-900">
              {p.name}, {p.age}
            </h1>
            <p className="mt-4 text-sm leading-relaxed text-slate-700">{chart.brief}</p>
            {chart.tasks.length > 0 && (
              <div className="mt-5 rounded-xl border border-brand-200 border-l-4 border-l-brand-600 bg-brand-50 px-5 py-4">
                <h2 className="text-sm uppercase tracking-wide text-brand-700">Session goals</h2>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-900 marker:text-brand-600">
                  {(allGoals ? chart.tasks : chart.tasks.slice(0, GOALS_SHOWN)).map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
                {chart.tasks.length > GOALS_SHOWN && (
                  <button onClick={() => setAllGoals((v) => !v)} className="mt-1 pl-5 text-xs text-brand-700 underline decoration-dotted">
                    {allGoals ? "Show fewer" : `Show all ${chart.tasks.length}`}
                  </button>
                )}
              </div>
            )}
            <div className="mt-4 rounded-md bg-slate-50 p-3 text-[16px] text-slate-600">
              {data.timeLimitMin ? `You have ${data.timeLimitMin} minutes. ` : "No time limit. "}
              Talk by microphone or type. The chart on the right fills in as you learn things; request exams, tests and records from its Results tab. When you are done, end the visit and write your {data.role.noteFormat} wrap-up.
              {data.mode === "exam" && " This is an exam: no hints, and the comfort meter is hidden."}
              {data.liveAssist && " Your instructor may watch this visit, pause it, or send you a note."}
            </div>
            <p className={`mt-3 text-[16px] ${data.recorded ? "text-violet-800" : "text-slate-600"}`}>
              {data.recorded ? "Recorded: your instructor can see this visit, its transcript and its score." : "Private practice: only you see this visit and its feedback. It still updates your own progress."}
            </p>
           </div>
            <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 px-6 py-4">
              <button
                onClick={() => {
                  fetch(`/api/encounters/${id}/start`, { method: "POST" }).then(load).catch(() => {});
                  setJoined(true);
                  // Unlock audio playback inside the click.
                  audioRef.current?.play().catch(() => {});
                }}
                className="rounded-md bg-brand-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-700"
              >
                Join visit
              </button>
              {micSupported && (
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={micOn} onChange={(e) => setMicOn(e.target.checked)} /> Use my microphone
                </label>
              )}
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={speakerOn} onChange={(e) => setSpeakerOn(e.target.checked)} /> Patient voice
              </label>
            </div>
          </div>
        </div>
      )}

      {/* Instructor pause */}
      {paused && (
        <div className="fixed inset-0 z-30 grid place-items-center bg-violet-950/70 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 text-center shadow-xl">
            <div className="text-xs font-semibold uppercase tracking-wide text-violet-700">Paused by your instructor</div>
            <p className="mt-3 whitespace-pre-wrap text-slate-800">{data.pauseNote || "Take a moment. Your instructor will resume the visit shortly."}</p>
            <p className="mt-4 text-xs text-slate-500">The clock is stopped. The visit continues when they resume it.</p>
          </div>
        </div>
      )}

      {/* Wrap-up */}
      {wrapOpen && (
        <div className="fixed inset-0 z-30 grid place-items-center bg-slate-900/70 p-4">
          <div className="max-h-full w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
            {scoring ? (
              <div className="py-10 text-center">
                <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-brand-600" />
                <p className="font-medium text-slate-900">Reviewing your visit</p>
                <p className="mt-1 text-sm text-slate-500">Checking what you elicited against the case, then scoring the rubric with evidence from the transcript. This takes about a minute.</p>
              </div>
            ) : (
              <>
                <h2 className="text-lg font-semibold text-slate-900">{timeUp ? "Time is up. Write up the visit" : "End the visit and write up"}</h2>
                <p className="mt-1 text-sm text-slate-600">
                  {data.role.noteFormat} for {p.name}. Your write-up is assessed along with the conversation. Before you leave: did you summarise, check understanding and agree next steps with {firstName}?
                </p>
                <div className="mt-4 space-y-3">
                  {data.role.wrapUp.map((f) => (
                    <div key={f.id}>
                      <label className="mb-1 block text-xs font-medium text-slate-600">{f.label}</label>
                      <textarea value={wrap[f.id] || ""} onChange={(e) => setWrap((w) => ({ ...w, [f.id]: e.target.value }))} placeholder={f.placeholder} rows={3} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200" />
                    </div>
                  ))}
                </div>
                {error && <p className="mt-3 rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
                <div className="mt-5 flex justify-end gap-2">
                  <button onClick={() => setWrapOpen(false)} className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
                    Back to the patient
                  </button>
                  <button onClick={submit} className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
                    Submit for feedback
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
