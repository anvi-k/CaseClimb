import { apiUser } from "@/lib/auth";
import { all, get, newId, run } from "@/lib/db";
import { bad } from "@/lib/http";

interface Student {
  id: string;
  name: string;
  course_id: string;
}

/** The instructor's students, each with whether this patient is already on their list. */
function roster(facultyId: string, caseId: string) {
  const students = all<Student>(
    "SELECT u.id, u.name, en.course_id FROM enrollments en JOIN courses co ON co.id = en.course_id JOIN users u ON u.id = en.user_id WHERE co.faculty_id = ? GROUP BY u.id ORDER BY u.name",
    facultyId,
  );
  const given = all<{ course_id: string; student_ids: string | null }>(
    "SELECT a.course_id, a.student_ids FROM assignments a JOIN courses co ON co.id = a.course_id, json_each(a.case_ids) j WHERE co.faculty_id = ? AND j.value = ?",
    facultyId,
    caseId,
  );
  const has = (s: Student) => given.some((g) => g.course_id === s.course_id && (!g.student_ids || (JSON.parse(g.student_ids) as string[]).includes(s.id)));
  return students.map((s) => ({ ...s, assigned: has(s) }));
}

/** Who this patient can be assigned to. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiUser("faculty");
  if (user instanceof Response) return user;
  const { id } = await params;
  return Response.json({ students: roster(user.id, id).map(({ id: sid, name, assigned }) => ({ id: sid, name, assigned })) });
}

/** Puts this patient on the chosen students' lists. Body: { studentIds: string[], temperament?: 1-5 } */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiUser("faculty");
  if (user instanceof Response) return user;
  const { id } = await params;
  const patient = get<{ name: string | null }>("SELECT json_extract(profile, '$.patient.name') AS name FROM cases WHERE id = ? AND status = 'published'", id);
  if (!patient) return bad("Patient not found", 404);
  const b = await req.json().catch(() => ({}));
  const wanted = new Set<string>(Array.isArray(b.studentIds) ? b.studentIds.map(String) : []);
  const chosen = roster(user.id, id).filter((s) => wanted.has(s.id) && !s.assigned);
  if (!wanted.size) return bad("Choose at least one student.");
  const temperament = Math.max(1, Math.min(5, Math.round(Number(b.temperament) || 3)));
  // One assignment per class, limited to the chosen students in it.
  for (const courseId of new Set(chosen.map((s) => s.course_id))) {
    run(
      "INSERT INTO assignments (id, course_id, title, instructions, type, case_ids, journey_id, settings, due_at, feedback_released, student_ids) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      newId("as_"),
      courseId,
      `Visit with ${patient.name || "a patient"}`,
      "",
      "homework",
      JSON.stringify([id]),
      null,
      JSON.stringify({ level: temperament, temperament }),
      null,
      1,
      JSON.stringify(chosen.filter((s) => s.course_id === courseId).map((s) => s.id)),
    );
  }
  return Response.json({ assigned: chosen.length });
}
