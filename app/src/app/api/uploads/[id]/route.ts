import { apiUser } from "@/lib/auth";
import { bad } from "@/lib/http";
import { readUpload } from "@/lib/studio/uploads";

/** Serves an uploaded file to any signed-in user (students see chart documents during a visit). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiUser();
  if (user instanceof Response) return user;
  const hit = readUpload((await params).id);
  if (!hit) return bad("File not found", 404);
  return new Response(new Uint8Array(hit.data), {
    headers: {
      "Content-Type": hit.row.mime,
      "Content-Length": String(hit.data.length),
      "Content-Disposition": `inline; filename="${hit.row.filename.replace(/[^\w.\- ]+/g, "_")}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
