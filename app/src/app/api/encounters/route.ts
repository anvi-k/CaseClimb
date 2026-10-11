import { apiUser } from "@/lib/auth";
import { TEMPERAMENT_MOOD } from "@/lib/engine/difficulty";
import { get, parse } from "@/lib/db";
import { createEncounter } from "@/lib/engine/encounter";
import { bad } from "@/lib/http";
import type { Knobs } from "@/lib/types";

/** Start a visit. Body: { caseId, level?, mode?, perturb?, variantId?, assignmentId?, knobs?, followUp? } */
export async function POST(req: Request) {
  const user = await apiUser();
  if (user instanceof Response) return user;
  const b = await req.json().catch(() => ({}));
  const c = get<{ id: string; status: string; professions: string; owner_id: string | null }>("SELECT id, status, professions, owner_id FROM cases WHERE id = ?", b.caseId);
  if (!c) return bad("Case not found", 404);
  // Students can start published patients, and private practice patients they created themselves.
  if (c.status !== "published" && user.role === "student" && c.owner_id !== user.id) return bad("That patient is not published yet", 403);

  let mode = (["practice", "adaptive"].includes(b.mode) ? b.mode : "practice") as "practice" | "adaptive" | "homework" | "exam";
  let level: number | undefined = b.level ? Number(b.level) : undefined;
  let knobs: Partial<Knobs> | undefined = b.mode === "adaptive" ? b.knobs : undefined;
  let liveAssist = false;
  let perturb: boolean | string = b.perturb ?? false;
  let teamScope: string | undefined;
  // Assignment settings always win over anything the client sends.
  if (b.assignmentId) {
    const a = get<{ id: string; type: string; settings: string; case_ids: string; course_id: string }>("SELECT * FROM assignments WHERE id = ?", b.assignmentId);
    if (!a || !parse<string[]>(a.case_ids, []).includes(c.id)) return bad("Assignment not found", 404);
    if (user.role === "student" && !get("SELECT 1 FROM enrollments WHERE course_id = ? AND user_id = ?", a.course_id, user.id)) return bad("You are not enrolled in that course", 403);
    const s = parse<{ level?: number; temperament?: number; knobs?: Partial<Knobs>; timeLimitMin?: number; hints?: boolean; maxAttempts?: number; liveAssist?: boolean; perturb?: boolean; sharedPatient?: boolean }>(a.settings, {});
    if (s.maxAttempts) {
      const used = get<{ n: number }>("SELECT COUNT(*) AS n FROM encounters WHERE user_id = ? AND assignment_id = ? AND case_id = ? AND parent_id IS NULL AND status != 'abandoned'", user.id, a.id, c.id)!.n;
      if (used >= s.maxAttempts && user.role === "student") return bad(`You have used all ${s.maxAttempts} attempt${s.maxAttempts === 1 ? "" : "s"} for this assignment.`, 403);
    }
    mode = a.type as typeof mode;
    level = s.level ?? level;
    knobs = { ...(s.knobs || {}) };
    if (s.timeLimitMin !== undefined) knobs.timeLimitMin = s.timeLimitMin || null;
    if (s.hints !== undefined) knobs.hints = s.hints;
    liveAssist = !!s.liveAssist;
    perturb = !!s.perturb;
    // A temperament chosen when the patient was assigned sets both how guarded and what mood.
    if (s.temperament) {
      level = s.temperament;
      perturb = TEMPERAMENT_MOOD[s.temperament] ?? false;
    }
    if (s.sharedPatient) teamScope = `team:${a.id}`;
  }
  const professions = parse<string[]>(c.professions, []);
  // On a class-shared patient each student acts in their own profession, whatever the case was written for.
  const professionId = (teamScope && user.profession_id) || (user.profession_id && professions.includes(user.profession_id) ? user.profession_id : professions[0] || user.profession_id || "medicine");
  const id = createEncounter({ userId: user.id, caseId: c.id, professionId, mode, level, knobs, assignmentId: b.assignmentId || null, perturb, variantId: b.variantId || null, liveAssist, followUp: !!b.followUp && !b.assignmentId, teamScope });
  return Response.json({ id });
}
