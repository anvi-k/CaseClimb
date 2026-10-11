import { apiUser } from "@/lib/auth";
import { newId, run } from "@/lib/db";
import { bad } from "@/lib/http";
import { cleanRubric } from "@/lib/studio/rubricSpec";
import { rubricsFor } from "@/lib/studio/store";

/** Built-in rubrics plus custom ones. `mine` marks the ones the caller can edit. */
export async function GET() {
  const user = await apiUser("faculty");
  if (user instanceof Response) return user;
  return Response.json({ rubrics: rubricsFor(user) });
}

/** Save a custom rubric. Body: { name, type: "domain4" | "checklist", instructions?, domains? | items? } */
export async function POST(req: Request) {
  const user = await apiUser("faculty");
  if (user instanceof Response) return user;
  try {
    const spec = cleanRubric(await req.json().catch(() => null));
    const id = newId("rb_");
    run("INSERT INTO rubrics (id, owner_id, name, spec) VALUES (?,?,?,?)", id, user.id, spec.name, JSON.stringify(spec));
    return Response.json({ rubric: { ...spec, id, custom: true, mine: true } });
  } catch (e) {
    return bad((e as Error).message);
  }
}
