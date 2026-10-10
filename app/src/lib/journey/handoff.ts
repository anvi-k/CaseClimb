import { get, newId, parse, run as sql } from "../db";
import { messagesOf } from "../engine/encounter";
import { chatJSON, MODELS } from "../llm";
import { arr, handoffTo, renderSbar, renderState } from "./context";
import { entriesOf, handoffsOf, linksOf, messagesOfRun, quoteIn, stageRun, studentNameOf, who, type LoadedRun } from "./store";
import { BEHAVIOURS, SBAR_FIELDS, type BehaviourResult, type Handoff, type Observed, type Sbar, type Stage, type TraceEvaluation } from "./types";

export function saveHandoff(run: LoadedRun, stage: Stage, sbar: Sbar, opts: { cites?: string[]; unverified?: string[] } = {}): string {
  const next = run.stages.find((s) => s.order === stage.order + 1) || null;
  const student = studentNameOf(run.row.user_id);
  const from = who(run, stage, student);
  const to = next ? who(run, next, student) : null;
  const id = newId("ho_");
  sql(
    "INSERT INTO handoffs (id, run_id, from_stage, to_stage, author_role, author_is_ai, sbar) VALUES (?,?,?,?,?,?,?)",
    id,
    run.row.id,
    stage.id,
    next?.id || null,
    stage.roleTitle,
    from.isAi ? 1 : 0,
    JSON.stringify({ ...sbar, authorName: from.name, toName: to ? `${to.name} (${to.role})` : "the care team", cites: opts.cites || [], unverified: opts.unverified || [] }),
  );
  return id;
}

const str = { type: "string" };
const SBAR_SCHEMA = {
  type: "object",
  required: ["behaviours", "summary"],
  properties: {
    behaviours: {
      type: "array",
      items: {
        type: "object",
        required: ["key", "observed", "section", "quote", "feedback"],
        properties: {
          key: str,
          observed: { type: "string", enum: ["yes", "no", "na"] },
          section: { type: "string", enum: ["situation", "background", "assessment", "recommendation", "none"], description: "The SBAR section where the behaviour is shown, or where it should have been" },
          quote: { type: "string", description: "Words copied EXACTLY from that section that show the behaviour. Empty when not observed." },
          feedback: { type: "string", description: "1-2 sentences: what was done or missed and exactly what to write next time" },
        },
      },
    },
    summary: { type: "string", description: "2 sentences on how usable this handoff is for the receiver" },
  },
};

const EVAL_RULES = `You evaluate interprofessional communication in a clinical training simulation against TeamSTEPPS-aligned behaviours. You produce an explainable behavioural trace, not a score.

Rules:
- For each behaviour decide: observed "yes", "no", or "na" (the situation gave no opportunity).
- "yes" requires a quote copied exactly from the stated location. If you cannot quote it, it is "no".
- For "no", name the location where it should have appeared and say exactly what was missing.
- Use "na", not "no", when nothing in the encounter called for the behaviour (for example, no safety concern arose, so there was nothing to escalate).
- Quote one continuous passage. Do not stitch separate sentences together and do not paraphrase.
- Feedback is concrete and kind: what the receiver could or could not do with what was written, and example wording.
- Judge against what was actually known in this encounter (listed for you). Do not expect things that were never found.
- A blank SBAR section cannot show any behaviour. If Recommendation is blank, "next action requested" is "no".`;

/** Evaluation accepts a shorter verbatim run than state extraction: the judgement is the evaluator's, the words must still be the author's. */
const said = (quote: string, text: string) => quoteIn(quote, text, 4);

function check(observed: Observed, quote: string, located: boolean, feedback: string): Pick<BehaviourResult, "observed" | "verified" | "feedback"> {
  // "Observed" needs the author's own words. With no quote at all the evaluator's comment stands as a plain "not observed".
  if (observed === "yes" && !(quote || "").trim()) return { observed: "no", verified: false, feedback };
  if (observed === "yes" && !located) return { observed: "no", verified: false, feedback: `Not credited: the words the evaluator quoted for this could not be found in what was written or said. The evaluator's comment: ${feedback}` };
  return { observed, verified: observed === "yes" ? true : !!quote && located, feedback };
}

/** The summary is written last, from the checked results, so it cannot praise something that was not credited. */
async function summarise(subject: string, what: string, behaviours: BehaviourResult[], voice: string, fallback: string): Promise<string> {
  const lines = behaviours.map((b) => `- ${BEHAVIOURS.find((x) => x.key === b.key)?.label}: ${b.observed === "yes" ? "OBSERVED" : b.observed === "na" ? "no opportunity" : "NOT OBSERVED"}. ${b.feedback.replace(/^Not credited:[^.]*\.\s*The evaluator's comment:\s*/, "(not credited; quoted words not found) ")}`).join("\n");
  try {
    const out = await chatJSON<{ summary: string }>({
      model: MODELS.fast,
      maxTokens: 400,
      temperature: 0.2,
      schema: { type: "object", required: ["summary"], properties: { summary: { type: "string" } } },
      system: `Write a 2-4 sentence summary of ${what} for a clinical training simulation. Use ONLY the per-behaviour results given. Never praise a behaviour marked NOT OBSERVED, and never say something is missing when it is marked OBSERVED. Name the one or two most useful things to do differently. ${voice} No scores, no lists.`,
      messages: [{ role: "user", text: `SUBJECT: ${subject}\n\nRESULTS\n${lines}` }],
    });
    if (out.summary?.trim()) return out.summary.trim();
  } catch (e) {
    console.error("[journey] summary failed", e);
  }
  const no = behaviours.filter((b) => b.observed === "no").map((b) => BEHAVIOURS.find((x) => x.key === b.key)?.label?.toLowerCase());
  return `${behaviours.filter((b) => b.observed === "yes").length} of ${behaviours.filter((b) => b.observed !== "na").length} applicable behaviours were observed.${no.length ? ` Not observed: ${no.join(", ")}.` : ""} ${fallback}`.trim();
}

/** Communication behaviours judged from one SBAR. Used for every handoff, AI or student. */
export async function evaluateSbar(run: LoadedRun, handoffId: string): Promise<TraceEvaluation> {
  const h = handoffsOf(run.row.id).find((x) => x.id === handoffId);
  if (!h) throw new Error("Handoff not found");
  const stage = run.stages.find((s) => s.id === h.fromStage)!;
  const entries = entriesOf(run.row.id);
  const mine = entries.filter((e) => e.stageId === stage.id);
  const earlier = entries.filter((e) => e.stageOrder < stage.order);
  // What was open when this handoff was written (later entries are not held against the author).
  const openThen = entries.filter((e) => e.stageOrder <= stage.order && ["open_question", "disputed", "uncertain"].includes(e.status));
  const defs = BEHAVIOURS.filter((b) => b.sbar);
  const voice = h.authorIsAi
    ? `Feedback is written in the third person about ${h.authorName} ("${h.authorName} states...", "the handoff could have..."), because a learner reads it as a worked example. Never address the author as "you".`
    : 'Feedback is addressed to the author as "you".';
  const raw = await chatJSON<{ behaviours: { key: string; observed: Observed; section: string; quote: string; feedback: string }[]; summary: string }>({
    model: MODELS.smart,
    system: `${EVAL_RULES}
- ${voice}
- Check every request in the Recommendation against EARLIER ENCOUNTERS. Asking for something an earlier professional has already done or arranged, or asking a professional who has already seen the patient to repeat their review, is not a usable next action: mark "next action requested" as "no" and say what had already been done.
- Check the handoff against STILL OPEN. If a safety-relevant open item (a possible medication error or duplication, a medicine not being taken, an unexplained dangerous finding) is not mentioned anywhere in the SBAR, "uncertainty stated" is "no" and the feedback names the omitted item.`,
    schema: SBAR_SCHEMA,
    maxTokens: 2500,
    messages: [
      {
        role: "user",
        text: `HANDOFF: ${h.authorName} (${h.authorRole}) to ${h.toName}.

SBAR
Situation: ${h.sbar.situation || "(blank)"}
Background: ${h.sbar.background || "(blank)"}
Assessment: ${h.sbar.assessment || "(blank)"}
Recommendation: ${h.sbar.recommendation || "(blank)"}

WHAT WAS LEARNED IN THE AUTHOR'S ENCOUNTER (so you can judge whether the important findings and uncertainties were passed on)
${mine.map((e) => `- (${e.kind}, ${e.effectiveStatus}${e.meta?.importance ? ", " + e.meta.importance : ""}) ${e.text}`).join("\n") || "(nothing recorded)"}

EARLIER ENCOUNTERS (what had already been found, done and recommended before the author's visit; the existing record is omitted)
${renderState(earlier.filter((e) => e.stageOrder > 0), run.stages).slice(0, 6000) || "(none: the author was first)"}

STILL OPEN WHEN THIS HANDOFF WAS WRITTEN (uncertain, disputed or unanswered)
${openThen.map((e) => `- (${e.status}; raised by ${e.contributorRole}) ${e.text}`).join("\n") || "(nothing)"}

BEHAVIOURS TO EVALUATE (return one result per key, same order)
${defs.map((b) => `${b.key}: ${b.label}. ${b.question}`).join("\n")}`,
      },
    ],
  });
  const results = arr<{ key: string; observed: Observed; section: string; quote: string; feedback: string }>(raw.behaviours);
  const behaviours: BehaviourResult[] = defs.map((b) => {
    const r = results.find((x) => x.key === b.key);
    if (!r) return { key: b.key, observed: "no", location: "SBAR", quote: "", verified: false, feedback: "Not evaluated." };
    let section = SBAR_FIELDS.find((f) => f.key === r.section);
    let located = !!section && said(r.quote, h.sbar[section.key]);
    if (!located && r.quote) {
      const found = SBAR_FIELDS.find((f) => said(r.quote, h.sbar[f.key]));
      if (found) {
        section = found;
        located = true;
      }
    }
    const c = check(r.observed, r.quote, located, r.feedback || "");
    return { key: b.key, ...c, location: section ? `SBAR -> ${section.label}` : "SBAR", quote: located ? r.quote : "" };
  });
  const blank = SBAR_FIELDS.filter((f) => !h.sbar[f.key].trim()).map((f) => f.label);
  const summary = await summarise(
    `${h.authorName} (${h.authorRole}), SBAR handoff to ${h.toName}.${blank.length ? ` Sections left blank: ${blank.join(", ")}.` : ""}`,
    "how usable one SBAR handoff is for the professional receiving it",
    behaviours,
    h.authorIsAi ? `Write in the third person about ${h.authorName}; never say "you".` : 'Address the author as "you".',
    blank.length ? `Left blank: ${blank.join(", ")}.` : "",
  );
  const ev: TraceEvaluation = { scope: "sbar", subject: `${h.authorName} (${h.authorRole})`, behaviours, summary, evaluatedAt: new Date().toISOString() };
  sql("UPDATE handoffs SET evaluation = ? WHERE id = ?", JSON.stringify(ev), handoffId);
  return ev;
}

const STAGE_SCHEMA = {
  type: "object",
  required: ["behaviours", "summary"],
  properties: {
    behaviours: {
      type: "array",
      items: {
        type: "object",
        required: ["key", "observed", "source", "quote", "feedback"],
        properties: {
          key: str,
          observed: { type: "string", enum: ["yes", "no", "na"] },
          source: { type: "string", enum: ["visit", "note", "sbar", "consult", "huddle", "none"], description: "Which labelled source the evidence is in (or where it should have been)" },
          turn: { type: "integer", description: "Turn number when source = visit" },
          quote: { type: "string", description: "The learner's words copied EXACTLY from that source. Empty when not observed." },
          feedback: { type: "string", description: "1-2 sentences, concrete, with example wording" },
        },
      },
    },
    summary: { type: "string", description: "3-4 sentences on how the learner worked as a member of this team" },
  },
};

/**
 * The learner's full behavioural trace for the run: their visit, note, SBAR, consults and huddle.
 * Communication behaviours are carried over from the SBAR evaluation so the two never disagree.
 */
export async function evaluateStudent(run: LoadedRun): Promise<TraceEvaluation> {
  const runId = run.row.id;
  const stage = run.stages.find((s) => s.id === run.row.student_stage_id)!;
  const sr = stageRun(runId, stage.id);
  const student = studentNameOf(run.row.user_id);
  const entries = entriesOf(runId);
  const links = linksOf(runId);
  const handoffs = handoffsOf(runId);
  const mineH = handoffs.find((h) => h.fromStage === stage.id) || null;
  const received = handoffTo(runId, stage.id);
  const enc = sr?.encounter_id ? get<{ wrapup: string | null }>("SELECT wrapup FROM encounters WHERE id = ?", sr.encounter_id) : undefined;
  const msgs = sr?.encounter_id ? messagesOf(sr.encounter_id).filter((m) => m.speaker === "student" || m.speaker === "patient" || m.speaker === "system") : [];
  const note = Object.values(parse<Record<string, string>>(enc?.wrapup, {})).filter(Boolean).join("\n");
  const team = messagesOfRun(runId);
  const consults = team.filter((m) => m.thread.startsWith("consult:") || m.kind === "callout" || m.kind === "callout_ack");
  const openedState = team.some((m) => m.kind === "state_opened");
  const huddle = team.filter((m) => m.thread === "huddle");
  const byId = new Map(entries.map((e) => [e.id, e]));
  const myEntryIds = new Set(entries.filter((e) => e.stageId === stage.id).map((e) => e.id));
  const used = links.filter((l) => l.relation === "uses" && l.stageId === stage.id && myEntryIds.has(l.from) && byId.get(l.to) && byId.get(l.to)!.stageOrder < stage.order);
  const priorOpen = entries.filter((e) => e.stageOrder < stage.order && ["uncertain", "disputed", "open_question"].includes(e.status));

  let sbarEval = mineH?.evaluation || null;
  if (mineH && !sbarEval) sbarEval = await evaluateSbar(run, mineH.id);
  const defs = BEHAVIOURS.filter((b) => !b.sbar);

  const sbarText = mineH ? SBAR_FIELDS.map((f) => `${f.label}: ${mineH.sbar[f.key]}`).join("\n") : "";
  const consultText = consults.map((m) => `${m.fromIsAi ? m.fromName : "LEARNER"} -> ${m.toRole || "team"}: ${m.text}`).join("\n");
  const huddleText = huddle.map((m) => `${m.fromIsAi ? m.fromName : "LEARNER"}: ${m.text}`).join("\n");

  const raw = await chatJSON<{ behaviours: { key: string; observed: Observed; source: string; turn?: number; quote: string; feedback: string }[]; summary: string }>({
    model: MODELS.smart,
    system: EVAL_RULES + "\n- Feedback is addressed to the learner as \"you\".\n- Only the LEARNER's own words count as evidence of the learner's behaviour. Colleagues' words are context.\n- When the source is the visit, give the turn number shown in the transcript ([T3] is turn 3). There is no turn 0.",
    schema: STAGE_SCHEMA,
    maxTokens: 5000,
    messages: [
      {
        role: "user",
        text: `LEARNER: ${student}, acting as ${stage.roleTitle} in encounter ${stage.order} of ${run.stages.length}. Purpose of their encounter: ${stage.focus}

WHAT THE LEARNER RECEIVED
${received ? renderSbar(received) : "No handoff (first encounter)."}
Earlier entries that were uncertain, disputed or unanswered when the learner started:
${priorOpen.map((e) => `- (${e.status}) ${e.text}`).join("\n") || "(none)"}

SYSTEM-RECORDED FACTS ABOUT THE LEARNER'S USE OF PRIOR INFORMATION (reliable)
- ${openedState ? "The learner opened the Care team tab (shared patient state and incoming handoff) during their visit." : "The learner did not open the Care team tab (shared patient state and incoming handoff) during their visit."}
${used.length ? used.map((l) => `- Turn ${l.evidence?.turn}: built on "${byId.get(l.to)!.text}" (from ${byId.get(l.to)!.contributorName})`).join("\n") : "- No turn in the learner's visit was linked to an earlier entry."}

SOURCE visit: THE LEARNER'S VISIT
${msgs.map((m) => `[T${m.turn}] ${m.speaker === "student" ? "LEARNER" : m.speaker === "patient" ? "PATIENT" : "CHART"}: ${m.text}`).join("\n") || "(no conversation)"}

SOURCE note: THE LEARNER'S WRITTEN NOTE
${note || "(blank)"}

SOURCE sbar: THE LEARNER'S SBAR HANDOFF
${sbarText || "(not written)"}

SOURCE consult: MESSAGES BETWEEN THE LEARNER AND COLLEAGUES OUTSIDE THE FIXED ORDER
${consultText || "(the learner did not contact any colleague)"}

SOURCE huddle: TEAM HUDDLE
${huddleText || "(no huddle contributions)"}

BEHAVIOURS TO EVALUATE (one result per key, same order)
${defs.map((b) => `${b.key}: [${b.domain}] ${b.label}. ${b.question}`).join("\n")}`,
      },
    ],
  });

  const visitText = (turn?: number) => msgs.filter((m) => m.speaker === "student" && (!turn || m.turn === turn)).map((m) => m.text);
  const sources: { key: string; label: (turn?: number) => string; texts: (turn?: number) => string[] }[] = [
    { key: "visit", label: (t) => (t && t > 0 ? `Visit, turn ${t}` : "Visit"), texts: visitText },
    { key: "note", label: () => "Written note", texts: () => [note] },
    { key: "sbar", label: () => "SBAR handoff", texts: () => (mineH ? Object.values(mineH.sbar) : []) },
    { key: "consult", label: () => "Messages with colleagues", texts: () => consults.filter((m) => !m.fromIsAi).map((m) => m.text) },
    { key: "huddle", label: () => "Team huddle", texts: () => huddle.filter((m) => !m.fromIsAi).map((m) => m.text) },
  ];
  const locate = (source: string, turn: number | undefined, quote: string): string | null => {
    const s = sources.find((x) => x.key === source);
    if (s && s.texts(turn).some((t) => said(quote, t))) return detail(s.key, turn, quote);
    if (s?.key === "visit") {
      const m = msgs.find((x) => x.speaker === "student" && said(quote, x.text));
      if (m) return detail("visit", m.turn, quote);
    }
    for (const o of sources) if (o.texts(undefined).some((t) => said(quote, t))) return detail(o.key, o.key === "visit" ? msgs.find((x) => x.speaker === "student" && said(quote, x.text))?.turn : undefined, quote);
    return null;
  };
  function detail(key: string, turn: number | undefined, quote: string): string {
    if (key === "sbar" && mineH) {
      const f = SBAR_FIELDS.find((x) => said(quote, mineH.sbar[x.key]));
      return f ? `SBAR -> ${f.label}` : "SBAR handoff";
    }
    if (key === "consult") {
      const m = consults.find((x) => !x.fromIsAi && said(quote, x.text));
      return m ? (m.kind === "callout" ? "Call-out to the team" : `Consult with ${m.toRole || "a colleague"}`) : "Messages with colleagues";
    }
    return sources.find((s) => s.key === key)!.label(turn);
  }

  const results = arr<{ key: string; observed: Observed; source: string; turn?: number; quote: string; feedback: string }>(raw.behaviours);
  const rest: BehaviourResult[] = defs.map((b) => {
    const r = results.find((x) => x.key === b.key);
    if (!r) return { key: b.key, observed: "no", location: "", quote: "", verified: false, feedback: "Not evaluated." };
    const loc = r.quote ? locate(r.source, r.turn, r.quote) : null;
    const c = check(r.observed, r.quote, !!loc, r.feedback || "");
    const fallback = sources.find((s) => s.key === r.source)?.label(r.source === "visit" ? r.turn : undefined) || "";
    return { key: b.key, ...c, location: loc || fallback, quote: loc ? r.quote : "" };
  });
  const com: BehaviourResult[] = sbarEval
    ? sbarEval.behaviours
    : BEHAVIOURS.filter((b) => b.sbar).map((b) => ({ key: b.key, observed: "no" as Observed, location: "SBAR", quote: "", verified: false, feedback: "No SBAR handoff was written." }));
  const blank = mineH ? SBAR_FIELDS.filter((f) => !mineH.sbar[f.key].trim()).map((f) => f.label) : [];
  const summary = await summarise(
    `${student}, a student acting as ${stage.roleTitle} in encounter ${stage.order} of ${run.stages.length}.${!mineH ? " No SBAR handoff was written." : blank.length ? ` SBAR sections left blank: ${blank.join(", ")}.` : ""}`,
    "how a learner worked as a member of an interprofessional team across their visit, note, SBAR handoff, messages and the huddle",
    [...com, ...rest],
    'Address the learner as "you".',
    "",
  );
  const ev: TraceEvaluation = { scope: "stage", subject: `${student} (${stage.roleTitle})`, behaviours: [...com, ...rest], summary, evaluatedAt: new Date().toISOString() };
  sql("UPDATE journey_runs SET evaluation = ? WHERE id = ?", JSON.stringify(ev), runId);
  return ev;
}

export type { Handoff };
