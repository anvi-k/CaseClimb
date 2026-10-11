import { encounterFor } from "@/lib/access";
import { runAction } from "@/lib/engine/encounter";
import { bad } from "@/lib/http";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = await encounterFor(id);
  if (r instanceof Response) return r;
  const request = String((await req.json().catch(() => ({}))).request || "").trim().slice(0, 500);
  if (!request) return bad("Enter an exam, test or record to request");
  try {
    return Response.json(await runAction(id, request));
  } catch (e) {
    return bad((e as Error).message);
  }
}
