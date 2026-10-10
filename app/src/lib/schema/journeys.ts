// Extra tables for this area. `tables` runs on every boot (use CREATE TABLE IF NOT EXISTS).
// `alters` are one-off ALTER TABLE statements; each is attempted once and ignored if already applied.
export const tables = `
-- One row per stage of a run: which encounter carried it and how far it has got.
-- status: pending | running | ready (student may start) | visit_done | awaiting_handoff | complete | error
CREATE TABLE IF NOT EXISTS journey_stage_runs (
  run_id TEXT NOT NULL,
  stage_id TEXT NOT NULL,
  stage_order INTEGER NOT NULL,
  is_student INTEGER NOT NULL DEFAULT 0,
  encounter_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  note TEXT,
  error TEXT,
  started_at TEXT,
  ended_at TEXT,
  PRIMARY KEY (run_id, stage_id)
);

-- Typed, evidenced relations between shared-state entries. Append-only, like the entries.
-- relation: uses | confirms | contradicts | updates | answers | resolves
CREATE TABLE IF NOT EXISTS state_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  from_entry TEXT NOT NULL,
  to_entry TEXT NOT NULL,
  relation TEXT NOT NULL,
  stage_id TEXT NOT NULL,
  evidence TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_links_run ON state_links(run_id);
CREATE INDEX IF NOT EXISTS idx_stage_runs_enc ON journey_stage_runs(encounter_id);
`;
export const alters: string[] = [
  "ALTER TABLE state_entries ADD COLUMN meta TEXT",
  "ALTER TABLE journey_runs ADD COLUMN huddle TEXT",
  "ALTER TABLE journeys ADD COLUMN updated_at TEXT",
  "ALTER TABLE journey_runs ADD COLUMN error TEXT",
];
