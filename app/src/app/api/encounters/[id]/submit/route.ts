import { encounterFor } from "@/lib/access";
import { run } from "@/lib/db";
import { scoreEncounter } from "@/lib/engine/feedback";
import { longJson } from "@/lib/http";

/** Ends the visit, stores the written wrap-up and scores it. Body: { wrapup: { fieldId: text } } */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = await encounterFor(id);
  if (r instanceof Response) return r;
  const b = await req.json().catch(() => ({}));
  if (r.enc.row.status === "active" || r.enc.row.status === "paused") {
    run("UPDATE encounters SET wrapup = ?, status = 'submitted', ended_at = datetime('now') WHERE id = ?", JSON.stringify(b.wrapup || {}), id);
  }
  return longJson(async () => {
    if (r.enc.row.status === "scored") return { ok: true };
    await scoreEncounter(id);
    return { ok: true };
  });
}
