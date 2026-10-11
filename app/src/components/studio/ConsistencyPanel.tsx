"use client";

import { useState } from "react";
import { Badge, Button, cx } from "@/components/ui";
import type { CaseProfile } from "@/lib/types";
import type { ConsistencyResult, Issue } from "@/lib/studio/checks";
import { describeOp, wordingWarnings } from "@/lib/studio/patch";
import { SECTIONS, type SectionId } from "@/lib/studio/profile";
import { Notice, Panel } from "./fields";
import PatchDiff from "./PatchDiff";

const SEV = { high: { tone: "red", label: "High" }, medium: { tone: "amber", label: "Medium" }, low: { tone: "slate", label: "Low" } } as const;
const sectionLabel = (id: SectionId) => SECTIONS.find((s) => s.id === id)?.label || "Overview";

function IssueCard({ issue, p, onApply, onStatus, go }: { issue: Issue; p: CaseProfile; onApply: (i: Issue) => string | null; onStatus: (id: string, s: Issue["status"]) => void; go: (s: SectionId) => void }) {
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closed = issue.status !== "open";
  // A fix that changes a value in one wording of a fact and not the other would leave the fact disagreeing with itself.
  const warnings = issue.fix && !closed ? wordingWarnings(p, issue.fix.ops) : [];
  return (
    <li className={cx("rounded-md border p-3", closed ? "border-slate-200 bg-slate-50 opacity-75" : issue.severity === "high" ? "border-rose-200 bg-white" : "border-slate-200 bg-white")}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={SEV[issue.severity].tone}>{SEV[issue.severity].label}</Badge>
        <Badge tone={issue.source === "model" ? "violet" : "blue"}>{issue.source === "model" ? "Clinical review (AI)" : "Structure check"}</Badge>
        {issue.status === "fixed" && <Badge tone="green">Fix applied</Badge>}
        {issue.status === "dismissed" && <Badge>Dismissed</Badge>}
        <span className="text-xs text-slate-500">{issue.where}</span>
      </div>
      <p className="mt-1.5 text-sm font-medium text-slate-900">{issue.title}</p>
      <p className="mt-0.5 text-sm leading-relaxed text-slate-700">{issue.why}</p>
      {issue.fix && !closed && (
        <div className="mt-2 rounded border border-slate-200 bg-slate-50 p-2">
          <p className="text-xs text-slate-700">
            <span className="font-semibold">Proposed fix: </span>
            {issue.fix.summary}{" "}
            <button type="button" className="text-brand-700 underline" onClick={() => setShow(!show)}>
              {show ? "Hide" : "Show"} the {issue.fix.ops.length} edit{issue.fix.ops.length === 1 ? "" : "s"}
            </button>
          </p>
          {show && (
            <div className="mt-2">
              <PatchDiff views={issue.fix.ops.map((op) => describeOp(p, op))} />
            </div>
          )}
          {warnings.map((w) => (
            <Notice key={w} tone="amber" className="mt-2">
              <span className="font-semibold">Check before applying: </span>
              {w}
            </Notice>
          ))}
        </div>
      )}
      {error && (
        <Notice tone="amber" className="mt-2">
          {error}
        </Notice>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {!closed && issue.fix && (
          <Button size="sm" onClick={() => setError(onApply(issue))}>
            Apply fix
          </Button>
        )}
        <Button variant="secondary" size="sm" onClick={() => go(issue.section)}>
          Open {sectionLabel(issue.section)}
        </Button>
        {!closed ? (
          <>
            {!issue.fix && (
              <Button variant="ghost" size="sm" onClick={() => onStatus(issue.id, "fixed")}>
                Mark as fixed
              </Button>
            )}
            <Button variant="ghost" size="sm" title="Keep the case as it is; this issue will not block publishing" onClick={() => onStatus(issue.id, "dismissed")}>
              Dismiss
            </Button>
          </>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => onStatus(issue.id, "open")}>
            Reopen
          </Button>
        )}
      </div>
    </li>
  );
}

export default function ConsistencyPanel({
  p,
  result,
  stale,
  running,
  seconds,
  error,
  onRun,
  onApply,
  onStatus,
  go,
}: {
  p: CaseProfile;
  result: ConsistencyResult | null;
  stale: boolean;
  running: boolean;
  seconds: number;
  error: string | null;
  onRun: () => void;
  onApply: (i: Issue) => string | null;
  onStatus: (id: string, s: Issue["status"]) => void;
  go: (s: SectionId) => void;
}) {
  const open = (result?.issues || []).filter((i) => i.status === "open");
  const closed = (result?.issues || []).filter((i) => i.status !== "open");
  const n = (sev: Issue["severity"]) => open.filter((i) => i.severity === sev).length;
  return (
    <Panel
      title="Consistency check"
      subtitle="Two passes over the saved patient. Structure checks are rules: broken links, objectives nothing can assess, documents that are never released, no volunteered chief concern, duplicated facts. The clinical review is a model reading the history, medications, vitals, results, documents and answer key against each other for contradictions. Every finding says where it is and why; fixes are proposals you apply one at a time."
      action={
        <Button onClick={onRun} disabled={running}>
          {running ? `Checking... ${seconds}s` : result ? "Run again" : "Run the check"}
        </Button>
      }
    >
      {running && (
        <Notice tone="teal" className="mb-3">
          Structure checks are done in under a second. The clinical review reads the whole case and usually takes 45 to 90 seconds.
        </Notice>
      )}
      {error && (
        <Notice tone="red" className="mb-3">
          {error}
        </Notice>
      )}
      {!result && !running && <p className="text-sm text-slate-600">This patient has not been checked yet. Run the check before publishing: high-severity findings block publishing until you fix them, dismiss them or confirm that you want to publish anyway.</p>}
      {result && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            <Badge tone={n("high") ? "red" : "green"}>{n("high")} high</Badge>
            <Badge tone={n("medium") ? "amber" : "slate"}>{n("medium")} medium</Badge>
            <Badge>{n("low")} low</Badge>
            <span className="text-xs text-slate-500">
              open · last run {new Date(result.ranAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
            </span>
          </div>
          {stale && !running && (
            <Notice tone="amber" className="mb-3">
              The patient has been edited since this check. Findings below may be out of date; run it again before publishing.
            </Notice>
          )}
          {result.modelError && (
            <Notice tone="amber" className="mb-3">
              The clinical review did not complete ({result.modelError}). Only the structure checks are shown. Run the check again.
            </Notice>
          )}
          {result.summary && <p className="mb-3 text-sm text-slate-700">{result.summary}</p>}
          {!open.length && !result.modelError && <Notice tone="green">No open issues.</Notice>}
          <ul className="space-y-2">
            {open.map((i) => (
              <IssueCard key={i.id} issue={i} p={p} onApply={onApply} onStatus={onStatus} go={go} />
            ))}
          </ul>
          {closed.length > 0 && (
            <details className="mt-4">
              <summary className="cursor-pointer text-sm text-slate-600">
                {closed.length} resolved or dismissed
              </summary>
              <ul className="mt-2 space-y-2">
                {closed.map((i) => (
                  <IssueCard key={i.id} issue={i} p={p} onApply={onApply} onStatus={onStatus} go={go} />
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </Panel>
  );
}
