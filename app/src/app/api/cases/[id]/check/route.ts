import { run } from "@/lib/db";
import { longJson } from "@/lib/http";
import { listRubrics } from "@/lib/rubrics";
import { modelCheck } from "@/lib/studio/ai";
import { runRuleChecks, type ConsistencyResult } from "@/lib/studio/checks";
import { hashProfile } from "@/lib/studio/profile";
import { caseFor, consistencyOf, profileOf } from "@/lib/studio/store";

/** Runs the structure checks and the clinical review on the saved profile and stores the result. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const r = await caseFor((await params).id, { write: true });
  if (r instanceof Response) return r;
  const profile = profileOf(r.row);
  const previous = consistencyOf(r.row);
  return longJson(async () => {
    const dismissed = new Set((previous?.issues || []).filter((i) => i.status === "dismissed").map((i) => i.id));
    const rules = runRuleChecks(profile, listRubrics().map((x) => x.id)).map((i) => (dismissed.has(i.id) ? { ...i, status: "dismissed" as const } : i));
    const result: ConsistencyResult = { ranAt: new Date().toISOString(), profileHash: hashProfile(profile), modelRan: false, issues: rules };
    try {
      const m = await modelCheck(profile);
      result.modelRan = true;
      result.summary = m.summary;
      result.issues = [...rules, ...m.issues];
    } catch (e) {
      console.error("[studio] clinical review failed", e);
      result.modelError = (e as Error).message || "The clinical review could not be completed.";
    }
    const order = { high: 0, medium: 1, low: 2 };
    result.issues.sort((a, b) => order[a.severity] - order[b.severity]);
    run("UPDATE cases SET consistency = ? WHERE id = ?", JSON.stringify(result), r.row.id);
    return { consistency: result };
  });
}
