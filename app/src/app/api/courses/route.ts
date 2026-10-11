import { apiUser } from "@/lib/auth";
import { newId, run } from "@/lib/db";
import { coursesOf, newJoinCode } from "@/lib/courses";
import { bad } from "@/lib/http";
import { professions } from "@/lib/professions";

export async function GET() {
  const user = await apiUser("faculty");
  if (user instanceof Response) return user;
  return Response.json({ courses: coursesOf(user) });
}

/** Create a course. Body: { name, professionId? } */
export async function POST(req: Request) {
  const user = await apiUser("faculty");
  if (user instanceof Response) return user;
  const b = await req.json().catch(() => ({}));
  const name = String(b.name || "").trim().slice(0, 120);
  if (!name) return bad("Give the course a name");
  const professionId = professions().some((p) => p.id === b.professionId) ? String(b.professionId) : null;
  const id = newId("co_");
  const joinCode = newJoinCode();
  run("INSERT INTO courses (id, faculty_id, name, profession_id, join_code) VALUES (?,?,?,?,?)", id, user.id, name, professionId, joinCode);
  return Response.json({ id, joinCode });
}
