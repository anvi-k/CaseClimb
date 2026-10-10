"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge, Card, Empty, Label, Select } from "@/components/ui";
import { LEVEL_NAMES } from "@/lib/engine/difficulty";
import { feedbackUrl, visitUrl } from "@/lib/courses/settings";
import StartVisit from "./StartVisit";

export interface PracticeCase {
  id: string;
  /** Student-safe label; the faculty title never reaches this component. */
  label: string;
  specialty: string;
  professions: string[];
  difficulty: number;
  encounterType: string;
  patientFirstName: string;
  age: number | null;
  aiDraft: boolean;
  attempts: number;
  best: number | null;
  lastId: string | null;
  activeId: string | null;
}

function CaseCard({ c, professionNames }: { c: PracticeCase; professionNames: Record<string, string> }) {
  const [level, setLevel] = useState(c.difficulty);
  const [vary, setVary] = useState(c.attempts > 0);
  return (
    <Card className="flex flex-col p-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="teal">
          Level {c.difficulty} {LEVEL_NAMES[c.difficulty]}
        </Badge>
        {c.aiDraft && (
          <Badge tone="amber" title="This patient was written by AI and has not been reviewed by faculty yet.">
            AI draft, not faculty-reviewed
          </Badge>
        )}
      </div>
      <h3 className="mt-2 text-sm font-semibold leading-snug text-slate-900">
        {c.patientFirstName}
        {c.age !== null && `, ${c.age}`}
      </h3>
      <dl className="mt-2 space-y-0.5 text-xs text-slate-600">
        {c.encounterType && (
          <div>
            <dt className="inline text-slate-500">Visit: </dt>
            <dd className="inline">{c.encounterType}</dd>
          </div>
        )}
        <div>
          <dt className="inline text-slate-500">Role: </dt>
          <dd className="inline">{c.professions.map((p) => professionNames[p] || p).join(", ")}</dd>
        </div>
        {c.specialty && (
          <div>
            <dt className="inline text-slate-500">Specialty: </dt>
            <dd className="inline">{c.specialty}</dd>
          </div>
        )}
      </dl>
      <div className="mt-3 text-xs text-slate-600">
        {c.attempts === 0 ? (
          "Not attempted yet"
        ) : (
          <>
            {c.attempts} attempt{c.attempts === 1 ? "" : "s"}
            {c.best !== null && (
              <>
                {" "}
                · best <span className="font-semibold text-slate-900">{Math.round(c.best)}%</span>
              </>
            )}
            {c.lastId && (
              <>
                {" "}
                ·{" "}
                <Link href={feedbackUrl(c.lastId)} className="font-medium text-brand-700 hover:underline">
                  Last feedback
                </Link>
              </>
            )}
          </>
        )}
      </div>
      <div className="mt-auto pt-4">
        <div className="flex items-end justify-between gap-3 border-t border-slate-100 pt-3">
          <div className="min-w-0 flex-1">
            <Label htmlFor={`lvl-${c.id}`}>Difficulty for this visit</Label>
            <Select id={`lvl-${c.id}`} value={level} onChange={(e) => setLevel(Number(e.target.value))} className="py-1.5">
              {[1, 2, 3, 4, 5].map((l) => (
                <option key={l} value={l}>
                  {l} {LEVEL_NAMES[l]}
                  {l === c.difficulty ? " (written at)" : ""}
                </option>
              ))}
            </Select>
          </div>
          {c.attempts > 0 && <StartVisit body={{ caseId: c.id, mode: "practice", level, followUp: true }} label="Follow-up visit" variant="secondary" />}
          <StartVisit body={{ caseId: c.id, mode: "practice", level, perturb: c.attempts > 0 && vary }} label={c.attempts > 0 ? "Start over" : "Start visit"} />
        </div>
        {c.attempts > 0 && (
          <label className="mt-2 flex cursor-pointer items-start gap-2 text-xs text-slate-600">
            <input type="checkbox" className="mt-0.5 h-3.5 w-3.5 accent-[#2563eb]" checked={vary} onChange={(e) => setVary(e.target.checked)} />
            <span>Vary the patient this time. Their mood and delivery change; the clinical facts do not.</span>
          </label>
        )}
        {c.activeId && (
          <p className="mt-2 text-xs text-slate-600">
            You have a visit with this patient in progress.{" "}
            <Link href={visitUrl(c.activeId)} className="font-medium text-brand-700 hover:underline">
              Resume it
            </Link>
          </p>
        )}
      </div>
    </Card>
  );
}

export default function PracticeLibrary({ cases, professionNames, myProfession }: { cases: PracticeCase[]; professionNames: Record<string, string>; myProfession: string | null }) {
  const profs = useMemo(() => [...new Set(cases.flatMap((c) => c.professions))].sort((a, b) => (professionNames[a] || a).localeCompare(professionNames[b] || b)), [cases, professionNames]);
  const [prof, setProf] = useState(myProfession || "");
  const [specialty, setSpecialty] = useState("");
  const [level, setLevel] = useState("");
  const [status, setStatus] = useState("");
  const inRole = cases.filter((c) => !prof || c.professions.includes(prof));
  const specialties = [...new Set(inRole.map((c) => c.specialty).filter(Boolean))].sort();
  const shown = inRole.filter((c) => (!specialty || c.specialty === specialty) && (!level || c.difficulty === Number(level)) && (!status || (status === "new" ? c.attempts === 0 : c.attempts > 0)));
  // The role list always offers the student's own role, even before a patient exists for it.
  const roleOptions = myProfession && !profs.includes(myProfession) ? [myProfession, ...profs] : profs;

  return (
    <div>
      <div className="mb-4 grid gap-3 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Label htmlFor="f-role">Role</Label>
          <Select
            id="f-role"
            value={prof}
            onChange={(e) => {
              setProf(e.target.value);
              setSpecialty("");
            }}
          >
            <option value="">All roles</option>
            {roleOptions.map((p) => (
              <option key={p} value={p}>
                {professionNames[p] || p}
                {p === myProfession ? " (your role)" : ""}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="f-spec">Specialty</Label>
          <Select id="f-spec" value={specialty} onChange={(e) => setSpecialty(e.target.value)}>
            <option value="">All specialties</option>
            {specialties.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="f-level">Level the patient was written at</Label>
          <Select id="f-level" value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="">All levels</option>
            {[1, 2, 3, 4, 5].map((l) => (
              <option key={l} value={l}>
                {l} {LEVEL_NAMES[l]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="f-status">Your history</Label>
          <Select id="f-status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All patients</option>
            <option value="new">Not attempted yet</option>
            <option value="done">Attempted before</option>
          </Select>
        </div>
      </div>
      <p className="mb-3 text-xs text-slate-500">
        {shown.length} patient{shown.length === 1 ? "" : "s"}
        {prof && prof !== myProfession && myProfession ? ". You are browsing another role; you will act in that role for the visit." : "."}
      </p>
      {shown.length === 0 ? (
        <Empty>
          {prof && inRole.length === 0 ? `There are no published patients for ${professionNames[prof] || prof} yet. Choose "All roles" to practise with patients written for other roles.` : "No patients match those filters."}
        </Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((c) => (
            <CaseCard key={c.id} c={c} professionNames={professionNames} />
          ))}
        </div>
      )}
    </div>
  );
}
