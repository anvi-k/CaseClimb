import { encounterFor } from "@/lib/access";
import { chartView, messagesOf } from "@/lib/engine/encounter";
import { timeline } from "@/lib/engine/timeline";
import { profession } from "@/lib/professions";
import { isFaculty } from "@/lib/auth";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const r = await encounterFor((await ctx.params).id, { faculty: "also" });
  if (r instanceof Response) return r;
  const { row, c, cfg, state } = r.enc;
  const role = profession(cfg.professionId);
  const msgs = messagesOf(row.id);
  return Response.json({
    // The running score is for instructors watching live; students see it afterwards in feedback.
    timeline: isFaculty(r.user) ? timeline(c, cfg, msgs) : undefined,
    id: row.id,
    status: row.status,
    mode: cfg.mode,
    attempt: row.attempt,
    visitNumber: cfg.visitNumber || 1,
    recorded: !!row.assignment_id || !!row.journey_run_id,
    level: cfg.knobs.level,
    hints: cfg.knobs.hints,
    canRewind: cfg.mode !== "exam" && cfg.mode !== "journey",
    liveAssist: !!cfg.liveAssist,
    timeLimitMin: cfg.knobs.timeLimitMin,
    startedAt: row.started_at,
    pauseNote: row.pause_note,
    pausedAt: (row as unknown as { paused_at?: string | null }).paused_at || null,
    role: { name: role.name, roleTitle: cfg.journey?.roleTitle || role.roleTitle, noteFormat: role.noteFormat, wrapUp: role.wrapUp },
    journeyRunId: row.journey_run_id,
    priorContext: cfg.journey?.priorContext || null,
    chart: chartView(c, cfg, state),
    messages: msgs.map((m) => ({ id: m.id, turn: m.turn, speaker: m.speaker, text: m.text })),
  });
}
