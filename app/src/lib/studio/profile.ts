// Pure helpers for working with a CaseProfile in the Patient Studio. Safe to import from client components.
import { FACT_CATEGORIES } from "@/lib/types";
import type { ActionKind, Artifact, CaseProfile, ClinicalAction, DataSource, Fact, Importance, Mismatch, Objective, Tier, Variant } from "@/lib/types";

export const TIERS: { id: Tier; label: string; rule: string }[] = [
  { id: "initial", label: "Volunteered", rule: "The patient says this without being asked, in the opening line or the first replies." },
  { id: "discoverable", label: "When asked", rule: "The patient shares this as soon as the student asks about the topic." },
  { id: "reluctant", label: "Needs trust", rule: "The patient deflects until the student asks directly and has built some rapport." },
  { id: "hidden", label: "Guarded", rule: "The patient shares this only with strong rapport and a direct, sensitive question." },
];
export const tierLabel = (t: string) => TIERS.find((x) => x.id === t)?.label || t;

export const IMPORTANCE: Importance[] = ["critical", "important", "minor"];

export const ACTION_KINDS: { id: ActionKind; label: string }[] = [
  { id: "exam", label: "Guided exam" },
  { id: "vitals", label: "Vitals" },
  { id: "lab", label: "Lab" },
  { id: "imaging", label: "Imaging" },
  { id: "test", label: "Test" },
  { id: "record", label: "Record review" },
  { id: "assessment", label: "Assessment" },
  { id: "procedure", label: "Procedure" },
];

export const ARTIFACT_TYPES: { id: Artifact["type"]; label: string }[] = [
  { id: "lab_report", label: "Lab report" },
  { id: "ecg", label: "ECG" },
  { id: "imaging", label: "Imaging (X-ray, CT, ultrasound)" },
  { id: "note", label: "Prior note or letter" },
  { id: "medication_list", label: "Medication list" },
  { id: "flowsheet", label: "Flowsheet" },
  { id: "chart", label: "Trend chart" },
  { id: "form", label: "Form or questionnaire" },
  { id: "other", label: "Other document" },
];

export const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "patient", label: "Patient and persona" },
  { id: "scenario", label: "Scenario" },
  { id: "chart", label: "Chart at start" },
  { id: "facts", label: "Facts and disclosure" },
  { id: "actions", label: "Exams and orders" },
  { id: "artifacts", label: "Documents" },
  { id: "objectives", label: "Learning objectives" },
  { id: "answer", label: "Answer key" },
  { id: "mismatches", label: "Patient vs chart" },
  { id: "knowledge", label: "Knowledge sources" },
  { id: "rubric", label: "Rubric" },
  { id: "variants", label: "Variants" },
] as const;
export type SectionId = (typeof SECTIONS)[number]["id"] | "consistency" | "preview";

/** Which editor section a patch path or top-level key belongs to. */
export function sectionForPath(path: string): SectionId {
  const top = path.split(".")[0];
  const map: Record<string, SectionId> = {
    title: "overview", summary: "overview", professions: "overview", specialty: "overview", setting: "overview", encounterType: "overview", difficulty: "overview",
    patient: "patient", persona: "patient", scenario: "scenario", chartAtStart: "chart", facts: "facts", actions: "actions", artifacts: "artifacts",
    objectives: "objectives", answerKey: "answer", mismatches: "mismatches", knowledge: "knowledge", rubricId: "rubric", variants: "variants",
  };
  return map[top] || "overview";
}

const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : v == null ? d : typeof v === "object" ? JSON.stringify(v) : String(v));
const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const strs = (v: unknown): string[] => list<unknown>(v).map((x) => str(x));
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], d: T): T => (allowed.includes(v as T) ? (v as T) : d);
const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) && v !== "" && v != null ? Number(v) : d);

/** Next free id with the given prefix: f1, f2 ... */
export function nextId(items: { id: string }[], prefix: string): string {
  let max = 0;
  for (const it of items) {
    const m = new RegExp(`^${prefix}(\\d+)$`).exec(it.id || "");
    if (m) max = Math.max(max, Number(m[1]));
  }
  let n = Math.max(max, items.length) + 1;
  while (items.some((x) => x.id === `${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

function uniqueIds<T extends { id: string }>(items: T[], prefix: string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    let id = str(it.id).trim();
    if (!id || seen.has(id)) id = nextId([...out, ...items.filter((x) => x !== it)], prefix);
    seen.add(id);
    out.push(id === it.id ? it : { ...it, id });
  }
  return out;
}

const TIER_IDS = TIERS.map((t) => t.id);
const KIND_IDS = ACTION_KINDS.map((k) => k.id);
const TYPE_IDS = ARTIFACT_TYPES.map((t) => t.id);

function cleanFact(v: unknown): Fact {
  const f = obj(v);
  const out: Fact = {
    id: str(f.id),
    category: str(f.category) in FACT_CATEGORIES ? str(f.category) : "other",
    topic: str(f.topic),
    chart: str(f.chart),
    says: str(f.says),
    tier: oneOf(f.tier, TIER_IDS, "discoverable"),
    importance: oneOf(f.importance, IMPORTANCE, "important"),
  };
  if (f.distractor) out.distractor = true;
  return out;
}
function cleanAction(v: unknown): ClinicalAction {
  const a = obj(v);
  const out: ClinicalAction = {
    id: str(a.id),
    kind: oneOf(a.kind, KIND_IDS, "exam"),
    name: str(a.name),
    aliases: strs(a.aliases).map((x) => x.trim()).filter(Boolean),
    result: str(a.result),
    importance: oneOf(a.importance, IMPORTANCE, "important"),
    artifactIds: strs(a.artifactIds),
  };
  if (a.abnormal) out.abnormal = true;
  return out;
}
function cleanArtifact(v: unknown): Artifact {
  const d = obj(v);
  const rel = obj(d.release);
  const when = oneOf(rel.when, ["start", "action", "fact"] as const, "start");
  const out: Artifact = { id: str(d.id), type: oneOf(d.type, TYPE_IDS, "other"), title: str(d.title), release: when === "start" ? { when } : { when, ref: str(rel.ref) } };
  if (d.date != null && d.date !== "") out.date = str(d.date);
  if (d.author != null && d.author !== "") out.author = str(d.author);
  if (d.body != null && d.body !== "") out.body = str(d.body);
  if (d.fileUrl) out.fileUrl = str(d.fileUrl);
  const t = obj(d.table);
  if (Array.isArray(t.columns)) {
    const columns = strs(t.columns);
    out.table = {
      columns,
      rows: list<unknown>(t.rows).map((r) => {
        const row = Array.isArray(r) ? { cells: r } : obj(r);
        return { cells: strs(row.cells), flag: oneOf(row.flag, ["H", "L", "A", ""] as const, "") };
      }),
    };
  }
  const c = obj(d.chart);
  if (Array.isArray(c.series)) {
    out.chart = {
      kind: oneOf(c.kind, ["line", "bar", "audiogram"] as const, "line"),
      xLabel: str(c.xLabel),
      yLabel: str(c.yLabel),
      series: list<unknown>(c.series).map((s) => {
        const so = obj(s);
        return { name: str(so.name), points: list<unknown>(so.points).map((pt) => ({ x: str(obj(pt).x), y: num(obj(pt).y, 0) })) };
      }),
    };
    if (c.invertY) out.chart.invertY = true;
    if (c.refLow != null && c.refLow !== "") out.chart.refLow = num(c.refLow, 0);
    if (c.refHigh != null && c.refHigh !== "") out.chart.refHigh = num(c.refHigh, 0);
  }
  return out;
}
function cleanVariant(v: unknown): Variant {
  const x = obj(v);
  const out: Variant = { id: str(x.id), label: str(x.label), description: str(x.description), approved: x.approved === true };
  if (x.persona && typeof x.persona === "object") out.persona = x.persona as Variant["persona"];
  if (x.factOverrides && typeof x.factOverrides === "object") out.factOverrides = x.factOverrides as Variant["factOverrides"];
  if (x.actionOverrides && typeof x.actionOverrides === "object") out.actionOverrides = x.actionOverrides as Variant["actionOverrides"];
  return out;
}

/**
 * Coerces anything profile-shaped into a structurally valid CaseProfile: every array is an array, every
 * enum has an allowed value, ids are unique. It never removes references; the consistency check reports those.
 */
export function sanitizeProfile(input: unknown): CaseProfile {
  const c = obj(input);
  const pt = obj(c.patient);
  const pe = obj(c.persona);
  const sc = obj(c.scenario);
  const ak = obj(c.answerKey);
  const patient: CaseProfile["patient"] = {
    name: str(pt.name),
    age: Math.max(0, Math.round(num(pt.age, 40))),
    sex: str(pt.sex),
    pronouns: str(pt.pronouns),
    ethnicity: str(pt.ethnicity),
    occupation: str(pt.occupation),
    language: str(pt.language, "English"),
    appearance: str(pt.appearance),
  };
  if (pt.portrait) patient.portrait = str(pt.portrait);
  return {
    version: 1,
    title: str(c.title),
    summary: str(c.summary),
    professions: strs(c.professions).filter(Boolean),
    specialty: str(c.specialty),
    setting: str(c.setting),
    encounterType: str(c.encounterType),
    difficulty: Math.max(1, Math.min(5, Math.round(num(c.difficulty, 3)))),
    patient,
    persona: {
      personality: str(pe.personality),
      communicationStyle: str(pe.communicationStyle),
      healthLiteracy: oneOf(pe.healthLiteracy, ["low", "moderate", "high"] as const, "moderate"),
      emotionalState: str(pe.emotionalState),
      background: str(pe.background),
      speechExamples: strs(pe.speechExamples),
      concerns: strs(pe.concerns),
    },
    scenario: {
      studentBrief: str(sc.studentBrief),
      chiefComplaint: str(sc.chiefComplaint),
      openingLine: str(sc.openingLine),
      tasks: strs(sc.tasks),
      timeLimitMin: Math.max(5, Math.min(60, Math.round(num(sc.timeLimitMin, 20)))),
    },
    chartAtStart: list<unknown>(c.chartAtStart).map((x) => ({ label: str(obj(x).label), value: str(obj(x).value) })),
    facts: uniqueIds(list<unknown>(c.facts).map(cleanFact), "f"),
    actions: uniqueIds(list<unknown>(c.actions).map(cleanAction), "a"),
    artifacts: uniqueIds(list<unknown>(c.artifacts).map(cleanArtifact), "d"),
    objectives: uniqueIds(
      list<unknown>(c.objectives).map((x): Objective => ({ id: str(obj(x).id), text: str(obj(x).text), factIds: strs(obj(x).factIds), actionIds: strs(obj(x).actionIds) })),
      "o",
    ),
    answerKey: {
      primaryProblem: str(ak.primaryProblem),
      differential: strs(ak.differential),
      keyFindings: strs(ak.keyFindings),
      plan: strs(ak.plan),
      redFlags: strs(ak.redFlags),
      educationPoints: strs(ak.educationPoints),
    },
    knowledge: uniqueIds(
      list<unknown>(c.knowledge).map((x) => ({ id: str(obj(x).id), title: str(obj(x).title), text: str(obj(x).text) })),
      "k",
    ),
    rubricId: str(c.rubricId, "default") || "default",
    variants: uniqueIds(list<unknown>(c.variants).map(cleanVariant), "v"),
    mismatches: uniqueIds(
      list<unknown>(c.mismatches).map((x): Mismatch => {
        const m = obj(x);
        const out: Mismatch = { id: str(m.id), patientClaim: str(m.patientClaim), recordEvidence: str(m.recordEvidence), teachingPoint: str(m.teachingPoint) };
        if (m.factId) out.factId = str(m.factId);
        if (m.artifactId) out.artifactId = str(m.artifactId);
        return out;
      }),
      "m",
    ),
    ...(dataSource(c.dataSource) ? { dataSource: dataSource(c.dataSource) } : {}),
  };
}

function dataSource(x: unknown): DataSource | undefined {
  const d = obj(x);
  if (!d.dataset || !d.row) return undefined;
  const values: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj(d.values))) values[k] = str(v);
  return { dataset: str(d.dataset), row: Math.round(num(d.row, 0)), condition: str(d.condition), conditionLabel: str(d.conditionLabel), values, documentId: str(d.documentId), actionIds: strs(d.actionIds) };
}

export function blankProfile(professionId: string): CaseProfile {
  return sanitizeProfile({
    title: "Untitled patient",
    professions: [professionId],
    setting: "Telehealth video visit, patient at home",
    difficulty: 3,
    patient: { name: "New Patient", age: 40, language: "English" },
    scenario: { timeLimitMin: 20 },
    facts: [{ id: "f1", category: "chief_complaint", topic: "reason for visit", chart: "", says: "", tier: "initial", importance: "critical" }],
  });
}

/** Stable short hash of a profile, used to tell whether a stored consistency result is out of date. */
export function hashProfile(p: CaseProfile): string {
  const s = JSON.stringify(p);
  let h1 = 5381;
  let h2 = 52711;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = (h1 * 33) ^ ch;
    h2 = (h2 * 33) ^ ch;
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36) + s.length.toString(36);
}

// ---------- Deletions that also clear every reference to the deleted item ----------

export function deleteFact(p: CaseProfile, id: string): CaseProfile {
  return {
    ...p,
    facts: p.facts.filter((f) => f.id !== id),
    objectives: p.objectives.map((o) => (o.factIds.includes(id) ? { ...o, factIds: o.factIds.filter((x) => x !== id) } : o)),
    artifacts: p.artifacts.map((d) => (d.release.when === "fact" && d.release.ref === id ? { ...d, release: { when: "start" as const } } : d)),
    mismatches: (p.mismatches || []).map((m) => {
      if (m.factId !== id) return m;
      const { factId: _drop, ...rest } = m;
      void _drop;
      return rest;
    }),
    variants: (p.variants || []).map((v) => {
      if (!v.factOverrides || !(id in v.factOverrides)) return v;
      const fo = { ...v.factOverrides };
      delete fo[id];
      return { ...v, factOverrides: fo };
    }),
  };
}

export function deleteAction(p: CaseProfile, id: string): CaseProfile {
  return {
    ...p,
    actions: p.actions.filter((a) => a.id !== id),
    objectives: p.objectives.map((o) => (o.actionIds.includes(id) ? { ...o, actionIds: o.actionIds.filter((x) => x !== id) } : o)),
    artifacts: p.artifacts.map((d) => (d.release.when === "action" && d.release.ref === id ? { ...d, release: { when: "start" as const } } : d)),
    variants: (p.variants || []).map((v) => {
      if (!v.actionOverrides || !(id in v.actionOverrides)) return v;
      const ao = { ...v.actionOverrides };
      delete ao[id];
      return { ...v, actionOverrides: ao };
    }),
  };
}

export function deleteArtifact(p: CaseProfile, id: string): CaseProfile {
  return {
    ...p,
    artifacts: p.artifacts.filter((d) => d.id !== id),
    actions: p.actions.map((a) => (a.artifactIds?.includes(id) ? { ...a, artifactIds: a.artifactIds.filter((x) => x !== id) } : a)),
    mismatches: (p.mismatches || []).map((m) => {
      if (m.artifactId !== id) return m;
      const { artifactId: _drop, ...rest } = m;
      void _drop;
      return rest;
    }),
  };
}

/** Sets when a document appears, keeping the action -> document links in step with the rule. */
export function setRelease(p: CaseProfile, artifactId: string, release: Artifact["release"]): CaseProfile {
  return {
    ...p,
    artifacts: p.artifacts.map((d) => (d.id === artifactId ? { ...d, release } : d)),
    actions: p.actions.map((a) => {
      const has = !!a.artifactIds?.includes(artifactId);
      const should = release.when === "action" && release.ref === a.id;
      if (has === should) return a;
      return { ...a, artifactIds: should ? [...(a.artifactIds || []), artifactId] : (a.artifactIds || []).filter((x) => x !== artifactId) };
    }),
  };
}

export function releaseLabel(p: CaseProfile, d: Artifact): string {
  if (d.release.when === "start") return "In the chart from the start";
  if (d.release.when === "action") {
    const a = p.actions.find((x) => x.id === d.release.ref);
    return a ? `After the student does: ${a.name}` : "After an action that no longer exists";
  }
  const f = p.facts.find((x) => x.id === d.release.ref);
  return f ? `After the patient discloses: ${f.topic}` : "After a fact that no longer exists";
}

/**
 * Format clean-up for freshly generated or imported cases. The chart renderer draws its own Flag column
 * from each row's `flag`, so a literal "Flag" column in the data would show twice.
 */
export function tidyTables(p: CaseProfile): CaseProfile {
  return {
    ...p,
    artifacts: p.artifacts.map((d) => {
      const t = d.table;
      if (!t || !t.columns.length) return d;
      const last = t.columns.length - 1;
      if (!/^flags?$/i.test(t.columns[last].trim())) return d;
      const rows = t.rows.map((r) => {
        if (r.cells.length <= last) return r;
        const v = (r.cells[last] || "").trim().toUpperCase();
        const flag = r.flag || (v === "H" || v === "HIGH" ? "H" : v === "L" || v === "LOW" ? "L" : v === "A" || v === "ABNORMAL" ? "A" : "");
        return { cells: r.cells.slice(0, last), flag: flag as "H" | "L" | "A" | "" };
      });
      return { ...d, table: { columns: t.columns.slice(0, last), rows } };
    }),
  };
}
