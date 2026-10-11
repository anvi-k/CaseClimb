import AppShell from "@/components/AppShell";
import MakePatient from "@/components/courses/MakePatient";
import PracticeLibrary, { type PracticeCase } from "@/components/courses/PracticeLibrary";
import StartVisit from "@/components/courses/StartVisit";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { heldAssignmentIds, publishedCaseCards } from "@/lib/courses";
import { profession, professions } from "@/lib/professions";

export default async function PracticePage() {
  const user = await requireUser();
  const held = heldAssignmentIds();
  const mine = all<{ id: string; case_id: string; status: string; score: number | null; faculty_score: number | null; assignment_id: string | null; journey_run_id: string | null }>(
    "SELECT id, case_id, status, score, faculty_score, assignment_id, journey_run_id FROM encounters WHERE user_id = ? AND status != 'abandoned' ORDER BY started_at",
    user.id,
  );
  const cases: PracticeCase[] = publishedCaseCards().map((c) => {
    const encs = mine.filter((e) => e.case_id === c.id);
    const done = encs.filter((e) => e.status === "scored" || e.status === "submitted");
    // Results the instructor is still holding stay hidden here too.
    const visible = done.filter((e) => !e.assignment_id || !held.has(e.assignment_id));
    const scores = visible.map((e) => e.faculty_score ?? e.score).filter((x): x is number => x !== null);
    return {
      ...c,
      attempts: done.length,
      best: scores.length ? Math.max(...scores) : null,
      lastId: visible.length ? visible[visible.length - 1].id : null,
      // Only free-practice visits resume from here; assignment and journey visits resume from their own pages.
      activeId: [...encs].reverse().find((e) => (e.status === "active" || e.status === "paused") && !e.assignment_id && !e.journey_run_id)?.id || null,
    };
  });
  // Private patients this student asked for. Only a safe label is read from the case.
  const own = all<{ id: string; name: string | null; age: number | null; type: string | null; n: number }>(
    `SELECT c.id, json_extract(c.profile, '$.patient.name') AS name, json_extract(c.profile, '$.patient.age') AS age, json_extract(c.profile, '$.encounterType') AS type,
            (SELECT COUNT(*) FROM encounters e WHERE e.case_id = c.id AND e.user_id = c.owner_id AND e.status = 'scored') AS n
     FROM cases c WHERE c.owner_id = ? AND c.status = 'draft' AND c.origin = 'ai_draft' ORDER BY c.created_at DESC LIMIT 12`,
    user.id,
  );
  return (
    <AppShell user={user}>
      <PageHeader title="Practice" subtitle="Any published patient, as many times as you like. Practice visits are not graded, and each one updates your skill ratings." />
      {user.role === "student" && (
        <Card className="mb-5">
          <CardHeader title="Make your own practice patient" subtitle="Describe who you want to practice with, or the skill you want to work on, and a private patient is written for you." />
          <div className="space-y-4 p-4">
            <MakePatient roleName={profession(user.profession_id).name} />
            {own.length > 0 && (
              <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
                {own.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span>
                      <span className="font-medium text-slate-900">{(c.name || "Patient").split(" ")[0]}{c.age ? `, ${c.age}` : ""}</span>
                      <span className="ml-2 text-slate-500">{c.type} · {c.n} scored visit{c.n === 1 ? "" : "s"}</span>
                    </span>
                    <span className="flex gap-2">
                      {c.n > 0 && <StartVisit body={{ caseId: c.id, mode: "practice", followUp: true }} label="Follow-up visit" variant="secondary" size="sm" />}
                      <StartVisit body={{ caseId: c.id, mode: "practice", perturb: c.n > 0 }} label={c.n > 0 ? "Start over" : "Start visit"} size="sm" />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      )}
      <PracticeLibrary cases={cases} professionNames={Object.fromEntries(professions().map((p) => [p.id, p.name]))} myProfession={user.role === "student" ? user.profession_id : null} />
    </AppShell>
  );
}
