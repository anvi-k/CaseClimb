import { recommend } from "@/lib/adaptive";
import { apiUser } from "@/lib/auth";
import { bad } from "@/lib/http";
import { professions } from "@/lib/professions";

/** The next adaptive session for the signed-in student. Optional ?profession= to practice another role. */
export async function GET(req: Request) {
  const user = await apiUser();
  if (user instanceof Response) return user;
  const asked = new URL(req.url).searchParams.get("profession");
  const professionId = asked && professions().some((p) => p.id === asked) ? asked : user.profession_id;
  if (!professionId) return bad("Choose a profession first");
  const r = recommend(user.id, professionId);
  return Response.json({ professionId, caseId: r.caseId, label: r.label, level: r.level, knobs: r.knobs, reason: r.reason, sessions: r.profile.sessions, overall: Math.round(r.profile.overall), weakest: r.profile.weakest });
}
