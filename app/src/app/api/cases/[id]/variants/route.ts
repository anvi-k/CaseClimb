import { longJson } from "@/lib/http";
import { draftVariant, type VariantFocus } from "@/lib/studio/ai";
import { sanitizeProfile } from "@/lib/studio/profile";
import { caseFor, profileOf } from "@/lib/studio/store";

/**
 * Drafts one alternate version of the case. It is returned unapproved and is not saved here;
 * the editor adds it to the case as a draft the faculty member must approve.
 * Body: { focus: "persona" | "clinical" | "both", note?, profile? }
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const r = await caseFor((await params).id, { write: true });
  if (r instanceof Response) return r;
  const b = await req.json().catch(() => ({}));
  const focus: VariantFocus = ["persona", "clinical", "both"].includes(b.focus) ? b.focus : "persona";
  const profile = b.profile && typeof b.profile === "object" ? sanitizeProfile(b.profile) : profileOf(r.row);
  return longJson(async () => ({ variant: await draftVariant(profile, focus, String(b.note || "").slice(0, 1000)) }));
}
