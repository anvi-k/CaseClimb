import Link from "next/link";
import AppShell from "@/components/AppShell";
import CreateCourse from "@/components/courses/CreateCourse";
import { Card, CardHeader, Empty, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { get } from "@/lib/db";
import { coursesOf } from "@/lib/courses";
import { profession, professions } from "@/lib/professions";

export default async function CoursesPage() {
  const user = await requireUser("faculty");
  const courses = coursesOf(user).map((c) => ({
    ...c,
    students: get<{ n: number }>("SELECT COUNT(*) AS n FROM enrollments WHERE course_id = ?", c.id)!.n,
    assignments: get<{ n: number }>("SELECT COUNT(*) AS n FROM assignments WHERE course_id = ?", c.id)!.n,
  }));
  return (
    <AppShell user={user}>
      <PageHeader title="Courses" subtitle="A course has a join code, a roster, assignments and a gradebook." />
      <Card className="mb-5">
        <CardHeader title="Create a course" subtitle="Students join with a six-character code you share in class." />
        <CreateCourse />
      </Card>
      {courses.length === 0 ? (
        <Empty>You have no courses yet. Create one above, then add assignments to it.</Empty>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((c) => (
            <Link key={c.id} href={`/faculty/courses/${c.id}`} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm hover:border-brand-500">
              <div className="text-sm font-semibold text-slate-900">{c.name}</div>
              <div className="mt-0.5 text-xs text-slate-500">{c.profession_id ? profession(c.profession_id).name : "Mixed / interprofessional"}</div>
              <div className="mt-3 flex items-center justify-between text-xs text-slate-600">
                <span>
                  {c.students} student{c.students === 1 ? "" : "s"} · {c.assignments} assignment{c.assignments === 1 ? "" : "s"}
                </span>
                <span>
                  Join code <span className="font-mono font-semibold tracking-widest text-slate-900">{c.join_code}</span>
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}
