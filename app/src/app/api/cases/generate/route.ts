import { apiUser } from "@/lib/auth";
import { generateCase } from "@/lib/casegen";
import { bad, longJson } from "@/lib/http";
import { applyMarkers, markerBrief, MARKER_CONDITIONS } from "@/lib/markers";
import { pickMarkers } from "@/lib/markersData";
import { applySynthea, sealSynthea, syntheaBrief } from "@/lib/synthea";
import { all } from "@/lib/db";
import { syntheaRecord, unusedSyntheaRecordId } from "@/lib/syntheaData";
import { professions } from "@/lib/professions";
import { fillHeader } from "@/lib/studio/ai";
import { runRuleChecks } from "@/lib/studio/checks";
import { sanitizeProfile, tidyTables } from "@/lib/studio/profile";
import { insertCase } from "@/lib/studio/store";
import { uploadRow } from "@/lib/studio/uploads";

const STRUCTURED_LABELS: Record<string, string> = {
  name: "Patient name",
  age: "Age",
  sex: "Sex",
  occupation: "Occupation",
  context: "Living situation and background",
  chiefConcern: "Reason for the visit (in the patient's words)",
  diagnosis: "Underlying problem or diagnosis the case is built around",
  history: "Key history the patient can give",
  medications: "Medications and allergies",
  findings: "Key findings, results or documents that should be in the chart",
  sensitive: "What the patient is reluctant to share",
  personality: "Personality and communication style",
  encounterType: "Type of encounter",
};

/**
 * Drafts a full case with the model and stores it as an unreviewed AI draft.
 * Body: { professionId, description? , structured?: {..}, goals?, level?, uploadId?, answers?: [{ question, answer }], markers?: { condition, row? } }
 * With `markers`, laboratory values and blood pressure are taken from a row of the health-markers dataset.
 * With `synthea: { id }`, the whole clinical record (demographics, problems, medications, allergies,
 * vital signs, laboratory results) is taken from a Synthea record.
 */
export async function POST(req: Request) {
  const user = await apiUser("faculty");
  if (user instanceof Response) return user;
  const b = await req.json().catch(() => ({}));
  if (!professions().some((p) => p.id === b.professionId)) return bad("Choose a learner role.");
  let description = String(b.description || "").trim();
  if (b.structured && typeof b.structured === "object") {
    const lines = Object.keys(STRUCTURED_LABELS)
      .filter((k) => String(b.structured[k] ?? "").trim())
      .map((k) => `${STRUCTURED_LABELS[k]}: ${String(b.structured[k]).trim()}`);
    description = [lines.join("\n"), description].filter(Boolean).join("\n\n");
  }
  // Dataset grounding: a condition alone is enough to start from, because the row supplies the findings.
  const wanted = b.markers && typeof b.markers === "object" ? String(b.markers.condition || "") : "";
  if (wanted && !MARKER_CONDITIONS[wanted]) return bad("Choose a condition from the dataset.");
  const source = wanted ? pickMarkers(wanted, Number(b.markers.row) || undefined) : null;
  if (wanted && !source) return bad("The health-markers dataset is not installed on this server, or that row is not usable.");
  if (source) description = [description, markerBrief(source)].filter(Boolean).join("\n\n");
  let synId = !source && b.synthea && typeof b.synthea === "object" ? String(b.synthea.id || "") : "";
  // "auto": the server picks a record that no patient in the library was built from yet.
  if (synId === "auto") {
    const used = new Set(all<{ id: string | null }>("SELECT json_extract(profile, '$.dataSource.recordId') AS id FROM cases").map((r) => r.id || ""));
    synId = unusedSyntheaRecordId(used) || "";
  }
  const syn = synId ? syntheaRecord(synId) : null;
  if (synId && !syn) return bad("That Synthea record could not be found.");
  if (syn) description = [description, syntheaBrief(syn.record)].filter(Boolean).join("\n\n");
  if (description.length < 15) return bad("Describe the patient first.");
  const answers = (Array.isArray(b.answers) ? b.answers : []).filter((a: { question?: string; answer?: string }) => a?.question && String(a.answer || "").trim());
  if (answers.length) description += "\n\nFaculty answers to clarifying questions:\n" + answers.map((a: { question: string; answer: string }) => `- ${a.question} ${String(a.answer).trim()}`).join("\n");

  const upload = b.uploadId ? uploadRow(String(b.uploadId)) : undefined;
  if (b.uploadId && (!upload || upload.owner_id !== user.id)) return bad("The source document could not be found. Upload it again.");
  const guidance = [
    b.goals ? `Learning goals: ${String(b.goals).slice(0, 4000)}` : "",
    upload?.text ? `Source document supplied by faculty ("${upload.filename}"). Keep the case consistent with it:\n${upload.text.slice(0, 15000)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const level = Math.max(1, Math.min(5, Math.round(Number(b.level)))) || undefined;

  return longJson(async () => {
    const started = Date.now();
    const drafted = await generateCase({ professionId: b.professionId, description: description.slice(0, 30000), level, guidance: guidance || undefined });
    if (level) drafted.difficulty = level;
    let profile = tidyTables(sanitizeProfile(await fillHeader(sanitizeProfile(drafted), level)));
    // The numbers are written by code from the dataset row, whatever the model produced.
    if (source) profile = sanitizeProfile(applyMarkers(profile, source));
    if (syn) profile = sealSynthea(sanitizeProfile(applySynthea(profile, syn.record, syn.source, syn.index)));
    if (upload?.text) profile.knowledge.push({ id: "k1", title: upload.filename.replace(/\.[a-z0-9]+$/i, ""), text: upload.text.slice(0, 60000) });
    const id = insertCase({ ownerId: user.id, origin: "ai_draft", profile });
    const rules = runRuleChecks(profile);
    return {
      id,
      title: profile.title,
      seconds: Math.round((Date.now() - started) / 1000),
      counts: { facts: profile.facts.length, actions: profile.actions.length, artifacts: profile.artifacts.length, objectives: profile.objectives.length },
      structureIssues: rules.length,
      dataSource: profile.dataSource ? { dataset: profile.dataSource.dataset, row: profile.dataSource.row, record: profile.dataSource.recordId || null, condition: profile.dataSource.conditionLabel } : null,
    };
  });
}
