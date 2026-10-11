// Server-side access to the cases table for the Patient Studio.
import { apiUser } from "@/lib/auth";
import { all, get, newId, parse, run } from "@/lib/db";
import { listRubrics } from "@/lib/rubrics";
import type { CaseProfile, Rubric, User } from "@/lib/types";
import type { ConsistencyResult } from "./checks";
import { hashProfile, sanitizeProfile } from "./profile";

export interface CaseRow {
  id: string;
  owner_id: string | null;
  status: "draft" | "published" | "archived";
  origin: "faculty" | "sample" | "ai_draft";
  reviewed: number;
  title: string;
  specialty: string;
  professions: string;
  difficulty: number;
  profile: string;
  consistency: string | null;
  created_at: string;
  updated_at: string;
}

/** What the library and the editor header need; no clinical content. */
export interface CaseMeta {
  id: string;
  mine: boolean;
  canEdit: boolean;
  status: CaseRow["status"];
  origin: CaseRow["origin"];
  reviewed: boolean;
  title: string;
  specialty: string;
  professions: string[];
  difficulty: number;
  updatedAt: string;
}

export const canEdit = (u: User, row: Pick<CaseRow, "owner_id">) => u.role === "admin" || !row.owner_id || row.owner_id === u.id;

export function metaOf(row: CaseRow, u: User): CaseMeta {
  return {
    id: row.id,
    mine: row.owner_id === u.id,
    canEdit: canEdit(u, row),
    status: row.status,
    origin: row.origin,
    reviewed: !!row.reviewed,
    title: row.title,
    specialty: row.specialty,
    professions: parse<string[]>(row.professions, []),
    difficulty: row.difficulty,
    updatedAt: row.updated_at,
  };
}

export interface LibraryItem extends CaseMeta {
  patient: string;
  portrait: string | null;
  /** One or two words from the personality, and the first problem on the chart. */
  temperament: string;
  mainIssue: string;
  summary: string;
  encounterType: string;
  counts: { facts: number; actions: number; artifacts: number; variants: number };
  openHigh: number;
}

/** "Reserved, private, and practical. Measures..." becomes "Reserved, private". */
export function temperamentOf(p: Partial<CaseProfile>): string {
  const first = String(p.persona?.personality || "").split(/[.;:]| - | — /)[0];
  const parts = first.split(/,|\band\b|\bbut\b|\bwith\b/).map((w) => w.trim());
  const words = parts.filter((w) => w && w.split(" ").length <= 2 && !/ly$|^(a|an|the|very|to)\b/i.test(w.split(" ")[0])).slice(0, 2);
  const out = (words.length ? words.join(", ") : first.trim().split(" ")[0]).trim();
  return out ? out[0].toUpperCase() + out.slice(1) : "";
}

// What a nutrition visit is most likely about, most specific first.
const FOCUS = /diabet|heart|ischemic|coronary|hypertens|obes|body mass|lipid|cholesterol|kidney|renal|an(a)?emia|osteopor|stroke|malnutri|weight/i;

/** The problem the visit is most likely about: the first nutrition-related entry on the chart's problem list, else the first entry. */
export function mainIssueOf(p: Partial<CaseProfile>): string {
  const list = (p.chartAtStart || []).find((c) => /problem/i.test(c.label))?.value || "";
  const items = list.split(";").map((i) => i.replace(/\s*\([^)]*\)/g, "").split(",")[0].trim()).filter(Boolean);
  const pick = items.find((i) => FOCUS.test(i)) || items[0] || "";
  return /body mass index.*severe/i.test(pick) ? "Severe obesity" : /body mass index.*obes/i.test(pick) ? "Obesity" : pick;
}

/** The faculty member's own cases plus every shared (seeded) one. */
export function listCases(u: User): LibraryItem[] {
  const rows = u.role === "admin" ? all<CaseRow>("SELECT * FROM cases ORDER BY updated_at DESC") : all<CaseRow>("SELECT * FROM cases WHERE owner_id = ? OR owner_id IS NULL ORDER BY updated_at DESC", u.id);
  return rows.map((row) => {
    const p = parse<Partial<CaseProfile>>(row.profile, {});
    const cons = parse<ConsistencyResult | null>(row.consistency, null);
    return {
      ...metaOf(row, u),
      patient: p.patient ? `${p.patient.name}, ${p.patient.age}` : "",
      portrait: p.patient?.portrait || null,
      temperament: temperamentOf(p),
      mainIssue: mainIssueOf(p),
      summary: p.summary || "",
      encounterType: p.encounterType || "",
      counts: { facts: p.facts?.length || 0, actions: p.actions?.length || 0, artifacts: p.artifacts?.length || 0, variants: (p.variants || []).filter((v) => v.approved).length },
      openHigh: (cons?.issues || []).filter((i) => i.severity === "high" && i.status === "open").length,
    };
  });
}

export const getCase = (id: string) => get<CaseRow>("SELECT * FROM cases WHERE id = ?", id);

export function insertCase(input: { ownerId: string; origin: CaseRow["origin"]; profile: CaseProfile; reviewed?: boolean }): string {
  const id = newId("c_");
  const p = input.profile;
  run(
    "INSERT INTO cases (id, owner_id, status, origin, reviewed, title, specialty, professions, difficulty, profile) VALUES (?,?,?,?,?,?,?,?,?,?)",
    id,
    input.ownerId,
    "draft",
    input.origin,
    input.reviewed ? 1 : 0,
    p.title || "Untitled patient",
    p.specialty || "",
    JSON.stringify(p.professions || []),
    p.difficulty || 3,
    JSON.stringify(p),
  );
  return id;
}

/** Saves a profile (and optionally the consistency result) and returns the new hash and timestamp. */
export function saveCase(id: string, profile: CaseProfile, consistency?: ConsistencyResult | null): { hash: string; updatedAt: string } {
  const p = sanitizeProfile(profile);
  if (consistency !== undefined) run("UPDATE cases SET consistency = ? WHERE id = ?", consistency ? JSON.stringify(consistency) : null, id);
  run(
    "UPDATE cases SET title = ?, specialty = ?, professions = ?, difficulty = ?, profile = ?, updated_at = datetime('now') WHERE id = ?",
    p.title || "Untitled patient",
    p.specialty || "",
    JSON.stringify(p.professions),
    p.difficulty,
    JSON.stringify(p),
    id,
  );
  return { hash: hashProfile(p), updatedAt: getCase(id)!.updated_at };
}

export const profileOf = (row: CaseRow): CaseProfile => sanitizeProfile(parse<unknown>(row.profile, {}));
export const consistencyOf = (row: CaseRow) => parse<ConsistencyResult | null>(row.consistency, null);

/** For route handlers: a faculty user plus the case, or an error Response. */
export async function caseFor(id: string, opts: { write?: boolean } = {}): Promise<{ user: User; row: CaseRow } | Response> {
  const user = await apiUser("faculty");
  if (user instanceof Response) return user;
  const row = getCase(id);
  if (!row) return Response.json({ error: "Patient not found" }, { status: 404 });
  if (user.role !== "admin" && row.owner_id && row.owner_id !== user.id) return Response.json({ error: "This patient belongs to another faculty member. Duplicate it to make your own copy." }, { status: 403 });
  if (opts.write && !canEdit(user, row)) return Response.json({ error: "You cannot edit this patient" }, { status: 403 });
  return { user, row };
}


/** Built-in and custom rubrics, with flags for the ones the user created. */
export function rubricsFor(u: User): (Rubric & { custom: boolean; mine: boolean })[] {
  const owners = new Map(all<{ id: string; owner_id: string | null }>("SELECT id, owner_id FROM rubrics").map((r) => [r.id, r.owner_id]));
  return listRubrics().map((r) => ({ ...r, custom: owners.has(r.id), mine: owners.get(r.id) === u.id }));
}
