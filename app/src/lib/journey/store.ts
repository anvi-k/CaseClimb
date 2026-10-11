import { all, get, newId, parse, run } from "../db";
import { professions } from "../professions";
import type { CaseProfile, Profession } from "../types";
import { deriveStatus } from "./types";
import type {
  EntryKind,
  EntrySource,
  EntryStatus,
  Evidence,
  Handoff,
  Huddle,
  JourneySpec,
  Relation,
  Stage,
  StateEntry,
  StateLink,
  Synthesis,
  TeamMessage,
  TraceEvaluation,
} from "./types";

// ---------- Rows ----------

export interface JourneyRow {
  id: string;
  owner_id: string | null;
  status: "draft" | "published" | "archived";
  title: string;
  case_id: string;
  spec: string;
  created_at: string;
}
export interface RunRow {
  id: string;
  journey_id: string;
  user_id: string;
  assignment_id: string | null;
  student_stage_id: string;
  status: string;
  current_stage: number;
  synthesis: string | null;
  evaluation: string | null;
  huddle: string | null;
  error: string | null;
  created_at: string;
  ended_at: string | null;
}
export interface StageRunRow {
  run_id: string;
  stage_id: string;
  stage_order: number;
  is_student: number;
  encounter_id: string | null;
  status: string;
  note: string | null;
  error: string | null;
  started_at: string | null;
  ended_at: string | null;
}
export interface ClinicianRow {
  id: string;
  name: string;
  role: string;
  profession_id: string | null;
  profile: string;
}

export const RECORD_STAGE = "record";

export function loadJourney(id: string): { row: JourneyRow; spec: JourneySpec; stages: Stage[] } | null {
  const row = get<JourneyRow>("SELECT * FROM journeys WHERE id = ?", id);
  if (!row) return null;
  const spec = parse<JourneySpec>(row.spec, { summary: "", stages: [] });
  const stages = [...(spec.stages || [])].sort((a, b) => a.order - b.order);
  return { row, spec, stages };
}

export function loadRun(id: string) {
  const row = get<RunRow>("SELECT * FROM journey_runs WHERE id = ?", id);
  if (!row) return null;
  const j = loadJourney(row.journey_id);
  if (!j) return null;
  const caseRow = get<{ profile: string; title: string }>("SELECT profile, title FROM cases WHERE id = ?", j.row.case_id);
  const c = parse<CaseProfile>(caseRow?.profile, {} as CaseProfile);
  return {
    row,
    journey: j.row,
    spec: j.spec,
    stages: j.stages,
    c,
    synthesis: parse<Synthesis | null>(row.synthesis, null),
    evaluation: parse<TraceEvaluation | null>(row.evaluation, null),
    huddle: parse<Huddle | null>(row.huddle, null),
  };
}
export type LoadedRun = NonNullable<ReturnType<typeof loadRun>>;

export const stageRuns = (runId: string) => all<StageRunRow>("SELECT * FROM journey_stage_runs WHERE run_id = ? ORDER BY stage_order", runId);
export const stageRun = (runId: string, stageId: string) => get<StageRunRow>("SELECT * FROM journey_stage_runs WHERE run_id = ? AND stage_id = ?", runId, stageId);
export function setStage(runId: string, stageId: string, patch: Partial<Pick<StageRunRow, "status" | "encounter_id" | "note" | "error" | "started_at" | "ended_at">>) {
  const keys = Object.keys(patch) as (keyof typeof patch)[];
  if (!keys.length) return;
  run(`UPDATE journey_stage_runs SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE run_id = ? AND stage_id = ?`, ...keys.map((k) => patch[k] ?? null), runId, stageId);
}

// ---------- Clinician personas ----------

export interface ClinicianInfo {
  id: string;
  /** Display name, e.g. "Dr. Brian Lee" or "Tasha Dunbar, RD". */
  name: string;
  role: string;
  specialty: string;
  profile: Record<string, unknown>;
}

function displayName(o: { name?: string; credentials?: string; full_title?: string }, fallback: string) {
  const name = o.name || fallback;
  const cred = o.credentials || "";
  if (/\b(MD|DO|PharmD|PhD|DNP|DPT)\b/.test(cred)) return `Dr. ${name}`;
  const short = cred.split(",").map((s) => s.trim()).find((s) => /^(RD|RDN|RN|PA|NP|PT|OT|SLP|LCSW|MSW)/.test(s));
  return short ? `${name}, ${short}` : name;
}

/** A stage whose role none of the provided personas fits is played by a plain, named clinician of that profession: "generic:Name|Role". */
export const genericClinicianId = (name: string, role: string) => `generic:${name.replace(/[|:]/g, " ").trim()}|${role.replace(/[|:]/g, " ").trim()}`;

export function clinician(id: string | null | undefined): ClinicianInfo {
  if (id?.startsWith("generic:")) {
    const [name, role] = id.slice(8).split("|");
    return { id, name: name || "Team clinician", role: role || "Clinician", specialty: "", profile: {} };
  }
  const row = id ? get<ClinicianRow>("SELECT * FROM clinicians WHERE id = ?", id) : undefined;
  if (!row) return { id: id || "", name: "Team clinician", role: "Clinician", specialty: "", profile: {} };
  const profile = parse<Record<string, unknown>>(row.profile, {});
  const o = (profile.clinician_overview || {}) as { name?: string; credentials?: string; full_title?: string; role?: string; specialty?: string };
  return { id: row.id, name: displayName(o, row.name), role: o.role || row.role, specialty: o.specialty || "", profile };
}

export const allClinicians = () => all<ClinicianRow>("SELECT * FROM clinicians ORDER BY name").map((r) => clinician(r.id));

/** A compact persona brief for prompts, built from the faculty-provided profile. */
export function personaBrief(cl: ClinicianInfo): string {
  const p = cl.profile as Record<string, Record<string, unknown>>;
  const pc = p.personality_and_communication || {};
  const ip = p.interprofessional_profile || {};
  const sb = p.simulation_behavior || {};
  const pp = p.professional_profile || {};
  const list = (v: unknown, n: number) => (Array.isArray(v) ? v.slice(0, n).join("; ") : "");
  const s = (v: unknown, n = 420) => (typeof v === "string" ? v.slice(0, n) : "");
  return [
    `${cl.name}, ${cl.role}${cl.specialty ? ` (${cl.specialty})` : ""}.`,
    s(pp.scope_of_practice, 300) && `Scope: ${s(pp.scope_of_practice, 300)}`,
    list(pc.personality_traits, 3) && `Personality: ${list(pc.personality_traits, 3)}`,
    s(pc.communication_style) && `Communication style: ${s(pc.communication_style)}`,
    list(sb.clinical_priorities, 4) && `Clinical priorities: ${list(sb.clinical_priorities, 4)}`,
    s(ip.teamwork_style, 260) && `Teamwork: ${s(ip.teamwork_style, 260)}`,
    s(ip.sbar_preferences, 260) && `Handoff habits: ${s(ip.sbar_preferences, 260)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

// ---------- Roles ----------

/**
 * Finds the catalog role for a stage. The catalog is data and grows over time, so a stage may name a
 * role that is not there (yet): match on id, then on words in the name, then fall back to the first
 * physician-type role. The stage's own roleTitle is always what is displayed.
 */
export function resolveProfession(stage: Pick<Stage, "professionId" | "roleTitle">): Profession {
  const list = professions();
  const exact = list.find((p) => p.id === stage.professionId);
  if (exact) return exact;
  const words = `${stage.professionId} ${stage.roleTitle}`.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3);
  let best: Profession | null = null;
  let bestScore = 0;
  for (const p of list) {
    const hay = `${p.id} ${p.name} ${p.roleTitle}`.toLowerCase();
    const score = words.filter((w) => hay.includes(w.slice(0, 6))).length;
    if (score > bestScore) {
      best = p;
      bestScore = score;
    }
  }
  return best || list.find((p) => p.id === "medicine") || list[0];
}

// ---------- Shared patient state (append-only) ----------

interface EntryRow {
  id: string;
  run_id: string;
  kind: string;
  category: string;
  text: string;
  status: string;
  source: string;
  contributor_role: string;
  contributor_name: string;
  contributor_is_ai: number;
  stage_id: string;
  stage_order: number;
  encounter_id: string | null;
  fact_id: string | null;
  relates_to: string | null;
  relation: string | null;
  evidence: string | null;
  sim_time: string | null;
  created_at: string;
  meta: string | null;
}

export interface NewEntry {
  runId: string;
  kind: EntryKind;
  category?: string;
  text: string;
  status: EntryStatus;
  source: EntrySource;
  contributorRole: string;
  contributorName: string;
  contributorIsAi: boolean;
  stageId: string;
  stageOrder: number;
  encounterId?: string | null;
  factId?: string | null;
  evidence?: Evidence | null;
  simTime: string;
  meta?: StateEntry["meta"];
  /** Primary relation, also written to state_links. */
  relatesTo?: string | null;
  relation?: Relation | null;
}

/** The only way an entry enters the shared state. Entries are never updated or deleted. */
export function addEntry(e: NewEntry): string {
  const id = newId("se_");
  run(
    `INSERT INTO state_entries (id, run_id, kind, category, text, status, source, contributor_role, contributor_name, contributor_is_ai, stage_id, stage_order, encounter_id, fact_id, relates_to, relation, evidence, sim_time, meta)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id,
    e.runId,
    e.kind,
    e.category || "",
    e.text.trim(),
    e.status,
    e.source,
    e.contributorRole,
    e.contributorName,
    e.contributorIsAi ? 1 : 0,
    e.stageId,
    e.stageOrder,
    e.encounterId || null,
    e.factId || null,
    e.relatesTo || null,
    e.relation || null,
    e.evidence ? JSON.stringify(e.evidence) : null,
    e.simTime,
    e.meta ? JSON.stringify(e.meta) : null,
  );
  if (e.relatesTo && e.relation) addLink(e.runId, id, e.relatesTo, e.relation, e.stageId, e.evidence || null);
  return id;
}

export function addLink(runId: string, from: string, to: string, relation: Relation, stageId: string, evidence: Evidence | null) {
  if (from === to) return;
  if (get("SELECT 1 FROM state_links WHERE run_id = ? AND from_entry = ? AND to_entry = ? AND relation = ?", runId, from, to, relation)) return;
  run("INSERT INTO state_links (run_id, from_entry, to_entry, relation, stage_id, evidence) VALUES (?,?,?,?,?,?)", runId, from, to, relation, stageId, evidence ? JSON.stringify(evidence) : null);
}

export function linksOf(runId: string): StateLink[] {
  return all<{ id: number; from_entry: string; to_entry: string; relation: string; stage_id: string; evidence: string | null; created_at: string }>(
    "SELECT * FROM state_links WHERE run_id = ? ORDER BY id",
    runId,
  ).map((l) => ({ id: l.id, from: l.from_entry, to: l.to_entry, relation: l.relation as Relation, stageId: l.stage_id, evidence: parse<Evidence | null>(l.evidence, null), createdAt: l.created_at }));
}

/**
 * Reads the state. `effectiveStatus` is derived, not stored: an entry that a later entry contradicts
 * reads as disputed, and one that a later entry answers or resolves reads as resolved. The original
 * row keeps the status it was written with, so the history is never lost.
 */
export function entriesOf(runId: string, links: StateLink[] = linksOf(runId)): StateEntry[] {
  const rows = all<EntryRow>("SELECT * FROM state_entries WHERE run_id = ? ORDER BY stage_order, created_at, rowid", runId);
  const inbound = new Map<string, StateLink[]>();
  for (const l of links) inbound.set(l.to, [...(inbound.get(l.to) || []), l]);
  const kindOf = new Map(rows.map((r) => [r.id, { kind: r.kind, source: r.source }]));
  return rows.map((r) => {
    const status = r.status as EntryStatus;
    const effective = deriveStatus(status, (inbound.get(r.id) || []).map((l) => ({ relation: l.relation, fromKind: kindOf.get(l.from)?.kind, fromSource: kindOf.get(l.from)?.source })));
    return {
      id: r.id,
      runId: r.run_id,
      kind: r.kind as EntryKind,
      category: r.category,
      text: r.text,
      status,
      effectiveStatus: effective,
      source: r.source as EntrySource,
      contributorRole: r.contributor_role,
      contributorName: r.contributor_name,
      contributorIsAi: !!r.contributor_is_ai,
      stageId: r.stage_id,
      stageOrder: r.stage_order,
      encounterId: r.encounter_id,
      factId: r.fact_id,
      evidence: parse<Evidence | null>(r.evidence, null),
      simTime: r.sim_time || "",
      createdAt: r.created_at,
      meta: parse<StateEntry["meta"]>(r.meta, null),
    };
  });
}

// ---------- Handoffs and team messages ----------

export function handoffsOf(runId: string): Handoff[] {
  return all<{ id: string; from_stage: string; to_stage: string | null; author_role: string; author_is_ai: number; sbar: string; evaluation: string | null; created_at: string }>(
    "SELECT * FROM handoffs WHERE run_id = ? ORDER BY created_at, rowid",
    runId,
  ).map((h) => {
    const s = parse<{ situation: string; background: string; assessment: string; recommendation: string; authorName?: string; toName?: string; cites?: string[] }>(h.sbar, { situation: "", background: "", assessment: "", recommendation: "" });
    return {
      id: h.id,
      fromStage: h.from_stage,
      toStage: h.to_stage,
      authorRole: h.author_role,
      authorName: s.authorName || "",
      authorIsAi: !!h.author_is_ai,
      toName: s.toName || "",
      sbar: { situation: s.situation || "", background: s.background || "", assessment: s.assessment || "", recommendation: s.recommendation || "" },
      cites: s.cites || [],
      evaluation: parse<TraceEvaluation | null>(h.evaluation, null),
      createdAt: h.created_at,
    };
  });
}

export function messagesOfRun(runId: string): TeamMessage[] {
  return all<{ id: number; thread: string; kind: string; from_role: string; to_role: string | null; text: string; meta: string | null; created_at: string }>(
    "SELECT * FROM team_messages WHERE run_id = ? ORDER BY id",
    runId,
  ).map((m) => {
    const meta = parse<(TeamMessage["meta"] & { fromName?: string; fromIsAi?: boolean }) | null>(m.meta, null);
    return { id: m.id, thread: m.thread, kind: m.kind, fromRole: m.from_role, fromName: meta?.fromName || m.from_role, fromIsAi: !!meta?.fromIsAi, toRole: m.to_role, text: m.text, meta, createdAt: m.created_at };
  });
}

export function addMessage(runId: string, m: { thread: string; kind: string; fromRole: string; fromName: string; fromIsAi: boolean; toRole?: string | null; text: string; meta?: TeamMessage["meta"] }): number {
  const r = run(
    "INSERT INTO team_messages (run_id, thread, kind, from_role, to_role, text, meta) VALUES (?,?,?,?,?,?,?)",
    runId,
    m.thread,
    m.kind,
    m.fromRole,
    m.toRole || null,
    m.text,
    JSON.stringify({ ...(m.meta || {}), fromName: m.fromName, fromIsAi: m.fromIsAi }),
  );
  return Number(r.lastInsertRowid);
}

// ---------- Small shared helpers ----------

export const norm = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * True when `quote` occurs (ignoring case and punctuation) in `text`. Quotes shorter than 3 words never
 * verify. `minRun` is the shortest run of consecutive quoted words that counts when the whole quote is
 * not found (models trim, stitch or re-punctuate); evaluation uses a shorter run than state extraction.
 */
export function quoteIn(quote: string, text: string, minRun = 8): boolean {
  const hay = norm(text);
  if (!hay) return false;
  // A quote may be stitched with ellipses; every fragment must be present.
  const parts = (quote || "").split(/\.{3,}|…|\[\.\.\.\]/).map(norm).filter((p) => p.split(" ").length >= 3);
  if (!parts.length) return false;
  if (parts.every((p) => hay.includes(p))) return true;
  // Otherwise accept a long verbatim run (models sometimes trim or add a word at the edges).
  const words = norm(quote).split(" ");
  for (let n = Math.min(words.length - 1, 14); n >= minRun; n--) for (let i = 0; i + n <= words.length; i++) if (hay.includes(words.slice(i, i + n).join(" "))) return true;
  return false;
}

export function who(run: LoadedRun, stage: Stage, studentName: string) {
  const isStudent = stage.id === run.row.student_stage_id;
  const cl = clinician(stage.clinicianId);
  return { isStudent, name: isStudent ? studentName : cl.name, role: stage.roleTitle, isAi: !isStudent, clinician: cl };
}

/** How colleagues address the learner: first name only, never a title. */
export const firstNameOf = (fullName: string) => (fullName || "").replace(/^(dr|mr|mrs|ms|prof)\.?\s+/i, "").trim().split(/\s+/)[0] || "the student";

/** A line for prompts so a model never invents a title for the learner from their name. */
export const learnerLine = (fullName: string, role: string) =>
  `The learner is a student named ${fullName}, acting as ${role} in this journey. Address them by first name only ("${firstNameOf(fullName)}"). They are a student: never call them "Dr." and never treat any part of their name as a profession or title. When you refer to their work, use their role in this journey (${role}).`;

export const studentNameOf = (userId: string) => get<{ name: string }>("SELECT name FROM users WHERE id = ?", userId)?.name || "Student";
