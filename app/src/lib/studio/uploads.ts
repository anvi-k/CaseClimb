// Uploaded files: stored on disk, recorded in the uploads table, served from /api/uploads/[id].
import fs from "node:fs";
import path from "node:path";
import { get, newId, run } from "@/lib/db";

export const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), "data", "uploads");
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

const TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};
export const ACCEPTED = Object.keys(TYPES);

export interface UploadRow {
  id: string;
  owner_id: string | null;
  filename: string;
  mime: string;
  path: string;
  text: string | null;
  created_at: string;
}

async function pdfText(buf: Buffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(pdf, { mergePages: true });
  return (Array.isArray(text) ? text.join("\n\n") : text).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export async function saveUpload(file: File, ownerId: string): Promise<{ id: string; url: string; filename: string; mime: string; text: string | null; note?: string }> {
  const ext = path.extname(file.name || "").toLowerCase();
  const mime = TYPES[ext];
  if (!mime) throw new Error(`"${file.name}" is not a supported file type. Use PDF, PNG, JPG, GIF, WebP, TXT or MD.`);
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("That file is larger than 20 MB.");
  if (!file.size) throw new Error("That file is empty.");
  const buf = Buffer.from(await file.arrayBuffer());
  const id = newId("up_");
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const stored = id + ext;
  fs.writeFileSync(path.join(UPLOAD_DIR, stored), buf);
  let text: string | null = null;
  let note: string | undefined;
  if (ext === ".txt" || ext === ".md") text = buf.toString("utf8");
  if (ext === ".pdf") {
    try {
      text = await pdfText(buf);
      if (!text) note = "No text could be read from this PDF (it may be a scan). Paste the relevant text instead.";
    } catch (e) {
      console.error("[uploads] pdf text extraction failed", e);
      note = "The text of this PDF could not be read. Paste the relevant text instead.";
    }
  }
  const filename = path.basename(file.name).slice(0, 200);
  // The stored path is relative to UPLOAD_DIR so the directory can move between environments.
  run("INSERT INTO uploads (id, owner_id, filename, mime, path, text) VALUES (?,?,?,?,?,?)", id, ownerId, filename, mime, stored, text);
  // The extension is part of the URL so viewers can tell a PDF from an image without a request.
  return { id, url: `/api/uploads/${id}${ext}`, filename, mime, text, note };
}

export function readUpload(id: string): { row: UploadRow; data: Buffer } | null {
  const row = get<UploadRow>("SELECT * FROM uploads WHERE id = ?", id.replace(/\.[a-z0-9]+$/i, ""));
  if (!row) return null;
  const file = path.join(UPLOAD_DIR, path.basename(row.path));
  if (!fs.existsSync(file)) return null;
  return { row, data: fs.readFileSync(file) };
}

export const uploadRow = (id: string) => get<UploadRow>("SELECT * FROM uploads WHERE id = ?", id);
