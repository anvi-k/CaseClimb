import { customAlphabet } from "nanoid";
import { all, get, parse } from "@/lib/db";
import { isFaculty } from "@/lib/auth";
import type { CaseProfile, EncounterConfig, Feedback, Importance, User } from "@/lib/types";
import { normalizeSettings, type AssignmentSettings, type AssignmentType } from "./settings";
import { decodeEntities } from "./save";
import { studentCaseLabel, studentCaseLabelFromJson, studentJourneyLabel } from "./label";

export * from "./settings";
export * from "./label";

export interface CourseRow {
  id: string;
  faculty_id: string;
  name: string;
  profession_id: string | null;
  join_code: string;
  created_at: string;
}
export interface AssignmentRow {
  id: string;
  course_id: string;
  title: string;
  instructions: string;
  type: AssignmentType;
  case_ids: string;
  journey_id: string | null;
  settings: string;
  due_at: string | null;
  feedback_released: number;
  created_at: string;
}
export interface Assignment extends Omit<AssignmentRow, "case_ids" | "settings"> {
  caseIds: string[];
  settings: AssignmentSettings;
}

// No 0/O/1/I so codes survive being read aloud in class.
const code = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 6);
export function newJoinCode(): string {
  for (;;) {
    const c = code();
    if (!get("SELECT 1 FROM courses WHERE join_code = ?", c)) return c;
  }
}

export const toAssignment = (r: AssignmentRow): Assignment => {
  const { case_ids, settings, ...rest } = r;
  // Rows saved before entities were decoded on save may still hold "&amp;amp;".
  rest.title = decodeEntities(rest.title || "");
  rest.instructions = decodeEntities(rest.instructions || "");
  return { ...rest, caseIds: parse<string[]>(case_ids, []), settings: normalizeSettings(r.type, parse<Record<string, unknown>>(settings, {})) };
};

/** A course the faculty member may manage: their own, or any course for an admin. */
export function courseFor(user: User, courseId: string): CourseRow | null {
  const c = get<CourseRow>("SELECT * FROM courses WHERE id = ?", courseId);
  if (!c || !isFaculty(user)) return null;
  return c.faculty_id === user.id || user.role === "admin" ? c : null;
}
export function assignmentFor(user: User, assignmentId: string): { a: Assignment; course: CourseRow } | null {
  const r = get<AssignmentRow>("SELECT * FROM assignments WHERE id = ?", assignmentId);
  if (!r) return null;
  const course = courseFor(user, r.course_id);
  return course ? { a: toAssignment(r), course } : null;
}
export const coursesOf = (user: User) =>
  user.role === "admin" ? all<CourseRow>("SELECT * FROM courses ORDER BY created_at DESC") : all<CourseRow>("SELECT * FROM courses WHERE faculty_id = ? ORDER BY created_at DESC", user.id);

// ---------- Cases ----------

/** What a student may know about a patient before the visit. Never includes findings. */
export interface CaseCard {
  id: string;
  /** Neutral label from `studentCaseLabel`. The faculty title is deliberately not on this type. */
  label: string;
  specialty: string;
  professions: string[];
  difficulty: number;
  encounterType: string;
  patientFirstName: string;
  age: number | null;
  /** Written by AI and not yet reviewed by faculty. */
  aiDraft: boolean;
}
/** Faculty-side description used by the assignment builder and its guide. */
export interface CaseBrief extends CaseCard {
  title: string;
  summary: string;
  objectives: string[];
  timeLimitMin: number;
}

interface CaseRow {
  id: string;
  title: string;
  specialty: string;
  professions: string;
  difficulty: number;
  origin: string;
  reviewed: number;
  profile: string;
}
function brief(r: CaseRow): CaseBrief {
  const p = parse<Partial<CaseProfile>>(r.profile, {});
  return {
    id: r.id,
    title: r.title,
    label: studentCaseLabel({ patient: p.patient, encounterType: p.encounterType, specialty: r.specialty || p.specialty }),
    specialty: r.specialty || p.specialty || "",
    professions: parse<string[]>(r.professions, []),
    difficulty: r.difficulty,
    encounterType: p.encounterType || "",
    patientFirstName: (p.patient?.name || "").split(" ")[0] || "Patient",
    age: p.patient?.age ?? null,
    aiDraft: r.origin === "ai_draft" && !r.reviewed,
    summary: p.summary || "",
    objectives: (p.objectives || []).map((o) => o.text),
    timeLimitMin: p.scenario?.timeLimitMin || 20,
  };
}
export const publishedCaseBriefs = (): CaseBrief[] =>
  all<CaseRow>("SELECT id, title, specialty, professions, difficulty, origin, reviewed, profile FROM cases WHERE status = 'published' ORDER BY title").map(brief);

export const toCard = (b: CaseBrief): CaseCard => ({
  id: b.id,
  label: b.label,
  specialty: b.specialty,
  professions: b.professions,
  difficulty: b.difficulty,
  encounterType: b.encounterType,
  patientFirstName: b.patientFirstName,
  age: b.age,
  aiDraft: b.aiDraft,
});
export const publishedCaseCards = (): CaseCard[] => publishedCaseBriefs().map(toCard);

/** Student-safe labels for a set of cases, keyed by case id. */
export function studentCaseLabels(caseIds: string[]): Map<string, string> {
  const ids = [...new Set(caseIds.filter(Boolean))];
  if (!ids.length) return new Map();
  return new Map(all<{ id: string; profile: string }>(`SELECT id, profile FROM cases WHERE id IN (${ids.map(() => "?").join(",")})`, ...ids).map((r) => [r.id, studentCaseLabelFromJson(r.profile)]));
}

/** What a student sees for a care journey: the patient and the roles involved, never the faculty title or summary. */
export function studentJourneyCard(journeyId: string): { title: string; roles: string } | null {
  const j = get<{ spec: string; profile: string | null }>("SELECT j.spec, c.profile FROM journeys j LEFT JOIN cases c ON c.id = j.case_id WHERE j.id = ?", journeyId);
  if (!j) return null;
  const stages = parse<{ stages?: { order: number; roleTitle: string }[] }>(j.spec, {}).stages || [];
  const name = parse<Partial<CaseProfile>>(j.profile, {}).patient?.name;
  return studentJourneyLabel(name, [...stages].sort((a, b) => a.order - b.order).map((s) => s.roleTitle));
}

export const publishedJourneys = () => all<{ id: string; title: string; case_id: string }>("SELECT id, title, case_id FROM journeys WHERE status = 'published' ORDER BY title");

// ---------- Gradebook ----------

interface EncRow {
  id: string;
  user_id: string;
  case_id: string;
  parent_id: string | null;
  status: string;
  score: number | null;
  faculty_score: number | null;
  faculty_note: string | null;
  feedback: string | null;
  config: string;
  started_at: string;
  ended_at: string | null;
}

export interface GradeAttempt {
  id: string;
  status: string;
  /** Rubric score 0-100. */
  score: number | null;
  /** Adjusted score set by faculty, if any. */
  facultyScore: number | null;
  /** The score that counts: the faculty adjustment when there is one. */
  final: number | null;
  level: number;
  variation: string | null;
  needsReview: boolean;
  reviewReasons: string[];
  hasNote: boolean;
  startedAt: string;
}
export interface GradeRow {
  userId: string;
  student: string;
  email: string;
  enrolled: boolean;
  caseId: string;
  caseTitle: string;
  attempts: GradeAttempt[];
  inProgress: number;
  best: number | null;
  latest: number | null;
  /** Domain scores from the latest scored attempt. */
  domains: Record<string, { score: number | null; max: number }>;
  needsReview: boolean;
}
export interface ClassInsights {
  /** Students x patients with at least one scored visit. */
  scored: number;
  domains: { key: string; name: string; n: number; avgPct: number; low: number }[];
  missed: { key: string; caseTitle: string; topic: string; chart: string; importance: Importance; count: number; of: number }[];
  actionsMissed: { key: string; caseTitle: string; name: string; importance: Importance; count: number; of: number }[];
}
export interface Gradebook {
  rows: GradeRow[];
  domainCols: { key: string; name: string }[];
  insights: ClassInsights;
  submitted: number;
  needsReview: number;
}

/** 4-point domains bottom out at 1, checklist items at 0. */
const domainPct = (score: number, max: number) => (max === 4 ? ((score - 1) / 3) * 100 : max ? (score / max) * 100 : 0);

export function gradebook(a: Assignment): Gradebook {
  const encs = all<EncRow>(
    `SELECT id, user_id, case_id, parent_id, status, score, faculty_score, faculty_note, feedback, config, started_at, ended_at
     FROM encounters
     WHERE (assignment_id = ? OR journey_run_id IN (SELECT id FROM journey_runs WHERE assignment_id = ?)) AND status != 'abandoned'
     ORDER BY started_at`,
    a.id,
    a.id,
  );
  const roster = all<{ id: string; name: string; email: string }>(
    "SELECT u.id, u.name, u.email FROM enrollments en JOIN users u ON u.id = en.user_id WHERE en.course_id = ? ORDER BY u.name",
    a.course_id,
  );
  const people = new Map(roster.map((u) => [u.id, { ...u, enrolled: true }]));
  for (const e of encs) {
    if (people.has(e.user_id)) continue;
    const u = get<{ id: string; name: string; email: string }>("SELECT id, name, email FROM users WHERE id = ?", e.user_id);
    if (u) people.set(u.id, { ...u, enrolled: false });
  }
  const caseIds = [...new Set([...a.caseIds, ...encs.map((e) => e.case_id)])];
  const titles = new Map(caseIds.map((id) => [id, get<{ title: string }>("SELECT title FROM cases WHERE id = ?", id)?.title || "Removed patient"]));

  const rows: GradeRow[] = [];
  const domainCols: { key: string; name: string }[] = [];
  const dom = new Map<string, { key: string; name: string; n: number; sum: number; low: number }>();
  const missed = new Map<string, ClassInsights["missed"][number]>();
  const actionsMissed = new Map<string, ClassInsights["actionsMissed"][number]>();
  const scoredPerCase = new Map<string, number>();
  let scoredPairs = 0;

  for (const u of people.values()) {
    for (const caseId of caseIds) {
      const mine = encs.filter((e) => e.user_id === u.id && e.case_id === caseId);
      if (!mine.length && (!u.enrolled || !a.caseIds.includes(caseId))) continue;
      const attempts: GradeAttempt[] = mine
        .filter((e) => e.status === "scored" || e.status === "submitted")
        .map((e) => {
          const f = parse<Partial<Feedback>>(e.feedback, {});
          const cfg = parse<Partial<EncounterConfig>>(e.config, {});
          return {
            id: e.id,
            status: e.status,
            score: e.score,
            facultyScore: e.faculty_score,
            final: e.faculty_score ?? e.score,
            level: cfg.knobs?.level ?? 0,
            variation: cfg.perturbation?.label || null,
            needsReview: !!f.needsReview,
            reviewReasons: f.reviewReasons || [],
            hasNote: !!e.faculty_note,
            startedAt: e.started_at,
          };
        });
      const finals = attempts.map((x) => x.final).filter((x): x is number => x !== null);
      const lastScored = [...mine].reverse().find((e) => e.status === "scored" && e.feedback);
      const fb = lastScored ? parse<Partial<Feedback>>(lastScored.feedback, {}) : null;
      const domains: GradeRow["domains"] = {};
      if (fb) {
        scoredPairs++;
        scoredPerCase.set(caseId, (scoredPerCase.get(caseId) || 0) + 1);
        for (const d of fb.domains || []) {
          domains[d.key] = { score: d.score, max: d.max };
          if (!domainCols.some((c) => c.key === d.key)) domainCols.push({ key: d.key, name: d.name });
          if (d.score === null) continue;
          const agg = dom.get(d.key) || { key: d.key, name: d.name, n: 0, sum: 0, low: 0 };
          const pct = domainPct(d.score, d.max);
          agg.n++;
          agg.sum += pct;
          if (pct < 50) agg.low++;
          dom.set(d.key, agg);
        }
        for (const m of fb.missed || []) {
          if (m.importance === "minor") continue;
          const key = caseId + ":" + m.id;
          const x = missed.get(key) || { key, caseTitle: titles.get(caseId)!, topic: m.topic, chart: m.chart, importance: m.importance, count: 0, of: 0 };
          x.count++;
          missed.set(key, x);
        }
        for (const m of fb.actionsMissed || []) {
          const key = caseId + ":" + m.id;
          const x = actionsMissed.get(key) || { key, caseTitle: titles.get(caseId)!, name: m.name, importance: m.importance, count: 0, of: 0 };
          x.count++;
          actionsMissed.set(key, x);
        }
      }
      rows.push({
        userId: u.id,
        student: u.name,
        email: u.email,
        enrolled: u.enrolled,
        caseId,
        caseTitle: titles.get(caseId)!,
        attempts,
        inProgress: mine.filter((e) => e.status === "active" || e.status === "paused").length,
        best: finals.length ? Math.max(...finals) : null,
        latest: finals.length ? finals[finals.length - 1] : null,
        domains,
        needsReview: attempts.some((x) => x.needsReview && !x.hasNote && x.facultyScore === null),
      });
    }
  }
  const rank = { critical: 0, important: 1, minor: 2 };
  const withOf = <T extends { key: string; count: number; of: number; importance: Importance }>(m: Map<string, T>) =>
    [...m.values()]
      .map((x) => ({ ...x, of: scoredPerCase.get(x.key.split(":")[0]) || x.count }))
      .sort((p, q) => q.count / q.of - p.count / p.of || rank[p.importance] - rank[q.importance] || q.count - p.count);
  return {
    rows,
    domainCols,
    insights: {
      scored: scoredPairs,
      domains: [...dom.values()].map((d) => ({ key: d.key, name: d.name, n: d.n, avgPct: Math.round(d.sum / d.n), low: d.low })).sort((p, q) => p.avgPct - q.avgPct),
      missed: withOf(missed),
      actionsMissed: withOf(actionsMissed),
    },
    submitted: rows.filter((r) => r.attempts.length).length,
    needsReview: rows.filter((r) => r.needsReview).length,
  };
}

/**
 * SQL condition (encounters aliased `e`) for visits an instructor may be shown: those started from an
 * assignment or a care journey, which the student sees labelled "Recorded". Self-started practice is
 * labelled "Private practice: only you see this visit and its feedback" and must never be listed for faculty.
 */
export const RECORDED_VISIT = "(e.assignment_id IS NOT NULL OR e.journey_run_id IS NOT NULL)";

/** Scored visits flagged for a human look that no faculty member has annotated yet. Recorded visits only. */
export function reviewQueue(user: User, limit = 20) {
  // Assignment visits go to the course's instructor; journey visits outside an assignment have no course, so any faculty member may review them.
  const mine = user.role === "admin" ? "" : "AND (co.faculty_id = ? OR e.assignment_id IS NULL)";
  const rows = all<{ id: string; student: string; title: string; score: number | null; feedback: string; ended_at: string | null; assignment: string | null; assignment_id: string | null; course_id: string | null }>(
    `SELECT e.id, u.name AS student, c.title, e.score, e.feedback, e.ended_at, a.title AS assignment, a.id AS assignment_id, a.course_id
     FROM encounters e JOIN users u ON u.id = e.user_id JOIN cases c ON c.id = e.case_id
     LEFT JOIN assignments a ON a.id = e.assignment_id LEFT JOIN courses co ON co.id = a.course_id
     WHERE e.status = 'scored' AND e.faculty_note IS NULL AND e.faculty_score IS NULL AND u.role = 'student'
       AND ${RECORDED_VISIT} AND e.feedback LIKE '%"needsReview":true%' ${mine}
     ORDER BY e.ended_at DESC LIMIT 200`,
    ...(mine ? [user.id] : []),
  );
  return rows
    .map((r) => ({ ...r, assignment: r.assignment && decodeEntities(r.assignment), reasons: parse<Partial<Feedback>>(r.feedback, {}).reviewReasons || [], feedback: undefined }))
    .slice(0, limit);
}

// ---------- Student side ----------

export interface StudentCaseStatus {
  card: CaseCard;
  attemptsUsed: number;
  activeId: string | null;
  /** Latest finished visit, for the feedback link. */
  lastId: string | null;
  best: number | null;
  scoredCount: number;
}
export interface StudentAssignment {
  a: Assignment;
  course: string;
  journeyTitle: string | null;
  cases: StudentCaseStatus[];
  status: "not_started" | "in_progress" | "submitted";
  /** False while the instructor is holding feedback. */
  feedbackVisible: boolean;
}

export function studentAssignments(userId: string): StudentAssignment[] {
  const rows = all<AssignmentRow & { course: string }>(
    `SELECT a.*, co.name AS course FROM assignments a JOIN courses co ON co.id = a.course_id JOIN enrollments en ON en.course_id = a.course_id
     WHERE en.user_id = ? ORDER BY a.due_at IS NULL, a.due_at, a.created_at DESC`,
    userId,
  );
  const cards = new Map(publishedCaseCards().map((c) => [c.id, c]));
  return rows.map((r) => {
    const a = toAssignment(r);
    const feedbackVisible = !!a.feedback_released;
    const encs = all<{ id: string; case_id: string; parent_id: string | null; status: string; score: number | null; faculty_score: number | null }>(
      `SELECT id, case_id, parent_id, status, score, faculty_score FROM encounters
       WHERE user_id = ? AND status != 'abandoned' AND (assignment_id = ? OR journey_run_id IN (SELECT id FROM journey_runs WHERE assignment_id = ? AND user_id = ?)) ORDER BY started_at`,
      userId,
      a.id,
      a.id,
      userId,
    );
    const cases: StudentCaseStatus[] = a.caseIds
      .filter((id) => cards.has(id))
      .map((id) => {
        const mine = encs.filter((e) => e.case_id === id);
        const done = mine.filter((e) => e.status === "scored" || e.status === "submitted");
        const scores = done.map((e) => e.faculty_score ?? e.score).filter((x): x is number => x !== null);
        return {
          card: cards.get(id)!,
          // Same count the server uses to enforce the attempt limit.
          attemptsUsed: mine.filter((e) => !e.parent_id).length,
          activeId: [...mine].reverse().find((e) => e.status === "active" || e.status === "paused")?.id || null,
          lastId: done.length ? done[done.length - 1].id : null,
          best: feedbackVisible && scores.length ? Math.max(...scores) : null,
          scoredCount: done.length,
        };
      });
    const anyDone = a.journey_id ? encs.some((e) => e.status === "scored" || e.status === "submitted") : cases.length > 0 && cases.every((c) => c.scoredCount > 0);
    const status = anyDone ? "submitted" : encs.length ? "in_progress" : "not_started";
    const jc = a.journey_id ? studentJourneyCard(a.journey_id) : null;
    const journeyTitle = a.journey_id ? (jc ? `${jc.title} (${jc.roles})` : "Care journey") : null;
    return { a, course: r.course, journeyTitle, cases, status, feedbackVisible };
  });
}

/** Assignment ids whose feedback the instructor is still holding. Scores for these stay hidden from students. */
export const heldAssignmentIds = () => new Set(all<{ id: string }>("SELECT id FROM assignments WHERE feedback_released = 0").map((r) => r.id));

// ---------- Faculty overview ----------

export interface AssignmentOverview {
  a: Assignment;
  course: string;
  roster: number;
  /** Students with at least one finished visit. */
  submitted: number;
  inProgress: number;
}
export function assignmentOverviews(user: User, courseId?: string): AssignmentOverview[] {
  const courses = courseId ? coursesOf(user).filter((c) => c.id === courseId) : coursesOf(user);
  const out: AssignmentOverview[] = [];
  for (const c of courses) {
    const roster = get<{ n: number }>("SELECT COUNT(*) AS n FROM enrollments WHERE course_id = ?", c.id)!.n;
    for (const r of all<AssignmentRow>("SELECT * FROM assignments WHERE course_id = ? ORDER BY due_at IS NULL, due_at, created_at DESC", c.id)) {
      const where = "(e.assignment_id = ? OR e.journey_run_id IN (SELECT id FROM journey_runs WHERE assignment_id = ?)) AND e.user_id IN (SELECT user_id FROM enrollments WHERE course_id = ?)";
      const n = (statuses: string) => get<{ n: number }>(`SELECT COUNT(DISTINCT e.user_id) AS n FROM encounters e WHERE ${where} AND e.status IN (${statuses})`, r.id, r.id, c.id)!.n;
      out.push({ a: toAssignment(r), course: c.name, roster, submitted: n("'scored','submitted'"), inProgress: n("'active','paused'") });
    }
  }
  return out;
}

/** Visits in progress that an instructor can watch (live assist on), started in the last three hours. */
export function liveVisitCount(): number {
  return all<{ config: string }>(`SELECT e.config FROM encounters e WHERE e.status IN ('active','paused') AND e.started_at > datetime('now','-3 hours') AND ${RECORDED_VISIT}`).filter((r) => parse<Partial<EncounterConfig>>(r.config, {}).liveAssist).length;
}
