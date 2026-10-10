import { isFaculty } from "./auth";
import { all, get, parse } from "./db";
import { chartView, loadEncounter, messagesOf } from "./engine/encounter";
import { profession } from "./professions";
import type { CaseProfile, EncounterConfig, EncounterState, Feedback, User } from "./types";

/**
 * Episodes are the stored record of every visit: who the patient was, who the professional was,
 * the transcript, what was disclosed, the write-up and the score. This module is the one place that
 * searches them, shared by the Episodes page, the REST endpoint and the MCP endpoint.
 *
 * Visibility: faculty can search every recorded episode (assignment or journey visits) and their
 * own test visits; private practice stays with the student. A student sees their own, plus teammates' episodes
 * on a class-shared patient in a course they are enrolled in.
 */
export interface EpisodeQuery {
  /** Patient name contains. */
  patient?: string;
  /** Student / professional name or email contains. */
  participant?: string;
  /** Profession id or name contains, e.g. "nursing". */
  role?: string;
  caseId?: string;
  /** Words to find in the transcript or write-up. */
  text?: string;
  status?: string;
  limit?: number;
}

export interface EpisodeSummary {
  id: string;
  startedAt: string;
  endedAt: string | null;
  status: string;
  mode: string;
  caseId: string;
  caseTitle: string;
  patient: string;
  participant: string;
  participantId: string;
  role: string;
  level: number;
  visitNumber: number;
  turns: number;
  findings: number;
  score: number | null;
  recorded: boolean;
  /** A transcript line that matched the text query. */
  match?: string;
}

interface Row {
  id: string;
  user_id: string;
  case_id: string;
  assignment_id: string | null;
  journey_run_id: string | null;
  status: string;
  config: string;
  state: string;
  score: number | null;
  started_at: string;
  ended_at: string | null;
  name: string;
  email: string;
  title: string;
  patient: string | null;
}

function visibleClause(user: User): { sql: string; params: unknown[] } {
  // Faculty see recorded visits (assignments and journeys) and their own test visits. A student's
  // self-started practice is private to that student.
  if (isFaculty(user)) return { sql: "(e.assignment_id IS NOT NULL OR e.journey_run_id IS NOT NULL OR e.user_id = ?)", params: [user.id] };
  return {
    sql: `(e.user_id = ? OR e.assignment_id IN (
            SELECT a.id FROM assignments a JOIN enrollments en ON en.course_id = a.course_id
            WHERE en.user_id = ? AND json_extract(a.settings, '$.sharedPatient') = 1))`,
    params: [user.id, user.id],
  };
}

export function searchEpisodes(user: User, q: EpisodeQuery): EpisodeSummary[] {
  const vis = visibleClause(user);
  const where = [vis.sql, "e.parent_id IS NULL", "e.status != 'abandoned'"];
  const params: unknown[] = [...vis.params];
  const like = (v: string) => `%${v.trim().replace(/[%_]/g, "")}%`;
  if (q.patient?.trim()) (where.push("json_extract(c.profile, '$.patient.name') LIKE ?"), params.push(like(q.patient)));
  if (q.participant?.trim()) (where.push("(u.name LIKE ? OR u.email LIKE ?)"), params.push(like(q.participant), like(q.participant)));
  if (q.caseId) (where.push("e.case_id = ?"), params.push(q.caseId));
  if (q.status) (where.push("e.status = ?"), params.push(q.status));
  if (q.role?.trim()) (where.push("json_extract(e.config, '$.professionId') LIKE ?"), params.push(like(q.role.toLowerCase().replace(/\s+/g, "-"))));
  if (q.text?.trim()) {
    where.push("(EXISTS (SELECT 1 FROM messages m WHERE m.encounter_id = e.id AND m.text LIKE ?) OR e.wrapup LIKE ?)");
    params.push(like(q.text), like(q.text));
  }
  const limit = Math.max(1, Math.min(100, q.limit || 30));
  const rows = all<Row>(
    `SELECT e.id, e.user_id, e.case_id, e.assignment_id, e.journey_run_id, e.status, e.config, e.state, e.score, e.started_at, e.ended_at,
            u.name, u.email, c.title, json_extract(c.profile, '$.patient.name') AS patient
     FROM encounters e JOIN users u ON u.id = e.user_id JOIN cases c ON c.id = e.case_id
     WHERE ${where.join(" AND ")} ORDER BY e.started_at DESC LIMIT ${limit}`,
    ...params,
  );
  return rows.map((r) => {
    const cfg = parse<EncounterConfig>(r.config, {} as EncounterConfig);
    const st = parse<EncounterState>(r.state, {} as EncounterState);
    const out: EpisodeSummary = {
      id: r.id,
      startedAt: r.started_at,
      endedAt: r.ended_at,
      status: r.status,
      mode: cfg.mode,
      caseId: r.case_id,
      // The case title is faculty-facing and often names the diagnosis.
      caseTitle: isFaculty(user) ? r.title : "",
      patient: r.patient || "",
      participant: r.name,
      participantId: r.user_id,
      role: profession(cfg.professionId).name,
      level: cfg.knobs?.level ?? 0,
      visitNumber: cfg.visitNumber || 1,
      turns: st.turn || 0,
      findings: Object.keys(st.disclosed || {}).length,
      score: r.score,
      recorded: !!r.assignment_id || !!r.journey_run_id,
    };
    if (q.text?.trim()) {
      const hit = get<{ speaker: string; text: string; turn: number }>("SELECT speaker, text, turn FROM messages WHERE encounter_id = ? AND text LIKE ? ORDER BY id LIMIT 1", r.id, like(q.text));
      if (hit) out.match = `T${hit.turn} ${hit.speaker}: ${hit.text.slice(0, 220)}`;
    }
    return out;
  });
}

export function canSeeEpisode(user: User, id: string): boolean {
  const vis = visibleClause(user);
  return !!get(`SELECT 1 FROM encounters e WHERE e.id = ? AND ${vis.sql}`, id, ...vis.params);
}

/** Full detail of one episode: transcript, what was disclosed, the write-up and the feedback summary. */
export function getEpisode(user: User, id: string) {
  if (!canSeeEpisode(user, id)) return null;
  const enc = loadEncounter(id);
  if (!enc) return null;
  const { row, c, cfg, state } = enc;
  const who = get<{ name: string }>("SELECT name FROM users WHERE id = ?", row.user_id);
  const f = parse<Feedback | null>(row.feedback, null);
  const chart = chartView(c, cfg, state);
  const assignment = row.assignment_id ? get<{ feedback_released: number }>("SELECT feedback_released FROM assignments WHERE id = ?", row.assignment_id) : null;
  const showFeedback = isFaculty(user) || !assignment || !!assignment.feedback_released;
  return {
    id,
    patient: c.patient.name,
    caseId: row.case_id,
    caseTitle: isFaculty(user) ? c.title : "",
    participant: who?.name || "",
    role: profession(cfg.professionId).name,
    mode: cfg.mode,
    level: cfg.knobs.level,
    visitNumber: cfg.visitNumber || 1,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    transcript: messagesOf(id).map((m) => ({ turn: m.turn, speaker: m.speaker, text: m.text })),
    disclosed: chart.sections.flatMap((s) => s.items.map((i) => ({ category: s.label, text: i.text, turn: i.turn }))),
    results: chart.results.map((r) => ({ name: r.name, result: r.result, turn: r.turn })),
    writeUp: parse<Record<string, string>>(row.wrapup, {}),
    feedback: f && showFeedback ? { total: f.total, max: f.max, percent: f.percent, summary: f.summary, domains: f.domains.map((d) => ({ name: d.name, score: d.score, max: d.max, rationale: d.rationale })), strengths: f.strengths.map((s) => s.text), improvements: f.improvements.map((s) => s.text), needsReview: f.needsReview } : null,
  };
}

/** Patients in the library. Faculty get the whole record; students get what is in the chart before a visit. */
export function listPatients(user: User, name?: string) {
  const rows = all<{ id: string; title: string; status: string; profile: string }>(
    `SELECT id, title, status, profile FROM cases WHERE status ${isFaculty(user) ? "!= 'archived'" : "= 'published'"} ${name?.trim() ? "AND json_extract(profile, '$.patient.name') LIKE ?" : ""} ORDER BY title LIMIT 200`,
    ...(name?.trim() ? [`%${name.trim()}%`] : []),
  );
  return rows.map((r) => {
    const c = parse<CaseProfile>(r.profile, {} as CaseProfile);
    return { caseId: r.id, patient: c.patient?.name, age: c.patient?.age, sex: c.patient?.sex, specialty: c.specialty, professions: c.professions, encounterType: c.encounterType, level: c.difficulty, ...(isFaculty(user) ? { title: r.title, status: r.status } : {}) };
  });
}

export function getPatientRecord(user: User, caseId: string) {
  const row = get<{ profile: string; status: string }>("SELECT profile, status FROM cases WHERE id = ?", caseId);
  if (!row) return null;
  const c = parse<CaseProfile>(row.profile, {} as CaseProfile);
  if (isFaculty(user)) return { caseId, status: row.status, record: c };
  if (row.status !== "published") return null;
  // Students get only what they would see before asking a single question.
  return { caseId, record: { patient: c.patient, setting: c.setting, encounterType: c.encounterType, brief: c.scenario.studentBrief, chiefComplaint: c.scenario.chiefComplaint, chartAtStart: c.chartAtStart, documentsAtStart: c.artifacts.filter((a) => a.release.when === "start").map((a) => ({ type: a.type, title: a.title, date: a.date, body: a.body, table: a.table })) } };
}
