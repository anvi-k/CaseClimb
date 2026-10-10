"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, Button } from "@/components/ui";
import { post } from "./shared";

export interface JoinStage {
  id: string;
  order: number;
  roleTitle: string;
  clinicianName: string;
  clinicianRole: string;
  focus: string;
  simTime: string;
  visitLabel?: string;
  suggested: boolean;
}

/** "Join as ..." for each encounter of a journey. The AI plays every role the student does not take. */
export default function JoinButtons({ journeyId, stages, assignmentId }: { journeyId: string; stages: JoinStage[]; assignmentId?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  async function join(stageId: string) {
    setBusy(stageId);
    setErr("");
    const r = await post<{ id: string }>("/api/journeys/runs", { journeyId, stageId, assignmentId });
    if (r.error || !r.id) {
      setBusy("");
      return setErr(r.error || "Could not start the journey.");
    }
    router.push(`/journey/${r.id}`);
  }
  return (
    <div>
      <ol className="space-y-3">
        {stages.map((s) => (
          <li key={s.id} className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-[1fr_auto] sm:items-center">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-slate-500">Encounter {s.order}</span>
                <span className="text-xs text-slate-400">{s.simTime}{s.visitLabel ? ` · ${s.visitLabel}` : ""}</span>
                {s.suggested && <Badge tone="teal">Matches your profession</Badge>}
              </div>
              <h3 className="mt-0.5 text-base font-semibold text-slate-900">{s.roleTitle}</h3>
              <p className="mt-1 text-sm text-slate-700">{s.focus}</p>
              <p className="mt-1 text-xs text-slate-500">If you do not take this role, the AI plays {s.clinicianName} ({s.clinicianRole}).</p>
            </div>
            <Button onClick={() => join(s.id)} disabled={!!busy} variant={s.suggested ? "primary" : "secondary"}>
              {busy === s.id ? "Starting" : `Join as ${s.roleTitle.toLowerCase()}`}
            </Button>
          </li>
        ))}
      </ol>
      {err && <p className="mt-3 text-sm text-rose-700">{err}</p>}
    </div>
  );
}
