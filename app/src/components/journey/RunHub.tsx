"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Badge, Button, Card, CardHeader, LinkButton, Textarea, cx } from "@/components/ui";
import { SBAR_FIELDS, STATUS_LABEL, type HuddleItem, type RunView, type Sbar, type StageView, type TraceEvaluation } from "@/lib/journey/types";
import ConsultPanel from "./ConsultPanel";
import FinalView from "./FinalView";
import { EntryRow, post, ProvenancePanel, SbarCard, Spinner, StatusBadge, TraceTable, Transcript, useRun, type Live } from "./shared";

type Step = string; // stage id | "huddle" | "final"

function StepDot({ state }: { state: "done" | "now" | "todo" | "error" }) {
  return (
    <span
      className={cx(
        "grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[14px] font-bold",
        state === "done" && "border-brand-600 bg-brand-600 text-white",
        state === "now" && "border-brand-600 bg-white text-brand-700",
        state === "todo" && "border-slate-300 bg-white text-slate-400",
        state === "error" && "border-rose-500 bg-rose-500 text-white",
      )}
    >
      {state === "done" ? "✓" : state === "error" ? "!" : ""}
    </span>
  );
}

// ---------- A colleague's (AI) encounter ----------

function AiStage({ view, s, live, onOpen }: { view: RunView; s: StageView; live: Live; onOpen: (id: string) => void }) {
  const running = s.status !== "complete" && s.status !== "error";
  const isLive = running && live.stageId === s.stage.id && live.lines.length > 0;
  const lines = isLive ? live.lines : s.transcript;
  const [showTalk, setShowTalk] = useState(true);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (isLive && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [isLive, lines]);
  const mine = view.entries.filter((e) => e.stageId === s.stage.id);
  const handoff = view.handoffs.find((h) => h.fromStage === s.stage.id);
  const used = view.links.filter((l) => l.stageId === s.stage.id && l.relation === "uses");
  const usedTargets = [...new Set(used.map((l) => l.to))].map((id) => view.entries.find((e) => e.id === id)).filter((e) => e && e.stageOrder < s.stage.order);
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={`${s.clinicianName} sees ${view.patient.name}`}
          subtitle={`${s.stage.visitLabel || "Telehealth visit"} · ${s.stage.simTime} · an AI colleague playing a faculty-provided persona. The patient's answers come from the same case engine you will use.`}
          action={lines.length > 0 ? <Button size="sm" variant="secondary" onClick={() => setShowTalk((v) => !v)}>{showTalk ? "Hide the conversation" : "Show the conversation"}</Button> : undefined}
        />
        <div className="p-4">
          {s.status === "pending" && <Spinner label="Waiting for the earlier encounter to finish" />}
          {showTalk && lines.length > 0 && (
            <div ref={box} className="max-h-[26rem] overflow-y-auto pr-1">
              <Transcript lines={lines} clinician={s.clinicianName} patient={view.patient.name} />
            </div>
          )}
          {running && s.status !== "pending" && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Spinner label={live.stageId === s.stage.id && live.phase ? live.phase : lines.length ? "The visit is in progress" : `${s.clinicianName} is reading the record and the handoff`} />
              <span className="text-xs text-slate-500">You can read along or wait: the visit continues on its own and the handoff appears here when it is done.</span>
            </div>
          )}
        </div>
      </Card>

      {s.status === "complete" && (
        <>
          {usedTargets.length > 0 && (
            <Card>
              <CardHeader title="Earlier information this encounter drew on" subtitle="Entries from the record or an earlier professional that shaped a question in this visit." />
              <div className="p-2">{usedTargets.map((e) => <EntryRow key={e!.id} entry={e!} onOpen={onOpen} dense />)}</div>
            </Card>
          )}
          <Card>
            <CardHeader title="What this encounter added to the shared patient state" subtitle={`${mine.length} entries. Patient statements and results come from the case file; assessments are ${s.clinicianName}'s and are marked as such.`} />
            <div className="p-2">{mine.map((e) => <EntryRow key={e.id} entry={e} onOpen={onOpen} showWho={false} dense />)}</div>
          </Card>
          {handoff && (
            <div className="space-y-2">
              <SbarCard handoff={handoff} />
              {handoff.evaluation ? (
                <details className="rounded-lg border border-slate-200 bg-white px-4 py-2.5">
                  <summary className="cursor-pointer text-sm font-medium text-slate-800">Worked example: how this handoff measures up against the communication behaviours</summary>
                  <div className="mt-3"><TraceTable evaluation={handoff.evaluation} /></div>
                </details>
              ) : (
                <p className="text-xs text-slate-400">The communication review of this handoff is being written.</p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------- The learner's own encounter ----------

function SbarForm({ view, s, refresh }: { view: RunView; s: StageView; refresh: () => void }) {
  const [sbar, setSbar] = useState<Sbar>({ situation: "", background: "", assessment: "", recommendation: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const next = view.stages.find((x) => x.stage.order === s.stage.order + 1);
  async function submit() {
    setBusy(true);
    setErr("");
    const r = await post<{ evaluation: TraceEvaluation }>(`/api/journeys/runs/${view.id}/handoff`, sbar);
    setBusy(false);
    if (r.error) return setErr(r.error);
    refresh();
  }
  return (
    <Card>
      <CardHeader title={`Write your SBAR handoff to ${next ? `${next.clinicianName}, ${next.stage.roleTitle}` : "the care team"}`} subtitle={next ? `${next.clinicianName} will read this before seeing ${view.patient.name}. What you leave out, they will not know to ask.` : "You are the last professional in this journey. This goes to the whole team ahead of the huddle."} />
      <div className="space-y-3 p-4">
        {SBAR_FIELDS.map((f) => (
          <div key={f.key}>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600">{f.label}</label>
            <Textarea rows={3} value={sbar[f.key]} onChange={(e) => setSbar({ ...sbar, [f.key]: e.target.value })} placeholder={f.prompt} />
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={submit} disabled={busy || !Object.values(sbar).some((v) => v.trim())}>Send handoff</Button>
          {busy && <Spinner label="Sending and reviewing your handoff" />}
          {err && <span className="text-sm text-rose-700">{err}</span>}
        </div>
      </div>
    </Card>
  );
}

function StudentStage({ view, s, onOpen, refresh }: { view: RunView; s: StageView; onOpen: (id: string) => void; refresh: () => void }) {
  const received = view.handoffs.filter((h) => h.toStage === s.stage.id).pop();
  const mine = view.entries.filter((e) => e.stageId === s.stage.id);
  const handoff = view.handoffs.find((h) => h.fromStage === s.stage.id);
  const scored = s.encounterStatus === "scored";
  const prior = view.entries.filter((e) => e.stageOrder < s.stage.order);
  const open = prior.filter((e) => ["uncertain", "disputed", "open_question"].includes(e.effectiveStatus));
  const owner = view.viewerIsOwner;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title={owner ? `Your encounter: ${s.stage.roleTitle}` : `${s.clinicianName}'s encounter: ${s.stage.roleTitle}`} subtitle={`${s.stage.visitLabel || "Telehealth visit"} · ${s.stage.simTime}`} />
        <div className="space-y-3 p-4">
          <p className="text-sm text-slate-700">{s.stage.focus}</p>
          {s.status === "pending" && <p className="text-sm text-slate-500">{owner ? "Your visit opens when the colleagues before you have finished and handed off." : "Not started yet."}</p>}
          {s.status === "ready" && !scored && s.encounterStatus !== "submitted" && owner && (
            <div className="flex flex-wrap items-center gap-3">
              <LinkButton href={`/encounter/${s.encounterId}`}>{s.transcript.length ? "Continue your visit" : `Start your visit with ${view.patient.name}`}</LinkButton>
              <span className="text-xs text-slate-500">The chart has a Care team tab with everything below, and you can page a colleague from there.</span>
            </div>
          )}
          {s.status === "ready" && (scored || s.encounterStatus === "submitted") && (s.error ? <p className="text-sm text-rose-700">Updating the shared state failed: {s.error}</p> : <Spinner label="Adding what you found to the shared patient state" />)}
          {scored && s.encounterId && owner && <Link href={`/encounter/${s.encounterId}/feedback`} className="text-sm font-medium text-brand-700 hover:underline">See the feedback on your visit with the patient</Link>}
        </div>
      </Card>

      {!handoff && s.status !== "complete" && (
        <>
          {received ? <SbarCard handoff={received} title={`Handoff to you from ${received.authorName}`} /> : s.stage.order === 1 ? <p className="rounded-md border border-dashed border-slate-300 bg-white px-3 py-2 text-sm text-slate-500">You are first in this journey. There is no handoff; you start from the existing record.</p> : null}
          {s.status !== "pending" && open.length > 0 && (
            <Card>
              <CardHeader title="Left open by the professionals before you" subtitle="Uncertain, disputed or unanswered when your visit starts." />
              <div className="p-2">{open.map((e) => <EntryRow key={e.id} entry={e} onOpen={onOpen} dense />)}</div>
            </Card>
          )}
        </>
      )}

      {s.status === "awaiting_handoff" && owner && <SbarForm view={view} s={s} refresh={refresh} />}

      {mine.length > 0 && (
        <Card>
          <CardHeader title={owner ? "What your encounter added to the shared patient state" : "What this encounter added to the shared patient state"} subtitle={`${mine.length} entries. Select one to see the words it rests on.`} />
          <div className="p-2">{mine.map((e) => <EntryRow key={e.id} entry={e} onOpen={onOpen} showWho={false} dense />)}</div>
        </Card>
      )}
      {s.transcript.length > 0 && scored && (
        <details className="rounded-lg border border-slate-200 bg-white px-4 py-2.5">
          <summary className="cursor-pointer text-sm font-medium text-slate-800">Conversation with the patient</summary>
          <div className="mt-3"><Transcript lines={s.transcript} clinician={s.clinicianName} patient={view.patient.name} /></div>
        </details>
      )}
      {handoff && (
        <div className="space-y-3">
          <SbarCard handoff={handoff} title={owner ? "Your SBAR handoff" : `SBAR handoff from ${handoff.authorName}`} />
          {handoff.evaluation && (
            <Card>
              <CardHeader title="Review of the handoff" subtitle="Each communication behaviour, whether it was observed, where, and what to do next time." />
              <div className="p-4"><TraceTable evaluation={handoff.evaluation} /></div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- Huddle ----------

function HuddleItemCard({ view, item, onOpen, refresh }: { view: RunView; item: HuddleItem; onOpen: (id: string) => void; refresh: () => void }) {
  const entry = view.entries.find((e) => e.id === item.entryId);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  if (!entry) return null;
  const proposal = view.messages.find((m) => m.thread === "huddle" && m.kind === "proposal" && m.meta?.itemId === item.entryId);
  async function send() {
    setBusy(true);
    setErr("");
    const r = await post(`/api/journeys/runs/${view.id}/huddle`, { action: "resolve", entryId: item.entryId, text });
    setBusy(false);
    if (r.error) return setErr(r.error);
    refresh();
  }
  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <button onClick={() => onOpen(entry.id)} className="flex w-full items-start gap-3 border-b border-slate-100 px-4 py-3 text-left hover:bg-slate-50">
        <StatusBadge status={item.reason} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-slate-900">{entry.text}</span>
          <span className="text-[14px] text-slate-500">Raised by {entry.contributorName}, {entry.contributorRole} · {entry.simTime}</span>
        </span>
      </button>
      <div className="space-y-2 px-4 py-3">
        {item.positions.map((p, i) => (
          <div key={i} className="rounded-md bg-slate-50 px-3 py-2 text-sm">
            <div className="text-[14px] font-semibold text-slate-500">{p.name} · {p.role}</div>
            <p className="text-slate-800">{p.text}</p>
            {p.cites.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {p.cites.map((id) => {
                  const e = view.entries.find((x) => x.id === id);
                  return e ? <button key={id} onClick={() => onOpen(id)} className="max-w-[15rem] truncate rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[14px] text-slate-600 hover:bg-slate-100">{e.text}</button> : null;
                })}
              </div>
            )}
          </div>
        ))}
        {item.outcome ? (
          <>
            {proposal && <div className="ml-auto max-w-[92%] rounded-md bg-brand-50 px-3 py-2 text-sm"><div className="text-[14px] font-semibold text-slate-500">{view.viewerIsOwner ? "You" : view.studentName}</div>{proposal.text}</div>}
            <div className="rounded-md bg-slate-50 px-3 py-2 text-sm"><div className="text-[14px] font-semibold text-slate-500">Team response</div>{item.outcome.teamResponse}</div>
            <button onClick={() => onOpen(item.outcome!.entryId)} className={cx("w-full rounded-md border px-3 py-2 text-left text-sm", item.outcome.decision === "resolved" ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50")}>
              <div className="text-[14px] font-semibold uppercase tracking-wide text-slate-600">{item.outcome.decision === "resolved" ? "Recorded as resolved" : "Stays open, with an owner"}</div>
              <div className="text-slate-900">{item.outcome.text}</div>
              {item.outcome.owner && <div className="text-[14px] text-slate-600">Owner: {item.outcome.owner}</div>}
            </button>
          </>
        ) : view.viewerIsOwner && view.huddle?.status === "open" ? (
          <div className="space-y-2">
            <Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="How would you settle this? Say what you think, what it rests on, and who should own any follow-up. If it cannot be settled yet, say what is missing." />
            <div className="flex items-center gap-3">
              <Button size="sm" onClick={send} disabled={busy || !text.trim()}>Put it to the team</Button>
              {busy && <Spinner label="The team is responding" />}
              {err && <span className="text-xs text-rose-700">{err}</span>}
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-500">Not discussed.</p>
        )}
      </div>
    </div>
  );
}

function HuddlePanel({ view, onOpen, refresh }: { view: RunView; onOpen: (id: string) => void; refresh: () => void }) {
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const ready = view.stages.every((s) => s.status === "complete");
  const h = view.huddle;
  async function act(action: "start" | "close") {
    setBusy(action);
    setErr("");
    const r = await post(`/api/journeys/runs/${view.id}/huddle`, { action });
    setBusy("");
    if (r.error) setErr(r.error);
    refresh();
  }
  if (!ready) return <Card className="p-4 text-sm text-slate-500">The huddle opens after the last encounter. The team will reconcile whatever is still disputed, uncertain or unanswered.</Card>;
  if (!h)
    return (
      <Card>
        <CardHeader title="Team huddle" subtitle="Everyone who saw the patient, together, outside the handoff order." />
        <div className="space-y-3 p-4 text-sm text-slate-700">
          <p>The agenda is every entry in the shared state that is still disputed, unanswered or uncertain. Each colleague gives a position; you propose how to settle each item; the outcome is recorded as a new entry linked to the original, so the trail is kept.</p>
          {view.viewerIsOwner && (
            <div className="flex items-center gap-3">
              <Button onClick={() => act("start")} disabled={!!busy}>Open the huddle</Button>
              {busy && <Spinner label="Colleagues are preparing their positions" />}
              {err && <span className="text-rose-700">{err}</span>}
            </div>
          )}
        </div>
      </Card>
    );
  const done = h.items.filter((i) => i.outcome).length;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Team huddle" subtitle={`${h.items.length} item${h.items.length === 1 ? "" : "s"} on the agenda · ${done} discussed${h.status === "closed" ? " · closed" : ""}`} />
        <div className="space-y-3 p-4">
          {!h.items.length && <p className="text-sm text-slate-600">Nothing in the shared state is disputed, unanswered or uncertain, so there is nothing to reconcile.</p>}
          {h.status === "open" && view.viewerIsOwner && (
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => act("close")} disabled={!!busy}>{done < h.items.length ? "Close the huddle with items left open" : "Close the huddle and write the care plan"}</Button>
              {busy === "close" && <Spinner label="Writing the integrated care plan and your evaluation (about a minute)" />}
              {err && <span className="text-sm text-rose-700">{err}</span>}
            </div>
          )}
          {h.status === "closed" && view.status !== "complete" && view.viewerIsOwner && (
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => act("close")} disabled={!!busy}>Finish writing the care plan</Button>
              {busy && <Spinner label="Writing the integrated care plan and your evaluation" />}
              {err && <span className="text-sm text-rose-700">{err}</span>}
            </div>
          )}
        </div>
      </Card>
      {h.items.map((i) => <HuddleItemCard key={i.entryId} view={view} item={i} onOpen={onOpen} refresh={refresh} />)}
    </div>
  );
}

// ---------- Hub ----------

const TABS = [
  { key: "journey", label: "Journey" },
  { key: "state", label: "Integrated patient view" },
  { key: "team", label: "Team messages" },
  { key: "evaluation", label: "Teamwork evaluation" },
] as const;

export default function RunHub({ runId }: { runId: string }) {
  const { view, error, live, refresh } = useRun(runId);
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("journey");
  const [step, setStep] = useState<Step | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const follow = view ? (view.next.stageId ? view.next.stageId : view.next.kind === "huddle" ? "huddle" : "final") : null;
  const lastFollow = useRef<string | null>(null);
  useEffect(() => {
    if (!follow || follow === lastFollow.current) return;
    // Move the learner to whatever needs their attention next, after the current render.
    const t = setTimeout(() => {
      lastFollow.current = follow;
      setStep(follow);
      if (follow === "final") setTab("state");
    }, 0);
    return () => clearTimeout(t);
  }, [follow]);

  if (error && !view) return <p className="text-sm text-rose-700">{error}</p>;
  if (!view) return <Spinner label="Loading the care journey" />;
  const current = step || follow || view.stages[0].stage.id;
  const sv = view.stages.find((s) => s.stage.id === current);
  const me = view.stages.find((s) => s.isStudent);
  const superseded = new Set(view.links.filter((l) => l.relation === "updates").map((l) => l.to));
  const unresolved = view.entries.filter((e) => ["uncertain", "disputed", "open_question"].includes(e.effectiveStatus) && !superseded.has(e.id)).length;
  const n = view.next;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Care journey</div>
          <h1 className="text-xl font-semibold text-slate-900">{view.journey.title}</h1>
          <p className="mt-1 text-sm text-slate-600">
            {view.patient.name}, {view.patient.age}, {view.patient.sex} · {view.viewerIsOwner ? "You are" : `${view.studentName} is`} the <span className="font-medium text-slate-800">{me?.stage.roleTitle.toLowerCase()}</span> (encounter {me?.stage.order} of {view.stages.length}). The AI plays the patient and the other professionals.
          </p>
        </div>
        <div className="flex gap-2 text-center text-xs text-slate-500">
          <div className="rounded-md border border-slate-200 bg-white px-3 py-1.5"><div className="text-base font-semibold tabular-nums text-slate-900">{view.entries.length}</div>entries in shared state</div>
          <div className="rounded-md border border-slate-200 bg-white px-3 py-1.5"><div className="text-base font-semibold tabular-nums text-slate-900">{unresolved}</div>uncertain or open</div>
        </div>
      </div>

      <div className={cx("mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-2.5 text-sm", n.kind === "error" ? "border-rose-200 bg-rose-50 text-rose-900" : "border-brand-200 bg-brand-50 text-brand-900")}>
        <span className="flex items-center gap-2">
          {n.kind === "wait" && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />}
          <span><span className="font-semibold">{n.kind === "done" ? "Complete. " : n.kind === "error" ? "Stopped. " : "Now: "}</span>{n.label}</span>
        </span>
        {view.viewerIsOwner && (
          <span className="flex gap-2">
            {(n.kind === "start_visit" || n.kind === "continue_visit") && me?.encounterId && <LinkButton size="sm" href={`/encounter/${me.encounterId}`}>{n.kind === "start_visit" ? "Start your visit" : "Continue your visit"}</LinkButton>}
            {n.kind === "error" && (
              <Button size="sm" variant="secondary" disabled={retrying} onClick={async () => { setRetrying(true); await post(`/api/journeys/runs/${view.id}/retry`, {}); await refresh(); setRetrying(false); }}>Try this stage again</Button>
            )}
            {(n.kind === "write_handoff" || n.kind === "huddle") && <Button size="sm" onClick={() => { setTab("journey"); setStep(n.kind === "huddle" ? "huddle" : n.stageId!); }}>{n.kind === "huddle" ? "Go to the huddle" : "Write the handoff"}</Button>}
            {n.kind === "done" && <Button size="sm" onClick={() => setTab("state")}>Open the integrated patient view</Button>}
          </span>
        )}
      </div>

      <div className="mb-4 flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className={cx("-mb-px border-b-2 px-3 py-2 text-sm", tab === t.key ? "border-brand-600 font-semibold text-brand-700" : "border-transparent text-slate-600 hover:text-slate-900")}>
            {t.label}
            {t.key === "team" && view.messages.filter((m) => m.thread !== "huddle" && m.thread !== "plan").length > 0 && <span className="ml-1 text-xs text-slate-400">{view.messages.filter((m) => m.thread !== "huddle" && m.thread !== "plan").length}</span>}
          </button>
        ))}
      </div>

      {tab === "journey" && (
        <div className="grid gap-5 lg:grid-cols-[17rem_1fr]">
          <nav aria-label="Encounters">
            <ol className="space-y-1">
              {view.stages.map((s) => {
                const state = s.status === "complete" ? "done" : s.status === "error" ? "error" : s.status === "pending" ? "todo" : "now";
                return (
                  <li key={s.stage.id}>
                    <button onClick={() => setStep(s.stage.id)} className={cx("flex w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left", current === s.stage.id ? "border-brand-500 bg-white shadow-sm" : "border-transparent hover:bg-white")}>
                      <span className="mt-0.5"><StepDot state={state} /></span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-slate-900">{s.stage.order}. {s.stage.roleTitle}</span>
                        <span className="block truncate text-xs text-slate-500">{s.isStudent ? (view.viewerIsOwner ? "You" : view.studentName) : s.clinicianName} · {s.stage.simTime}</span>
                        <span className="mt-0.5 block">{s.isStudent ? <Badge tone="teal">{view.viewerIsOwner ? "Your encounter" : "Student"}</Badge> : <Badge>AI colleague</Badge>}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
              {[
                { key: "huddle", label: "Team huddle", sub: "Reconcile what is still open", state: view.huddle?.status === "closed" ? "done" : n.kind === "huddle" ? "now" : "todo" },
                { key: "final", label: "Integrated patient view", sub: "Care plan and provenance", state: view.status === "complete" ? "done" : "todo" },
              ].map((x) => (
                <li key={x.key}>
                  <button onClick={() => (x.key === "final" ? setTab("state") : setStep(x.key))} className={cx("flex w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left", current === x.key ? "border-brand-500 bg-white shadow-sm" : "border-transparent hover:bg-white")}>
                    <span className="mt-0.5"><StepDot state={x.state as "done" | "now" | "todo"} /></span>
                    <span>
                      <span className="block text-sm font-medium text-slate-900">{x.label}</span>
                      <span className="block text-xs text-slate-500">{x.sub}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
            <p className="mt-3 px-3 text-[14px] leading-relaxed text-slate-400">Each encounter starts from the shared patient state, adds to it, and hands off with an SBAR. Nothing in the state is ever overwritten.</p>
          </nav>
          <div className="min-w-0">
            {sv && (sv.isStudent ? <StudentStage view={view} s={sv} onOpen={setOpen} refresh={refresh} /> : <AiStage key={sv.stage.id} view={view} s={sv} live={live} onOpen={setOpen} />)}
            {current === "huddle" && <HuddlePanel view={view} onOpen={setOpen} refresh={refresh} />}
            {current === "final" && <FinalView view={view} onOpen={setOpen} refresh={refresh} />}
          </div>
        </div>
      )}

      {tab === "state" && <FinalView view={view} onOpen={setOpen} refresh={refresh} />}

      {tab === "team" && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader title="Page a colleague" subtitle="Reach back for clarification, reach forward with a heads-up, ask for a consult, or call something out to everyone. Replies come from the shared record and that colleague's own visit only." />
            <div className="p-4"><ConsultPanel view={view} refresh={refresh} /></div>
          </Card>
          <Card>
            <CardHeader title="All messages outside the handoff order" subtitle="Requests, read-backs and check-backs are labelled; a closed loop is marked when the sender confirms the read-back." />
            <div className="space-y-2 p-4">
              {view.messages.filter((m) => m.thread !== "huddle" && m.thread !== "plan").map((m) => (
                <div key={m.id} className={cx("rounded-md px-3 py-2 text-sm", m.fromIsAi ? "bg-slate-50" : "bg-brand-50")}>
                  <div className="mb-0.5 flex flex-wrap items-center gap-1.5 text-[14px] font-semibold text-slate-500">
                    {m.fromName} to {m.toRole || "team"}
                    {m.kind === "callout" && <Badge tone="amber">Call-out</Badge>}
                    {m.meta?.act && <Badge>{m.meta.act.replace("_", " ")}</Badge>}
                    {m.meta?.loop === "closed" && <Badge tone="green">Loop closed</Badge>}
                  </div>
                  {m.text}
                </div>
              ))}
              {!view.messages.some((m) => m.thread !== "huddle" && m.thread !== "plan") && <p className="text-sm text-slate-500">No messages yet.</p>}
            </div>
          </Card>
        </div>
      )}

      {tab === "evaluation" && (
        <div className="space-y-5">
          {view.evaluation ? (
            <Card>
              <CardHeader title={`Teamwork trace: ${view.evaluation.subject}`} subtitle="TeamSTEPPS-aligned behaviours. Each line says whether the behaviour was observed, where the evidence is, the exact words, and what to do next time. A behaviour is only credited when the quoted words were found at the stated place." />
              <div className="p-4"><TraceTable evaluation={view.evaluation} /></div>
            </Card>
          ) : (
            <Card className="p-4 text-sm text-slate-600">
              The full trace (visit, note, SBAR, messages with colleagues and the huddle) is written when the huddle closes.
              {view.handoffs.find((h) => !h.authorIsAi)?.evaluation ? " The review of the SBAR handoff is already available below." : ""}
            </Card>
          )}
          {!view.evaluation && view.handoffs.filter((h) => !h.authorIsAi && h.evaluation).map((h) => (
            <Card key={h.id}><CardHeader title="Review of the SBAR handoff" /><div className="p-4"><TraceTable evaluation={h.evaluation!} /></div></Card>
          ))}
          <Card>
            <CardHeader title="Colleagues' handoffs as worked examples" subtitle="The same communication behaviours applied to the AI colleagues' SBARs." />
            <div className="space-y-3 p-4">
              {view.handoffs.filter((h) => h.authorIsAi).map((h) => (
                <details key={h.id} className="rounded-lg border border-slate-200 px-3 py-2">
                  <summary className="cursor-pointer text-sm font-medium text-slate-800">{h.authorName} to {h.toName}{h.evaluation ? ` · ${h.evaluation.behaviours.filter((b) => b.observed === "yes").length} of ${h.evaluation.behaviours.length} behaviours observed` : ""}</summary>
                  <div className="mt-3 space-y-3"><SbarCard handoff={h} />{h.evaluation && <TraceTable evaluation={h.evaluation} />}</div>
                </details>
              ))}
              {!view.handoffs.some((h) => h.authorIsAi) && <p className="text-sm text-slate-500">No colleague has handed off yet.</p>}
            </div>
          </Card>
        </div>
      )}

      {open && <ProvenancePanel view={view} entryId={open} onOpen={setOpen} onClose={() => setOpen(null)} />}
      <p className="mt-6 text-[14px] text-slate-400">Status key: {Object.values(STATUS_LABEL).join(" · ")}.</p>
    </div>
  );
}
