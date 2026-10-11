import { bad, longJson } from "@/lib/http";
import { runFor } from "@/lib/journey/access";
import { proposePlanChange } from "@/lib/journey/collab";

/** Propose a change to one care-plan item; the owning colleague replies. Body: { itemId, text } */
export async function POST(req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const { runId } = await ctx.params;
  const r = await runFor(runId);
  if (r instanceof Response) return r;
  const b = await req.json().catch(() => ({}));
  const text = String(b.text || "").trim().slice(0, 1500);
  if (!text) return bad("Describe the change you propose.");
  return longJson(async () => ({ synthesis: await proposePlanChange(runId, String(b.itemId || ""), text) }));
}
