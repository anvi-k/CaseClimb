// Model calls used by the Patient Studio. Every result here is a proposal: nothing is written to a
// case until a faculty member accepts it in the editor.
import { chatJSON, MODELS, type Turn } from "@/lib/llm";
import { profession } from "@/lib/professions";
import type { CaseProfile, Persona, Variant } from "@/lib/types";
import type { Issue, Severity } from "./checks";
import { PATCH_DOC, PATCH_OPS_SCHEMA, validOps, wordingWarnings, type PatchOp } from "./patch";
import { nextId, sectionForPath, SECTIONS } from "./profile";

/** The case as the model sees it: no portraits or file URLs, knowledge sources shortened. */
export function compactCase(p: CaseProfile, opts: { variants?: boolean } = {}): string {
  const c: Record<string, unknown> = {
    ...p,
    patient: { ...p.patient, portrait: undefined },
    artifacts: p.artifacts.map((d) => ({ ...d, fileUrl: d.fileUrl ? "(uploaded file, content not shown)" : undefined })),
    knowledge: p.knowledge.map((k) => ({ id: k.id, title: k.title, text: k.text.slice(0, 1500) + (k.text.length > 1500 ? " ...(truncated)" : "") })),
    variants: opts.variants ? p.variants : undefined,
  };
  return JSON.stringify(c);
}

// ---------- Clarifying questions before generation ----------

export interface ClarifyQuestion {
  id: string;
  question: string;
  suggestions: string[];
}

export async function clarify(input: { professionId: string; description: string; goals?: string; level?: number }): Promise<{ questions: ClarifyQuestion[]; understood: string }> {
  const p = profession(input.professionId);
  const raw = await chatJSON<{ understood: string; questions?: { question: string; suggestions?: string[] }[] }>({
    model: MODELS.chat,
    maxTokens: 900,
    temperature: 0.2,
    system: `You help health-professions faculty write simulated patient cases for a telehealth simulator. A faculty member has described the patient they want. Before the full case is written, decide whether anything essential is missing.

Essential means: without it, two reasonable case writers would produce clinically different cases. Typically: the underlying diagnosis or problem the case is built around, the core teaching point for this learner role, or a defining patient characteristic the description hints at but leaves open.

Rules:
- Ask at most 3 questions, and only essential ones. If the description already fixes the clinical picture, ask none. One good question is better than three weak ones.
- Never ask about things a case writer can sensibly invent (name, exact lab values, occupation, wording).
- Each question is one short plain sentence, with 2 to 4 short suggested answers the faculty member can pick from.
- "understood" is one sentence restating what you will build, in plain language.`,
    schema: {
      type: "object",
      required: ["understood", "questions"],
      properties: {
        understood: { type: "string" },
        questions: {
          type: "array",
          maxItems: 3,
          items: { type: "object", required: ["question", "suggestions"], properties: { question: { type: "string" }, suggestions: { type: "array", items: { type: "string" }, maxItems: 4 } } },
        },
      },
    },
    messages: [
      {
        role: "user",
        text: `LEARNER ROLE: ${p.name} (${p.roleTitle}). Scope: ${p.scope}
${input.level ? `TARGET DIFFICULTY: ${input.level} of 5\n` : ""}${input.goals ? `LEARNING GOALS: ${input.goals}\n` : ""}
FACULTY DESCRIPTION:
${input.description}`,
      },
    ],
  });
  const questions = (Array.isArray(raw.questions) ? raw.questions : [])
    .filter((q) => q && typeof q.question === "string" && q.question.trim())
    .slice(0, 3)
    .map((q, i) => ({ id: `q${i + 1}`, question: q.question.trim(), suggestions: (Array.isArray(q.suggestions) ? q.suggestions : []).map(String).slice(0, 4) }));
  return { questions, understood: String(raw.understood || "") };
}

// ---------- Clinical consistency review ----------

const SECTION_IDS = SECTIONS.map((s) => s.id);

function hashKey(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export async function modelCheck(p: CaseProfile): Promise<{ summary: string; issues: Issue[] }> {
  const raw = await chatJSON<{ summary: string; issues?: { severity: Severity; section: string; where: string; title: string; why: string; fixSummary?: string; ops?: PatchOp[] }[] }>({
    model: MODELS.smart,
    maxTokens: 8000,
    system: `You are a clinician-educator reviewing a simulated patient case before it is released to students. Your job is to find places where the case contradicts itself. You are not rewriting or improving the case.

Compare every pair of places where the same clinical information appears:
- history facts (chart wording and patient wording) against each other, and against the persona and the opening line
- medications, doses and frequencies across facts, Chart at start, medication-list documents and notes
- vital signs across Chart at start, action results, flowsheets and notes
- lab and test values, units, reference ranges and H/L flags across action results and documents; trend-chart points against the tables they summarise
- dates and durations (symptom onset, "3 weeks ago", ages, document dates) against each other
- the answer key (primary problem, differential, key findings, plan, red flags) against what the facts, results and documents actually support
- the student brief and Chart at start: they must not give away findings that are meant to be discovered
- age, sex and pregnancy status against conditions, medications and reference ranges
- clinical plausibility: impossible or unsafe values, doses outside any used range, a result that cannot coexist with the stated diagnosis

Structure is checked separately by rules, so do not report broken or missing ids, links to items that do not exist, duplicated facts, unlinked objectives or release rules that point nowhere. Report clinical and narrative contradictions only.

The "mismatches" list holds conflicts between what the patient says and what the record shows that were written on purpose. Do not report those. Do report a listed mismatch whose two sides do not actually conflict in the case data.

Severity:
- high: a student would be misled, a result contradicts the answer key, or a value is clinically impossible or unsafe
- medium: the same detail differs between two places (dose, unit, date, number) or a key finding in the answer key is not supported anywhere
- low: minor wording or plausibility polish

Write for a faculty member who has never seen the JSON: in "where", "title", "why" and "fixSummary" name things the way the editor does ("Fact f7 (water pill timing)", "the Medication list document", "Chart at start: Last vitals", "the answer key's red flags"), never by JSON key or path such as chartAtStart, answerKey.redFlags or artifactId.

Report only real problems you can point to in the data; quote the conflicting values in "why". Do not pad the list. Finish comparing before you write an issue: if the two places turn out to agree, or the point is a redundancy or a style preference, leave it out entirely. An issue must never say that something "is consistent" or "is not a contradiction". Each issue covers exactly one conflict. "title" is at most 14 words and states the conflict itself ("Furosemide dose differs between the medication list and Chart at start"). If the case is consistent, return no issues. At most 12 issues, most serious first.

A difference in wording or formatting between two places that state the same value is not an issue.

Every fact states the same information twice: "says" (the patient's words) and "chart" (what is written to the record). When a patch changes a clinical value in a fact (a number, range, dose, frequency, date or duration), it MUST set both facts.<id>.says and facts.<id>.chart in the same patch so the two wordings state the same value. Never change the value in one wording and leave the other as it was: "says" becoming "89 up to 93" while "chart" still reads "89-91%" is a new contradiction. The same holds for any other place that repeats the value.

For each issue give a fix as a patch when editing specific fields resolves it. Most contradictions can be fixed this way, so most issues should carry a patch. Choose the reading that agrees with the answer key and the majority of the case, and patch every field needed. When the right answer is a faculty judgment call, leave ops empty and say in fixSummary what they need to decide.

${PATCH_DOC}`,
    schema: {
      type: "object",
      required: ["summary", "issues"],
      properties: {
        summary: { type: "string", description: "One or two sentences on the overall consistency of the case" },
        issues: {
          type: "array",
          items: {
            type: "object",
            required: ["severity", "section", "where", "title", "why", "fixSummary", "ops"],
            properties: {
              severity: { type: "string", enum: ["high", "medium", "low"] },
              section: { type: "string", enum: SECTION_IDS, description: "The editor section where the faculty member should look first" },
              where: { type: "string", description: "Plain-language location, e.g. 'Fact f7 (statin dose) and document d2 (Medication list)'" },
              title: { type: "string", description: "One short sentence naming the contradiction" },
              why: { type: "string", description: "What conflicts with what, quoting the values, and why it matters for a student" },
              fixSummary: { type: "string", description: "One sentence describing the proposed fix, or the decision the faculty member must make" },
              ops: { ...PATCH_OPS_SCHEMA, description: "The patch that fixes it. Expected for every issue that editing fields can resolve; an empty list only when faculty must choose between clinically different options." },
            },
          },
        },
      },
    },
    messages: [{ role: "user", text: `Review this case for internal contradictions.\n\nCASE JSON:\n${compactCase(p)}` }],
  });
  // The model sometimes returns the list JSON-encoded as a string, or leaves it out. A missing list must not
  // read as "no problems found".
  let list: unknown = raw.issues;
  if (typeof list === "string") {
    try {
      list = JSON.parse(list);
    } catch {
      list = undefined;
    }
  }
  console.log("[studio] clinical review returned", { keys: Object.keys(raw || {}), issuesType: Array.isArray(raw.issues) ? "array" : typeof raw.issues, n: Array.isArray(list) ? list.length : null });
  if (!Array.isArray(list)) throw new Error("the review came back without a findings list");
  const issues: Issue[] = [];
  for (const it of list as NonNullable<typeof raw.issues>) {
    if (!it || !it.title) continue;
    // A finding that concludes nothing is wrong is not a finding.
    if (/\b(is|are|remains?) (internally )?consistent\b|not a (real )?(contradiction|conflict)|no (contradiction|conflict)|otherwise (match|agree)/i.test(`${it.title} ${String(it.why || "").slice(-200)}`)) continue;
    const ops = validOps(p, it.ops);
    const section = (SECTION_IDS as readonly string[]).includes(it.section) ? (it.section as Issue["section"]) : ops[0] ? sectionForPath(ops[0].path) : "overview";
    issues.push({
      id: "m" + hashKey(it.title + "|" + it.where) + issues.length,
      source: "model",
      severity: ["high", "medium", "low"].includes(it.severity) ? it.severity : "medium",
      section,
      where: String(it.where || ""),
      title: String(it.title),
      why: String(it.why || ""),
      fix: ops.length ? { summary: String(it.fixSummary || "Apply the proposed correction"), ops } : undefined,
      status: "open",
    });
    // The prompt requires both wordings of a fact to be patched together; log when the model did not. The editor shows the warning.
    const lopsided = wordingWarnings(p, ops);
    if (lopsided.length) console.warn("[studio] clinical review proposed a one-sided fact wording change", { issue: it.title, warnings: lopsided });
    // A decision the model left to faculty still needs to be visible.
    if (!ops.length && it.fixSummary) issues[issues.length - 1].why += ` Suggested: ${it.fixSummary}`;
  }
  const summary = String(raw.summary || "").trim() || (issues.length ? "" : "The clinical review found no contradictions between the history, medications, results, documents and answer key.");
  return { summary, issues };
}

// ---------- Editor guide: plain-language request -> proposed patch ----------

export interface GuideTurn {
  role: "user" | "assistant";
  text: string;
}

export async function guide(p: CaseProfile, history: GuideTurn[]): Promise<{ reply: string; ops: PatchOp[]; dropped: number }> {
  const turns: Turn[] = history.slice(-10).map((t) => ({ role: t.role, text: t.text.slice(0, 4000) }));
  const last = turns.pop();
  if (!last || last.role !== "user") throw new Error("Ask the guide for a change first.");
  const role = profession(p.professions[0]);
  const raw = await chatJSON<{ reply: string; ops?: PatchOp[] }>({
    model: MODELS.smart,
    maxTokens: 8000,
    system: `You are the case-writing guide inside the Patient Studio of a telehealth patient simulator. A faculty member is editing a simulated patient case and asks you for changes in plain language. You answer with a short reply and a proposed patch. The faculty member reviews the patch as a before/after diff and accepts or rejects it; you never apply anything yourself, so describe changes as proposals ("This would...").

How to work:
- Make exactly the change that was asked for, at the smallest scope that does it properly.
- Keep the case internally consistent. If the change touches something that is repeated elsewhere (a medication in a fact, the medication list and Chart at start; a lab value in an action result and a lab report), patch every place. If the change affects the answer key or an objective, patch those too or say why not.
- New facts need both wordings: "chart" in concise clinician language and "says" in this patient's own voice, matching the persona. Choose a disclosure tier that fits how sensitive the information is. "topic" must not reveal the answer.
- A new document that results from a test needs an action that releases it (add or update the action and link them). A normal result is still a full, realistic report.
- Requests about how the patient behaves ("more guarded", "angrier", "less talkative") usually mean persona fields, speech examples, and the disclosure tier of the relevant facts.
- Stay within what this learner role (${role.name}) does in a telehealth visit.
- Clinical content must be accurate and plausible. If the request would make the case clinically wrong, say so in the reply and propose the closest correct version.
- If the request is a question, answer it and return no operations. If it is too ambiguous to act on, ask one short question and return no operations.
- reply: one to three plain sentences saying what the patch would change and anything the faculty member should double-check. No lists, no markdown.

${PATCH_DOC}`,
    schema: {
      type: "object",
      required: ["reply", "ops"],
      properties: { reply: { type: "string", description: "Required. One to three plain sentences." }, ops: PATCH_OPS_SCHEMA },
    },
    messages: [...turns, { role: "user", text: `CURRENT CASE JSON (includes any edits made so far):\n${compactCase(p, { variants: true })}\n\nREQUEST FROM FACULTY:\n${last.text}` }],
  });
  const proposed = Array.isArray(raw.ops) ? raw.ops : [];
  const ops = validOps(p, proposed);
  const reply = String(raw.reply || "").trim() || (ops.length ? `Here is a proposed change (${ops.length} edit${ops.length === 1 ? "" : "s"}). Review it below.` : "I could not turn that into a change. Try saying which part of the patient it concerns.");
  return { reply, ops, dropped: proposed.length - ops.length };
}

// ---------- Variants for repeat practice ----------

export type VariantFocus = "persona" | "clinical" | "both";

export async function draftVariant(p: CaseProfile, focus: VariantFocus, note: string): Promise<Variant> {
  const existing = (p.variants || []).map((v) => `- ${v.label}: ${v.description}`).join("\n");
  const raw = await chatJSON<{
    label: string;
    description: string;
    persona?: Partial<Persona>;
    factOverrides?: { id: string; chart?: string; says?: string; tier?: string }[];
    actionOverrides?: { id: string; result?: string; abnormal?: boolean }[];
  }>({
    model: MODELS.smart,
    maxTokens: 6000,
    system: `You write alternate versions ("variants") of a simulated patient case so that students who repeat the case cannot rely on memory. A variant is a small set of overrides on top of the base case; everything not overridden stays as it is. A faculty member will review and approve the variant before any student sees it.

A variant must keep: the same patient identity, the same primary problem and answer key, the same learning objectives, and every document in the chart exactly as written (documents cannot be overridden, so do not change any value that a document, Chart at start item or the answer key states).

What a variant may change:
- persona (focus "persona" or "both"): personality, communication style, health literacy, emotional state, speech examples and concerns. Make it a recognisably different interaction, e.g. more anxious and talkative, stoic and minimising, rushed and distracted, distrustful after a bad experience.
- clinical detail (focus "clinical" or "both"): the wording, tier, or incidental details of facts (how a symptom is described, a different trigger, different social circumstances, a different pertinent negative, which sensitive fact is harder to elicit), and results of actions that no document reports. Three to eight fact overrides is typical. Every changed fact must still be consistent with every unchanged fact, document and the answer key.

For each fact override give the fact id and the full new "chart" and "says" wording (and "tier" only if it changes). "says" must be in the variant persona's voice. Do not invent ids.
label: 2 to 5 words. description: one or two sentences telling faculty what is different and why it is useful for repeat practice.`,
    schema: {
      type: "object",
      required: ["label", "description"],
      properties: {
        label: { type: "string" },
        description: { type: "string" },
        persona: {
          type: "object",
          properties: {
            personality: { type: "string" },
            communicationStyle: { type: "string" },
            healthLiteracy: { type: "string", enum: ["low", "moderate", "high"] },
            emotionalState: { type: "string" },
            speechExamples: { type: "array", items: { type: "string" } },
            concerns: { type: "array", items: { type: "string" } },
          },
        },
        factOverrides: {
          type: "array",
          items: { type: "object", required: ["id"], properties: { id: { type: "string" }, chart: { type: "string" }, says: { type: "string" }, tier: { type: "string", enum: ["initial", "discoverable", "reluctant", "hidden"] } } },
        },
        actionOverrides: { type: "array", items: { type: "object", required: ["id", "result"], properties: { id: { type: "string" }, result: { type: "string" }, abnormal: { type: "boolean" } } } },
      },
    },
    messages: [
      {
        role: "user",
        text: `Draft one variant of this case.
FOCUS: ${focus}
${note ? `FACULTY NOTE: ${note}\n` : ""}${existing ? `EXISTING VARIANTS (make this one different):\n${existing}\n` : ""}
BASE CASE JSON:
${compactCase(p)}`,
      },
    ],
  });
  const v: Variant = { id: nextId(p.variants || [], "v"), label: String(raw.label || "Variant"), description: String(raw.description || ""), approved: false };
  if (focus !== "clinical" && raw.persona && typeof raw.persona === "object") {
    const persona: Partial<Persona> = {};
    for (const k of ["personality", "communicationStyle", "emotionalState"] as const) if (typeof raw.persona[k] === "string" && raw.persona[k]) persona[k] = raw.persona[k];
    if (["low", "moderate", "high"].includes(raw.persona.healthLiteracy as string)) persona.healthLiteracy = raw.persona.healthLiteracy;
    for (const k of ["speechExamples", "concerns"] as const) if (Array.isArray(raw.persona[k]) && raw.persona[k]!.length) persona[k] = raw.persona[k]!.map(String);
    if (Object.keys(persona).length) v.persona = persona;
  }
  if (focus !== "persona") {
    const fo: NonNullable<Variant["factOverrides"]> = {};
    for (const o of Array.isArray(raw.factOverrides) ? raw.factOverrides : []) {
      if (!p.facts.some((f) => f.id === o.id)) continue;
      const patch: Record<string, string> = {};
      if (o.chart) patch.chart = o.chart;
      if (o.says) patch.says = o.says;
      if (o.tier && ["initial", "discoverable", "reluctant", "hidden"].includes(o.tier)) patch.tier = o.tier;
      if (Object.keys(patch).length) fo[o.id] = patch;
    }
    if (Object.keys(fo).length) v.factOverrides = fo;
    const ao: NonNullable<Variant["actionOverrides"]> = {};
    for (const o of Array.isArray(raw.actionOverrides) ? raw.actionOverrides : []) {
      const base = p.actions.find((a) => a.id === o.id);
      // Results that a document reports cannot change, because documents are not overridden.
      if (!base || !o.result || base.artifactIds?.length) continue;
      ao[o.id] = { result: o.result, ...(typeof o.abnormal === "boolean" ? { abnormal: o.abnormal } : {}) };
    }
    if (Object.keys(ao).length) v.actionOverrides = ao;
  }
  if (!v.persona && !v.factOverrides && !v.actionOverrides) throw new Error("The draft came back empty. Try again, or add a note saying what should differ.");
  return v;
}

// ---------- Header repair ----------

/**
 * The large generation call occasionally returns the lists but omits the short header fields
 * (title, summary, specialty, setting, encounter type). This writes any that are missing from the
 * finished case, so a draft never arrives untitled. Fields that are present are left alone.
 */
export async function fillHeader(p: CaseProfile, level?: number): Promise<CaseProfile> {
  const missing = (["title", "summary", "specialty", "setting", "encounterType"] as const).filter((k) => !String(p[k] || "").trim());
  if (!missing.length) return p;
  const role = profession(p.professions[0]);
  try {
    const raw = await chatJSON<Record<string, string | number>>({
      model: MODELS.chat,
      maxTokens: 700,
      temperature: 0.2,
      system: "You label simulated patient cases for a faculty case library. Be specific and plain. Do not use the patient's name in the title.",
      schema: {
        type: "object",
        required: ["title", "summary", "specialty", "setting", "encounterType", "difficulty"],
        properties: {
          title: { type: "string", description: "Faculty-facing title, e.g. 'New-onset exertional chest pain in a 58-year-old smoker'" },
          summary: { type: "string", description: "2-3 sentence faculty-facing summary of the case and what it teaches" },
          specialty: { type: "string" },
          setting: { type: "string", description: "Always a telehealth video visit; say where the patient is calling from" },
          encounterType: { type: "string", description: `One of: ${role.encounterTypes.join(", ")}, or a similar short phrase` },
          difficulty: { type: "integer", minimum: 1, maximum: 5 },
        },
      },
      messages: [
        {
          role: "user",
          text: `LEARNER ROLE: ${role.name}\nPATIENT: ${JSON.stringify(p.patient)}\nSCENARIO: ${JSON.stringify(p.scenario)}\nANSWER KEY: ${JSON.stringify(p.answerKey)}\nOBJECTIVES: ${p.objectives.map((o) => o.text).join("; ")}\nSENSITIVE FACTS: ${p.facts.filter((f) => f.tier === "reluctant" || f.tier === "hidden").map((f) => f.chart).join("; ")}`,
        },
      ],
    });
    const out = { ...p };
    for (const k of missing) if (typeof raw[k] === "string" && raw[k]) out[k] = raw[k] as string;
    if (!level && Number(raw.difficulty) >= 1) out.difficulty = Math.max(1, Math.min(5, Math.round(Number(raw.difficulty))));
    return out;
  } catch (e) {
    console.error("[studio] header repair failed", e);
    const out = { ...p };
    if (!out.title.trim()) out.title = `${p.scenario.chiefComplaint || "New patient"} - ${p.patient.name}, ${p.patient.age}`;
    if (!out.setting.trim()) out.setting = "Telehealth video visit";
    return out;
  }
}
