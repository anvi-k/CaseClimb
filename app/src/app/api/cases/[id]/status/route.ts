import { run } from "@/lib/db";
import { bad } from "@/lib/http";
import { listRubrics } from "@/lib/rubrics";
import { runRuleChecks, type Issue } from "@/lib/studio/checks";
import { hashProfile } from "@/lib/studio/profile";
import { caseFor, consistencyOf, getCase, metaOf, profileOf } from "@/lib/studio/store";

/**
 * Body: { action: "publish" | "unpublish" | "archive" | "restore" | "review" | "unreview", force?, dryRun?, markReviewed? }
 * Publishing is refused (409) while high-severity issues are open, unless force is true.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const r = await caseFor((await params).id, { write: true });
  if (r instanceof Response) return r;
  const b = await req.json().catch(() => ({}));
  const id = r.row.id;
  const done = () => Response.json({ ok: true, meta: metaOf(getCase(id)!, r.user) });

  switch (b.action) {
    case "publish": {
      const profile = profileOf(r.row);
      const stored = consistencyOf(r.row);
      const dismissed = new Set((stored?.issues || []).filter((i) => i.status === "dismissed").map((i) => i.id));
      // Structure is re-checked now; the clinical review is whatever the last full check found.
      const rules = runRuleChecks(profile, listRubrics().map((x) => x.id)).filter((i) => i.severity === "high" && !dismissed.has(i.id));
      const clinical = (stored?.issues || []).filter((i) => i.source === "model" && i.severity === "high" && i.status === "open");
      const high: Issue[] = [...rules, ...clinical];
      const gate = {
        high,
        checked: !!stored,
        clinicalReviewRan: !!stored?.modelRan,
        stale: !!stored && stored.profileHash !== hashProfile(profile),
        reviewed: !!r.row.reviewed,
        origin: r.row.origin,
      };
      if (b.dryRun) return Response.json({ ok: true, gate });
      if (high.length && !b.force) return Response.json({ error: `${high.length} high-severity issue${high.length === 1 ? " is" : "s are"} still open.`, needsConfirm: true, gate }, { status: 409 });
      run("UPDATE cases SET status = 'published', reviewed = CASE WHEN ? THEN 1 ELSE reviewed END, updated_at = datetime('now') WHERE id = ?", b.markReviewed ? 1 : 0, id);
      return done();
    }
    case "unpublish":
      run("UPDATE cases SET status = 'draft', updated_at = datetime('now') WHERE id = ?", id);
      return done();
    case "archive":
      run("UPDATE cases SET status = 'archived', updated_at = datetime('now') WHERE id = ?", id);
      return done();
    case "restore":
      run("UPDATE cases SET status = 'draft', updated_at = datetime('now') WHERE id = ?", id);
      return done();
    case "review":
      run("UPDATE cases SET reviewed = 1 WHERE id = ?", id);
      return done();
    case "unreview":
      run("UPDATE cases SET reviewed = 0 WHERE id = ?", id);
      return done();
    default:
      return bad("Unknown action.");
  }
}
