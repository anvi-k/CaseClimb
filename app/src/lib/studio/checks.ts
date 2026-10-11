// Deterministic consistency checks. Pure; runs on the server at check and publish time.
import type { CaseProfile } from "@/lib/types";
import type { PatchOp } from "./patch";
import type { SectionId } from "./profile";

export type Severity = "high" | "medium" | "low";

export interface Issue {
  id: string;
  /** rule = deterministic check, model = clinical review by the model. */
  source: "rule" | "model";
  severity: Severity;
  section: SectionId;
  /** Human-readable location, e.g. "Document d3 (Lipid panel)". */
  where: string;
  title: string;
  why: string;
  fix?: { summary: string; ops: PatchOp[] };
  status: "open" | "fixed" | "dismissed";
}

export interface ConsistencyResult {
  ranAt: string;
  /** hashProfile() of the profile that was checked. */
  profileHash: string;
  modelRan: boolean;
  modelError?: string;
  summary?: string;
  issues: Issue[];
}

export const openHigh = (r: ConsistencyResult | null | undefined) => (r?.issues || []).filter((i) => i.severity === "high" && i.status === "open");

function key(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function runRuleChecks(p: CaseProfile, rubricIds?: string[]): Issue[] {
  const out: Issue[] = [];
  const add = (i: Omit<Issue, "id" | "source" | "status">) => out.push({ ...i, id: "r" + key(i.title + "|" + i.where), source: "rule", status: "open" });
  const factIds = new Set(p.facts.map((f) => f.id));
  const actionIds = new Set(p.actions.map((a) => a.id));
  const artifactIds = new Set(p.artifacts.map((d) => d.id));
  const fact = (id: string) => p.facts.find((f) => f.id === id);

  // --- Required content ---
  if (!p.patient.name.trim()) add({ severity: "high", section: "patient", where: "Patient", title: "The patient has no name", why: "The name appears in the student brief, the chart header and the visit window." });
  if (!p.scenario.studentBrief.trim()) add({ severity: "high", section: "scenario", where: "Scenario / Student brief", title: "The student brief is empty", why: "Students read the brief before the visit starts. Without it they do not know their role or why the patient booked." });
  if (!p.scenario.openingLine.trim()) add({ severity: "medium", section: "scenario", where: "Scenario / Opening line", title: "The opening line is empty", why: "This is what the patient says when first asked what brings them in." });
  if (!p.professions.length) add({ severity: "high", section: "overview", where: "Overview / Learner roles", title: "No learner role is selected", why: "Students only see patients written for their profession." });
  if (!p.objectives.length) add({ severity: "medium", section: "objectives", where: "Learning objectives", title: "The case has no learning objectives", why: "Feedback reports on each objective. With none, students get no objective-level feedback." });
  if (!p.answerKey.primaryProblem.trim()) add({ severity: "medium", section: "answer", where: "Answer key / Primary problem", title: "The answer key has no primary problem", why: "Clinical accuracy in feedback is judged against the answer key." });

  // --- Chief concern must be volunteered ---
  const cc = p.facts.filter((f) => f.category === "chief_complaint");
  if (!cc.some((f) => f.tier === "initial")) {
    add({
      severity: "high",
      section: "facts",
      where: cc.length ? `Fact ${cc[0].id} (${cc[0].topic})` : "Facts",
      title: "No chief concern is volunteered at the start",
      why: "The patient needs at least one fact in the Chief concern category with the Volunteered tier, otherwise they cannot say why they booked the visit.",
      fix: cc.length ? { summary: `Set the tier of "${cc[0].topic}" to Volunteered`, ops: [{ op: "set", path: `facts.${cc[0].id}.tier`, value: "initial" }] } : undefined,
    });
  }
  if (!p.facts.some((f) => f.importance === "critical" && !f.distractor)) add({ severity: "medium", section: "facts", where: "Facts", title: "No fact is marked critical", why: "Feedback lists the critical facts a student missed. Mark the findings a competent student must elicit." });

  // --- Empty wording ---
  for (const f of p.facts) {
    if (!f.chart.trim() || !f.says.trim())
      add({ severity: "medium", section: "facts", where: `Fact ${f.id} (${f.topic || "no topic"})`, title: `Fact ${f.id} is missing ${!f.chart.trim() ? "its chart wording" : "its patient wording"}`, why: "Each fact needs both wordings: what the patient says and what is written to the chart." });
    if (!f.topic.trim()) add({ severity: "medium", section: "facts", where: `Fact ${f.id}`, title: `Fact ${f.id} has no topic label`, why: "The topic is how the visit engine recognises that a student is asking about this fact." });
  }
  for (const a of p.actions) {
    if (!a.result.trim()) add({ severity: "medium", section: "actions", where: `Action ${a.id} (${a.name})`, title: `"${a.name || a.id}" has no result`, why: "When a student performs this, nothing would be written to the chart." });
  }

  // --- Duplicated facts ---
  const seen = new Map<string, string>();
  for (const f of p.facts) {
    const k = norm(f.chart);
    if (!k) continue;
    const first = seen.get(k);
    if (first) {
      const referenced = p.objectives.some((o) => o.factIds.includes(f.id)) || p.artifacts.some((d) => d.release.when === "fact" && d.release.ref === f.id);
      add({
        severity: "medium",
        section: "facts",
        where: `Facts ${first} and ${f.id}`,
        title: `Facts ${first} and ${f.id} say the same thing`,
        why: `Both have the chart wording "${f.chart}". Duplicates are scored twice and can be disclosed twice.`,
        fix: { summary: `Delete ${f.id}${referenced ? " and remove its links" : ""}`, ops: [{ op: "remove", path: `facts.${f.id}` }] },
      });
    } else seen.set(k, f.id);
  }
  const topicSeen = new Map<string, string>();
  for (const f of p.facts) {
    const k = f.category + "|" + norm(f.topic);
    if (!norm(f.topic)) continue;
    const first = topicSeen.get(k);
    if (first && norm(fact(first)!.chart) !== norm(f.chart))
      add({ severity: "low", section: "facts", where: `Facts ${first} and ${f.id}`, title: `Facts ${first} and ${f.id} share the topic "${f.topic}"`, why: "Two facts with the same topic label are hard for the engine to tell apart. Give each a more specific topic, or merge them." });
    else if (!first) topicSeen.set(k, f.id);
  }

  // --- Dangling references ---
  for (const a of p.actions) {
    const missing = (a.artifactIds || []).filter((id) => !artifactIds.has(id));
    if (missing.length)
      add({
        severity: "medium",
        section: "actions",
        where: `Action ${a.id} (${a.name})`,
        title: `"${a.name}" links to a document that does not exist`,
        why: `It refers to ${missing.join(", ")}, which is not in Documents.`,
        fix: { summary: "Remove the broken link", ops: [{ op: "set", path: `actions.${a.id}.artifactIds`, value: (a.artifactIds || []).filter((id) => artifactIds.has(id)) }] },
      });
  }
  for (const o of p.objectives) {
    const badF = o.factIds.filter((id) => !factIds.has(id));
    const badA = o.actionIds.filter((id) => !actionIds.has(id));
    if (badF.length || badA.length) {
      const ops: PatchOp[] = [];
      if (badF.length) ops.push({ op: "set", path: `objectives.${o.id}.factIds`, value: o.factIds.filter((id) => factIds.has(id)) });
      if (badA.length) ops.push({ op: "set", path: `objectives.${o.id}.actionIds`, value: o.actionIds.filter((id) => actionIds.has(id)) });
      add({ severity: "medium", section: "objectives", where: `Objective ${o.id}`, title: `Objective ${o.id} links to items that do not exist`, why: `It refers to ${[...badF, ...badA].join(", ")}, which ${badF.length + badA.length === 1 ? "is" : "are"} no longer in the case.`, fix: { summary: "Remove the broken links", ops } });
    }
    const liveF = o.factIds.filter((id) => factIds.has(id));
    const liveA = o.actionIds.filter((id) => actionIds.has(id));
    if (!liveF.length && !liveA.length)
      add({ severity: "medium", section: "objectives", where: `Objective ${o.id}`, title: `Objective ${o.id} is not linked to any fact or action`, why: `"${o.text.slice(0, 90)}" cannot be assessed: feedback decides whether an objective was met from the linked facts the student elicited and the linked actions they performed.` });
  }

  // --- Documents ---
  for (const d of p.artifacts) {
    const where = `Document ${d.id} (${d.title || "untitled"})`;
    if (d.release.when === "action") {
      const ok = actionIds.has(d.release.ref || "") || p.actions.some((a) => a.artifactIds?.includes(d.id));
      if (!ok)
        add({
          severity: "high",
          section: "artifacts",
          where,
          title: `"${d.title}" is never released`,
          why: d.release.ref ? `Its release rule points at action ${d.release.ref}, which does not exist, so students can never see it.` : "Its release rule is 'when an action is done' but no action is chosen, so students can never see it.",
          fix: { summary: "Show it in the chart from the start", ops: [{ op: "set", path: `artifacts.${d.id}.release`, value: { when: "start" } }] },
        });
    }
    if (d.release.when === "fact" && !factIds.has(d.release.ref || ""))
      add({
        severity: "high",
        section: "artifacts",
        where,
        title: `"${d.title}" is never released`,
        why: d.release.ref ? `Its release rule points at fact ${d.release.ref}, which does not exist, so students can never see it.` : "Its release rule is 'when a fact is disclosed' but no fact is chosen, so students can never see it.",
        fix: { summary: "Show it in the chart from the start", ops: [{ op: "set", path: `artifacts.${d.id}.release`, value: { when: "start" } }] },
      });
    if (d.release.when === "fact" && fact(d.release.ref || "")?.distractor) add({ severity: "low", section: "artifacts", where, title: `"${d.title}" is released by a distractor fact`, why: "Distractor facts are only used at higher difficulty, so at lower levels this document may never appear." });
    const empty = !d.body?.trim() && !d.table?.rows.length && !d.chart?.series.some((s) => s.points.length) && !d.fileUrl;
    if (empty) add({ severity: "medium", section: "artifacts", where, title: `"${d.title || d.id}" has no content`, why: "It has no body text, table, chart data or uploaded file, so students would open an empty document." });
    if (!d.title.trim()) add({ severity: "low", section: "artifacts", where, title: `Document ${d.id} has no title`, why: "The title is what students see in the chart's document list." });
    if (d.table) {
      const n = d.table.columns.length;
      const off = d.table.rows.findIndex((r) => r.cells.length !== n);
      const flagCol = n > 1 && /^flags?$/i.test(d.table.columns[n - 1].trim()) && d.table.rows.every((r) => r.cells.length === n - 1);
      if (flagCol)
        add({
          severity: "low",
          section: "artifacts",
          where,
          title: `"${d.title}" has a Flag column with no cells`,
          why: "High and low flags are stored per row and drawn automatically, so this extra column shows up empty next to the real one.",
          fix: { summary: "Remove the empty Flag column", ops: [{ op: "set", path: `artifacts.${d.id}.table.columns`, value: d.table.columns.slice(0, n - 1) }] },
        });
      else if (off >= 0) add({ severity: "low", section: "artifacts", where, title: `A table row in "${d.title}" does not match the columns`, why: `Row ${off + 1} has ${d.table.rows[off].cells.length} cells but the table has ${n} columns.` });
    }
  }

  // --- Mismatches ---
  for (const m of p.mismatches || []) {
    const where = `Mismatch ${m.id}`;
    const ops: PatchOp[] = [];
    if (m.factId && !factIds.has(m.factId)) ops.push({ op: "remove", path: `mismatches.${m.id}.factId` });
    if (m.artifactId && !artifactIds.has(m.artifactId)) ops.push({ op: "remove", path: `mismatches.${m.id}.artifactId` });
    if (ops.length) add({ severity: "medium", section: "mismatches", where, title: `Mismatch ${m.id} links to an item that does not exist`, why: "The linked fact or document was deleted or renamed.", fix: { summary: "Remove the broken link", ops } });
    else if (!m.factId) add({ severity: "low", section: "mismatches", where, title: `Mismatch ${m.id} is not linked to a fact`, why: "Link the fact that carries the patient's claim so you can see at a glance when students will hear it." });
    if (!m.patientClaim.trim() || !m.recordEvidence.trim()) add({ severity: "medium", section: "mismatches", where, title: `Mismatch ${m.id} is incomplete`, why: "A mismatch needs both what the patient says and what the record shows; feedback quotes both." });
    const d = m.artifactId ? p.artifacts.find((x) => x.id === m.artifactId) : undefined;
    const f = m.factId ? fact(m.factId) : undefined;
    if (f?.distractor) add({ severity: "low", section: "mismatches", where, title: `Mismatch ${m.id} depends on a distractor fact`, why: "Distractors are only used at higher difficulty, so the mismatch disappears at lower levels." });
    void d;
  }

  // --- Variants ---
  for (const v of p.variants || []) {
    const badF = Object.keys(v.factOverrides || {}).filter((id) => !factIds.has(id));
    const badA = Object.keys(v.actionOverrides || {}).filter((id) => !actionIds.has(id));
    if (badF.length || badA.length) {
      const ops: PatchOp[] = [...badF.map((id): PatchOp => ({ op: "remove", path: `variants.${v.id}.factOverrides.${id}` })), ...badA.map((id): PatchOp => ({ op: "remove", path: `variants.${v.id}.actionOverrides.${id}` }))];
      add({ severity: "low", section: "variants", where: `Variant ${v.id} (${v.label})`, title: `Variant "${v.label}" changes items that do not exist`, why: `It overrides ${[...badF, ...badA].join(", ")}, which ${badF.length + badA.length === 1 ? "is" : "are"} no longer in the case.`, fix: { summary: "Remove those overrides", ops } });
    }
  }

  if (rubricIds && !rubricIds.includes(p.rubricId))
    add({ severity: "medium", section: "rubric", where: "Rubric", title: "The selected rubric no longer exists", why: "Visits would be scored with the default rubric instead.", fix: { summary: "Use the default rubric", ops: [{ op: "set", path: "rubricId", value: "default" }] } });

  const order = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}
