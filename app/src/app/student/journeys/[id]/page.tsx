import { notFound } from "next/navigation";
import AppShell from "@/components/AppShell";
import JoinButtons from "@/components/journey/JoinButtons";
import { Card, LinkButton, PageHeader } from "@/components/ui";
import { isFaculty, requireUser } from "@/lib/auth";
import { studentJourneyLabel } from "@/lib/courses/label";
import { get, parse } from "@/lib/db";
import { clinician, loadJourney, resolveProfession } from "@/lib/journey/store";
import type { CaseProfile } from "@/lib/types";

export default async function JourneyIntro({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ assignment?: string }> }) {
  const { id } = await params;
  const { assignment } = await searchParams;
  const user = await requireUser();
  const j = loadJourney(id);
  if (!j || (j.row.status !== "published" && !isFaculty(user))) notFound();
  const c = parse<CaseProfile>(get<{ profile: string }>("SELECT profile FROM cases WHERE id = ?", j.row.case_id)?.profile, {} as CaseProfile);
  // Only what is on the record before anyone sees the patient is shown here.
  const stages = j.stages.map((s) => {
    const cl = clinician(s.clinicianId);
    return { id: s.id, order: s.order, roleTitle: s.roleTitle, clinicianName: cl.name, clinicianRole: cl.role, focus: s.focus, simTime: s.simTime, visitLabel: s.visitLabel, suggested: !!user.profession_id && resolveProfession(s).id === user.profession_id && (s.professionId === user.profession_id || !j.stages.some((o) => o.professionId === user.profession_id)) };
  });
  const firstSuggested = stages.findIndex((s) => s.suggested);
  // The journey title and summary are written for faculty and name the diagnoses; students get the patient and the roles.
  const neutral = studentJourneyLabel(c.patient?.name, stages.map((s) => s.roleTitle));
  const heading = isFaculty(user) ? { title: j.row.title, subtitle: j.spec.summary } : { title: neutral.title, subtitle: `Seen in turn by: ${neutral.roles}. Join as any one of them; the AI plays the rest.` };
  return (
    <AppShell user={user}>
      <PageHeader title={heading.title} subtitle={heading.subtitle} action={<LinkButton href="/student/journeys" variant="secondary" size="sm">All care journeys</LinkButton>} />
      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <div>
          <h2 className="mb-2 text-sm font-semibold text-slate-900">Choose the professional you will be</h2>
          <JoinButtons journeyId={j.row.id} assignmentId={assignment} stages={stages.map((s, i) => ({ ...s, suggested: s.suggested && i === firstSuggested }))} />
        </div>
        <div className="space-y-4">
          <Card className="p-4">
            <h2 className="text-sm font-semibold text-slate-900">The patient</h2>
            <p className="mt-1 text-sm text-slate-700">{c.patient?.name}, {c.patient?.age}, {c.patient?.sex}</p>
            <dl className="mt-2 space-y-1.5 text-[14px]">
              {(c.chartAtStart || []).slice(0, 4).map((x) => (
                <div key={x.label}>
                  <dt className="text-xs font-medium text-slate-500">{x.label}</dt>
                  <dd className="text-slate-700">{x.value}</dd>
                </div>
              ))}
            </dl>
          </Card>
          <Card className="p-4 text-sm text-slate-700">
            <h2 className="text-sm font-semibold text-slate-900">How it works</h2>
            <ol className="mt-2 list-decimal space-y-1.5 pl-4">
              <li>Encounters run in order. You watch each colleague&apos;s visit and read their SBAR handoff.</li>
              <li>You hold your own visit with the patient, starting from the shared record, then write your SBAR.</li>
              <li>You can page any colleague at any time for a consult or to clarify something.</li>
              <li>The team huddles to settle what is still disputed or unanswered.</li>
              <li>You get the integrated patient view, the coordinated care plan and feedback on your teamwork.</li>
            </ol>
            <p className="mt-2 text-xs text-slate-500">Allow 20 to 30 minutes. The later your role, the more you will watch before your own visit.</p>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
