import { get, newId, parse, run as sql } from "../db";
import { AI_TURNS, closeAiEncounter, createStageEncounter, runAiVisit, writeNoteAndHandoff, type StageEvent } from "./clinician";
import { closeHuddle } from "./collab";
import { extractStage, seedRecord } from "./extract";
import { evaluateSbar, evaluateStudent, saveHandoff } from "./handoff";
import { clinician, handoffsOf, loadJourney, loadRun, setStage, stageRun, stageRuns, studentNameOf, who } from "./store";
import { synthesise } from "./synthesis";
import type { Sbar, TraceEvaluation } from "./types";

// ---------- Background worker per run ----------
// A run advances on the server whether or not a browser is watching. Events are buffered so a
// page can attach late, reconnect, or stop watching ("skip ahead") without affecting the run.

type Seq = StageEvent & { seq: number; epoch: string; replay?: boolean };
interface Job {
  running: boolean;
  events: Seq[];
  listeners: Set<(e: Seq) => void>;
  /** Changes when the server restarts, so a client holding an old sequence number knows to start over. */
  epoch: string;
}
const g = globalThis as unknown as { __journeyJobs?: Map<string, Job> };
const jobs = (g.__journeyJobs ||= new Map<string, Job>());

function job(runId: string): Job {
  let j = jobs.get(runId);
  if (!j) jobs.set(runId, (j = { running: false, events: [], listeners: new Set(), epoch: Math.random().toString(36).slice(2, 10) }));
  return j;
}
function emit(runId: string, e: StageEvent) {
  const j = job(runId);
  const ev = { ...e, seq: (j.events[j.events.length - 1]?.seq || 0) + 1, epoch: j.epoch } as Seq;
  j.events.push(ev);
  if (j.events.length > 4000) j.events.splice(0, 1000);
  for (const l of j.listeners) {
    try {
      l(ev);
    } catch {
      // a closed stream; it unsubscribes itself
    }
  }
}

export const isBusy = (runId: string) => !!jobs.get(runId)?.running;
export const streamInfo = (runId: string) => {
  const j = job(runId);
  return { seq: j.events[j.events.length - 1]?.seq || 0, epoch: j.epoch };
};

/**
 * Attaches a listener. A client that reconnects with the sequence number it reached (same epoch)
 * gets what it missed. A new page gets the events of the visit in progress, marked `replay` so it
 * can draw the conversation so far without treating old events as news.
 */
export function subscribe(runId: string, after: number | null, epoch: string | null, fn: (e: Seq) => void): () => void {
  const j = job(runId);
  if (after !== null && epoch === j.epoch) {
    for (const e of j.events) if (e.seq > after) fn(e);
  } else {
    let from = -1;
    for (let i = j.events.length - 1; i >= 0; i--) if (j.events[i].type === "stage_start") { from = i; break; }
    const tail = from >= 0 ? j.events.slice(from) : [];
    // Only a visit that is still running is worth replaying.
    if (j.running && !tail.some((e) => e.type === "stage_done" || e.type === "idle")) for (const e of tail) fn({ ...e, replay: true });
  }
  j.listeners.add(fn);
  return () => j.listeners.delete(fn);
}

/** True when there is something a machine can do for this run right now. Cheap and side-effect free. */
export function hasWork(runId: string): boolean {
  const run = loadRun(runId);
  if (!run || run.row.status === "complete") return false;
  const sr = stageRuns(runId).find((s) => s.status !== "complete");
  if (!sr) return run.huddle?.status === "closed" && !run.row.error;
  if (sr.status === "error" || sr.error) return false; // waits for an explicit retry
  if (!sr.is_student) return true;
  if (!sr.encounter_id) return true;
  if (sr.status !== "ready") return false;
  return get<{ status: string }>("SELECT status FROM encounters WHERE id = ?", sr.encounter_id)?.status === "scored";
}

/**
 * Starts the worker if there is work a machine can do and nothing is already doing it. Safe to call
 * on every page load: with nothing to do it returns without starting anything or emitting an event.
 */
export function ensureProgress(runId: string) {
  const j = job(runId);
  if (j.running || !hasWork(runId)) return;
  j.running = true;
  work(runId)
    .catch((e) => {
      console.error("[journey] worker failed", e);
      emit(runId, { type: "error", message: (e as Error).message });
    })
    .finally(() => {
      j.running = false;
      emit(runId, { type: "idle" });
    });
}

async function work(runId: string) {
  for (;;) {
    const run = loadRun(runId);
    if (!run) return;
    const sr = stageRuns(runId).find((s) => s.status !== "complete");
    if (!sr) {
      // Every encounter is done. Once the huddle is closed, the plan and the evaluation are written
      // here, in the worker, so the step survives a closed tab or a server restart.
      if (run.row.status !== "complete" && run.huddle?.status === "closed" && !run.row.error) await writeFinal(runId);
      return;
    }
    const stage = run.stages.find((s) => s.id === sr.stage_id);
    if (!stage) return;
    const student = studentNameOf(run.row.user_id);
    if (sr.status === "error" || sr.error) return; // waits for an explicit retry

    if (sr.is_student) {
      if (!sr.encounter_id) {
        const encounterId = createStageEncounter(run, stage, { ai: false, visitorName: `${student}, a student` });
        setStage(runId, stage.id, { encounter_id: encounterId, status: "ready", started_at: new Date().toISOString() });
        sql("UPDATE journey_runs SET current_stage = ? WHERE id = ?", stage.order, runId);
        return;
      }
      const enc = get<{ status: string; wrapup: string | null }>("SELECT status, wrapup FROM encounters WHERE id = ?", sr.encounter_id);
      if (sr.status === "ready" && enc?.status === "scored") {
        emit(runId, { type: "phase", stageId: stage.id, label: "Adding what you found to the shared patient state (usually 30 to 60 seconds)" });
        try {
          const note = Object.values(parse<Record<string, string>>(enc.wrapup, {})).filter(Boolean).join("\n");
          await extractStage(run, stage, sr.encounter_id, note);
          setStage(runId, stage.id, { status: "awaiting_handoff", error: null });
        } catch (e) {
          console.error("[journey] extraction failed", e);
          setStage(runId, stage.id, { error: (e as Error).message });
          emit(runId, { type: "error", stageId: stage.id, message: (e as Error).message });
        }
      }
      return;
    }

    // ----- AI clinician stage -----
    try {
      const cl = clinician(stage.clinicianId);
      let encounterId = sr.encounter_id;
      let declared: { turn: number; entryIds: string[]; quote: string }[] = [];
      if (sr.status !== "visit_done" || !encounterId) {
        if (encounterId) closeAiEncounter(encounterId, "Restarted"); // an interrupted visit is discarded; nothing from it was written to the state
        encounterId = createStageEncounter(run, stage, { ai: true, visitorName: cl.name });
        setStage(runId, stage.id, { encounter_id: encounterId, status: "running", started_at: new Date().toISOString(), error: null });
        sql("UPDATE journey_runs SET current_stage = ? WHERE id = ?", stage.order, runId);
        emit(runId, { type: "stage_start", stageId: stage.id, encounterId });
        const res = await runAiVisit(run, stage, encounterId, (e) => emit(runId, e));
        declared = res.declaredUses;
        setStage(runId, stage.id, { status: "visit_done", note: JSON.stringify({ declared }) });
      } else {
        declared = parse<{ declared?: typeof declared }>(sr.note, {}).declared || [];
      }
      emit(runId, { type: "phase", stageId: stage.id, label: `${cl.name} is writing a note and handoff` });
      // Ledger entries first, so the note and SBAR are written from this stage's recorded entries.
      await extractStage(run, stage, encounterId, "", declared, { ledgerOnly: true });
      const nextStage = run.stages.find((s) => s.order === stage.order + 1) || null;
      const nextWho = nextStage ? who(run, nextStage, student) : null;
      const wrap = await writeNoteAndHandoff(run, stage, encounterId, nextWho ? { name: nextWho.name, role: nextWho.role, isStudent: nextWho.isStudent } : null);
      setStage(runId, stage.id, { note: JSON.stringify({ declared, note: wrap.note }) });
      emit(runId, { type: "phase", stageId: stage.id, label: "Updating the shared patient state" });
      await extractStage(run, stage, encounterId, wrap.note, declared);
      if (!handoffsOf(runId).some((h) => h.fromStage === stage.id)) {
        const hid = saveHandoff(run, stage, wrap.sbar, { cites: wrap.cites, unverified: wrap.unverified });
        // Worked-example evaluation of the colleague's SBAR; does not hold up the journey.
        evaluateSbar(run, hid)
          .then(() => emit(runId, { type: "updated" }))
          .catch((e) => console.error("[journey] SBAR evaluation failed", e));
      }
      closeAiEncounter(encounterId, wrap.note);
      setStage(runId, stage.id, { status: "complete", ended_at: new Date().toISOString() });
      emit(runId, { type: "stage_done", stageId: stage.id });
    } catch (e) {
      console.error("[journey] AI stage failed", e);
      setStage(runId, stage.id, { status: "error", error: (e as Error).message || "The colleague's visit stopped unexpectedly." });
      emit(runId, { type: "error", stageId: stage.id, message: (e as Error).message });
      return;
    }
  }
}

// ---------- Commands ----------

export function createRun(input: { journeyId: string; userId: string; stageId: string; assignmentId?: string | null }): string {
  const j = loadJourney(input.journeyId);
  if (!j) throw new Error("Journey not found");
  const stage = j.stages.find((s) => s.id === input.stageId);
  if (!stage) throw new Error("Choose a role to join as.");
  if (j.stages.length < 2) throw new Error("This journey has too few encounters.");
  const id = newId("jr_");
  sql("INSERT INTO journey_runs (id, journey_id, user_id, assignment_id, student_stage_id, status, current_stage) VALUES (?,?,?,?,?,'active',1)", id, j.row.id, input.userId, input.assignmentId || null, stage.id);
  for (const s of j.stages) sql("INSERT INTO journey_stage_runs (run_id, stage_id, stage_order, is_student) VALUES (?,?,?,?)", id, s.id, s.order, s.id === stage.id ? 1 : 0);
  seedRecord(loadRun(id)!);
  ensureProgress(id);
  return id;
}

export function retryStage(runId: string) {
  const sr = stageRuns(runId).find((s) => s.status !== "complete");
  if (sr?.status === "error") setStage(runId, sr.stage_id, { status: sr.note && sr.encounter_id && parse<{ declared?: unknown }>(sr.note, {}).declared ? "visit_done" : "pending", error: null });
  else if (sr?.error) setStage(runId, sr.stage_id, { error: null });
  sql("UPDATE journey_runs SET error = NULL WHERE id = ?", runId);
  ensureProgress(runId);
}

/** The learner's SBAR: stored, the stage closes, later stages start, and the SBAR is evaluated. */
export async function submitStudentHandoff(runId: string, sbar: Sbar): Promise<TraceEvaluation> {
  const run = loadRun(runId);
  if (!run) throw new Error("Run not found");
  const stage = run.stages.find((s) => s.id === run.row.student_stage_id)!;
  const sr = stageRun(runId, stage.id);
  let hid = handoffsOf(runId).find((h) => h.fromStage === stage.id)?.id;
  if (!hid) {
    if (sr?.status !== "awaiting_handoff") throw new Error("Finish your visit before writing the handoff.");
    hid = saveHandoff(run, stage, sbar);
    setStage(runId, stage.id, { status: "complete", ended_at: new Date().toISOString() });
    ensureProgress(runId);
  }
  return evaluateSbar(run, hid);
}

/**
 * Closes the huddle and hands the rest to the worker. Returns at once; the hub shows progress and,
 * if writing fails, an error with a retry. Safe to call again.
 */
export function finalize(runId: string) {
  const run = loadRun(runId);
  if (!run) throw new Error("Run not found");
  if (stageRuns(runId).some((s) => s.status !== "complete")) throw new Error("The journey still has encounters to run.");
  if (!run.huddle) throw new Error("Hold the team huddle first.");
  if (run.huddle.status !== "closed") closeHuddle(runId);
  sql("UPDATE journey_runs SET error = NULL WHERE id = ?", runId);
  ensureProgress(runId);
  return { ok: true, started: true };
}

/** The integrated plan and the learner's trace. Each part is kept once written, so a retry only redoes what failed. */
async function writeFinal(runId: string) {
  emit(runId, { type: "phase", stageId: "huddle", label: "Writing the integrated care plan and your teamwork evaluation (usually 60 to 90 seconds)" });
  let last: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const run = loadRun(runId)!;
    const [syn, ev] = await Promise.allSettled([run.synthesis ? Promise.resolve(run.synthesis) : synthesise(run), run.evaluation ? Promise.resolve(run.evaluation) : evaluateStudent(run)]);
    last = syn.status === "rejected" ? syn.reason : ev.status === "rejected" ? ev.reason : null;
    if (!last) {
      sql("UPDATE journey_runs SET status = 'complete', error = NULL, ended_at = datetime('now') WHERE id = ?", runId);
      return;
    }
    console.error("[journey] writing the plan or evaluation failed", last);
  }
  const msg = (last as Error)?.message || "Writing the care plan stopped unexpectedly.";
  sql("UPDATE journey_runs SET error = ? WHERE id = ?", msg.slice(0, 500), runId);
  emit(runId, { type: "error", message: msg });
}

export { AI_TURNS };
