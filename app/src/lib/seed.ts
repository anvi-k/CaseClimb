import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";
import { all, get, newId, run } from "./db";
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
    { email: "student@poscere.demo", legacyEmail: "student@rounds.demo", name: "Sam Carter", role: "student", profession: "medicine" },
  ];
  // Students are no longer separated by program, so the per-program demo accounts are removed and
  // the remaining demo student loses the name that read as a category.
  for (const email of ["dietetics@poscere.demo", "nursing@poscere.demo", "dietetics@rounds.demo", "nursing@rounds.demo"]) {
    const gone = get<{ id: string }>("SELECT id FROM users WHERE email = ?", email);
    if (!gone) continue;
    run("DELETE FROM enrollments WHERE user_id = ?", gone.id);
    run("DELETE FROM users WHERE id = ?", gone.id);
  }
  run("UPDATE users SET name = 'Sam Carter' WHERE email = 'student@poscere.demo' AND name = 'Sam Student'");
  for (const d of demo) {
    if (get("SELECT 1 FROM users WHERE email = ?", d.email)) continue;
    const legacy = get<{ id: string }>("SELECT id FROM users WHERE email = ?", d.legacyEmail);
    if (legacy) {
      run("UPDATE users SET email = ?, password_hash = ? WHERE id = ?", d.email, bcrypt.hashSync(DEMO_PASSWORD, 10), legacy.id);
      continue;
    }
    run("INSERT INTO users (id, email, password_hash, name, role, profession_id) VALUES (?,?,?,?,?,?)", newId("u_"), d.email, bcrypt.hashSync(DEMO_PASSWORD, 10), d.name, d.role, d.profession);
  }
  retireRemovedSeeds(dir);
  seedDemoClass();
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

/**
 * A seed patient whose file has been removed from data/seed/cases is taken out of the library.
 * It is archived, not deleted, so visits already held with it keep working. Patients someone has
 * edited in the Studio are left alone.
 */
function retireRemovedSeeds(dir: string) {
  // Publishing is no longer a step, so drafts made before that change become assignable.
  run("UPDATE cases SET status = 'published' WHERE status = 'draft'");
  if (!fs.existsSync(dir)) return;
  const files = new Set(fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => "seed_" + f.replace(/\.json$/, "")));
  for (const c of all<{ id: string }>("SELECT id FROM cases WHERE id LIKE 'seed_%' AND status = 'published' AND owner_id IS NULL AND created_at = updated_at")) {
    if (!files.has(c.id)) run("UPDATE cases SET status = 'archived' WHERE id = ?", c.id);
  }
}

/** The patients the demo class is assigned, in order. Two organiser samples, then Synthea-based ones. */
const DEMO_PATIENTS = ["seed_sample-walter-greene", "seed_sample-nisha-patel", "seed_synthea-jayme-littel-03229300", "seed_synthea-velda-schuster-021d485a", "seed_synthea-kasey-haley-3e9ca627"];

/**
 * Gives the demo instructor a class with the demo students in it and five patients assigned, so
 * both home screens have something to show on a fresh install. Does nothing once the instructor
 * has any class.
 */
function seedDemoClass() {
  // The class was first seeded with a lower-case "counseling"; bring existing installs in line.
  run("UPDATE courses SET name = 'Nutrition Counseling' WHERE name = 'Nutrition counseling' AND join_code = 'NUTR48'");
  const faculty = get<{ id: string }>("SELECT id FROM users WHERE email = 'faculty@poscere.demo'");
  if (!faculty || get("SELECT 1 FROM courses WHERE faculty_id = ?", faculty.id)) return;
  const patients = DEMO_PATIENTS.filter((id) => get("SELECT 1 FROM cases WHERE id = ? AND status = 'published'", id));
  if (!patients.length) return;
  const courseId = newId("co_");
  run("INSERT INTO courses (id, faculty_id, name, profession_id, join_code) VALUES (?,?,?,?,?)", courseId, faculty.id, "Nutrition Counseling", null, "NUTR48");
  for (const s of all<{ id: string }>("SELECT id FROM users WHERE email LIKE '%@poscere.demo' AND role = 'student'")) run("INSERT OR IGNORE INTO enrollments (course_id, user_id) VALUES (?,?)", courseId, s.id);
  run(
    "INSERT INTO assignments (id, course_id, title, instructions, type, case_ids, journey_id, settings, due_at, feedback_released) VALUES (?,?,?,?,?,?,?,?,?,?)",
    newId("as_"),
    courseId,
    "Nutrition counseling visits",
    "See each patient in turn.",
    "homework",
    JSON.stringify(patients),
    null,
    JSON.stringify({ level: 2, temperament: 2 }),
    null,
    1,
  );
}

// Care Journeys seed loader (import kept beside its block; ES imports are hoisted).
import { seedJourneys } from "./journey/seedJourneys";
