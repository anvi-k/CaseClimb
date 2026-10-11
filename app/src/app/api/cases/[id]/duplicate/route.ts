import { caseFor, insertCase, profileOf } from "@/lib/studio/store";

/** Makes a private draft copy the caller owns. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const r = await caseFor((await params).id);
  if (r instanceof Response) return r;
  const profile = profileOf(r.row);
  profile.title = `${profile.title} (copy)`;
  // A copy of an unreviewed AI draft is still an unreviewed AI draft.
  const stillDraft = r.row.origin === "ai_draft" && !r.row.reviewed;
  const id = insertCase({ ownerId: r.user.id, origin: stillDraft ? "ai_draft" : "faculty", profile, reviewed: !!r.row.reviewed });
  return Response.json({ id });
}
