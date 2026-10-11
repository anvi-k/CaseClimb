import { notFound } from "next/navigation";
import AppShell from "@/components/AppShell";
import JourneyBuilder from "@/components/journey/JourneyBuilder";
import { Badge, Card, CardHeader, Empty, LinkButton, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { all, parse } from "@/lib/db";
import { builderOptions } from "@/lib/journey/facultyData";
import { loadJourney } from "@/lib/journey/store";
import { BEHAVIOURS, type TraceEvaluation } from "@/lib/journey/types";

export default async function FacultyJourney({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser("faculty");
  const j = loadJourney(id);
  if (!j) notFound();
  const runs = all<{ id: string; status: string; student_stage_id: string; evaluation: string | null; created_at: string; name: string; entries: number; messages: number }>(
    `SELECT r.id, r.status, r.student_stage_id, r.evaluation, r.created_at, u.name,
       (SELECT COUNT(*) FROM state_entries e WHERE e.run_id = r.id) AS entries,
       (SELECT COUNT(*) FROM team_messages m WHERE m.run_id = r.id AND m.thread LIKE 'consult:%' AND m.from_role != '' AND json_extract(m.meta, '$.fromIsAi') = 0) AS messages
     FROM journey_runs r JOIN users u ON u.id = r.user_id WHERE r.journey_id = ? ORDER BY r.created_at DESC`,
    id,
  );
  const domains = [...new Set(BEHAVIOURS.map((b) => b.domain))];
  return (
    <AppShell user={user}>
      <PageHeader
        title={j.row.title}
        subtitle={j.spec.summary}
        action={
          <span className="flex items-center gap-2">
            <Badge tone={j.row.status === "published" ? "green" : "amber"}>{j.row.status === "published" ? "Published" : "Draft"}</Badge>
            <LinkButton href={`/student/journeys/${j.row.id}`} variant="secondary" size="sm">Try it as a student</LinkButton>
            <LinkButton href="/faculty/journeys" variant="secondary" size="sm">All care journeys</LinkButton>
          </span>
        }
      />
      <Card className="mb-5">
        <CardHeader title="Student runs" subtitle="Open a run to see its shared patient state, provenance, handoffs, huddle and care plan exactly as the student saw them." />
        <div className="p-4">
          {!runs.length && <Empty>No student has started this journey yet.</Empty>}
          <div className="space-y-3">
            {runs.map((r) => {
              const ev = parse<TraceEvaluation | null>(r.evaluation, null);
              const stage = j.stages.find((s) => s.id === r.student_stage_id);
              return (
                <div key={r.id} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="text-sm font-semibold text-slate-900">{r.name}</span>
                      <span className="text-sm text-slate-600"> as {stage?.roleTitle.toLowerCase() || "unknown role"}</span>
                      <div className="text-xs text-slate-500">Started {r.created_at} · {r.entries} entries in the shared state · {r.messages} message{r.messages === 1 ? "" : "s"} to colleagues</div>
                    </div>
                    <span className="flex items-center gap-2">
                      <Badge tone={r.status === "complete" ? "green" : "amber"}>{r.status === "complete" ? "Complete" : r.status === "huddle" ? "In the huddle" : "In progress"}</Badge>
                      <LinkButton href={`/journey/${r.id}`} size="sm" variant="secondary">Open run</LinkButton>
                    </span>
                  </div>
                  {ev ? (
                    <div className="mt-3">
                      <div className="grid gap-2 sm:grid-cols-4">
                        {domains.map((d) => {
                          const items = BEHAVIOURS.filter((b) => b.domain === d).map((b) => ev.behaviours.find((x) => x.key === b.key)).filter(Boolean);
                          const yes = items.filter((x) => x!.observed === "yes").length;
                          const app = items.filter((x) => x!.observed !== "na").length;
                          return (
                            <div key={d} className="rounded-md bg-slate-50 px-3 py-2">
                              <div className="text-xs text-slate-500">{d}</div>
                              <div className="text-sm font-semibold text-slate-900">{yes} of {app} observed</div>
                            </div>
                          );
                        })}
                      </div>
                      <p className="mt-2 text-sm text-slate-700">{ev.summary}</p>
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs font-medium text-brand-700">Behaviours not observed, with evidence location and feedback</summary>
                        <ul className="mt-2 space-y-1.5 text-[16px]">
                          {ev.behaviours.filter((b) => b.observed === "no").map((b) => (
                            <li key={b.key} className="rounded border border-slate-200 px-2.5 py-1.5">
                              <span className="font-medium text-slate-800">{BEHAVIOURS.find((x) => x.key === b.key)?.label}</span>
                              {b.location && <span className="text-slate-500"> · {b.location.replace("->", "→")}</span>}
                              <div className="text-slate-700">{b.feedback}</div>
                            </li>
                          ))}
                        </ul>
                      </details>
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-slate-500">The teamwork trace is written when the student closes the huddle.</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </Card>
      <h2 className="mb-3 text-[26px] font-semibold text-slate-900">Edit this journey</h2>
      <JourneyBuilder {...builderOptions()} initial={{ id: j.row.id, title: j.row.title, summary: j.spec.summary, caseId: j.row.case_id, status: j.row.status, stages: j.stages }} />
    </AppShell>
  );
}
