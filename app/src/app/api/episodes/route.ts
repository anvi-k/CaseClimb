import { userFromKey } from "@/lib/apikeys";
import { apiUser } from "@/lib/auth";
import { getEpisode, searchEpisodes } from "@/lib/episodes";
import { bad } from "@/lib/http";

/**
 * GET /api/episodes?patient=&participant=&role=&text=&caseId=&limit=   -> search
 * GET /api/episodes?id=<episodeId>                                      -> one episode in full
 * Auth: session cookie, or `Authorization: Bearer <personal key>`.
 */
export async function GET(req: Request) {
  const user = userFromKey(req) || (await apiUser());
  if (user instanceof Response) return user;
  const p = new URL(req.url).searchParams;
  if (p.get("id")) {
    const ep = getEpisode(user, p.get("id")!);
    return ep ? Response.json(ep) : bad("Episode not found", 404);
  }
  return Response.json({
    episodes: searchEpisodes(user, { patient: p.get("patient") || undefined, participant: p.get("participant") || undefined, role: p.get("role") || undefined, text: p.get("text") || undefined, caseId: p.get("caseId") || undefined, limit: Number(p.get("limit")) || undefined }),
  });
}
