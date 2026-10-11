import { syntheaChanged } from "./synthea";
import type { Artifact, CaseProfile, ClinicalAction, DataSource } from "./types";

/**
 * Grounds a patient's laboratory values and blood pressure in the health-markers dataset
 * (25,000 synthetic rows: nine markers and a condition label) instead of letting the model
 * choose them. A row is picked (markersData.ts), its numbers are written into the case by code,
 * and the row number is kept on the case so anyone can check the values against the file.
 *
 * Nothing here touches the file system, so the consistency check can import it anywhere.
 */
export const DATASET = "health_markers_dataset.csv";

export const MARKER_CONDITIONS: Record<string, string> = {
  Diabetes: "Diabetes",
  Hypertension: "Hypertension",
  High_Cholesterol: "High cholesterol",
  Anemia: "Anemia",
  Fit: "No condition (healthy)",
};

/** Ids of the items this module writes into a case. */
export const LAB_DOC = "dlab0";
export const LAB_ACTION = "alab0";
export const BP_ACTION = "avit0";

export interface Marker {
  column: string;
  test: string;
  units: string;
  range: string;
  digits: number;
  /** Returns "H", "L" or "" for a value. */
  flag: (v: number, female: boolean) => "H" | "L" | "";
  /** How the test is written in other parts of a case, for the consistency check. */
  pattern: RegExp;
}

// Units and reference ranges are standard adult values; the dataset itself gives only numbers.
export const LABS: Marker[] = [
  { column: "Blood_glucose", test: "Blood glucose", units: "mg/dL", range: "70-99 (fasting)", digits: 0, flag: (v) => (v >= 100 ? "H" : v < 70 ? "L" : ""), pattern: /glucose[^0-9\n]{0,25}(\d+(?:\.\d+)?)/gi },
  { column: "HbA1C", test: "HbA1c", units: "%", range: "< 5.7", digits: 1, flag: (v) => (v >= 5.7 ? "H" : ""), pattern: /(?:hba1c|a1c)[^0-9\n]{0,25}(\d+(?:\.\d+)?)/gi },
  { column: "LDL", test: "LDL cholesterol", units: "mg/dL", range: "< 100", digits: 0, flag: (v) => (v >= 130 ? "H" : ""), pattern: /ldl[^0-9\n]{0,25}(\d+(?:\.\d+)?)/gi },
  { column: "HDL", test: "HDL cholesterol", units: "mg/dL", range: ">= 40", digits: 0, flag: (v) => (v < 40 ? "L" : ""), pattern: /hdl[^0-9\n]{0,25}(\d+(?:\.\d+)?)/gi },
  { column: "Triglycerides", test: "Triglycerides", units: "mg/dL", range: "< 150", digits: 0, flag: (v) => (v >= 150 ? "H" : ""), pattern: /triglycerides?[^0-9\n]{0,25}(\d+(?:\.\d+)?)/gi },
  { column: "Haemoglobin", test: "Haemoglobin", units: "g/dL", range: "12.0-15.5 (F), 13.5-17.5 (M)", digits: 1, flag: (v, female) => (v < (female ? 12 : 13.5) ? "L" : v > (female ? 15.5 : 17.5) ? "H" : ""), pattern: /(?:ha?emoglobin|\bhgb\b|\bhb\b)(?!\s*a1c)[^0-9\n]{0,25}(\d+(?:\.\d+)?)/gi },
  { column: "MCV", test: "MCV", units: "fL", range: "80-100", digits: 1, flag: (v) => (v < 80 ? "L" : v > 100 ? "H" : ""), pattern: /\bmcv[^0-9\n]{0,25}(\d+(?:\.\d+)?)/gi },
];
export const COLUMNS = [...LABS.map((m) => m.column), "Systolic_BP", "Diastolic_BP"];

/** Text added to the case description so the model writes a story that fits the numbers. */
export function markerBrief(src: DataSource): string {
  const v = src.values;
  return `MEASURED VALUES FROM THE HEALTH-MARKERS DATASET (row ${src.row}, labelled "${src.conditionLabel}"). These are today's results and are fixed:
${LABS.map((m) => `- ${m.test}: ${v[m.column]} ${m.units}`).join("\n")}
- Blood pressure: ${v.Systolic_BP}/${v.Diastolic_BP} mmHg
Build the patient and the clinical story around these numbers and this label${src.condition === "Fit" ? " (a generally well patient; the visit is about something these results do not explain, or a routine review)" : ""}. Do not invent different values for these tests. Do NOT write an action or a document for these tests or for today's blood pressure: a laboratory report, a blood test order and a blood pressure measurement holding exactly these values are added to the case automatically. You may quote these values in the answer key. Earlier or home readings may differ, but say clearly that they are earlier or home readings.`;
}

const isFemale = (c: CaseProfile) => /^(f|female|woman)/i.test(c.patient.sex.trim());

/** Writes the dataset values into the case as a lab report, a blood-test order and a BP measurement. */
export function applyMarkers(c: CaseProfile, src: DataSource): CaseProfile {
  const female = isFemale(c);
  const v = src.values;
  const rows = LABS.map((m) => ({ cells: [m.test, v[m.column], m.units, m.range], flag: m.flag(Number(v[m.column]), female) }));
  const doc: Artifact = {
    id: LAB_DOC,
    type: "lab_report",
    title: "Laboratory results",
    date: "This visit",
    author: "Clinic laboratory",
    table: { columns: ["Test", "Result", "Units", "Reference range"], rows },
    release: { when: "action", ref: LAB_ACTION },
  };
  const sys = Number(v.Systolic_BP);
  const dia = Number(v.Diastolic_BP);
  const key = src.condition === "Fit" ? "important" : "critical";
  const labs: ClinicalAction = {
    id: LAB_ACTION,
    kind: "lab",
    name: "Blood tests (glucose, HbA1c, lipid panel, full blood count)",
    aliases: ["blood tests", "bloods", "labs", "lab results", "glucose", "blood sugar", "HbA1c", "A1c", "lipid panel", "lipids", "cholesterol", "LDL", "HDL", "triglycerides", "full blood count", "FBC", "CBC", "haemoglobin", "hemoglobin", "MCV"],
    result: LABS.map((m) => `${m.test} ${v[m.column]} ${m.units}`).join("; ") + ".",
    abnormal: rows.some((r) => r.flag),
    importance: key,
    artifactIds: [LAB_DOC],
  };
  const bp: ClinicalAction = {
    id: BP_ACTION,
    kind: "vitals",
    name: "Blood pressure",
    aliases: ["BP", "blood pressure", "vitals", "vital signs"],
    result: `Blood pressure ${sys}/${dia} mmHg.`,
    abnormal: sys >= 140 || dia >= 90,
    importance: src.condition === "Hypertension" ? "critical" : "important",
    artifactIds: [],
  };
  const ours = new Set([LAB_DOC, LAB_ACTION, BP_ACTION]);
  return {
    ...c,
    actions: [...c.actions.filter((a) => !ours.has(a.id)), labs, bp],
    artifacts: [...c.artifacts.filter((d) => !ours.has(d.id)), doc],
    dataSource: src,
  };
}

export interface MarkerProblem {
  severity: "high" | "low";
  where: string;
  title: string;
  why: string;
}

/**
 * Checks a dataset-grounded case: the dataset values must still be in the lab report and the two
 * actions exactly, and any other record in the case that states a different number for one of
 * these tests is pointed out.
 */
export function markerProblems(c: CaseProfile): MarkerProblem[] {
  const src = c.dataSource;
  if (!src) return [];
  if (src.kind === "synthea")
    return syntheaChanged(c)
      ? [{ severity: "high", where: "Patient details, chart summary, record documents and record actions", title: "The Synthea record was changed", why: `This patient's demographics, problem list, medications, allergies, vital signs, laboratory results and immunisations are meant to match ${src.dataset}, record ${src.recordId}. Something among them has been edited since they were written from the record.` }]
      : [];
  const out: MarkerProblem[] = [];
  const v = src.values;
  const origin = `${src.dataset} row ${src.row}`;
  const doc = c.artifacts.find((d) => d.id === LAB_DOC);
  const labs = c.actions.find((a) => a.id === LAB_ACTION);
  const bp = c.actions.find((a) => a.id === BP_ACTION);
  const changed: string[] = [];
  for (const m of LABS) {
    const cell = doc?.table?.rows.find((r) => r.cells[0] === m.test)?.cells[1];
    if (cell !== v[m.column] || !labs?.result.includes(`${m.test} ${v[m.column]} ${m.units}`)) changed.push(`${m.test} (dataset: ${v[m.column]} ${m.units})`);
  }
  if (!bp?.result.includes(`${v.Systolic_BP}/${v.Diastolic_BP}`)) changed.push(`Blood pressure (dataset: ${v.Systolic_BP}/${v.Diastolic_BP} mmHg)`);
  if (changed.length)
    out.push({
      severity: "high",
      where: "Laboratory results, blood tests and blood pressure",
      title: "Dataset values were changed or removed",
      why: `This patient's results are meant to come from ${origin}. These no longer match it: ${changed.join(", ")}.`,
    });

  // Other records that give a different number for the same test.
  const texts: { where: string; text: string }[] = [
    ...c.chartAtStart.map((i) => ({ where: `Chart at start (${i.label})`, text: i.value })),
    ...c.actions.filter((a) => a.id !== LAB_ACTION && a.id !== BP_ACTION).map((a) => ({ where: `Action ${a.id} (${a.name})`, text: a.result })),
    ...c.artifacts
      .filter((d) => d.id !== LAB_DOC)
      .map((d) => ({ where: `Document ${d.id} (${d.title})`, text: [d.body || "", ...(d.table?.rows || []).map((r) => r.cells.join(" "))].join("\n") })),
  ];
  for (const t of texts) {
    for (const m of LABS) {
      for (const hit of t.text.matchAll(m.pattern)) {
        if (Math.abs(Number(hit[1]) - Number(v[m.column])) > 0.051)
          out.push({
            severity: "low",
            where: t.where,
            title: `${t.where} gives ${m.test} as ${hit[1]}`,
            why: `The dataset value for today is ${v[m.column]} ${m.units} (${origin}). If this is an earlier or home reading, make sure the text says so; otherwise correct it.`,
          });
      }
    }
  }
  return out;
}
