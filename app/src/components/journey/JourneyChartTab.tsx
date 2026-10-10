"use client";

import { useState } from "react";
import ConsultPanel from "./ConsultPanel";
import { EntryRow, ProvenancePanel, SbarCard, Spinner, STATUS_COLOR, useRun } from "./shared";
import { STATUS_LABEL, type EntryStatus } from "@/lib/journey/types";

const OPEN: EntryStatus[] = ["disputed", "open_question", "uncertain"];

/**
 * The "Care team" tab of the visit chart: the handoff the learner received, the shared patient
 * state so far with provenance on every line, and a panel to page a colleague.
 */
export default function JourneyChartTab({ runId, encounterId }: { runId: string; encounterId: string }) {
  const { view, error, refresh } = useRun(runId, { opened: encounterId });
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "open">("all");
  if (error) return <p className="text-sm text-rose-700">{error}</p>;
  if (!view) return <Spinner label="Loading the care team's record" />;

  const mine = view.stages.find((s) => s.encounterId === encounterId) || view.stages.find((s) => s.isStudent);
  const order = mine?.stage.order ?? 99;
  const received = mine ? view.handoffs.filter((h) => h.toStage === mine.stage.id).pop() : undefined;
  const prior = view.entries.filter((e) => e.stageOrder < order || (e.stageId === mine?.stage.id && (e.kind === "consult" || e.kind === "callout")));
  const shown = filter === "open" ? prior.filter((e) => OPEN.includes(e.effectiveStatus)) : prior;
  const groups = [
    { key: "record", title: "Existing record", sub: "Before this journey" },
    ...view.stages.filter((s) => s.stage.order <= order).map((s) => ({ key: s.stage.id, title: `Encounter ${s.stage.order}: ${s.stage.roleTitle}`, sub: `${s.clinicianName} · ${s.stage.simTime}` })),
  ];
  const openCount = prior.filter((e) => OPEN.includes(e.effectiveStatus)).length;

  return (
    <div className="space-y-5 text-sm">
      {mine && (
        <p className="text-xs text-slate-500">
          You are the {mine.stage.roleTitle.toLowerCase()} in encounter {mine.stage.order} of {view.stages.length}. {mine.stage.focus}
        </p>
      )}
      <section>
        <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Handoff you received</h3>
        {received ? <SbarCard handoff={received} /> : <p className="rounded-md border border-dashed border-slate-300 px-3 py-2 text-slate-500">You are the first professional to see this patient in this journey, so there is no handoff. Start from the existing record.</p>}
      </section>

      <section>
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Shared patient state so far</h3>
          <div className="flex rounded-md border border-slate-200 text-xs">
            <button onClick={() => setFilter("all")} className={`px-2 py-1 ${filter === "all" ? "bg-slate-100 font-medium text-slate-900" : "text-slate-600"}`}>All ({prior.length})</button>
            <button onClick={() => setFilter("open")} className={`px-2 py-1 ${filter === "open" ? "bg-slate-100 font-medium text-slate-900" : "text-slate-600"}`}>Uncertain or unresolved ({openCount})</button>
          </div>
        </div>
        <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
          {(Object.keys(STATUS_LABEL) as EntryStatus[]).map((s) => (
            <span key={s} className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: STATUS_COLOR[s] }} />{STATUS_LABEL[s]}</span>
          ))}
        </div>
        <div className="space-y-3">
          {groups.map((g) => {
            const items = shown.filter((e) => e.stageId === g.key);
            if (!items.length) return null;
            return (
              <div key={g.key} className="rounded-lg border border-slate-200 bg-white">
                <div className="border-b border-slate-100 px-3 py-1.5">
                  <div className="text-xs font-semibold text-slate-800">{g.title}</div>
                  <div className="text-[11px] text-slate-500">{g.sub}</div>
                </div>
                <div className="p-1">{items.map((e) => <EntryRow key={e.id} entry={e} onOpen={setOpen} showWho={false} dense />)}</div>
              </div>
            );
          })}
          {!shown.length && <p className="text-slate-500">Nothing here yet.</p>}
        </div>
        <p className="mt-1.5 text-[11px] text-slate-400">Select any line to see who recorded it, when, and the words it rests on.</p>
      </section>

      <section>
        <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Page a colleague</h3>
        <ConsultPanel view={view} refresh={refresh} compact />
      </section>
      {open && <ProvenancePanel view={view} entryId={open} onOpen={setOpen} onClose={() => setOpen(null)} />}
    </div>
  );
}
