"use client";
import { useState } from "react";
import { Button, Input, Label, Textarea } from "@/components/ui";

/**
 * Faculty note and optional adjusted score for one visit. Saved through POST /api/review/<encounterId>.
 * The note is shown to the student; the adjusted score replaces the rubric score in the gradebook.
 */
export default function FacultyReview({ encounterId, note, score }: { encounterId: string; note: string | null; score: number | null }) {
  const [text, setText] = useState(note || "");
  const [adj, setAdj] = useState(score === null || score === undefined ? "" : String(score));
  const [saved, setSaved] = useState({ note: note || "", score: score === null || score === undefined ? "" : String(score) });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = text.trim() !== saved.note.trim() || adj.trim() !== saved.score;
  const n = adj.trim() === "" ? null : Number(adj);
  const invalid = n !== null && (!Number.isFinite(n) || n < 0 || n > 100);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/review/${encounterId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note: text, score: n }) });
      const j = await res.json();
      if (!res.ok || j.error) throw new Error(j.error || "Could not save the review");
      const s = j.score === null ? "" : String(j.score);
      setText(j.note || "");
      setAdj(s);
      setSaved({ note: j.note || "", score: s });
      setMsg({ ok: true, text: "Review saved. The student can see your note." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
    setBusy(false);
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">Faculty review</h2>
      <p className="mt-0.5 text-xs text-slate-500">Your note is shown to the student with their feedback. An adjusted score replaces the rubric score in the gradebook.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_9rem]">
        <div>
          <Label htmlFor={`fr-note-${encounterId}`}>Note to the student</Label>
          <Textarea id={`fr-note-${encounterId}`} rows={4} value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} placeholder="What you agree with, what you would change, what to focus on next." />
        </div>
        <div>
          <Label htmlFor={`fr-score-${encounterId}`}>Adjusted score (%)</Label>
          <Input id={`fr-score-${encounterId}`} type="number" min={0} max={100} step={1} inputMode="decimal" value={adj} onChange={(e) => setAdj(e.target.value)} placeholder="Leave blank" aria-invalid={invalid} />
          <p className="mt-1 text-[11px] text-slate-500">{invalid ? "Enter a number from 0 to 100." : "Blank keeps the rubric score."}</p>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button size="sm" onClick={save} disabled={busy || invalid || !dirty}>
          {busy ? "Saving…" : "Save review"}
        </Button>
        {msg && <span className={`text-xs ${msg.ok ? "text-emerald-700" : "text-rose-700"}`}>{msg.text}</span>}
      </div>
    </div>
  );
}
