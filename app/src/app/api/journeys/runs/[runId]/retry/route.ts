import { runFor } from "@/lib/journey/access";
import { retryStage } from "@/lib/journey/runner";

/** Restarts a stage that stopped with an error. */
export async function POST(_req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const { runId } = await ctx.params;
  const r = await runFor(runId);
  if (r instanceof Response) return r;
  retryStage(runId);
  return Response.json({ ok: true });
}
