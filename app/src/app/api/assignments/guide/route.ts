import { apiUser } from "@/lib/auth";
import { decodeEntities } from "@/lib/courses/save";
import { courseFor, normalizeSettings, publishedCaseBriefs, publishedJourneys } from "@/lib/courses";
import { LEVEL_NAMES } from "@/lib/engine/difficulty";
import { bad, longJson } from "@/lib/http";
import { chatJSON, MODELS } from "@/lib/llm";
import { profession } from "@/lib/professions";

const SYSTEM = `You help a health-professions instructor set up an assignment in Poscere, a simulator where students hold a telehealth visit with a virtual patient and then get rubric feedback.

You propose a setup; the instructor reviews and edits every part before saving. Choose only from the patients and care journeys listed. If nothing listed fits what the instructor asked for, pick the closest and say plainly in "gaps" what is missing; never invent a patient.

How the settings work:
- type: "homework" (graded practice with a due date), "exam" (summative: no hints, one fixed level for everyone, feedback normally held until the instructor releases it, usually 1 attempt) or "practice" (ungraded repetition, unlimited attempts).
- level 1-5 changes how hard the patient is to interview, never the clinical facts. 1 Foundational: forthcoming, calm, volunteers information. 2 Developing: slightly vague. 3 Proficient: stops volunteering, includes red herrings, timed. 4 Advanced: guarded, vague, emotional, no hints. 5 Expert: distressed, very vague, tight time. Each patient also has its own intrinsic level; set useCaseLevel when students should meet each patient at that level.
- perturb: on repeat attempts the patient's mood and delivery change (rushed, anxious, withdrawn and so on) so students cannot memorise a transcript. The facts stay the same.
- liveAssist: the instructor can watch the visit as it happens, pause it and send a note. Suited to supervised practice; normally off for exams.
- timeLimitMin: 0 means no limit.
- maxAttempts: 0 means unlimited.

Write for a busy instructor: plain, specific, no filler. Every reason is one sentence.`;

const schema = {
  type: "object",
  required: ["title", "instructions", "type", "typeReason", "target", "cases", "level", "useCaseLevel", "levelReason", "timeLimitMin", "hints", "maxAttempts", "perturb", "liveAssist", "feedbackRelease", "settingsReason", "gaps"],
  properties: {
    title: { type: "string", description: "Short assignment title" },
    instructions: { type: "string", description: "2-4 sentences shown to students: what to practise and what a good visit looks like. Must not reveal findings or diagnoses." },
    type: { type: "string", enum: ["homework", "exam", "practice"] },
    typeReason: { type: "string" },
    target: { type: "string", enum: ["cases", "journey"], description: "'journey' only when the instructor wants interprofessional or handoff practice and a listed care journey fits" },
    journeyId: { type: "string", description: "Id of the chosen care journey when target is 'journey'" },
    cases: {
      type: "array",
      description: "Chosen patients when target is 'cases', best fit first. Usually 1-4.",
      items: { type: "object", required: ["id", "reason"], properties: { id: { type: "string" }, reason: { type: "string", description: "One sentence tying this patient to what the instructor asked for" } } },
    },
    level: { type: "integer", minimum: 1, maximum: 5 },
    useCaseLevel: { type: "boolean", description: "True to use each patient's own level instead of one fixed level. Never true for exams." },
    levelReason: { type: "string", description: "One line on why this level suits these students" },
    timeLimitMin: { type: "integer", minimum: 0, maximum: 120 },
    hints: { type: "boolean" },
    maxAttempts: { type: "integer", minimum: 0, maximum: 10 },
    perturb: { type: "boolean" },
    liveAssist: { type: "boolean" },
    feedbackRelease: { type: "string", enum: ["immediate", "manual"] },
    settingsReason: { type: "string", description: "1-2 sentences covering the time limit, hints, attempts, patient variation, live assist and feedback release choices" },
    gaps: { type: "string", description: "Only when something the instructor asked for cannot be met by the listed patients: one or two sentences naming what is missing. Otherwise an empty string. Do not restate your choices here." },
  },
};

type Raw = {
  title: string;
  instructions: string;
  type: "homework" | "exam" | "practice";
  typeReason: string;
  target: "cases" | "journey";
  journeyId?: string;
  cases: { id: string; reason: string }[];
  level: number;
  useCaseLevel: boolean;
  levelReason: string;
  timeLimitMin: number;
  hints: boolean;
  maxAttempts: number;
  perturb: boolean;
  liveAssist: boolean;
  feedbackRelease: "immediate" | "manual";
  settingsReason: string;
  gaps: string;
};

/** AI guide for the assignment builder. Body: { courseId, request, syllabus? }. Returns a proposal; nothing is saved. */
export async function POST(req: Request) {
  const user = await apiUser("faculty");
  if (user instanceof Response) return user;
  const b = await req.json().catch(() => ({}));
  const course = courseFor(user, String(b.courseId || ""));
  if (!course) return bad("Course not found", 404);
  const request = String(b.request || "").trim().slice(0, 3000);
  const syllabus = String(b.syllabus || "").trim().slice(0, 12000);
  if (!request && !syllabus) return bad("Say what you want students to practise, or paste your objectives");
  const cases = publishedCaseBriefs();
  if (!cases.length) return bad("There are no published patients yet. Publish one in Patient Studio first.");
  const journeys = publishedJourneys();
  const role = course.profession_id ? profession(course.profession_id) : null;

  const prompt = `COURSE: ${course.name}${role ? `. Students are training as: ${role.name}` : ""}

WHAT THE INSTRUCTOR WANTS STUDENTS TO PRACTISE
${request || "(not stated; use the syllabus material)"}
${syllabus ? `\nSYLLABUS EXCERPT / OBJECTIVES PASTED BY THE INSTRUCTOR\n${syllabus}\n` : ""}
PUBLISHED PATIENTS
${cases
  .map(
    (c) =>
      `id: ${c.id}\ntitle: ${c.title}\nprofessions: ${c.professions.join(", ") || "any"} | specialty: ${c.specialty} | visit type: ${c.encounterType} | intrinsic level: ${c.difficulty} (${LEVEL_NAMES[c.difficulty] || ""}) | suggested time: ${c.timeLimitMin} min${c.aiDraft ? " | AI draft, not yet reviewed by faculty" : ""}\nsummary: ${c.summary}\nobjectives: ${c.objectives.join("; ") || "none listed"}`,
  )
  .join("\n\n")}

PUBLISHED CARE JOURNEYS (one patient seen by several professions in turn)
${journeys.map((j) => `id: ${j.id} | title: ${j.title} | patient: ${cases.find((c) => c.id === j.case_id)?.title || j.case_id}`).join("\n") || "none"}`;

  return longJson(async () => {
    const raw = await chatJSON<Raw>({ model: MODELS.smart, system: SYSTEM, schema, maxTokens: 2500, messages: [{ role: "user", text: prompt }] });
    const type = (["homework", "exam", "practice"] as const).find((t) => t === raw.type) || "homework";
    // The model only chooses among real ids; anything else is dropped.
    const chosen = (raw.cases || []).filter((c) => cases.some((x) => x.id === c.id));
    const journey = raw.target === "journey" ? journeys.find((j) => j.id === raw.journeyId) : undefined;
    const settings = normalizeSettings(type, {
      level: raw.useCaseLevel && type !== "exam" ? null : raw.level,
      timeLimitMin: raw.timeLimitMin,
      hints: raw.hints,
      maxAttempts: raw.maxAttempts,
      perturb: raw.perturb,
      liveAssist: raw.liveAssist,
      feedbackRelease: raw.feedbackRelease,
    });
    return {
      proposal: {
        title: decodeEntities(String(raw.title || "")).trim().slice(0, 160),
        instructions: decodeEntities(String(raw.instructions || "")),
        type,
        journeyId: journey?.id || null,
        caseIds: journey ? [] : chosen.map((c) => c.id),
        settings,
      },
      reasons: {
        type: decodeEntities(raw.typeReason || ""),
        level: decodeEntities(raw.levelReason || ""),
        settings: decodeEntities(raw.settingsReason || ""),
        cases: Object.fromEntries(chosen.map((c) => [c.id, decodeEntities(String(c.reason || ""))])),
        gaps: decodeEntities(raw.gaps || ""),
      },
    };
  });
}
