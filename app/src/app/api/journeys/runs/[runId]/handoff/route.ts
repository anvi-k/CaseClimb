import { bad, longJson } from "@/lib/http";
import { runFor } from "@/lib/journey/access";
import { submitStudentHandoff } from "@/lib/journey/runner";

/** The learner's SBAR to the next professional. Body: { situation, background, assessment, recommendation } */
export async function POST(req: Request, ctx: { params: Promise<{ runId: string }> }) {
  const { runId } = await ctx.params;
  const r = await runFor(runId);
  if (r instanceof Response) return r;
  const b = await req.json().catch(() => ({}));
  const f = (k: string) => String(b[k] || "").trim().slice(0, 2000);
  const sbar = { situation: f("situation"), background: f("background"), assessment: f("assessment"), recommendation: f("recommendation") };
  if (!Object.values(sbar).some(Boolean)) return bad("Write at least one part of the handoff.");
  return longJson(async () => ({ evaluation: await submitStudentHandoff(runId, sbar) }));
}
