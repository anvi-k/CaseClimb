import { all, get, parse, run } from "./db";
import { LEVEL_RATING } from "./engine/difficulty";
import { studentCaseLabelFromJson } from "./courses/label";
import type { CaseProfile, DomainScore, Knobs } from "./types";

/**
 * Adaptive learner model.
 *
 * Each student has one rating per (profession, rubric domain), on an Elo-style scale where each
 * difficulty level "plays at" a fixed rating (LEVEL_RATING). After a scored encounter:
 *
 *   expected = 1 / (1 + 10^((levelRating - rating) / 400))
 *   outcome  = (domainScore - 1) / 3            // rubric 1..4 mapped to 0..1
 *   rating  += K * (outcome - expected)         // K shrinks as evidence accumulates
 *
 * The next session is set at the level where the student's expected outcome is closest to TARGET,
 * and the patient-behaviour knobs are biased toward the student's weakest domain.
 * No language model is involved in any of this.
 */
const TARGET = 0.7;
const START = 1200;

export const expectedScore = (rating: number, level: number) => 1 / (1 + Math.pow(10, (LEVEL_RATING[level] - rating) / 400));

export function recordSkill(userId: string, professionId: string, encounterId: string, level: number, domains: DomainScore[]) {
  if (get("SELECT 1 FROM skill_events WHERE encounter_id = ? LIMIT 1", encounterId)) return;
  for (const d of domains) {
    if (d.score === null || !d.max) continue;
    // Checklist items are 0..max; 4-point domains are 1..4.
    const outcome = d.max === 4 ? (d.score - 1) / 3 : d.score / d.max;
    const row = get<{ rating: number; n: number }>(
      "SELECT rating, n FROM skill_ratings WHERE user_id = ? AND profession_id = ? AND domain = ?",
      userId,
      professionId,
      d.key,
    );
    const before = row?.rating ?? START;
    const n = row?.n ?? 0;
    const expected = expectedScore(before, level);
    const K = Math.max(48, 160 / Math.sqrt(n + 1));
    const after = before + K * (outcome - expected);
    run(
      `INSERT INTO skill_ratings (user_id, profession_id, domain, rating, n, updated_at) VALUES (?,?,?,?,?,datetime('now'))
       ON CONFLICT(user_id, profession_id, domain) DO UPDATE SET rating = excluded.rating, n = excluded.n, updated_at = excluded.updated_at`,
      userId,
      professionId,
      d.key,
      after,
      n + 1,
    );
    run(
      "INSERT INTO skill_events (user_id, profession_id, encounter_id, domain, level, outcome, expected, before, after) VALUES (?,?,?,?,?,?,?,?,?)",
      userId,
      professionId,
      encounterId,
      d.key,
      level,
      outcome,
      expected,
      before,
      after,
    );
  }
}

export interface SkillProfile {
  domains: { domain: string; rating: number; n: number }[];
  overall: number;
  sessions: number;
  weakest: string | null;
  level: number;
  expectedAtLevel: number;
}

export function skillProfile(userId: string, professionId: string): SkillProfile {
  const domains = all<{ domain: string; rating: number; n: number }>(
    "SELECT domain, rating, n FROM skill_ratings WHERE user_id = ? AND profession_id = ? ORDER BY domain",
    userId,
    professionId,
  );
  const overall = domains.length ? domains.reduce((s, d) => s + d.rating, 0) / domains.length : START;
  const sessions = domains.length ? Math.max(...domains.map((d) => d.n)) : 0;
  let level = 1;
  let best = Infinity;
  for (let L = 1; L <= 5; L++) {
    const gap = Math.abs(expectedScore(overall, L) - TARGET);
    if (gap < best) {
      best = gap;
      level = L;
    }
  }
  // New students start gently rather than at the level the default rating implies.
  if (sessions === 0) level = 2;
  const weakest = domains.length ? [...domains].sort((a, b) => a.rating - b.rating)[0].domain : null;
  return { domains, overall, sessions, weakest, level, expectedAtLevel: expectedScore(overall, level) };
}

/** Knob bias so the next patient exercises the weakest domain. */
function focusKnobs(weakest: string | null): { knobs: Partial<Knobs>; why: string } {
  switch (weakest) {
    case "rapport_respect_empathy":
    case "listening_and_response_to_cues":
      return { knobs: { emotion: 2, reluctantAt: 70 }, why: "a more emotional, guarded patient to practice empathy and picking up cues" };
    case "information_gathering":
      return { knobs: { vagueness: 2, volunteers: false, factsPerTurn: 2 }, why: "a vaguer patient who needs specific, well-sequenced questions" };
    case "explanation_and_shared_decisions":
      return { knobs: { vagueness: 1 }, why: "a patient who asks for explanations and needs plain language" };
    case "clinical_reasoning_and_synthesis":
      return { knobs: { distractors: true }, why: "a case with red herrings to practice separating relevant from irrelevant findings" };
    case "opening_and_purpose":
    case "professionalism_safety_closure":
      return { knobs: { timeLimitMin: 15 }, why: "a time-boxed visit to practice a clear opening and a safe close" };
    default:
      return { knobs: {}, why: "a balanced patient" };
  }
}

export interface Recommendation {
  caseId: string | null;
  /** Student-safe label (patient, visit type, specialty). Never the faculty case title. */
  label: string | null;
  level: number;
  knobs: Partial<Knobs>;
  reason: string;
  profile: SkillProfile;
}

export function recommend(userId: string, professionId: string): Recommendation {
  const profile = skillProfile(userId, professionId);
  const focus = focusKnobs(profile.weakest);
  const cases = all<{ id: string; title: string; difficulty: number; professions: string; profile: string }>(
    "SELECT id, title, difficulty, professions, profile FROM cases WHERE status = 'published'",
  ).filter((c) => parse<string[]>(c.professions, []).includes(professionId));
  const done = new Map(
    all<{ case_id: string; n: number }>(
      "SELECT case_id, COUNT(*) AS n FROM encounters WHERE user_id = ? AND status IN ('submitted','scored') GROUP BY case_id",
      userId,
    ).map((r) => [r.case_id, r.n]),
  );
  // Prefer unseen cases, then cases whose intrinsic difficulty is near the target level.
  const ranked = cases
    .map((c) => ({ c, cost: (done.get(c.id) || 0) * 3 + Math.abs(c.difficulty - profile.level) }))
    // Stable order, so the recommendation does not change between page loads.
    .sort((a, b) => a.cost - b.cost || a.c.id.localeCompare(b.c.id));
  const pick = ranked[0]?.c || null;
  const pct = Math.round(profile.expectedAtLevel * 100);
  const reason =
    profile.sessions === 0
      ? `No history yet, so this starts at level 2 and adjusts after each visit.`
      : `Your rating is ${Math.round(profile.overall)} after ${profile.sessions} visit${profile.sessions === 1 ? "" : "s"}. Level ${profile.level} gives an expected score of about ${pct}%, the range where practice is most productive. Weakest area: ${(profile.weakest || "").replace(/_/g, " ")}, so you get ${focus.why}.`;
  return { caseId: pick?.id || null, label: pick ? studentCaseLabelFromJson(pick.profile) : null, level: profile.level, knobs: focus.knobs, reason, profile };
}

export const caseTitle = (profileJson: string) => parse<CaseProfile>(profileJson, {} as CaseProfile).title;
