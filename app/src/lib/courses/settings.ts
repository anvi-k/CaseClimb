// Shared by server and client code: no database imports here.
import type { Knobs } from "@/lib/types";

export type AssignmentType = "homework" | "exam" | "practice";

/** Stored as JSON in assignments.settings and enforced by POST /api/encounters. */
export interface AssignmentSettings {
  /** 1-5, or null to use each patient's own level. */
  level: number | null;
  knobs?: Partial<Knobs>;
  /** Minutes. 0 = no limit. Left out = the default for the level. */
  timeLimitMin?: number;
  hints: boolean;
  /** 0 = unlimited. */
  maxAttempts: number;
  liveAssist: boolean;
  /** Repeat attempts get a change in the patient's mood and delivery. */
  perturb: boolean;
  feedbackRelease: "immediate" | "manual";
  /**
   * One continuing patient for the whole class: each student's visit follows on from the others',
   * the patient remembers who said what, and earlier students' notes are in the chart.
   */
  sharedPatient?: boolean;
}

export const TYPE_LABEL: Record<AssignmentType, string> = { homework: "Homework", exam: "Exam", practice: "Practice set" };

export function defaultSettings(type: AssignmentType): AssignmentSettings {
  if (type === "exam") return { level: 3, timeLimitMin: 20, hints: false, maxAttempts: 1, liveAssist: false, perturb: false, feedbackRelease: "manual" };
  if (type === "practice") return { level: null, hints: true, maxAttempts: 0, liveAssist: true, perturb: true, feedbackRelease: "immediate" };
  return { level: 3, hints: true, maxAttempts: 3, liveAssist: false, perturb: true, feedbackRelease: "immediate" };
}

const int = (v: unknown, lo: number, hi: number, fallback: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
};

/** Cleans untrusted input (browser or model) into valid settings and applies the exam rules. */
export function normalizeSettings(type: AssignmentType, raw: Record<string, unknown> | null | undefined): AssignmentSettings {
  const d = defaultSettings(type);
  const r = raw || {};
  const out: AssignmentSettings = {
    level: r.level === null || r.level === undefined || r.level === "" ? d.level : int(r.level, 1, 5, d.level ?? 3),
    hints: typeof r.hints === "boolean" ? r.hints : d.hints,
    maxAttempts: int(r.maxAttempts, 0, 20, d.maxAttempts),
    liveAssist: typeof r.liveAssist === "boolean" ? r.liveAssist : d.liveAssist,
    perturb: typeof r.perturb === "boolean" ? r.perturb : d.perturb,
    feedbackRelease: r.feedbackRelease === "manual" || r.feedbackRelease === "immediate" ? r.feedbackRelease : d.feedbackRelease,
  };
  if (r.sharedPatient === true && type !== "exam") out.sharedPatient = true;
  if (r.level === null && type !== "exam") out.level = null;
  if (r.timeLimitMin !== null && r.timeLimitMin !== undefined && r.timeLimitMin !== "") out.timeLimitMin = int(r.timeLimitMin, 0, 180, 20);
  else if (d.timeLimitMin !== undefined && type === "exam") out.timeLimitMin = d.timeLimitMin;
  if (type === "exam") {
    // Exams: no hints, and every student meets the patient at the same fixed level.
    out.hints = false;
    if (out.level === null) out.level = 3;
  }
  return out;
}

/** One-line description of the settings for lists. */
export function describeSettings(s: AssignmentSettings): string {
  const parts = [s.level ? `Level ${s.level}` : "Each patient's own level"];
  if (s.timeLimitMin !== undefined) parts.push(s.timeLimitMin ? `${s.timeLimitMin} min` : "no time limit");
  parts.push(s.hints ? "hints on" : "hints off");
  parts.push(s.maxAttempts ? `${s.maxAttempts} attempt${s.maxAttempts === 1 ? "" : "s"}` : "unlimited attempts");
  if (s.perturb) parts.push("patient varies on repeats");
  if (s.liveAssist) parts.push("live assist on");
  if (s.sharedPatient) parts.push("one shared patient for the class");
  return parts.join(" · ");
}

/** SQLite stores UTC as "YYYY-MM-DD HH:MM:SS"; make it parseable everywhere. */
export const toDate = (s: string) => new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(" ", "T") + "Z");

/** Where a visit and its feedback live (pages owned by the encounter area). */
export const visitUrl = (encounterId: string) => `/encounter/${encounterId}`;
export const feedbackUrl = (encounterId: string) => `/encounter/${encounterId}/feedback`;
