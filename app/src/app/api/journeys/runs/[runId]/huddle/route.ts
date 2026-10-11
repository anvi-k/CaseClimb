import { bad, longJson } from "@/lib/http";
import { runFor } from "@/lib/journey/access";
import { resolveHuddleItem, startHuddle } from "@/lib/journey/collab";
import { finalize } from "@/lib/journey/runner";
import { stageRuns } from "@/lib/journey/store";

/** Team huddle. Body: { action: "start" } | { action: "resolve", entryId, text } | { action: "close" }. Closing returns at once; the worker writes the plan and evaluation. */
export async function POST(req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const { runId } = await ctx.params;
  const r = await runFor(runId);
  if (r instanceof Response) return r;
  const b = await req.json().catch(() => ({}));
  if (stageRuns(runId).some((s) => s.status !== "complete")) return bad("The huddle opens after the last encounter.");
  if (b.action === "start") return longJson(async () => ({ huddle: await startHuddle(runId) }));
  if (b.action === "resolve") {
    const text = String(b.text || "").trim().slice(0, 1500);
    if (!text) return bad("Say how you would settle this item.");
    return longJson(async () => ({ huddle: await resolveHuddleItem(runId, String(b.entryId || ""), text) }));
  }
  if (b.action === "close") {
    try {
      return Response.json(finalize(runId));
    } catch (e) {
      return bad((e as Error).message);
    }
  }
  return bad("Unknown huddle action.");
}
