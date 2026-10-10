import { apiUser, isFaculty } from "@/lib/auth";
import { get } from "@/lib/db";
import { bad } from "@/lib/http";
import { createRun } from "@/lib/journey/runner";
import { loadJourney } from "@/lib/journey/store";

/** Starts a run. Body: { journeyId, stageId, assignmentId? } */
export async function POST(req: Request) {
  const user = await apiUser();
  if (user instanceof Response) return user;
  const b = await req.json().catch(() => ({}));
  const j = loadJourney(String(b.journeyId || ""));
  if (!j || (j.row.status !== "published" && !isFaculty(user))) return bad("Journey not found", 404);
  let assignmentId: string | null = null;
  if (b.assignmentId) {
    const a = get<{ id: string; journey_id: string | null }>("SELECT id, journey_id FROM assignments WHERE id = ?", b.assignmentId);
    if (a && (!a.journey_id || a.journey_id === j.row.id)) assignmentId = a.id;
  }
  try {
    return Response.json({ id: createRun({ journeyId: j.row.id, userId: user.id, stageId: String(b.stageId || ""), assignmentId }) });
  } catch (e) {
    return bad((e as Error).message);
  }
}
