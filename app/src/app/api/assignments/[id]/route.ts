import { apiUser } from "@/lib/auth";
import { get, run } from "@/lib/db";
import { assignmentFor } from "@/lib/courses";
import { readAssignment } from "@/lib/courses/save";
import { bad } from "@/lib/http";

/** Replace an assignment's content and settings. Same body as create. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await apiUser("faculty");
  if (user instanceof Response) return user;
  const found = assignmentFor(user, (await ctx.params).id);
  if (!found) return bad("Assignment not found", 404);
  const a = readAssignment(await req.json().catch(() => ({})));
  if (typeof a === "string") return bad(a);
  // Switching to immediate release releases what was held; switching to held only holds if nothing was released by hand.
  const wasManual = found.a.settings.feedbackRelease === "manual";
  const released = a.settings.feedbackRelease === "immediate" ? 1 : wasManual ? found.a.feedback_released : 0;
  run(
    "UPDATE assignments SET title = ?, instructions = ?, type = ?, case_ids = ?, journey_id = ?, settings = ?, due_at = ?, feedback_released = ? WHERE id = ?",
    a.title,
    a.instructions,
    a.type,
    JSON.stringify(a.caseIds),
    a.journeyId,
    JSON.stringify(a.settings),
    a.dueAt,
    released,
    found.a.id,
  );
  return Response.json({ id: found.a.id });
}

/** Only assignments nobody has started can be deleted, so student work is never orphaned. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await apiUser("faculty");
  if (user instanceof Response) return user;
  const found = assignmentFor(user, (await ctx.params).id);
  if (!found) return bad("Assignment not found", 404);
  const n = get<{ n: number }>("SELECT COUNT(*) AS n FROM encounters WHERE assignment_id = ?", found.a.id)!.n;
  if (n) return bad("Students have already started this assignment, so it cannot be deleted.", 409);
  run("DELETE FROM assignments WHERE id = ?", found.a.id);
  return Response.json({ ok: true });
}
