import Link from "next/link";
import { notFound } from "next/navigation";
import AppShell from "@/components/AppShell";
import { JoinCode, RemoveStudent } from "@/components/courses/CourseTools";
import When from "@/components/courses/When";
import { Badge, Card, CardHeader, Empty, LinkButton, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { assignmentOverviews, courseFor, describeSettings, TYPE_LABEL } from "@/lib/courses";

export default async function CoursePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("faculty");
  const course = courseFor(user, (await params).id);
  if (!course) notFound();
  const roster = all<{ id: string; name: string; email: string; profession_id: string | null; created_at: string }>(
    "SELECT u.id, u.name, u.email, u.profession_id, en.created_at FROM enrollments en JOIN users u ON u.id = en.user_id WHERE en.course_id = ? ORDER BY u.name",
    course.id,
  );
  const assignments = assignmentOverviews(user, course.id);
  // Best score per student per assignment (a faculty adjustment replaces the rubric score).
  const best = new Map<string, number>();
  for (const r of all<{ user_id: string; assignment_id: string; s: number }>(
    `SELECT e.user_id, COALESCE(e.assignment_id, jr.assignment_id) AS assignment_id, MAX(COALESCE(e.faculty_score, e.score)) AS s
     FROM encounters e LEFT JOIN journey_runs jr ON jr.id = e.journey_run_id
     WHERE e.status = 'scored' AND COALESCE(e.assignment_id, jr.assignment_id) IN (SELECT id FROM assignments WHERE course_id = ?)
     GROUP BY e.user_id, COALESCE(e.assignment_id, jr.assignment_id)`,
    course.id,
  ))
    best.set(r.user_id + ":" + r.assignment_id, r.s);

  return (
    <AppShell user={user}>
      <div className="mb-2 text-xs text-slate-500">
        <Link href="/faculty/courses" className="hover:text-brand-700">
          Courses
        </Link>{" "}
        / {course.name}
      </div>
      <PageHeader
        title={course.name}
        subtitle={`${roster.length} student${roster.length === 1 ? "" : "s"} · Join code ${course.join_code}`}
        action={<LinkButton href={`/faculty/courses/${course.id}/assignments/new`}>New assignment</LinkButton>}
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-5">
          <Card>
            <CardHeader title="Assignments" subtitle="Open one for its gradebook and class summary." />
            {assignments.length === 0 ? (
              <div className="p-4">
                <Empty>
                  No assignments yet.{" "}
                  <Link href={`/faculty/courses/${course.id}/assignments/new`} className="font-medium text-brand-700 underline">
                    Create one
                  </Link>{" "}
                  by hand or with the guide.
                </Empty>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {assignments.map(({ a, roster: n, submitted, inProgress }) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-6 py-3">
                    <div className="min-w-0">
                      <Link href={`/faculty/courses/${course.id}/assignments/${a.id}`} className="text-sm font-medium text-slate-900 hover:text-brand-700">
                        {a.title}
                      </Link>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                        <Badge tone={a.type === "exam" ? "violet" : a.type === "practice" ? "slate" : "blue"}>{TYPE_LABEL[a.type]}</Badge>
                        {a.journey_id ? <Badge tone="teal">Care journey</Badge> : <span>{a.caseIds.length} patient{a.caseIds.length === 1 ? "" : "s"}</span>}
                        <span>· {describeSettings(a.settings)}</span>
                        {!a.feedback_released && <Badge tone="amber">Feedback held</Badge>}
                      </div>
                    </div>
                    <div className="shrink-0 text-right text-xs text-slate-600">
                      <div className="text-sm font-medium text-slate-900">
                        {submitted} of {n} submitted
                      </div>
                      <div>
                        {inProgress > 0 && `${inProgress} in progress · `}
                        {a.due_at ? (
                          <>
                            Due <When at={a.due_at} />
                          </>
                        ) : (
                          "No due date"
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Gradebook" subtitle="Best score per student for each assignment. A dash means nothing has been scored yet." />
            {roster.length === 0 || assignments.length === 0 ? (
              <p className="px-6 py-6 text-sm text-slate-500">{roster.length === 0 ? "No students have joined yet." : "Add an assignment to start the gradebook."}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                      <th className="sticky left-0 bg-white px-6 py-2 font-medium">Student</th>
                      {assignments.map(({ a }) => (
                        <th key={a.id} className="max-w-[10rem] px-3 py-2 text-right font-medium">
                          <Link href={`/faculty/courses/${course.id}/assignments/${a.id}`} className="line-clamp-2 hover:text-brand-700" title={a.title}>
                            {a.title}
                          </Link>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {roster.map((u) => (
                      <tr key={u.id}>
                        <td className="sticky left-0 whitespace-nowrap bg-white px-6 py-2 font-medium text-slate-900">{u.name}</td>
                        {assignments.map(({ a }) => {
                          const s = best.get(u.id + ":" + a.id);
                          return (
                            <td key={a.id} className="px-3 py-2 text-right tabular-nums text-slate-800">
                              {s === undefined ? <span className="text-slate-400">–</span> : `${Math.round(s)}%`}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Join code" subtitle="Students enter this on their home page." />
            <div className="p-4">
              <JoinCode courseId={course.id} code={course.join_code} />
            </div>
          </Card>
          <Card>
            <CardHeader title={`Roster (${roster.length})`} />
            {roster.length === 0 ? (
              <p className="px-6 py-6 text-sm text-slate-500">No students yet. Share the join code.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {roster.map((u) => (
                  <li key={u.id} className="flex items-center justify-between gap-2 px-6 py-2.5">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-slate-900">{u.name}</div>
                      <div className="truncate text-xs text-slate-500">
                        {u.email}
                      </div>
                    </div>
                    <RemoveStudent courseId={course.id} userId={u.id} name={u.name} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
