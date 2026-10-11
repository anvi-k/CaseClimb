"use client";

import Link from "next/link";
import { startTransition, useActionState, useState } from "react";
import { Button, Input, Label, Select } from "@/components/ui";
import { login, register } from "./actions";

type Group = { group: string; items: { id: string; name: string }[] };

export default function AuthForm({ mode, groups, next }: { mode: "login" | "register"; groups?: Group[]; next?: string }) {
  const [error, action, pending] = useActionState(mode === "login" ? login : register, null);
  const [role, setRole] = useState("student");
  // Submitted by hand rather than through the form's action: React resets a form after its action
  // returns, which wiped the name and email (and put the role and program back to their defaults)
  // whenever the server sent back an error such as a duplicate email.
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [profession, setProfession] = useState("medicine");
  const q = next ? `?next=${encodeURIComponent(next)}` : "";
  return (
    <form
      action={action}
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
      className="space-y-4"
    >
      {next && <input type="hidden" name="next" value={next} />}
      {mode === "register" && (
        <>
          <div>
            <Label htmlFor="name">Full name</Label>
            <Input id="name" name="name" required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label>I am a</Label>
            <div className="grid grid-cols-2 gap-2">
              {["student", "faculty"].map((r) => (
                <label key={r} className={`cursor-pointer rounded-md border px-3 py-2 text-center text-sm capitalize ${role === r ? "border-brand-500 bg-brand-50 font-medium text-brand-700" : "border-slate-300 text-slate-600"}`}>
                  <input type="radio" name="role" value={r} checked={role === r} onChange={() => setRole(r)} className="sr-only" />
                  {r === "faculty" ? "Faculty / instructor" : "Student"}
                </label>
              ))}
            </div>
            <p className="mt-1.5 text-right text-xs text-slate-500">Faculty accounts can see every patient&apos;s answer key.</p>
          </div>
          <input type="hidden" name="profession" value="medicine" />
        </>
      )}
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div>
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" required minLength={mode === "register" ? 8 : undefined} autoComplete={mode === "login" ? "current-password" : "new-password"} />
      </div>
      {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      <Button type="submit" disabled={pending} className="w-full" size="lg">
        {pending ? "One moment..." : mode === "login" ? "Sign in" : "Create account"}
      </Button>
      <p className="text-center text-sm text-slate-600">
        {mode === "login" ? (
          <>
            New here? <Link href={`/register${q}`} className="font-medium text-brand-600 hover:underline">Create an account</Link>
          </>
        ) : (
          <>
            Already have an account? <Link href={`/login${q}`} className="font-medium text-brand-600 hover:underline">Sign in</Link>
          </>
        )}
      </p>
    </form>
  );
}
