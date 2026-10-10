"use client";
import Link from "next/link";
import { TrendChart } from "@/components/chart/ArtifactView";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, Card, Empty, Textarea, cx } from "@/components/ui";
import { feedbackUrl, toDate } from "@/lib/courses/settings";
import { ComfortMeter } from "./charts";

interface Visit {
  id: string;
  status: "active" | "paused";
  student: string;
  title: string;
  assignment: string | null;
  mode: string;
  level: number;
  turn: number;
  rapport: number;
  facts: number;
  startedAt: string;
  lastAt: string | null;
  flags: string[];
}
interface Detail {
  id: string;
  status: string;
  mode: string;
  level: number;
  pauseNote: string | null;
  timeLimitMin: number | null;
  startedAt: string;
  chart: {
    patient: { name: string; age: number; sex: string };
    chiefComplaint: string;
    tasks: string[];
    sections: { category: string; label: string; items: { id: string; text: string; turn: number }[] }[];
    results: { id: string; name: string; result: string; abnormal: boolean; turn: number }[];
    unmatched: { turn: number; request: string }[];
    emotion: string;
    turn: number;
  };
  messages: { id: number; turn: number; speaker: string; text: string }[];
}

const QUICK = [
  "Slow down and acknowledge how the patient is feeling before your next question.",
  "Try an open question, then let the patient finish.",
  "Explain why you are asking before you return to that topic.",
  "You are running short on time. Summarise and agree next steps.",
];
const WHO: Record<string, string> = { student: "Student", patient: "Patient", system: "Chart", instructor: "Instructor", coach: "Coach hint", clinician: "Colleague" };

const mins = (iso: string, now: number) => Math.max(0, Math.round((now - toDate(iso).getTime()) / 60000));

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({ error: "Request failed" }));
  if (!res.ok || j.error) throw new Error(j.error || "Request failed");
}

export default function LiveConsole() {
  const [visits, setVisits] = useState<Visit[] | null>(null);
  const [listError, setListError] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const scroller = useRef<HTMLDivElement>(null);
  const seen = useRef(0);

  const loadList = useCallback(async () => {
    try {
      const res = await fetch("/api/live", { cache: "no-store" });
      const j = await res.json();
      if (!res.ok || j.error) throw new Error(j.error || "Could not load live visits");
      setVisits(j.visits);
      setListError("");
      setNow(Date.now());
    } catch (e) {
      setListError((e as Error).message);
    }
  }, []);
  const loadDetail = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/encounters/${id}`, { cache: "no-store" });
      const j = await res.json();
      if (res.ok && !j.error) setDetail(j);
    } catch {
      /* keep the last good copy; the next poll retries */
    }
  }, []);

  useEffect(() => {
    loadList();
    const t = setInterval(loadList, 3000);
    return () => clearInterval(t);
  }, [loadList]);
  useEffect(() => {
    if (!sel) return;
    seen.current = 0;
    loadDetail(sel);
    const t = setInterval(() => loadDetail(sel), 3000);
    return () => clearInterval(t);
  }, [sel, loadDetail]);
  // Follow the conversation as new lines arrive.
  useEffect(() => {
    const n = detail?.messages.length || 0;
    if (n !== seen.current && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
    seen.current = n;
  }, [detail]);

  function open(id: string) {
    setDetail(null);
    setMsg(null);
    setNote("");
    setSel(id);
  }
  async function act(fn: () => Promise<void>, done: string) {
    if (!sel) return;
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: done });
      setNote("");
      await Promise.all([loadDetail(sel), loadList()]);
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
    setBusy(false);
  }

  const current = detail && detail.id === sel ? detail : null;
  const info = visits?.find((v) => v.id === sel) || null;
  const ended = current && current.status !== "active" && current.status !== "paused";
  const paused = current?.status === "paused";

  return (
    <div className="grid gap-5 lg:grid-cols-[22rem_1fr]">
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>{visits === null ? "Loading…" : `${visits.length} visit${visits.length === 1 ? "" : "s"} in progress`}</span>
          <span>Updates every 3 seconds</span>
        </div>
        {listError && <p className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-800">{listError}</p>}
        {visits?.length === 0 && (
          <Empty>
            No visits are in progress with live assist on. To watch a visit, turn on Live assist in the assignment's settings before students start.
          </Empty>
        )}
        {visits?.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => open(v.id)}
            aria-pressed={sel === v.id}
            className={cx("block w-full rounded-lg border bg-white p-3 text-left shadow-sm", sel === v.id ? "border-brand-500 ring-1 ring-brand-500" : v.flags.length ? "border-amber-300 hover:border-amber-400" : "border-slate-200 hover:border-slate-300")}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-900">{v.student}</div>
                <div className="line-clamp-2 text-xs text-slate-600">{v.title}</div>
              </div>
              {v.status === "paused" ? <Badge tone="amber">Paused</Badge> : <Badge tone="green">Live</Badge>}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-600">
              <span>Turn {v.turn}</span>
              <span>{v.facts} facts gathered</span>
              <span>Level {v.level}</span>
              <span>{mins(v.startedAt, now)} min in</span>
            </div>
            <div className="mt-2">
              <ComfortMeter value={v.rapport} />
            </div>
            {v.flags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {v.flags.map((f) => (
                  <Badge key={f} tone="red">
                    At risk: {f}
                  </Badge>
                ))}
              </div>
            )}
            <div className="mt-2 truncate text-[11px] text-slate-500">
              {v.assignment || "No assignment"} · {v.mode}
              {v.lastAt ? ` · last message ${mins(v.lastAt, now)} min ago` : " · no messages yet"}
            </div>
          </button>
        ))}
      </div>

      <div>
        {!sel ? (
          <Empty>Choose a visit on the left to see its transcript and chart, pause it or send the student a note.</Empty>
        ) : !current ? (
          <Card className="p-6 text-sm text-slate-500">Loading the visit…</Card>
        ) : (
          <Card>
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-slate-900">
                  {info?.student || "Student"} with {current.chart.patient.name}
                  <span className="font-normal text-slate-500">
                    {" "}
                    · {current.chart.patient.age}, {current.chart.patient.sex}
                  </span>
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  {current.chart.chiefComplaint} · level {current.level} · {current.mode} · turn {current.chart.turn}
                  {current.timeLimitMin ? ` · ${mins(current.startedAt, now)} of ${current.timeLimitMin} min` : ` · ${mins(current.startedAt, now)} min in`}
                </p>
              </div>
              <span className="shrink-0">{ended ? <Badge tone="slate">Visit ended</Badge> : paused ? <Badge tone="amber">Paused by instructor</Badge> : <Badge tone="green">Live</Badge>}</span>
            </div>

            <div className="grid lg:grid-cols-[1fr_18rem]">
              <div className="border-b border-slate-100 lg:border-b-0 lg:border-r">
                <div ref={scroller} className="h-[26rem] space-y-2.5 overflow-y-auto px-4 py-3" aria-live="polite">
                  {current.messages.length === 0 && <p className="text-sm text-slate-500">The student has not said anything yet.</p>}
                  {current.messages.map((m) => (
                    <div key={m.id} className={cx("text-sm", m.speaker === "student" ? "pl-0 pr-8" : m.speaker === "patient" ? "pl-8" : "")}>
                      <div className="text-[11px] font-medium text-slate-500">
                        {WHO[m.speaker] || m.speaker} · turn {m.turn}
                      </div>
                      <div
                        className={cx(
                          "mt-0.5 whitespace-pre-line rounded-md px-3 py-2",
                          m.speaker === "student" ? "bg-brand-50 text-slate-900" : m.speaker === "patient" ? "bg-slate-100 text-slate-900" : m.speaker === "instructor" ? "border border-amber-200 bg-amber-50 text-amber-950" : "border border-slate-200 bg-white text-xs text-slate-600",
                        )}
                      >
                        {m.text}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="border-t border-slate-100 p-4">
                  {ended ? (
                    <p className="text-sm text-slate-600">
                      This visit has been submitted.{" "}
                      <Link href={feedbackUrl(current.id)} className="font-medium text-brand-700 underline">
                        Open the feedback
                      </Link>
                    </p>
                  ) : (
                    <>
                      <label htmlFor="live-note" className="mb-1 block text-xs font-medium text-slate-600">
                        {paused ? "Note to the student (they see it straight away; the visit stays paused until you resume)" : "Note to the student (shown in their visit straight away, or attached to a pause)"}
                      </label>
                      <Textarea id="live-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="e.g. You have asked three closed questions in a row. Ask what worries him most and wait." />
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {QUICK.map((q) => (
                          <button key={q} type="button" onClick={() => setNote(q)} className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-left text-[11px] text-slate-600 hover:border-brand-500 hover:text-brand-700">
                            {q}
                          </button>
                        ))}
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Button size="sm" variant="secondary" disabled={busy || !note.trim()} onClick={() => act(() => post(`/api/encounters/${sel}/coach`, { text: note }), "Note sent to the student.")}>
                          Send note
                        </Button>
                        {paused ? (
                          <Button size="sm" disabled={busy} onClick={() => act(() => post(`/api/encounters/${sel}/pause`, { paused: false }), "Visit resumed.")}>
                            Resume visit
                          </Button>
                        ) : (
                          <Button size="sm" variant="danger" disabled={busy} onClick={() => act(() => post(`/api/encounters/${sel}/pause`, { paused: true, note }), "Visit paused. The student cannot continue until you resume.")}>
                            {note.trim() ? "Pause with this note" : "Pause visit"}
                          </Button>
                        )}
                        {msg && <span className={`text-xs ${msg.ok ? "text-emerald-700" : "text-rose-700"}`}>{msg.text}</span>}
                      </div>
                      {paused && current.pauseNote && <p className="mt-2 text-xs text-slate-500">Pause note shown to the student: {current.pauseNote}</p>}
                    </>
                  )}
                </div>
              </div>

              <div className="max-h-[38rem] space-y-4 overflow-y-auto px-4 py-3 text-xs">
                {info && <ComfortMeter value={info.rapport} />}
                <div className="text-slate-600">Patient mood: {current.chart.emotion}</div>
                {(() => {
                  const tl = (current as unknown as { timeline?: { turn: number; score: number; coverage: number; communication: number; comfort: number }[] }).timeline || [];
                  if (tl.length < 2) return null;
                  const pct = (v: number) => Math.round(v * 100);
                  return (
                    <div>
                      <div className="mb-1 font-medium text-slate-900">Running score: {pct(tl[tl.length - 1].score)} / 100</div>
                      <TrendChart
                        chart={{
                          kind: "line",
                          xLabel: "Turn",
                          yLabel: "0 to 100",
                          series: [
                            { name: "Running score", points: tl.map((p) => ({ x: `T${p.turn}`, y: pct(p.score) })) },
                            { name: "Findings covered", points: tl.map((p) => ({ x: `T${p.turn}`, y: pct(p.coverage) })) },
                            { name: "Communication", points: tl.map((p) => ({ x: `T${p.turn}`, y: pct(p.communication) })) },
                          ],
                        }}
                      />
                    </div>
                  );
                })()}
                {info && info.flags.length > 0 && (
                  <div>
                    <div className="mb-1 font-medium text-slate-900">At-risk signals</div>
                    <ul className="list-disc space-y-0.5 pl-4 text-rose-800">
                      {info.flags.map((f) => (
                        <li key={f}>{f}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <div>
                  <div className="mb-1 font-medium text-slate-900">Chart so far</div>
                  {current.chart.sections.length === 0 && <p className="text-slate-500">Nothing gathered yet.</p>}
                  {current.chart.sections.map((s) => (
                    <div key={s.category} className="mb-2">
                      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{s.label}</div>
                      <ul className="mt-0.5 space-y-0.5 text-slate-800">
                        {s.items.map((i) => (
                          <li key={i.id}>
                            {i.text} <span className="text-slate-400">(turn {i.turn})</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
                {current.chart.results.length > 0 && (
                  <div>
                    <div className="mb-1 font-medium text-slate-900">Exams and orders</div>
                    <ul className="space-y-1 text-slate-800">
                      {current.chart.results.map((r) => (
                        <li key={r.id}>
                          <span className="font-medium">{r.name}:</span> {r.result} {r.abnormal && <Badge tone="amber">Abnormal</Badge>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {current.chart.unmatched.length > 0 && (
                  <div>
                    <div className="mb-1 font-medium text-slate-900">Requests with no result</div>
                    <ul className="list-disc pl-4 text-slate-700">
                      {current.chart.unmatched.map((u, i) => (
                        <li key={i}>{u.request}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <div>
                  <div className="mb-1 font-medium text-slate-900">Tasks the student was given</div>
                  <ul className="list-disc space-y-0.5 pl-4 text-slate-700">
                    {current.chart.tasks.map((t, i) => (
                      <li key={i}>{t}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
