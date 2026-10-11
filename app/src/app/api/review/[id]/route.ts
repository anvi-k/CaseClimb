import { apiUser } from "@/lib/auth";
import { get, run } from "@/lib/db";
import { bad } from "@/lib/http";

/** Faculty review of a visit. Body: { note: string | null, score: number | null } (score 0-100, null clears the adjustment). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await apiUser("faculty");
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const enc = get<{ id: string; status: string; user_id: string; assignment_id: string | null; journey_run_id: string | null }>("SELECT id, status, user_id, assignment_id, journey_run_id FROM encounters WHERE id = ?", id);
  if (!enc) return bad("Visit not found", 404);
  // Self-started practice is private to the student; only assignment and journey visits are open to review.
  if (!enc.assignment_id && !enc.journey_run_id && enc.user_id !== user.id) return bad("This is a private practice visit and is not open to instructor review", 403);
  if (enc.status !== "scored" && enc.status !== "submitted") return bad("This visit has not been submitted yet");
  const b = await req.json().catch(() => ({}));
  const note = String(b.note ?? "").trim().slice(0, 4000) || null;
  let score: number | null = null;
  if (b.score !== null && b.score !== undefined && b.score !== "") {
    score = Number(b.score);
    if (!Number.isFinite(score) || score < 0 || score > 100) return bad("The adjusted score must be between 0 and 100");
    score = Math.round(score * 10) / 10;
  }
  run("UPDATE encounters SET faculty_note = ?, faculty_score = ? WHERE id = ?", note, score, id);
  return Response.json({ ok: true, note, score });
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await apiUser("faculty");
  if (user instanceof Response) return user;
  const row = get<{ faculty_note: string | null; faculty_score: number | null; user_id: string; assignment_id: string | null; journey_run_id: string | null }>("SELECT faculty_note, faculty_score, user_id, assignment_id, journey_run_id FROM encounters WHERE id = ?", (await ctx.params).id);
  if (!row) return bad("Visit not found", 404);
  if (!row.assignment_id && !row.journey_run_id && row.user_id !== user.id) return bad("This is a private practice visit and is not open to instructor review", 403);
  return Response.json({ note: row.faculty_note, score: row.faculty_score });
}
