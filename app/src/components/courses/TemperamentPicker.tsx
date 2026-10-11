"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { visitUrl } from "@/lib/courses/settings";

const LEVELS = [
  { name: "Easygoing", about: "Open and cooperative. Answers fully and volunteers what matters." },
  { name: "Reserved", about: "Polite but brief. Needs a follow-up question to say more." },
  { name: "Guarded", about: "Gives short answers and holds things back until you earn some trust." },
  { name: "Frustrated", about: "Impatient and irritable. Pushes back if they feel rushed or judged." },
  { name: "Very difficult", about: "Upset and distrustful. Shares little until you respond to how they feel." },
];

/** The only choice a student makes for an extra practice visit: how the patient behaves. */
export default function TemperamentPicker() {
  const router = useRouter();
  const [level, setLevel] = useState(3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const chosen = LEVELS[level - 1];

  async function start() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/practice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ temperament: level }) });
      const j = await res.json();
      if (!res.ok || j.error) throw new Error(j.error || "Could not start the visit");
      router.push(visitUrl(j.id));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-9">
      <h2 className="text-[26px] font-semibold text-slate-900">Temperament</h2>
      <input
        type="range"
        min={1}
        max={5}
        step={1}
        value={level}
        onChange={(e) => setLevel(Number(e.target.value))}
        aria-label="Patient temperament"
        aria-valuetext={chosen.name}
        className="mt-6 h-3 w-full cursor-pointer accent-brand-600"
      />
      <div className="mt-2 grid grid-cols-5 text-[15px] text-slate-600">
        {LEVELS.map((l, i) => (
          <button
            key={l.name}
            type="button"
            onClick={() => setLevel(i + 1)}
            className={`${i === 0 ? "text-left" : i === 4 ? "text-right" : "text-center"} ${i + 1 === level ? "font-semibold text-slate-900" : ""}`}
          >
            {l.name}
          </button>
        ))}
      </div>
      <div className="my-7 rounded-xl bg-slate-100 px-6 py-5">
        <p className="text-[22px] font-semibold text-slate-900">{chosen.name}</p>
        <p className="text-slate-600">{chosen.about}</p>
      </div>
      <button onClick={start} disabled={busy} className="rounded-xl bg-brand-600 px-7 py-3.5 text-[19px] font-semibold text-white hover:bg-brand-700 disabled:bg-slate-300">
        {busy ? "Finding a patient…" : "Start practice visit"}
      </button>
      {error && <p className="mt-3 text-[15px] text-rose-700">{error}</p>}
      <p className="mt-4 text-[15px] text-slate-600">Private to you. Your instructor does not see practice visits.</p>
    </div>
  );
}
