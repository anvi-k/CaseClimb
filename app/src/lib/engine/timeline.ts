import { parse } from "../db";
import type { ArtifactChart, CaseProfile, EncounterConfig, EncounterState } from "../types";
import type { MessageRow } from "./encounter";
import { caseFacts } from "./gatekeeper";

export interface TimelinePoint {
  turn: number;
  /** Weighted share of the case's findings and key exams obtained so far, 0-1. */
  coverage: number;
  /** Communication quality, smoothed over recent turns, 0-1. */
  communication: number;
  /** Patient comfort, 0-1. */
  comfort: number;
  /** Running score, 0-1. */
  score: number;
  note: string;
}

const W = { critical: 3, important: 2, minor: 1 };

/**
 * Turn-by-turn running score. This is arithmetic over the per-turn analysis already stored with each
 * patient message (signals, disclosure ledger, comfort), not another model call, so it is available
 * while the visit is still in progress.
 *
 *   coverage      = weighted findings + key exams obtained / weighted total
 *   pace          = coverage relative to what a steady interview would have by this turn (12 turns to 80%)
 *   communication = exponential average of a per-turn mark built from the gatekeeper's signals
 *   score         = 0.45 * pace + 0.35 * communication + 0.20 * comfort
 */
export function timeline(c: CaseProfile, cfg: EncounterConfig, msgs: MessageRow[]): TimelinePoint[] {
  const facts = caseFacts(c, cfg.knobs).filter((f) => !f.distractor);
  const acts = c.actions.filter((a) => a.importance !== "minor");
  const total = facts.reduce((s, f) => s + W[f.importance], 0) + acts.reduce((s, a) => s + W[a.importance], 0) || 1;
  const out: TimelinePoint[] = [];
  let comm = 0.6;
  for (const m of msgs) {
    if (m.speaker !== "patient") continue;
    const meta = parse<{ state?: EncounterState; signals?: Record<string, boolean>; questionType?: string; revealed?: string[]; deflected?: string[] }>(m.meta, {});
    const st = meta.state;
    if (!st) continue;
    const got = facts.filter((f) => st.disclosed[f.id]).reduce((s, f) => s + W[f.importance], 0) + acts.filter((a) => st.actions[a.id]).reduce((s, a) => s + W[a.importance], 0);
    const coverage = got / total;
    const expected = Math.min(0.8, (m.turn / 12) * 0.8) || 0.05;
    const pace = Math.min(1, coverage / expected);

    const s = meta.signals || {};
    let mark = 0.6;
    const notes: string[] = [];
    if (s.empathy || s.validated_emotion) (mark += 0.25), notes.push("empathy");
    if (s.sensitive_framing) (mark += 0.15), notes.push("sensitive framing");
    if (meta.questionType === "open") (mark += 0.1), notes.push("open question");
    if (s.introduced_self) mark += 0.1;
    if (s.judgmental) (mark -= 0.45), notes.push("judgmental");
    if (s.dismissive) (mark -= 0.35), notes.push("dismissive");
    if (s.jargon) (mark -= 0.2), notes.push("jargon");
    if (s.rushed) (mark -= 0.2), notes.push("rushed");
    if (meta.questionType === "multiple") (mark -= 0.15), notes.push("stacked questions");
    if (meta.questionType === "leading") (mark -= 0.1), notes.push("leading question");
    if (meta.revealed?.length) notes.push(`${meta.revealed.length} new finding${meta.revealed.length === 1 ? "" : "s"}`);
    if (meta.deflected?.length) notes.push("patient deflected");
    mark = Math.max(0, Math.min(1, mark));
    comm = out.length ? 0.6 * comm + 0.4 * mark : mark;
    const comfort = st.rapport / 100;
    out.push({ turn: m.turn, coverage, communication: comm, comfort, score: 0.45 * pace + 0.35 * comm + 0.2 * comfort, note: notes.join(", ") });
  }
  return out;
}

/** The timeline as chart data for the shared trend chart component. */
export function timelineChart(points: TimelinePoint[]): ArtifactChart {
  const pct = (v: number) => Math.round(v * 100);
  return {
    kind: "line",
    xLabel: "Turn",
    yLabel: "0 to 100",
    series: [
      { name: "Running score", points: points.map((p) => ({ x: `T${p.turn}`, y: pct(p.score) })) },
      { name: "Findings covered", points: points.map((p) => ({ x: `T${p.turn}`, y: pct(p.coverage) })) },
      { name: "Communication", points: points.map((p) => ({ x: `T${p.turn}`, y: pct(p.communication) })) },
      { name: "Patient comfort", points: points.map((p) => ({ x: `T${p.turn}`, y: pct(p.comfort) })) },
    ],
  };
}
