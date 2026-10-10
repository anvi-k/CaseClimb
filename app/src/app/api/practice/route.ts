import { apiUser } from "@/lib/auth";
import { generateCase } from "@/lib/casegen";
import { newId, run } from "@/lib/db";
import { createEncounter } from "@/lib/engine/encounter";
import { longJson } from "@/lib/http";
import { profession } from "@/lib/professions";

/**
 * A student describes what they want to practise and gets a private patient built for it.
 * The case belongs to them and is never listed for anyone else; they never see the case file,
 * only the visit. Body: { description, level? } -> { id: encounterId }
 */
export async function POST(req: Request) {
  const user = await apiUser();
  if (user instanceof Response) return user;
  const b = await req.json().catch(() => ({}));
  const description = String(b.description || "").trim().slice(0, 1500);
  if (description.length < 15) return Response.json({ error: "Describe the patient or the skill you want to practise in a sentence or two." }, { status: 400 });
  const level = Math.max(1, Math.min(5, Math.round(Number(b.level) || 2)));
  const role = profession(user.profession_id);
  return longJson(async () => {
    const profile = await generateCase({
      professionId: role.id,
      level,
      description,
      guidance: "A student wrote this request to practise on their own. Build a realistic patient that exercises what they asked for. Keep it within what this role does over a video visit.",
    });
    const caseId = newId("c_");
    run(
      "INSERT INTO cases (id, owner_id, status, origin, reviewed, title, specialty, professions, difficulty, profile) VALUES (?,?,?,?,?,?,?,?,?,?)",
      caseId,
      user.id,
      "draft",
      "ai_draft",
      0,
      profile.title,
      profile.specialty || "",
      JSON.stringify(profile.professions),
      profile.difficulty,
      JSON.stringify(profile),
    );
    return { id: createEncounter({ userId: user.id, caseId, professionId: role.id, mode: "practice", level }) };
  });
}
