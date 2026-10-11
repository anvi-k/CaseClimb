import { runFor } from "@/lib/journey/access";
import { ensureProgress, isBusy, streamInfo } from "@/lib/journey/runner";
import { addMessage, messagesOfRun } from "@/lib/journey/store";
import { buildView } from "@/lib/journey/view";

/**
 * The whole run as the hub and the chart tab need it. For the owner it also resumes the worker when
 * there is real work waiting (the learner's visit was just scored, or the server restarted mid-step).
 * With nothing to do it starts nothing and emits no event, so reading the run never causes another read.
 */
export async function GET(req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const { runId } = await ctx.params;
  const r = await runFor(runId, { faculty: true });
  if (r instanceof Response) return r;
  const owner = r.run.row.user_id === r.user.id;
  if (owner) ensureProgress(runId);
  // The chart tab reports that the learner opened the shared state during their visit (used as evidence of reviewing prior information).
  const mark = new URL(req.url).searchParams.get("opened");
  if (owner && mark && !messagesOfRun(runId).some((m) => m.kind === "state_opened" && m.meta?.duringStage === mark)) {
    addMessage(runId, { thread: "events", kind: "state_opened", fromRole: "", fromName: "", fromIsAi: false, text: "Opened the shared patient state during the visit.", meta: { duringStage: mark } });
  }
  const view = buildView(runId, r.user.id, isBusy(runId));
  if (!view) return Response.json({ error: "Journey run not found" }, { status: 404 });
  view.messages = view.messages.filter((m) => m.thread !== "events");
  view.stream = streamInfo(runId);
  return Response.json(view);
}
