"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import Icon from "@/components/Icon";
import { Button, LinkButton } from "@/components/ui";
import { feedbackUrl, visitUrl } from "@/lib/courses/settings";
import { TEMPERAMENTS } from "@/lib/engine/difficulty";

export interface PracticePatient {
  id: string;
  firstName: string;
  age: number | null;
  portrait: string | null;
  issue: string;
  /** Finished practice visits with this patient. */
  attempts: number;
  lastId: string | null;
  activeId: string | null;
}

const FILTERS = [
  { id: "", label: "All" },
  { id: "new", label: "Not started" },
  { id: "active", label: "In progress" },
  { id: "done", label: "Done" },
];

function PatientCard({ c }: { c: PracticePatient }) {
  const router = useRouter();
  const [level, setLevel] = useState(3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function start() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/practice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ temperament: level, caseId: c.id }) });
      const j = await res.json();
      if (!res.ok || j.error) throw new Error(j.error || "Could not start the visit");
      router.push(visitUrl(j.id));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <li className="flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-6">
      <div className="flex items-center gap-4">
        {c.portrait ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={c.portrait} alt="" className="h-20 w-20 flex-none rounded-full object-cover object-[50%_20%] ring-4 ring-brand-100" />
        ) : (
          <div className="flex h-20 w-20 flex-none items-center justify-center rounded-full bg-brand-100 text-2xl font-semibold text-brand-700">{c.firstName[0]}</div>
        )}
        <div className="min-w-0">
          <h3 className="text-[22px] font-bold leading-tight text-slate-900">
            {c.firstName}
            {c.age !== null && `, ${c.age}`}
          </h3>
          {c.issue && <p className="mt-0.5 text-sm text-slate-600">{c.issue}</p>}
        </div>
      </div>

      <div className="my-5 flex min-h-20 items-center gap-3 rounded-xl bg-slate-50 p-4 text-sm">
        <Icon name={c.attempts ? "check" : c.activeId ? "video" : "clipboard"} className="h-6 w-6 text-brand-600" />
        <div>
          <p className="font-semibold text-slate-800">{c.activeId ? "Your visit is in progress" : c.attempts ? `${c.attempts} practice visit${c.attempts === 1 ? "" : "s"} done` : "A conversation, then your write-up"}</p>
          {c.attempts > 0 && c.lastId ? (
            <a href={feedbackUrl(c.lastId)} className="text-brand-700 hover:underline">
              See your last feedback
            </a>
          ) : (
            <p className="text-slate-600">Ten minutes. Private to you.</p>
          )}
        </div>
      </div>

      <div className="mt-auto flex flex-wrap items-center justify-between gap-3">
        {c.activeId ? (
          <LinkButton href={visitUrl(c.activeId)}>
            <Icon name="video" />
            Continue
          </LinkButton>
        ) : (
          <Button onClick={start} disabled={busy}>
            <Icon name="video" />
            {busy ? "Starting…" : c.attempts ? "Practice again" : "Start"}
          </Button>
        )}
        {!c.activeId && (
          <div className="flex flex-col items-end gap-1" role="group" aria-label={`Temperament: ${TEMPERAMENTS[level]}`}>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" aria-label={TEMPERAMENTS[n]} aria-pressed={n === level} title={TEMPERAMENTS[n]} onClick={() => setLevel(n)} className="py-1.5">
                  <span className={`block h-2.5 w-6 rounded-full transition-colors ${n <= level ? "bg-brand-600" : "bg-slate-200"}`} />
                </button>
              ))}
            </div>
            <span className="text-xs text-slate-600">{TEMPERAMENTS[level]}</span>
          </div>
        )}
      </div>
      {error && <p className="mt-2 text-sm text-rose-700">{error}</p>}
    </li>
  );
}

/** Every patient as a card. The only thing a student sets is the temperament, on the five bars. */
export default function PracticeGallery({ patients }: { patients: PracticePatient[] }) {
  const [filter, setFilter] = useState("");
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return patients.filter((c) => {
      if (filter === "new" && (c.attempts > 0 || c.activeId)) return false;
      if (filter === "active" && !c.activeId) return false;
      if (filter === "done" && c.attempts === 0) return false;
      return !needle || `${c.firstName} ${c.issue}`.toLowerCase().includes(needle);
    });
  }, [patients, filter, q]);

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
            className={`rounded-full border px-4 py-2 text-sm font-semibold ${filter === f.id ? "border-brand-600 bg-brand-600" : "border-slate-300 text-slate-900 hover:bg-slate-200"}`}
          >
            {f.label}
          </button>
        ))}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or condition" aria-label="Search patients" className="ml-auto w-full rounded-full border border-slate-300 bg-white px-4 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none sm:w-72" />
      </div>
      <p className="mb-3 text-sm text-slate-600" role="status">
        {shown.length} patient{shown.length === 1 ? "" : "s"}
      </p>
      {shown.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white px-7 py-6 text-slate-600">No patients match.</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((c) => (
            <PatientCard key={c.id} c={c} />
          ))}
        </ul>
      )}
    </>
  );
}
