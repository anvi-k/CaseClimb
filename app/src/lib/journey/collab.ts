import { run as sql } from "../db";
import { messagesOf } from "../engine/encounter";
import { chatJSON, MODELS } from "../llm";
import { aliasing, approvedCorpus, clean, entryLine, renderState, unverifiedValues } from "./context";
import { addEntry, addLink, addMessage, clinician, entriesOf, linksOf, loadRun, messagesOfRun, personaBrief, stageRun, stageRuns, studentNameOf, type LoadedRun } from "./store";
import type { Huddle, HuddleItem, Stage, Synthesis } from "./types";

const str = { type: "string" };
const labels = { type: "array", items: str };
const OPEN = ["uncertain", "disputed", "open_question"];

/** Where in the journey the learner currently is, for stamping out-of-sequence messages. */
function currentStage(run: LoadedRun): Stage {
  const open = stageRuns(run.row.id).find((s) => s.status !== "complete");
  return run.stages.find((s) => s.id === (open?.stage_id || run.row.student_stage_id)) || run.stages[run.stages.length - 1];
}
const studentStage = (run: LoadedRun) => run.stages.find((s) => s.id === run.row.student_stage_id)!;

/** What a colleague may draw on: the shared state, plus their own visit if they have had it. */
function colleagueKnowledge(run: LoadedRun, stage: Stage) {
  const entries = entriesOf(run.row.id);
  const sr = stageRun(run.row.id, stage.id);
  const seen = sr?.status === "complete" && !!sr.encounter_id;
  const transcript = seen
    ? messagesOf(sr!.encounter_id!)
        .filter((m) => m.speaker === "student" || m.speaker === "patient" || m.speaker === "system")
        .map((m) => `${m.speaker === "student" ? "YOU" : m.speaker === "patient" ? "PATIENT" : "CHART"}: ${m.text}`)
        .join("\n")
    : "";
  return { entries, seen, transcript };
}

const CONSULT_SCHEMA = {
  type: "object",
  required: ["learner_act", "reply", "reply_act", "cites", "answers"],
  properties: {
    learner_act: { type: "string", enum: ["question", "request", "information", "checkback", "confirmation", "other"], description: "What the learner's latest message does. checkback = restates what you said to confirm they understood it; confirmation = confirms your read-back was right." },
    reply: { type: "string", description: "Your reply, 1-4 sentences, in your own voice." },
    reply_act: { type: "string", enum: ["answer", "readback", "request", "confirmation", "correction", "clarifying_question"], description: "readback = you repeat back a request or information to confirm you received it correctly; confirmation = the learner's check-back was right; correction = the learner's check-back was partly wrong and you put it right" },
    cites: { ...labels, description: "Labels of the shared-state entries your reply relies on" },
    answers: { type: "string", description: "Label of ONE unanswered question or uncertain entry that your reply settles using information already on record. Empty string if none." },
  },
};

/**
 * Out-of-sequence communication: the learner pages any colleague, earlier or later in the journey.
 * The colleague answers in persona from the shared state and (only if they have seen the patient)
 * their own visit. Speech acts are classified so closed loops can be detected from the thread.
 */
export async function consult(runId: string, toStageId: string, text: string) {
  const run = loadRun(runId);
  if (!run) throw new Error("Run not found");
  const to = run.stages.find((s) => s.id === toStageId);
  if (!to || to.id === run.row.student_stage_id) throw new Error("Choose a colleague to message.");
  const cl = clinician(to.clinicianId);
  const me = studentStage(run);
  const student = studentNameOf(run.row.user_id);
  const at = currentStage(run);
  const thread = `consult:${to.id}`;
  const { entries, seen, transcript } = colleagueKnowledge(run, to);
  const { toAlias, resolve } = aliasing(entries);
  const history = messagesOfRun(runId).filter((m) => m.thread === thread);

  const out = await chatJSON<{ learner_act: string; reply: string; reply_act: string; cites: string[]; answers: string }>({
    model: MODELS.chat,
    schema: CONSULT_SCHEMA,
    maxTokens: 700,
    temperature: 0.5,
    system: `You are ${cl.name}, a member of an interprofessional care team in a clinical training simulation. A learner on the team (${student}, acting as ${me.roleTitle}) has messaged you directly about a shared patient, outside the normal handoff order.

${personaBrief(cl)}
Your role in this patient's journey: ${to.roleTitle}. ${to.focus}
${seen ? "You have already seen this patient; your visit transcript is below." : "You have NOT seen this patient yet. You know only what is in the shared record below. Say so when asked for anything beyond it, and say what you will look into when you do see them."}

Rules:
- Ground every clinical statement in the shared record or your own visit. If it is not there, say you do not have that information and suggest who would or what to check. Never invent a finding, value, dose or result.
- Use closed-loop communication. If the learner gives you information or asks you to do something, read it back briefly to confirm, then say what you will do. If they check back correctly on something you said, confirm it. If their message is unclear, ask one clarifying question.
- Give your professional interpretation where it helps, and label it as your interpretation.
- Acknowledge what the learner contributed when it is useful to you.`,
    messages: [
      {
        role: "user",
        text: `SHARED PATIENT RECORD
${renderState(entries, run.stages, { aliases: toAlias })}
${transcript ? "\nYOUR VISIT WITH THE PATIENT\n" + transcript : ""}

THREAD SO FAR
${history.map((m) => `${m.fromIsAi ? "YOU" : "LEARNER"}: ${m.text}`).join("\n") || "(new thread)"}

LEARNER'S NEW MESSAGE
${text}`,
      },
    ],
  });

  const prev = history[history.length - 1];
  const prev2 = history[history.length - 2];
  // Loop the learner opened: learner request/information -> colleague read-back -> learner confirmation.
  const learnerCloses = (out.learner_act === "confirmation" || out.learner_act === "checkback") && prev?.fromIsAi && (prev.meta?.act === "readback" || prev.meta?.act === "correction") && !!prev2 && !prev2.fromIsAi;
  // Loop the colleague opened: colleague answer/request -> learner check-back -> colleague confirmation.
  const checkbackClosed = out.learner_act === "checkback" && out.reply_act === "confirmation";
  addMessage(runId, { thread, kind: "consult", fromRole: me.roleTitle, fromName: student, fromIsAi: false, toRole: cl.name, text, meta: { stageId: to.id, act: out.learner_act, duringStage: at.id, loop: learnerCloses ? "closed" : out.learner_act === "request" || out.learner_act === "information" ? "opened" : undefined } });

  const cites = [...new Set((out.cites || []).map(resolve).filter((x): x is string => !!x))];
  const corpus = approvedCorpus(run.c, entries) + " " + entries.map((e) => e.text).join(" ") + " " + text + " " + transcript;
  const unverified = unverifiedValues(out.reply || "", corpus);
  const reply = clean(out.reply) || "I do not have anything on that in the record.";
  addMessage(runId, { thread, kind: "consult", fromRole: to.roleTitle, fromName: cl.name, fromIsAi: true, toRole: student, text: reply, meta: { stageId: to.id, act: out.reply_act, cites, duringStage: at.id, loop: checkbackClosed ? "closed" : out.reply_act === "readback" ? "read_back" : undefined } });

  // The exchange becomes part of the shared state, attributed to the colleague, linked to what it drew on.
  const answered = resolve(out.answers);
  const target = entries.find((e) => e.id === answered && OPEN.includes(e.effectiveStatus));
  const id = addEntry({
    runId,
    kind: "consult",
    text: `Asked by ${me.roleTitle} (${text.slice(0, 160)}${text.length > 160 ? "..." : ""}): ${reply}`,
    status: !seen || unverified.length || !cites.length ? "uncertain" : "established",
    source: "consult",
    contributorRole: to.roleTitle,
    contributorName: cl.name,
    contributorIsAi: true,
    stageId: at.id,
    stageOrder: at.order,
    simTime: `${at.simTime} (message outside the handoff order)`,
    evidence: { where: "consult", quote: reply.slice(0, 400), ref: thread, verified: true },
    meta: { ...(unverified.length ? { unverifiedValues: unverified } : {}), flags: [seen ? "colleague has seen the patient" : "colleague has not seen the patient yet"] },
  });
  for (const c of cites) addLink(runId, id, c, target?.id === c ? "answers" : "uses", at.id, { where: "consult", quote: reply.slice(0, 300), ref: thread, verified: true });
  if (target && !cites.includes(target.id) && cites.length) addLink(runId, id, target.id, "answers", at.id, { where: "consult", quote: reply.slice(0, 300), ref: thread, verified: true });
  return { reply, act: out.reply_act, learnerAct: out.learner_act, loopClosed: !!(learnerCloses || checkbackClosed) };
}

/** A call-out: the learner announces critical information to the whole team; each colleague acknowledges. */
export async function callOut(runId: string, text: string) {
  const run = loadRun(runId);
  if (!run) throw new Error("Run not found");
  const me = studentStage(run);
  const student = studentNameOf(run.row.user_id);
  const at = currentStage(run);
  const others = run.stages.filter((s) => s.id !== me.id);
  const entries = entriesOf(runId);
  addMessage(runId, { thread: "callout", kind: "callout", fromRole: me.roleTitle, fromName: student, fromIsAi: false, toRole: "Whole team", text, meta: { act: "callout", duringStage: at.id, loop: "opened" } });
  const entryId = addEntry({
    runId,
    kind: "callout",
    text: `Call-out to the team: ${text}`,
    status: "established",
    source: "clinician",
    contributorRole: me.roleTitle,
    contributorName: student,
    contributorIsAi: false,
    stageId: at.id,
    stageOrder: at.order,
    simTime: `${at.simTime} (call-out)`,
    evidence: { where: "consult", quote: text.slice(0, 400), ref: "callout", verified: true },
  });
  const out = await chatJSON<{ acks: { stage: string; text: string }[] }>({
    model: MODELS.chat,
    maxTokens: 700,
    temperature: 0.4,
    schema: { type: "object", required: ["acks"], properties: { acks: { type: "array", items: { type: "object", required: ["stage", "text"], properties: { stage: { type: "string", description: "The team member's id, e.g. S2" }, text: { type: "string", description: "One or two sentences: read the call-out back and say what it changes for your part of the care. If it changes nothing for you, say so briefly." } } } } } },
    system: "A learner on an interprofessional care team has made a call-out (critical information announced to everyone at once). Write each listed team member's acknowledgement in their own voice. Each acknowledgement reads the key point back so the sender knows it was received, then says what that member will do about it within their role. Do not add clinical facts that are not in the call-out or the record.",
    messages: [
      {
        role: "user",
        text: `TEAM MEMBERS\n${others.map((s) => `S${s.order}: ${clinician(s.clinicianId).name}, ${s.roleTitle}. ${s.focus}`).join("\n")}\n\nRECORD (for context)\n${entries.slice(-40).map((e) => entryLine(e)).join("\n")}\n\nCALL-OUT FROM ${student} (${me.roleTitle})\n${text}`,
      },
    ],
  });
  for (const a of out.acks || []) {
    const s = others.find((x) => `S${x.order}` === String(a.stage).toUpperCase().trim());
    if (!s || !a.text) continue;
    addMessage(runId, { thread: "callout", kind: "callout_ack", fromRole: s.roleTitle, fromName: clinician(s.clinicianId).name, fromIsAi: true, toRole: student, text: clean(a.text), meta: { stageId: s.id, act: "readback", entryId, duringStage: at.id, loop: "read_back" } });
  }
  return { ok: true };
}

// ---------- Huddle ----------

const HUDDLE_STAGE = "huddle";
const saveHuddle = (runId: string, h: Huddle) => sql("UPDATE journey_runs SET huddle = ? WHERE id = ?", JSON.stringify(h), runId);

/**
 * Opens the huddle: the agenda is every entry still disputed, unanswered or uncertain, and each AI
 * colleague states a position on the items that touch their role, citing entries.
 */
export async function startHuddle(runId: string): Promise<Huddle> {
  const run = loadRun(runId);
  if (!run) throw new Error("Run not found");
  if (run.huddle) return run.huddle;
  const links = linksOf(runId);
  const entries = entriesOf(runId, links);
  const rank = { disputed: 0, open_question: 1, uncertain: 2 } as Record<string, number>;
  // A disagreement entry and the entry it contradicts are one issue: the disagreement entry carries it.
  const agenda = entries
    .filter((e) => OPEN.includes(e.effectiveStatus) && OPEN.includes(e.status) && e.kind !== "consult")
    .sort((a, b) => rank[a.effectiveStatus] - rank[b.effectiveStatus] || b.stageOrder - a.stageOrder)
    .slice(0, Number(process.env.JOURNEY_HUDDLE_ITEMS) || 5);
  const ai = run.stages.filter((s) => s.id !== run.row.student_stage_id);
  const { toAlias, resolve } = aliasing(entries);
  const items: HuddleItem[] = agenda.map((e) => ({ entryId: e.id, reason: e.effectiveStatus as HuddleItem["reason"], positions: [] }));

  if (items.length) {
    const out = await chatJSON<{ items: { entry: string; positions: { stage: string; text: string; cites: string[] }[] }[] }>({
      model: MODELS.smart,
      maxTokens: 3500,
      schema: {
        type: "object",
        required: ["items"],
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              required: ["entry", "positions"],
              properties: {
                entry: str,
                positions: {
                  type: "array",
                  description: "1-2 team members whose role this item touches",
                  items: { type: "object", required: ["stage", "text", "cites"], properties: { stage: { type: "string", description: "Team member id, e.g. S2" }, text: { type: "string", description: "Their position in 1-3 sentences, in their voice: what they think, how sure they are, what would settle it" }, cites: labels } },
                },
              },
            },
          },
        },
      },
      system: `An interprofessional care team is holding a huddle at the end of a patient's care journey in a clinical training simulation. For each agenda item, write the position of the one or two AI team members whose role it touches most. Where two members would reasonably see it differently because of their professional lens, let them differ; do not manufacture a conflict.

Rules: positions rest only on the shared record (give entry labels in cites only; never write a label such as E12 inside the spoken text). No new clinical facts, values or doses. Each position says how confident the member is and what information or action would settle the item. The learner will respond next, so leave the decision open.`,
      messages: [
        {
          role: "user",
          text: `TEAM MEMBERS (AI)\n${ai.map((s) => `S${s.order}: ${clinician(s.clinicianId).name}, ${s.roleTitle}. ${personaBrief(clinician(s.clinicianId)).split("\n").slice(2, 4).join(" ").slice(0, 300)}`).join("\n")}\nThe learner is ${studentNameOf(run.row.user_id)}, ${studentStage(run).roleTitle}.\n\nSHARED PATIENT RECORD\n${renderState(entries, run.stages, { aliases: toAlias })}\n\nAGENDA\n${agenda.map((e) => `${toAlias.get(e.id)} (${e.effectiveStatus}): ${e.text}`).join("\n")}`,
        },
      ],
    });
    for (const it of out.items || []) {
      const item = items.find((x) => x.entryId === resolve(it.entry));
      if (!item) continue;
      for (const p of it.positions || []) {
        const s = ai.find((x) => `S${x.order}` === String(p.stage).toUpperCase().trim());
        if (!s || !p.text) continue;
        const cl = clinician(s.clinicianId);
        const cites = [...new Set((p.cites || []).map(resolve).filter((x): x is string => !!x))];
        item.positions.push({ stageId: s.id, name: cl.name, role: s.roleTitle, text: clean(p.text), cites });
        addMessage(runId, { thread: "huddle", kind: "position", fromRole: s.roleTitle, fromName: cl.name, fromIsAi: true, text: clean(p.text), meta: { stageId: s.id, itemId: item.entryId, cites } });
      }
    }
  }
  const h: Huddle = { status: "open", items, startedAt: new Date().toISOString() };
  saveHuddle(runId, h);
  sql("UPDATE journey_runs SET status = 'huddle' WHERE id = ?", runId);
  return h;
}

/**
 * The learner proposes how to settle an agenda item; the team responds and the outcome is recorded
 * as a NEW entry that resolves (or updates) the original. Nothing is edited, so the trail remains.
 */
export async function resolveHuddleItem(runId: string, entryId: string, text: string): Promise<Huddle> {
  const run = loadRun(runId);
  if (!run || !run.huddle) throw new Error("The huddle has not started.");
  const h = run.huddle;
  const item = h.items.find((i) => i.entryId === entryId);
  if (!item) throw new Error("That item is not on the huddle agenda.");
  if (item.outcome) return h;
  const links = linksOf(runId);
  const entries = entriesOf(runId, links);
  const entry = entries.find((e) => e.id === entryId)!;
  const { toAlias, resolve } = aliasing(entries);
  const me = studentStage(run);
  const student = studentNameOf(run.row.user_id);
  const ai = run.stages.filter((s) => s.id !== me.id);
  addMessage(runId, { thread: "huddle", kind: "proposal", fromRole: me.roleTitle, fromName: student, fromIsAi: false, text, meta: { itemId: entryId, act: "information" } });

  const out = await chatJSON<{ speaker: string; teamResponse: string; decision: "resolved" | "still_open"; recorded: string; owner: string; cites: string[] }>({
    model: MODELS.chat,
    maxTokens: 800,
    temperature: 0.3,
    schema: {
      type: "object",
      required: ["speaker", "teamResponse", "decision", "recorded", "owner", "cites"],
      properties: {
        speaker: { type: "string", description: "Id (e.g. S2) of the team member best placed to respond" },
        teamResponse: { type: "string", description: "That member's spoken reply, 1-3 sentences: acknowledge the learner's point, agree or push back with a reason from the record, then confirm what the team is recording (closed loop)." },
        decision: { type: "string", enum: ["resolved", "still_open"], description: "resolved only if the record plus the learner's proposal genuinely settle it; still_open if it needs information nobody has yet" },
        recorded: { type: "string", description: "The one-sentence outcome to write to the shared patient state. If still open: what remains unknown and what will be done to find out." },
        owner: { type: "string", description: "Role title of who owns the follow-up" },
        cites: labels,
      },
    },
    system: `You are the AI members of an interprofessional care team in a huddle. The learner has proposed how to settle an agenda item. Respond as the member best placed to, honestly: agree when the proposal is sound and supported by the record, push back when it is not, and never settle a question by inventing a fact. Entry labels (E12) go in cites only, never in the spoken or recorded text. An item that needs information the team does not have stays open with an owner and a next step. No values, doses or results that are not in the record.`,
    messages: [
      {
        role: "user",
        text: `TEAM MEMBERS\n${ai.map((s) => `S${s.order}: ${clinician(s.clinicianId).name}, ${s.roleTitle}`).join("\n")}\nLearner: ${student}, ${me.roleTitle}\n\nSHARED PATIENT RECORD\n${renderState(entries, run.stages, { aliases: toAlias })}\n\nAGENDA ITEM ${toAlias.get(entryId)} (${entry.effectiveStatus}): ${entry.text}\nPositions already given:\n${item.positions.map((p) => `${p.name}: ${p.text}`).join("\n") || "(none)"}\n\nLEARNER'S PROPOSAL\n${text}`,
      },
    ],
  });

  const sp = ai.find((x) => `S${x.order}` === String(out.speaker).toUpperCase().trim()) || ai[0];
  const cl = clinician(sp.clinicianId);
  out.teamResponse = clean(out.teamResponse);
  out.recorded = clean(out.recorded);
  const cites = [...new Set((out.cites || []).map(resolve).filter((x): x is string => !!x && x !== entryId))];
  addMessage(runId, { thread: "huddle", kind: "response", fromRole: sp.roleTitle, fromName: cl.name, fromIsAi: true, text: out.teamResponse, meta: { stageId: sp.id, itemId: entryId, cites, act: "readback", loop: "closed" } });
  const corpus = approvedCorpus(run.c, entries) + " " + entries.map((e) => e.text).join(" ") + " " + text;
  const unverified = unverifiedValues(out.recorded || "", corpus);
  const decision = out.decision === "resolved" && !unverified.length ? "resolved" : "still_open";
  const order = run.stages.length + 1;
  const newId = addEntry({
    runId,
    kind: decision === "resolved" ? "resolution" : "open_question",
    text: out.recorded || text,
    status: decision === "resolved" ? "resolved" : "open_question",
    source: "huddle",
    contributorRole: "Team huddle",
    contributorName: `${student} with ${cl.name}`,
    contributorIsAi: false,
    stageId: HUDDLE_STAGE,
    stageOrder: order,
    simTime: "Team huddle, after the last encounter",
    evidence: { where: "huddle", quote: text.slice(0, 400), ref: entryId, verified: true },
    meta: { owner: out.owner || "", ...(unverified.length ? { unverifiedValues: unverified } : {}) },
  });
  const ev = { where: "huddle" as const, quote: (out.teamResponse || "").slice(0, 300), ref: entryId, verified: true };
  if (decision === "resolved") {
    addLink(runId, newId, entryId, "resolves", HUDDLE_STAGE, ev);
    // Settle both sides of a disagreement.
    for (const l of links) {
      if (l.relation !== "contradicts") continue;
      if (l.from === entryId) addLink(runId, newId, l.to, "resolves", HUDDLE_STAGE, ev);
      if (l.to === entryId) addLink(runId, newId, l.from, "resolves", HUDDLE_STAGE, ev);
    }
  } else addLink(runId, newId, entryId, "updates", HUDDLE_STAGE, ev);
  for (const c of cites) addLink(runId, newId, c, "uses", HUDDLE_STAGE, ev);
  item.outcome = { decision, text: out.recorded || text, entryId: newId, owner: out.owner || "", teamResponse: out.teamResponse || "" };
  saveHuddle(runId, h);
  return h;
}

export function closeHuddle(runId: string) {
  const run = loadRun(runId);
  if (!run?.huddle) throw new Error("The huddle has not started.");
  const h = { ...run.huddle, status: "closed" as const, closedAt: new Date().toISOString() };
  saveHuddle(runId, h);
}

/** Collaborative change to the care plan after it is drafted: the learner proposes, the owning colleague answers. */
export async function proposePlanChange(runId: string, itemId: string, text: string): Promise<Synthesis> {
  const run = loadRun(runId);
  if (!run?.synthesis) throw new Error("The care plan has not been written yet.");
  const syn = run.synthesis;
  const problem = syn.problems.find((p) => p.items.some((i) => i.id === itemId));
  const item = problem?.items.find((i) => i.id === itemId);
  if (!problem || !item) throw new Error("Plan item not found.");
  const entries = entriesOf(runId);
  const { toAlias, resolve } = aliasing(entries);
  const me = studentStage(run);
  const student = studentNameOf(run.row.user_id);
  const ai = run.stages.filter((s) => s.id !== me.id);
  const out = await chatJSON<{ speaker: string; response: string; accepted: boolean; revisedAction: string; ownerRoles: string[]; cites: string[] }>({
    model: MODELS.chat,
    maxTokens: 700,
    temperature: 0.3,
    schema: {
      type: "object",
      required: ["speaker", "response", "accepted", "revisedAction", "ownerRoles", "cites"],
      properties: {
        speaker: { type: "string", description: "Id (e.g. S2) of the team member who owns or is closest to this plan item" },
        response: { type: "string", description: "Their reply to the learner in 1-3 sentences; read back the change if accepting" },
        accepted: { type: "boolean" },
        revisedAction: { type: "string", description: "The plan item's new wording if accepted (may refine the learner's wording); empty if not accepted" },
        ownerRoles: { type: "array", items: str },
        cites: labels,
      },
    },
    system: "You are the AI members of an interprofessional care team. A learner proposes a change to one item of the shared care plan. Respond as the member who owns or is closest to that item. Accept changes that are consistent with the shared record and the patient's goals, and refine the wording; decline with a reason from the record when they are not. Do not introduce clinical values, doses or facts that are not in the record or the learner's proposal.",
    messages: [
      {
        role: "user",
        text: `TEAM MEMBERS\n${ai.map((s) => `S${s.order}: ${clinician(s.clinicianId).name}, ${s.roleTitle}`).join("\n")}\nLearner: ${student}, ${me.roleTitle}\n\nSHARED PATIENT RECORD\n${renderState(entries, run.stages, { aliases: toAlias })}\n\nPLAN PROBLEM: ${problem.title}\nCURRENT ITEM: ${item.action}\nOwners: ${item.ownerRoles.join(", ")}\nRests on: ${item.restsOn.map((id) => toAlias.get(id)).join(", ")}\n\nLEARNER'S PROPOSED CHANGE\n${text}`,
      },
    ],
  });
  const sp = ai.find((x) => `S${x.order}` === String(out.speaker).toUpperCase().trim()) || ai[0];
  const cl = clinician(sp.clinicianId);
  out.response = clean(out.response);
  out.revisedAction = clean(out.revisedAction);
  addMessage(runId, { thread: "plan", kind: "proposal", fromRole: me.roleTitle, fromName: student, fromIsAi: false, text, meta: { itemId, act: "request", loop: "opened" } });
  addMessage(runId, { thread: "plan", kind: "response", fromRole: sp.roleTitle, fromName: cl.name, fromIsAi: true, text: out.response, meta: { stageId: sp.id, itemId, act: out.accepted ? "readback" : "answer", loop: out.accepted ? "closed" : undefined } });
  const corpus = approvedCorpus(run.c, entries) + " " + entries.map((e) => e.text).join(" ") + " " + text;
  if (out.accepted && out.revisedAction?.trim() && !unverifiedValues(out.revisedAction, corpus).length) {
    const cites = [...new Set((out.cites || []).map(resolve).filter((x): x is string => !!x))];
    const entryId = addEntry({
      runId,
      kind: "plan_change",
      text: `Care plan changed (${problem.title}): "${item.action}" is now "${out.revisedAction.trim()}". Reason: ${text.slice(0, 240)}`,
      status: "established",
      source: "huddle",
      contributorRole: "Team huddle",
      contributorName: `${student} with ${cl.name}`,
      contributorIsAi: false,
      stageId: HUDDLE_STAGE,
      stageOrder: run.stages.length + 1,
      simTime: "Team huddle, care-plan review",
      evidence: { where: "huddle", quote: text.slice(0, 400), ref: itemId, verified: true },
    });
    for (const c of [...new Set([...cites, ...item.restsOn])]) addLink(runId, entryId, c, cites.includes(c) && !item.restsOn.includes(c) ? "uses" : "updates", HUDDLE_STAGE, { where: "huddle", quote: out.response.slice(0, 300), ref: itemId, verified: true });
    item.revisions = [...(item.revisions || []), { at: new Date().toISOString(), by: `${student} with ${cl.name}`, from: item.action, to: out.revisedAction.trim(), reason: text }];
    item.action = out.revisedAction.trim();
    if (out.ownerRoles?.length) item.ownerRoles = out.ownerRoles;
    item.restsOn = [...new Set([...item.restsOn, ...cites, entryId])];
    sql("UPDATE journey_runs SET synthesis = ? WHERE id = ?", JSON.stringify(syn), runId);
  }
  return syn;
}
