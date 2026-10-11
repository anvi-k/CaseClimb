"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, Select, Textarea } from "@/components/ui";

const IDEAS = [
  "An anxious first-time parent who has read a lot online and questions everything I say",
  "An older man who downplays his symptoms and does not want to bother anyone",
  "A teenager who answers in one word until I earn some trust",
  "Someone who has stopped a medication and has not told anyone",
];

/** Lets a student ask for a private practice patient in their own words. */
export default function MakePatient({ roleName }: { roleName: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [level, setLevel] = useState("2");
  const [busy, setBusy] = useState(false);
  const [secs, setSecs] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);
  async function go() {
    setBusy(true);
    setSecs(0);
    setError("");
    try {
      const res = await fetch("/api/practice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ description: text, level: Number(level) }) });
      const j = await res.json();
      if (j.error || !j.id) throw new Error(j.error || "The patient could not be created.");
      router.push(`/encounter/${j.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  if (busy) {
    return (
      <div className="flex items-center gap-3 text-sm text-slate-700">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-brand-600" />
        <span>
          Writing your patient&apos;s history, chart and test results. This usually takes one to two minutes. {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}
          {secs > 150 ? " — still working; a long case takes longer." : ""}
        </span>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={1500} placeholder={`Describe a patient or a skill you want to practice as a ${roleName.toLowerCase()} student`} />
      <div className="flex flex-wrap gap-1.5">
        {IDEAS.map((i) => (
          <button key={i} type="button" onClick={() => setText(i)} className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-left text-[12px] text-slate-600 hover:border-brand-500">
            {i}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={level} onChange={(e) => setLevel(e.target.value)} className="w-auto">
          {[1, 2, 3, 4, 5].map((l) => (
            <option key={l} value={l}>
              Level {l}
            </option>
          ))}
        </Select>
        <Button onClick={go} disabled={text.trim().length < 15}>
          Create and start
        </Button>
        <span className="text-xs text-slate-500">Private to you. Written by AI and not reviewed by faculty.</span>
      </div>
      {error && <p className="text-sm text-rose-700">{error}</p>}
    </div>
  );
}
