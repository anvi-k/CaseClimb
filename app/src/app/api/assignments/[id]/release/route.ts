import { apiUser } from "@/lib/auth";
import { run } from "@/lib/db";
import { assignmentFor } from "@/lib/courses";
import { bad } from "@/lib/http";

/** Release (or hold again) feedback for an assignment. Body: { released: boolean } */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await apiUser("faculty");
  if (user instanceof Response) return user;
  const found = assignmentFor(user, (await ctx.params).id);
  if (!found) return bad("Assignment not found", 404);
  const b = await req.json().catch(() => ({}));
  const released = b.released === false ? 0 : 1;
  run("UPDATE assignments SET feedback_released = ? WHERE id = ?", released, found.a.id);
  return Response.json({ ok: true, released: !!released });
}
