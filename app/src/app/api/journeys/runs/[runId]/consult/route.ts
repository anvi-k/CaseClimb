import { bad, longJson } from "@/lib/http";
import { runFor } from "@/lib/journey/access";
import { callOut, consult } from "@/lib/journey/collab";

/** Message a colleague outside the handoff order. Body: { toStageId, text } or { callout: true, text } */
export async function POST(req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const { runId } = await ctx.params;
  const r = await runFor(runId);
  if (r instanceof Response) return r;
  const b = await req.json().catch(() => ({}));
  const text = String(b.text || "").trim().slice(0, 1500);
  if (!text) return bad("Write a message first.");
  return longJson<unknown>(() => (b.callout ? callOut(runId, text) : consult(runId, String(b.toStageId || ""), text)));
}
