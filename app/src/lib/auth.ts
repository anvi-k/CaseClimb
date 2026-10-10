import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { get, newId, run } from "./db";
import type { User, UserRole } from "./types";

const COOKIE = "rounds_session";
const secret = () => new TextEncoder().encode(process.env.SESSION_SECRET || "dev-secret-change-me-please-32chars!!");

export async function createUser(input: {
  email: string;
  password: string;
  name: string;
  role: UserRole;
  professionId?: string | null;
}): Promise<User> {
  const email = input.email.trim().toLowerCase();
  if (get("SELECT id FROM users WHERE email = ?", email)) throw new Error("An account with that email already exists.");
  const id = newId("u_");
  run(
    "INSERT INTO users (id, email, password_hash, name, role, profession_id) VALUES (?,?,?,?,?,?)",
    id,
    email,
    await bcrypt.hash(input.password, 10),
    input.name.trim(),
    input.role,
    input.professionId || null,
  );
  return { id, email, name: input.name.trim(), role: input.role, profession_id: input.professionId || null };
}

export async function verifyLogin(email: string, password: string): Promise<User | null> {
  const row = get<User & { password_hash: string }>("SELECT * FROM users WHERE email = ?", email.trim().toLowerCase());
  if (!row || !(await bcrypt.compare(password, row.password_hash))) return null;
  return { id: row.id, email: row.email, name: row.name, role: row.role, profession_id: row.profession_id };
}

export async function startSession(userId: string) {
  const token = await new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("14d")
    .sign(secret());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "1",
    path: "/",
    maxAge: 60 * 60 * 24 * 14,
  });
}

export async function endSession() {
  (await cookies()).delete(COOKIE);
}

/** Current user or null. */
export async function getUser(): Promise<User | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    const u = get<User>("SELECT id, email, name, role, profession_id FROM users WHERE id = ?", payload.sub as string);
    return u || null;
  } catch {
    return null;
  }
}

/**
 * A path on this site that is safe to send someone to after sign-in, or null.
 * Rejects absolute URLs, protocol-relative URLs ("//host"), backslashes and control characters.
 */
export function safeNextPath(next: unknown): string | null {
  const p = typeof next === "string" ? next : "";
  if (!p.startsWith("/") || p.startsWith("//") || p.length > 500 || /[\\\u0000-\u001f]/.test(p)) return null;
  if (/^\/(login|register)(\/|\?|$)/.test(p) || p.startsWith("/api/")) return null;
  return p;
}

/** For pages: redirects to /login, remembering the page that was asked for (or home when the role does not match). */
export async function requireUser(role?: "faculty" | "student"): Promise<User> {
  const u = await getUser();
  if (!u) {
    // Set by src/proxy.ts. "/" needs no return trip: it already redirects by role.
    const from = safeNextPath((await headers()).get("x-rounds-path"));
    redirect(from && from !== "/" ? `/login?next=${encodeURIComponent(from)}` : "/login");
  }
  if (role === "faculty" && u.role === "student") redirect("/student");
  return u;
}

export const isFaculty = (u: User) => u.role === "faculty" || u.role === "admin";

/** For route handlers: returns the user or a 401/403 Response. */
export async function apiUser(role?: "faculty"): Promise<User | Response> {
  const u = await getUser();
  if (!u) return Response.json({ error: "Not signed in" }, { status: 401 });
  if (role === "faculty" && !isFaculty(u)) return Response.json({ error: "Faculty only" }, { status: 403 });
  return u;
}
