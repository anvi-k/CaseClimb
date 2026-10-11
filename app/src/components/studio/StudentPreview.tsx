"use client";

import { useState } from "react";
import ArtifactView from "@/components/chart/ArtifactView";
import { Badge, cx } from "@/components/ui";
import type { CaseProfile } from "@/lib/types";
import { releaseLabel } from "@/lib/studio/profile";
import { Notice, Panel } from "./fields";

/** Exactly what a student has in front of them before the first question: the brief and the chart at start. */
export default function StudentPreview({ p, roleTitle }: { p: CaseProfile; roleTitle: string }) {
  const start = p.artifacts.filter((d) => d.release.when === "start");
  const later = p.artifacts.filter((d) => d.release.when !== "start");
  const [open, setOpen] = useState<string | null>(start[0]?.id || null);
  const doc = start.find((d) => d.id === open);
  return (
    <div className="space-y-4">
      <Notice tone="teal">
        This is what a student sees when the visit opens, before asking anything. It updates as you edit. To experience the conversation itself, use <span className="font-medium">Test visit</span>.
      </Notice>
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Before the visit" subtitle="The brief the student reads before joining the call.">
          <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">Telehealth visit · you are the {roleTitle}</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">
              {p.patient.name || "Unnamed patient"}, {p.patient.age}
            </p>
            <p className="text-sm text-slate-600">{[p.patient.sex, p.patient.pronouns].filter(Boolean).join(" · ")}</p>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{p.scenario.studentBrief || <span className="text-rose-700">The student brief is empty.</span>}</p>
            {p.scenario.tasks.filter((t) => t.trim()).length > 0 && (
              <>
                <p className="mt-3 text-xs font-semibold text-slate-600">Your tasks</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-slate-800">
                  {p.scenario.tasks.filter((t) => t.trim()).map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              </>
            )}
            <p className="mt-3 text-xs text-slate-500">Time limit: {p.scenario.timeLimitMin} minutes</p>
          </div>
          <p className="mt-3 text-xs font-semibold text-slate-600">On the video call</p>
          <p className="mt-1 text-sm italic text-slate-700">{p.patient.appearance || "No appearance description."}</p>
        </Panel>

        <Panel title="Chart at the start" subtitle="The record as it stands before the first question.">
          {p.chartAtStart.length ? (
            <dl className="divide-y divide-slate-100 rounded-md border border-slate-200">
              {p.chartAtStart.map((it, i) => (
                <div key={i} className="grid grid-cols-[9rem_1fr] gap-2 px-3 py-1.5 text-sm">
                  <dt className="text-xs font-medium text-slate-500">{it.label}</dt>
                  <dd className="whitespace-pre-wrap text-slate-800">{it.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-sm text-slate-500">The chart header is empty.</p>
          )}
          <p className="mb-1.5 mt-4 text-xs font-semibold text-slate-600">Documents ({start.length})</p>
          {!start.length && <p className="text-sm text-slate-500">No documents are available at the start.</p>}
          <div className="flex flex-wrap gap-1.5">
            {start.map((d) => (
              <button key={d.id} type="button" onClick={() => setOpen(open === d.id ? null : d.id)} className={cx("rounded border px-2 py-1 text-xs", open === d.id ? "border-brand-600 bg-brand-50 text-brand-900" : "border-slate-300 text-slate-700 hover:bg-slate-50")}>
                {d.title || "Untitled"}
              </button>
            ))}
          </div>
          {doc && (
            <div className="mt-2 rounded-md border border-slate-200 p-3">
              <ArtifactView artifact={doc} />
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Not visible yet" subtitle="Faculty only. Students do not see this list; these appear as they earn them.">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold text-slate-600">Documents released later ({later.length})</p>
            <ul className="mt-1 space-y-1 text-sm text-slate-700">
              {later.map((d) => (
                <li key={d.id}>
                  {d.title} <span className="text-xs text-amber-700">· {releaseLabel(p, d)}</span>
                </li>
              ))}
              {!later.length && <li className="text-slate-500">None</li>}
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-600">To be elicited or ordered</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <Badge tone="green">{p.facts.filter((f) => f.tier === "initial").length} facts volunteered</Badge>
              <Badge tone="blue">{p.facts.filter((f) => f.tier === "discoverable").length} when asked</Badge>
              <Badge tone="amber">{p.facts.filter((f) => f.tier === "reluctant").length} need trust</Badge>
              <Badge tone="red">{p.facts.filter((f) => f.tier === "hidden").length} guarded</Badge>
              <Badge>{p.actions.length} exams and orders</Badge>
            </div>
            <p className="mt-2 text-xs text-slate-500">Patient&apos;s first words when asked what brings them in:</p>
            <p className="text-sm italic text-slate-700">&ldquo;{p.scenario.openingLine}&rdquo;</p>
          </div>
        </div>
      </Panel>
    </div>
  );
}
