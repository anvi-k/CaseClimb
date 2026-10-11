"use client";

import { memo, useCallback, useMemo, useState } from "react";
import { Badge, Button, cx, Input, Select } from "@/components/ui";
import { FACT_CATEGORIES } from "@/lib/types";
import type { CaseProfile, Fact, Importance, Tier } from "@/lib/types";
import { deleteFact, IMPORTANCE, nextId, TIERS } from "@/lib/studio/profile";
import { Area, Panel, RemoveButton } from "../fields";
import type { SectionProps } from "./types";

const TIER_TONE: Record<Tier, string> = {
  initial: "border-emerald-200 bg-emerald-50",
  discoverable: "border-sky-200 bg-sky-50",
  reluctant: "border-amber-200 bg-amber-50",
  hidden: "border-rose-200 bg-rose-50",
};
const SMALL = "w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-xs text-slate-800 focus:border-brand-500 focus:outline-none";

function usesOf(p: CaseProfile, id: string): string[] {
  const out: string[] = [];
  const o = p.objectives.filter((x) => x.factIds.includes(id)).length;
  if (o) out.push(`${o} objective${o === 1 ? "" : "s"}`);
  const d = p.artifacts.filter((x) => x.release.when === "fact" && x.release.ref === id);
  if (d.length) out.push(`the release of ${d.map((x) => `"${x.title}"`).join(", ")}`);
  const m = (p.mismatches || []).filter((x) => x.factId === id).length;
  if (m) out.push(`${m} patient-vs-chart mismatch${m === 1 ? "" : "es"}`);
  return out;
}

const FactRow = memo(function FactRow({ f, uses, onChange, onDelete }: { f: Fact; uses: string; onChange: (id: string, patch: Partial<Fact>) => void; onDelete: (id: string, uses: string) => void }) {
  return (
    <tr className="border-b border-slate-100 align-top" id={`fact-${f.id}`}>
      <td className="py-2 pl-3 pr-2">
        <div className="font-mono text-[14px] text-slate-400">{f.id}</div>
        <select className={cx(SMALL, "mt-1")} value={f.category} aria-label="Category" onChange={(e) => onChange(f.id, { category: e.target.value })}>
          {Object.entries(FACT_CATEGORIES).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <input className={cx(SMALL, "mt-1")} value={f.topic} placeholder="Topic label" aria-label="Topic" onChange={(e) => onChange(f.id, { topic: e.target.value })} />
      </td>
      <td className="px-2 py-2">
        <Area dense minRows={2} value={f.chart} placeholder="Clinician wording written to the chart" aria-label="Chart wording" onChange={(v) => onChange(f.id, { chart: v })} />
      </td>
      <td className="px-2 py-2">
        <Area dense minRows={2} value={f.says} placeholder="How the patient says it" aria-label="Patient wording" onChange={(v) => onChange(f.id, { says: v })} />
      </td>
      <td className="px-2 py-2">
        <select className={cx(SMALL, TIER_TONE[f.tier])} value={f.tier} aria-label="Disclosure tier" onChange={(e) => onChange(f.id, { tier: e.target.value as Tier })}>
          {TIERS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        <select className={cx(SMALL, "mt-1")} value={f.importance} aria-label="Importance" onChange={(e) => onChange(f.id, { importance: e.target.value as Importance })}>
          {IMPORTANCE.map((i) => (
            <option key={i} value={i}>
              {i[0].toUpperCase() + i.slice(1)}
            </option>
          ))}
        </select>
        <label className="mt-1 flex items-center gap-1 text-[14px] text-slate-600" title="A plausible red herring that is not relevant to the main problem. Only used at higher difficulty.">
          <input type="checkbox" checked={!!f.distractor} onChange={(e) => onChange(f.id, { distractor: e.target.checked })} />
          Distractor
        </label>
      </td>
      <td className="py-2 pr-2 text-right">
        <RemoveButton onClick={() => onDelete(f.id, uses)} />
      </td>
    </tr>
  );
});

export function FactsSection({ p, set }: SectionProps) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [tier, setTier] = useState("");

  const onChange = useCallback(
    (id: string, patch: Partial<Fact>) =>
      set((c) => ({
        ...c,
        facts: c.facts.map((f) => {
          if (f.id !== id) return f;
          const next = { ...f, ...patch };
          if (!next.distractor) delete next.distractor;
          return next;
        }),
      })),
    [set],
  );
  const onDelete = useCallback(
    (id: string, uses: string) => {
      if (uses && !window.confirm(`Fact ${id} is used by ${uses}. Deleting it also removes those links. Delete it?`)) return;
      set((c) => deleteFact(c, id));
    },
    [set],
  );
  const add = () => {
    set((c) => {
      const id = nextId(c.facts, "f");
      return { ...c, facts: [...c.facts, { id, category: cat || "hpi", topic: "", chart: "", says: "", tier: (tier as Tier) || "discoverable", importance: "important" }] };
    });
    setQ("");
    setTimeout(() => document.querySelector("#facts-table tbody tr:last-child input")?.scrollIntoView({ block: "center", behavior: "smooth" }), 50);
  };

  const counts = useMemo(() => Object.fromEntries(TIERS.map((t) => [t.id, p.facts.filter((f) => f.tier === t.id).length])), [p.facts]);
  const needle = q.trim().toLowerCase();
  const shown = p.facts.filter((f) => (!cat || f.category === cat) && (!tier || f.tier === tier) && (!needle || `${f.id} ${f.topic} ${f.chart} ${f.says}`.toLowerCase().includes(needle)));
  const usedCats = Object.keys(FACT_CATEGORIES).filter((k) => p.facts.some((f) => f.category === k));

  return (
    <div className="space-y-4">
      <Panel
        title="How disclosure works"
        subtitle="Each fact is one piece of information the patient can give. The patient can only state what is listed here, and the tier decides when. A fact is written to the student's chart, in the chart wording, at the moment it is disclosed."
      >
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {TIERS.map((t, i) => (
            <button key={t.id} type="button" onClick={() => setTier(tier === t.id ? "" : t.id)} className={cx("rounded-md border p-2.5 text-left", TIER_TONE[t.id], tier === t.id && "ring-2 ring-brand-500")}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-900">
                  {i + 1}. {t.label}
                </span>
                <span className="text-xs text-slate-600">{counts[t.id]} facts</span>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-slate-700">{t.rule}</p>
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-slate-500">
          Rapport rises when the student is empathic, explains why they are asking and avoids judgment. Higher difficulty levels raise the rapport needed for the last two tiers. Importance drives feedback: missed critical facts are listed first.
          Distractors are plausible but irrelevant findings, used only at higher difficulty.
        </p>
      </Panel>

      <Panel
        title={`Facts (${p.facts.length})`}
        subtitle="Topic is a neutral label such as 'alcohol use'. It tells the engine what a question is about, so it must not contain the answer."
        action={
          <Button size="sm" onClick={add}>
            Add fact
          </Button>
        }
      >
        <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search facts" aria-label="Search facts" />
          <Select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Filter by category" className="sm:w-56">
            <option value="">All categories</option>
            {usedCats.map((k) => (
              <option key={k} value={k}>
                {FACT_CATEGORIES[k]} ({p.facts.filter((f) => f.category === k).length})
              </option>
            ))}
          </Select>
          <Select value={tier} onChange={(e) => setTier(e.target.value)} aria-label="Filter by tier" className="sm:w-44">
            <option value="">All tiers</option>
            {TIERS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label} ({counts[t.id]})
              </option>
            ))}
          </Select>
        </div>
        <div className="-mx-4 overflow-x-auto">
          <table id="facts-table" className="w-full min-w-[760px] table-fixed border-collapse text-left">
            <colgroup>
              <col className="w-[180px]" />
              <col />
              <col />
              <col className="w-[128px]" />
              <col className="w-[56px]" />
            </colgroup>
            <thead>
              <tr className="border-y border-slate-200 bg-slate-50 text-xs text-slate-500">
                <th className="py-1.5 pl-3 pr-2 font-medium">Category and topic</th>
                <th className="px-2 py-1.5 font-medium">Chart wording</th>
                <th className="px-2 py-1.5 font-medium">Patient wording</th>
                <th className="px-2 py-1.5 font-medium">Tier, importance</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((f) => (
                <FactRow key={f.id} f={f} uses={usesOf(p, f.id).join(" and ")} onChange={onChange} onDelete={onDelete} />
              ))}
            </tbody>
          </table>
        </div>
        {!shown.length && <p className="py-6 text-center text-sm text-slate-500">No facts match these filters.</p>}
        {shown.length !== p.facts.length && (
          <p className="mt-2 text-xs text-slate-500">
            Showing {shown.length} of {p.facts.length}.{" "}
            <button
              type="button"
              className="text-brand-700 underline"
              onClick={() => {
                setQ("");
                setCat("");
                setTier("");
              }}
            >
              Show all
            </button>
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-1.5 text-xs text-slate-500">
          <Badge tone="red">{p.facts.filter((f) => f.importance === "critical").length} critical</Badge>
          <Badge tone="amber">{p.facts.filter((f) => f.importance === "important").length} important</Badge>
          <Badge>{p.facts.filter((f) => f.importance === "minor").length} minor</Badge>
          <Badge tone="violet">{p.facts.filter((f) => f.distractor).length} distractors</Badge>
        </div>
      </Panel>
    </div>
  );
}
