import { encounterFor } from "@/lib/access";
import { rewind } from "@/lib/engine/encounter";
import { bad } from "@/lib/http";

/** Body: { turn } = the last turn to keep. Returns the id of the new branched visit. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = await encounterFor(id);
  if (r instanceof Response) return r;
  const turn = Number((await req.json().catch(() => ({}))).turn);
  if (!Number.isInteger(turn) || turn < 0) return bad("Invalid turn");
  try {
    return Response.json({ id: rewind(id, turn) });
  } catch (e) {
    return bad((e as Error).message);
  }
}
