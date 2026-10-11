import { apiUser } from "@/lib/auth";
import { newId, run } from "@/lib/db";
import { courseFor } from "@/lib/courses";
import { readAssignment } from "@/lib/courses/save";
import { bad } from "@/lib/http";

/** Create an assignment. Body: { courseId, title, instructions, type, caseIds | journeyId, settings, dueAt } */
export async function POST(req: Request) {
  const user = await apiUser("faculty");
  if (user instanceof Response) return user;
  const b = await req.json().catch(() => ({}));
  const course = courseFor(user, String(b.courseId || ""));
  if (!course) return bad("Course not found", 404);
  const a = readAssignment(b);
  if (typeof a === "string") return bad(a);
  const id = newId("as_");
  run(
    "INSERT INTO assignments (id, course_id, title, instructions, type, case_ids, journey_id, settings, due_at, feedback_released) VALUES (?,?,?,?,?,?,?,?,?,?)",
    id,
    course.id,
    a.title,
    a.instructions,
    a.type,
    JSON.stringify(a.caseIds),
    a.journeyId,
    JSON.stringify(a.settings),
    a.dueAt,
    a.settings.feedbackRelease === "manual" ? 0 : 1,
  );
  return Response.json({ id });
}
