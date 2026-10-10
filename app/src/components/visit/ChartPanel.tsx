"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import ArtifactView, { artifactTypeLabel } from "@/components/chart/ArtifactView";
import type { ChartView } from "@/lib/engine/encounter";

type Tab = "summary" | "visit" | "results" | "documents" | "activity" | "team";

const KIND_LABEL: Record<string, string> = { exam: "Remote exam", vitals: "Vitals", lab: "Lab", imaging: "Imaging", test: "Test", record: "Record", assessment: "Assessment", procedure: "Procedure" };

/** The electronic chart beside the visit. It only ever receives the student-safe ChartView. */
export default function ChartPanel({
  chart,
  fresh,
  onOrder,
  ordering,
  locked,
  teamTab,
}: {
  chart: ChartView;
  /** ids (facts, actions, documents) that arrived in the latest update, highlighted briefly */
  fresh: Set<string>;
  onOrder: (request: string) => Promise<void>;
  ordering: boolean;
  locked: boolean;
  teamTab?: ReactNode;
}) {
  const [tab, setTab] = useState<Tab>("summary");
  const [seen, setSeen] = useState({ visit: 0, results: 0, documents: 0 });
  const [docId, setDocId] = useState<string | null>(null);
  const [order, setOrder] = useState("");

  const counts = useMemo(
    () => ({
      visit: chart.sections.reduce((n, s) => n + s.items.length, 0),
      results: chart.results.length + chart.unmatched.length,
      documents: chart.artifacts.length,
    }),
    [chart],
  );
  // Mark the open tab as read.
  useEffect(() => {
    if (tab === "visit" || tab === "results" || tab === "documents") setSeen((s) => (s[tab] === counts[tab] ? s : { ...s, [tab]: counts[tab] }));
  }, [tab, counts]);

  const doc = chart.artifacts.find((d) => d.id === docId) || chart.artifacts[0];
  const allergies = chart.atStart.find((x) => /allerg/i.test(x.label));
  const header = chart.atStart.filter((x) => !/allerg/i.test(x.label));

  const tabs: { id: Tab; label: string; unread?: number }[] = [
    { id: "summary", label: "Summary" },
    { id: "visit", label: "This visit", unread: counts.visit - seen.visit },
    { id: "results", label: "Results & orders", unread: counts.results - seen.results },
    { id: "documents", label: "Chart review", unread: counts.documents - seen.documents },
    { id: "activity", label: "Activity" },
    ...(teamTab ? [{ id: "team" as Tab, label: "Care team" }] : []),
  ];

  async function submitOrder(e: React.FormEvent) {
    e.preventDefault();
    const text = order.trim();
    if (!text || ordering) return;
    setOrder("");
    await onOrder(text);
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-slate-300 bg-white">
      {/* Patient header strip */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-slate-300 bg-slate-800 px-4 py-2 text-white">
        <div>
          <div className="text-[15px] font-semibold leading-tight">{chart.patient.name}</div>
          <div className="text-xs text-slate-300">
            {chart.patient.age} y · {chart.patient.sex} · {chart.patient.pronouns}
          </div>
        </div>
        <div className="min-w-0 flex-1 text-xs">
          <div className="text-slate-400">Reason for visit</div>
          <div className="truncate text-slate-100">{chart.chiefComplaint}</div>
        </div>
        <div className={`rounded px-2 py-1 text-xs ${allergies && !/^(none|nkda|no known)/i.test(allergies.value.trim()) ? "bg-rose-600 text-white" : "bg-slate-700 text-slate-200"}`}>
          <span className="opacity-80">Allergies: </span>
          {allergies ? allergies.value : "Not on file"}
        </div>
      </div>

      <div className="flex gap-0.5 overflow-x-auto border-b border-slate-200 bg-slate-100 px-2 pt-1.5">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 whitespace-nowrap rounded-t-md border border-b-0 px-3 py-1.5 text-[13px] ${tab === t.id ? "border-slate-300 bg-white font-medium text-slate-900" : "border-transparent text-slate-600 hover:bg-slate-200"}`}
          >
            {t.label}
            {!!t.unread && t.unread > 0 && <span className="rounded-full bg-brand-600 px-1.5 text-[10px] font-semibold leading-4 text-white">{t.unread}</span>}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === "summary" && (
          <div className="space-y-3">
            <p className="rounded-md bg-slate-50 px-3 py-2 text-[13px] text-slate-700">{chart.setting}</p>
            {header.length === 0 && <p className="text-sm text-slate-500">Nothing on file before this visit.</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              {header.map((x, i) => (
                <div key={i} className="rounded-md border border-slate-200 p-3">
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{x.label}</div>
                  <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-slate-800">{x.value}</div>
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-500">History you take during the call is filed under “This visit”. Results appear when you request an exam, test or record.</p>
          </div>
        )}

        {tab === "visit" && (
          <div className="space-y-4">
            {chart.sections.length === 0 && <p className="text-sm text-slate-500">Nothing documented yet. What the patient tells you is filed here as you go.</p>}
            {chart.sections.map((s) => (
              <section key={s.category}>
                <h3 className="mb-1 border-b border-slate-200 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{s.label}</h3>
                <ul className="space-y-0.5">
                  {s.items.map((it) => (
                    <li key={it.id} className={`flex items-start gap-2 rounded px-1.5 py-1 text-[13px] ${fresh.has(it.id) ? "flash-new" : ""}`}>
                      <span className="mt-0.5 shrink-0 rounded bg-slate-100 px-1 text-[10px] tabular-nums text-slate-500" title={it.how === "record" ? "Already on record from an earlier encounter" : `Turn ${it.turn}`}>
                        {it.how === "record" ? "REC" : `T${it.turn}`}
                      </span>
                      <span className="text-slate-800">{it.text}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}

        {tab === "results" && (
          <div className="space-y-4">
            <form onSubmit={submitOrder} className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <label className="mb-1 block text-xs font-medium text-slate-600">Request an exam, test or record</label>
              <div className="flex gap-2">
                <input
                  value={order}
                  onChange={(e) => setOrder(e.target.value)}
                  disabled={locked || ordering}
                  placeholder="e.g. home blood pressure reading, lipid panel, guided abdominal exam, pharmacy refill history"
                  className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:bg-slate-100"
                />
                <button disabled={locked || ordering || !order.trim()} className="rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white disabled:bg-slate-300">
                  {ordering ? "Sending" : "Request"}
                </button>
              </div>
              <p className="mt-1.5 text-[11px] text-slate-500">Only results approved for this case can come back. Exams are guided over video.</p>
            </form>
            {chart.results.length === 0 && chart.unmatched.length === 0 && <p className="text-sm text-slate-500">No results yet.</p>}
            <ul className="space-y-2">
              {chart.results.map((r) => (
                <li key={r.id} className={`rounded-md border p-3 ${r.abnormal ? "border-amber-300 bg-amber-50/60" : "border-slate-200"} ${fresh.has(r.id) ? "flash-new" : ""}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-semibold text-slate-900">{r.name}</span>
                    <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
                      {r.abnormal && <span className="rounded bg-amber-200 px-1.5 font-medium text-amber-900">Abnormal</span>}
                      {KIND_LABEL[r.kind] || r.kind} · T{r.turn}
                    </span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-slate-800">{r.result}</p>
                </li>
              ))}
              {chart.unmatched.map((u, i) => (
                <li key={"u" + i} className="rounded-md border border-dashed border-slate-300 p-3 text-[13px] text-slate-600">
                  <span className="font-medium text-slate-800">{u.request}</span>: no approved result is available for this in the case file.
                </li>
              ))}
            </ul>
          </div>
        )}

        {tab === "documents" && (
          <div className="grid gap-4 md:grid-cols-[13rem_1fr]">
            <ul className="space-y-1">
              {chart.artifacts.length === 0 && <li className="text-sm text-slate-500">No documents in the chart yet.</li>}
              {chart.artifacts.map((d) => (
                <li key={d.id}>
                  <button
                    onClick={() => setDocId(d.id)}
                    className={`w-full rounded-md border px-2.5 py-2 text-left ${doc?.id === d.id ? "border-brand-500 bg-brand-50" : "border-slate-200 hover:bg-slate-50"} ${fresh.has(d.id) ? "flash-new" : ""}`}
                  >
                    <div className="flex items-center justify-between text-[10px] font-medium uppercase tracking-wide text-slate-500">
                      {artifactTypeLabel(d.type)}
                      {d.turn > 0 && <span className="rounded bg-brand-100 px-1 normal-case tracking-normal text-brand-700">new · T{d.turn}</span>}
                    </div>
                    <div className="text-[13px] font-medium leading-snug text-slate-900">{d.title}</div>
                    {d.date && <div className="text-[11px] text-slate-500">{d.date}</div>}
                  </button>
                </li>
              ))}
            </ul>
            <div className="min-w-0">{doc && <ArtifactView artifact={doc} />}</div>
          </div>
        )}

        {tab === "activity" && (
          <div>
            <p className="mb-2 text-xs text-slate-500">Everything released to you in this visit, in order.</p>
            {chart.log.length === 0 && <p className="text-sm text-slate-500">Nothing yet.</p>}
            <ol className="space-y-1">
              {chart.log.map((l, i) => (
                <li key={i} className="flex items-start gap-2 text-[13px]">
                  <span className="mt-0.5 w-8 shrink-0 rounded bg-slate-100 px-1 text-center text-[10px] tabular-nums text-slate-500">T{l.turn}</span>
                  <span className={`mt-0.5 w-16 shrink-0 text-[10px] font-medium uppercase tracking-wide ${l.kind === "fact" ? "text-brand-600" : l.kind === "result" ? "text-amber-700" : "text-violet-700"}`}>{l.kind === "fact" ? "History" : l.kind === "result" ? "Result" : "Document"}</span>
                  <span className="text-slate-800">{l.text}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {tab === "team" && teamTab}
      </div>
    </div>
  );
}
