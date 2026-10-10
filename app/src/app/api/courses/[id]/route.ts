import { apiUser } from "@/lib/auth";
import { run } from "@/lib/db";
import { courseFor, newJoinCode } from "@/lib/courses";
import { bad } from "@/lib/http";
import { professions } from "@/lib/professions";

/** Body: { name?, professionId?, newCode?: true, removeStudentId? } */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await apiUser("faculty");
  if (user instanceof Response) return user;
  const course = courseFor(user, (await ctx.params).id);
  if (!course) return bad("Course not found", 404);
  const b = await req.json().catch(() => ({}));
  if (typeof b.name === "string" && b.name.trim()) run("UPDATE courses SET name = ? WHERE id = ?", b.name.trim().slice(0, 120), course.id);
  if (b.professionId !== undefined) run("UPDATE courses SET profession_id = ? WHERE id = ?", professions().some((p) => p.id === b.professionId) ? b.professionId : null, course.id);
  let joinCode = course.join_code;
  if (b.newCode) {
    joinCode = newJoinCode();
    run("UPDATE courses SET join_code = ? WHERE id = ?", joinCode, course.id);
  }
  if (b.removeStudentId) run("DELETE FROM enrollments WHERE course_id = ? AND user_id = ?", course.id, String(b.removeStudentId));
  return Response.json({ ok: true, joinCode });
}
