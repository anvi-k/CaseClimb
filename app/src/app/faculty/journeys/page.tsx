import AppShell from "@/components/AppShell";
import { Badge, Card, Empty, LinkButton, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { all, parse } from "@/lib/db";
import type { JourneySpec } from "@/lib/journey/types";

export default async function FacultyJourneys() {
  const user = await requireUser("faculty");
  const rows = all<{ id: string; title: string; status: string; spec: string; runs: number; done: number }>(
    `SELECT j.id, j.title, j.status, j.spec,
       (SELECT COUNT(*) FROM journey_runs r WHERE r.journey_id = j.id) AS runs,
       (SELECT COUNT(*) FROM journey_runs r WHERE r.journey_id = j.id AND r.status = 'complete') AS done
     FROM journeys j WHERE j.status != 'archived' ORDER BY j.created_at DESC`,
  );
  return (
    <AppShell user={user}>
      <PageHeader title="Care Journeys" subtitle="One patient case, several professionals in sequence, one shared patient state. Students join as one professional; the AI plays the others from the clinician personas." action={<LinkButton href="/faculty/journeys/new">New care journey</LinkButton>} />
      {!rows.length && <Empty>No care journeys yet. Create one from any published patient case.</Empty>}
      <div className="space-y-3">
        {rows.map((j) => {
          const spec = parse<JourneySpec>(j.spec, { summary: "", stages: [] });
          return (
            <Card key={j.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold text-slate-900">{j.title}</h2>
                  <Badge tone={j.status === "published" ? "green" : "amber"}>{j.status === "published" ? "Published" : "Draft"}</Badge>
                </div>
                <ol className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-700">
                  {[...spec.stages].sort((a, b) => a.order - b.order).map((s, i) => (
                    <li key={s.id} className="flex items-center gap-1.5">
                      {i > 0 && <span className="text-slate-400">→</span>}
                      <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5">{s.roleTitle}</span>
                    </li>
                  ))}
                </ol>
                <p className="mt-1.5 text-xs text-slate-500">{j.runs} student run{j.runs === 1 ? "" : "s"}, {j.done} complete</p>
              </div>
              <LinkButton href={`/faculty/journeys/${j.id}`} variant="secondary">Open</LinkButton>
            </Card>
          );
        })}
      </div>
    </AppShell>
  );
}
