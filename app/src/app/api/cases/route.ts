import { apiUser } from "@/lib/auth";
import { normalizeCase } from "@/lib/casegen";
import { bad } from "@/lib/http";
import { professions } from "@/lib/professions";
import { blankProfile, sanitizeProfile, tidyTables } from "@/lib/studio/profile";
import { insertCase, listCases } from "@/lib/studio/store";

/** The faculty member's library. */
export async function GET() {
  const user = await apiUser("faculty");
  if (user instanceof Response) return user;
  return Response.json({ cases: listCases(user) });
}

/**
 * Create a case without the model.
 * Body: { import: CaseProfile | { profile, origin?, reviewed? } }  or  { blank: true, professionId }.
 */
export async function POST(req: Request) {
  const user = await apiUser("faculty");
  if (user instanceof Response) return user;
  const b = await req.json().catch(() => null);
  if (!b) return bad("Send JSON.");
  const roles = professions().map((p) => p.id);
  if (b.blank) {
    const id = insertCase({ ownerId: user.id, origin: "faculty", profile: blankProfile(roles.includes(b.professionId) ? b.professionId : roles[0]) });
    return Response.json({ id });
  }
  const src = b.import;
  if (!src || typeof src !== "object") return bad("That file does not contain a patient profile.");
  const wrapped = src.profile && typeof src.profile === "object";
  const raw = wrapped ? src.profile : src;
  if (!Array.isArray(raw.facts) || !raw.patient || !raw.scenario) return bad("That file is not a Poscere patient profile: it needs at least patient, scenario and facts.");
  try {
    const profile = tidyTables(sanitizeProfile(normalizeCase(sanitizeProfile(raw))));
    if (!profile.title) profile.title = `${profile.patient.name || "Imported patient"}`;
    // An imported file keeps its AI-draft label unless it says a faculty member reviewed it.
    const origin = wrapped && src.origin === "ai_draft" ? "ai_draft" : "faculty";
    const id = insertCase({ ownerId: user.id, origin, profile, reviewed: wrapped && src.reviewed === true });
    return Response.json({ id });
  } catch (e) {
    return bad((e as Error).message || "That profile could not be imported.");
  }
}
