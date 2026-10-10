import { bad, longJson } from "@/lib/http";
import { guide, type GuideTurn } from "@/lib/studio/ai";
import { sanitizeProfile } from "@/lib/studio/profile";
import { caseFor, profileOf } from "@/lib/studio/store";

/**
 * Plain-language change request -> proposed patch. Nothing is saved here.
 * Body: { messages: [{ role, text }], profile? } - profile is the editor's current state, including unsaved edits.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const r = await caseFor((await params).id, { write: true });
  if (r instanceof Response) return r;
  const b = await req.json().catch(() => ({}));
  const messages: GuideTurn[] = (Array.isArray(b.messages) ? b.messages : [])
    .filter((m: GuideTurn) => m && (m.role === "user" || m.role === "assistant") && typeof m.text === "string" && m.text.trim())
    .map((m: GuideTurn) => ({ role: m.role, text: m.text }));
  if (!messages.length || messages[messages.length - 1].role !== "user") return bad("Ask the guide for a change first.");
  const profile = b.profile && typeof b.profile === "object" ? sanitizeProfile(b.profile) : profileOf(r.row);
  return longJson(() => guide(profile, messages));
}
