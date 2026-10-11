import type { Artifact, CaseProfile, ClinicalAction, DataSource } from "./types";

/**
 * Grounds a patient in a Synthea record. Synthea builds synthetic patient histories from
 * published disease statistics and care guidelines, with no language model involved. The
 * record's demographics, problem list, medications, allergies, vital signs, laboratory results
 * and immunisations are written into the case by code; the model writes only the person, the
 * conversation and the teaching design around them.
 *
 * Nothing here touches the file system, so the consistency check can import it anywhere.
 */
export interface SyntheaRecord {
  id: string;
  name: string;
  age: number;
  sex: string;
  race: string;
  ethnicity: string;
  marital: string;
  city: string;
  /** Which kind of nutrition-relevant condition got the record selected. */
  group?: string;
  /** Answers to Synthea's social-needs survey and screening questionnaires. */
  survey?: Record<string, string>;
  problems: { name: string; since: string }[];
  past: { name: string; from: string; to: string }[];
  medications: { name: string; started: string; reason: string }[];
  allergies: { substance: string; reaction: string; severity: string }[];
  vitals: Record<string, string>;
  labs: { test: string; value: string; units: string; reference: string; date: string }[];
  smoking: string;
  social: string[];
  immunizations: { vaccine: string; date: string }[];
  encounters: { date: string; type: string; what: string; reason: string }[];
  procedures: { date: string; what: string; reason: string }[];
  careplans: string[];
}

/** Ids of the items written into a case from a record. */
export const SYN = { history: "dsyn1", meds: "dsyn2", labs: "dsyn3", vitals: "asyn1", labOrder: "asyn2", shots: "asyn3" } as const;
const CHART_LABELS = ["Problem list", "Medications", "Allergies"];

export function recordLabel(r: SyntheaRecord): string {
  const names = r.problems.map((p) => p.name).filter((n) => !/^(Body mass index|Abnormal findings|Past pregnancy)/.test(n));
  const shown = names.slice(-3).reverse();
  return `${r.age} ${r.sex === "female" ? "F" : r.sex === "male" ? "M" : ""} · ${shown.join(", ")}${names.length > 3 ? ` +${names.length - 3}` : ""} · ${r.medications.length} medication${r.medications.length === 1 ? "" : "s"}`;
}

const allergyText = (r: SyntheaRecord) => (r.allergies.length ? r.allergies.map((a) => `${a.substance}${a.reaction ? ` (${a.reaction}${a.severity ? ", " + a.severity : ""})` : ""}`).join("; ") : "No known allergies");
const vitalsText = (r: SyntheaRecord) => {
  const v = r.vitals;
  return [
    v.systolic && v.diastolic ? `Blood pressure ${v.systolic}/${v.diastolic} mmHg` : "",
    v.heart_rate ? `heart rate ${v.heart_rate}/min` : "",
    v.respiratory_rate ? `respiratory rate ${v.respiratory_rate}/min` : "",
    v.weight_kg ? `weight ${v.weight_kg} kg` : "",
    v.height_cm ? `height ${v.height_cm} cm` : "",
    v.bmi ? `BMI ${v.bmi} kg/m2` : "",
    v.weight_change ? `weight change ${v.weight_change}` : "",
  ]
    .filter(Boolean)
    .join(", ");
};

/** Text added to the case description so the model writes a person and a visit that fit the record. */
export function syntheaBrief(r: SyntheaRecord): string {
  const list = (items: string[]) => (items.length ? items.map((i) => `- ${i}`).join("\n") : "- none recorded");
  return `PATIENT RECORD FROM SYNTHEA (record ${r.id}). Everything in this record is fixed. Do not change, add to or contradict it.
Patient: ${r.name}, ${r.age}, ${r.sex}, ${r.race}, ${r.ethnicity}${r.marital ? ", " + r.marital : ""}, lives in ${r.city}.
Active problems (year first recorded):
${list(r.problems.map((p) => `${p.name} (${p.since})`))}
Recently resolved:
${list(r.past.map((p) => `${p.name} (${p.from} to ${p.to})`))}
Current medications:
${list(r.medications.map((m) => `${m.name}, since ${m.started}${m.reason ? `, for ${m.reason}` : ""}`))}
Allergies: ${allergyText(r)}
Most recent vital signs (${r.vitals.recorded || "date not recorded"}): ${vitalsText(r) || "none recorded"}
Most recent laboratory results:
${list(r.labs.map((l) => `${l.test} ${l.value} ${l.units} (${l.date})`))}
Smoking status: ${r.smoking || "not recorded"}
Social survey and screening answers: ${Object.entries(r.survey || {}).map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`).join("; ") || "none recorded"}
Social and other findings on record:
${list(r.social)}
Recent encounters:
${list(r.encounters.map((e) => `${e.date} ${e.type}: ${e.what}${e.reason ? ` (${e.reason})` : ""}`))}
Recent procedures:
${list(r.procedures.map((p) => `${p.date}: ${p.what}${p.reason ? ` (${p.reason})` : ""}`))}
Care plans: ${r.careplans.join("; ") || "none recorded"}

Use this patient's name, age and sex exactly. Choose a reason for today's visit that this record makes plausible, and write the person: personality, how they talk about these problems and medicines in their own words, what they understand and do not understand, what they are reluctant to say. Every fact must agree with the record; a patient may not know their own lab numbers, and may sincerely misreport something the record shows, which is a mismatch.
Do NOT write a problem list, a medication list, vital signs, the laboratory results above or an immunisation record as actions or documents: documents and actions holding exactly this record are added to the case automatically. You may add other documents (a prior visit note, a pharmacy refill history, a letter) and other actions (a focused examination, a screening instrument) provided they agree with the record.`;
}

function pieces(r: SyntheaRecord): { chart: { label: string; value: string }[]; docs: Artifact[]; actions: ClinicalAction[] } {
  const problems = r.problems.map((p) => `${p.name} (since ${p.since})`);
  const chart = [
    { label: "Problem list", value: problems.join("; ") || "None recorded" },
    { label: "Medications", value: r.medications.map((m) => m.name).join("; ") || "None recorded" },
    { label: "Allergies", value: allergyText(r) },
  ];
  const history = [
    "ACTIVE PROBLEMS",
    ...(problems.length ? problems : ["None recorded"]),
    "",
    "RECENTLY RESOLVED",
    ...(r.past.length ? r.past.map((p) => `${p.name} (${p.from} to ${p.to})`) : ["None recorded"]),
    "",
    "PROCEDURES",
    ...(r.procedures.length ? r.procedures.map((p) => `${p.date}: ${p.what}${p.reason ? ` (${p.reason})` : ""}`) : ["None recorded"]),
    "",
    "RECENT ENCOUNTERS",
    ...(r.encounters.length ? r.encounters.map((e) => `${e.date} ${e.type}: ${e.what}${e.reason ? ` (${e.reason})` : ""}`) : ["None recorded"]),
    "",
    `SMOKING STATUS: ${r.smoking || "Not recorded"}`,
    `CARE PLANS: ${r.careplans.join("; ") || "None recorded"}`,
  ].join("\n");
  const docs: Artifact[] = [
    { id: SYN.history, type: "note", title: "Problem list and history", author: "Health record", body: history, release: { when: "start" } },
    {
      id: SYN.meds,
      type: "medication_list",
      title: "Medication list",
      author: "Health record",
      table: { columns: ["Medication", "Started", "For"], rows: (r.medications.length ? r.medications : [{ name: "No current medications", started: "-", reason: "" }]).map((m) => ({ cells: [m.name, m.started, m.reason || "-"] })) },
      release: { when: "start" },
    },
  ];
  const actions: ClinicalAction[] = [];
  const vitals = vitalsText(r);
  if (vitals) actions.push({ id: SYN.vitals, kind: "vitals", name: "Vital signs", aliases: ["vitals", "blood pressure", "BP", "heart rate", "pulse", "weight", "height", "BMI"], result: `${vitals}${r.vitals.recorded ? ` (recorded ${r.vitals.recorded})` : ""}.`, importance: "important", artifactIds: [] });
  if (r.labs.length) {
    docs.push({
      id: SYN.labs,
      type: "lab_report",
      title: "Laboratory results",
      author: "Clinic laboratory",
      table: { columns: ["Test", "Result", "Units", "Reference range", "Collected"], rows: r.labs.map((l) => ({ cells: [l.test, l.value, l.units, l.reference, l.date] })) },
      release: { when: "action", ref: SYN.labOrder },
    });
    actions.push({
      id: SYN.labOrder,
      kind: "lab",
      name: "Recent laboratory results",
      aliases: ["labs", "lab results", "blood tests", "bloods", ...r.labs.map((l) => l.test)],
      result: r.labs.map((l) => `${l.test} ${l.value} ${l.units}`).join("; ") + ".",
      importance: "important",
      artifactIds: [SYN.labs],
    });
  }
  if (r.immunizations.length) actions.push({ id: SYN.shots, kind: "record", name: "Immunisation record", aliases: ["immunizations", "immunisations", "vaccines", "vaccination record"], result: r.immunizations.map((i) => `${i.vaccine} (${i.date})`).join("; ") + ".", importance: "minor", artifactIds: [] });
  return { chart, docs, actions };
}

function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** A fingerprint of everything in the case that came from the record, to detect later edits. */
function fingerprint(c: CaseProfile): string {
  const ids = new Set<string>(Object.values(SYN));
  return hash(
    JSON.stringify({
      patient: [c.patient.name, c.patient.age, c.patient.sex],
      chart: c.chartAtStart.filter((i) => CHART_LABELS.includes(i.label)),
      docs: c.artifacts.filter((d) => ids.has(d.id)).map((d) => [d.id, d.body || "", d.table?.rows.map((r) => r.cells) || []]),
      actions: c.actions.filter((a) => ids.has(a.id)).map((a) => [a.id, a.result]),
    }),
  );
}

const RECORD_DOC = /\b(lab|labs|laboratory|panel|blood count|cbc|bmp|cmp|hba1c|a1c|lipid|glucose|metabolic|hematology|haematology|renal|kidney function|vitals?|vital signs|anthropometric|flowsheet|weight|bmi|blood pressure|problem list|medication list|immuni[sz]ation|vaccin)/i;
const KEEP_DOC = /refill|dispens|pharmacy|referral|letter|visit note|food|diet|diary|recall|menu|receipt/i;
const RECORD_ACTION = /\b(lab|labs|laboratory|panel|blood count|cbc|hba1c|a1c|lipid|glucose|metabolic|hematology|haematology|renal|kidney function|vitals?|vital signs|blood pressure|weight|height|bmi|anthropometric|problem list|medication list|immuni[sz]ation|vaccin)/i;
const KEEP_ACTION = /refill|dispens|pharmacy|adherence|recall|diet|food|intake|screen|interview|history|readiness|literacy|hydration|activity|sleep/i;

/**
 * Removes anything the model wrote that restates the health record: its own lab reports, vital
 * signs, weight trends, problem lists and medication lists, and the actions that review them.
 * Those would sit beside the record's real values and could disagree with them. References to
 * what is removed are pointed at the record's own items, and a mismatch that rested on a removed
 * document is dropped, because its evidence no longer exists.
 */
export function stripRestatedRecord(c: CaseProfile, has: { labs: boolean; vitals: boolean; shots: boolean }): CaseProfile {
  const ours = new Set<string>(Object.values(SYN));
  const goneDocs = new Set(
    c.artifacts
      .filter((d) => !ours.has(d.id) && !KEEP_DOC.test(d.title) && (d.type === "lab_report" || d.type === "flowsheet" || (d.type === "medication_list") || ((d.type === "chart" || d.type === "other" || d.type === "form") && RECORD_DOC.test(d.title)) || /^(problem list|medication list|laboratory results|vital signs)/i.test(d.title)))
      .map((d) => d.id),
  );
  const swap = new Map<string, string | null>();
  for (const a of c.actions) {
    if (ours.has(a.id) || KEEP_ACTION.test(a.name)) continue;
    const restates = a.kind === "lab" || a.kind === "vitals" || ((a.kind === "record" || a.kind === "assessment" || a.kind === "exam") && RECORD_ACTION.test(a.name));
    if (!restates) continue;
    const to = /immuni|vaccin/i.test(a.name) ? (has.shots ? SYN.shots : null) : a.kind === "vitals" || /vital|blood pressure|weight|height|bmi|anthropometric/i.test(a.name) ? (has.vitals ? SYN.vitals : null) : /problem list|medication list/i.test(a.name) ? null : has.labs ? SYN.labOrder : null;
    swap.set(a.id, to);
  }
  const remap = (ids: string[]) => [...new Set(ids.map((id) => (swap.has(id) ? swap.get(id) : id)).filter((id): id is string => !!id))];
  return {
    ...c,
    actions: c.actions.filter((a) => !swap.has(a.id)).map((a) => ({ ...a, artifactIds: (a.artifactIds || []).filter((id) => !goneDocs.has(id)) })),
    artifacts: c.artifacts
      .filter((d) => !goneDocs.has(d.id))
      .map((d) => (d.release.when === "action" && d.release.ref && swap.has(d.release.ref) ? { ...d, release: swap.get(d.release.ref) ? { when: "action" as const, ref: swap.get(d.release.ref)! } : { when: "start" as const } } : d)),
    objectives: c.objectives.map((o) => ({ ...o, actionIds: remap(o.actionIds) })),
    mismatches: (c.mismatches || []).filter((m) => !m.artifactId || !goneDocs.has(m.artifactId)),
  };
}

/** Writes the record into the case: demographics, chart summary, documents and actions. */
export function applySynthea(input: CaseProfile, r: SyntheaRecord, sourceLabel: string, index: number): CaseProfile {
  const { chart, docs, actions } = pieces(r);
  const ours = new Set<string>(Object.values(SYN));
  const c = stripRestatedRecord(input, { labs: r.labs.length > 0, vitals: !!vitalsText(r), shots: r.immunizations.length > 0 });
  const next: CaseProfile = {
    ...c,
    patient: { ...c.patient, name: r.name, age: r.age, sex: r.sex, ethnicity: [r.race, r.ethnicity].filter(Boolean).join(", ") || c.patient.ethnicity },
    chartAtStart: [...c.chartAtStart.filter((i) => !/problem|medication|allerg|vital|immuni/i.test(i.label)), ...chart],
    artifacts: [...c.artifacts.filter((d) => !ours.has(d.id)), ...docs],
    actions: [...c.actions.filter((a) => !ours.has(a.id)), ...actions],
  };
  const src: DataSource = {
    kind: "synthea",
    dataset: sourceLabel,
    row: index,
    recordId: r.id,
    condition: r.problems[r.problems.length - 1]?.name || "",
    conditionLabel: recordLabel(r),
    values: {},
    documentId: SYN.history,
    actionIds: actions.map((a) => a.id),
  };
  return sealSynthea({ ...next, dataSource: src });
}

/** Records the fingerprint of the record-derived content as it now stands. Call after any clean-up pass. */
export function sealSynthea(c: CaseProfile): CaseProfile {
  return c.dataSource?.kind === "synthea" ? { ...c, dataSource: { ...c.dataSource, fingerprint: fingerprint(c) } } : c;
}

/** True when anything that came from the Synthea record has been edited since it was written. */
export function syntheaChanged(c: CaseProfile): boolean {
  return c.dataSource?.kind === "synthea" && !!c.dataSource.fingerprint && c.dataSource.fingerprint !== fingerprint(c);
}
