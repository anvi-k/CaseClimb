import { get } from "@/lib/db";

export async function GET() {
  const cases = get<{ n: number }>("SELECT COUNT(*) AS n FROM cases")?.n ?? 0;
  return Response.json({ ok: true, cases, sha: (process.env.GIT_SHA || "dev").slice(0, 7) });
}
