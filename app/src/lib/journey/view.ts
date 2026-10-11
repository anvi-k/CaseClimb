import { get } from "../db";
import { studentJourneyLabel } from "../courses/label";
import { messagesOf } from "../engine/encounter";
import { clinician, entriesOf, handoffsOf, linksOf, loadRun, messagesOfRun, RECORD_STAGE, resolveProfession, stageRuns, studentNameOf } from "./store";
import { stageBrief, type Chain, type ChainStep, type Handoff, type PillarRow, type RunView, type StageView, type StateEntry, type StateLink, type Synthesis } from "./types";

const OPEN = ["uncertain", "disputed", "open_question"];

/**
 * Influence chains, built only from recorded relations: an entry, the later question that drew on it,
 * what that question uncovered, who built on that, and the plan item that rests on it.
 */
export function buildChains(entries: StateEntry[], links: StateLink[], handoffs: Handoff[], synthesis: Synthesis | null, stageName: (id: string) => string): Chain[] {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const flow = links.filter((l) => byId.has(l.from) && byId.has(l.to));
  const inbound = new Map<string, StateLink[]>();
  for (const l of flow) {
    const f = byId.get(l.from)!;
    const t = byId.get(l.to)!;
    if (f.stageOrder < t.stageOrder) continue;
    inbound.set(l.to, [...(inbound.get(l.to) || []), l]);
  }
  const hasEarlierParent = (id: string) => flow.some((l) => l.from === id && byId.get(l.to)!.stageOrder <= byId.get(id)!.stageOrder && l.to !== id);
  const planItems = (synthesis?.problems || []).flatMap((p) => p.items.map((i) => ({ ...i, problem: p.title })));

  const best = (id: string, seen: Set<string>): StateLink[] => {
    let out: StateLink[] = [];
    let outSpan = -1;
    for (const l of inbound.get(id) || []) {
      if (seen.has(l.from)) continue;
      const path = [l, ...best(l.from, new Set([...seen, l.from]))];
      const span = new Set(path.map((x) => byId.get(x.from)!.stageOrder)).size;
      if (span > outSpan || (span === outSpan && path.length > out.length)) {
        out = path;
        outSpan = span;
      }
    }
    return out;
  };

  const chains: Chain[] = [];
  const nodeSets = new Map<string, Set<string>>();
  for (const root of entries) {
    if (!inbound.has(root.id) || hasEarlierParent(root.id)) continue;
    const path = best(root.id, new Set([root.id]));
    if (!path.length) continue;
    const nodes = [root, ...path.map((l) => byId.get(l.from)!)];
    const stages = new Set(nodes.map((n) => n.stageOrder));
    if (stages.size < 2) continue;
    const steps: ChainStep[] = [];
    const whoOf = (e: StateEntry) => (e.stageId === RECORD_STAGE ? "Existing record" : `${e.contributorName}, ${e.contributorRole}`);
    steps.push({ kind: "discovered", label: root.stageId === RECORD_STAGE ? "On the existing record" : root.source === "patient" ? "Patient told" : "Recorded by", detail: root.text, who: whoOf(root), stageOrder: root.stageOrder, entryId: root.id });
    const cited = (e: StateEntry) => handoffs.find((h) => h.fromStage === e.stageId && h.cites.includes(e.id));
    const h0 = cited(root);
    if (h0) steps.push({ kind: "handed_off", label: "Passed on in the SBAR handoff", detail: `To ${h0.toName}`, who: `${h0.authorName}, ${h0.authorRole}`, stageOrder: root.stageOrder });
    path.forEach((l, i) => {
      const e = nodes[i + 1];
      const prev = nodes[i];
      const cross = e.stageOrder > prev.stageOrder;
      const fromPatient = e.source === "patient" || e.kind === "result";
      if (l.evidence?.quote && (fromPatient || e.kind === "follow_up") && l.evidence.speaker === "clinician") {
        steps.push({ kind: "asked", label: cross ? "Reviewed it and asked about it" : "Asked about it", detail: l.evidence.quote, quote: l.evidence.quote, who: `${e.contributorName}, ${e.contributorRole}${l.evidence.turn ? `, turn ${l.evidence.turn}` : ""}`, stageOrder: e.stageOrder, entryId: e.kind === "follow_up" ? e.id : undefined });
        if (fromPatient) steps.push({ kind: "new_information", label: e.kind === "result" ? "New result" : "New information from the patient", detail: e.text, who: whoOf(e), stageOrder: e.stageOrder, entryId: e.id });
      } else {
        const verb = { uses: "Built on it", confirms: "Confirmed it", contradicts: "Disagreed with it", updates: "Updated it", answers: "Answered it", resolves: "Resolved it" }[l.relation];
        steps.push({ kind: "incorporated", label: verb, detail: e.text, who: whoOf(e), stageOrder: e.stageOrder, entryId: e.id });
      }
      const h = cited(e);
      if (h && i < path.length - 1 && nodes[i + 2].stageOrder > e.stageOrder) steps.push({ kind: "handed_off", label: "Passed on in the SBAR handoff", detail: `To ${h.toName}`, who: `${h.authorName}, ${h.authorRole}`, stageOrder: e.stageOrder });
    });
    const ids = new Set(nodes.map((n) => n.id));
    const item = planItems.find((p) => p.restsOn.some((id) => ids.has(id)));
    if (item) steps.push({ kind: "plan", label: "In the coordinated care plan", detail: item.action, who: item.ownerRoles.join(", "), stageOrder: 99 });
    chains.push({ id: root.id, title: root.text, steps, stagesSpanned: stages.size });
    nodeSets.set(root.id, new Set(nodes.map((n) => n.id)));
  }
  void stageName;
  // Chains that start inside an encounter tell the story best; then longer reach. Chains that mostly
  // retrace one already chosen are left out so each flow shown is a different thread.
  const fromEncounter = (c: Chain) => (byId.get(c.id)!.stageOrder > 0 ? 1 : 0);
  chains.sort((a, b) => fromEncounter(b) - fromEncounter(a) || b.stagesSpanned - a.stagesSpanned || b.steps.length - a.steps.length);
  const chosen: Chain[] = [];
  const covered = new Set<string>();
  for (const c of chains) {
    const ids = [...nodeSets.get(c.id)!];
    const fresh = ids.filter((id) => !covered.has(id)).length;
    if (chosen.length && fresh / ids.length < 0.5) continue;
    chosen.push(c);
    ids.forEach((id) => covered.add(id));
    if (chosen.length >= 6) break;
  }
  return chosen;
}

export function buildPillars(run: NonNullable<ReturnType<typeof loadRun>>, entries: StateEntry[], links: StateLink[], handoffs: Handoff[], student: string): PillarRow[] {
  const byId = new Map(entries.map((e) => [e.id, e]));
  return run.stages.map((s) => {
    const isStudent = s.id === run.row.student_stage_id;
    const mine = entries.filter((e) => e.stageId === s.id);
    const ids = new Set(mine.map((e) => e.id));
    const used = new Set(links.filter((l) => ids.has(l.from) && byId.get(l.to) && byId.get(l.to)!.stageOrder < s.order).map((l) => l.to));
    return {
      stageId: s.id,
      role: s.roleTitle,
      name: isStudent ? student : clinician(s.clinicianId).name,
      isStudent,
      used: used.size,
      contributed: mine.filter((e) => e.kind !== "follow_up").length,
      identified: mine.filter((e) => OPEN.includes(e.status)).length,
      communicated: handoffs.some((h) => h.fromStage === s.id),
    };
  });
}

export function buildView(runId: string, viewerId: string, busy: boolean): RunView | null {
  const run = loadRun(runId);
  if (!run) return null;
  const links = linksOf(runId);
  const entries = entriesOf(runId, links);
  const handoffs = handoffsOf(runId);
  const student = studentNameOf(run.row.user_id);
  const srs = stageRuns(runId);

  // Journey and case titles, and each stage's faculty-facing focus, are written for faculty and may name
  // conditions. A student viewer gets the patient, the roles and the neutral stage brief instead.
  const viewer = get<{ role: string }>("SELECT role FROM users WHERE id = ?", viewerId);
  const facultyViewer = viewer?.role === "faculty" || viewer?.role === "admin";
  const stages: StageView[] = run.stages.map((raw) => {
    const stage = facultyViewer ? raw : { ...raw, focus: stageBrief(raw, run.c.patient?.name || "", run.stages.length) };
    const sr = srs.find((x) => x.stage_id === stage.id);
    const cl = clinician(stage.clinicianId);
    const isStudent = stage.id === run.row.student_stage_id;
    const enc = sr?.encounter_id ? get<{ status: string }>("SELECT status FROM encounters WHERE id = ?", sr.encounter_id) : undefined;
    const transcript = sr?.encounter_id
      ? messagesOf(sr.encounter_id)
          .filter((m) => m.speaker === "student" || m.speaker === "patient" || m.speaker === "system")
          .map((m) => ({ id: m.id, turn: m.turn, speaker: m.speaker === "student" ? "clinician" : m.speaker === "system" ? "chart" : "patient", text: m.text }))
      : [];
    let note: string | null = null;
    try {
      note = sr?.note ? (JSON.parse(sr.note).note as string) || null : null;
    } catch {
      note = sr?.note || null;
    }
    return {
      stage,
      professionName: resolveProfession(stage).name,
      clinicianName: isStudent ? student : cl.name,
      clinicianRole: cl.role,
      isStudent,
      status: sr?.status || "pending",
      encounterId: sr?.encounter_id || null,
      encounterStatus: enc?.status || null,
      error: sr?.error || null,
      note,
      transcript,
    };
  });

  const firstOpen = stages.find((s) => s.status !== "complete");
  let next: RunView["next"];
  if (firstOpen && (firstOpen.status === "error" || firstOpen.error)) next = { kind: "error", stageId: firstOpen.stage.id, label: firstOpen.error || "This stage stopped with an error." };
  else if (firstOpen && !firstOpen.isStudent) next = { kind: "wait", stageId: firstOpen.stage.id, label: `${firstOpen.clinicianName} is seeing the patient.` };
  else if (firstOpen) {
    if (firstOpen.status === "awaiting_handoff") next = { kind: "write_handoff", stageId: firstOpen.stage.id, label: "Write your SBAR handoff." };
    else if (firstOpen.encounterStatus === "scored" || firstOpen.encounterStatus === "submitted") next = { kind: "wait", stageId: firstOpen.stage.id, label: "Adding what you found to the shared patient state. This usually takes 30 to 60 seconds." };
    else if (!firstOpen.encounterId) next = { kind: "wait", stageId: firstOpen.stage.id, label: "Preparing your visit." };
    else next = { kind: firstOpen.transcript.length ? "continue_visit" : "start_visit", stageId: firstOpen.stage.id, label: firstOpen.transcript.length ? "Continue your visit." : "Start your visit." };
  } else if (run.row.status === "complete") next = { kind: "done", label: "The journey is complete." };
  else if (run.huddle?.status === "closed" && run.row.error) next = { kind: "error", label: `Writing the care plan and evaluation did not finish (${run.row.error}). Nothing is lost; try again.` };
  else if (run.huddle?.status === "closed") next = { kind: "finish", label: "Writing the integrated care plan and your teamwork evaluation. This usually takes 60 to 90 seconds; you can leave this page and come back." };
  else next = { kind: "huddle", label: "Join the team huddle." };

  const stageName = (id: string) => run.stages.find((s) => s.id === id)?.roleTitle || "Existing record";
  const neutral = studentJourneyLabel(run.c.patient?.name, run.stages.map((s) => s.roleTitle));
  return {
    id: runId,
    status: run.row.status,
    journey: facultyViewer ? { id: run.journey.id, title: run.journey.title, summary: run.spec.summary } : { id: run.journey.id, title: neutral.title, summary: neutral.roles },
    patient: { name: run.c.patient?.name || "", age: run.c.patient?.age || 0, sex: run.c.patient?.sex || "", summary: run.c.scenario?.chiefComplaint || "" },
    caseTitle: facultyViewer ? run.c.title || "" : "",
    studentStageId: run.row.student_stage_id,
    studentName: student,
    viewerIsOwner: viewerId === run.row.user_id,
    stages,
    entries,
    links,
    handoffs,
    messages: messagesOfRun(runId),
    huddle: run.huddle,
    synthesis: run.synthesis,
    evaluation: run.evaluation,
    chains: buildChains(entries, links, handoffs, run.synthesis, stageName),
    pillars: buildPillars(run, entries, links, handoffs, student),
    busy,
    next,
    stream: { seq: 0, epoch: "" },
    error: run.row.error || null,
  };
}
