import { apiUser, isFaculty } from "@/lib/auth";
import { run } from "@/lib/db";
import { bad } from "@/lib/http";
import { normaliseStages } from "@/lib/journey/guide";
import { loadJourney } from "@/lib/journey/store";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await apiUser();
  if (user instanceof Response) return user;
  const j = loadJourney((await ctx.params).id);
  if (!j || (j.row.status !== "published" && !isFaculty(user))) return bad("Journey not found", 404);
  return Response.json({ id: j.row.id, title: j.row.title, status: j.row.status, caseId: j.row.case_id, summary: j.spec.summary, stages: j.stages });
}

/** Edits or publishes a journey. Body: { title?, summary?, stages?, status? } */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await apiUser("faculty");
  if (user instanceof Response) return user;
  const j = loadJourney((await ctx.params).id);
  if (!j) return bad("Journey not found", 404);
  const b = await req.json().catch(() => ({}));
  const stages = b.stages ? normaliseStages(b.stages) : j.stages;
  const status = ["draft", "published", "archived"].includes(b.status) ? b.status : j.row.status;
  if (status === "published" && stages.length < 3) return bad("A journey needs at least three encounters before it can be published.");
  run("UPDATE journeys SET title = ?, status = ?, spec = ?, updated_at = datetime('now') WHERE id = ?", String(b.title || j.row.title).trim(), status, JSON.stringify({ summary: b.summary !== undefined ? String(b.summary) : j.spec.summary, stages }), j.row.id);
  return Response.json({ ok: true });
}
