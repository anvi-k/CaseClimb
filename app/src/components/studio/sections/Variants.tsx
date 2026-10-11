"use client";

import { useEffect, useRef, useState } from "react";
import { Badge, Button, cx, Input, Select } from "@/components/ui";
import type { CaseProfile, ClinicalAction, Fact, Persona, Tier, Variant } from "@/lib/types";
import { TIERS, tierLabel } from "@/lib/studio/profile";
import { api, Area, Field, Notice, Panel, RemoveButton, StringList, Text } from "../fields";
import type { SectionProps } from "./types";

const PERSONA_FIELDS: { key: "personality" | "communicationStyle" | "emotionalState"; label: string }[] = [
  { key: "personality", label: "Personality" },
  { key: "communicationStyle", label: "Communication style" },
  { key: "emotionalState", label: "Emotional state" },
];

function Base({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1 rounded bg-slate-50 px-2 py-1 text-xs leading-snug text-slate-500">
      <span className="font-medium text-slate-600">Base case: </span>
      {children}
    </p>
  );
}

function VariantCard({ v, p, up, remove }: { v: Variant; p: CaseProfile; up: (patch: Partial<Variant>, drop?: (keyof Variant)[]) => void; remove: () => void }) {
  const [open, setOpen] = useState(!v.approved);
  const persona = v.persona || {};
  const setPersona = (patch: Partial<Persona>) => up({ persona: { ...persona, ...patch } });
  const dropPersona = (key: keyof Persona) => {
    const next = { ...persona };
    delete next[key];
    if (Object.keys(next).length) up({ persona: next });
    else up({}, ["persona"]);
  };
  const fo = v.factOverrides || {};
  const ao = v.actionOverrides || {};
  const setFact = (id: string, patch: Partial<Fact> | null) => {
    const next = { ...fo };
    if (patch) next[id] = { ...next[id], ...patch };
    else delete next[id];
    if (Object.keys(next).length) up({ factOverrides: next });
    else up({}, ["factOverrides"]);
  };
  const setAction = (id: string, patch: Partial<ClinicalAction> | null) => {
    const next = { ...ao };
    if (patch) next[id] = { ...next[id], ...patch };
    else delete next[id];
    if (Object.keys(next).length) up({ actionOverrides: next });
    else up({}, ["actionOverrides"]);
  };
  const nP = Object.keys(persona).length;
  const nF = Object.keys(fo).length;
  const nA = Object.keys(ao).length;
  const unusedFacts = p.facts.filter((f) => !(f.id in fo));
  return (
    <div className={cx("rounded-md border", v.approved ? "border-emerald-200" : "border-amber-300")}>
      <div className="flex flex-wrap items-start justify-between gap-2 px-3 py-2.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            {v.approved ? <Badge tone="green">Approved for students</Badge> : <Badge tone="amber">AI draft, not approved</Badge>}
            <span className="text-sm font-semibold text-slate-900">{v.label || "Untitled variant"}</span>
          </div>
          <p className="mt-0.5 text-xs text-slate-600">{v.description}</p>
          <p className="mt-0.5 text-[12px] text-slate-400">
            Changes {nP} persona field{nP === 1 ? "" : "s"}, {nF} fact{nF === 1 ? "" : "s"}, {nA} result{nA === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button variant="ghost" size="sm" onClick={() => setOpen(!open)}>
            {open ? "Collapse" : "Review"}
          </Button>
          {v.approved ? (
            <Button variant="secondary" size="sm" onClick={() => up({ approved: false })}>
              Withdraw approval
            </Button>
          ) : (
            <Button size="sm" onClick={() => up({ approved: true })}>
              Approve
            </Button>
          )}
        </div>
      </div>
      {open && (
        <div className="space-y-4 border-t border-slate-100 px-3 py-3">
          <div className="grid gap-3 sm:grid-cols-[14rem_1fr]">
            <Text label="Label" value={v.label} onChange={(x) => up({ label: x })} />
            <Area label="What is different" minRows={1} value={v.description} onChange={(x) => up({ description: x })} />
          </div>

          {nP > 0 && (
            <div>
              <h4 className="mb-1.5 text-xs font-semibold text-slate-700">Persona changes</h4>
              <div className="space-y-3">
                {PERSONA_FIELDS.filter((f) => persona[f.key] !== undefined).map((f) => (
                  <div key={f.key}>
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-slate-600">{f.label}</label>
                      <RemoveButton label="Keep base" onClick={() => dropPersona(f.key)} />
                    </div>
                    <Base>{p.persona[f.key]}</Base>
                    <Area dense value={persona[f.key] || ""} onChange={(x) => setPersona({ [f.key]: x })} />
                  </div>
                ))}
                {persona.healthLiteracy !== undefined && (
                  <div className="flex items-end gap-2">
                    <Field label={`Health literacy (base case: ${p.persona.healthLiteracy})`}>
                      <Select value={persona.healthLiteracy} onChange={(e) => setPersona({ healthLiteracy: e.target.value as Persona["healthLiteracy"] })}>
                        <option value="low">Low</option>
                        <option value="moderate">Moderate</option>
                        <option value="high">High</option>
                      </Select>
                    </Field>
                    <RemoveButton label="Keep base" onClick={() => dropPersona("healthLiteracy")} />
                  </div>
                )}
                {(["speechExamples", "concerns"] as const)
                  .filter((k) => persona[k] !== undefined)
                  .map((k) => (
                    <div key={k}>
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-medium text-slate-600">{k === "speechExamples" ? "Speech examples" : "Concerns"}</label>
                        <RemoveButton label="Keep base" onClick={() => dropPersona(k)} />
                      </div>
                      <Base>{p.persona[k].join(" / ")}</Base>
                      <StringList items={persona[k] || []} onChange={(x) => setPersona({ [k]: x })} />
                    </div>
                  ))}
              </div>
            </div>
          )}

          <div>
            <h4 className="mb-1.5 text-xs font-semibold text-slate-700">Fact changes</h4>
            {!nF && <p className="text-xs text-slate-500">All facts are the same as the base case.</p>}
            <div className="space-y-3">
              {Object.entries(fo).map(([id, o]) => {
                const base = p.facts.find((f) => f.id === id);
                if (!base) return <Notice key={id} tone="amber">Fact {id} no longer exists. <button className="underline" onClick={() => setFact(id, null)}>Remove this change</button></Notice>;
                return (
                  <div key={id} className="rounded border border-slate-200 p-2">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-xs font-medium text-slate-700">
                        <span className="font-mono text-[11px] text-slate-400">{id}</span> {base.topic}
                      </span>
                      <RemoveButton label="Keep base" onClick={() => setFact(id, null)} />
                    </div>
                    <div className="grid gap-2 lg:grid-cols-2">
                      <div>
                        <Base>{base.chart}</Base>
                        <Area dense label="Chart wording in this variant" value={o.chart ?? base.chart} onChange={(x) => setFact(id, { chart: x })} />
                      </div>
                      <div>
                        <Base>&ldquo;{base.says}&rdquo;</Base>
                        <Area dense label="Patient wording in this variant" value={o.says ?? base.says} onChange={(x) => setFact(id, { says: x })} />
                      </div>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2 text-xs text-slate-600">
                      Tier (base: {tierLabel(base.tier)})
                      <select className="rounded border border-slate-300 px-1.5 py-1 text-xs" value={o.tier ?? base.tier} onChange={(e) => setFact(id, { tier: e.target.value as Tier })}>
                        {TIERS.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                );
              })}
            </div>
            {unusedFacts.length > 0 && (
              <select className="mt-2 rounded border border-slate-300 bg-white px-1.5 py-1 text-xs text-slate-700" value="" aria-label="Change another fact" onChange={(e) => e.target.value && setFact(e.target.value, { says: p.facts.find((f) => f.id === e.target.value)!.says })}>
                <option value="">+ Change another fact in this variant...</option>
                {unusedFacts.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.id} · {f.topic}
                  </option>
                ))}
              </select>
            )}
          </div>

          {nA > 0 && (
            <div>
              <h4 className="mb-1.5 text-xs font-semibold text-slate-700">Result changes</h4>
              <div className="space-y-3">
                {Object.entries(ao).map(([id, o]) => {
                  const base = p.actions.find((a) => a.id === id);
                  if (!base) return null;
                  return (
                    <div key={id} className="rounded border border-slate-200 p-2">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-xs font-medium text-slate-700">
                          <span className="font-mono text-[11px] text-slate-400">{id}</span> {base.name}
                        </span>
                        <RemoveButton label="Keep base" onClick={() => setAction(id, null)} />
                      </div>
                      <Base>{base.result}</Base>
                      <Area dense value={o.result ?? base.result} onChange={(x) => setAction(id, { result: x })} />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between border-t border-slate-100 pt-2">
            <p className="text-xs text-slate-500">Documents, the answer key and objectives are shared with the base case and cannot differ in a variant.</p>
            <Button variant="ghost" size="sm" className="text-rose-700" onClick={() => window.confirm(`Delete the variant "${v.label}"?`) && remove()}>
              Delete variant
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function VariantsSection({ p, set, profileNow, caseId }: SectionProps & { profileNow: () => CaseProfile; caseId: string }) {
  const variants = p.variants || [];
  const [focus, setFocus] = useState("persona");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [secs, setSecs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => void (timer.current && clearInterval(timer.current)), []);

  const up = (id: string, patch: Partial<Variant>, drop: (keyof Variant)[] = []) =>
    set((c) => ({
      ...c,
      variants: (c.variants || []).map((v) => {
        if (v.id !== id) return v;
        const next = { ...v, ...patch };
        for (const k of drop) delete next[k];
        return next;
      }),
    }));
  async function draft() {
    setBusy(true);
    setError(null);
    setSecs(0);
    const t0 = Date.now();
    timer.current = setInterval(() => setSecs(Math.round((Date.now() - t0) / 1000)), 1000);
    try {
      const { variant } = await api<{ variant: Variant }>(`/api/cases/${caseId}/variants`, { json: { focus, note, profile: profileNow() } });
      // Added as a draft: the visit engine ignores variants until approved is true.
      set((c) => {
        const taken = new Set((c.variants || []).map((v) => v.id));
        let id = variant.id;
        for (let n = (c.variants || []).length + 1; taken.has(id); n++) id = `v${n}`;
        return { ...c, variants: [...(c.variants || []), { ...variant, id, approved: false }] };
      });
      setNote("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (timer.current) clearInterval(timer.current);
      setBusy(false);
    }
  }
  const blank = () =>
    set((c) => {
      const taken = new Set((c.variants || []).map((v) => v.id));
      let n = (c.variants || []).length + 1;
      while (taken.has(`v${n}`)) n++;
      return { ...c, variants: [...(c.variants || []), { id: `v${n}`, label: "New variant", description: "", approved: false }] };
    });

  return (
    <Panel
      title={`Variants (${variants.filter((v) => v.approved).length} approved, ${variants.filter((v) => !v.approved).length} awaiting review)`}
      subtitle="Alternate versions of this patient for repeat practice, so a second attempt cannot be passed from memory. A variant changes how the patient behaves, some of what they say, or both, on top of the base case. The guide drafts them; a student can only be given a variant after you approve it here."
    >
      <div className="mb-4 rounded-md border border-slate-200 bg-slate-50 p-3">
        <div className="grid gap-3 sm:grid-cols-[15rem_1fr_auto] sm:items-end">
          <Field label="What should differ?">
            <Select value={focus} onChange={(e) => setFocus(e.target.value)} disabled={busy}>
              <option value="persona">Persona: how the patient behaves</option>
              <option value="clinical">Clinical details: what the patient reports</option>
              <option value="both">Both</option>
            </Select>
          </Field>
          <Field label="Note to the guide (optional)">
            <Input value={note} disabled={busy} onChange={(e) => setNote(e.target.value)} placeholder="e.g. anxious and talkative; or: make the alcohol history harder to elicit" />
          </Field>
          <Button disabled={busy} onClick={draft}>
            {busy ? `Drafting... ${secs}s` : "Draft a variant"}
          </Button>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          {busy ? "The guide is reading the whole case so the variant stays consistent with the documents and the answer key. This usually takes 20 to 60 seconds." : "Drafting usually takes 20 to 60 seconds. The draft appears below as unapproved."}{" "}
          {!busy && (
            <button type="button" className="text-brand-700 underline" onClick={blank}>
              Or write one by hand
            </button>
          )}
        </p>
        {error && (
          <Notice tone="red" className="mt-2">
            {error}
          </Notice>
        )}
      </div>
      {!variants.length && <p className="text-sm text-slate-500">No variants yet. Students who repeat this patient get the base case, with small changes in mood if the assignment allows it.</p>}
      <div className="space-y-3">
        {variants.map((v) => (
          <VariantCard key={v.id} v={v} p={p} up={(patch, drop) => up(v.id, patch, drop)} remove={() => set((c) => ({ ...c, variants: (c.variants || []).filter((x) => x.id !== v.id) }))} />
        ))}
      </div>
    </Panel>
  );
}
