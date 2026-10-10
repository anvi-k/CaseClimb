import { apiUser } from "@/lib/auth";
import { bad } from "@/lib/http";
import { clarify } from "@/lib/studio/ai";

/** Up to three short questions when a description leaves the clinical picture open. Body: { professionId, description, goals?, level? } */
export async function POST(req: Request) {
  const user = await apiUser("faculty");
  if (user instanceof Response) return user;
  const b = await req.json().catch(() => ({}));
  const description = String(b.description || "").trim();
  if (description.length < 15) return bad("Describe the patient in a sentence or two first.");
  try {
    return Response.json(await clarify({ professionId: b.professionId, description: description.slice(0, 20000), goals: b.goals ? String(b.goals).slice(0, 4000) : undefined, level: Number(b.level) || undefined }));
  } catch (e) {
    console.error("[studio] clarify failed", e);
    // Clarifying questions are optional; generation can proceed without them.
    return Response.json({ questions: [], understood: "", skipped: (e as Error).message || "The guide could not be reached." });
  }
}
