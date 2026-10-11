import fs from "node:fs";
import path from "node:path";
import { get, run } from "../db";

/** Idempotent: loads ready-made journeys from data/seed/journeys/*.json when their case exists. */
export function seedJourneys(): number {
  const dir = path.join(process.cwd(), "data", "seed", "journeys");
  if (!fs.existsSync(dir)) return 0;
  let added = 0;
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as { id: string; title: string; caseId: string; spec: unknown };
      if (!j.id || get("SELECT 1 FROM journeys WHERE id = ?", j.id)) continue;
      if (!get("SELECT 1 FROM cases WHERE id = ?", j.caseId)) continue;
      run("INSERT INTO journeys (id, status, title, case_id, spec) VALUES (?,?,?,?,?)", j.id, "published", j.title, j.caseId, JSON.stringify(j.spec));
      added++;
    } catch (e) {
      console.error(`[seed] journey ${file} skipped`, e);
    }
  }
  return added;
}
