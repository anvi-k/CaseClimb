"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, CardHeader, Input, Label, Select, Textarea, cx } from "@/components/ui";
import { LEVEL_NAMES } from "@/lib/engine/difficulty";
import { defaultSettings, TYPE_LABEL, type AssignmentSettings, type AssignmentType } from "@/lib/courses/settings";

export interface BuilderCase {
  id: string;
  title: string;
  summary: string;
  specialty: string;
  professions: string[];
  difficulty: number;
  encounterType: string;
  objectives: string[];
  aiDraft: boolean;
}
export interface BuilderInitial {
  id: string;
  title: string;
  instructions: string;
  type: AssignmentType;
  caseIds: string[];
  journeyId: string | null;
  settings: AssignmentSettings;
  dueAt: string | null;
}
interface Reasons {
  type: string;
  level: string;
  settings: string;
  cases: Record<string, string>;
  gaps: string;
}

const LEVEL_HELP = [
  "",
  "Forthcoming, calm patient who volunteers information. Hints available, no time limit.",
  "Slightly vague patient who still volunteers some information. Hints available, no time limit.",
  "Patient answers only what is asked and mentions some irrelevant details. Timed.",
  "Guarded, vague, emotional patient who needs trust before sharing sensitive history. Timed.",
  "Distressed, very vague patient with a tight time limit.",
];
const TYPE_HELP: Record<AssignmentType, string> = {
  homework: "Graded practice with a due date. Students usually get several attempts and see feedback straight away.",
  exam: "Summative. Hints are off, every student meets the patient at the same level, and feedback is held until you release it.",
  practice: "Ungraded repetition. Unlimited attempts by default, with the patient's mood changing on repeats.",
};
const TIME_CHOICES = [10, 15, 20, 25, 30, 45, 60];

function GuideNote({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return (
    <p className="mt-1.5 rounded border-l-2 border-brand-500 bg-brand-50 px-2 py-1 text-xs text-slate-700">
      <span className="font-medium text-brand-700">Guide: </span>
      {children}
    </p>
  );
}

function Toggle({ id, checked, onChange, disabled, label, help }: { id: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string; help: string }) {
  return (
    <label htmlFor={id} className={cx("flex items-start gap-2.5 rounded-md border border-slate-200 p-3", disabled ? "bg-slate-50 text-slate-400" : "cursor-pointer hover:bg-slate-50")}>
      <input id={id} type="checkbox" className="mt-0.5 h-4 w-4 accent-[#2563eb]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className={cx("block text-sm font-medium", disabled ? "text-slate-500" : "text-slate-800")}>{label}</span>
        <span className="block text-xs text-slate-500">{help}</span>
      </span>
    </label>
  );
}

export default function AssignmentBuilder({
  courseId,
  courseProfession,
  cases,
  journeys,
  professionNames,
  initial,
}: {
  courseId: string;
  courseProfession: string | null;
  cases: BuilderCase[];
  journeys: { id: string; title: string }[];
  professionNames: Record<string, string>;
  initial?: BuilderInitial;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initial?.title || "");
  const [instructions, setInstructions] = useState(initial?.instructions || "");
  const [type, setType] = useState<AssignmentType>(initial?.type || "homework");
  const [target, setTarget] = useState<"cases" | "journey">(initial?.journeyId ? "journey" : "cases");
  const [caseIds, setCaseIds] = useState<string[]>(initial?.journeyId ? [] : initial?.caseIds || []);
  const [journeyId, setJourneyId] = useState(initial?.journeyId || "");
  const [s, setS] = useState<AssignmentSettings>(initial?.settings || defaultSettings("homework"));
  const [due, setDue] = useState("");
  const [reasons, setReasons] = useState<Reasons | null>(null);

  const [request, setRequest] = useState("");
  const [syllabus, setSyllabus] = useState("");
  const [showSyllabus, setShowSyllabus] = useState(false);
  const [guiding, setGuiding] = useState(false);
  const [guideError, setGuideError] = useState("");

  const anyForCourse = !!courseProfession && cases.some((c) => c.professions.includes(courseProfession));
  const [prof, setProf] = useState(anyForCourse ? courseProfession! : "");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // The due date is edited in the instructor's own time zone, so it is filled in after mount.
  useEffect(() => {
    if (!initial?.dueAt) return;
    const d = new Date(initial.dueAt);
    if (Number.isNaN(d.getTime())) return;
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    setDue(local);
  }, [initial?.dueAt]);

  const set = (patch: Partial<AssignmentSettings>) => setS((old) => ({ ...old, ...patch }));

  function changeType(t: AssignmentType) {
    setType(t);
    if (t === "exam") {
      const d = defaultSettings("exam");
      setS((old) => ({ ...old, hints: false, level: old.level ?? d.level, feedbackRelease: "manual", maxAttempts: 1, liveAssist: false, perturb: false, timeLimitMin: old.timeLimitMin ?? d.timeLimitMin }));
    } else if (type === "exam") {
      const d = defaultSettings(t);
      setS((old) => ({ ...old, hints: d.hints, feedbackRelease: d.feedbackRelease, maxAttempts: d.maxAttempts, perturb: d.perturb }));
    }
  }

  async function askGuide() {
    setGuiding(true);
    setGuideError("");
    try {
      const res = await fetch("/api/assignments/guide", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ courseId, request, syllabus: showSyllabus ? syllabus : "" }) });
      const j = await res.json();
      if (!res.ok || j.error) throw new Error(j.error || "The guide could not make a suggestion");
      const p = j.proposal as { title: string; instructions: string; type: AssignmentType; journeyId: string | null; caseIds: string[]; settings: AssignmentSettings };
      setTitle(p.title);
      setInstructions(p.instructions);
      setType(p.type);
      setS(p.settings);
      if (p.journeyId) {
        setTarget("journey");
        setJourneyId(p.journeyId);
      } else {
        setTarget("cases");
        setCaseIds(p.caseIds);
        // Make sure every suggested patient is visible in the list.
        if (prof && p.caseIds.some((id) => !cases.find((c) => c.id === id)?.professions.includes(prof))) setProf("");
        setQ("");
      }
      setReasons(j.reasons);
    } catch (e) {
      setGuideError((e as Error).message);
    }
    setGuiding(false);
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      const body = {
        courseId,
        title,
        instructions,
        type,
        caseIds: target === "cases" ? caseIds : [],
        journeyId: target === "journey" ? journeyId : null,
        settings: { ...s, timeLimitMin: s.timeLimitMin ?? null },
        dueAt: due ? new Date(due).toISOString() : null,
      };
      const res = await fetch(initial ? `/api/assignments/${initial.id}` : "/api/assignments", { method: initial ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json();
      if (!res.ok || j.error) throw new Error(j.error || "Could not save the assignment");
      router.push(`/faculty/courses/${courseId}/assignments/${j.id}`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  const profOptions = useMemo(() => [...new Set(cases.flatMap((c) => c.professions))].sort(), [cases]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return cases
      .filter((c) => (!prof || c.professions.includes(prof)) && (!needle || (c.title + " " + c.specialty + " " + c.summary).toLowerCase().includes(needle)))
      .sort((a, b) => Number(caseIds.includes(b.id)) - Number(caseIds.includes(a.id)) || (caseIds.includes(a.id) ? caseIds.indexOf(a.id) - caseIds.indexOf(b.id) : a.title.localeCompare(b.title)));
  }, [cases, prof, q, caseIds]);
  const hiddenSelected = caseIds.filter((id) => !shown.some((c) => c.id === id)).length;

  const exam = type === "exam";
  const timeValue = s.timeLimitMin === undefined ? "default" : String(s.timeLimitMin);
  const timeChoices = s.timeLimitMin && !TIME_CHOICES.includes(s.timeLimitMin) ? [...TIME_CHOICES, s.timeLimitMin].sort((a, b) => a - b) : TIME_CHOICES;
  const ready = title.trim() && (target === "cases" ? caseIds.length > 0 : !!journeyId);

  return (
    <div className="grid gap-5 lg:grid-cols-[22rem_1fr]">
      {/* ---------- Guide ---------- */}
      <div>
        <Card className="lg:sticky lg:top-4">
          <CardHeader title="Assignment guide" subtitle="Describe what you want students to practice. The guide suggests patients and settings; you review and change anything before saving." />
          <div className="space-y-3 p-4">
            <div>
              <Label htmlFor="guide-request">What should students practice?</Label>
              <Textarea
                id="guide-request"
                rows={5}
                value={request}
                onChange={(e) => setRequest(e.target.value)}
                maxLength={3000}
                placeholder="e.g. Second-year dietetics students, week 6. Motivational interviewing with a patient who is not ready to change. Low stakes, I want them to repeat it until it feels natural."
              />
            </div>
            {showSyllabus ? (
              <div>
                <Label htmlFor="guide-syllabus">Syllabus excerpt or learning objectives</Label>
                <Textarea id="guide-syllabus" rows={6} value={syllabus} onChange={(e) => setSyllabus(e.target.value)} maxLength={12000} placeholder="Paste the relevant part of your syllabus, unit outline or competency list." />
              </div>
            ) : (
              <button type="button" className="text-xs font-medium text-brand-700 hover:underline" onClick={() => setShowSyllabus(true)}>
                Paste a syllabus excerpt or objectives
              </button>
            )}
            <Button onClick={askGuide} disabled={guiding || (!request.trim() && !(showSyllabus && syllabus.trim()))} className="w-full">
              {guiding ? "Reading your patients…" : reasons ? "Suggest again" : "Suggest a setup"}
            </Button>
            {guiding && <p className="text-xs text-slate-500">This usually takes 10 to 30 seconds.</p>}
            {guideError && <p className="text-xs text-rose-700">{guideError}</p>}
            {reasons && !guiding && (
              <div className="space-y-2 rounded-md bg-slate-50 p-3 text-xs text-slate-700">
                <p className="font-medium text-slate-900">The form has been filled in with the guide's suggestion. Nothing is saved yet.</p>
                {reasons.gaps && (
                  <p className="rounded bg-amber-50 px-2 py-1 text-amber-900">
                    <span className="font-medium">Not covered by your published patients: </span>
                    {reasons.gaps}
                  </p>
                )}
                <p>Each suggestion has a short reason next to the field it filled in.</p>
              </div>
            )}
            <p className="text-[14px] leading-snug text-slate-500">The guide only chooses among published patients and care journeys. It cannot see student data.</p>
          </div>
        </Card>
      </div>

      {/* ---------- Form ---------- */}
      <div className="space-y-5">
        <Card>
          <CardHeader title="1. Basics" />
          <div className="space-y-4 p-4">
            <div>
              <Label htmlFor="as-title">Title</Label>
              <Input id="as-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} placeholder="e.g. Week 6: counselling a patient who is not ready to change" />
            </div>
            <div>
              <Label>Type</Label>
              <div className="grid gap-2 sm:grid-cols-3">
                {(["homework", "exam", "practice"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={type === t}
                    onClick={() => changeType(t)}
                    className={cx("rounded-md border p-3 text-left", type === t ? "border-brand-500 bg-brand-50 ring-1 ring-brand-500" : "border-slate-200 bg-white hover:bg-slate-50")}
                  >
                    <span className="block text-sm font-semibold text-slate-900">{TYPE_LABEL[t]}</span>
                    <span className="mt-0.5 block text-xs text-slate-600">{TYPE_HELP[t]}</span>
                  </button>
                ))}
              </div>
              <GuideNote>{reasons?.type}</GuideNote>
            </div>
            <div>
              <Label htmlFor="as-instructions">Instructions shown to students</Label>
              <Textarea id="as-instructions" rows={4} value={instructions} onChange={(e) => setInstructions(e.target.value)} maxLength={4000} placeholder="What to focus on. Do not give away findings." />
            </div>
            <div className="max-w-xs">
              <Label htmlFor="as-due">Due (optional)</Label>
              <Input id="as-due" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="2. Who students see"
            subtitle={target === "cases" ? `${caseIds.length} patient${caseIds.length === 1 ? "" : "s"} selected. Students complete a visit with each one.` : "One patient seen by several professions in turn, with handoffs."}
            action={
              journeys.length > 0 && (
                <div className="flex rounded-md border border-slate-300 text-xs">
                  {(["cases", "journey"] as const).map((t) => (
                    <button key={t} type="button" aria-pressed={target === t} onClick={() => setTarget(t)} className={cx("px-2.5 py-1 first:rounded-l-md last:rounded-r-md", target === t ? "bg-brand-600 text-white" : "bg-white text-slate-700 hover:bg-slate-50")}>
                      {t === "cases" ? "Patients" : "Care journey"}
                    </button>
                  ))}
                </div>
              )
            }
          />
          {target === "journey" ? (
            <div className="p-4">
              <Label htmlFor="as-journey">Care journey</Label>
              <Select id="as-journey" value={journeyId} onChange={(e) => setJourneyId(e.target.value)}>
                <option value="">Choose a published care journey</option>
                {journeys.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.title}
                  </option>
                ))}
              </Select>
              <p className="mt-2 text-xs text-slate-500">Level, hints and time limit below apply to the student's own visit in the journey.</p>
            </div>
          ) : (
            <div className="p-4">
              <div className="mb-3 flex flex-wrap gap-2">
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search patients" aria-label="Search patients" className="max-w-xs" />
                <Select value={prof} onChange={(e) => setProf(e.target.value)} aria-label="Filter by profession" className="max-w-[16rem]">
                  <option value="">All professions</option>
                  {profOptions.map((p) => (
                    <option key={p} value={p}>
                      {professionNames[p] || p}
                    </option>
                  ))}
                </Select>
              </div>
              {cases.length === 0 ? (
                <p className="text-sm text-slate-500">There are no published patients yet. Publish one in Patient Studio first.</p>
              ) : (
                <ul className="max-h-[30rem] divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200">
                  {shown.map((c) => {
                    const on = caseIds.includes(c.id);
                    return (
                      <li key={c.id} className={on ? "bg-brand-50/60" : ""}>
                        <div className="flex items-start gap-3 px-3 py-2.5">
                          <input
                            id={`case-${c.id}`}
                            type="checkbox"
                            className="mt-1 h-4 w-4 accent-[#2563eb]"
                            checked={on}
                            onChange={(e) => setCaseIds((ids) => (e.target.checked ? [...ids, c.id] : ids.filter((x) => x !== c.id)))}
                          />
                          <div className="min-w-0 flex-1">
                            <label htmlFor={`case-${c.id}`} className="block cursor-pointer text-sm font-medium text-slate-900">
                              {c.title}
                            </label>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                              <Badge tone="teal">
                                Level {c.difficulty} {LEVEL_NAMES[c.difficulty]}
                              </Badge>
                              {c.aiDraft && <Badge tone="amber">AI draft, not reviewed</Badge>}
                              <span>{c.professions.map((p) => professionNames[p] || p).join(", ")}</span>
                              {c.encounterType && <span>· {c.encounterType}</span>}
                            </div>
                            {on && <GuideNote>{reasons?.cases[c.id]}</GuideNote>}
                            {open === c.id && (
                              <div className="mt-2 space-y-1.5 text-xs text-slate-700">
                                <p>{c.summary}</p>
                                {c.objectives.length > 0 && (
                                  <ul className="list-disc space-y-0.5 pl-4">
                                    {c.objectives.map((o, i) => (
                                      <li key={i}>{o}</li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            )}
                          </div>
                          <button type="button" className="shrink-0 text-xs font-medium text-brand-700 hover:underline" aria-expanded={open === c.id} onClick={() => setOpen(open === c.id ? null : c.id)}>
                            {open === c.id ? "Hide" : "Details"}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                  {shown.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-500">No patients match that filter.</li>}
                </ul>
              )}
              {hiddenSelected > 0 && <p className="mt-2 text-xs text-amber-800">{hiddenSelected} selected patient{hiddenSelected === 1 ? " is" : "s are"} hidden by the filter above.</p>}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="3. Settings" subtitle="These are enforced by the server when a student starts a visit." />
          <div className="space-y-4 p-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <Label htmlFor="as-level">Difficulty level</Label>
                <Select id="as-level" value={s.level === null ? "" : String(s.level)} onChange={(e) => set({ level: e.target.value ? Number(e.target.value) : null })}>
                  {!exam && <option value="">Each patient's own level</option>}
                  {[1, 2, 3, 4, 5].map((l) => (
                    <option key={l} value={l}>
                      Level {l}: {LEVEL_NAMES[l]}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="as-time">Time limit</Label>
                <Select id="as-time" value={timeValue} onChange={(e) => set({ timeLimitMin: e.target.value === "default" ? undefined : Number(e.target.value) })}>
                  <option value="default">Default for the level</option>
                  <option value="0">No limit</option>
                  {timeChoices.map((m) => (
                    <option key={m} value={m}>
                      {m} minutes
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="as-attempts">Attempts allowed per patient</Label>
                <Select id="as-attempts" value={String(s.maxAttempts)} onChange={(e) => set({ maxAttempts: Number(e.target.value) })}>
                  <option value="0">Unlimited</option>
                  {[1, 2, 3, 4, 5, 10].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div>
              <p className="text-xs text-slate-600">{s.level ? LEVEL_HELP[s.level] : "Each visit uses the level the patient was written at. Difficulty changes how hard the patient is to interview, never the clinical facts."}</p>
              <GuideNote>{reasons?.level}</GuideNote>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Toggle id="as-hints" checked={s.hints} disabled={exam} onChange={(v) => set({ hints: v })} label="Coach hints" help={exam ? "Always off in exams." : "Students can ask for a nudge that never reveals a finding."} />
              <Toggle id="as-perturb" checked={s.perturb} onChange={(v) => set({ perturb: v })} label="Vary the patient on repeat attempts" help="From the second attempt the patient's mood and delivery change (rushed, anxious, withdrawn). The facts stay the same." />
              <Toggle id="as-live" checked={s.liveAssist} onChange={(v) => set({ liveAssist: v })} label="Live assist" help="You can watch these visits as they happen on Live Visits, pause one and send the student a note. Students are told when it is on." />
              {type !== "exam" && <Toggle id="as-shared" checked={!!s.sharedPatient} onChange={(v) => set({ sharedPatient: v })} label="One shared patient for the class" help="Students see the same continuing patient rather than each getting a fresh copy. The patient remembers earlier students by name and may repeat what they were told; earlier students' visit notes appear in the chart. Use it for a team of different professions seeing one patient in turn." />}
              <Toggle
                id="as-hold"
                checked={s.feedbackRelease === "manual"}
                onChange={(v) => set({ feedbackRelease: v ? "manual" : "immediate" })}
                label="Hold feedback until I release it"
                help="Students see scores and feedback only after you press Release feedback in the gradebook."
              />
            </div>
            <GuideNote>{reasons?.settings}</GuideNote>
          </div>
        </Card>

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={save} disabled={saving || !ready} size="lg">
            {saving ? "Saving…" : initial ? "Save changes" : "Create assignment"}
          </Button>
          <Button variant="ghost" onClick={() => router.back()} disabled={saving}>
            Cancel
          </Button>
          {!ready && <span className="text-xs text-slate-500">{!title.trim() ? "Add a title" : target === "cases" ? "Choose at least one patient" : "Choose a care journey"} to save.</span>}
          {error && <span className="text-sm text-rose-700">{error}</span>}
        </div>
      </div>
    </div>
  );
}
