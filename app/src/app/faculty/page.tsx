import Link from "next/link";
import AppShell from "@/components/AppShell";
import Icon from "@/components/Icon";
import CreateCourse from "@/components/courses/CreateCourse";
import { LinkButton } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { all, parse } from "@/lib/db";
import { coursesOf, feedbackUrl, reviewQueue, studentAssignments } from "@/lib/courses";

/** The instructor's home: one class, the two things they do with it, and who needs attention. */
export default async function FacultyHome({ searchParams }: { searchParams: Promise<{ class?: string }> }) {
  const user = await requireUser("faculty");
  const { class: wanted } = await searchParams;
  const courses = coursesOf(user);
  const course = courses.find((c) => c.id === wanted) || courses[0];

  if (!course) {
    return (
      <AppShell user={user}>
        <div className="mx-auto max-w-3xl">
          <h1 className="text-[40px] font-semibold leading-tight text-slate-900">Start a Class</h1>
          <p className="mb-6 mt-1 text-slate-600">Name your class. You will get a join code to give your students, and then you can assign them patients.</p>
          <div className="rounded-2xl border border-slate-200 bg-white">
            <CreateCourse />
          </div>
        </div>
      </AppShell>
    );
  }

  // Each student's own list (class-wide patients plus any assigned to them by name) and how much of it is done.
  const students = all<{ id: string; name: string }>("SELECT u.id, u.name FROM enrollments en JOIN users u ON u.id = en.user_id WHERE en.course_id = ? ORDER BY u.name", course.id).map((s) => {
    const mine = new Map<string, boolean>();
    for (const { a, cases } of studentAssignments(s.id)) {
      if (a.journey_id || a.course_id !== course.id) continue;
      for (const c of cases) mine.set(c.card.id, mine.get(c.card.id) || c.scoredCount > 0);
    }
    return { ...s, total: mine.size, done: [...mine.values()].filter(Boolean).length };
  });
  const review = reviewQueue(user).filter((r) => r.course_id === course.id);

  return (
    <AppShell user={user}>
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <h1 className="text-[40px] font-semibold leading-tight text-slate-900">{course.name}</h1>
            <p className="mt-1 text-slate-600">
              {students.length} student{students.length === 1 ? "" : "s"} · Join code <span className="font-mono font-semibold text-slate-900">{course.join_code}</span>
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <LinkButton href={`/faculty/courses/${course.id}/assignments/new`} size="lg" className="!rounded-full !px-7 !py-3.5 !text-[19px] !font-semibold">
              <Icon name="clipboard" />
              Assign patients
            </LinkButton>
            <LinkButton href="/faculty/cases/new" variant="secondary" size="lg" className="!rounded-full !px-7 !py-3.5 !text-[19px] !font-semibold">
              <Icon name="userPlus" />
              Create a patient
            </LinkButton>
          </div>
        </div>
        {courses.length > 1 && (
          <p className="mt-3 text-[15px] text-slate-600">
            Your other classes:{" "}
            {courses
              .filter((c) => c.id !== course.id)
              .map((c, i) => (
                <span key={c.id}>
                  {i > 0 && ", "}
                  <Link href={`/faculty?class=${c.id}`} className="font-medium text-brand-700 hover:underline">
                    {c.name}
                  </Link>
                </span>
              ))}
          </p>
        )}

        <h2 className="mb-3 mt-10 flex items-center gap-2.5 text-[26px] font-semibold text-slate-900">
          <Icon name="flag" className="h-7 w-7 text-brand-600" />
          Needs your review
        </h2>
        {review.length === 0 ? (
          <p className="rounded-2xl border border-slate-200 bg-white px-7 py-5 text-slate-600">Nothing is waiting for you.</p>
        ) : (
          <ul className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
            {review.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-5 px-7 py-4">
                <div className="min-w-0 flex-1">
                  <span className="font-semibold">{r.student}</span> · {r.title}
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-[15px] font-semibold text-amber-900">
                  <Icon name="alert" />
                  {r.reasons[0] || "Flagged for review"}
                </span>
                <LinkButton href={feedbackUrl(r.id)} variant="secondary" className="!px-4 !py-2 !text-base">
                  Open visit
                </LinkButton>
              </li>
            ))}
          </ul>
        )}

        <h2 className="mb-3 mt-10 flex items-center gap-2.5 text-[26px] font-semibold text-slate-900">
          <Icon name="users" className="h-7 w-7 text-brand-600" />
          Students
        </h2>
        {students.length === 0 ? (
          <p className="rounded-2xl border border-slate-200 bg-white px-7 py-5 text-slate-600">
            No students have joined yet. Give them the join code <span className="font-mono font-semibold text-slate-900">{course.join_code}</span>.
          </p>
        ) : (
          <ul className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
            {students.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-5 px-7 py-4">
                <Link href={`/faculty/students/${s.id}`} className="min-w-0 flex-1 font-semibold text-slate-900 hover:text-brand-700">
                  {s.name}
                </Link>
                {s.total > 0 && (
                  <div className="h-2.5 w-56 overflow-hidden rounded-full bg-slate-200">
                    <div className={`h-2.5 rounded-full ${s.done === s.total ? "bg-emerald-600" : "bg-brand-600"}`} style={{ width: `${(100 * s.done) / s.total}%` }} />
                  </div>
                )}
                <span className="w-32 text-[15px] text-slate-600">{s.total === 0 ? "Nothing assigned" : s.done === 0 ? "Not started" : `${s.done} of ${s.total} done`}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-6">
          <Link href={`/faculty/courses/${course.id}`} className="inline-flex items-center gap-1.5 text-[15px] font-medium text-brand-700 hover:underline">
            Open the gradebook and assignments for this class
            <Icon name="arrowRight" />
          </Link>
        </p>
      </div>
    </AppShell>
  );
}
