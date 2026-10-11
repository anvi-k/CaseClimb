import { run as sql } from "../db";
import { createEncounter, loadEncounter, messagesOf, runAction, runTurn } from "../engine/encounter";
import { chatJSON, MODELS } from "../llm";
import { aliasing, approvedCorpus, arr, clean, handoffTo, inboxFor, patientMemory, renderSbar, renderState, unverifiedValues } from "./context";
import { clinician, entriesOf, handoffsOf, learnerLine, personaBrief, resolveProfession, studentNameOf, type LoadedRun } from "./store";
import { stageBrief, stagePatientReason, stageReason, stageTasks, type Sbar, type Stage, type StateEntry } from "./types";

export type StageEvent =
  | { type: "stage_start"; stageId: string; encounterId: string }
  | { type: "clinician"; stageId: string; turn: number; text: string; uses: string[] }
  | { type: "patient_delta"; stageId: string; turn: number; text: string }
  | { type: "patient"; stageId: string; turn: number; text: string; newFacts: number }
  | { type: "action"; stageId: string; turn: number; text: string }
  | { type: "phase"; stageId: string; label: string }
  | { type: "stage_done"; stageId: string }
  | { type: "idle" }
  | { type: "updated" }
  | { type: "error"; stageId?: string; message: string };

export const AI_TURNS = Math.max(3, Math.min(10, Number(process.env.JOURNEY_AI_TURNS) || 5));

/** Creates the engine encounter that carries a stage, with continuity from every earlier stage. */
export function createStageEncounter(run: LoadedRun, stage: Stage, opts: { ai: boolean; visitorName: string }): string {
  const entries = entriesOf(run.row.id).filter((e) => e.stageOrder < stage.order);
  const handoff = handoffTo(run.row.id, stage.id);
  const priorContext = [handoff ? renderSbar(handoff) : "", renderState(entries, run.stages)].filter(Boolean).join("\n\n");
  const initialDisclosed = [...new Set(entries.map((e) => e.factId).filter((x): x is string => !!x))];
  return createEncounter({
    userId: run.row.user_id,
    caseId: run.journey.case_id,
    professionId: resolveProfession(stage).id,
    mode: "journey",
    // AI colleagues interview at a forgiving level so their visit is productive in a few turns;
    // the student gets the case's own difficulty, capped so a journey stays about teamwork.
    level: opts.ai ? 2 : Math.min(run.c.difficulty || 3, 3),
    knobs: { timeLimitMin: null, hints: !opts.ai },
    assignmentId: opts.ai ? null : run.row.assignment_id,
    journeyRunId: run.row.id,
    // Per-stage overrides: the source case was written for one profession, so the role, brief, tasks,
    // booked reason and the patient's own reason for today all come from the stage, never from the case.
    journey: {
      runId: run.row.id,
      stageId: stage.id,
      priorContext,
      patientMemory: patientMemory(run, stage, entries, opts.visitorName),
      roleTitle: stage.roleTitle.toLowerCase(),
      brief: stageBrief(stage, run.c.patient?.name || "", run.stages.length),
      tasks: stageTasks(stage, stage.order === 1, stage.order === run.stages.length),
      patientReason: stagePatientReason(stage),
      reason: stageReason(stage),
      ai: opts.ai,
    },
    initialDisclosed,
  });
}

const TURN_SCHEMA = {
  type: "object",
  required: ["say", "uses", "order"],
  properties: {
    say: { type: "string", description: "What you say to the patient now: 1-3 sentences, plain language, one question at a time." },
    uses: { type: "array", items: { type: "string" }, description: "At most 2 labels (e.g. E4) of entries from the record or EARLIER encounters that specifically prompted this question. Empty for general questions, introductions and your closing summary." },
    order: { type: "string", description: "Optional: name ONE check from AVAILABLE CHECKS to review or perform now. Empty string for none." },
  },
};

/** The fixed frame every AI clinician works in. Shared by the visit, the note and the handoff. */
const SETTING_RULES = `THE SETTING (fixed)
- Every encounter in this journey, yours included, is an outpatient telehealth video visit. The patient is at home before, during and after it, and will be at home for the next professional's visit.
- In this visit you can talk with the patient and review the checks listed for you. That is all. You cannot admit the patient, send them to hospital, start, stop or change a medicine, or order any test that is not in the list of available checks.
- Anything beyond that is a RECOMMENDATION to the team or to the responsible prescriber ("I recommend the prescriber reviews...", "I suggest an in-person assessment if..."), never something you have done, decided or arranged. Never write or say "I am admitting", "admit for", "I have ordered", "I started", "I stopped".
- The shared record is authoritative. Never contradict it, and never correct the patient's medication list from your own assumptions. If the patient uses an everyday name ("my water pill"), find the medicine on the medication list on file before you comment; if you cannot match it, ask, do not tell the patient they are wrong.
- Your assessment must not go beyond the evidence in the shared record and the confirmed findings of this visit. Do not escalate on the strength of something unconfirmed.`;

function clinicianSystem(run: LoadedRun, stage: Stage, turns: number) {
  const cl = clinician(stage.clinicianId);
  const p = run.c.patient;
  return `You are ${cl.name}, conducting a telehealth visit with a patient as part of an interprofessional care team in a clinical training simulation. A learner is watching to see how a good colleague works. Stay in role.

WHO YOU ARE
${personaBrief(cl)}

THIS VISIT
The patient: ${p.name}, ${p.age}, ${p.sex}. Encounter ${stage.order} of ${run.stages.length} in their care journey (${stage.simTime}${stage.visitLabel ? `, ${stage.visitLabel}` : ""}). Your role here: ${stage.roleTitle}.
Your purpose: ${stage.focus}

${SETTING_RULES}

HOW TO WORK
- You have ${turns} exchanges. Use them: open by introducing yourself and your role, then go where your profession adds something the team does not have yet.
- Read the shared record (including the documents on file and their values) and the handoff first. Do not re-ask what is already on record. Follow up on it instead: when a colleague found something relevant to your role, say so to the patient ("Dr. Lee mentioned that...") and dig one level deeper. List those entries in "uses", and only entries your words are actually about.
- If what the patient tells you does not fit the record or a colleague's entry, ask about the mismatch directly and kindly.
- Be warm and respectful. Explain why you ask before a sensitive question. No jargon without explanation. Ask one thing at a time.
- Clinical facts are ONLY what is in the shared record and in CONFIRMED IN THIS VISIT. If the patient mentions something clinical that is not in those lists, treat it as unconfirmed: do not build on it, do not repeat it back as fact, and leave it out of your summary. A CHART line that begins "Outside the case record" tells you exactly which of the patient's words were not in the approved case: treat those words as never said.
- Ask open, non-leading questions. Do not suggest symptoms, events or history that are not on record ("you came in because of...", "you mentioned...") unless the record or the confirmed list says so.
- Do not announce a diagnosis, an admission, a test order or a medication change to the patient. Your interpretation and your recommendations go in your note to the team.
- Never tell the patient a test value, dose or diagnosis that is not in the shared record or the results of this visit.
- You may review or perform checks relevant to your role by naming one in "order" (at most three in the visit). Results come from the case file. Only tell the patient you are going to look at, check, measure or examine something if you name the matching check in "order" in the same reply; never announce a check that is not in AVAILABLE CHECKS (you cannot listen to a heart or take a rhythm strip over video).
- In your final exchange, summarise what you heard, say what you will pass on to the team as recommendations, and close. Do not request a check in the final exchange.`;
}

/** Words that announce an action the visit does not allow. */
const OVERREACH = /\b(admit(ting)? (you|him|her|them|the patient|mr|mrs|ms)\b|you(('ll| will) be| are being) admitted|admit for\b|i('m| am| will|'ll| have|'ve) (now )?(admitting|admitted|ordering|ordered|starting|started|stopping|stopped|prescribing|prescribed|increasing|increased|discontinuing|discontinued|switching|switched)\b)/i;
/** Words that announce an examination or test. */
const ANNOUNCES_CHECK = /\b(i('m| am) going to|i('ll| will)|let me|i('d| would) like to|i want to)\s+(just\s+|quickly\s+|now\s+)?(check|listen to|examine|measure|take (a|your)|look at|pull up|review|run|order|get)\b/i;

/**
 * Runs a stage as an AI clinician. The clinician model only writes the clinician's lines; every
 * patient reply goes through the encounter engine, so the gatekeeper and the tier/rapport rules
 * decide what the patient reveals, exactly as they would for a student.
 */
export async function runAiVisit(run: LoadedRun, stage: Stage, encounterId: string, emit: (e: StageEvent) => void) {
  const cl = clinician(stage.clinicianId);
  const prior = entriesOf(run.row.id).filter((e) => e.stageOrder < stage.order);
  const { toAlias, resolve } = aliasing(prior);
  const handoff = handoffTo(run.row.id, stage.id);
  const inbox = inboxFor(run.row.id, stage.id);
  const system = clinicianSystem(run, stage, AI_TURNS);
  const declaredUses: { turn: number; entryIds: string[]; quote: string }[] = [];
  const enc0 = loadEncounter(encounterId)!;
  const checks = enc0.c.actions.map((a) => a.name);
  let orders = 0;

  for (let i = 1; i <= AI_TURNS; i++) {
    const enc = loadEncounter(encounterId)!;
    const msgs = messagesOf(encounterId).filter((m) => m.speaker === "student" || m.speaker === "patient" || m.speaker === "system");
    const convo = msgs.map((m) => `${m.speaker === "student" ? "YOU" : m.speaker === "patient" ? "PATIENT" : "CHART"}: ${m.text}`).join("\n");
    const doneChecks = enc.c.actions.filter((a) => enc.state.actions[a.id]).map((a) => a.name);
    // What the engine's ledger says has really been established in this visit, as opposed to anything the patient model merely said.
    const confirmed = [
      ...enc.c.facts.filter((f) => enc.state.disclosed[f.id] && enc.state.disclosed[f.id].how !== "record").map((f) => `- Patient reported: ${f.chart}`),
      ...enc.c.actions.filter((a) => enc.state.actions[a.id]).map((a) => `- ${a.name}: ${a.result}`),
    ];
    const ask = (correction = "") =>
      chatJSON<{ say: string; uses: string[]; order: string }>({
        model: MODELS.chat,
        system,
        schema: TURN_SCHEMA,
        maxTokens: 500,
        temperature: 0.6,
        messages: [
          {
            role: "user",
            text: `SHARED PATIENT RECORD SO FAR
${renderState(prior, run.stages, { aliases: toAlias })}

${handoff ? "HANDOFF YOU RECEIVED\n" + renderSbar(handoff) : "No handoff: you are the first professional in this journey."}
${inbox ? "\nMESSAGES FROM COLLEAGUES\n" + inbox : ""}

CONFIRMED IN THIS VISIT (from the case file)
${confirmed.join("\n") || "(nothing yet)"}

AVAILABLE CHECKS (${i === AI_TURNS ? 0 : 3 - orders} left): ${orders >= 3 || i === AI_TURNS ? "none" : checks.filter((c) => !doneChecks.includes(c)).join("; ")}

THIS VISIT SO FAR (exchange ${i} of ${AI_TURNS}${i === AI_TURNS ? ", your final one: summarise and close" : ""})
${convo || "(not started. The patient has just joined the call.)"}${correction ? `\n\nYOUR DRAFT REPLY WAS NOT ACCEPTABLE: ${correction} Write the reply again.` : ""}`,
          },
        ],
      });
    let out = await ask();
    // Second line of defence for the setting rules: one corrected retry, then the line is used as is.
    const problem = (o: { say: string; order: string }) =>
      OVERREACH.test(o.say || "")
        ? "This is an outpatient telehealth visit. You cannot admit the patient or order, start, stop or change anything; you may only say what you will recommend to the team."
        : ANNOUNCES_CHECK.test(o.say || "") && (!(o.order || "").trim() || i === AI_TURNS || orders >= 3)
          ? "You told the patient you would check or review something but named no check in \"order\" (or none is left). Either name one check from AVAILABLE CHECKS in \"order\", or do not announce a check at all."
          : "";
    const why = problem(out);
    if (why) {
      try {
        const second = await ask(why);
        if (!problem(second)) out = second;
      } catch (e) {
        console.error("[journey] clinician retry failed", e);
      }
    }
    const say = clean(out.say);
    if (!say) break;
    const usedIds = i === AI_TURNS ? [] : [...new Set(arr(out.uses).map(resolve).filter((x): x is string => !!x))].slice(0, 2);
    if (usedIds.length) declaredUses.push({ turn: i, entryIds: usedIds, quote: say });
    emit({ type: "clinician", stageId: stage.id, turn: i, text: say, uses: usedIds });

    let ok = false;
    for await (const ev of runTurn(encounterId, say)) {
      if (ev.type === "delta") emit({ type: "patient_delta", stageId: stage.id, turn: i, text: ev.text });
      else if (ev.type === "done") {
        ok = true;
        emit({ type: "patient", stageId: stage.id, turn: i, text: ev.text, newFacts: ev.newFactIds.length });
      } else if (ev.type === "error") throw new Error(ev.message);
    }
    if (!ok) throw new Error("The patient did not reply.");

    const order = (out.order || "").trim();
    if (order && orders < 3 && i < AI_TURNS) {
      orders++;
      try {
        const res = await runAction(encounterId, order);
        const lines = res.done.filter((d) => !d.repeat).map((d) => `${d.name}: ${d.result}`);
        if (lines.length) emit({ type: "action", stageId: stage.id, turn: i, text: lines.join("\n") });
      } catch (e) {
        console.error("[journey] order failed", e);
      }
    }
  }
  return { clinician: cl, declaredUses };
}

const WRAP_SCHEMA = {
  type: "object",
  required: ["note", "situation", "background", "assessment", "recommendation", "cites"],
  properties: {
    note: { type: "string", description: "Your visit note, 5-9 short sentences under the plain headings Findings / Assessment / Uncertain or unanswered / Recommendations." },
    situation: { type: "string" },
    background: { type: "string" },
    assessment: { type: "string" },
    recommendation: { type: "string" },
    cites: { type: "array", items: { type: "string" }, description: "Labels of the entries the handoff passes on" },
  },
};

/**
 * The AI clinician's note and SBAR handoff. The findings come from this stage's recorded entries
 * only (never from the transcript, so nothing the patient model improvised can reach the note); the
 * handoff is written against the WHOLE shared state, so it knows what earlier encounters already
 * did and what is still open. Values not found in approved content are returned so the UI can mark them.
 */
export async function writeNoteAndHandoff(run: LoadedRun, stage: Stage, encounterId: string, next: { name: string; role: string; isStudent?: boolean } | null) {
  const cl = clinician(stage.clinicianId);
  const all = entriesOf(run.row.id);
  const mine = all.filter((e) => e.stageId === stage.id);
  const prior = all.filter((e) => e.stageOrder < stage.order);
  const { toAlias, resolve } = aliasing(all);
  void encounterId;
  const student = studentNameOf(run.row.user_id);
  const studentStage = run.stages.find((s) => s.id === run.row.student_stage_id);
  const open = all.filter((e) => ["open_question", "disputed", "uncertain"].includes(e.effectiveStatus));
  const earlierHandoffs = handoffsOf(run.row.id).filter((h) => h.fromStage !== stage.id);
  const journey = run.stages
    .map((s) => `${s.order}. ${s.roleTitle} (${s.simTime}): ${s.order < stage.order ? "has seen the patient" : s.order === stage.order ? "YOU, just now" : "has not seen the patient yet"}`)
    .join("\n");
  const ask = (correction = "") =>
    chatJSON<Sbar & { note: string; cites: string[] }>({
      model: MODELS.chat,
      schema: WRAP_SCHEMA,
      maxTokens: 1500,
      temperature: 0.4,
      system: `You are ${cl.name}. You have just finished a telehealth visit and now write (1) a brief visit note and (2) an SBAR handoff to ${next ? `${next.name}, ${next.role}, who sees the patient next` : "the whole care team ahead of the team huddle"}.

${personaBrief(cl)}

${SETTING_RULES}

Rules:
- Findings: use only what is in the entries from your encounter and the earlier record. They are the complete, verified account. Do not introduce any symptom, value, dose, result, age or diagnosis that is not listed there, even if you believe it came up.
- Keep findings (what the patient reported, what a check showed) separate from your interpretation, and label the interpretation as yours.
- State plainly what you are unsure of, what does not fit, and what you could not find out.
- Write the handoff from the whole journey, not only your visit. Before you ask for anything, check EARLIER ENCOUNTERS and EARLIER HANDOFFS: do not ask anyone to do what an earlier professional has already done or arranged, and do not ask a professional who has already seen the patient to repeat their review.
- STILL OPEN lists what the team has not settled. Your Assessment or Recommendation must name the most important of those that are still open after your visit (patient safety first: possible medication errors or duplications, medicines not being taken, anything dangerous), whoever raised them, and say who should settle each.
- The Recommendation asks the receiving professional for specific things within THEIR role that have not been done yet. Everything in it is a recommendation or a request, not an action you took.
- Write in your own voice. SBAR fields are 1-3 sentences each.${next?.isStudent && studentStage ? `\n- ${learnerLine(student, studentStage.roleTitle)}` : ""}`,
      messages: [
        {
          role: "user",
          text: `PATIENT: ${run.c.patient.name}, ${run.c.patient.age}, ${run.c.patient.sex}.
YOUR ROLE IN THIS ENCOUNTER: ${stage.roleTitle}. Purpose: ${stage.focus}

THE JOURNEY
${journey}

RECORD AND EARLIER ENCOUNTERS (what was already found, done and recommended before your visit)
${renderState(prior, run.stages, { aliases: toAlias }).slice(0, 9000)}

EARLIER HANDOFFS
${earlierHandoffs.map((h) => renderSbar(h)).join("\n\n") || "(none: you are the first)"}

ENTRIES FROM YOUR ENCOUNTER
${mine.map((e) => `[${toAlias.get(e.id)}] (${e.kind}, ${e.status}) ${e.text}`).join("\n") || "(nothing new was disclosed)"}

STILL OPEN ACROSS THE WHOLE JOURNEY (uncertain, disputed or unanswered right now)
${open.map((e) => `[${toAlias.get(e.id)}] (${e.effectiveStatus}; raised by ${e.contributorRole}) ${e.text}`).join("\n") || "(nothing)"}

In "cites", give the labels of the entries your handoff passes on (from your encounter or earlier).${correction ? `\n\nYOUR DRAFT WAS NOT ACCEPTABLE: ${correction} Write the note and handoff again.` : ""}`,
        },
      ],
    });
  let out = await ask();
  const text = (o: Sbar & { note: string }) => `${o.note} ${o.situation} ${o.background} ${o.assessment} ${o.recommendation}`;
  if (OVERREACH.test(text(out))) {
    try {
      const second = await ask("It says the patient is being admitted or that you ordered, started or stopped something. This was an outpatient telehealth visit: you can only recommend. Rewrite every such statement as a recommendation for the team or the responsible prescriber to consider.");
      if (!OVERREACH.test(text(second))) out = second;
    } catch (e) {
      console.error("[journey] handoff retry failed", e);
    }
  }
  const corpus = approvedCorpus(run.c, all);
  out.note = clean(out.note);
  const sbar: Sbar = { situation: clean(out.situation), background: clean(out.background), assessment: clean(out.assessment), recommendation: clean(out.recommendation) };
  const cites = [...new Set(arr(out.cites).map(resolve).filter((x): x is string => !!x && all.some((e) => e.id === x && e.stageOrder <= stage.order)))];
  return { note: out.note || "", sbar, cites, unverified: unverifiedValues(`${out.note} ${Object.values(sbar).join(" ")}`, corpus) };
}

/** AI-stage encounters are closed without scoring so they never count as an attempt by the student. */
export function closeAiEncounter(encounterId: string, note: string) {
  sql("UPDATE encounters SET status = 'abandoned', wrapup = ?, ended_at = datetime('now') WHERE id = ?", JSON.stringify({ note }), encounterId);
}

export type { StateEntry };
