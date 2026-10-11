/**
 * Rewrites the learner-facing brief and task list of every seed case so they do not give away the
 * diagnosis or any finding. Run: npx tsx --env-file=.env.local scripts/scrub-briefs.ts
 */
import fs from "node:fs";
import path from "node:path";
import { chatJSON, MODELS } from "../src/lib/llm";
import type { CaseProfile } from "../src/lib/types";

const dir = "data/seed/cases";
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
const schema = {
  type: "object",
  required: ["leaks", "studentBrief", "tasks"],
  properties: {
    leaks: { type: "boolean", description: "true if the current brief or tasks reveal the diagnosis, the hidden problem, or a finding the learner is meant to discover" },
    studentBrief: { type: "string" },
    tasks: { type: "array", items: { type: "string" } },
  },
};

async function one(file: string) {
  const p = path.join(dir, file);
  const doc = JSON.parse(fs.readFileSync(p, "utf8")) as { profile: CaseProfile };
  const c = doc.profile;
  const withheld = c.facts.filter((f) => f.tier === "reluctant" || f.tier === "hidden").map((f) => f.chart);
  const r = await chatJSON<{ leaks: boolean; studentBrief: string; tasks: string[] }>({
    model: MODELS.chat,
    temperature: 0,
    maxTokens: 900,
    schema,
    system:
      "You edit the learner-facing part of a simulation case. The learner reads the brief and the task list BEFORE meeting the patient, so neither may name or hint at the diagnosis, the underlying problem, anything the patient is withholding, any patient-versus-chart discrepancy, or any finding the learner is supposed to discover. Keep: the learner's role, the patient's name and age, the booked reason for the visit, and tasks phrased as skills ('Take a focused history of the presenting concern', 'Review the medication list with the patient', 'Agree a plan and safety-net'). Keep the same number of tasks where possible, the same order, and the same plain style. If nothing leaks, return them unchanged with leaks false.",
    messages: [
      {
        role: "user",
        text: `Learner role: ${c.professions.join(", ")}\nBooked reason for visit: ${c.scenario.chiefComplaint}\n\nSECRET (must not be revealed)\nPrimary problem: ${c.answerKey.primaryProblem}\nDifferential: ${c.answerKey.differential.join("; ")}\nWithheld by the patient: ${withheld.join("; ")}\nMismatches: ${(c.mismatches || []).map((m) => m.recordEvidence).join("; ")}\n\nCURRENT BRIEF\n${c.scenario.studentBrief}\n\nCURRENT TASKS\n${c.scenario.tasks.map((t, i) => `${i + 1}. ${t}`).join("\n")}`,
      },
    ],
  });
  if (!r.leaks || !r.studentBrief || !Array.isArray(r.tasks) || r.tasks.length < 2) return false;
  c.scenario.studentBrief = r.studentBrief;
  c.scenario.tasks = r.tasks;
  fs.writeFileSync(p, JSON.stringify(doc, null, 1));
  return true;
}

(async () => {
  let changed = 0;
  let failed = 0;
  const queue = [...files];
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      for (let f = queue.shift(); f; f = queue.shift()) {
        try {
          if (await one(f)) changed++;
        } catch (e) {
          failed++;
          console.error("failed", f, (e as Error).message);
        }
      }
    }),
  );
  console.log(`${files.length} cases, ${changed} rewritten, ${failed} failed`);
})();
