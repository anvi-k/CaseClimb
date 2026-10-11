import fs from "node:fs";
import path from "node:path";
import { recordLabel, type SyntheaRecord } from "./synthea";

/**
 * Reads the Synthea records shipped in data/synthea/records.json (built by
 * scripts/synthea_records.py from Synthea's CSV export). Server only.
 */
const FILE = process.env.SYNTHEA_RECORDS || path.join(process.cwd(), "data", "synthea", "records.json");

let cache: { source: string; records: SyntheaRecord[] } | null = null;

function load(): { source: string; records: SyntheaRecord[] } {
  if (cache) return cache;
  if (!fs.existsSync(/*turbopackIgnore: true*/ FILE)) return (cache = { source: "Synthea", records: [] });
  const raw = JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ FILE, "utf8"));
  return (cache = { source: String(raw.source || "Synthea"), records: raw.records || [] });
}

export function syntheaSummary() {
  const { source, records } = load();
  return { available: records.length > 0, source, records: records.map((r) => ({ id: r.id, label: recordLabel(r) })) };
}

/** A record by id, with its 1-based position in the file and the source description. */
export function syntheaRecord(id: string): { record: SyntheaRecord; index: number; source: string } | null {
  const { source, records } = load();
  const i = records.findIndex((r) => r.id === id);
  return i < 0 ? null : { record: records[i], index: i + 1, source };
}
