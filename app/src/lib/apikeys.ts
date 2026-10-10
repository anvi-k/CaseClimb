import { nanoid } from "nanoid";
import { all, get, run } from "./db";
import type { User } from "./types";

export function createKey(userId: string, label: string) {
  const key = "rk_" + nanoid(32);
  run("INSERT INTO api_keys (key, user_id, label) VALUES (?,?,?)", key, userId, label.slice(0, 80));
  return key;
}
export const listKeys = (userId: string) =>
  all<{ key: string; label: string; created_at: string; last_used_at: string | null }>("SELECT key, label, created_at, last_used_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC", userId).map((k) => ({ id: k.key.slice(0, 10), label: k.label, createdAt: k.created_at, lastUsedAt: k.last_used_at }));
export const revokeKey = (userId: string, idPrefix: string) => run("DELETE FROM api_keys WHERE user_id = ? AND substr(key, 1, 10) = ?", userId, idPrefix);

/** Resolves `Authorization: Bearer rk_...` to a user. */
export function userFromKey(req: Request): User | null {
  const m = /^Bearer\s+(rk_[A-Za-z0-9_-]+)$/.exec(req.headers.get("authorization") || "");
  if (!m) return null;
  const u = get<User>("SELECT u.id, u.email, u.name, u.role, u.profession_id FROM api_keys k JOIN users u ON u.id = k.user_id WHERE k.key = ?", m[1]);
  if (u) run("UPDATE api_keys SET last_used_at = datetime('now') WHERE key = ?", m[1]);
  return u || null;
}
