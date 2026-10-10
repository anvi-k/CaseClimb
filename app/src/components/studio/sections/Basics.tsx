"use client";

import { Badge, Button, Input, Label, Select } from "@/components/ui";
import { FACT_CATEGORIES } from "@/lib/types";
import type { CaseProfile, Mismatch, Objective } from "@/lib/types";
import { nextId, tierLabel } from "@/lib/studio/profile";
import { Area, Field, Notice, Panel, RemoveButton, StringList, Text } from "../fields";
import type { SectionProps } from "./types";

type Role = { id: string; name: string };

export function OverviewSection({ p, set, roles }: SectionProps & { roles: Role[] }) {
  const up = (patch: Partial<CaseProfile>) => set((c) => ({ ...c, ...patch }));
  return (
    <Panel title="Overview" subtitle="How this patient appears in your library and to whom it is offered. Students do not see the title or summary.">
      <div className="grid gap-4 sm:grid-cols-2">
        <Text className="sm:col-span-2" label="Title (faculty-facing)" value={p.title} onChange={(v) => up({ title: v })} placeholder="e.g. New-onset exertional chest pain in a 58-year-old smoker" />
        <Area className="sm:col-span-2" label="Summary (faculty-facing)" minRows={3} value={p.summary} onChange={(v) => up({ summary: v })} placeholder="Two or three sentences: what the case is and what it teaches." />
        <Text label="Specialty" value={p.specialty} onChange={(v) => up({ specialty: v })} />
        <Text label="Encounter type" value={p.encounterType} onChange={(v) => up({ encounterType: v })} placeholder="e.g. diagnostic interview, follow-up, counseling" />
        <Text className="sm:col-span-2" label="Setting" hint="Every visit is a telehealth video call. Say where the patient is calling from." value={p.setting} onChange={(v) => up({ setting: v })} />
        <Field label="Difficulty" hint="The intrinsic difficulty of the case. Assignments can make the patient more or less forthcoming on top of this.">
          <Select value={p.difficulty} onChange={(e) => up({ difficulty: Number(e.target.value) })}>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n} of 5
              </option>
            ))}
          </Select>
        </Field>
        <Field className="sm:col-span-2" label={`Learner roles (${p.professions.length} selected)`} hint="Students in these professions can be given this patient. The case was written for the scope of the first role selected.">
          <div className="grid max-h-52 gap-x-4 gap-y-1.5 overflow-y-auto rounded-md border border-slate-200 p-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {roles.map((r) => (
              <label key={r.id} className="flex items-center gap-1.5 text-sm text-slate-800">
                <input
                  type="checkbox"
                  checked={p.professions.includes(r.id)}
                  onChange={(e) => up({ professions: e.target.checked ? [...p.professions, r.id] : p.professions.filter((x) => x !== r.id) })}
                />
                {r.name}
              </label>
            ))}
          </div>
        </Field>
      </div>
    </Panel>
  );
}

export function PatientSection({ p, set }: SectionProps) {
  const pt = (patch: Partial<CaseProfile["patient"]>) => set((c) => ({ ...c, patient: { ...c.patient, ...patch } }));
  const pe = (patch: Partial<CaseProfile["persona"]>) => set((c) => ({ ...c, persona: { ...c.persona, ...patch } }));
  return (
    <div className="space-y-4">
      <Panel title="Patient" subtitle="Who the student meets on the call.">
        <div className="grid gap-4 sm:grid-cols-4">
          <Text className="sm:col-span-2" label="Name" value={p.patient.name} onChange={(v) => pt({ name: v })} />
          <Text label="Age" type="number" min={0} max={120} value={p.patient.age} onChange={(v) => pt({ age: Math.max(0, Math.round(Number(v) || 0)) })} />
          <Text label="Sex" value={p.patient.sex} onChange={(v) => pt({ sex: v })} />
          <Text label="Pronouns" value={p.patient.pronouns} onChange={(v) => pt({ pronouns: v })} />
          <Text label="Ethnicity" value={p.patient.ethnicity} onChange={(v) => pt({ ethnicity: v })} />
          <Text label="Occupation" value={p.patient.occupation} onChange={(v) => pt({ occupation: v })} />
          <Text label="Language" value={p.patient.language} onChange={(v) => pt({ language: v })} />
          <Area className="sm:col-span-4" label="Appearance on the call" hint="What the student sees on video: posture, affect, surroundings. Shown to the student when the visit starts." value={p.patient.appearance} onChange={(v) => pt({ appearance: v })} />
        </div>
      </Panel>
      <Panel title="Persona" subtitle="How the patient behaves and talks. This shapes every reply but never adds clinical facts: the patient can only state what is in Facts.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Area label="Personality" value={p.persona.personality} onChange={(v) => pe({ personality: v })} />
          <Area label="Communication style" value={p.persona.communicationStyle} onChange={(v) => pe({ communicationStyle: v })} />
          <Area label="Emotional state at the start" value={p.persona.emotionalState} onChange={(v) => pe({ emotionalState: v })} />
          <Field label="Health literacy" hint="Low: needs plain words and may misuse medical terms. High: uses clinical terms correctly.">
            <Select value={p.persona.healthLiteracy} onChange={(e) => pe({ healthLiteracy: e.target.value as CaseProfile["persona"]["healthLiteracy"] })}>
              <option value="low">Low</option>
              <option value="moderate">Moderate</option>
              <option value="high">High</option>
            </Select>
          </Field>
          <Area className="sm:col-span-2" label="Background" hint="Non-clinical life story the patient can chat about freely: family, work, routine. Keep health information out of here; put it in Facts so disclosure is controlled." minRows={3} value={p.persona.background} onChange={(v) => pe({ background: v })} />
          <StringList label="Speech examples" hint="Three to five short lines that show how this person talks." items={p.persona.speechExamples} onChange={(v) => pe({ speechExamples: v })} addLabel="Add a line" />
          <StringList label="Concerns the patient may raise" items={p.persona.concerns} onChange={(v) => pe({ concerns: v })} addLabel="Add a concern" />
        </div>
      </Panel>
    </div>
  );
}

export function ScenarioSection({ p, set, go }: SectionProps) {
  const sc = (patch: Partial<CaseProfile["scenario"]>) => set((c) => ({ ...c, scenario: { ...c.scenario, ...patch } }));
  return (
    <Panel
      title="Scenario"
      subtitle="What the student is told and asked to do."
      action={
        <Button variant="secondary" size="sm" onClick={() => go("preview")}>
          See the student preview
        </Button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Area className="sm:col-span-2" label="Student brief" hint="Read by the student before joining the call: their role, who the patient is and why they booked. It must not give away findings." minRows={3} value={p.scenario.studentBrief} onChange={(v) => sc({ studentBrief: v })} />
        <Text label="Chief concern" hint="Short label for the reason for the visit." value={p.scenario.chiefComplaint} onChange={(v) => sc({ chiefComplaint: v })} />
        <Text label="Time limit (minutes)" type="number" min={5} max={60} value={p.scenario.timeLimitMin} onChange={(v) => sc({ timeLimitMin: Math.round(Number(v) || 0) })} hint="Between 5 and 60. Assignments can override it." />
        <Area className="sm:col-span-2" label="Opening line" hint="What the patient says when first asked what brings them in. Use only information from facts in the Volunteered tier." value={p.scenario.openingLine} onChange={(v) => sc({ openingLine: v })} />
        <div className="sm:col-span-2">
          <StringList label="Tasks for the student" hint="Three to five things the student is expected to accomplish. Shown with the brief." items={p.scenario.tasks} onChange={(v) => sc({ tasks: v })} addLabel="Add a task" />
        </div>
      </div>
    </Panel>
  );
}

export function ChartSection({ p, set, go }: SectionProps) {
  const items = p.chartAtStart;
  const up = (next: CaseProfile["chartAtStart"]) => set((c) => ({ ...c, chartAtStart: next }));
  const startDocs = p.artifacts.filter((d) => d.release.when === "start");
  return (
    <div className="space-y-4">
      <Panel
        title="Chart at start"
        subtitle="Record items the student can read before asking anything, as they would in a real chart. Anything written here does not need to be elicited, so keep discoverable findings out."
      >
        <div className="space-y-2">
          {items.map((it, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[13rem_1fr_auto]">
              <Input value={it.label} placeholder="Label, e.g. Allergies" aria-label="Label" onChange={(e) => up(items.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
              <Area dense minRows={1} value={it.value} placeholder="Value" aria-label="Value" onChange={(v) => up(items.map((x, j) => (j === i ? { ...x, value: v } : x)))} />
              <RemoveButton onClick={() => up(items.filter((_, j) => j !== i))} />
            </div>
          ))}
        </div>
        <Button variant="ghost" size="sm" className="mt-2" onClick={() => up([...items, { label: "", value: "" }])}>
          + Add a chart item
        </Button>
        <p className="mt-2 text-xs text-slate-500">Common labels: Reason for visit, Problem list, Medications, Allergies, Last vitals, Immunizations, Care team, Code status.</p>
      </Panel>
      <Panel
        title="Documents in the chart from the start"
        subtitle="Set in Documents with the release rule 'In the chart from the start'."
        action={
          <Button variant="secondary" size="sm" onClick={() => go("artifacts")}>
            Open Documents
          </Button>
        }
      >
        {startDocs.length ? (
          <ul className="space-y-1 text-sm text-slate-700">
            {startDocs.map((d) => (
              <li key={d.id}>
                {d.title} <span className="text-xs text-slate-400">{d.date}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">No documents are visible at the start.</p>
        )}
      </Panel>
    </div>
  );
}

export function AnswerSection({ p, set }: SectionProps) {
  const ak = (patch: Partial<CaseProfile["answerKey"]>) => set((c) => ({ ...c, answerKey: { ...c.answerKey, ...patch } }));
  return (
    <Panel title="Answer key" subtitle="Never shown during a visit. Feedback judges the student's clinical reasoning, plan and statements to the patient against this and your knowledge sources.">
      <div className="grid gap-5 sm:grid-cols-2">
        <Area className="sm:col-span-2" label="Primary problem" value={p.answerKey.primaryProblem} onChange={(v) => ak({ primaryProblem: v })} />
        <StringList label="Differential" items={p.answerKey.differential} onChange={(v) => ak({ differential: v })} />
        <StringList label="Key findings" items={p.answerKey.keyFindings} onChange={(v) => ak({ keyFindings: v })} />
        <StringList label="Plan" items={p.answerKey.plan} onChange={(v) => ak({ plan: v })} />
        <StringList label="Red flags" items={p.answerKey.redFlags} onChange={(v) => ak({ redFlags: v })} />
        <div className="sm:col-span-2">
          <StringList label="Education points" items={p.answerKey.educationPoints} onChange={(v) => ak({ educationPoints: v })} />
        </div>
      </div>
    </Panel>
  );
}

/** Chips for the linked items plus a menu to link another. */
export function LinkPicker({ label, options, selected, onChange, empty }: { label: string; options: { id: string; label: string }[]; selected: string[]; onChange: (ids: string[]) => void; empty: string }) {
  const free = options.filter((o) => !selected.includes(o.id));
  return (
    <div>
      <Label>{label}</Label>
      <div className="flex flex-wrap items-center gap-1.5">
        {selected.map((id) => {
          const o = options.find((x) => x.id === id);
          return (
            <span key={id} className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs ${o ? "border-slate-200 bg-slate-50 text-slate-800" : "border-rose-200 bg-rose-50 text-rose-800"}`}>
              <span className="font-mono text-[10px] text-slate-400">{id}</span>
              {o ? o.label : "no longer exists"}
              <button type="button" aria-label={`Unlink ${id}`} className="ml-0.5 text-slate-400 hover:text-rose-700" onClick={() => onChange(selected.filter((x) => x !== id))}>
                x
              </button>
            </span>
          );
        })}
        {!selected.length && <span className="text-xs text-amber-700">{empty}</span>}
        {free.length > 0 && (
          <select
            className="rounded border border-slate-300 bg-white px-1.5 py-1 text-xs text-slate-700"
            value=""
            aria-label={`Add to ${label}`}
            onChange={(e) => e.target.value && onChange([...selected, e.target.value])}
          >
            <option value="">+ Link...</option>
            {free.map((o) => (
              <option key={o.id} value={o.id}>
                {o.id} · {o.label}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}

export function ObjectivesSection({ p, set }: SectionProps) {
  const up = (id: string, patch: Partial<Objective>) => set((c) => ({ ...c, objectives: c.objectives.map((o) => (o.id === id ? { ...o, ...patch } : o)) }));
  const factOpts = p.facts.map((f) => ({ id: f.id, label: `${f.topic} (${tierLabel(f.tier)})` }));
  const actionOpts = p.actions.map((a) => ({ id: a.id, label: a.name }));
  return (
    <Panel
      title="Learning objectives"
      subtitle="Each objective is assessed from the facts the student elicited and the actions they performed. Link every objective to the facts and actions that demonstrate it; an objective with no links cannot be assessed."
      action={
        <Button size="sm" onClick={() => set((c) => ({ ...c, objectives: [...c.objectives, { id: nextId(c.objectives, "o"), text: "", factIds: [], actionIds: [] }] }))}>
          Add objective
        </Button>
      }
    >
      {!p.objectives.length && <p className="text-sm text-slate-500">No objectives yet.</p>}
      <div className="space-y-3">
        {p.objectives.map((o) => (
          <div key={o.id} className="rounded-md border border-slate-200 p-3">
            <div className="flex items-start gap-2">
              <span className="mt-2 font-mono text-xs text-slate-400">{o.id}</span>
              <Area className="flex-1" minRows={1} value={o.text} placeholder="The student should be able to..." onChange={(v) => up(o.id, { text: v })} />
              <RemoveButton onClick={() => set((c) => ({ ...c, objectives: c.objectives.filter((x) => x.id !== o.id) }))} />
            </div>
            <div className="mt-2 grid gap-3 pl-7 lg:grid-cols-2">
              <LinkPicker label="Facts that demonstrate it" options={factOpts} selected={o.factIds} onChange={(ids) => up(o.id, { factIds: ids })} empty="No facts linked." />
              <LinkPicker label="Actions that demonstrate it" options={actionOpts} selected={o.actionIds} onChange={(ids) => up(o.id, { actionIds: ids })} empty="No actions linked." />
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function MismatchesSection({ p, set }: SectionProps) {
  const list = p.mismatches || [];
  const up = (id: string, patch: Partial<Mismatch>) => set((c) => ({ ...c, mismatches: (c.mismatches || []).map((m) => (m.id === id ? { ...m, ...patch } : m)) }));
  const link = (id: string, key: "factId" | "artifactId", value: string) =>
    set((c) => ({
      ...c,
      mismatches: (c.mismatches || []).map((m) => {
        if (m.id !== id) return m;
        const next = { ...m };
        if (value) next[key] = value;
        else delete next[key];
        return next;
      }),
    }));
  return (
    <Panel
      title="Patient vs chart"
      subtitle="Deliberate conflicts between what the patient sincerely says and what the record shows, for example 'I take every dose' against an overdue refill. Feedback reports whether the student noticed and explored each one. The patient's side must be one of the facts and the record's side must be in a document or an action result."
      action={
        <Button size="sm" onClick={() => set((c) => ({ ...c, mismatches: [...(c.mismatches || []), { id: nextId(c.mismatches || [], "m"), patientClaim: "", recordEvidence: "", teachingPoint: "" }] }))}>
          Add mismatch
        </Button>
      }
    >
      {!list.length && <Notice>This patient has no built-in mismatches. They are optional.</Notice>}
      <div className="space-y-3">
        {list.map((m) => {
          const f = p.facts.find((x) => x.id === m.factId);
          return (
            <div key={m.id} className="rounded-md border border-slate-200 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-mono text-xs text-slate-400">{m.id}</span>
                <RemoveButton onClick={() => set((c) => ({ ...c, mismatches: (c.mismatches || []).filter((x) => x.id !== m.id) }))} />
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                <div>
                  <Area label="The patient says" value={m.patientClaim} onChange={(v) => up(m.id, { patientClaim: v })} />
                  <Field label="Fact that carries this claim" className="mt-2">
                    <Select value={m.factId || ""} onChange={(e) => link(m.id, "factId", e.target.value)}>
                      <option value="">Not linked</option>
                      {p.facts.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.id} · {x.topic} ({FACT_CATEGORIES[x.category] || x.category})
                        </option>
                      ))}
                    </Select>
                  </Field>
                  {f && (
                    <p className="mt-1 text-xs text-slate-500">
                      Patient wording: &ldquo;{f.says}&rdquo; <Badge>{tierLabel(f.tier)}</Badge>
                    </p>
                  )}
                </div>
                <div>
                  <Area label="The record shows" value={m.recordEvidence} onChange={(v) => up(m.id, { recordEvidence: v })} />
                  <Field label="Document that holds the evidence" className="mt-2">
                    <Select value={m.artifactId || ""} onChange={(e) => link(m.id, "artifactId", e.target.value)}>
                      <option value="">Not linked (evidence is in an action result)</option>
                      {p.artifacts.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.id} · {d.title}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <Area className="lg:col-span-2" label="How a strong student handles it" value={m.teachingPoint} onChange={(v) => up(m.id, { teachingPoint: v })} />
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
