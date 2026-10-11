"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Card, CardHeader, Input, Label, Select, Textarea } from "@/components/ui";
import type { Stage } from "@/lib/journey/types";
import { post, Spinner } from "./shared";

interface Props {
  cases: { id: string; title: string; patient: string }[];
  clinicians: { id: string; name: string; role: string }[];
  professions: { id: string; name: string }[];
  initial?: { id: string; title: string; summary: string; caseId: string; status: string; stages: Stage[] };
}

const blank = (i: number, clinicianId: string): Stage => ({ id: `s${i + 1}`, order: i + 1, professionId: "", roleTitle: "", clinicianId, focus: "", simTime: `Week 1, day ${i + 1}`, visitLabel: "" });

/** Faculty builder: pick a published case, let the AI guide propose encounters, edit them, save or publish. */
export default function JourneyBuilder({ cases, clinicians, professions, initial }: Props) {
  const router = useRouter();
  const [caseId, setCaseId] = useState(initial?.caseId || cases[0]?.id || "");
  const [title, setTitle] = useState(initial?.title || "");
  const [summary, setSummary] = useState(initial?.summary || "");
  const [stages, setStages] = useState<Stage[]>(initial?.stages || []);
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState("");

  const set = (i: number, patch: Partial<Stage>) => setStages((s) => s.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const move = (i: number, d: number) =>
    setStages((s) => {
      const out = [...s];
      const j = i + d;
      if (j < 0 || j >= out.length) return s;
      [out[i], out[j]] = [out[j], out[i]];
      return out.map((x, k) => ({ ...x, order: k + 1 }));
    });

  async function propose() {
    setBusy("propose");
    setErr("");
    const r = await post<{ title: string; summary: string; stages: Stage[] }>("/api/journeys/propose", { caseId, brief });
    setBusy("");
    if (r.error) return setErr(r.error);
    setStages(r.stages || []);
    if (!title) setTitle(r.title || "");
    if (!summary) setSummary(r.summary || "");
  }

  async function save(publish: boolean) {
    setBusy(publish ? "publish" : "save");
    setErr("");
    setSaved("");
    const body = { title, summary, caseId, stages: stages.map((s, i) => ({ ...s, order: i + 1 })) };
    if (initial) {
      const res = await fetch(`/api/journeys/${initial.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, status: publish ? "published" : initial.status === "published" ? "published" : "draft" }) });
      const r = await res.json().catch(() => ({ error: "Could not save." }));
      setBusy("");
      if (r.error) return setErr(r.error);
      setSaved(publish ? "Published." : "Saved.");
      router.refresh();
    } else {
      const r = await post<{ id: string }>("/api/journeys", { ...body, publish });
      setBusy("");
      if (r.error || !r.id) return setErr(r.error || "Could not save.");
      router.push(`/faculty/journeys/${r.id}`);
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="1. Patient case" subtitle="A journey reuses one published case for every encounter, so the patient, the facts they can disclose and the approved results stay the same throughout." />
        <div className="grid gap-4 p-4 md:grid-cols-2">
          <div>
            <Label>Published case</Label>
            <Select value={caseId} onChange={(e) => setCaseId(e.target.value)} disabled={!!initial}>
              {cases.map((c) => <option key={c.id} value={c.id}>{c.patient}: {c.title}</option>)}
            </Select>
          </div>
          <div>
            <Label>Anything the guide should aim for (optional)</Label>
            <Input value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="e.g. include pharmacy; end with dietetics; four encounters" />
          </div>
          <div className="flex items-center gap-3 md:col-span-2">
            <Button variant="secondary" onClick={propose} disabled={!caseId || !!busy}>{stages.length ? "Ask the guide for a new proposal" : "Ask the guide to propose encounters"}</Button>
            {busy === "propose" && <Spinner label="Reading the case and the clinician personas" />}
            <button onClick={() => setStages((s) => [...s, blank(s.length, clinicians[0]?.id || "")])} className="text-sm font-medium text-brand-700 hover:underline">Add an encounter by hand</button>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="2. Encounters, in order" subtitle="At least three. A student joins as one of these professionals; the AI plays the persona you choose for every other one. The focus is shown to the student and steers the AI colleague, so do not put findings in it that the patient has not disclosed." />
        <div className="space-y-3 p-4">
          {!stages.length && <p className="text-sm text-slate-500">No encounters yet. Ask the guide for a proposal or add one by hand.</p>}
          {stages.map((s, i) => (
            <div key={i} className="rounded-lg border border-slate-200 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-800">Encounter {i + 1}</span>
                <span className="flex gap-1 text-xs">
                  <button onClick={() => move(i, -1)} disabled={i === 0} className="rounded px-2 py-0.5 text-slate-600 hover:bg-slate-100 disabled:text-slate-300">Move up</button>
                  <button onClick={() => move(i, 1)} disabled={i === stages.length - 1} className="rounded px-2 py-0.5 text-slate-600 hover:bg-slate-100 disabled:text-slate-300">Move down</button>
                  <button onClick={() => setStages((x) => x.filter((_, k) => k !== i).map((y, k) => ({ ...y, order: k + 1 })))} className="rounded px-2 py-0.5 text-rose-700 hover:bg-rose-50">Remove</button>
                </span>
              </div>
              <div className="grid gap-3 md:grid-cols-4">
                <div>
                  <Label>Role title</Label>
                  <Input value={s.roleTitle} onChange={(e) => set(i, { roleTitle: e.target.value })} placeholder="Clinical pharmacist" />
                </div>
                <div>
                  <Label>Role in the catalog</Label>
                  <Select value={professions.some((p) => p.id === s.professionId) ? s.professionId : ""} onChange={(e) => set(i, { professionId: e.target.value })}>
                    <option value="">{s.professionId && !professions.some((p) => p.id === s.professionId) ? `${s.professionId} (closest match is used)` : "Choose"}</option>
                    {professions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </Select>
                </div>
                <div>
                  <Label>AI persona when no student takes it</Label>
                  <Select value={s.clinicianId} onChange={(e) => set(i, { clinicianId: e.target.value })}>
                    {clinicians.map((c) => <option key={c.id} value={c.id}>{c.name}, {c.role}</option>)}
                  </Select>
                </div>
                <div>
                  <Label>Simulated time</Label>
                  <Input value={s.simTime} onChange={(e) => set(i, { simTime: e.target.value })} placeholder="Week 1, Mon 10:30" />
                </div>
                <div className="md:col-span-3">
                  <Label>Focus: what this professional is there to do</Label>
                  <Textarea rows={2} value={s.focus} onChange={(e) => set(i, { focus: e.target.value })} />
                </div>
                <div>
                  <Label>Kind of contact</Label>
                  <Input value={s.visitLabel || ""} onChange={(e) => set(i, { visitLabel: e.target.value })} placeholder="video follow-up" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader title="3. Name and publish" />
        <div className="space-y-3 p-4">
          <div>
            <Label>Journey title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <Label>Summary shown to students before they choose a role</Label>
            <Textarea rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => save(true)} disabled={!!busy || !title.trim() || stages.length < 3}>{initial?.status === "published" ? "Save changes" : "Publish to students"}</Button>
            {initial?.status !== "published" && <Button variant="secondary" onClick={() => save(false)} disabled={!!busy || !title.trim()}>Save as draft</Button>}
            {stages.length < 3 && <span className="text-xs text-slate-500">Add at least three encounters to publish.</span>}
            {(busy === "save" || busy === "publish") && <Spinner label="Saving" />}
            {saved && <span className="text-sm text-emerald-700">{saved}</span>}
            {err && <span className="text-sm text-rose-700">{err}</span>}
          </div>
        </div>
      </Card>
    </div>
  );
}
