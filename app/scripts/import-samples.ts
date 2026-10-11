/**
 * Converts the faculty-provided sample patients (data/samples/patients.json) into full cases
 * and writes them to data/seed/cases/*.json. Run: npx tsx --env-file=.env.local scripts/import-samples.ts [name-filter]
 */
import fs from "node:fs";
import path from "node:path";
import { generateCase } from "../src/lib/casegen";

const rows = JSON.parse(fs.readFileSync("data/samples/patients.json", "utf8"));
const outDir = "data/seed/cases";
fs.mkdirSync(outDir, { recursive: true });
const filter = (process.argv[2] || "").toLowerCase();
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
// The portrait files use the spelling from the image set.
const portraitFor = (name: string) => {
  const s = slug(name);
  const files = fs.readdirSync("public/portraits");
  const hit = files.find((f) => f.startsWith(s)) || files.find((f) => f.split("-").pop()!.startsWith(s.split("-").pop()!));
  return hit ? `/portraits/${hit}` : undefined;
};

async function one(r: Record<string, any>) {
  const name: string = r.patient_overview.name;
  const file = path.join(outDir, `sample-${slug(name)}.json`);
  if (fs.existsSync(file)) return console.log("skip", name);
  const t = Date.now();
  const c = await generateCase({
    professionId: "dietetics",
    description: JSON.stringify(r),
    guidance:
      "This is a faculty-provided sample profile. Keep every detail exactly as given (name, age, diagnoses, labs, medications, personality). Map information_disclosure tiers directly onto fact tiers, and learning_opportunities onto objectives. Frame it as a telehealth nutrition counselling visit. Build the mismatch from details already in the profile (for example reported adherence versus a lab or refill record).",
    portrait: portraitFor(name),
  });
  fs.writeFileSync(file, JSON.stringify({ origin: "sample", reviewed: false, profile: c }, null, 1));
  console.log("ok", name, c.facts.length, "facts", c.actions.length, "actions", c.artifacts.length, "docs", Math.round((Date.now() - t) / 1000) + "s");
}

(async () => {
  const todo = rows.filter((r: any) => r.patient_overview.name.toLowerCase().includes(filter));
  const results = await Promise.allSettled(todo.map(one));
  for (const r of results) if (r.status === "rejected") console.error("FAILED", r.reason?.message || r.reason);
})();
