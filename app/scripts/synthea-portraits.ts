/**
 * Portraits for the Synthea-based patients, in the style of the organisers' sample portraits:
 * a photorealistic waist-up picture of the patient in a hospital gown in a hospital room, warm
 * light, with the expression their profile describes. Uses Stable Diffusion 3.5 Large on Bedrock.
 *
 * Run:  npx tsx --env-file=.env.local scripts/synthea-portraits.ts [limit] [--force] [--dry]
 *   limit    how many patients to draw this run (default: all without a portrait)
 *   --force  draw again even if the picture exists
 *   --dry    print the prompts only
 *   CONCURRENCY=4 pictures at a time
 *   STYLE=home  keep the photographic look but show the patient at home in their own clothes
 * Writes public/portraits/<case-file>.jpg (640 px tall, via macOS `sips`) and sets
 * profile.patient.portrait in the case file. Review the pictures before showing them to anyone.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import type { CaseProfile } from "../src/lib/types";

const MODEL = process.env.PORTRAIT_MODEL || "stability.sd3-5-large-v1:0";
const CASES = path.join("data", "seed", "cases");
const PROFILES = path.join("data", "synthea", "profiles");
const OUT = path.join("public", "portraits");
const args = process.argv.slice(2);
const limit = Number(args.find((a) => /^\d+$/.test(a))) || Infinity;
const force = args.includes("--force");
const dry = args.includes("--dry");
const home = process.env.STYLE === "home";
const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-west-2", maxAttempts: 3 });

// The face follows the personality the profile was assigned, as the sample portraits do.
const EXPRESSIONS: [RegExp, string][] = [
  [/warm and talkative/, "a warm, open smile"],
  [/reserved and private/, "a guarded, reserved look, lips pressed together"],
  [/anxious and apologetic/, "a worried, anxious expression, brows drawn together"],
  [/blunt and impatient/, "an unimpressed, impatient look, arms crossed"],
  [/deflects anything serious with a joke/, "a wry half-grin"],
  [/skeptical and questioning/, "a doubtful look with one eyebrow raised"],
  [/stoic/, "a calm, composed, stoic expression"],
  [/overwhelmed and scattered/, "a tired, overwhelmed expression"],
  [/proud and self-reliant/, "a dignified, self-assured expression, chin slightly raised"],
  [/agreeable to a fault/, "a polite, eager-to-please smile"],
];
const RACE: Record<string, string> = { white: "White", black: "Black", asian: "Asian", hawaiian: "Pacific Islander", native: "Native American" };
const NEGATIVE = "text, caption, lettering, watermark, logo, frame, border, cartoon, illustration, 3d render, painting, drawing, deformed hands, extra fingers, distorted face, full body, side view, looking away, phone, laptop";

/** The image model draws adults older than asked, so aim a little younger. */
const drawnAge = (age: number) => (age >= 76 ? age - 6 : age >= 40 ? age - 10 : age >= 28 ? age - 5 : age);

export function promptFor(c: CaseProfile, personality: string): string {
  const p = c.patient;
  const noun = /^f|woman/i.test(p.sex) ? "woman" : /^m|man/i.test(p.sex) ? "man" : "person";
  const race = RACE[(p.ethnicity || "").split(",")[0].trim().toLowerCase()] || "";
  const expression = EXPRESSIONS.find(([re]) => re.test(personality))?.[1] || "a calm, neutral expression";
  // The written appearance describes the patient on a video call at home (the chair, the room
  // behind them), so it is only used for the at-home style; it would fight the hospital scene.
  const looks = home ? (p.appearance || "").split(/[.;]/)[0] : "";
  const scene = home
    ? "at home in ordinary everyday clothes, sitting in a lived-in living room softly blurred behind them"
    : "a hospital patient wearing a pale blue patterned hospital gown, sitting up in a hospital room, with an IV pole and a wall-mounted monitor softly blurred in the background";
  return [
    `Photorealistic portrait photograph of a ${drawnAge(p.age)}-year-old ${race} ${noun}, ${scene}.`,
    p.age < 30 ? "A young adult: youthful face, smooth skin, full head of hair." : p.age < 45 ? "Looks their age or younger: smooth skin, no grey hair." : "",
    `Shown from the waist up, facing the camera, with ${expression}.`,
    looks,
    "Soft warm window light from one side, shallow depth of field, natural skin texture, candid documentary style, 50mm lens.",
  ]
    .filter(Boolean)
    .join(" ");
}

/** What must not appear, by age: the image model ages people unless told not to. */
const tooOld = (age: number) => (age < 30 ? "middle-aged, elderly, wrinkles, grey hair, white hair, balding, " : age < 50 ? "elderly, old, deep wrinkles, grey hair, white hair, " : age < 65 ? "very old, frail, white hair, " : "");

async function draw(prompt: string, age = 99): Promise<Buffer> {
  const res = await client.send(
    new InvokeModelCommand({
      modelId: MODEL,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({ prompt, negative_prompt: tooOld(age) + NEGATIVE, mode: "text-to-image", aspect_ratio: "2:3", output_format: "png" }),
    }),
    { abortSignal: AbortSignal.timeout(90000) },
  );
  const out = JSON.parse(new TextDecoder().decode(res.body)) as { images?: string[]; finish_reasons?: (string | null)[] };
  if (out.finish_reasons?.[0]) throw new Error("the image model declined: " + out.finish_reasons[0]);
  if (!out.images?.[0]) throw new Error("no image returned");
  return Buffer.from(out.images[0], "base64");
}

async function main() {
  const files = fs.readdirSync(CASES).filter((f) => f.startsWith("synthea-") && f.endsWith(".json")).sort();
  // A patient that was written again keeps its picture: the file is still there, only the link is missing.
  for (const f of files) {
    const slug = f.replace(/\.json$/, "");
    const data = JSON.parse(fs.readFileSync(path.join(CASES, f), "utf8")) as { profile: CaseProfile };
    if (!force && !dry && fs.existsSync(path.join(OUT, slug + ".jpg")) && data.profile.patient.portrait !== `/portraits/${slug}.jpg`) {
      data.profile.patient.portrait = `/portraits/${slug}.jpg`;
      fs.writeFileSync(path.join(CASES, f), JSON.stringify(data, null, 1));
      console.log(`linked ${slug}.jpg`);
    }
  }
  const todo = files.filter((f) => force || !fs.existsSync(path.join(OUT, f.replace(/\.json$/, ".jpg")))).slice(0, limit);
  console.log(`${files.length} Synthea patients, ${files.length - todo.length} already have a picture or are left for later, ${todo.length} to draw now (${home ? "at home" : "hospital"} style)`);
  const one = async (file: string) => {
    const full = path.join(CASES, file);
    const data = JSON.parse(fs.readFileSync(full, "utf8")) as { profile: CaseProfile };
    const profileFile = path.join(PROFILES, `${data.profile.dataSource?.recordId}.json`);
    const personality: string = fs.existsSync(profileFile) ? JSON.parse(fs.readFileSync(profileFile, "utf8")).source?.assigned_traits?.personality || "" : "";
    const prompt = promptFor(data.profile, personality);
    if (dry) {
      console.log(`\n${file}\n  ${prompt}`);
      return;
    }
    const t = Date.now();
    try {
      let image: Buffer;
      try {
        image = await draw(prompt, data.profile.patient.age);
      } catch (e) {
        // The content filter sometimes trips on the free-text appearance; try once without it.
        if (!/declined/.test((e as Error).message)) throw e;
        image = await draw(promptFor({ ...data.profile, patient: { ...data.profile.patient, appearance: "" } }, personality), data.profile.patient.age);
      }
      const slug = file.replace(/\.json$/, "");
      const png = path.join(OUT, `.${slug}.tmp.png`);
      fs.writeFileSync(png, image);
      try {
        execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "80", "-Z", "640", png, "--out", path.join(OUT, slug + ".jpg")], { stdio: "ignore" });
      } finally {
        fs.rmSync(png, { force: true });
      }
      data.profile.patient.portrait = `/portraits/${slug}.jpg`;
      fs.writeFileSync(full, JSON.stringify(data, null, 1));
      console.log(`ok    ${slug}.jpg  ${Math.round((Date.now() - t) / 1000)}s`);
    } catch (e) {
      const err = e as { name?: string; message?: string };
      const msg = `${err.name || "Error"}: ${err.message || e}`;
      console.error(`error ${file}: ${msg.slice(0, 300)}`);
      if (/AccessDenied|not authorized|ExpiredToken|UnrecognizedClient|ValidationException|ResourceNotFound|credentials/i.test(msg)) {
        console.error("\nStopped: AWS refused the image request. If the message says access is denied or the model is not found, this account cannot use the image model.");
        process.exit(1);
      }
    }
  };
  // Several pictures at a time; CONCURRENCY changes how many.
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, Number(process.env.CONCURRENCY) || 4) }, async () => {
      while (next < todo.length) await one(todo[next++]);
    }),
  );
}

main();
