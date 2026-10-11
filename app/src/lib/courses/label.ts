import type { CaseProfile } from "@/lib/types";

/**
 * What a student is shown in place of a case title.
 *
 * Case titles and summaries are written for faculty and usually name the diagnosis, so no
 * student-facing page or API response may use them. This label is built only from fields the
 * student would know before walking in: the patient's first name and age, the kind of visit and
 * the specialty. Never add `title`, `summary`, `answerKey` or objectives text here.
 *
 * No database imports: this file is safe to import from client components.
 */
type LabelSource = { patient?: Partial<CaseProfile["patient"]> | null; encounterType?: string | null; specialty?: string | null };

const tidy = (s: unknown) =>
  String(s ?? "")
    .replace(/["“”]/g, "")
    .replace(/\s+/g, " ")
    .trim();
const sentence = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** "Denise, 41": first name and age only. */
export function studentPatientLabel(p: LabelSource | null | undefined): string {
  const first = tidy(p?.patient?.name).split(" ")[0] || "Patient";
  const age = p?.patient?.age;
  return typeof age === "number" && Number.isFinite(age) ? `${first}, ${age}` : first;
}

/** "Denise, 41 · Diagnostic interview · Neurology". */
export function studentCaseLabel(p: LabelSource | null | undefined): string {
  return [studentPatientLabel(p), sentence(tidy(p?.encounterType)), tidy(p?.specialty)].filter(Boolean).join(" · ");
}

/** Same label from a stored `cases.profile` JSON string. */
export function studentCaseLabelFromJson(profileJson: string | null | undefined): string {
  try {
    return studentCaseLabel(profileJson ? (JSON.parse(profileJson) as LabelSource) : null);
  } catch {
    return studentCaseLabel(null);
  }
}

/** Care journeys: the patient's name and the roles involved, in place of the faculty title and summary. */
export function studentJourneyLabel(patientName: string | null | undefined, roleTitles: string[]): { title: string; roles: string } {
  const name = tidy(patientName) || "Patient";
  const roles = roleTitles.map(tidy).filter(Boolean);
  return { title: `${name}: care journey`, roles: roles.join(", ") };
}
