"use client";

import { useState } from "react";
import { Badge, Button, cx, Input, Select } from "@/components/ui";
import type { ChecklistItem, Rubric, RubricDomain } from "@/lib/types";
import { api, Area, Field, Notice, Panel, RemoveButton, Text } from "../fields";
import type { SectionProps } from "./types";

export type RubricOption = Rubric & { custom?: boolean; mine?: boolean };

type Draft = { id?: string; name: string; type: "domain4" | "checklist"; instructions: string; domains: RubricDomain[]; items: ChecklistItem[] };
const emptyDomain = (): RubricDomain => ({ key: "", name: "", descriptors: { "4": "", "3": "", "2": "", "1": "" }, reviewIfOne: false });
const emptyItem = (section = ""): ChecklistItem => ({ key: "", section, text: "", points: 5 });
const LEVELS: [string, string][] = [
  ["4", "4 - Strong"],
  ["3", "3 - Competent"],
  ["2", "2 - Developing"],
  ["1", "1 - Unsafe or absent"],
];

function Builder({ initial, onSaved, onCancel }: { initial: Draft; onSaved: (r: RubricOption) => void; onCancel: () => void }) {
  const [d, setD] = useState<Draft>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const total = d.items.reduce((n, it) => n + (Number(it.points) || 0), 0);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      const body = { name: d.name, type: d.type, instructions: d.instructions, ...(d.type === "checklist" ? { items: d.items } : { domains: d.domains }) };
      const r = await api<{ rubric: RubricOption }>(d.id ? `/api/rubrics/${d.id}` : "/api/rubrics", { method: d.id ? "PUT" : "POST", json: body });
      onSaved(r.rubric);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="rounded-md border border-brand-200 bg-brand-50/40 p-4">
      <h3 className="text-sm font-semibold text-slate-900">{d.id ? "Edit rubric" : "New rubric"}</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_18rem]">
        <Text label="Name" value={d.name} onChange={(v) => setD({ ...d, name: v })} placeholder="e.g. Heart failure telehealth check-in" />
        <Field label="Format">
          <Select value={d.type} disabled={!!d.id} onChange={(e) => setD({ ...d, type: e.target.value as Draft["type"] })}>
            <option value="domain4">Domains rated 1 to 4</option>
            <option value="checklist">Points checklist</option>
          </Select>
        </Field>
        <Area className="sm:col-span-2" label="Instructions to the rater (optional)" minRows={1} value={d.instructions} onChange={(v) => setD({ ...d, instructions: v })} placeholder="e.g. Rate only what the scenario makes possible to observe." />
      </div>

      {d.type === "domain4" ? (
        <div className="mt-4 space-y-3">
          <p className="text-xs text-slate-600">Each domain gets a score from 1 to 4. Describe what each score looks like; scores 4 and 1 are required, and the more specific the descriptions, the more consistent the scoring.</p>
          {d.domains.map((dom, i) => {
            const up = (patch: Partial<RubricDomain>) => setD({ ...d, domains: d.domains.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
            return (
              <div key={i} className="rounded-md border border-slate-200 bg-white p-3">
                <div className="flex items-start gap-2">
                  <Input value={dom.name} placeholder="Domain name, e.g. Medication adherence history" aria-label="Domain name" onChange={(e) => up({ name: e.target.value })} />
                  <RemoveButton onClick={() => setD({ ...d, domains: d.domains.filter((_, j) => j !== i) })} />
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {LEVELS.map(([k, label]) => (
                    <Area key={k} dense minRows={2} label={label} value={dom.descriptors[k] || ""} onChange={(v) => up({ descriptors: { ...dom.descriptors, [k]: v } })} />
                  ))}
                </div>
                <label className="mt-2 flex items-center gap-1.5 text-xs text-slate-700">
                  <input type="checkbox" checked={!!dom.reviewIfOne} onChange={(e) => up({ reviewIfOne: e.target.checked })} />
                  Flag the visit for faculty review when this domain scores 1
                </label>
              </div>
            );
          })}
          <Button variant="secondary" size="sm" onClick={() => setD({ ...d, domains: [...d.domains, emptyDomain()] })}>
            + Add domain
          </Button>
        </div>
      ) : (
        <div className="mt-4">
          <p className="mb-2 text-xs text-slate-600">Each item is awarded its points when the transcript shows the student did it. Items with the same section name are grouped.</p>
          <div className="space-y-1.5">
            {d.items.map((it, i) => {
              const up = (patch: Partial<ChecklistItem>) => setD({ ...d, items: d.items.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
              return (
                <div key={i} className="grid gap-1.5 sm:grid-cols-[12rem_1fr_5rem_auto]">
                  <Input value={it.section} placeholder="Section" aria-label="Section" onChange={(e) => up({ section: e.target.value })} />
                  <Input value={it.text} placeholder="What the student should do" aria-label="Item" onChange={(e) => up({ text: e.target.value })} />
                  <Input type="number" min={0} value={it.points} aria-label="Points" onChange={(e) => up({ points: Number(e.target.value) })} />
                  <RemoveButton onClick={() => setD({ ...d, items: d.items.filter((_, j) => j !== i) })} />
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex items-center gap-3">
            <Button variant="secondary" size="sm" onClick={() => setD({ ...d, items: [...d.items, emptyItem(d.items[d.items.length - 1]?.section)] })}>
              + Add item
            </Button>
            <span className="text-xs text-slate-600">Total: {total} points</span>
          </div>
        </div>
      )}
      {error && (
        <Notice tone="red" className="mt-3">
          {error}
        </Notice>
      )}
      <div className="mt-4 flex gap-2">
        <Button disabled={busy} onClick={save}>
          {busy ? "Saving..." : d.id ? "Save rubric" : "Save rubric and use it for this patient"}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function RubricPreview({ r }: { r: RubricOption }) {
  if (r.type === "checklist") {
    const sections = Array.from(new Set((r.items || []).map((i) => i.section)));
    return (
      <div className="space-y-2 text-sm">
        {sections.map((s) => (
          <div key={s}>
            <p className="text-xs font-semibold text-slate-600">{s}</p>
            <ul>
              {(r.items || [])
                .filter((i) => i.section === s)
                .map((i) => (
                  <li key={i.key} className="flex justify-between gap-3 border-b border-slate-100 py-1 text-slate-800">
                    <span>{i.text}</span>
                    <span className="shrink-0 text-xs text-slate-500">{i.points} pts</span>
                  </li>
                ))}
            </ul>
          </div>
        ))}
        <p className="text-xs text-slate-500">Total {(r.items || []).reduce((n, i) => n + i.points, 0)} points</p>
      </div>
    );
  }
  return (
    <ul className="space-y-1.5 text-sm">
      {(r.domains || []).map((d) => (
        <li key={d.key} className="border-b border-slate-100 pb-1.5">
          <details>
            <summary className="cursor-pointer text-slate-800">
              {d.name} {d.reviewIfOne && <Badge tone="amber">score of 1 triggers review</Badge>}
            </summary>
            <dl className="mt-1 space-y-1 pl-4 text-xs text-slate-600">
              {["4", "3", "2", "1"].filter((k) => d.descriptors[k]).map((k) => (
                <div key={k} className="flex gap-2">
                  <dt className="w-3 shrink-0 font-semibold">{k}</dt>
                  <dd>{d.descriptors[k]}</dd>
                </div>
              ))}
            </dl>
          </details>
        </li>
      ))}
    </ul>
  );
}

export function RubricSection({ p, set, rubrics, setRubrics }: SectionProps & { rubrics: RubricOption[]; setRubrics: (r: RubricOption[]) => void }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = rubrics.find((r) => r.id === p.rubricId);
  const choose = (id: string) => set((c) => ({ ...c, rubricId: id }));
  async function remove(r: RubricOption) {
    if (!window.confirm(`Delete the rubric "${r.name}"?`)) return;
    setError(null);
    try {
      await api(`/api/rubrics/${r.id}`, { method: "DELETE" });
      setRubrics(rubrics.filter((x) => x.id !== r.id));
      if (p.rubricId === r.id) choose("default");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Panel
      title="Rubric"
      subtitle="The rubric used to score visits with this patient. Every score is tied to quoted transcript evidence. Choose a built-in rubric or build your own; custom rubrics are saved to your account and can be reused on other patients."
      action={
        !draft && (
          <Button size="sm" onClick={() => setDraft({ name: "", type: "domain4", instructions: "", domains: [emptyDomain()], items: [emptyItem("General")] })}>
            Build a custom rubric
          </Button>
        )
      }
    >
      {error && (
        <Notice tone="red" className="mb-3">
          {error}
        </Notice>
      )}
      {draft ? (
        <Builder
          initial={draft}
          onCancel={() => setDraft(null)}
          onSaved={(r) => {
            setRubrics(rubrics.some((x) => x.id === r.id) ? rubrics.map((x) => (x.id === r.id ? r : x)) : [...rubrics, r]);
            choose(r.id);
            setDraft(null);
          }}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
          <ul className="space-y-1.5">
            {rubrics.map((r) => (
              <li key={r.id}>
                <label className={cx("flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2", r.id === p.rubricId ? "border-brand-600 bg-brand-50" : "border-slate-200 hover:bg-slate-50")}>
                  <input type="radio" name="rubric" className="mt-1" checked={r.id === p.rubricId} onChange={() => choose(r.id)} />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-slate-900">{r.name}</span>
                    <span className="block text-xs text-slate-500">
                      {r.type === "domain4" ? `${r.domains?.length || 0} domains, rated 1 to 4` : `${r.items?.length || 0} checklist items, ${(r.items || []).reduce((n, i) => n + i.points, 0)} points`} · {r.custom ? (r.mine ? "yours" : "custom") : "built in"}
                    </span>
                  </span>
                </label>
              </li>
            ))}
            {!current && <Notice tone="amber">The rubric saved on this patient no longer exists. Choose one.</Notice>}
          </ul>
          {current && (
            <div className="min-w-0 rounded-md border border-slate-200 p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900">{current.name}</h3>
                {current.mine && (
                  <span className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setDraft({ id: current.id, name: current.name, type: current.type, instructions: current.instructions || "", domains: current.domains?.length ? current.domains : [emptyDomain()], items: current.items?.length ? current.items : [emptyItem("General")] })
                      }
                    >
                      Edit
                    </Button>
                    <Button variant="ghost" size="sm" className="text-rose-700" onClick={() => remove(current)}>
                      Delete
                    </Button>
                  </span>
                )}
              </div>
              {current.instructions && <p className="mb-2 text-xs text-slate-600">{current.instructions}</p>}
              <RubricPreview r={current} />
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
