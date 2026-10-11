import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import type { CaseProfile } from "./types";

const MODEL = process.env.MODEL_IMAGE || "stability.sd3-5-large-v1:0";
const DIR = path.join(process.env.UPLOAD_DIR || path.join(process.cwd(), "data", "uploads"), "portraits");
const NEGATIVE =
  "full body, wide shot, lettering, laptop, computer, phone, screen, brand logo, side view, profile view, looking away, text, caption, watermark, logo, user interface, video call overlay, frame, border, cartoon, illustration, 3d render, painting, airbrushed skin, glamour, studio lighting, hospital, medical equipment, stethoscope, white coat, blood, wound, injury, bandage, distorted face, extra fingers, deformed hands, multiple people, nudity";

export const portraitDir = () => DIR;

function prompt(p: CaseProfile["patient"]): { text: string; negative: string } {
  const female = /^f|woman|girl/i.test(p.sex);
  const male = /^m|man|boy/i.test(p.sex);
  const noun = p.age < 18 ? (female ? "teenage girl" : male ? "teenage boy" : "teenager") : female ? "woman" : male ? "man" : "person";
  // The model renders adults older than asked, so aim a little younger.
  const age = p.age >= 30 ? Math.round(p.age * 0.85) : p.age;
  const young = p.age < 62 ? "elderly, very old, deep wrinkles, white hair, frail, " : "";
  const looks = (p.appearance || "").split(/(?<=[.!?])\s+/).slice(0, 2).join(" ");
  return {
    text: `Front-facing head-and-shoulders portrait photograph of a ${age}-year-old ${p.ethnicity} ${noun}, centred, framed from the chest up, eyes looking straight into the lens, neutral calm expression, mouth closed. ${looks} Seen exactly as the other person on a video visit would see them; the camera, laptop or phone is out of frame. Ordinary everyday clothing, real skin texture, soft natural window light, plain lived-in home interior softly out of focus behind. Photorealistic, 50mm lens, documentary style, unposed.`,
    negative: young + NEGATIVE,
  };
}

/**
 * Best-effort portrait for a newly written patient. Returns the URL to store in
 * `patient.portrait`, or null when the image model declines or fails (the visit screen then
 * shows initials). Young children are skipped: the image model's filter rejects most of them.
 */
export async function makePortrait(p: CaseProfile["patient"]): Promise<string | null> {
  if (process.env.PORTRAITS === "0" || !p?.age || p.age < 13) return null;
  try {
    const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION || "us-west-2" });
    const { text, negative } = prompt(p);
    const res = await client.send(
      new InvokeModelCommand({
        modelId: MODEL,
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify({ prompt: text, negative_prompt: negative, mode: "text-to-image", aspect_ratio: "3:2", output_format: "jpeg" }),
      }),
      { abortSignal: AbortSignal.timeout(45000) },
    );
    const out = JSON.parse(new TextDecoder().decode(res.body)) as { images?: string[]; finish_reasons?: (string | null)[] };
    if (out.finish_reasons?.[0] || !out.images?.[0]) return null;
    fs.mkdirSync(DIR, { recursive: true });
    const file = `p_${nanoid(14)}.jpg`;
    fs.writeFileSync(path.join(DIR, file), Buffer.from(out.images[0], "base64"));
    return `/api/portraits/${file}`;
  } catch (e) {
    console.error("[portrait]", (e as Error).message);
    return null;
  }
}
