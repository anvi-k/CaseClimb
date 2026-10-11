import { apiUser } from "@/lib/auth";
import { get, run } from "@/lib/db";
import { bad } from "@/lib/http";
import { cleanRubric } from "@/lib/studio/rubricSpec";

type Ctx = { params: Promise<{ id: string }> };

async function own(id: string) {
  const user = await apiUser("faculty");
  if (user instanceof Response) return user;
  const row = get<{ id: string; owner_id: string | null }>("SELECT id, owner_id FROM rubrics WHERE id = ?", id);
  if (!row) return bad("Rubric not found", 404);
  if (row.owner_id !== user.id && user.role !== "admin") return bad("You can only change rubrics you created.", 403);
  return { user, row };
}

export async function PUT(req: Request, { params }: Ctx) {
  const r = await own((await params).id);
  if (r instanceof Response) return r;
  try {
    const spec = cleanRubric(await req.json().catch(() => null));
    run("UPDATE rubrics SET name = ?, spec = ? WHERE id = ?", spec.name, JSON.stringify(spec), r.row.id);
    return Response.json({ rubric: { ...spec, id: r.row.id, custom: true, mine: true } });
  } catch (e) {
    return bad((e as Error).message);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const r = await own((await params).id);
  if (r instanceof Response) return r;
  const used = get<{ n: number }>("SELECT COUNT(*) AS n FROM cases WHERE json_extract(profile, '$.rubricId') = ?", r.row.id)!.n;
  if (used) return bad(`This rubric is used by ${used} patient${used === 1 ? "" : "s"}. Choose another rubric for them first.`, 409);
  run("DELETE FROM rubrics WHERE id = ?", r.row.id);
  return Response.json({ ok: true });
}
