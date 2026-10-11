"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui";

/** Start another attempt at the same patient, optionally with a persona variation. */
export function RetryButtons({ caseId, level, assignmentId, allowVariation }: { caseId: string; level: number; assignmentId: string | null; allowVariation: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function start(perturb: boolean, lvl = level, followUp = false) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/encounters", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ caseId, level: lvl, perturb, assignmentId, mode: "practice", followUp }) });
    const j = await res.json();
    if (j.id) router.push(`/encounter/${j.id}`);
    else {
      setError(j.error || "Could not start a new visit.");
      setBusy(false);
    }
  }
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => start(false)}>
          Start over with this patient
        </Button>
        {allowVariation && (
          <Button disabled={busy} variant="secondary" onClick={() => start(true)}>
            Again, with the patient in a different mood
          </Button>
        )}
        {!assignmentId && (
          <Button disabled={busy} variant="secondary" onClick={() => start(false, level, true)} title="The patient remembers this visit, what they told you and how much they trust you">
            Book a follow-up visit
          </Button>
        )}
        {!assignmentId && level < 5 && (
          <Button disabled={busy} variant="secondary" onClick={() => start(true, level + 1)}>
            Step up to level {level + 1}
          </Button>
        )}
      </div>
      {error && <p className="mt-2 text-sm text-rose-700">{error}</p>}
    </div>
  );
}

/** Shown when a visit was submitted but scoring did not finish. */
export function FinishScoring({ id }: { id: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | string>("idle");
  async function go() {
    setState("busy");
    const res = await fetch(`/api/encounters/${id}/submit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const j = await res.json();
    if (j.error) setState(j.error);
    else router.refresh();
  }
  return (
    <div>
      <Button onClick={go} disabled={state === "busy"}>
        {state === "busy" ? "Scoring, about a minute…" : "Score this visit"}
      </Button>
      {state !== "idle" && state !== "busy" && <p className="mt-2 text-sm text-rose-700">{state}</p>}
    </div>
  );
}
