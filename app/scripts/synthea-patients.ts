/**
 * Builds library patients from Synthea records in two resumable stages.
 *
 *   Stage 1, profiles: for each record in data/synthea/records.json, code fills the fields the
 *   record supplies and the model fills the rest (nutrition, psychosocial, disclosure, learning
 *   opportunities), following traits assigned by code so the set stays varied. Output is one
 *   profile per patient in the organisers' sample format: data/synthea/profiles/<id>.json, and
 *   all of them together in data/synthea/profiles.json.
 *
 *   Stage 2, cases: each profile is turned into a full case by the app's own generator, the
 *   record's contents are then written into the case by code, and the result is saved to
 *   data/seed/cases/synthea-<name>-<id>.json, which the app loads into the library on start.
 *
 * Run:  npx tsx --env-file=.env.local scripts/synthea-patients.ts [profiles|cases|all] [limit]
 *   CONCURRENCY=4 to change parallelism. Delete an output file to have it made again.
 *   Example profiles come from data/private/sample_patients.json when it is present.
 */
import fs from "node:fs";
import path from "node:path";
import { generateCase } from "../src/lib/casegen";
import { chatJSON, MODELS } from "../src/lib/llm";
import { fillHeader } from "../src/lib/studio/ai";
import { sanitizeProfile, tidyTables } from "../src/lib/studio/profile";
import { applySynthea, sealSynthea, type SyntheaRecord } from "../src/lib/synthea";
import { GAP_SYSTEM, gapProblems, gapPrompt, gapSchema, mergeProfile, traitsFor, type Gap, type SyntheaProfile } from "../src/lib/syntheaProfiles";

const RECORDS = path.join("data", "synthea", "records.json");
const PROFILES = path.join("data", "synthea", "profiles");
const COMBINED = path.join("data", "synthea", "profiles.json");
const CASES = path.join("data", "seed", "cases");
const EXAMPLES = path.join("data", "private", "sample_patients.json");
const NO_PORTRAIT = "none";
const AUTH_ERR = /ExpiredToken|UnrecognizedClient|InvalidSignature|AccessDenied|security token|credentials/i;

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const secs = (t: number) => `${Math.round((Date.now() - t) / 1000)}s`;
let aborted = "";

async function pool<T>(items: T[], worker: (item: T, i: number) => Promise<void>) {
  const concurrency = Math.max(1, Number(process.env.CONCURRENCY) || 4);
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < items.length && !aborted) {
        const i = next++;
        await worker(items[i], i);
      }
    }),
  );
}

function fail(what: string, e: unknown) {
  const err = e as { name?: string; message?: string };
  const msg = `${err.name || "Error"}: ${err.message || e}`;
  console.error(`error ${what}: ${msg.slice(0, 300)}`);
  if (AUTH_ERR.test(msg)) aborted = msg;
}

async function makeProfiles(records: SyntheaRecord[], limit: number) {
  fs.mkdirSync(PROFILES, { recursive: true });
  const examples: unknown[] = fs.existsSync(EXAMPLES) ? JSON.parse(fs.readFileSync(EXAMPLES, "utf8")) : [];
  if (!examples.length) console.log(`No example profiles at ${EXAMPLES}; writing without them.`);
  const missing = records.map((r, i) => ({ r, i })).filter(({ r }) => !fs.existsSync(path.join(PROFILES, `${r.id}.json`)));
  const todo = missing.slice(0, limit);
  console.log(`profiles: ${records.length - missing.length} already on disk, ${todo.length} to write now`);
  await pool(todo, async ({ r, i }) => {
    const t = Date.now();
    const traits = traitsFor(i);
    // Two different examples each time, so no one sample sets the pattern for the whole set.
    const shown = examples.length ? [examples[i % examples.length], examples[(i + 3) % examples.length]] : [];
    for (let attempt = 1; attempt <= 3 && !aborted; attempt++) {
      try {
        const gap = await chatJSON<Gap>({ model: MODELS.smart, system: GAP_SYSTEM, schema: gapSchema(r), maxTokens: 9000, messages: [{ role: "user", text: gapPrompt(r, traits, shown) }] });
        const problems = gapProblems(gap, r);
        if (problems.length) throw new Error("unusable reply: " + problems.join("; "));
        fs.writeFileSync(path.join(PROFILES, `${r.id}.json`), JSON.stringify(mergeProfile(r, gap, traits, MODELS.smart), null, 1));
        console.log(`ok    profile ${r.id} ${r.name}, ${secs(t)}${attempt > 1 ? " (retry)" : ""}`);
        return;
      } catch (e) {
        fail(`profile ${r.id} attempt ${attempt}`, e);
      }
    }
  });
  const done = records.filter((r) => fs.existsSync(path.join(PROFILES, `${r.id}.json`))).map((r) => JSON.parse(fs.readFileSync(path.join(PROFILES, `${r.id}.json`), "utf8")));
  if (done.length) fs.writeFileSync(COMBINED, JSON.stringify(done, null, 1));
  console.log(`profiles: ${done.length} of ${records.length} written`);
}

const caseFile = (r: SyntheaRecord) => path.join(CASES, `synthea-${slug(r.name)}-${r.id}.json`);

async function makeCases(records: SyntheaRecord[], source: string, limit: number) {
  const ready = records.map((r, i) => ({ r, i })).filter(({ r }) => fs.existsSync(path.join(PROFILES, `${r.id}.json`)));
  const missing = ready.filter(({ r }) => !fs.existsSync(caseFile(r)));
  const todo = missing.slice(0, limit);
  console.log(`cases: ${ready.length} profiles ready, ${ready.length - missing.length} cases already on disk, ${todo.length} to write now`);
  await pool(todo, async ({ r, i }) => {
    const t = Date.now();
    const { source: _provenance, ...profile } = JSON.parse(fs.readFileSync(path.join(PROFILES, `${r.id}.json`), "utf8")) as SyntheaProfile;
    for (let attempt = 1; attempt <= 2 && !aborted; attempt++) {
      try {
        const drafted = await generateCase({
          professionId: "dietetics",
          description: JSON.stringify(profile),
          guidance:
            "This is a complete patient profile. Keep every detail exactly as given (name, age, diagnoses, labs, medications, personality, eating pattern). Map information_disclosure tiers directly onto fact tiers, and learning_opportunities onto objectives. Frame it as a telehealth nutrition counselling visit. Build the mismatch from details already in the profile (for example reported adherence versus a lab or refill record). Do NOT write a problem list, a medication list, vital signs, the listed laboratory results or an immunisation record as actions or documents: those are added to the case automatically from the health record.",
          portrait: NO_PORTRAIT,
        });
        if (drafted.patient.portrait === NO_PORTRAIT) delete drafted.patient.portrait;
        if (!drafted.facts.length) throw new Error("the generator returned no facts");
        const tidy = tidyTables(sanitizeProfile(await fillHeader(sanitizeProfile(drafted))));
        const grounded = sealSynthea(sanitizeProfile(applySynthea(tidy, r, source, i + 1)));
        fs.writeFileSync(caseFile(r), JSON.stringify({ origin: "ai_draft", reviewed: false, profile: grounded }, null, 1));
        console.log(`ok    case ${path.basename(caseFile(r))}  ${grounded.facts.length} facts, ${grounded.actions.length} actions, ${grounded.artifacts.length} docs, ${secs(t)}${attempt > 1 ? " (retry)" : ""}`);
        return;
      } catch (e) {
        fail(`case ${r.id} attempt ${attempt}`, e);
      }
    }
  });
  console.log(`cases: ${records.filter((r) => fs.existsSync(caseFile(r))).length} of ${records.length} in ${CASES}`);
}

async function main() {
  const [stage = "all", limitArg] = process.argv.slice(2);
  const limit = Number(limitArg) || Infinity;
  const { source, records } = JSON.parse(fs.readFileSync(RECORDS, "utf8")) as { source: string; records: SyntheaRecord[] };
  if (stage === "profiles" || stage === "all") await makeProfiles(records, limit);
  if (!aborted && (stage === "cases" || stage === "all")) await makeCases(records, source, limit);
  if (aborted) {
    console.error(`\nStopped: AWS refused the request (${aborted.slice(0, 160)}). Paste fresh credentials and run the same command again; finished patients are kept.`);
    process.exit(1);
  }
}

main();
