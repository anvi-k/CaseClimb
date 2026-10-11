import fs from "node:fs";
import path from "node:path";
import { all, get, parse } from "./db";
import type { Rubric } from "./types";

let builtin: Rubric[] | null = null;

function loadBuiltin(): Rubric[] {
  if (builtin) return builtin;
  const raw = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "data", "rubrics", "encounter_evaluation_rubric.json"), "utf8"),
  );
  const encounter: Rubric = {
    id: "default",
    name: raw.title,
    type: "domain4",
    instructions: raw.instructions,
    domains: raw.domains.map((d: { key: string; name: string; descriptors: Record<string, string>; triggers_review_if_score_1: boolean }) => ({
      key: d.key,
      name: d.name,
      descriptors: d.descriptors,
      reviewIfOne: d.triggers_review_if_score_1,
    })),
  };
  // The faculty-provided points checklist (SPLP 6510), kept as a second built-in rubric format.
  const peds: Rubric = {
    id: "peds-hearing",
    name: "Pediatric Hearing Treatment Clinical Simulation (Session 1)",
    type: "checklist",
    items: [
      { key: "intro", section: "Introduce yourself to the client", text: "Behaves professionally and uses professional, empathetic language throughout", points: 10 },
      { key: "needs_dx", section: "Needs assessment", text: "Reviews age at diagnosis of deafness", points: 6 },
      { key: "needs_device", section: "Needs assessment", text: "Reviews device use", points: 6 },
      { key: "needs_aud", section: "Needs assessment", text: "Asks about other auditory complaints (tinnitus, hyperacusis, etc.)", points: 6 },
      { key: "needs_edu", section: "Needs assessment", text: "Asks about educational needs", points: 6 },
      { key: "needs_comm", section: "Needs assessment", text: "Asks about the most important communication challenge/need today", points: 6 },
      { key: "audio_sev", section: "Review the audiogram", text: "Explains the severity of the hearing loss in a sensitive manner", points: 15 },
      { key: "audio_banana", section: "Review the audiogram", text: "Uses the Speech Banana to explain what the client can hear with and without technology", points: 15 },
      { key: "exp_roles", section: "Realistic expectations", text: "Explains the difference between an audiologist and an SLP", points: 8 },
      { key: "exp_rehab", section: "Realistic expectations", text: "Explains what aural rehab is and how it can help", points: 8 },
      { key: "exp_empathy", section: "Realistic expectations", text: "Expresses empathy for the challenges faced by the client", points: 7 },
      { key: "exp_questions", section: "Realistic expectations", text: "Answers the client's questions", points: 7 },
    ],
  };
  builtin = [encounter, peds];
  return builtin;
}

export function listRubrics(): Rubric[] {
  const custom = all<{ id: string; spec: string }>("SELECT id, spec FROM rubrics").map((r) => ({
    ...parse<Rubric>(r.spec, {} as Rubric),
    id: r.id,
  }));
  return [...loadBuiltin(), ...custom];
}

export function getRubric(id: string | null | undefined): Rubric {
  const b = loadBuiltin();
  if (!id) return b[0];
  const hit = b.find((r) => r.id === id);
  if (hit) return hit;
  const row = get<{ id: string; spec: string }>("SELECT id, spec FROM rubrics WHERE id = ?", id);
  return row ? { ...parse<Rubric>(row.spec, b[0]), id: row.id } : b[0];
}
