/**
 * Best-effort portraits for AI-drafted seed cases, using Stable Diffusion 3.5 Large on Bedrock.
 *
 * Run:  npx tsx --env-file=.env.local scripts/gen-portraits.ts [filter] [--force] [--dry]
 *   filter   substring of the case file name
 *   --force  regenerate even if the JPEG exists
 *   --dry    print the prompts only
 * Writes public/portraits/<case-file-slug>.jpg (max 640 px, via macOS `sips`) and sets
 * profile.patient.portrait. Never touches sample-*.json. Review the images before shipping them.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import type { CaseProfile } from "../src/lib/types";

const MODEL = process.env.PORTRAIT_MODEL || "stability.sd3-5-large-v1:0";
const caseDir = path.join("data", "seed", "cases");
const outDir = path.join("public", "portraits");
const args = process.argv.slice(2);
const filter = (args.find((a) => !a.startsWith("--")) || "").toLowerCase();
const force = args.includes("--force");
const dry = args.includes("--dry");
const client = new BedrockRuntimeClient({ region: "us-west-2", maxAttempts: 3 });

/** Stated ages come out about a decade too old, so ask for younger than the chart says. */
function promptAge(age: number): number {
  return age >= 76 ? age - 6 : age >= 40 ? age - 10 : age;
}

/** The model draws people much older than the stated age unless told otherwise. */
function ageHint(age: number): { text: string; negative: string } {
  if (age < 13) return { text: "", negative: "" };
  if (age < 30) return { text: "Youthful face, smooth skin.", negative: "middle-aged, elderly, wrinkles, grey hair, " };
  if (age < 45) return { text: `Looks young for their age: smooth skin, no grey hair.`, negative: "elderly, old, wrinkles, grey hair, white hair, " };
  if (age < 62) return { text: `Looks young for their age: middle-aged, healthy skin with only faint lines, hair mostly its natural colour.`, negative: "elderly, very old, deep wrinkles, white hair, frail, " };
  if (age < 76) return { text: `Looks young for their age: an active person in later middle age, moderate lines only.`, negative: "very old, ninety years old, deep wrinkles, frail, gaunt, " };
  return { text: "", negative: "" };
}

/** Cases where a parent speaks for a small child: show the parent with the child. */
export function promptFor(c: CaseProfile): string {
  const p = c.patient;
  const female = /^f|woman|girl/i.test(p.sex);
  const male = /^m|man|boy/i.test(p.sex);
  let subject: string;
  if (p.age < 10) {
    // A parent speaks for a young child: show them together.
    const child = p.age < 3 ? "toddler" : `${p.age}-year-old`;
    subject = `a ${p.ethnicity} parent sitting close beside their ${child} ${female ? "daughter" : male ? "son" : "child"}, both fully clothed, both`;
  } else if (p.age < 18) {
    subject = `a ${p.age}-year-old ${p.ethnicity} teenage ${female ? "girl" : male ? "boy" : "person"}`;
  } else {
    subject = `a ${promptAge(p.age)}-year-old ${p.ethnicity} ${female ? "woman" : male ? "man" : "person"}`;
  }
  // Keep only the first two sentences of the description: later ones tend to describe behaviour, not looks.
  const looks = p.appearance.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ");
  return [
    `Front-facing head-and-shoulders portrait photograph of ${subject} centred, tightly framed from the chest up, eyes looking straight into the lens, neutral calm expression, mouth closed.`,
    ageHint(p.age).text,
    looks,
    "Seen exactly as the other person on a video visit would see them: the camera itself, any laptop, phone or screen is out of frame. Ordinary everyday clothing, real skin texture, soft natural window light, plain lived-in home interior softly out of focus behind. Photorealistic, 50mm lens, documentary style, unposed.",
  ].join(" ");
}

const NEGATIVE = "full body, wide shot, lettering, book titles, laptop, computer, phone, screen, brand logo, side view, profile view, looking away, text, caption, watermark, logo, user interface, video call overlay, frame, border, cartoon, illustration, 3d render, painting, airbrushed skin, glamour, studio lighting, hospital, medical equipment, stethoscope, white coat, blood, wound, injury, bandage, distorted face, extra fingers, deformed hands, multiple people, nudity";

async function one(file: string): Promise<string> {
  const full = path.join(caseDir, file);
  const data = JSON.parse(fs.readFileSync(full, "utf8")) as { profile: CaseProfile };
  const slug = file.replace(/\.json$/, "");
  const jpg = path.join(outDir, slug + ".jpg");
  const prompt = promptFor(data.profile);
  if (dry) {
    console.log(`${slug}\n  ${prompt}\n`);
    return "dry";
  }
  if (!fs.existsSync(jpg) || force) {
    const res = await client.send(
      new InvokeModelCommand({
        modelId: MODEL,
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify({ prompt, negative_prompt: ageHint(data.profile.patient.age).negative + NEGATIVE, mode: "text-to-image", aspect_ratio: "2:3", output_format: "png" }),
      }),
    );
    let out = JSON.parse(new TextDecoder().decode(res.body)) as { images?: string[]; finish_reasons?: (string | null)[] };
    if (out.finish_reasons?.[0]) {
      // The content filter sometimes trips on the free-text appearance; retry once without it.
      const plain = promptFor({ ...data.profile, patient: { ...data.profile.patient, appearance: "" } });
      const res2 = await client.send(
        new InvokeModelCommand({
          modelId: MODEL,
          contentType: "application/json",
          accept: "application/json",
          body: JSON.stringify({ prompt: plain, negative_prompt: NEGATIVE, mode: "text-to-image", aspect_ratio: "2:3", output_format: "png" }),
        }),
      );
      out = JSON.parse(new TextDecoder().decode(res2.body));
    }
    const reason = out.finish_reasons?.[0];
    if (reason) throw new Error("filtered by the model: " + reason);
    if (!out.images?.[0]) throw new Error("no image returned");
    const png = path.join(outDir, `.${slug}.tmp.png`);
    fs.writeFileSync(png, Buffer.from(out.images[0], "base64"));
    try {
      execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "78", "-Z", "640", png, "--out", jpg], { stdio: "ignore" });
    } finally {
      fs.rmSync(png, { force: true });
    }
  }
  // Re-read before writing: the image call takes a while and the case may have been edited meanwhile.
  const portrait = `/portraits/${slug}.jpg`;
  const fresh = JSON.parse(fs.readFileSync(full, "utf8")) as { profile: CaseProfile };
  if (fresh.profile.patient.portrait !== portrait) {
    fresh.profile.patient.portrait = portrait;
    fs.writeFileSync(full, JSON.stringify(fresh, null, 1));
  }
  return "ok";
}

(async () => {
  const files = fs.readdirSync(caseDir).filter((f) => f.endsWith(".json") && !f.startsWith("sample-") && f.toLowerCase().includes(filter)).sort();
  let next = 0, ok = 0, failed = 0, stop = "";
  const t0 = Date.now();
  await Promise.all(
    Array.from({ length: Number(process.env.CONCURRENCY) || 3 }, async () => {
      while (next < files.length && !stop) {
        const f = files[next++];
        try {
          const r = await one(f);
          if (r === "ok") ok++;
          if (r === "ok") console.log("ok   ", f);
        } catch (e) {
          failed++;
          const err = e as { name?: string; message?: string };
          const msg = `${err.name}: ${err.message}`;
          console.error("error", f, msg.slice(0, 240));
          if (/AccessDenied|ExpiredToken|UnrecognizedClient|ValidationException|ResourceNotFound|not authorized/i.test(msg)) stop = msg;
        }
      }
    }),
  );
  console.log(`${ok} portraits, ${failed} failed, ${Math.round((Date.now() - t0) / 1000)}s`);
  if (stop) {
    console.error("STOPPED: the image model is not usable with these credentials. " + stop.slice(0, 240));
    process.exit(2);
  }
})();
