"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Input } from "@/components/ui";

export default function JoinCourse() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function join(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/courses/join", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
    const j = await res.json().catch(() => ({ error: "Could not join the course" }));
    setBusy(false);
    if (!res.ok || j.error) return setMsg({ ok: false, text: j.error || "Could not join the course" });
    setMsg({ ok: true, text: `You joined ${j.course.name}.` });
    setCode("");
    router.refresh();
  }
  return (
    <form onSubmit={join} className="space-y-2">
      <div className="flex gap-2">
        <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Join code, e.g. K7M2QP" maxLength={8} aria-label="Course join code" className="font-mono uppercase tracking-widest" />
        <Button type="submit" variant="secondary" disabled={busy || code.trim().length < 4}>
          Join
        </Button>
      </div>
      {msg && <p className={`text-xs ${msg.ok ? "text-emerald-700" : "text-rose-700"}`}>{msg.text}</p>}
    </form>
  );
}
