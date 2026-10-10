import { encounterFor } from "@/lib/access";
import { addMessage } from "@/lib/engine/encounter";
import { bad } from "@/lib/http";

/** Faculty sends an in-the-moment note to the student. Body: { text } */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = await encounterFor(id, { faculty: "only" });
  if (r instanceof Response) return r;
  if (!r.enc.cfg.liveAssist) return bad("Live assist is not enabled for this visit", 403);
  const text = String((await req.json().catch(() => ({}))).text || "").trim().slice(0, 1000);
  if (!text) return bad("Write a note first");
  addMessage(id, r.enc.state.turn, "instructor", `${r.user.name}: ${text}`, { kind: "coach" });
  return Response.json({ ok: true });
}
