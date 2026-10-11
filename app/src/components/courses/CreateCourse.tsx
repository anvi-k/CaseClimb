"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Input, Label } from "@/components/ui";

export default function CreateCourse() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/courses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    const j = await res.json().catch(() => ({ error: "Could not create the course" }));
    if (!res.ok || j.error) {
      setBusy(false);
      return setError(j.error || "Could not create the course");
    }
    router.push(`/faculty?class=${j.id}`);
  }
  return (
    <form onSubmit={create} className="grid gap-3 p-6 sm:grid-cols-[1fr_auto] sm:items-end">
      <div>
        <Label htmlFor="course-name">Class name</Label>
        <Input id="course-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. NUTR 5420 Clinical Counseling, Fall" maxLength={120} />
      </div>
      <Button type="submit" disabled={busy || !name.trim()}>
        {busy ? "Creating…" : "Create class"}
      </Button>
      {error && <p className="text-sm text-rose-700 sm:col-span-2">{error}</p>}
    </form>
  );
}
