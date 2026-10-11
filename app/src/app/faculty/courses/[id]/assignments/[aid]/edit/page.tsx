import Link from "next/link";
import { notFound } from "next/navigation";
import AppShell from "@/components/AppShell";
import AssignmentBuilder from "@/components/courses/AssignmentBuilder";
import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { get } from "@/lib/db";
import { assignmentFor, publishedCaseBriefs, publishedJourneys } from "@/lib/courses";
import { professions } from "@/lib/professions";

export default async function EditAssignment({ params }: { params: Promise<{ id: string; aid: string }> }) {
  const user = await requireUser("faculty");
  const { id, aid } = await params;
  const found = assignmentFor(user, aid);
  if (!found || found.course.id !== id) notFound();
  const { a, course } = found;
  const started = get<{ n: number }>("SELECT COUNT(*) AS n FROM encounters WHERE assignment_id = ?", a.id)!.n;
  return (
    <AppShell user={user}>
      <div className="mb-2 text-xs text-slate-500">
        <Link href={`/faculty/courses/${course.id}`} className="hover:text-brand-700">
          {course.name}
        </Link>{" "}
        /{" "}
        <Link href={`/faculty/courses/${course.id}/assignments/${a.id}`} className="hover:text-brand-700">
          {a.title}
        </Link>{" "}
        / Edit
      </div>
      <PageHeader title="Edit Assignment" subtitle={started ? `${started} visit${started === 1 ? " has" : "s have"} already been started. Changes apply to visits started from now on.` : "Nobody has started this assignment yet."} />
      <AssignmentBuilder
        courseId={course.id}
        courseProfession={course.profession_id}
        cases={publishedCaseBriefs()}
        journeys={publishedJourneys().map((j) => ({ id: j.id, title: j.title }))}
        professionNames={Object.fromEntries(professions().map((p) => [p.id, p.name]))}
        initial={{ id: a.id, title: a.title, instructions: a.instructions, type: a.type, caseIds: a.caseIds, journeyId: a.journey_id, settings: a.settings, dueAt: a.due_at }}
      />
    </AppShell>
  );
}
