import { apiUser } from "@/lib/auth";
import { bad } from "@/lib/http";
import { saveUpload } from "@/lib/studio/uploads";

/** multipart/form-data with one "file". Returns { id, url, filename, mime, text } (text for PDF, TXT and MD). */
export async function POST(req: Request) {
  const user = await apiUser("faculty");
  if (user instanceof Response) return user;
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return bad("Choose a file to upload.");
  try {
    return Response.json(await saveUpload(file, user.id));
  } catch (e) {
    return bad((e as Error).message || "Upload failed.");
  }
}
