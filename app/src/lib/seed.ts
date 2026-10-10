import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";
import { get, newId, run } from "./db";
import type { CaseProfile } from "./types";

const DEMO_PASSWORD = "poscere-demo";

/** Idempotent: loads seed cases, clinician personas and demo accounts that are not yet in the DB. */
export function seed() {
  const dir = path.join(process.cwd(), "data", "seed", "cases");
  let added = 0;
  if (fs.existsSync(dir)) {
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
      const id = "seed_" + file.replace(/\.json$/, "");
      const existing = get<{ profile: string; created_at: string; updated_at: string; owner_id: string | null }>("SELECT profile, created_at, updated_at, owner_id FROM cases WHERE id = ?", id);
      if (existing) {
        // Pick up a revised seed file, but never overwrite a case someone has edited in the Studio.
        if (existing.owner_id || existing.created_at !== existing.updated_at) continue;
        try {
          const { reviewed, profile } = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as { reviewed: boolean; profile: CaseProfile };
          const next = JSON.stringify(profile);
          if (profile?.title && profile.facts?.length && next !== existing.profile) {
            run("UPDATE cases SET profile = ?, title = ?, specialty = ?, professions = ?, difficulty = ?, reviewed = ? WHERE id = ?", next, profile.title, profile.specialty || "", JSON.stringify(profile.professions || []), profile.difficulty || 3, reviewed ? 1 : 0, id);
          }
        } catch (e) {
          console.error(`[seed] could not refresh ${file}: ${(e as Error).message}`);
        }
        continue;
      }
      // A bad or half-written seed file must never stop the server from starting.
      try {
        const { origin, reviewed, profile } = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as { origin: string; reviewed: boolean; profile: CaseProfile };
        if (!profile?.title || !profile.facts?.length || !profile.patient?.name) throw new Error("incomplete case");
        run(
          "INSERT INTO cases (id, status, origin, reviewed, title, specialty, professions, difficulty, profile) VALUES (?,?,?,?,?,?,?,?,?)",
          id,
          "published",
          origin || "ai_draft",
          reviewed ? 1 : 0,
          profile.title,
          profile.specialty || "",
          JSON.stringify(profile.professions || []),
          profile.difficulty || 3,
          JSON.stringify(profile),
        );
      } catch (e) {
        console.error(`[seed] skipped ${file}: ${(e as Error).message}`);
        continue;
      }
      added++;
    }
  }
  const cdir = path.join(process.cwd(), "data", "clinicians");
  if (fs.existsSync(cdir)) {
    for (const file of fs.readdirSync(cdir).filter((f) => f.endsWith(".json"))) {
      const id = file.replace(/\.json$/, "");
      if (get("SELECT 1 FROM clinicians WHERE id = ?", id)) continue;
      const p = JSON.parse(fs.readFileSync(path.join(cdir, file), "utf8"));
      run("INSERT INTO clinicians (id, name, role, profession_id, profile) VALUES (?,?,?,?,?)", id, p.clinician_overview?.full_title || p.clinician_overview?.name || id, p.clinician_overview?.role || "", p.profession_id || null, JSON.stringify(p));
    }
  }
  const demo = [
    { email: "faculty@poscere.demo", legacyEmail: "faculty@rounds.demo", name: "Dr. Dana Faculty", role: "faculty", profession: "medicine" },
    { email: "student@poscere.demo", legacyEmail: "student@rounds.demo", name: "Sam Student", role: "student", profession: "medicine" },
    { email: "dietetics@poscere.demo", legacyEmail: "dietetics@rounds.demo", name: "Riley Dietetics", role: "student", profession: "dietetics" },
    { email: "nursing@poscere.demo", legacyEmail: "nursing@rounds.demo", name: "Noor Nursing", role: "student", profession: "nursing" },
  ];
  for (const d of demo) {
    if (get("SELECT 1 FROM users WHERE email = ?", d.email)) continue;
    const legacy = get<{ id: string }>("SELECT id FROM users WHERE email = ?", d.legacyEmail);
    if (legacy) {
      run("UPDATE users SET email = ?, password_hash = ? WHERE id = ?", d.email, bcrypt.hashSync(DEMO_PASSWORD, 10), legacy.id);
      continue;
    }
    run("INSERT INTO users (id, email, password_hash, name, role, profession_id) VALUES (?,?,?,?,?,?)", newId("u_"), d.email, bcrypt.hashSync(DEMO_PASSWORD, 10), d.name, d.role, d.profession);
  }
  // ===== Care Journeys (Challenge 2): ready-made published journeys. Idempotent. =====
  try {
    const n = seedJourneys();
    if (n) console.log(`[seed] loaded ${n} care journeys`);
  } catch (e) {
    console.error("[seed] care journeys skipped", e);
  }
  // ===== end Care Journeys =====
  return added;
}

// Care Journeys seed loader (import kept beside its block; ES imports are hoisted).
import { seedJourneys } from "./journey/seedJourneys";
