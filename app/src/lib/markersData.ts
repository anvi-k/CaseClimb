import fs from "node:fs";
import path from "node:path";
import { COLUMNS, DATASET, LAB_ACTION, LAB_DOC, BP_ACTION, LABS, MARKER_CONDITIONS } from "./markers";
import type { DataSource } from "./types";

/**
 * Reads the health-markers dataset. Server only. The dataset is not committed: put it at
 * data/private/health_markers_dataset.csv or point HEALTH_MARKERS_CSV at it.
 */
const FILE = process.env.HEALTH_MARKERS_CSV || path.join(process.cwd(), "data", "private", "health_markers_dataset.csv");

interface Row {
  /** 1-based data row in the file (the header is not counted). */
  row: number;
  condition: string;
  values: Record<string, number>;
}

let cache: Row[] | null = null;

function load(): Row[] {
  if (cache) return cache;
  if (!fs.existsSync(/*turbopackIgnore: true*/ FILE)) return (cache = []);
  const lines = fs.readFileSync(/*turbopackIgnore: true*/ FILE, "utf8").split(/\r?\n/).filter(Boolean);
  const head = lines[0].split(",").map((h) => h.trim());
  const rows: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(",");
    const rec: Record<string, string> = {};
    head.forEach((h, j) => (rec[h] = (cells[j] || "").trim()));
    // Rows with a missing marker are left out rather than filled in.
    if (COLUMNS.some((c) => rec[c] === "" || Number.isNaN(Number(rec[c]))) || !MARKER_CONDITIONS[rec.Condition]) continue;
    rows.push({ row: i, condition: rec.Condition, values: Object.fromEntries(COLUMNS.map((c) => [c, Number(rec[c])])) });
  }
  return (cache = rows);
}

export function markerSummary() {
  const rows = load();
  return {
    available: rows.length > 0,
    dataset: DATASET,
    rows: rows.length,
    conditions: Object.entries(MARKER_CONDITIONS).map(([id, label]) => ({ id, label, rows: rows.filter((r) => r.condition === id).length })),
  };
}

const fixed = (v: number, digits: number) => v.toFixed(digits);

/** Picks a complete row for a condition (a given row number, or one at random) as displayed values. */
export function pickMarkers(condition: string, rowNumber?: number): DataSource | null {
  const pool = load().filter((r) => r.condition === condition);
  const hit = rowNumber ? pool.find((r) => r.row === rowNumber) : pool[Math.floor(Math.random() * pool.length)];
  if (!hit) return null;
  const values: Record<string, string> = {};
  for (const m of LABS) values[m.column] = fixed(hit.values[m.column], m.digits);
  values.Systolic_BP = fixed(hit.values.Systolic_BP, 0);
  values.Diastolic_BP = fixed(hit.values.Diastolic_BP, 0);
  return { dataset: DATASET, row: hit.row, condition, conditionLabel: MARKER_CONDITIONS[condition], values, documentId: LAB_DOC, actionIds: [LAB_ACTION, BP_ACTION] };
}
