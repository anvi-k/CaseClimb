import { apiUser } from "@/lib/auth";
import { RECORDED_VISIT } from "@/lib/courses";
import { decodeEntities } from "@/lib/courses/save";
import { all, parse } from "@/lib/db";
import type { EncounterConfig, EncounterState } from "@/lib/types";

/** Faculty: assignment or journey visits in progress that have live assist turned on, with at-risk signals. Never private practice. */
export async function GET() {
  const user = await apiUser("faculty");
  if (user instanceof Response) return user;
  const rows = all<{ id: string; status: string; config: string; state: string; started_at: string; student: string; title: string; assignment: string | null; last_at: string | null }>(
    `SELECT e.id, e.status, e.config, e.state, e.started_at, u.name AS student, c.title, a.title AS assignment,
            (SELECT MAX(created_at) FROM messages m WHERE m.encounter_id = e.id) AS last_at
     FROM encounters e JOIN users u ON u.id = e.user_id JOIN cases c ON c.id = e.case_id LEFT JOIN assignments a ON a.id = e.assignment_id
     WHERE e.status IN ('active','paused') AND e.started_at > datetime('now','-3 hours') AND ${RECORDED_VISIT} ORDER BY e.started_at DESC`,
  );
  const visits = rows
    .map((r) => ({ r, cfg: parse<EncounterConfig>(r.config, {} as EncounterConfig), st: parse<EncounterState>(r.state, {} as EncounterState) }))
    .filter((x) => x.cfg.liveAssist)
    .map(({ r, cfg, st }) => {
      const drop = st.rapportHistory.length > 2 ? st.rapportHistory[0] - st.rapport : 0;
      const flags: string[] = [];
      if (st.rapport < 30) flags.push("Patient comfort very low");
      else if (drop >= 15) flags.push("Patient comfort falling");
      if (st.stats.judgmental >= 2) flags.push("Judgmental or dismissive moments");
      if (st.turn >= 6 && Object.keys(st.disclosed).length <= 2) flags.push("Little information gathered");
      if (Object.keys(st.deflected).length >= 2) flags.push("Patient is deflecting");
      return { id: r.id, status: r.status, student: r.student, title: r.title, assignment: r.assignment && decodeEntities(r.assignment), mode: cfg.mode, level: cfg.knobs.level, turn: st.turn, rapport: st.rapport, facts: Object.keys(st.disclosed).length, startedAt: r.started_at, lastAt: r.last_at, flags };
    });
  return Response.json({ visits });
}
