import AppShell from "@/components/AppShell";
import { Badge, Card, Empty, LinkButton, PageHeader } from "@/components/ui";
import { isFaculty, requireUser } from "@/lib/auth";
import { studentJourneyLabel } from "@/lib/courses/label";
import { all, parse } from "@/lib/db";
import type { JourneySpec } from "@/lib/journey/types";
import type { CaseProfile } from "@/lib/types";

export default async function StudentJourneys() {
  const user = await requireUser();
  const journeys = all<{ id: string; title: string; spec: string; profile: string }>("SELECT j.id, j.title, j.spec, c.profile FROM journeys j JOIN cases c ON c.id = j.case_id WHERE j.status = 'published' ORDER BY j.created_at");
  const runs = all<{ id: string; journey_id: string; status: string; student_stage_id: string; created_at: string }>("SELECT id, journey_id, status, student_stage_id, created_at FROM journey_runs WHERE user_id = ? ORDER BY created_at DESC", user.id);
  return (
    <AppShell user={user}>
      <PageHeader title="Care Journeys" subtitle="One patient, several professionals, one shared record. Take one role; the AI plays the patient and your colleagues. What each of you finds changes what the next one does." />
      {!journeys.length && <Empty>No care journeys have been published yet.</Empty>}
      <div className="grid gap-4 lg:grid-cols-2">
        {journeys.map((j) => {
          const spec = parse<JourneySpec>(j.spec, { summary: "", stages: [] });
          const c = parse<CaseProfile>(j.profile, {} as CaseProfile);
          const mine = runs.filter((r) => r.journey_id === j.id);
          // The journey title and summary are written for faculty and name the diagnoses.
          const faculty = isFaculty(user);
          const neutral = studentJourneyLabel(c.patient?.name, spec.stages.map((s) => s.roleTitle));
          return (
            <Card key={j.id} className="flex flex-col p-4">
              <h2 className="text-base font-semibold text-slate-900">{faculty ? j.title : neutral.title}</h2>
              <p className="mt-1 text-sm text-slate-600">{faculty ? spec.summary : `Seen in turn by ${spec.stages.length} professionals. Join as any one of them; the AI plays the rest.`}</p>
              <ol className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-slate-700">
                {[...spec.stages].sort((a, b) => a.order - b.order).map((s, i) => (
                  <li key={s.id} className="flex items-center gap-1.5">
                    {i > 0 && <span className="text-slate-400">→</span>}
                    <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5">{s.roleTitle}</span>
                  </li>
                ))}
              </ol>
              <div className="mt-3 text-xs text-slate-500">Patient: {c.patient?.name}, {c.patient?.age}</div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <LinkButton href={`/student/journeys/${j.id}`}>Choose your role</LinkButton>
                {mine.slice(0, 3).map((r) => {
                  const st = spec.stages.find((s) => s.id === r.student_stage_id);
                  return (
                    <LinkButton key={r.id} href={`/journey/${r.id}`} variant="secondary" size="sm">
                      {r.status === "complete" ? "Review" : "Resume"} as {st?.roleTitle.toLowerCase() || "your role"} <Badge tone={r.status === "complete" ? "green" : "amber"}>{r.status === "complete" ? "complete" : "in progress"}</Badge>
                    </LinkButton>
                  );
                })}
              </div>
            </Card>
          );
        })}
      </div>
    </AppShell>
  );
}
