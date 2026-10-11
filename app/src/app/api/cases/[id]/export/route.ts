import { caseFor, profileOf } from "@/lib/studio/store";

/** Downloads the case in the same shape the seed loader and the importer read. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const r = await caseFor((await params).id);
  if (r instanceof Response) return r;
  const profile = profileOf(r.row);
  const name = (profile.patient.name || profile.title || "patient").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "patient";
  return new Response(JSON.stringify({ origin: r.row.origin, reviewed: !!r.row.reviewed, profile }, null, 1), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="poscere-${name}.json"`, "Cache-Control": "no-store" },
  });
}
