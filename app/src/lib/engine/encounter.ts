import { all, get, newId, parse, run } from "../db";
import { chatStream, MODELS, type Turn } from "../llm";
import { profession } from "../professions";
import { FACT_CATEGORIES } from "../types";
import type { Artifact, CaseProfile, EncounterConfig, EncounterState, Fact, Knobs, Perturbation } from "../types";
import { applyPerturbation, knobsForLevel, PERTURBATIONS } from "./difficulty";
import { auditReply, caseFacts, decide, gatekeep, matchActions } from "./gatekeeper";
import { patientSystem } from "./patient";

export interface EncounterRow {
  id: string;
  user_id: string;
  case_id: string;
  assignment_id: string | null;
  journey_run_id: string | null;
  parent_id: string | null;
  attempt: number;
  status: "active" | "paused" | "submitted" | "scored" | "abandoned";
  config: string;
  state: string;
  case_snapshot: string;
  wrapup: string | null;
  feedback: string | null;
  score: number | null;
  pause_note: string | null;
  started_at: string;
  ended_at: string | null;
}
export interface MessageRow {
  id: number;
  encounter_id: string;
  turn: number;
  speaker: "student" | "patient" | "system" | "instructor" | "coach" | "clinician";
  text: string;
  meta: string | null;
  created_at: string;
}

export interface Loaded {
  row: EncounterRow;
  c: CaseProfile;
  cfg: EncounterConfig;
  state: EncounterState;
}

export function loadEncounter(id: string): Loaded | null {
  const row = get<EncounterRow>("SELECT * FROM encounters WHERE id = ?", id);
  if (!row) return null;
  return {
    row,
    c: parse<CaseProfile>(row.case_snapshot, {} as CaseProfile),
    cfg: parse<EncounterConfig>(row.config, {} as EncounterConfig),
    state: parse<EncounterState>(row.state, {} as EncounterState),
  };
}

export const messagesOf = (id: string) => all<MessageRow>("SELECT * FROM messages WHERE encounter_id = ? ORDER BY id", id);

function freshState(c: CaseProfile, knobs: Knobs): EncounterState {
  const artifacts: Record<string, number> = {};
  for (const d of c.artifacts) if (d.release.when === "start") artifacts[d.id] = 0;
  return {
    turn: 0,
    rapport: knobs.rapportStart,
    emotion: c.persona.emotionalState,
    disclosed: {},
    deflected: {},
    actions: {},
    unmatchedOrders: [],
    artifacts,
    stats: { open: 0, focused: 0, closed: 0, leading: 0, multiple: 0, empathy: 0, jargon: 0, judgmental: 0 },
    rapportHistory: [knobs.rapportStart],
    hintsUsed: 0,
  };
}

/** Applies a faculty-approved variant to a copy of the case. */
function withVariant(c: CaseProfile, variantId?: string | null): CaseProfile {
  const v = c.variants?.find((x) => x.id === variantId && x.approved);
  if (!v) return c;
  const out: CaseProfile = JSON.parse(JSON.stringify(c));
  if (v.persona) out.persona = { ...out.persona, ...v.persona };
  out.facts = out.facts.map((f) => ({ ...f, ...(v.factOverrides?.[f.id] || {}) }));
  out.actions = out.actions.map((a) => ({ ...a, ...(v.actionOverrides?.[a.id] || {}) }));
  return out;
}

/**
 * For a class-shared patient: earlier students' write-ups are added to this visit's copy of the
 * chart as prior notes, so each professional can read what the others documented.
 */
function addTeamNotes(c: CaseProfile, scope: string, caseId: string) {
  const assignmentId = scope.replace(/^team:/, "");
  const rows = all<{ id: string; wrapup: string | null; ended_at: string | null; config: string; name: string }>(
    `SELECT e.id, e.wrapup, e.ended_at, e.config, u.name FROM encounters e JOIN users u ON u.id = e.user_id
     WHERE e.assignment_id = ? AND e.case_id = ? AND e.status = 'scored' AND e.parent_id IS NULL ORDER BY e.ended_at`,
    assignmentId,
    caseId,
  );
  rows.forEach((r, i) => {
    const cfg = parse<EncounterConfig>(r.config, {} as EncounterConfig);
    const role = profession(cfg.professionId);
    const wrap = parse<Record<string, string>>(r.wrapup, {});
    const body = role.wrapUp.map((f) => `${f.label}\n${wrap[f.id]?.trim() || "(not documented)"}`).join("\n\n");
    c.artifacts.push({
      id: `team_${r.id}`,
      type: "note",
      title: `Visit ${i + 1} note: ${role.name}`,
      author: `${r.name}, ${role.roleTitle}`,
      date: r.ended_at ? r.ended_at.slice(0, 16) + " UTC" : undefined,
      body,
      release: { when: "start" },
    });
  });
}

export interface CreateInput {
  userId: string;
  caseId: string;
  professionId: string;
  mode: EncounterConfig["mode"];
  level?: number;
  knobs?: Partial<Knobs>;
  assignmentId?: string | null;
  journeyRunId?: string | null;
  journey?: EncounterConfig["journey"];
  /** true = pick a persona twist automatically on repeat attempts; or pass an explicit id. */
  perturb?: boolean | string;
  variantId?: string | null;
  liveAssist?: boolean;
  /** Fact ids already on record from earlier encounters in a care journey. */
  initialDisclosed?: string[];
  /** Continue the relationship: the patient remembers this student's earlier visits. */
  followUp?: boolean;
  /** Share one continuing patient across a group (e.g. "team:<assignmentId>") instead of per student. */
  teamScope?: string;
}

export interface Relationship {
  visits: number;
  rapport: number;
  disclosed: string[];
  actions: string[];
  memory: string;
  last_encounter_id: string | null;
  updated_at: string;
}
export function relationship(userId: string, caseId: string): Relationship | null {
  const r = get<{ visits: number; rapport: number; disclosed: string; actions: string; memory: string; last_encounter_id: string | null; updated_at: string }>(
    "SELECT * FROM patient_relationships WHERE user_id = ? AND case_id = ?",
    userId,
    caseId,
  );
  return r ? { ...r, disclosed: parse<string[]>(r.disclosed, []), actions: parse<string[]>(r.actions, []) } : null;
}

export function createEncounter(input: CreateInput): string {
  const row = get<{ profile: string; difficulty: number }>("SELECT profile, difficulty FROM cases WHERE id = ?", input.caseId);
  if (!row) throw new Error("Case not found");
  const base = parse<CaseProfile>(row.profile, {} as CaseProfile);
  const c = withVariant(base, input.variantId);
  if (input.teamScope) addTeamNotes(c, input.teamScope, input.caseId);
  // Attempts are numbered by distinct finished visits; a rewound branch keeps its parent's number.
  const prior = get<{ n: number }>(
    "SELECT COUNT(DISTINCT attempt) AS n FROM encounters WHERE user_id = ? AND case_id = ? AND status IN ('submitted','scored')",
    input.userId,
    input.caseId,
  )!.n;
  const attempt = prior + 1;

  let perturbation: Perturbation | null = null;
  if (typeof input.perturb === "string") perturbation = PERTURBATIONS.find((p) => p.id === input.perturb) || null;
  else if (input.perturb && attempt > 1) perturbation = PERTURBATIONS[(attempt - 2) % PERTURBATIONS.length];

  let knobs = { ...knobsForLevel(input.level ?? c.difficulty, c.scenario.timeLimitMin), ...(input.knobs || {}) };
  knobs = applyPerturbation(knobs, perturbation);
  if (input.mode === "exam") knobs.hints = false;
  const rel = input.teamScope ? relationship(input.teamScope, input.caseId) : input.followUp ? relationship(input.userId, input.caseId) : null;
  // Trust carries over between visits, good or bad.
  if (rel) knobs.rapportStart = Math.max(15, Math.min(85, rel.rapport));

  const cfg: EncounterConfig = {
    mode: input.mode,
    knobs,
    perturbation,
    variantId: input.variantId || null,
    liveAssist: !!input.liveAssist,
    professionId: input.professionId,
    journey: input.journey || null,
    visitNumber: rel ? rel.visits + 1 : 1,
    memory: rel?.memory || null,
    team: input.teamScope ? { scope: input.teamScope, studentName: get<{ name: string }>("SELECT name FROM users WHERE id = ?", input.userId)?.name || "a student" } : null,
  };
  const state = freshState(c, knobs);
  for (const aid of rel?.actions || []) if (c.actions.some((a) => a.id === aid)) state.actions[aid] = { turn: 0, request: "Earlier visit" };
  if (rel) releaseArtifacts(c, state);
  for (const fid of [...(input.initialDisclosed || []), ...(rel?.disclosed || [])]) if (c.facts.some((f) => f.id === fid)) state.disclosed[fid] = { turn: 0, how: "record" };
  const id = newId("e_");
  run(
    "INSERT INTO encounters (id, user_id, case_id, assignment_id, journey_run_id, attempt, config, state, case_snapshot) VALUES (?,?,?,?,?,?,?,?,?)",
    id,
    input.userId,
    input.caseId,
    input.assignmentId || null,
    input.journeyRunId || null,
    attempt,
    JSON.stringify(cfg),
    JSON.stringify(state),
    JSON.stringify(c),
  );
  return id;
}

// ---------- What the student is allowed to see ----------

export interface ChartView {
  patient: { name: string; age: number; sex: string; pronouns: string; portrait?: string; appearance: string };
  setting: string;
  brief: string;
  chiefComplaint: string;
  tasks: string[];
  atStart: { label: string; value: string }[];
  sections: { category: string; label: string; items: { id: string; text: string; turn: number; how: string }[] }[];
  results: { id: string; kind: string; name: string; result: string; abnormal: boolean; turn: number }[];
  unmatched: { turn: number; request: string }[];
  artifacts: (Artifact & { turn: number })[];
  log: { turn: number; kind: "fact" | "result" | "document"; text: string }[];
  rapport: number | null;
  emotion: string;
  turn: number;
}

export function chartView(c: CaseProfile, cfg: EncounterConfig, state: EncounterState): ChartView {
  const byCat = new Map<string, ChartView["sections"][number]>();
  const log: ChartView["log"] = [];
  for (const f of c.facts) {
    const d = state.disclosed[f.id];
    if (!d) continue;
    if (!byCat.has(f.category)) byCat.set(f.category, { category: f.category, label: FACT_CATEGORIES[f.category] || f.category, items: [] });
    byCat.get(f.category)!.items.push({ id: f.id, text: f.chart, turn: d.turn, how: d.how });
    log.push({ turn: d.turn, kind: "fact", text: f.chart });
  }
  const order = Object.keys(FACT_CATEGORIES);
  const sections = [...byCat.values()].sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category));
  for (const s of sections) s.items.sort((a, b) => a.turn - b.turn);

  const results: ChartView["results"] = [];
  for (const a of c.actions) {
    const d = state.actions[a.id];
    if (!d) continue;
    results.push({ id: a.id, kind: a.kind, name: a.name, result: a.result, abnormal: !!a.abnormal, turn: d.turn });
    log.push({ turn: d.turn, kind: "result", text: `${a.name}: ${a.result}` });
  }
  results.sort((a, b) => a.turn - b.turn);
  const artifacts = c.artifacts
    .filter((d) => state.artifacts[d.id] !== undefined)
    .map((d) => ({ ...d, turn: state.artifacts[d.id] }));
  for (const d of artifacts) if (d.turn > 0) log.push({ turn: d.turn, kind: "document", text: d.title });
  log.sort((a, b) => a.turn - b.turn);

  return {
    patient: { name: c.patient.name, age: c.patient.age, sex: c.patient.sex, pronouns: c.patient.pronouns, portrait: c.patient.portrait, appearance: c.patient.appearance },
    setting: c.setting,
    brief: cfg.journey?.brief
      ? cfg.journey.brief
      : (cfg.visitNumber || 1) > 1
        ? `Follow-up visit (visit ${cfg.visitNumber}). You have seen ${c.patient.name} before; what you documented is in the chart, and the patient remembers you. Pick up where you left off: review progress, cover what is still missing, and agree next steps.\n\nOriginal brief: ${c.scenario.studentBrief}`
        : c.scenario.studentBrief,
    chiefComplaint: cfg.journey?.reason || c.scenario.chiefComplaint,
    tasks: cfg.journey?.tasks?.length ? cfg.journey.tasks : cfg.journey?.brief ? [] : c.scenario.tasks,
    atStart: c.chartAtStart,
    sections,
    results,
    unmatched: state.unmatchedOrders,
    artifacts,
    log,
    // Exams hide the comfort meter; practice shows it so students can see cause and effect.
    rapport: cfg.mode === "exam" ? null : state.rapport,
    emotion: state.emotion.length > 28 ? "" : state.emotion,
    turn: state.turn,
  };
}

function releaseArtifacts(c: CaseProfile, state: EncounterState) {
  for (const d of c.artifacts) {
    if (state.artifacts[d.id] !== undefined) continue;
    if (d.release.when === "fact" && d.release.ref && state.disclosed[d.release.ref]) state.artifacts[d.id] = state.turn;
    if (d.release.when === "action" && d.release.ref && state.actions[d.release.ref]) state.artifacts[d.id] = state.turn;
  }
  for (const a of c.actions) {
    if (!state.actions[a.id]) continue;
    for (const id of a.artifactIds || []) if (state.artifacts[id] === undefined) state.artifacts[id] = state.turn;
  }
}

const save = (id: string, state: EncounterState) => run("UPDATE encounters SET state = ? WHERE id = ?", JSON.stringify(state), id);

const addMessage = (encId: string, turn: number, speaker: MessageRow["speaker"], text: string, meta?: unknown) =>
  run("INSERT INTO messages (encounter_id, turn, speaker, text, meta) VALUES (?,?,?,?,?)", encId, turn, speaker, text, meta ? JSON.stringify(meta) : null);

export type TurnEvent =
  | { type: "delta"; text: string }
  | { type: "done"; text: string; notice: string | null; messageId: number; chart: ChartView; newFactIds: string[]; deflected: boolean; rapportDelta: number }
  | { type: "error"; message: string };

/** One student utterance -> gatekeeper -> deterministic disclosure -> streamed patient reply. */
export async function* runTurn(encId: string, text: string): AsyncGenerator<TurnEvent> {
  const enc = loadEncounter(encId);
  if (!enc) return void (yield { type: "error", message: "Encounter not found" });
  if (enc.row.status === "paused") return void (yield { type: "error", message: "Your instructor has paused this visit." });
  if (enc.row.status !== "active") return void (yield { type: "error", message: "This visit has ended." });
  const { c, cfg, state } = enc;

  state.turn += 1;
  addMessage(encId, state.turn, "student", text);

  const history = messagesOf(encId).filter((m) => m.speaker === "student" || m.speaker === "patient");
  const facts = caseFacts(c, cfg.knobs);
  const locked = facts.filter((f) => !state.disclosed[f.id]);
  const gate = await gatekeep({
    locked,
    recent: history.slice(-7, -1).map((m) => ({ speaker: m.speaker, text: m.text })),
    message: text,
  });
  const d = decide(gate, facts, state, cfg.knobs, c.persona.healthLiteracy === "low");

  const known: Fact[] = facts.filter((f) => state.disclosed[f.id]);
  state.rapport = d.rapport;
  state.rapportHistory.push(d.rapport);
  state.emotion = gate.patient_emotion || state.emotion;
  for (const f of d.reveal) state.disclosed[f.id] = { turn: state.turn, how: d.how[f.id] };
  for (const f of d.deflect) state.deflected[f.id] = (state.deflected[f.id] || 0) + 1;
  const qt = gate.question_type;
  if (qt === "open" || qt === "focused" || qt === "closed" || qt === "leading" || qt === "multiple") state.stats[qt] += 1;
  if (gate.signals.empathy || gate.signals.validated_emotion) state.stats.empathy += 1;
  if (gate.signals.jargon) state.stats.jargon += 1;
  if (gate.signals.judgmental || gate.signals.dismissive) state.stats.judgmental += 1;
  releaseArtifacts(c, state);

  const turns: Turn[] = history.map((m) => ({ role: m.speaker === "student" ? "user" : "assistant", text: m.text }));
  let reply = "";
  try {
    for await (const chunk of chatStream({
      model: MODELS.chat,
      system: patientSystem({ c, cfg, state, known, reveal: d.reveal, deflect: d.deflect, gate, lockedTopics: locked.filter((f) => !d.reveal.includes(f)).map((f) => f.topic) }),
      messages: turns,
      maxTokens: 500,
      temperature: 0.6,
    })) {
      reply += chunk;
      yield { type: "delta", text: chunk };
    }
  } catch (e) {
    // Roll the turn back so nothing is recorded as disclosed that the patient never said.
    run("DELETE FROM messages WHERE encounter_id = ? AND turn = ?", encId, state.turn);
    return void (yield { type: "error", message: "The patient connection dropped. Please send that again. (" + (e as Error).message + ")" });
  }
  // Body-language cues are kept only when the patient is deflecting, and then only the first one.
  let cues = 0;
  reply = reply.replace(/\*[^*\n]{1,80}\*/g, (m) => (d.deflect.length && cues++ === 0 ? m : ""));
  reply = reply.replace(/[ \t]+\n/g, "\n").replace(/\n{2,}/g, "\n").replace(/ {2,}/g, " ").trim() || "...";
  // Grounding audit: anything clinical the patient said beyond the approved facts is flagged, never filed.
  const stillLocked = locked.filter((f) => !d.reveal.includes(f));
  const audit = await auditReply({
    reply,
    known,
    reveal: d.reveal,
    locked: stillLocked,
    background: `${c.persona.background}\nConcerns: ${c.persona.concerns.join("; ")}\nTypical lines: ${c.persona.speechExamples.join(" / ")}\nOn the patient's record, which the patient also knows: ${c.chartAtStart.map((x) => `${x.label}: ${x.value}`).join("; ")}`,
    openingLine: cfg.journey?.patientReason || c.scenario.openingLine,
    context: [cfg.memory, cfg.journey?.patientMemory, `Student just said: ${text}`].filter(Boolean).join("\n"),
  });
  const unsupported = audit.unsupported;
  // The ledger records what the patient actually said: skipped facts stay locked, and a true
  // fact the patient stated early is filed rather than later counted as missed.
  if (audit.notConveyed.length) {
    for (const fid of audit.notConveyed) delete state.disclosed[fid];
    d.reveal = d.reveal.filter((f) => !audit.notConveyed.includes(f.id));
  }
  for (const fid of audit.alsoConveyed) {
    const f = stillLocked.find((x) => x.id === fid);
    if (!f) continue;
    state.disclosed[fid] = { turn: state.turn, how: "volunteered" };
    d.reveal.push(f);
  }
  releaseArtifacts(c, state);
  const inserted = addMessage(encId, state.turn, "patient", reply, {
    unsupported,
    revealed: d.reveal.map((f) => f.id),
    deflected: d.deflect.map((f) => f.id),
    questionType: gate.question_type,
    signals: gate.signals,
    rapport: state.rapport,
    rapportDelta: d.rapportDelta,
    state, // snapshot: lets a student rewind to this point
  });
  const notice = unsupported.length ? `Outside the case record: ${unsupported.map((u) => `"${u}"`).join("; ")}. The simulated patient went beyond the approved case here. Treat it as unverified; it is not filed in the chart.` : null;
  if (notice) addMessage(encId, state.turn, "system", notice, { kind: "unsupported" });
  save(encId, state);
  yield {
    type: "done",
    text: reply,
    notice,
    messageId: Number(inserted.lastInsertRowid),
    chart: chartView(c, cfg, state),
    newFactIds: d.reveal.map((f) => f.id),
    deflected: d.deflect.length > 0,
    rapportDelta: d.rapportDelta,
  };
}

/** Exam / order request. Only faculty-approved results can come back. */
export async function runAction(encId: string, request: string) {
  const enc = loadEncounter(encId);
  if (!enc) throw new Error("Encounter not found");
  if (enc.row.status !== "active") throw new Error(enc.row.status === "paused" ? "Your instructor has paused this visit." : "This visit has ended.");
  const { c, cfg, state } = enc;
  const { matched, unmatched } = await matchActions(request, c.actions);
  const done: { name: string; result: string; abnormal: boolean; repeat: boolean }[] = [];
  for (const id of matched) {
    const a = c.actions.find((x) => x.id === id)!;
    const repeat = !!state.actions[id];
    if (!repeat) state.actions[id] = { turn: state.turn, request };
    done.push({ name: a.name, result: a.result, abnormal: !!a.abnormal, repeat });
  }
  for (const u of unmatched) state.unmatchedOrders.push({ turn: state.turn, request: u });
  releaseArtifacts(c, state);
  const lines = [
    ...done.map((d) => `${d.name}: ${d.result}`),
    ...unmatched.map((u) => `${u}: no approved result is available for this in the case file.`),
  ];
  if (lines.length) addMessage(encId, state.turn, "system", `Requested: ${request}\n${lines.join("\n")}`, { kind: "action", matched, unmatched });
  save(encId, state);
  return { done, unmatched, chart: chartView(c, cfg, state) };
}

/** Practice-mode coaching nudge. Deterministic, and never reveals the content of a fact. */
export function hint(encId: string): string {
  const enc = loadEncounter(encId);
  if (!enc) throw new Error("Encounter not found");
  const { c, cfg, state } = enc;
  if (!cfg.knobs.hints) return "Hints are turned off for this visit.";
  const facts = caseFacts(c, cfg.knobs).filter((f) => !f.distractor);
  const missing = facts.filter((f) => !state.disclosed[f.id] && f.importance !== "minor");
  const tips: string[] = [];
  const deflected = facts.filter((f) => state.deflected[f.id] && !state.disclosed[f.id]);
  if (deflected.length) tips.push(`The patient dodged a question about ${deflected[0].topic}. Try building trust first: acknowledge how they feel, explain why you are asking, then ask again.`);
  const cats = [...new Set(missing.map((f) => FACT_CATEGORIES[f.category] || f.category))].slice(0, 3);
  if (cats.length) tips.push(`You have not fully explored: ${cats.join(", ")}.`);
  const st = state.stats;
  const asked = st.open + st.focused + st.closed + st.leading + st.multiple;
  if (asked >= 4 && st.open / asked < 0.2) tips.push("Most of your questions have been closed. Try an open one such as \"Tell me more about that.\"");
  if (st.multiple >= 2) tips.push("Ask one question at a time; stacked questions get partial answers.");
  if (state.turn >= 4 && st.empathy === 0) tips.push("You have not acknowledged how the patient is feeling yet.");
  const pending = c.actions.filter((a) => a.importance === "critical" && !state.actions[a.id]);
  if (!cats.length && pending.length) tips.push("Consider which examination or test would help you most at this point.");
  if (!tips.length) tips.push("You have covered the key areas. Summarise back to the patient, check their understanding and agree next steps.");
  state.hintsUsed += 1;
  save(encId, state);
  const text = tips.slice(0, 2).join(" ");
  addMessage(encId, state.turn, "coach", text);
  return text;
}

/** Branch a new practice encounter from an earlier point so the student can try a turn differently. */
export function rewind(encId: string, toTurn: number): string {
  const enc = loadEncounter(encId);
  if (!enc) throw new Error("Encounter not found");
  if (enc.cfg.mode === "exam") throw new Error("Rewind is not available in exams.");
  const msgs = messagesOf(encId).filter((m) => m.turn <= toTurn);
  const lastPatient = [...msgs].reverse().find((m) => m.speaker === "patient");
  const snap = lastPatient ? parse<{ state?: EncounterState }>(lastPatient.meta, {}).state : null;
  const state = snap || freshState(enc.c, enc.cfg.knobs);
  // Orders are placed between turns, after the snapshot was taken: carry over those made by this point.
  for (const [aid, a] of Object.entries(enc.state.actions)) if (a.turn <= toTurn && !state.actions[aid]) state.actions[aid] = a;
  for (const [did, t] of Object.entries(enc.state.artifacts)) if (t <= toTurn && state.artifacts[did] === undefined) state.artifacts[did] = t;
  state.unmatchedOrders = enc.state.unmatchedOrders.filter((u) => u.turn <= toTurn);
  const id = newId("e_");
  run(
    "INSERT INTO encounters (id, user_id, case_id, assignment_id, journey_run_id, parent_id, attempt, config, state, case_snapshot, started_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    id,
    enc.row.user_id,
    enc.row.case_id,
    enc.row.assignment_id,
    enc.row.journey_run_id,
    encId,
    enc.row.attempt,
    enc.row.config,
    JSON.stringify(state),
    enc.row.case_snapshot,
    enc.row.started_at,
  );
  for (const m of msgs) run("INSERT INTO messages (encounter_id, turn, speaker, text, meta) VALUES (?,?,?,?,?)", id, m.turn, m.speaker, m.text, m.meta);
  return id;
}

export { addMessage };
