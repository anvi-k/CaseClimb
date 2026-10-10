import { encounterFor } from "@/lib/access";
import { hint } from "@/lib/engine/encounter";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = await encounterFor(id);
  if (r instanceof Response) return r;
  return Response.json({ text: hint(id) });
}
