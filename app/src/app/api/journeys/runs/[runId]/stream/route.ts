import { runFor } from "@/lib/journey/access";
import { ensureProgress, subscribe } from "@/lib/journey/runner";

/**
 * Server-sent events for a run: the colleague's visit as it happens (clinician lines, patient
 * reply chunks, results), phase changes, and `idle` when the worker finishes a piece of work.
 * `?after=<seq>&epoch=<id>` resumes; without it the visit in progress is replayed, marked `replay`. The run keeps going if nobody is listening.
 */
export async function GET(req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const { runId } = await ctx.params;
  const r = await runFor(runId, { faculty: true });
  if (r instanceof Response) return r;
  const q = new URL(req.url).searchParams;
  const after = q.has("after") ? Number(q.get("after")) || 0 : null;
  if (r.run.row.user_id === r.user.id) ensureProgress(runId);
  const enc = new TextEncoder();
  let off = () => {};
  let beat: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream({
    start(controller) {
      const send = (s: string) => {
        try {
          controller.enqueue(enc.encode(s));
        } catch {
          off();
          clearInterval(beat);
        }
      };
      send(": connected\n\n");
      off = subscribe(runId, after, q.get("epoch"), (e) => send(`data: ${JSON.stringify(e)}\n\n`));
      beat = setInterval(() => send(": keep-alive\n\n"), 10000);
      req.signal.addEventListener("abort", () => {
        off();
        clearInterval(beat);
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
    cancel() {
      off();
      clearInterval(beat);
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" } });
}
