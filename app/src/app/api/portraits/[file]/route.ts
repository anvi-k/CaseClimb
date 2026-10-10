import fs from "node:fs";
import path from "node:path";
import { getUser } from "@/lib/auth";
import { portraitDir } from "@/lib/portrait";

/** Serves a generated patient portrait to signed-in users. */
export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  if (!(await getUser())) return new Response("Not signed in", { status: 401 });
  const { file } = await ctx.params;
  if (!/^p_[A-Za-z0-9_-]{6,}\.jpg$/.test(file)) return new Response("Not found", { status: 404 });
  const full = path.join(portraitDir(), file);
  if (!fs.existsSync(full)) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(fs.readFileSync(full)), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400" } });
}
