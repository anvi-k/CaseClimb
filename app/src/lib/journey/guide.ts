import { get, parse } from "../db";
import { chatJSON, MODELS } from "../llm";
import { professions } from "../professions";
import type { CaseProfile } from "../types";
import { allClinicians } from "./store";
import type { Stage } from "./types";


/** The faculty guide: proposes an ordered set of encounters for a case from the persona roster and role catalog. */
export async function proposeStages(caseId: string, brief = ""): Promise<{ title: string; summary: string; stages: Stage[] }> {
  const row = get<{ profile: string }>("SELECT profile FROM cases WHERE id = ?", caseId);
  if (!row) throw new Error("Case not found");
  const c = parse<CaseProfile>(row.profile, {} as CaseProfile);
  const roster = allClinicians();
  const roles = professions();
  const out = await chatJSON<{ title: string; summary: string; stages: { professionId: string; roleTitle: string; clinicianId: string; focus: string; simTime: string; visitLabel: string }[] }>({
    model: MODELS.smart,
    maxTokens: 2500,
    schema: {
      type: "object",
      required: ["title", "summary", "stages"],
      properties: {
        title: { type: "string", description: "Short journey title: patient name and the thread that connects the encounters" },
        summary: { type: "string", description: "2-3 sentences for students: who the patient is and which professions see them, without revealing hidden findings" },
        stages: {
          type: "array",
          description: "3 to 5 encounters in the order they would realistically happen",
          items: {
            type: "object",
            required: ["professionId", "roleTitle", "clinicianId", "focus", "simTime", "visitLabel"],
            properties: {
              professionId: { type: "string", description: "id from the ROLE CATALOG that best fits; if none fits, a short snake_case id for the role" },
              roleTitle: { type: "string", description: "How this professional is named, e.g. 'Clinical pharmacist'" },
              clinicianId: { type: "string", description: "id from the CLINICIAN PERSONAS; each persona at most once" },
              focus: { type: "string", description: "2 sentences: what this professional is there to do and what they should pick up from earlier encounters. Do not reveal facts the patient has not disclosed." },
              simTime: { type: "string", description: "Simulated time label, e.g. 'Week 1, Mon 10:30'; later encounters are later" },
              visitLabel: { type: "string", description: "Kind of contact, e.g. 'pharmacist medication review by video'" },
            },
          },
        },
      },
    },
    system: "You help health-professions faculty turn one patient case into a connected, interprofessional care journey for a telehealth simulation: several encounters with the same patient by different professionals, where each depends on what the earlier ones found. Choose professions whose lenses genuinely differ for this patient, order them so information flows forward naturally, and give each a focus that builds on the previous encounter. Use only the supplied clinician personas. The title, summary and every focus are shown to students and steer the AI clinicians, so write them only from the record at start: name topics to explore, never findings, behaviours or attitudes that the patient has not yet disclosed, and never tell a later professional what an earlier one will have found.",
    messages: [
      {
        role: "user",
        text: `PATIENT: ${c.patient?.name}, ${c.patient?.age}, ${c.patient?.sex}. Specialty of the source case: ${c.specialty}\nRecord at start (this is ALL that is known before the first encounter):\n${(c.chartAtStart || []).map((x) => `- ${x.label}: ${x.value}`).join("\n")}\nTopics the patient can be asked about: ${[...new Set((c.facts || []).map((f) => f.category))].join(", ")}\nApproved checks: ${(c.actions || []).map((a) => a.name).slice(0, 25).join("; ")}\n\nCLINICIAN PERSONAS\n${roster.map((r) => `${r.id}: ${r.name}, ${r.role}`).join("\n")}\n\nROLE CATALOG\n${roles.map((r) => `${r.id}: ${r.name}`).join("\n")}\n\n${brief ? "FACULTY REQUEST: " + brief : ""}`,
      },
    ],
  });
  const used = new Set<string>();
  const stages: Stage[] = (out.stages || [])
    .filter((s) => roster.some((r) => r.id === s.clinicianId) && !used.has(s.clinicianId) && !!used.add(s.clinicianId))
    .slice(0, 6)
    .map((s, i) => ({ id: `s${i + 1}`, order: i + 1, professionId: s.professionId, roleTitle: s.roleTitle, clinicianId: s.clinicianId, focus: s.focus, simTime: s.simTime, visitLabel: s.visitLabel }));
  const titles = stages.map((x) => x.roleTitle.toLowerCase());
  return {
    title: out.title?.trim() || `${c.patient?.name}: a connected care journey across ${stages.length} professions`,
    summary: out.summary?.trim() || `${c.patient?.name}, ${c.patient?.age}, is seen in turn by ${titles.slice(0, -1).join(", ")} and ${titles[titles.length - 1]}. Each professional starts from what the others recorded, adds their own findings, and hands off with an SBAR. Join as any one of them; the AI plays the rest.`,
    stages,
  };
}

/** Cleans a faculty-edited spec before it is stored. */
export function normaliseStages(input: unknown): Stage[] {
  const roster = allClinicians();
  const list = Array.isArray(input) ? input : [];
  return list
    .map((raw, i) => {
      const s = (raw || {}) as Partial<Stage>;
      const cl = roster.find((r) => r.id === s.clinicianId) || roster[0];
      return {
        id: `s${i + 1}`,
        order: i + 1,
        professionId: String(s.professionId || "medicine"),
        roleTitle: String(s.roleTitle || cl?.role || "Clinician").slice(0, 80),
        clinicianId: cl?.id || "",
        focus: String(s.focus || "").slice(0, 800),
        simTime: String(s.simTime || `Encounter ${i + 1}`).slice(0, 60),
        visitLabel: s.visitLabel ? String(s.visitLabel).slice(0, 80) : undefined,
      };
    })
    .filter((s) => s.clinicianId);
}
