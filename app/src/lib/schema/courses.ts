// Extra tables for this area. `tables` runs on every boot (use CREATE TABLE IF NOT EXISTS).
// `alters` are one-off ALTER TABLE statements; each is attempted once and ignored if already applied.
export const tables = ``;
export const alters: string[] = [
  // Faculty review of a scored visit: a note shown to the student and an optional adjusted score (0-100).
  `ALTER TABLE encounters ADD COLUMN faculty_note TEXT`,
  `ALTER TABLE encounters ADD COLUMN faculty_score REAL`,
];
