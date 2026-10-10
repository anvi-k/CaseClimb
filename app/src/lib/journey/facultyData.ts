import { all, parse } from "../db";
import { professions } from "../professions";
import type { CaseProfile } from "../types";
import { allClinicians } from "./store";

/** Options for the faculty journey builder. */
export function builderOptions() {
  return {
    cases: all<{ id: string; title: string; profile: string }>("SELECT id, title, profile FROM cases WHERE status = 'published' ORDER BY title").map((c) => ({ id: c.id, title: c.title, patient: parse<CaseProfile>(c.profile, {} as CaseProfile).patient?.name || "Patient" })),
    clinicians: allClinicians().map((c) => ({ id: c.id, name: c.name, role: c.role })),
    professions: professions().map((p) => ({ id: p.id, name: p.name })),
  };
}
