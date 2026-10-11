import { chatJSON, MODELS } from "./llm";
import { makePortrait } from "./portrait";
import { profession } from "./professions";
import { FACT_CATEGORIES } from "./types";
import type { CaseProfile, Fact, ClinicalAction, Artifact } from "./types";

const str = { type: "string" };
const strArr = { type: "array", items: str };

/** JSON Schema the model must fill. Mirrors CaseProfile (ids are assigned by the model, then checked). */
export const CASE_SCHEMA = {
  type: "object",
  required: ["title", "summary", "specialty", "setting", "encounterType", "difficulty", "patient", "persona", "scenario", "chartAtStart", "facts", "actions", "artifacts", "objectives", "answerKey"],
  properties: {
    title: { type: "string", description: "Faculty-facing title, e.g. 'New-onset exertional chest pain in a 58-year-old smoker'" },
    summary: { type: "string", description: "2-3 sentence faculty-facing summary of the case and what it teaches" },
    specialty: str,
    setting: { type: "string", description: "Always a telehealth video visit; say where the patient is calling from, e.g. 'Telehealth video visit, patient at home'" },
    encounterType: { type: "string", description: "e.g. diagnostic interview, counseling, follow-up, medication review, discharge teaching, intake assessment" },
    difficulty: { type: "integer", minimum: 1, maximum: 5 },
    patient: {
      type: "object",
      required: ["name", "age", "sex", "pronouns", "ethnicity", "occupation", "language", "appearance"],
      properties: { name: str, age: { type: "integer" }, sex: str, pronouns: str, ethnicity: str, occupation: str, language: str, appearance: { type: "string", description: "What the student sees on the video call: posture, affect, surroundings" } },
    },
    persona: {
      type: "object",
      required: ["personality", "communicationStyle", "healthLiteracy", "emotionalState", "background", "speechExamples", "concerns"],
      properties: {
        personality: str,
        communicationStyle: str,
        healthLiteracy: { type: "string", enum: ["low", "moderate", "high"] },
        emotionalState: str,
        background: { type: "string", description: "Non-clinical life story the patient can chat about freely: family, work, hobbies, daily routine. No health facts here." },
        speechExamples: { type: "array", items: str, description: "3-5 short lines showing how this person talks" },
        concerns: { type: "array", items: str, description: "Worries/questions the patient may raise themselves" },
      },
    },
    scenario: {
      type: "object",
      required: ["studentBrief", "chiefComplaint", "openingLine", "tasks", "timeLimitMin"],
      properties: {
        studentBrief: { type: "string", description: "What the learner is told before joining the call: their role, the patient's name/age, reason for visit. Must not give away findings." },
        chiefComplaint: str,
        openingLine: { type: "string", description: "What the patient says when asked what brings them in. Must only contain 'initial' tier information." },
        tasks: { type: "array", items: str, description: "3-5 things the learner is expected to accomplish in this visit" },
        timeLimitMin: { type: "integer" },
      },
    },
    chartAtStart: {
      type: "array",
      description: "Header-level record items already in the EHR before the visit. Use these labels where they apply: 'Reason for visit', 'Problem list', 'Medications', 'Allergies', 'Last vitals', 'Immunizations', 'Care team', 'Code status'. Must be consistent with facts.",
      items: { type: "object", required: ["label", "value"], properties: { label: str, value: str } },
    },
    facts: {
      type: "array",
      description: "25-40 atomic facts the patient can disclose. Include pertinent negatives. Every fact is one idea.",
      items: {
        type: "object",
        required: ["id", "category", "topic", "chart", "says", "tier", "importance"],
        properties: {
          id: { type: "string", description: "f1, f2, ..." },
          category: { type: "string", enum: ["chief_complaint", "hpi", "pmh", "psh", "medications", "allergies", "family", "social", "substance", "sexual", "ros", "nutrition", "function", "psychosocial", "goals", "adherence", "other"] },
          topic: { type: "string", description: "2-4 word neutral topic label that does NOT reveal the answer, e.g. 'alcohol use', 'chest pain timing'" },
          chart: { type: "string", description: "Clinician wording for the chart, e.g. 'Drinks 4-6 beers nightly x 3 years'" },
          says: { type: "string", description: "The patient's own words, in character" },
          tier: { type: "string", enum: ["initial", "discoverable", "reluctant", "hidden"], description: "initial = volunteers readily; discoverable = shares when asked about the topic; reluctant = only when asked directly AND trust is established; hidden = only with strong rapport and a direct, sensitive question" },
          importance: { type: "string", enum: ["critical", "important", "minor"] },
          distractor: { type: "boolean", description: "true for a plausible red herring that is not relevant to the main problem (include 1-3)" },
        },
      },
    },
    actions: {
      type: "array",
      description: "8-18 things the learner in this role can do, request or order, each with a fixed approved result. Because this is telehealth, exams are guided remote exams (patient self-palpation, camera inspection, home devices) or results reported from the record/lab. Include normal results for reasonable-but-unhelpful tests too.",
      items: {
        type: "object",
        required: ["id", "kind", "name", "result", "importance"],
        properties: {
          id: { type: "string", description: "a1, a2, ..." },
          kind: { type: "string", enum: ["exam", "vitals", "lab", "imaging", "test", "record", "assessment", "procedure"] },
          name: str,
          aliases: strArr,
          result: { type: "string", description: "The finding/result text written to the chart" },
          abnormal: { type: "boolean" },
          importance: { type: "string", enum: ["critical", "important", "minor"] },
          artifactIds: strArr,
        },
      },
    },
    artifacts: {
      type: "array",
      description: "3-7 electronic health record documents: lab report (use table with reference ranges and H/L flags), ECG/imaging report (body text), prior visit or referral note, medication list (table), vitals flowsheet (table), and at least one trend chart when there is data over time. Values must exactly match the facts/actions.",
      items: {
        type: "object",
        required: ["id", "type", "title", "release"],
        properties: {
          id: { type: "string", description: "d1, d2, ..." },
          type: { type: "string", enum: ["lab_report", "ecg", "imaging", "note", "medication_list", "flowsheet", "chart", "form", "other"] },
          title: str,
          date: { type: "string", description: "Relative or absolute date of the document" },
          author: { type: "string", description: "Author or performing service" },
          body: str,
          chart: {
            type: "object",
            description: "Optional plotted data when a graph is the natural format: lab or vital trends over time, home BP/glucose logs, growth curve, audiogram (kind 'audiogram', x = frequency in Hz, y = dB HL, invertY true, series 'Right ear'/'Left ear'), spirometry, weight history.",
            required: ["kind", "xLabel", "yLabel", "series"],
            properties: {
              kind: { type: "string", enum: ["line", "bar", "audiogram"] },
              xLabel: str,
              yLabel: str,
              invertY: { type: "boolean" },
              refLow: { type: "number" },
              refHigh: { type: "number" },
              series: { type: "array", items: { type: "object", required: ["name", "points"], properties: { name: str, points: { type: "array", items: { type: "object", required: ["x", "y"], properties: { x: str, y: { type: "number" } } } } } } },
            },
          },
          table: {
            type: "object",
            required: ["columns", "rows"],
            properties: {
              columns: strArr,
              rows: { type: "array", items: { type: "object", required: ["cells"], properties: { cells: strArr, flag: { type: "string", enum: ["H", "L", "A", ""] } } } },
            },
          },
          release: {
            type: "object",
            required: ["when"],
            properties: { when: { type: "string", enum: ["start", "action", "fact"], description: "start = in chart from the beginning; action = appears when action `ref` is done; fact = appears when fact `ref` is disclosed" }, ref: str },
          },
        },
      },
    },
    objectives: {
      type: "array",
      description: "3-6 learning objectives, each linked to the facts/actions that demonstrate it",
      items: { type: "object", required: ["id", "text", "factIds", "actionIds"], properties: { id: { type: "string", description: "o1, o2, ..." }, text: str, factIds: strArr, actionIds: strArr } },
    },
    mismatches: {
      type: "array",
      description: "1-2 deliberate, realistic conflicts between what the patient says and what the record shows (e.g. says they take every dose, but the refill history or a lab says otherwise). The patient's claim must be one of the facts; the evidence must be in an artifact or action result.",
      items: {
        type: "object",
        required: ["id", "patientClaim", "recordEvidence", "teachingPoint"],
        properties: { id: { type: "string", description: "m1, m2" }, patientClaim: str, recordEvidence: str, teachingPoint: str, factId: str, artifactId: str },
      },
    },
    answerKey: {
      type: "object",
      required: ["primaryProblem", "differential", "keyFindings", "plan", "redFlags", "educationPoints"],
      properties: { primaryProblem: str, differential: strArr, keyFindings: strArr, plan: strArr, redFlags: strArr, educationPoints: strArr },
    },
  },
} as const;

const SYSTEM = `You are an expert clinical educator and simulation case writer for a health professions school. You write standardized-patient cases for a telehealth (video visit) simulator used by students of every health profession.

Quality bar:
- Clinically accurate and internally consistent: history, medications, vitals, labs, artifacts and the answer key must all agree (doses, units, dates, values).
- Realistic people, not textbook vignettes: lay language, partial understanding, real-life barriers, culture and context treated with respect.
- Progressive disclosure: sort facts into tiers. Sensitive or embarrassing things are 'reluctant' or 'hidden'. The main concern is 'initial'.
- 'says' is the patient's voice (no jargon unless the persona would use it). 'chart' is concise clinician wording.
- 'topic' labels must never reveal the answer.
- Scope everything to what the learner's profession actually does in a telehealth visit. Actions must be ones that role would perform or request remotely.
- Build in one or two patient-versus-chart mismatches: the patient sincerely says one thing while a chart document shows another. Spotting and gently exploring this is part of the exercise.
- Actions are things the learner does or reviews: an examination, a measurement, a named screening instrument, a record or result review. Never write an action that is only an interview question ("Ask about...", "Explore...").
- Nothing that exists before the visit may give the game away: chartAtStart, artifacts released at start, and action results must not reveal a reluctant or hidden fact or state the diagnosis the learner is meant to reach. Those come out only through the patient in conversation (a record may contain the objective evidence for a mismatch).
- Work out every score, grade and stage you state (BMI, percent weight change, CKD stage, CHA2DS2-VASc, AUDIT-C, CTCAE and the like) and check it against the numbers in the case.
- Lab tables use the columns Test, Result, Units, Reference range, and every row has all four cells.
- A mismatch's artifactId must be a document id (d...), never an action id.
- 'chart' records what the patient reports, in clinician wording, and never the hidden truth: if the patient under-reports, the fact reads "Reports taking sumatriptan 10-12 days a month" and the real figure lives only in a document, which is what makes it a mismatch. No commentary in chart wording or results ("far exceeding the recommended limit", "not indicated"): state the finding and stop.
- The title, summary and answer key are for faculty. The student brief and tasks are shown to the learner before the visit, so they must not name the diagnosis, the hidden problem or any finding: write tasks as "Take a focused history of the presenting concern", never "Identify medication overuse headache".
- Anything in the persona's background, concerns or opening line that is clinically relevant must also exist as a fact.
- Include pertinent negatives as facts so the patient can answer common screening questions.
- Keep lab values physiologically plausible with correct units and reference ranges.
- Do not include real people or identifiable data. This is synthetic educational content.`;

export interface GenerateInput {
  professionId: string;
  /** Free-text description from faculty, or a structured sample profile as JSON. */
  description: string;
  level?: number;
  /** Extra guidance (e.g. learning objectives, syllabus excerpt). */
  guidance?: string;
  portrait?: string;
}

/** Single-call generation. Kept as the fallback path for the staged generator below. */
async function generateSingle(input: GenerateInput): Promise<CaseProfile> {
  const p = profession(input.professionId);
  type Raw = Omit<CaseProfile, "version" | "professions" | "knowledge" | "rubricId">;
  let raw!: Raw;
  // The model occasionally omits required sections; one retry is cheaper than a broken case.
  for (let attempt = 0; attempt < 3; attempt++) {
    raw = await chatJSON<Raw>({
      model: MODELS.smart,
      system: SYSTEM,
      maxTokens: 20000,
      schema: CASE_SCHEMA as unknown as Record<string, unknown>,
      messages: [
        {
          role: "user",
          text: `Write a complete telehealth simulation case.
  
  LEARNER ROLE: ${p.name} (${p.roleTitle})
  ROLE SCOPE: ${p.scope}
  TYPICAL ENCOUNTERS: ${p.encounterTypes.join(", ")}
  ACTION KINDS THIS ROLE USES: ${p.actionKinds.join(", ")}
  DOCUMENTATION FORMAT: ${p.noteFormat}
  ${input.level ? `TARGET INTRINSIC DIFFICULTY: ${input.level} of 5` : ""}
  ${input.guidance ? `FACULTY GUIDANCE:\n${input.guidance}\n` : ""}
  CASE DESCRIPTION FROM FACULTY (treat every detail given here as fixed; fill in only what is missing):
  ${input.description}`,
        },
      ],
    });
    const missing = (CASE_SCHEMA.required as readonly string[]).filter((k) => (raw as unknown as Record<string, unknown>)[k] === undefined || (raw as unknown as Record<string, unknown>)[k] === "");
    // An empty or stringified-and-unparseable list is as bad as a missing one.
    const r = raw as unknown as Record<string, unknown>;
    for (const [k, min] of [["facts", 15], ["actions", 4], ["artifacts", 1], ["objectives", 2]] as const) {
      if (asArray(r[k]).length < min && !missing.includes(k)) missing.push(k);
    }
    if (!missing.length) break;
    if (attempt === 2) throw new Error(`The draft came back incomplete (missing ${missing.join(", ")}). Please try again.`);
  }
  const profile: CaseProfile = {
    version: 1,
    ...raw,
    professions: [p.id],
    knowledge: [],
    rubricId: "default",
  };
  if (input.portrait) profile.patient.portrait = input.portrait;
  return normalizeCase(profile);
}

/** Repairs ids and dangling references so the engine can trust the profile. */
// ---------- Staged generation ----------
// One large call takes about two minutes and sometimes drops a section. Instead: a short first call
// fixes the clinical story and every number in it; the long lists (facts, and exams + documents) are
// then written in parallel from that story; a final short call links objectives and mismatches to
// the ids that now exist. About half the wall-clock time, and each call is small enough to be reliable.

const P = CASE_SCHEMA.properties;
const OUTLINE_SCHEMA = {
  type: "object",
  required: ["title", "specialty", "setting", "encounterType", "difficulty", "patient", "voice", "chiefComplaint", "clinicalStory"],
  properties: {
    title: P.title,
    specialty: P.specialty,
    setting: P.setting,
    encounterType: P.encounterType,
    difficulty: P.difficulty,
    patient: P.patient,
    voice: { type: "string", description: "Two sentences: this person's personality and how they talk (vocabulary, health literacy, mood today)." },
    chiefComplaint: { type: "string", description: "The reason for the visit as booked, without the diagnosis." },
    clinicalStory: {
      type: "string",
      description:
        "The ground truth of the case in 300-450 words, for the other case writers (never shown to learners). Fix every specific that must agree across the case: timeline with durations; every medication with dose and frequency and how it is really taken; vitals; each lab or test value with units; examination findings; relevant negatives; the sensitive things the patient is slow to admit; the one or two patient-versus-chart mismatches (what the patient claims, and what a named record shows instead); one to three red herrings; what the learner in this role should do about it.",
    },
  },
};
const PEOPLE_SCHEMA = { type: "object", required: ["summary", "persona", "scenario", "answerKey"], properties: { summary: P.summary, persona: P.persona, scenario: P.scenario, answerKey: P.answerKey } };
const HALF_SCHEMA = { type: "object", required: ["facts"], properties: { facts: P.facts } };
const RECORD_SCHEMA = { type: "object", required: ["chartAtStart", "actions", "artifacts"], properties: { chartAtStart: P.chartAtStart, actions: P.actions, artifacts: P.artifacts } };
const LINK_SCHEMA = { type: "object", required: ["objectives", "mismatches"], properties: { objectives: P.objectives, mismatches: P.mismatches } };

interface Outline {
  title: string;
  specialty: string;
  setting: string;
  encounterType: string;
  difficulty: number;
  patient: CaseProfile["patient"];
  voice: string;
  chiefComplaint: string;
  clinicalStory: string;
}

async function stage<T>(label: string, schema: object, text: string, maxTokens: number, ok: (r: T) => boolean): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const r = await chatJSON<T>({ model: MODELS.smart, system: SYSTEM, schema: schema as Record<string, unknown>, maxTokens, messages: [{ role: "user", text }] });
    if (ok(r)) return r;
    console.error(`[casegen] ${label} attempt ${attempt + 1} unusable:`, Object.entries(r as Record<string, unknown>).map(([k, v]) => `${k}=${Array.isArray(v) ? `array(${v.length})` : typeof v === "string" ? `string(${v.length})` : typeof v}`).join(", "));
    if (attempt === 1) throw new Error(`Drafting the ${label} failed twice.`);
  }
}

async function generateStaged(input: GenerateInput): Promise<CaseProfile> {
  const p = profession(input.professionId);
  const brief = `LEARNER ROLE: ${p.name} (${p.roleTitle})
ROLE SCOPE: ${p.scope}
TYPICAL ENCOUNTERS: ${p.encounterTypes.join(", ")}
ACTION KINDS THIS ROLE USES: ${p.actionKinds.join(", ")}
DOCUMENTATION FORMAT: ${p.noteFormat}
${input.level ? `TARGET INTRINSIC DIFFICULTY: ${input.level} of 5\n` : ""}${input.guidance ? `FACULTY GUIDANCE:\n${input.guidance}\n` : ""}
CASE DESCRIPTION FROM FACULTY (treat every detail given here as fixed; fill in only what is missing):
${input.description}`;

  const t0 = Date.now();
  const o = await stage<Outline>(
    "case outline",
    OUTLINE_SCHEMA,
    `Plan a telehealth simulation case: the faculty-facing title, who the patient is, and the clinical story that fixes every specific. Other writers will fill in the lists from your story, so be exact and complete in it.\n\n${brief}`,
    3000,
    (r) => !!(r.title && r.patient?.name && (r.clinicalStory || "").length > 300),
  );

  const shared = `${brief}

THE CASE SO FAR (already decided; stay consistent with it and do not change any name, value or date)
Title (faculty only): ${o.title}
Setting: ${o.setting}. Encounter type: ${o.encounterType}. Reason for visit: ${o.chiefComplaint}
Patient: ${JSON.stringify(o.patient)}
How the patient talks: ${o.voice}

CLINICAL STORY (ground truth; use these exact values, and where you need a value it does not give, choose an unremarkable normal one)
${o.clinicalStory}`;

  // The long lists are written in parallel. The fact list is the longest, so it is split into two
  // halves with disjoint categories.
  const t1 = Date.now();
  // The portrait is drawn while the lists are being written, so it adds no waiting time.
  const portrait = input.portrait ? Promise.resolve(input.portrait) : makePortrait(o.patient);
  const [who, f1, f2, r] = await Promise.all([
    stage<Pick<CaseProfile, "summary" | "persona" | "scenario" | "answerKey">>(
      "persona and scenario",
      PEOPLE_SCHEMA,
      `Write the faculty summary, the patient's persona, the scenario the learner sees (brief, opening line, tasks, time limit) and the answer key for this case.\n\n${shared}`,
      4000,
      (x) => !!(x.persona?.personality && x.persona?.background && x.scenario?.studentBrief && x.scenario?.openingLine && x.answerKey?.primaryProblem),
    ),
    stage<Pick<CaseProfile, "facts">>(
      "medical history",
      HALF_SCHEMA,
      `Write the MEDICAL half of the patient facts for this case: only categories chief_complaint, hpi, ros, pmh, psh, medications, allergies (18-22 facts, including pertinent negatives; the presenting concern itself is tier initial). Use ids h1, h2, ... Another writer is covering family, social, substance, sexual, nutrition, function, psychosocial, goals and adherence, so leave those out.\n\n${shared}`,
      7000,
      (x) => asArray(x.facts).length >= 8,
    ),
    stage<Pick<CaseProfile, "facts">>(
      "personal history",
      HALF_SCHEMA,
      `Write the PERSONAL half of the patient facts for this case: only categories family, social, substance, sexual, nutrition, function, psychosocial, goals, adherence, other (14-18 facts). Use ids s1, s2, ... Another writer is covering the presenting complaint, review of systems, past history, medications and allergies, so leave those out. Do not restate symptoms of the presenting problem (including mood or safety symptoms when those are the presenting problem); they belong to the other writer. The sensitive personal items the patient is slow to admit mostly live here: give them tier reluctant or hidden.\n\n${shared}`,
      6000,
      (x) => asArray(x.facts).length >= 6,
    ),
    stage<Pick<CaseProfile, "chartAtStart" | "actions" | "artifacts">>(
      "exams and documents",
      RECORD_SCHEMA,
      `Write the chart-at-start items, the exams, tests and record reviews the learner can request (with their fixed results), and the chart documents for this case. A document appears either at the start or when an action is done: use release.when "start" or "action" with ref set to that action's id. Do not use "fact" here.\n\n${shared}`,
      10000,
      (x) => asArray(x.actions).length >= 4 && asArray(x.artifacts).length >= 1,
    ),
  ]);
  const t2 = Date.now();

  const facts = [...asArray<Fact>(f1.facts), ...asArray<Fact>(f2.facts)];
  const actions = asArray<ClinicalAction>(r.actions);
  const artifacts = asArray<Artifact>(r.artifacts);
  const link = await stage<Pick<CaseProfile, "objectives"> & { mismatches: CaseProfile["mismatches"] }>(
    "objectives",
    LINK_SCHEMA,
    `Write the learning objectives and the patient-versus-chart mismatches for this case, linking them to the ids below. Use only ids that appear in these lists.\n\n${brief}\n\nAnswer key: ${JSON.stringify(who.answerKey)}\nTasks given to the learner: ${asArray<string>(who.scenario.tasks).join("; ")}\n\nFACTS (id | tier | chart wording)\n${facts.map((x) => `${x.id} | ${x.tier} | ${x.chart}`).join("\n")}\n\nACTIONS (id | name | result)\n${actions.map((x) => `${x.id} | ${x.name} | ${(x.result || "").slice(0, 160)}`).join("\n")}\n\nDOCUMENTS (id | title)\n${artifacts.map((x) => `${x.id} | ${x.title}`).join("\n")}\n\nCLINICAL STORY\n${o.clinicalStory}`,
    3500,
    (x) => asArray(x.objectives).length >= 2,
  );
  console.log(`[casegen] outline ${Math.round((t1 - t0) / 1000)}s, lists ${Math.round((t2 - t1) / 1000)}s, linking ${Math.round((Date.now() - t2) / 1000)}s`);

  const profile: CaseProfile = {
    version: 1,
    title: o.title,
    summary: who.summary,
    specialty: o.specialty,
    setting: o.setting,
    encounterType: o.encounterType,
    difficulty: o.difficulty,
    patient: o.patient,
    persona: who.persona,
    scenario: { ...who.scenario, chiefComplaint: who.scenario.chiefComplaint || o.chiefComplaint },
    chartAtStart: r.chartAtStart,
    facts,
    actions,
    artifacts,
    objectives: link.objectives,
    mismatches: link.mismatches,
    answerKey: who.answerKey,
    professions: [p.id],
    knowledge: [],
    rubricId: "default",
  };
  const face = await portrait;
  if (face) profile.patient.portrait = face;
  return normalizeCase(profile);
}

export async function generateCase(input: GenerateInput): Promise<CaseProfile> {
  if (process.env.CASEGEN_SINGLE === "1") return generateSingle(input);
  try {
    return await generateStaged(input);
  } catch (e) {
    console.error("[casegen] staged generation failed, falling back to a single call:", (e as Error).message);
    return generateSingle(input);
  }
}

/** Models occasionally return an array as a JSON string; accept both. */
function asArray<T>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  if (typeof v === "string") {
    try {
      const p = JSON.parse(v);
      if (Array.isArray(p)) return p as T[];
    } catch {}
  }
  return [];
}

export function normalizeCase(c: CaseProfile): CaseProfile {
  const fix = <T extends { id: string }>(arr: T[] | undefined, prefix: string): T[] => {
    const seen = new Set<string>();
    return asArray<T>(arr).map((x, i) => {
      let id = (x.id || "").trim() || `${prefix}${i + 1}`;
      while (seen.has(id)) id = `${id}_${i + 1}`;
      seen.add(id);
      return { ...x, id };
    });
  };
  c.facts = fix<Fact>(c.facts, "f");
  c.actions = fix<ClinicalAction>(c.actions, "a");
  c.artifacts = fix<Artifact>(c.artifacts, "d");
  c.objectives = fix(c.objectives, "o");
  if (!c.facts.length) throw new Error("Generation returned no patient facts; please try again.");
  c.chartAtStart = asArray(c.chartAtStart);
  c.scenario.tasks = asArray(c.scenario.tasks);
  c.persona.speechExamples = asArray(c.persona.speechExamples);
  c.persona.concerns = asArray(c.persona.concerns);
  for (const k of ["differential", "keyFindings", "plan", "redFlags", "educationPoints"] as const) c.answerKey[k] = asArray(c.answerKey[k]);
  for (const o of c.objectives) {
    o.factIds = asArray(o.factIds);
    o.actionIds = asArray(o.actionIds);
  }
  for (const a of c.actions) a.artifactIds = asArray(a.artifactIds);
  const factIds = new Set(c.facts.map((f) => f.id));
  const actionIds = new Set(c.actions.map((a) => a.id));
  const artifactIds = new Set(c.artifacts.map((a) => a.id));
  for (const a of c.actions) a.artifactIds = (a.artifactIds || []).filter((id) => artifactIds.has(id));
  for (const o of c.objectives) {
    o.factIds = (o.factIds || []).filter((id) => factIds.has(id));
    o.actionIds = (o.actionIds || []).filter((id) => actionIds.has(id));
  }
  for (const d of c.artifacts) {
    if (!d.release) d.release = { when: "start" };
    if (d.release.when === "action" && !actionIds.has(d.release.ref || "")) {
      // Fall back to whichever action lists this artifact, else show from the start.
      const owner = c.actions.find((a) => a.artifactIds?.includes(d.id));
      d.release = owner ? { when: "action", ref: owner.id } : { when: "start" };
    }
    if (d.release.when === "fact" && !factIds.has(d.release.ref || "")) d.release = { when: "start" };
  }
  // Make action -> artifact links symmetrical.
  for (const d of c.artifacts) {
    if (d.release.when === "action") {
      const a = c.actions.find((x) => x.id === d.release.ref);
      if (a && !a.artifactIds!.includes(d.id)) a.artifactIds!.push(d.id);
    }
  }
  c.difficulty = Math.max(1, Math.min(5, Math.round(c.difficulty || 3)));
  c.scenario.timeLimitMin = Math.max(5, Math.min(60, Math.round(c.scenario.timeLimitMin || 20)));
  c.knowledge = c.knowledge || [];
  c.rubricId = c.rubricId || "default";
  c.professions = c.professions?.length ? c.professions : ["medicine"];
  c.variants = c.variants || [];
  c.mismatches = asArray<NonNullable<CaseProfile["mismatches"]>[number]>(c.mismatches).map((m) => ({
    ...m,
    artifactId: m.artifactId && artifactIds.has(m.artifactId) ? m.artifactId : undefined,
    factId: m.factId && factIds.has(m.factId) ? m.factId : undefined,
  }));
  const CATEGORIES = new Set(Object.keys(FACT_CATEGORIES));
  for (const f of c.facts) if (!CATEGORIES.has(f.category)) f.category = "other";
  // Ragged table rows break the chart layout: pad or trim every row to the header width.
  for (const d of c.artifacts) {
    if (!d.table) continue;
    d.table.columns = asArray<string>(d.table.columns);
    d.table.rows = asArray<{ cells: string[]; flag?: "H" | "L" | "A" | "" }>(d.table.rows).map((r) => {
      const cells = asArray<string>(r.cells).slice(0, d.table!.columns.length);
      while (cells.length < d.table!.columns.length) cells.push("");
      return { ...r, cells };
    });
  }
  if (!c.persona?.personality || !c.persona?.background) throw new Error("Generation returned no persona; please try again.");
  return c;
}
