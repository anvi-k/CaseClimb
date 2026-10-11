"use server";

import { redirect } from "next/navigation";
import { createUser, endSession, safeNextPath, startSession, verifyLogin } from "@/lib/auth";

export async function login(_prev: string | null, form: FormData): Promise<string | null> {
  const user = await verifyLogin(String(form.get("email") || ""), String(form.get("password") || ""));
  if (!user) return "That email and password don't match an account.";
  await startSession(user.id);
  // Back to the page they were sent to /login from, if it is a path on this site.
  redirect(safeNextPath(form.get("next")) || (user.role === "student" ? "/student" : "/faculty"));
}

export async function register(_prev: string | null, form: FormData): Promise<string | null> {
  const role = form.get("role") === "faculty" ? "faculty" : "student";
  const password = String(form.get("password") || "");
  const email = String(form.get("email") || "");
  const name = String(form.get("name") || "");
  if (!name.trim() || !/^\S+@\S+\.\S+$/.test(email)) return "Enter your name and a valid email.";
  if (password.length < 8) return "Use a password of at least 8 characters.";
  try {
    const user = await createUser({ email, password, name, role, professionId: String(form.get("profession") || "") || null });
    await startSession(user.id);
  } catch (e) {
    return (e as Error).message;
  }
  redirect(safeNextPath(form.get("next")) || (role === "student" ? "/student" : "/faculty"));
}

export async function logout() {
  await endSession();
  redirect("/login");
}
