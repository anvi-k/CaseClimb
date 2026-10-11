import { encounterFor } from "@/lib/access";
import { run } from "@/lib/db";

/** The student has left the waiting room: the visit clock starts now, not when the visit was created. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = await encounterFor(id);
  if (r instanceof Response) return r;
  if (r.enc.state.turn === 0 && r.enc.row.status === "active" && !r.enc.row.parent_id) run("UPDATE encounters SET started_at = datetime('now') WHERE id = ?", id);
  return Response.json({ ok: true });
}
