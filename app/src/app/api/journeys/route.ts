import { apiUser, isFaculty } from "@/lib/auth";
import { all, get, newId, run } from "@/lib/db";
import { bad } from "@/lib/http";
import { normaliseStages } from "@/lib/journey/guide";

/** Lists journeys: published ones for students, all for faculty. */
export async function GET() {
  const user = await apiUser();
  if (user instanceof Response) return user;
  const rows = all<{ id: string; title: string; status: string; case_id: string; spec: string }>(
    `SELECT id, title, status, case_id, spec FROM journeys ${isFaculty(user) ? "WHERE status != 'archived'" : "WHERE status = 'published'"} ORDER BY created_at DESC`,
  );
  return Response.json({ journeys: rows.map((r) => ({ ...r, spec: JSON.parse(r.spec) })) });
}

/** Creates a journey. Body: { title, caseId, summary, stages, publish? } */
export async function POST(req: Request) {
  const user = await apiUser("faculty");
  if (user instanceof Response) return user;
  const b = await req.json().catch(() => ({}));
  const title = String(b.title || "").trim();
  if (!title) return bad("Give the journey a title.");
  if (!get("SELECT 1 FROM cases WHERE id = ? AND status = 'published'", b.caseId)) return bad("Choose a published patient case.");
  const stages = normaliseStages(b.stages);
  if (b.publish && stages.length < 3) return bad("A journey needs at least three encounters before it can be published.");
  const id = newId("j_");
  run("INSERT INTO journeys (id, owner_id, status, title, case_id, spec) VALUES (?,?,?,?,?,?)", id, user.id, b.publish ? "published" : "draft", title, b.caseId, JSON.stringify({ summary: String(b.summary || ""), stages }));
  return Response.json({ id });
}
