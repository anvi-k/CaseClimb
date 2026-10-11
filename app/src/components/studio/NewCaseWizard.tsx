"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button, cx, Input, PageHeader, Select } from "@/components/ui";
import type { ClarifyQuestion } from "@/lib/studio/ai";
import { api, Area, Field, Notice, Panel, Text } from "./fields";

type Role = { id: string; name: string; roleTitle: string; encounterTypes: string[] };
type Way = "describe" | "form" | "import";
type Stage = "input" | "asking" | "questions" | "writing" | "failed";

const EXAMPLES: { label: string; role: string; text: string; goals: string }[] = [
  {
    label: "Chest pain, smoker",
    role: "medicine",
    text: "58-year-old long-haul truck driver with three weeks of chest tightness when he climbs stairs or loads the truck, easing after a few minutes of rest. Smokes a pack a day, father died of a heart attack at 60. He plays it down as heartburn and is mainly here because his wife booked the visit. He has not told anyone that he had an episode at rest two nights ago.",
    goals: "Take a focused chest pain history; recognise unstable features; negotiate urgent in-person assessment with a reluctant patient.",
  },
  {
    label: "Heart failure, missed diuretic",
    role: "nursing",
    text: "72-year-old retired school cook with heart failure calling her nurse care manager about three days of worsening leg swelling and a 6 lb weight gain. Lives alone, has been eating canned soup since her daughter moved away, and skips her evening water pill so she does not have to get up at night. She says she takes all her pills.",
    goals: "Elicit non-adherence without judgment; recognise findings that need same-day escalation; teach daily weights and sodium limits.",
  },
  {
    label: "New prediabetes, shift worker",
    role: "dietetics",
    text: "45-year-old aircraft mechanic referred after labs showed prediabetes and high LDL. Works rotating night shifts, eats from vending machines and drive-throughs, drinks several sodas a day. Thinks diet advice is for people with time and money. Drinks more beer than he first admits.",
    goals: "Complete a diet history; identify realistic changes that fit shift work; use motivational interviewing rather than instruction.",
  },
];

const FORM_FIELDS: { key: string; label: string; placeholder: string; area?: boolean; half?: boolean }[] = [
  { key: "name", label: "Patient name", placeholder: "Leave blank to let the guide choose", half: true },
  { key: "age", label: "Age", placeholder: "e.g. 58", half: true },
  { key: "sex", label: "Sex", placeholder: "e.g. Male", half: true },
  { key: "occupation", label: "Occupation", placeholder: "e.g. Long-haul truck driver", half: true },
  { key: "chiefConcern", label: "Reason for the visit, in the patient's words", placeholder: "e.g. Tightness in my chest when I climb stairs" },
  { key: "diagnosis", label: "Underlying problem or diagnosis the case is built around", placeholder: "e.g. Unstable angina" },
  { key: "history", label: "Key history the patient can give", placeholder: "Onset, pattern, relevant past history, family history, risk factors", area: true },
  { key: "medications", label: "Medications and allergies", placeholder: "e.g. Lisinopril 10 mg daily; no known allergies", area: true },
  { key: "findings", label: "Findings, results and documents that should be in the chart", placeholder: "e.g. ECG with ST depression in V4-V6, lipid panel with LDL 168, last clinic note", area: true },
  { key: "sensitive", label: "What the patient is reluctant to share", placeholder: "e.g. An episode of pain at rest two nights ago; drinking more than he says", area: true },
  { key: "personality", label: "Personality and communication style", placeholder: "e.g. Stoic, plays things down, short answers", area: true },
  { key: "context", label: "Living situation and background", placeholder: "e.g. Married, two adult children, on the road four nights a week", area: true },
];

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** The role new patients are written for now that the app has a single kind of learner. */
const GENERAL_ROLE = "medicine";

export default function NewCaseWizard({ groups, defaultRole }: { groups: { group: string; items: Role[] }[]; defaultRole: string }) {
  const router = useRouter();
  const roles = groups.flatMap((g) => g.items);
  const [way, setWay] = useState<Way>("describe");
  const [stage, setStage] = useState<Stage>("input");
  const [role, setRole] = useState(roles.some((r) => r.id === GENERAL_ROLE) ? GENERAL_ROLE : roles.some((r) => r.id === defaultRole) ? defaultRole : roles[0]?.id || "");
  const [description, setDescription] = useState("");
  const [goals, setGoals] = useState("");
  const [level, setLevel] = useState("");
  const [form, setForm] = useState<Record<string, string>>({});
  const [doc, setDoc] = useState<{ id: string; filename: string; chars: number; note?: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [understood, setUnderstood] = useState("");
  const [questions, setQuestions] = useState<ClarifyQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [saved, setSaved] = useState<{ id: string; title: string; seconds: number; counts: { facts: number; actions: number; artifacts: number; objectives: number } } | null>(null);
  const [importing, setImporting] = useState(false);
  // Laboratory values and blood pressure can come from the health-markers dataset instead of the model.
  const [markers, setMarkers] = useState<{ available: boolean; conditions: { id: string; label: string; rows: number }[]; synthea?: { available: boolean; records: { id: string; label: string }[] } } | null>(null);
  const [condition, setCondition] = useState("");
  useEffect(() => {
    fetch("/api/markers")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setMarkers(j))
      .catch(() => {});
  }, []);
  const started = useRef(0);

  useEffect(() => {
    if (stage !== "writing") return;
    const t = setInterval(() => setElapsed(Math.round((Date.now() - started.current) / 1000)), 1000);
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => {
      clearInterval(t);
      window.removeEventListener("beforeunload", warn);
    };
  }, [stage]);

  const formFilled = Object.values(form).filter((v) => v.trim()).length;
  // A Synthea record already says who the patient is, so a description is optional with one.
  const canContinue = condition.startsWith("syn:") || (way === "describe" ? description.trim().length >= 15 : !!(form.chiefConcern?.trim() || form.diagnosis?.trim()));

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await api<{ id: string; filename: string; text: string | null; note?: string }>("/api/uploads", { method: "POST", body: fd });
      setDoc({ id: r.id, filename: r.filename, chars: r.text?.length || 0, note: r.note });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function next() {
    setError(null);
    if (way === "form") return write([]);
    setStage("asking");
    try {
      const r = await api<{ questions: ClarifyQuestion[]; understood: string }>("/api/cases/clarify", { json: { professionId: role, description, goals, level: Number(level) || undefined } });
      setUnderstood(r.understood);
      if (!r.questions.length) return write([]);
      setQuestions(r.questions);
      setAnswers({});
      setStage("questions");
    } catch {
      // The questions are a convenience. If they cannot be fetched, draft from the description as written.
      return write([]);
    }
  }

  async function write(qa: { question: string; answer: string }[]) {
    setError(null);
    setSaved(null);
    started.current = Date.now();
    setElapsed(0);
    setStage("writing");
    try {
      const r = await api<NonNullable<typeof saved>>("/api/cases/generate", {
        json: { professionId: role, description: way === "describe" ? description : form.notes || "", structured: way === "form" ? form : undefined, goals, level: Number(level) || undefined, uploadId: doc?.id, answers: qa, markers: condition && !condition.startsWith("syn:") ? { condition } : undefined, synthea: condition.startsWith("syn:") ? { id: condition.slice(4) } : undefined },
      });
      setSaved(r);
      router.push(`/faculty/cases/${r.id}?created=1`);
    } catch (e) {
      setError((e as Error).message);
      setStage("failed");
    }
  }

  async function importFile(file: File) {
    setError(null);
    setImporting(true);
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        throw new Error("That file is not valid JSON.");
      }
      const { id } = await api<{ id: string }>("/api/cases", { json: { import: parsed } });
      router.push(`/faculty/cases/${id}`);
    } catch (e) {
      setError((e as Error).message);
      setImporting(false);
    }
  }

  async function blank() {
    setError(null);
    try {
      const { id } = await api<{ id: string }>("/api/cases", { json: { blank: true, professionId: role } });
      router.push(`/faculty/cases/${id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // One learner role: every new patient is written as a general outpatient visit.
  const roleSelect = null;
  const shared = (
    <div className="grid gap-4 sm:grid-cols-2">
      <Area label="Learning goals (optional)" minRows={3} value={goals} onChange={setGoals} placeholder="What should a student be able to do by the end of this visit?" />
      <div className="space-y-4">
        <Field label="Target difficulty (optional)">
          <Select value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="">Let the guide decide</option>
            <option value="1">1 - Forthcoming patient, single clear problem</option>
            <option value="2">2 - Straightforward</option>
            <option value="3">3 - Some reluctance, a few distractors</option>
            <option value="4">4 - Guarded patient, competing problems</option>
            <option value="5">5 - Complex, sensitive, easy to miss</option>
          </Select>
        </Field>
        {(markers?.available || markers?.synthea?.available) && (
          <Field
            label="Clinical data source"
            hint="A Synthea record supplies the whole clinical record: who the patient is, their problems, medications, allergies, vital signs and laboratory results. A health-markers row supplies laboratory values and blood pressure only. Either way the guide writes the person and the conversation around the data but cannot change it, and the source is kept on the patient."
          >
            <Select value={condition} onChange={(e) => setCondition(e.target.value)}>
              <option value="">Written by the guide (no dataset)</option>
              {markers?.synthea?.available && (
                <optgroup label="Synthea patient record">
                  {markers.synthea.records.map((r) => (
                    <option key={r.id} value={`syn:${r.id}`}>
                      {r.label}
                    </option>
                  ))}
                </optgroup>
              )}
              {markers?.available && (
                <optgroup label="Health-markers dataset (lab values and blood pressure)">
                  {markers.conditions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label} · {c.rows.toLocaleString()} rows
                    </option>
                  ))}
                </optgroup>
              )}
            </Select>
          </Field>
        )}
        <Field label="Source document (optional)" hint="A guideline, protocol or paper as PDF, TXT or MD. The case is written to agree with it, and it is attached as a knowledge source that grounds student feedback.">
          {doc ? (
            <div className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
              <span className="min-w-0 truncate">
                {doc.filename} <span className="text-slate-500">· {doc.chars ? `${doc.chars.toLocaleString()} characters of text read` : "no text could be read"}</span>
              </span>
              <button type="button" className="text-xs text-slate-500 hover:text-rose-700" onClick={() => setDoc(null)}>
                Remove
              </button>
            </div>
          ) : (
            <Input type="file" accept=".pdf,.txt,.md" disabled={uploading} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          )}
          {uploading && <p className="mt-1 text-xs text-slate-500">Uploading and reading the document...</p>}
          {doc?.note && <p className="mt-1 text-xs text-amber-700">{doc.note}</p>}
        </Field>
      </div>
    </div>
  );

  if (stage === "writing" || stage === "failed") {
    const steps: { label: string; detail?: string; state: "done" | "active" | "todo" | "failed" }[] = [
      { label: way === "describe" ? "Description read" : `Form read (${formFilled} fields filled in)`, state: "done", detail: understood || undefined },
      ...(doc ? [{ label: "Source document attached", detail: `${doc.filename}, ${doc.chars.toLocaleString()} characters`, state: "done" as const }] : []),
      {
        label: "Writing the patient",
        detail: "The guide writes the persona, the facts with their disclosure tiers, the exams and orders with their results, the chart documents, the objectives and the answer key together, so they agree with each other. This usually takes one to two minutes and can take longer. There is no partial result to show until it finishes.",
        state: saved ? "done" : stage === "failed" ? "failed" : "active",
      },
      { label: "Checking ids and links, then saving as a draft", state: saved ? "done" : "todo", detail: saved ? `${saved.counts.facts} facts, ${saved.counts.actions} exams and orders, ${saved.counts.artifacts} documents, ${saved.counts.objectives} objectives` : undefined },
      { label: "Opening the editor for your review", state: saved ? "active" : "todo" },
    ];
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title="Drafting your patient" subtitle="The draft is saved to your library as soon as it is written, even if you close this page." />
        <Panel title={stage === "failed" ? "The draft was not written" : saved ? saved.title : `Working · ${fmt(elapsed)} elapsed`}>
          <ol className="space-y-3">
            {steps.map((s, i) => (
              <li key={i} className="flex gap-3">
                <span
                  className={cx(
                    "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[14px] font-semibold",
                    s.state === "done" && "bg-emerald-100 text-emerald-800",
                    s.state === "active" && "bg-brand-600 text-white",
                    s.state === "todo" && "bg-slate-100 text-slate-400",
                    s.state === "failed" && "bg-rose-100 text-rose-800",
                  )}
                >
                  {s.state === "active" ? <span className="h-2 w-2 animate-pulse rounded-full bg-white" /> : i + 1}
                </span>
                <div>
                  <p className={cx("text-sm font-medium", s.state === "todo" ? "text-slate-400" : "text-slate-900")}>
                    {s.label}
                    {s.state === "done" && <span className="ml-2 text-xs font-normal text-emerald-700">done</span>}
                    {s.state === "active" && i === steps.length - 3 && <span className="ml-2 text-xs font-normal text-slate-500">{fmt(elapsed)}</span>}
                  </p>
                  {s.detail && <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{s.detail}</p>}
                </div>
              </li>
            ))}
          </ol>
          {stage === "writing" && !saved && (
            <p role="status" aria-live="polite" className={cx("mt-4 flex items-start gap-2 rounded-md border px-3 py-2 text-sm", elapsed >= 120 ? "border-amber-200 bg-amber-50 text-amber-900" : "border-slate-200 bg-slate-50 text-slate-700")}>
              <span className={cx("mt-1.5 h-2 w-2 shrink-0 animate-pulse rounded-full", elapsed >= 120 ? "bg-amber-500" : "bg-brand-600")} />
              <span>
                {elapsed < 60 && "Writing. Most patients are ready in one to two minutes."}
                {elapsed >= 60 && elapsed < 120 && "Still writing. This is within the usual one to two minutes."}
                {elapsed >= 120 && elapsed < 180 && `Still working at ${fmt(elapsed)}. This patient is taking longer than usual, which happens with detailed descriptions and cases that need several chart documents. No error has come back. The whole case is written before any of it is shown, so there is nothing to display yet.`}
                {elapsed >= 180 && elapsed < 300 && `Still working at ${fmt(elapsed)}. The longest drafts are the ones with many facts, lab tables and documents that all have to agree with each other. You can keep this page open or leave it: the draft is saved to your library when it is done.`}
                {elapsed >= 300 && `Still working at ${fmt(elapsed)}, which is much longer than usual. If the draft cannot be written, this page will say so and offer to try again. You can also check your library for the finished draft.`}
              </span>
            </p>
          )}
          {stage === "failed" && (
            <div className="mt-4 space-y-3">
              <Notice tone="red">{error}</Notice>
              <div className="flex gap-2">
                <Button onClick={() => write(questions.map((q) => ({ question: q.question, answer: answers[q.id] || "" })))}>Try again</Button>
                <Button variant="secondary" onClick={() => setStage("input")}>
                  Back to the description
                </Button>
              </div>
            </div>
          )}
        </Panel>
      </div>
    );
  }

  if (stage === "questions") {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title="A few quick questions" subtitle="Your description leaves these open. Answer what you can; anything you skip, the guide decides and you can change it in the editor." />
        <Panel title="Before the guide writes the case" subtitle={understood}>
          <div className="space-y-5">
            {questions.map((q) => (
              <div key={q.id}>
                <p className="text-sm font-medium text-slate-900">{q.question}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {q.suggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setAnswers((a) => ({ ...a, [q.id]: a[q.id] === s ? "" : s }))}
                      className={cx("rounded-full border px-3 py-1 text-xs", answers[q.id] === s ? "border-brand-600 bg-brand-50 text-brand-900" : "border-slate-300 text-slate-700 hover:bg-slate-50")}
                    >
                      {s}
                    </button>
                  ))}
                </div>
                <Input className="mt-2" value={answers[q.id] || ""} onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))} placeholder="Or type your own answer" />
              </div>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Button onClick={() => write(questions.map((q) => ({ question: q.question, answer: answers[q.id] || "" })))}>Draft the patient</Button>
            <Button variant="ghost" onClick={() => setStage("input")}>
              Back
            </Button>
            <span className="text-xs text-slate-500">Drafting usually takes one to two minutes and can take longer.</span>
          </div>
        </Panel>
      </div>
    );
  }

  const ways: { id: Way; title: string; text: string }[] = [
    { id: "describe", title: "Describe the patient", text: "Write a paragraph or paste your notes. The guide asks what is missing, then drafts the full case." },
    { id: "form", title: "Fill in a form", text: "Enter the core clinical details field by field. The guide expands them into the full case." },
    { id: "import", title: "Import a file", text: "Load a patient profile exported from Poscere (JSON)." },
  ];

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="New Patient"
        subtitle="Every route ends in the same editor, where you review and correct everything before publishing. Nothing reaches students until you publish."
        action={
          <Link href="/faculty/cases" className="text-sm text-slate-600 hover:text-slate-900">
            Back to the library
          </Link>
        }
      />
      <div className="mb-4 grid gap-2 sm:grid-cols-3" role="tablist">
        {ways.map((w) => (
          <button
            key={w.id}
            type="button"
            role="tab"
            aria-selected={way === w.id}
            onClick={() => {
              setWay(w.id);
              setError(null);
            }}
            className={cx("rounded-lg border p-3 text-left transition-colors", way === w.id ? "border-brand-600 bg-brand-50 ring-1 ring-brand-600" : "border-slate-200 bg-white hover:border-slate-300")}
          >
            <span className="block text-sm font-semibold text-slate-900">{w.title}</span>
            <span className="mt-0.5 block text-xs leading-relaxed text-slate-600">{w.text}</span>
          </button>
        ))}
      </div>
      {error && (
        <Notice tone="red" className="mb-3">
          {error}
        </Notice>
      )}

      {way === "describe" && (
        <Panel title="Describe the patient" subtitle="Say who they are, why they booked the visit, and what the case should teach. Details you give are kept as written; the guide fills in the rest.">
          <div className="space-y-4">
            {roleSelect}
            <div>
              <Area
                label="Patient description"
                minRows={7}
                value={description}
                onChange={setDescription}
                placeholder="e.g. 58-year-old truck driver with three weeks of exertional chest tightness. Smoker, father died of a heart attack at 60. Plays it down as heartburn..."
              />
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                Start from an example:
                {EXAMPLES.filter((e) => roles.some((r) => r.id === e.role)).map((e) => (
                  <button
                    key={e.label}
                    type="button"
                    className="rounded-full border border-slate-300 px-2.5 py-0.5 text-slate-700 hover:bg-slate-50"
                    onClick={() => {
                      setDescription(e.text);
                      setGoals(e.goals);
                      setRole(e.role);
                    }}
                  >
                    {e.label}
                  </button>
                ))}
              </div>
            </div>
            {shared}
            <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
              <Button disabled={!canContinue || stage === "asking" || uploading} onClick={next}>
                {stage === "asking" ? "Reading your description..." : "Continue"}
              </Button>
              <span className="text-xs text-slate-500">Next: the guide may ask up to three short questions, then drafts the case (usually one to two minutes).</span>
            </div>
          </div>
        </Panel>
      )}

      {way === "form" && (
        <Panel title="Core clinical details" subtitle="Fill in what matters to you and leave the rest blank. At minimum give the reason for the visit or the underlying problem.">
          <div className="space-y-4">
            {roleSelect}
            <div className="grid gap-4 sm:grid-cols-4">
              {FORM_FIELDS.map((f) =>
                f.area ? (
                  <Area key={f.key} className="sm:col-span-2" label={f.label} minRows={2} placeholder={f.placeholder} value={form[f.key] || ""} onChange={(v) => setForm((s) => ({ ...s, [f.key]: v }))} />
                ) : (
                  <Text key={f.key} className={f.half ? "sm:col-span-1" : "sm:col-span-2"} label={f.label} placeholder={f.placeholder} value={form[f.key] || ""} onChange={(v) => setForm((s) => ({ ...s, [f.key]: v }))} />
                ),
              )}
              <Area className="sm:col-span-4" label="Anything else the guide should know (optional)" minRows={2} value={form.notes || ""} onChange={(v) => setForm((s) => ({ ...s, notes: v }))} />
            </div>
            {shared}
            <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
              <Button disabled={!canContinue || uploading} onClick={next}>
                Draft the patient
              </Button>
              <span className="text-xs text-slate-500">Drafting usually takes one to two minutes and can take longer. You review everything before it can be published.</span>
            </div>
          </div>
        </Panel>
      )}

      {way === "import" && (
        <Panel title="Import a patient profile" subtitle="Use a JSON file exported from the editor (Export JSON), or any file that follows the Poscere case format. The import is saved as a draft you own.">
          <Input type="file" accept=".json,application/json" disabled={importing} onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
          {importing && <p className="mt-2 text-sm text-slate-500">Importing...</p>}
          <div className="mt-5 border-t border-slate-100 pt-4">
            <p className="text-sm text-slate-700">Prefer to write everything yourself?</p>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <div className="w-64">{roleSelect}</div>
            </div>
            <Button variant="secondary" className="mt-3" onClick={blank}>
              Start with an empty profile
            </Button>
          </div>
        </Panel>
      )}
    </div>
  );
}
