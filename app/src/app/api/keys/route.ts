import { createKey, listKeys, revokeKey } from "@/lib/apikeys";
import { apiUser } from "@/lib/auth";

export async function GET() {
  const user = await apiUser();
  if (user instanceof Response) return user;
  return Response.json({ keys: listKeys(user.id) });
}
/** Body: { label } -> { key }. The full key is shown once. */
export async function POST(req: Request) {
  const user = await apiUser();
  if (user instanceof Response) return user;
  const b = await req.json().catch(() => ({}));
  return Response.json({ key: createKey(user.id, String(b.label || "Assistant")) });
}
/** Body: { id } = the key's first ten characters. */
export async function DELETE(req: Request) {
  const user = await apiUser();
  if (user instanceof Response) return user;
  const b = await req.json().catch(() => ({}));
  revokeKey(user.id, String(b.id || ""));
  return Response.json({ ok: true });
}
