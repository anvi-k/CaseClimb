import { apiUser } from "@/lib/auth";
import { get, run } from "@/lib/db";
import { bad } from "@/lib/http";

/** Enrol the signed-in user in a course. Body: { code } */
export async function POST(req: Request) {
  const user = await apiUser();
  if (user instanceof Response) return user;
  const code = String((await req.json().catch(() => ({}))).code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!code) return bad("Enter the join code from your instructor");
  const course = get<{ id: string; name: string }>("SELECT id, name FROM courses WHERE join_code = ?", code);
  if (!course) return bad("No course uses that code. Check it with your instructor.", 404);
  run("INSERT OR IGNORE INTO enrollments (course_id, user_id) VALUES (?,?)", course.id, user.id);
  return Response.json({ ok: true, course });
}
