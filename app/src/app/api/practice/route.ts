import { apiUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { createEncounter } from "@/lib/engine/encounter";
import { bad } from "@/lib/http";
import { parse } from "@/lib/db";

/** How each temperament step plays: the engine's difficulty level, plus a mood for the sharper ones. */
const MOOD: Record<number, string | false> = { 1: false, 2: "withdrawn", 3: false, 4: "badday", 5: "skeptical" };

/**
 * Starts a private practice visit. The student chooses only the patient's temperament (1 easygoing
 * to 5 very difficult); the patient is picked here from the published library, preferring one the
 * student has not seen. No patient is generated. Body: { temperament } -> { id: encounterId }
 */
export async function POST(req: Request) {
  const user = await apiUser();
  if (user instanceof Response) return user;
  const b = await req.json().catch(() => ({}));
  const temperament = Math.max(1, Math.min(5, Math.round(Number(b.temperament) || 3)));

  const cases = all<{ id: string; professions: string; seen: number }>(
    `SELECT c.id, c.professions, (SELECT COUNT(*) FROM encounters e WHERE e.case_id = c.id AND e.user_id = ? AND e.status != 'abandoned') AS seen
     FROM cases c WHERE c.status = 'published'`,
    user.id,
  );
  if (!cases.length) return bad("There are no published patients to practice with yet.", 404);
  const fewest = Math.min(...cases.map((c) => c.seen));
  const pool = cases.filter((c) => c.seen === fewest);
  const pick = pool[Math.floor(Math.random() * pool.length)];
  const professions = parse<string[]>(pick.professions, []);
  const professionId = user.profession_id && professions.includes(user.profession_id) ? user.profession_id : professions[0] || user.profession_id || "medicine";
  return Response.json({ id: createEncounter({ userId: user.id, caseId: pick.id, professionId, mode: "practice", level: temperament, perturb: MOOD[temperament] }) });
}
