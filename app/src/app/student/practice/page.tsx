import AppShell from "@/components/AppShell";
import PracticeGallery, { type PracticePatient } from "@/components/courses/PracticeGallery";
import { requireUser } from "@/lib/auth";
import { all, parse } from "@/lib/db";
import { mainIssueOf } from "@/lib/studio/store";
import type { CaseProfile } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Practice: every patient as a card, to be seen as often as the student likes. Not graded for the class. */
export default async function PracticePage() {
  const user = await requireUser();
  // Private practice visits only: assigned visits are on the home page.
  const mine = all<{ id: string; case_id: string; status: string }>(
    "SELECT id, case_id, status FROM encounters WHERE user_id = ? AND status != 'abandoned' AND assignment_id IS NULL AND journey_run_id IS NULL ORDER BY started_at",
    user.id,
  );
  const patients: PracticePatient[] = all<{ id: string; profile: string }>("SELECT id, profile FROM cases WHERE status = 'published' ORDER BY json_extract(profile, '$.patient.name')").map((row) => {
    const p = parse<Partial<CaseProfile>>(row.profile, {});
    const encs = mine.filter((e) => e.case_id === row.id);
    const done = encs.filter((e) => e.status === "scored" || e.status === "submitted");
    return {
      id: row.id,
      firstName: (p.patient?.name || "Patient").split(" ")[0],
      age: p.patient?.age ?? null,
      portrait: p.patient?.portrait || null,
      issue: mainIssueOf(p),
      attempts: done.length,
      lastId: done.length ? done[done.length - 1].id : null,
      activeId: [...encs].reverse().find((e) => e.status === "active" || e.status === "paused")?.id || null,
    };
  });
  return (
    <AppShell user={user}>
      <h1 className="text-[40px] font-semibold leading-tight text-slate-900">Practice</h1>
      <p className="mb-7 mt-1 text-slate-600">Any patient, as many times as you like. Set the temperament on the bars, then start. Practice visits are private to you.</p>
      <PracticeGallery patients={patients} />
    </AppShell>
  );
}
