"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, cx } from "@/components/ui";
import { BEHAVIOURS, KIND_LABEL, SBAR_FIELDS, SOURCE_LABEL, STATUS_LABEL, type EntryStatus, type Handoff, type RunView, type StateEntry, type TraceEvaluation } from "@/lib/journey/types";

// Status colours: one fixed categorical order, validated for colour-vision separation on the light surface.
export const STATUS_ORDER: EntryStatus[] = ["established", "patient_reported", "resolved", "uncertain", "disputed", "open_question"];
export const STATUS_COLOR: Record<EntryStatus, string> = {
  established: "#2a78d6",
  patient_reported: "#eb6834",
  resolved: "#1baf7a",
  uncertain: "#eda100",
  disputed: "#e87ba4",
  open_question: "#008300",
};

export function StatusBadge({ status }: { status: EntryStatus }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] font-medium text-slate-700">
      <span className="h-2 w-2 rounded-sm" style={{ background: STATUS_COLOR[status] }} />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function WhoBadge({ ai }: { ai: boolean }) {
  return <Badge tone={ai ? "slate" : "teal"}>{ai ? "AI colleague" : "Student"}</Badge>;
}

export interface Live {
  stageId: string | null;
  lines: { turn: number; speaker: string; text: string; streaming?: boolean }[];
  phase: string;
}

const MIN_GAP_MS = 2500;
const POLL_MS = 8000;

/**
 * Loads a run and keeps it current. While the server is working (a colleague's visit, state
 * extraction, the final write-up) it listens to the live stream and polls slowly as a fallback;
 * when the run is waiting on the learner it makes no requests at all.
 *
 * `refresh()` is the only way the run is fetched: one request in flight at a time, at least
 * MIN_GAP_MS between background fetches, and a call made while one is in flight is folded into a
 * single follow-up. `refresh(true)` (after the learner did something) skips the gap, not the queue.
 */
export function useRun(runId: string, opts: { opened?: string } = {}) {
  const [view, setView] = useState<RunView | null>(null);
  const [error, setError] = useState("");
  const [live, setLive] = useState<Live>({ stageId: null, lines: [], phase: "" });
  const seq = useRef<{ n: number; epoch: string } | null>(null);
  const opened = opts.opened;
  const flight = useRef<{ busy: boolean; last: number; again: boolean; urgent: boolean; timer: ReturnType<typeof setTimeout> | null; waiters: ((v: RunView | null) => void)[] }>({ busy: false, last: 0, again: false, urgent: false, timer: null, waiters: [] });

  const refresh = useCallback(
    (now?: boolean): Promise<RunView | null> => {
      const f = flight.current;
      return new Promise<RunView | null>((resolve) => {
        f.waiters.push(resolve);
        const go = async () => {
          f.timer = null;
          if (f.busy) return void (f.again = true);
          f.busy = true;
          f.again = false;
          f.urgent = false;
          const waiters = f.waiters.splice(0);
          let out: RunView | null = null;
          try {
            const res = await fetch(`/api/journeys/runs/${runId}${opened ? `?opened=${encodeURIComponent(opened)}` : ""}`, { cache: "no-store" });
            const j = await res.json();
            if (j.error) setError(j.error);
            else {
              setView(j);
              setError("");
              out = j as RunView;
            }
          } catch {
            setError("Could not load the care journey.");
          }
          f.busy = false;
          f.last = Date.now();
          waiters.forEach((w) => w(out));
          if (f.again || f.waiters.length) schedule(f.urgent);
        };
        const schedule = (immediate: boolean) => {
          if (f.busy) return void (f.again = true);
          const wait = immediate ? 0 : Math.max(0, f.last + MIN_GAP_MS - Date.now());
          if (f.timer) {
            if (!immediate) return; // a fetch is already scheduled
            clearTimeout(f.timer);
          }
          f.timer = setTimeout(go, wait);
        };
        if (now) f.urgent = true;
        schedule(!!now || f.last === 0);
      });
    },
    [runId, opened],
  );

  useEffect(() => {
    const f = flight.current;
    refresh(true);
    return () => {
      if (f.timer) clearTimeout(f.timer);
      f.timer = null;
    };
  }, [refresh]);

  const waiting = !!view && (view.busy || view.next.kind === "wait" || view.next.kind === "finish");
  useEffect(() => {
    if (!waiting) return;
    const at = seq.current;
    const es = new EventSource(`/api/journeys/runs/${runId}/stream${at ? `?after=${at.n}&epoch=${at.epoch}` : ""}`);
    es.onmessage = (m) => {
      const e = JSON.parse(m.data);
      // Drop anything already seen (the browser reconnects the stream on its own with the original URL).
      if (seq.current && e.epoch === seq.current.epoch && e.seq <= seq.current.n) return;
      seq.current = { n: e.seq || 0, epoch: e.epoch || "" };
      if (e.type === "stage_start") setLive({ stageId: e.stageId, lines: [], phase: "" });
      else if (e.type === "clinician") setLive((l) => ({ stageId: e.stageId, phase: "", lines: [...(l.stageId === e.stageId ? l.lines : []), { turn: e.turn, speaker: "clinician", text: e.text }] }));
      else if (e.type === "patient_delta")
        setLive((l) => {
          const lines = [...l.lines];
          const last = lines[lines.length - 1];
          if (last?.streaming && last.turn === e.turn) lines[lines.length - 1] = { ...last, text: last.text + e.text };
          else lines.push({ turn: e.turn, speaker: "patient", text: e.text, streaming: true });
          return { ...l, stageId: e.stageId, lines };
        });
      else if (e.type === "patient")
        setLive((l) => {
          const lines = l.lines.filter((x) => !(x.streaming && x.turn === e.turn));
          return { ...l, lines: [...lines, { turn: e.turn, speaker: "patient", text: e.text }] };
        });
      else if (e.type === "action") setLive((l) => ({ ...l, lines: [...l.lines, { turn: e.turn, speaker: "chart", text: e.text }] }));
      else if (e.type === "phase") setLive((l) => ({ ...l, stageId: e.stageId, phase: e.label }));
      // Replayed history never triggers a fetch; only news does, and refresh() rate-limits itself.
      else if (!e.replay && (e.type === "stage_done" || e.type === "idle" || e.type === "error" || e.type === "updated")) refresh();
    };
    const poll = setInterval(() => refresh(), POLL_MS);
    return () => {
      es.close();
      clearInterval(poll);
    };
  }, [waiting, runId, refresh]);

  return { view, error, live, refresh };
}

export async function post<T = Record<string, unknown>>(url: string, body: unknown): Promise<T & { error?: string }> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return await res.json();
  } catch {
    return { error: "The request did not go through. Check your connection and try again." } as T & { error?: string };
  }
}

export function stageLabel(view: RunView, e: { stageId: string; stageOrder: number }) {
  if (e.stageId === "record") return "Existing record";
  if (e.stageId === "huddle") return "Team huddle";
  const s = view.stages.find((x) => x.stage.id === e.stageId);
  return s ? `Encounter ${s.stage.order}: ${s.stage.roleTitle}` : `Encounter ${e.stageOrder}`;
}

/** One line of the shared state. Clicking opens its provenance. */
export function EntryRow({ entry, onOpen, showWho = true, dense }: { entry: StateEntry; onOpen?: (id: string) => void; showWho?: boolean; dense?: boolean }) {
  return (
    <button type="button" onClick={() => onOpen?.(entry.id)} className={cx("flex w-full items-start gap-2 rounded-md px-2 text-left hover:bg-slate-50", dense ? "py-1" : "py-1.5")}>
      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-sm" style={{ background: STATUS_COLOR[entry.effectiveStatus] }} title={STATUS_LABEL[entry.effectiveStatus]} />
      <span className="min-w-0 flex-1">
        <span className="text-sm text-slate-800">{entry.text}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500">
          <span>{KIND_LABEL[entry.kind] || entry.kind}</span>
          <span>{STATUS_LABEL[entry.effectiveStatus]}</span>
          {showWho && entry.stageId !== "record" && <span>{entry.contributorName}</span>}
          {entry.meta?.unverifiedValues?.length ? <span className="text-amber-700">value not in case file</span> : null}
          {entry.evidence && entry.evidence.verified === false ? <span className="text-amber-700">evidence not verified</span> : null}
        </span>
      </span>
    </button>
  );
}

const REL_OUT: Record<string, string> = { uses: "Builds on", confirms: "Confirms", contradicts: "Disagrees with", updates: "Updates", answers: "Answers", resolves: "Resolves" };
const REL_IN: Record<string, string> = { uses: "Used by", confirms: "Confirmed by", contradicts: "Disputed by", updates: "Updated by", answers: "Answered by", resolves: "Resolved by" };

function evidenceWhere(e: StateEntry) {
  const ev = e.evidence;
  if (!ev) return "";
  if (ev.where === "visit") return `Visit transcript${ev.turn ? `, turn ${ev.turn}` : ""}${ev.speaker ? ` (${ev.speaker})` : ""}`;
  return { note: "Clinician's written note", record: "Existing record", consult: "Message between colleagues", huddle: "Team huddle", sbar: "SBAR handoff" }[ev.where] || ev.where;
}

/** Full provenance of one entry: who, role, AI or student, encounter, time, status, source, evidence and relation history. */
export function ProvenancePanel({ view, entryId, onOpen, onClose }: { view: RunView; entryId: string; onOpen: (id: string) => void; onClose: () => void }) {
  const e = view.entries.find((x) => x.id === entryId);
  useEffect(() => {
    const k = (ev: KeyboardEvent) => ev.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  if (!e) return null;
  const byId = new Map(view.entries.map((x) => [x.id, x]));
  const out = view.links.filter((l) => l.from === e.id && byId.has(l.to));
  const inn = view.links.filter((l) => l.to === e.id && byId.has(l.from));
  const rows: [string, React.ReactNode][] = [
    ["Status", <span key="s" className="flex flex-wrap items-center gap-2"><StatusBadge status={e.effectiveStatus} />{e.effectiveStatus !== e.status && <span className="text-xs text-slate-500">recorded as {STATUS_LABEL[e.status].toLowerCase()}; changed by a later entry (see history)</span>}</span>],
    ["Type", KIND_LABEL[e.kind] || e.kind],
    ["Source", SOURCE_LABEL[e.source] || e.source],
    ["Contributed by", <span key="c" className="flex flex-wrap items-center gap-2">{e.contributorName}{e.stageId !== "record" && <WhoBadge ai={e.contributorIsAi} />}</span>],
    ["Professional role", e.contributorRole],
    ["Encounter", stageLabel(view, e)],
    ["Simulated time", e.simTime],
    ["Recorded", new Date(e.createdAt.replace(" ", "T") + "Z").toLocaleString()],
  ];
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/30" onClick={onClose}>
      <aside className="h-full w-full max-w-md overflow-y-auto bg-white p-5 shadow-xl" onClick={(ev) => ev.stopPropagation()} aria-label="Provenance">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Where this came from</h2>
          <button onClick={onClose} className="rounded px-2 py-0.5 text-sm text-slate-500 hover:bg-slate-100">Close</button>
        </div>
        <p className="mt-2 text-base font-medium text-slate-900">{e.text}</p>
        <dl className="mt-4 divide-y divide-slate-100 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="grid grid-cols-[8.5rem_1fr] gap-2 py-1.5">
              <dt className="text-slate-500">{k}</dt>
              <dd className="text-slate-800">{v}</dd>
            </div>
          ))}
        </dl>
        {e.evidence && (
          <div className="mt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Evidence</h3>
            <p className="mt-1 text-xs text-slate-500">{evidenceWhere(e)}{e.evidence.verified === false ? " · the cited words could not be found, so this entry was downgraded" : e.evidence.quote ? " · quote verified against the source" : ""}</p>
            {e.evidence.quote && <blockquote className="mt-1 border-l-2 border-brand-500 bg-slate-50 px-3 py-2 text-sm italic text-slate-700">{e.evidence.quote}</blockquote>}
          </div>
        )}
        {(e.meta?.unverifiedValues?.length || e.meta?.flags?.length || e.meta?.owner) && (
          <div className="mt-3 space-y-1 text-xs">
            {e.meta?.unverifiedValues?.length ? <p className="rounded bg-amber-50 px-2 py-1 text-amber-800">Contains a value that is not in the approved case file ({e.meta.unverifiedValues.join(", ")}). Treat it as the clinician&apos;s suggestion, not a verified fact.</p> : null}
            {e.meta?.owner ? <p className="text-slate-600">Owner of the follow-up: {e.meta.owner}</p> : null}
            {e.meta?.flags?.filter(Boolean).map((f) => <p key={f} className="text-slate-500">{f}</p>)}
          </div>
        )}
        <div className="mt-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Relation history</h3>
          {!out.length && !inn.length && <p className="mt-1 text-sm text-slate-500">No other entry is linked to this one yet.</p>}
          <ul className="mt-1 space-y-1.5">
            {out.map((l) => {
              const t = byId.get(l.to)!;
              return (
                <li key={`o${l.id}`}>
                  <button onClick={() => onOpen(t.id)} className="w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-left hover:bg-slate-50">
                    <span className="text-[11px] font-semibold text-brand-700">{REL_OUT[l.relation]}</span>
                    <span className="block text-sm text-slate-800">{t.text}</span>
                    <span className="text-[11px] text-slate-500">{t.contributorName} · {stageLabel(view, t)}</span>
                    {l.evidence?.quote && <span className="mt-0.5 block text-[11px] italic text-slate-500">&ldquo;{l.evidence.quote.slice(0, 220)}&rdquo;</span>}
                  </button>
                </li>
              );
            })}
            {inn.map((l) => {
              const f = byId.get(l.from)!;
              return (
                <li key={`i${l.id}`}>
                  <button onClick={() => onOpen(f.id)} className="w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-left hover:bg-slate-50">
                    <span className="text-[11px] font-semibold text-slate-600">{REL_IN[l.relation]}</span>
                    <span className="block text-sm text-slate-800">{f.text}</span>
                    <span className="text-[11px] text-slate-500">{f.contributorName} · {stageLabel(view, f)} · {f.simTime}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
        <p className="mt-5 text-[11px] text-slate-400">Entry {e.id}. Entries are never edited; later information is added as new entries linked to this one.</p>
      </aside>
    </div>
  );
}

export function SbarCard({ handoff, title }: { handoff: Handoff; title?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
        <div>
          <div className="text-sm font-semibold text-slate-900">{title || `SBAR handoff from ${handoff.authorName}`}</div>
          <div className="text-xs text-slate-500">{handoff.authorRole} to {handoff.toName}</div>
        </div>
        <WhoBadge ai={handoff.authorIsAi} />
      </div>
      <dl className="divide-y divide-slate-100">
        {SBAR_FIELDS.map((f) => (
          <div key={f.key} className="grid gap-1 px-4 py-2.5 sm:grid-cols-[8rem_1fr]">
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{f.label}</dt>
            <dd className="whitespace-pre-wrap text-sm text-slate-800">{handoff.sbar[f.key] || <span className="text-slate-400">Left blank</span>}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

const OBS = { yes: { label: "Observed", cls: "bg-emerald-100 text-emerald-800" }, no: { label: "Not observed", cls: "bg-rose-100 text-rose-800" }, na: { label: "No opportunity", cls: "bg-slate-100 text-slate-600" } };

/** The explainable behavioural trace: behaviour, observed or not, where the evidence is, the words, and what to do next. */
export function TraceTable({ evaluation, compact }: { evaluation: TraceEvaluation; compact?: boolean }) {
  const domains = [...new Set(BEHAVIOURS.map((b) => b.domain))];
  return (
    <div className="space-y-4">
      {evaluation.summary && !compact && <p className="text-sm text-slate-700">{evaluation.summary}</p>}
      {domains.map((d) => {
        const items = BEHAVIOURS.filter((b) => b.domain === d).map((b) => ({ def: b, r: evaluation.behaviours.find((x) => x.key === b.key) })).filter((x) => x.r);
        if (!items.length) return null;
        const yes = items.filter((x) => x.r!.observed === "yes").length;
        const applicable = items.filter((x) => x.r!.observed !== "na").length;
        return (
          <section key={d}>
            <div className="mb-1.5 flex items-baseline justify-between">
              <h4 className="text-sm font-semibold text-slate-900">{d}</h4>
              <span className="text-xs text-slate-500">{yes} of {applicable} behaviours observed</span>
            </div>
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
              {items.map(({ def, r }) => (
                <li key={def.key} className="grid gap-x-4 gap-y-1 px-3 py-2.5 md:grid-cols-[13rem_1fr]">
                  <div>
                    <div className="text-sm font-medium text-slate-800">{def.label}</div>
                    <span className={cx("mt-1 inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold", OBS[r!.observed].cls)}>{OBS[r!.observed].label}</span>
                  </div>
                  <div className="min-w-0 text-sm">
                    {r!.location && <div className="text-xs text-slate-500">Evidence: <span className="font-medium text-slate-700">{r!.location.replace("->", "→")}</span></div>}
                    {r!.quote && <blockquote className="mt-1 border-l-2 border-slate-300 pl-2 text-[13px] italic text-slate-600">&ldquo;{r!.quote}&rdquo;</blockquote>}
                    <p className="mt-1 text-slate-800">{r!.feedback}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-slate-600">
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" />
      {label}
    </span>
  );
}

export function Transcript({ lines, clinician, patient }: { lines: { turn: number; speaker: string; text: string }[]; clinician: string; patient: string }) {
  return (
    <ol className="space-y-2">
      {lines.map((m, i) =>
        m.speaker === "chart" ? (
          <li key={i} className="whitespace-pre-wrap rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-1.5 text-xs text-slate-600">
            <span className="font-semibold">Chart · </span>
            {m.text.replace(/^Requested: /, "Requested: ")}
          </li>
        ) : (
          <li key={i} className={cx("max-w-[92%] rounded-lg px-3 py-2 text-sm", m.speaker === "clinician" ? "bg-brand-50 text-slate-800" : "ml-auto bg-slate-100 text-slate-800")}>
            <div className="mb-0.5 text-[11px] font-semibold text-slate-500">{m.speaker === "clinician" ? clinician : patient} · turn {m.turn}</div>
            <div className="whitespace-pre-wrap">{m.text}</div>
          </li>
        ),
      )}
    </ol>
  );
}
