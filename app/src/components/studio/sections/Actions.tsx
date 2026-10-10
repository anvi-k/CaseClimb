"use client";

import { Button, cx, Input, Select } from "@/components/ui";
import type { ActionKind, ClinicalAction, Importance } from "@/lib/types";
import { ACTION_KINDS, deleteAction, IMPORTANCE, nextId, setRelease } from "@/lib/studio/profile";
import { Area, Field, Panel, RemoveButton } from "../fields";
import type { SectionProps } from "./types";

export function ActionsSection({ p, set, go }: SectionProps) {
  const up = (id: string, patch: Partial<ClinicalAction>) =>
    set((c) => ({
      ...c,
      actions: c.actions.map((a) => {
        if (a.id !== id) return a;
        const next = { ...a, ...patch };
        if (!next.abnormal) delete next.abnormal;
        return next;
      }),
    }));
  const remove = (a: ClinicalAction) => {
    const docs = p.artifacts.filter((d) => d.release.when === "action" && d.release.ref === a.id);
    const objs = p.objectives.filter((o) => o.actionIds.includes(a.id)).length;
    const uses = [docs.length ? `releases ${docs.map((d) => `"${d.title}"`).join(", ")} (they will move to the start of the visit)` : "", objs ? `is linked from ${objs} objective${objs === 1 ? "" : "s"}` : ""].filter(Boolean).join(" and ");
    if (uses && !window.confirm(`"${a.name}" ${uses}. Delete it?`)) return;
    set((c) => deleteAction(c, a.id));
  };
  return (
    <Panel
      title={`Exams and orders (${p.actions.length})`}
      subtitle="What the student can do, request or order during the visit. Each has one fixed result that you approve here; the simulator never invents a finding. Because every visit is telehealth, exams are guided remote exams or results reported from the record. Include normal results for reasonable tests that turn out unhelpful."
      action={
        <Button size="sm" onClick={() => set((c) => ({ ...c, actions: [...c.actions, { id: nextId(c.actions, "a"), kind: "exam", name: "", aliases: [], result: "", importance: "important", artifactIds: [] }] }))}>
          Add exam or order
        </Button>
      }
    >
      <div className="space-y-3">
        {p.actions.map((a) => {
          const linked = p.artifacts.filter((d) => a.artifactIds?.includes(d.id) || (d.release.when === "action" && d.release.ref === a.id));
          const free = p.artifacts.filter((d) => !linked.includes(d));
          return (
            <div key={a.id} className={cx("rounded-md border p-3", a.abnormal ? "border-amber-200" : "border-slate-200")}>
              <div className="grid gap-2 lg:grid-cols-[auto_9.5rem_1fr_8rem_auto]">
                <span className="mt-2 font-mono text-xs text-slate-400">{a.id}</span>
                <Select value={a.kind} aria-label="Kind" onChange={(e) => up(a.id, { kind: e.target.value as ActionKind })}>
                  {ACTION_KINDS.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.label}
                    </option>
                  ))}
                </Select>
                <Input value={a.name} placeholder="Name, e.g. Order a lipid panel" aria-label="Name" onChange={(e) => up(a.id, { name: e.target.value })} />
                <Select value={a.importance} aria-label="Importance" onChange={(e) => up(a.id, { importance: e.target.value as Importance })}>
                  {IMPORTANCE.map((i) => (
                    <option key={i} value={i}>
                      {i[0].toUpperCase() + i.slice(1)}
                    </option>
                  ))}
                </Select>
                <RemoveButton onClick={() => remove(a)} />
              </div>
              <div className="mt-2 grid gap-3 lg:grid-cols-[1fr_18rem]">
                <Area label="Result written to the chart" minRows={2} value={a.result} onChange={(v) => up(a.id, { result: v })} />
                <div className="space-y-2">
                  <Field label="Also matches" hint="Other ways a student might ask for this, separated by commas.">
                    <Input
                      value={(a.aliases || []).join(", ")}
                      placeholder="e.g. cholesterol, lipids"
                      onChange={(e) => up(a.id, { aliases: e.target.value.split(",").map((s) => s.replace(/^\s+/, "")).filter((s, i, arr) => s.trim() || i === arr.length - 1) })}
                    />
                  </Field>
                  <label className="flex items-center gap-1.5 text-sm text-slate-700">
                    <input type="checkbox" checked={!!a.abnormal} onChange={(e) => up(a.id, { abnormal: e.target.checked })} />
                    Result is abnormal
                  </label>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-slate-500">Documents added to the chart when this is done:</span>
                {linked.map((d) => (
                  <span key={d.id} className="inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-slate-800">
                    <button type="button" className="hover:underline" onClick={() => go("artifacts")}>
                      {d.title || d.id}
                    </button>
                    <button type="button" aria-label="Unlink" title="Unlink: the document moves to the start of the visit" className="text-slate-400 hover:text-rose-700" onClick={() => set((c) => setRelease(c, d.id, { when: "start" }))}>
                      x
                    </button>
                  </span>
                ))}
                {!linked.length && <span className="text-slate-400">none</span>}
                {free.length > 0 && (
                  <select className="rounded border border-slate-300 bg-white px-1.5 py-1 text-xs text-slate-700" value="" aria-label="Link a document" onChange={(e) => e.target.value && set((c) => setRelease(c, e.target.value, { when: "action", ref: a.id }))}>
                    <option value="">+ Link a document...</option>
                    {free.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.title || d.id}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          );
        })}
        {!p.actions.length && <p className="text-sm text-slate-500">No exams or orders yet. Students will only be able to talk with the patient.</p>}
      </div>
    </Panel>
  );
}
