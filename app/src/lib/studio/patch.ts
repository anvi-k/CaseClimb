// A patch is a short list of field-level edits to a CaseProfile. The AI guide and the consistency check
// only ever return patches; nothing is applied until a faculty member accepts it. Pure; client-safe.
import { FACT_CATEGORIES } from "@/lib/types";
import type { CaseProfile } from "@/lib/types";
import { deleteAction, deleteArtifact, deleteFact, nextId, sanitizeProfile } from "./profile";

export interface PatchOp {
  op: "set" | "add" | "remove";
  /** Dot path. Items in lists are addressed by id (facts.f3.says) or by position (scenario.tasks.0). */
  path: string;
  value?: unknown;
}

/** Shown to the model wherever it is asked to produce a patch. */
export const PATCH_DOC = `PATCH FORMAT
A patch is a list of operations on the case JSON. Each operation is { op, path, value }.
- path is a dot path from the root of the case. Items in facts, actions, artifacts, objectives, mismatches, knowledge and variants are addressed by their id: "facts.f3.says", "actions.a2.result", "artifacts.d1.release", "objectives.o2.factIds". Items in plain lists are addressed by zero-based position: "scenario.tasks.0", "chartAtStart.2.value", "answerKey.plan.1", "artifacts.d1.table.rows.3.cells.1".
- op "set": replace the value at path. Use it for a single field, or to replace a whole list ("answerKey.differential").
- op "add": append value to the list at path ("facts", "actions", "artifacts", "objectives", "mismatches", "chartAtStart", "scenario.tasks", "artifacts.d1.table.rows" ...). A new fact, action, artifact, objective or mismatch must be a complete object with a new unused id (next number in sequence).
- op "remove": delete the item or field at path ("facts.f12", "scenario.tasks.3"). No value.
- value is real JSON (a string, number, boolean, list or object), never JSON encoded inside a string.
- Change the smallest field that fixes the problem. Do not rewrite whole objects to change one field.
- If a value appears in several places (a dose in a fact, in the medication list table and in Chart at start), patch every place so they agree.
Field reference: fact = { id, category, topic, chart, says, tier: initial|discoverable|reluctant|hidden, importance: critical|important|minor, distractor? }. action = { id, kind: exam|vitals|lab|imaging|test|record|assessment|procedure, name, aliases[], result, abnormal?, importance, artifactIds[] }. artifact = { id, type: lab_report|ecg|imaging|note|medication_list|flowsheet|chart|form|other, title, date, author, body?, table?: { columns[], rows: [{ cells[], flag: "H"|"L"|"A"|"" }] }, chart?: { kind: line|bar|audiogram, xLabel, yLabel, refLow?, refHigh?, series: [{ name, points: [{ x, y }] }] }, release: { when: start|action|fact, ref? } }. objective = { id, text, factIds[], actionIds[] }. mismatch = { id, patientClaim, recordEvidence, teachingPoint, factId?, artifactId? }.
Fact categories: ${Object.keys(FACT_CATEGORIES).join(", ")}.
An artifact that should appear when the student orders something needs release { when: "action", ref: <action id> } and that action needs the artifact id in artifactIds.`;

export const PATCH_OPS_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    required: ["op", "path"],
    properties: {
      op: { type: "string", enum: ["set", "add", "remove"] },
      path: { type: "string", description: "Dot path, e.g. facts.f3.says" },
      value: { description: "New value as real JSON (string, number, boolean, array or object). Omit for remove." },
    },
  },
} as const;

type Node = Record<string, unknown> | unknown[];

export function splitPath(path: string): string[] {
  return String(path || "")
    .replace(/^\$\.?/, "")
    .replace(/\[(?:id=)?["']?([^\]"']+)["']?\]/g, ".$1")
    .replace(/\//g, ".")
    .split(".")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Resolves one path segment against a node. Lists match by id, then by label, then by position. */
function keyIn(node: unknown, seg: string): string | number | null {
  if (Array.isArray(node)) {
    const byId = node.findIndex((x) => x && typeof x === "object" && (x as { id?: string }).id === seg);
    if (byId >= 0) return byId;
    if (/^\d+$/.test(seg)) return Number(seg);
    const byLabel = node.findIndex((x) => x && typeof x === "object" && (x as { label?: string }).label === seg);
    return byLabel >= 0 ? byLabel : null;
  }
  if (node && typeof node === "object") return seg;
  return null;
}

export function getAt(root: unknown, path: string): unknown {
  let node: unknown = root;
  for (const seg of splitPath(path)) {
    const k = keyIn(node, seg);
    if (k === null) return undefined;
    node = (node as Record<string | number, unknown>)[k];
    if (node === undefined) return undefined;
  }
  return node;
}

const ID_PREFIX: Record<string, string> = { facts: "f", actions: "a", artifacts: "d", objectives: "o", mismatches: "m", knowledge: "k", variants: "v" };

/** Models sometimes send a list or object as a JSON string. Decode it when the target is not a string. */
function coerce(value: unknown, like: unknown): unknown {
  if (typeof value !== "string") return value;
  const t = value.trim();
  if (typeof like === "number" && t !== "" && Number.isFinite(Number(t))) return Number(t);
  if (typeof like === "boolean" && (t === "true" || t === "false")) return t === "true";
  if ((like === undefined || typeof like === "object") && /^[[{]/.test(t)) {
    try {
      return JSON.parse(t);
    } catch {}
  }
  return value;
}

function applyOne(root: CaseProfile, op: PatchOp): CaseProfile {
  const segs = splitPath(op.path);
  if (!segs.length) throw new Error("empty path");
  // Removing a whole fact, action or document also clears every reference to it.
  if (op.op === "remove" && segs.length === 2) {
    const [top, id] = segs;
    const listAt = (root as unknown as Record<string, unknown>)[top];
    const k = keyIn(listAt, id);
    if (Array.isArray(listAt) && k !== null && listAt[k as number]) {
      const realId = (listAt[k as number] as { id?: string }).id;
      if (realId && top === "facts") return deleteFact(root, realId);
      if (realId && top === "actions") return deleteAction(root, realId);
      if (realId && top === "artifacts") return deleteArtifact(root, realId);
    }
  }
  let node: unknown = root;
  for (let i = 0; i < segs.length - 1; i++) {
    const k = keyIn(node, segs[i]);
    if (k === null) throw new Error(`"${segs.slice(0, i + 1).join(".")}" does not exist`);
    let next = (node as Record<string | number, unknown>)[k];
    if (next === undefined || next === null) {
      if (Array.isArray(node)) throw new Error(`"${segs.slice(0, i + 1).join(".")}" does not exist`);
      // Create a missing optional container (e.g. artifacts.d1.table) on the way down.
      next = {};
      (node as Record<string, unknown>)[k as string] = next;
    }
    node = next;
  }
  const last = segs[segs.length - 1];
  const parent = node as Node;
  if (op.op === "add") {
    const k = keyIn(parent, last);
    if (k === null) throw new Error(`"${op.path}" does not exist`);
    let target = (parent as Record<string | number, unknown>)[k];
    if (target === undefined || target === null) {
      target = [];
      (parent as Record<string | number, unknown>)[k] = target;
    }
    if (!Array.isArray(target)) throw new Error(`"${op.path}" is not a list`);
    const sample = target.find((x) => x !== undefined);
    let value = coerce(op.value, sample === undefined ? undefined : sample);
    if (value === undefined) throw new Error("add needs a value");
    const prefix = segs.length === 1 ? ID_PREFIX[last] : undefined;
    if (prefix) {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`a new item in ${last} must be an object`);
      const v = value as { id?: string };
      if (!v.id || (target as { id: string }[]).some((x) => x.id === v.id)) value = { ...v, id: nextId(target as { id: string }[], prefix) };
    }
    target.push(value);
    return root;
  }
  const k = keyIn(parent, last);
  if (k === null) throw new Error(`"${op.path}" does not exist`);
  if (op.op === "remove") {
    if (Array.isArray(parent)) {
      if (typeof k !== "number" || k >= parent.length) throw new Error(`"${op.path}" does not exist`);
      parent.splice(k, 1);
    } else {
      if (!(k in parent)) throw new Error(`"${op.path}" does not exist`);
      delete parent[k as string];
    }
    return root;
  }
  // set
  if (op.value === undefined) throw new Error("set needs a value");
  if (Array.isArray(parent)) {
    if (typeof k !== "number" || k > parent.length) throw new Error(`"${op.path}" does not exist`);
    parent[k] = coerce(op.value, parent[k]);
  } else {
    if (segs.length >= 3 && last === "id") throw new Error("ids cannot be changed");
    parent[k as string] = coerce(op.value, parent[k as string]);
  }
  return root;
}

export interface PatchResult {
  profile: CaseProfile;
  /** One entry per operation that could not be applied. */
  errors: { index: number; op: PatchOp; message: string }[];
  applied: number;
}

/** Applies a patch to a copy of the profile. Operations that do not fit are skipped and reported. */
export function applyPatch(profile: CaseProfile, ops: PatchOp[]): PatchResult {
  let work: CaseProfile = JSON.parse(JSON.stringify(profile));
  const errors: PatchResult["errors"] = [];
  let applied = 0;
  ops.forEach((op, index) => {
    const backup = JSON.stringify(work);
    try {
      if (!op || !["set", "add", "remove"].includes(op.op)) throw new Error("unknown operation");
      work = applyOne(work, op);
      applied++;
    } catch (e) {
      work = JSON.parse(backup);
      errors.push({ index, op, message: (e as Error).message });
    }
  });
  return { profile: sanitizeProfile(work), errors, applied };
}

/** Keeps only the operations that apply cleanly, in order. Used server-side before a patch is shown. */
export function validOps(profile: CaseProfile, ops: unknown): PatchOp[] {
  const clean: PatchOp[] = (Array.isArray(ops) ? ops : [])
    .filter((o) => o && typeof o === "object" && typeof (o as PatchOp).path === "string")
    .map((o) => {
      const x = o as PatchOp;
      return x.op === "remove" ? { op: x.op, path: splitPath(x.path).join(".") } : { op: x.op, path: splitPath(x.path).join("."), value: x.value };
    });
  const bad = new Set(applyPatch(profile, clean).errors.map((e) => e.index));
  return clean.filter((_, i) => !bad.has(i));
}

// ---------- Describing a patch for review ----------

const FIELD_LABEL: Record<string, string> = {
  title: "Title", summary: "Summary", specialty: "Specialty", setting: "Setting", encounterType: "Encounter type", difficulty: "Difficulty", professions: "Learner roles",
  patient: "Patient", persona: "Persona", scenario: "Scenario", chartAtStart: "Chart at start", answerKey: "Answer key", rubricId: "Rubric",
  name: "Name", age: "Age", sex: "Sex", pronouns: "Pronouns", ethnicity: "Ethnicity", occupation: "Occupation", language: "Language", appearance: "Appearance on the call",
  personality: "Personality", communicationStyle: "Communication style", healthLiteracy: "Health literacy", emotionalState: "Emotional state", background: "Background",
  speechExamples: "Speech examples", concerns: "Concerns", studentBrief: "Student brief", chiefComplaint: "Chief concern", openingLine: "Opening line", tasks: "Tasks",
  timeLimitMin: "Time limit (min)", category: "Category", topic: "Topic", chart: "Chart wording", says: "Patient wording", tier: "Disclosure tier", importance: "Importance",
  distractor: "Distractor", kind: "Kind", aliases: "Also matches", result: "Result", abnormal: "Abnormal", artifactIds: "Linked documents", type: "Type", date: "Date",
  author: "Author", body: "Body", table: "Table", columns: "Columns", rows: "Rows", cells: "Cells", flag: "Flag", release: "Release rule", text: "Text", factIds: "Linked facts",
  actionIds: "Linked actions", primaryProblem: "Primary problem", differential: "Differential", keyFindings: "Key findings", plan: "Plan", redFlags: "Red flags",
  educationPoints: "Education points", id: "Id", when: "When", ref: "Ref", xLabel: "X axis", yLabel: "Y axis", points: "Points", refLow: "Reference low", refHigh: "Reference high", patientClaim: "Patient says", recordEvidence: "Record shows", teachingPoint: "Teaching point", factId: "Linked fact",
  artifactId: "Linked document", label: "Label", value: "Value", description: "Description", series: "Series", fileUrl: "Uploaded file",
};
const ITEM_NOUN: Record<string, string> = { facts: "Fact", actions: "Action", artifacts: "Document", objectives: "Objective", mismatches: "Mismatch", knowledge: "Source", variants: "Variant", chartAtStart: "Chart item" };

function itemName(top: string, item: unknown): string {
  const x = (item || {}) as Record<string, string>;
  return String(x.topic || x.name || x.title || x.label || x.text || x.patientClaim || "").slice(0, 60);
}

export interface OpView {
  verb: "Change" | "Add" | "Remove";
  /** e.g. "Fact f3 (alcohol use) - Patient wording" */
  where: string;
  before?: string;
  after?: string;
}

export function formatValue(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    if (v.every((x) => typeof x !== "object" || x === null)) return v.map((x) => `- ${x}`).join("\n");
    return v.map((x) => formatValue(x)).join("\n---\n");
  }
  const o = v as Record<string, unknown>;
  if (typeof o.when === "string" && Object.keys(o).every((k) => k === "when" || k === "ref")) return o.when === "start" ? "from the start of the visit" : o.when === "action" ? `when action ${o.ref} is done` : `when fact ${o.ref} is disclosed`;
  return Object.keys(o)
    .filter((k) => o[k] !== undefined && o[k] !== "" && o[k] !== false && !(Array.isArray(o[k]) && !(o[k] as unknown[]).length))
    .map((k) => {
      const val = o[k];
      let text: string;
      if (k === "table" && val && typeof val === "object") {
        const t = val as { columns?: string[]; rows?: { cells?: string[]; flag?: string }[] };
        text = [(t.columns || []).join(" | "), ...(t.rows || []).map((r) => (r.cells || []).join(" | ") + (r.flag ? ` [${r.flag}]` : ""))].join("\n  ");
      } else if (Array.isArray(val) && val.every((x) => typeof x !== "object")) text = val.join(", ");
      else if (typeof val === "object" && val !== null) text = Array.isArray(val) ? JSON.stringify(val) : formatValue(val).replace(/\n/g, "; ");
      else text = String(val);
      return `${FIELD_LABEL[k] || k}: ${text}`;
    })
    .join("\n");
}

export function describeOp(profile: CaseProfile, op: PatchOp): OpView {
  const segs = splitPath(op.path);
  const parts: string[] = [];
  let node: unknown = profile;
  segs.forEach((seg, i) => {
    const k = keyIn(node, seg);
    const child = k === null ? undefined : (node as Record<string | number, unknown>)[k];
    if (Array.isArray(node)) {
      const top = segs[i - 1];
      const noun = ITEM_NOUN[top];
      if (noun) {
        const nm = itemName(top, child);
        parts[parts.length - 1] = `${noun} ${typeof k === "number" && (child as { id?: string })?.id ? (child as { id: string }).id : seg}${nm ? ` (${nm})` : ""}`;
      } else parts.push(`item ${Number.isFinite(Number(seg)) ? Number(seg) + 1 : seg}`);
    } else parts.push(FIELD_LABEL[seg] || seg);
    node = child;
  });
  const where = parts.join(" / ");
  if (op.op === "add") {
    const noun = segs.length === 1 ? ITEM_NOUN[segs[0]] : undefined;
    return { verb: "Add", where: noun ? `New ${noun.toLowerCase()}` : where, after: formatValue(op.value) };
  }
  if (op.op === "remove") return { verb: "Remove", where, before: formatValue(node) };
  return { verb: "Change", where, before: formatValue(node), after: formatValue(op.value) };
}

// ---------- Fact wording: a changed value must change in both wordings ----------

const NUMBER_WORDS = "zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|half|quarter|once|twice|couple|dozen";
/** The numbers a wording states, as digits or as words, sorted. "89 up to 93" -> ["89", "93"]. */
export function valuesIn(text: unknown): string[] {
  return (String(text ?? "").toLowerCase().match(new RegExp(`\\d+(?:\\.\\d+)?|\\b(?:${NUMBER_WORDS})\\b`, "g")) || []).sort();
}

/**
 * A fact has two wordings of the same information: what the patient says and what is written to the chart.
 * Warns when a patch changes a number in one of them and does not touch the other, which leaves the two
 * wordings of one fact disagreeing (patient "89 up to 93", chart "89-91%"). Pure; used by the server to
 * flag a proposed fix and by the editor to show the warning beside it.
 */
export function wordingWarnings(p: CaseProfile, ops: PatchOp[]): string[] {
  const touched = new Map<string, { says?: unknown; chart?: unknown }>();
  for (const op of ops) {
    const seg = splitPath(op.path);
    if (op.op !== "set" || seg.length !== 3 || seg[0] !== "facts" || (seg[2] !== "says" && seg[2] !== "chart")) continue;
    touched.set(seg[1], { ...touched.get(seg[1]), [seg[2]]: op.value });
  }
  const out: string[] = [];
  for (const [id, next] of touched) {
    const f = p.facts.find((x) => x.id === id);
    if (!f) continue;
    const name = `fact ${f.id}${f.topic ? ` (${f.topic})` : ""}`;
    for (const [field, other, label, otherLabel] of [
      ["says", "chart", "patient wording", "chart wording"],
      ["chart", "says", "chart wording", "patient wording"],
    ] as const) {
      if (next[field] === undefined || next[other] !== undefined) continue;
      const before = valuesIn(f[field]);
      const after = valuesIn(next[field]);
      if (before.join("|") === after.join("|")) continue;
      out.push(`This fix changes a value in the ${label} of ${name} to "${String(next[field])}" but leaves the ${otherLabel} as "${f[other]}". Both wordings describe the same finding, so check they still agree and edit the ${otherLabel} if they do not.`);
    }
  }
  return out;
}
