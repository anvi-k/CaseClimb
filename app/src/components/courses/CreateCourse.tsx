"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Input, Label, Select } from "@/components/ui";

export default function CreateCourse({ professions }: { professions: { id: string; name: string }[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [professionId, setProfessionId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/courses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, professionId }) });
    const j = await res.json().catch(() => ({ error: "Could not create the course" }));
    if (!res.ok || j.error) {
      setBusy(false);
      return setError(j.error || "Could not create the course");
    }
    router.push(`/faculty/courses/${j.id}`);
  }
  return (
    <form onSubmit={create} className="grid gap-3 p-4 sm:grid-cols-[2fr_1.5fr_auto] sm:items-end">
      <div>
        <Label htmlFor="course-name">Course name</Label>
        <Input id="course-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. NUTR 5420 Clinical Counseling, Fall" maxLength={120} />
      </div>
      <div>
        <Label htmlFor="course-prof">Students are training as</Label>
        <Select id="course-prof" value={professionId} onChange={(e) => setProfessionId(e.target.value)}>
          <option value="">Mixed / interprofessional</option>
          {professions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </div>
      <Button type="submit" disabled={busy || !name.trim()}>
        {busy ? "Creating…" : "Create course"}
      </Button>
      {error && <p className="text-xs text-rose-700 sm:col-span-3">{error}</p>}
    </form>
  );
}
