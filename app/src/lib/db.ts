import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import * as studio from "./schema/studio";
import * as courses from "./schema/courses";
import * as journeys from "./schema/journeys";

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), "data", "app.db");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','faculty','student')),
  profession_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A case is a published or draft patient profile. profile = CaseProfile JSON.
CREATE TABLE IF NOT EXISTS cases (
  id TEXT PRIMARY KEY,
  owner_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  origin TEXT NOT NULL DEFAULT 'faculty' CHECK (origin IN ('faculty','sample','ai_draft')),
  reviewed INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  specialty TEXT NOT NULL DEFAULT '',
  professions TEXT NOT NULL DEFAULT '[]',
  difficulty INTEGER NOT NULL DEFAULT 3,
  profile TEXT NOT NULL,
  consistency TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rubrics (
  id TEXT PRIMARY KEY,
  owner_id TEXT,
  name TEXT NOT NULL,
  spec TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY,
  faculty_id TEXT NOT NULL,
  name TEXT NOT NULL,
  profession_id TEXT,
  join_code TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS enrollments (
  course_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (course_id, user_id)
);

-- settings JSON: { level, knobs?, timeLimitMin, hints, maxAttempts, liveAssist, feedbackRelease:'immediate'|'manual', perturb:boolean }
CREATE TABLE IF NOT EXISTS assignments (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL,
  title TEXT NOT NULL,
  instructions TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL CHECK (type IN ('homework','exam','practice')),
  case_ids TEXT NOT NULL DEFAULT '[]',
  journey_id TEXT,
  settings TEXT NOT NULL DEFAULT '{}',
  due_at TEXT,
  feedback_released INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- config = EncounterConfig JSON, state = EncounterState JSON, feedback = Feedback JSON
CREATE TABLE IF NOT EXISTS encounters (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  assignment_id TEXT,
  journey_run_id TEXT,
  parent_id TEXT,
  attempt INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','submitted','scored','abandoned')),
  config TEXT NOT NULL,
  state TEXT NOT NULL,
  case_snapshot TEXT NOT NULL,
  wrapup TEXT,
  feedback TEXT,
  score REAL,
  pause_note TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_enc_user ON encounters(user_id);
CREATE INDEX IF NOT EXISTS idx_enc_case ON encounters(case_id);

-- speaker: student | patient | system | instructor | coach | clinician
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  encounter_id TEXT NOT NULL,
  turn INTEGER NOT NULL,
  speaker TEXT NOT NULL,
  text TEXT NOT NULL,
  meta TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_msg_enc ON messages(encounter_id);

-- Adaptive learner model: one rating per student x profession x rubric domain.
CREATE TABLE IF NOT EXISTS skill_ratings (
  user_id TEXT NOT NULL,
  profession_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  rating REAL NOT NULL DEFAULT 1200,
  n INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, profession_id, domain)
);
CREATE TABLE IF NOT EXISTS skill_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  profession_id TEXT NOT NULL,
  encounter_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  level INTEGER NOT NULL,
  outcome REAL NOT NULL,
  expected REAL NOT NULL,
  before REAL NOT NULL,
  after REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- Connected care journeys (Challenge 2) ----------
-- spec JSON: { summary, stages: [{ id, order, professionId, roleTitle, clinicianId, focus, handoffTo }] }
CREATE TABLE IF NOT EXISTS journeys (
  id TEXT PRIMARY KEY,
  owner_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  title TEXT NOT NULL,
  case_id TEXT NOT NULL,
  spec TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS clinicians (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  profession_id TEXT,
  profile TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS journey_runs (
  id TEXT PRIMARY KEY,
  journey_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  assignment_id TEXT,
  student_stage_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  current_stage INTEGER NOT NULL DEFAULT 0,
  synthesis TEXT,
  evaluation TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT
);
-- The shared patient state: append-only, every row carries provenance.
CREATE TABLE IF NOT EXISTS state_entries (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL,
  status TEXT NOT NULL,
  source TEXT NOT NULL,
  contributor_role TEXT NOT NULL,
  contributor_name TEXT NOT NULL,
  contributor_is_ai INTEGER NOT NULL DEFAULT 1,
  stage_id TEXT NOT NULL,
  stage_order INTEGER NOT NULL,
  encounter_id TEXT,
  fact_id TEXT,
  relates_to TEXT,
  relation TEXT,
  evidence TEXT,
  sim_time TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_state_run ON state_entries(run_id);
CREATE TABLE IF NOT EXISTS handoffs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  from_stage TEXT NOT NULL,
  to_stage TEXT,
  author_role TEXT NOT NULL,
  author_is_ai INTEGER NOT NULL DEFAULT 1,
  sbar TEXT NOT NULL,
  evaluation TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS team_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  thread TEXT NOT NULL,
  kind TEXT NOT NULL,
  from_role TEXT NOT NULL,
  to_role TEXT,
  text TEXT NOT NULL,
  meta TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per student x patient: what this patient remembers of this student across visits.
CREATE TABLE IF NOT EXISTS patient_relationships (
  user_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  visits INTEGER NOT NULL DEFAULT 0,
  rapport INTEGER NOT NULL DEFAULT 50,
  disclosed TEXT NOT NULL DEFAULT '[]',
  actions TEXT NOT NULL DEFAULT '[]',
  memory TEXT NOT NULL DEFAULT '',
  last_encounter_id TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, case_id)
);

-- Personal access keys for the episode search API and MCP endpoint.
CREATE TABLE IF NOT EXISTS api_keys (
  key TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT
);

CREATE TABLE IF NOT EXISTS uploads (
  id TEXT PRIMARY KEY,
  owner_id TEXT,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  path TEXT NOT NULL,
  text TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

const g = globalThis as unknown as { __db?: Database.Database };

export function db(): Database.Database {
  if (!g.__db) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    const d = new Database(DB_PATH);
    d.pragma("journal_mode = WAL");
    d.pragma("busy_timeout = 5000");
    d.exec(SCHEMA);
    for (const area of [studio, courses, journeys]) {
      if (area.tables.trim()) d.exec(area.tables);
      for (const sql of area.alters) {
        try {
          d.exec(sql);
        } catch {
          // already applied
        }
      }
    }
    // One-off data corrections, each applied once per database.
    d.exec("CREATE TABLE IF NOT EXISTS applied_fixes (name TEXT PRIMARY KEY, at TEXT NOT NULL DEFAULT (datetime('now')))");
    const once = (name: string, sql: string) => {
      if (d.prepare("SELECT 1 FROM applied_fixes WHERE name = ?").get(name)) return;
      d.exec(sql);
      d.prepare("INSERT INTO applied_fixes (name) VALUES (?)").run(name);
    };
    // The provided sample patients were expanded by the case generator; no clinician has reviewed the expansion.
    once("encounters-paused-at", "ALTER TABLE encounters ADD COLUMN paused_at TEXT");
    // Null means the whole class; otherwise a JSON list of the students an assignment is for.
    once("assignments-student-ids", "ALTER TABLE assignments ADD COLUMN student_ids TEXT");
    once("samples-not-reviewed", "UPDATE cases SET reviewed = 0 WHERE origin = 'sample'");
    g.__db = d;
  }
  return g.__db;
}

export const newId = (prefix = "") => prefix + nanoid(12);

export function all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[] {
  return db().prepare(sql).all(...params) as T[];
}
export function get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T | undefined {
  return db().prepare(sql).get(...params) as T | undefined;
}
export function run(sql: string, ...params: unknown[]) {
  return db().prepare(sql).run(...params);
}
export function parse<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}
