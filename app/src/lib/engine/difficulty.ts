import type { Knobs, Perturbation } from "../types";

export const LEVEL_NAMES = ["", "Foundational", "Developing", "Proficient", "Advanced", "Expert"];

/**
 * Difficulty never changes the clinical facts of a case. It changes how hard the patient is to
 * interview: how much trust is needed, how vague they are, how many facts come out per answer.
 */
export function knobsForLevel(level: number, caseTimeLimitMin = 20): Knobs {
  const L = Math.max(1, Math.min(5, Math.round(level)));
  const t = {
    1: { rapportStart: 62, reluctantAt: 55, hiddenAt: 70, factsPerTurn: 4, volunteers: true, vagueness: 0, emotion: 0, distractors: false, hints: true, time: null as number | null },
    2: { rapportStart: 55, reluctantAt: 60, hiddenAt: 74, factsPerTurn: 3, volunteers: true, vagueness: 1, emotion: 1, distractors: false, hints: true, time: null as number | null },
    3: { rapportStart: 48, reluctantAt: 64, hiddenAt: 78, factsPerTurn: 3, volunteers: false, vagueness: 1, emotion: 1, distractors: true, hints: true, time: caseTimeLimitMin },
    4: { rapportStart: 42, reluctantAt: 68, hiddenAt: 82, factsPerTurn: 2, volunteers: false, vagueness: 2, emotion: 2, distractors: true, hints: false, time: caseTimeLimitMin },
    5: { rapportStart: 36, reluctantAt: 72, hiddenAt: 86, factsPerTurn: 2, volunteers: false, vagueness: 3, emotion: 3, distractors: true, hints: false, time: Math.max(8, caseTimeLimitMin - 5) },
  }[L]!;
  return {
    level: L,
    rapportStart: t.rapportStart,
    reluctantAt: t.reluctantAt,
    hiddenAt: t.hiddenAt,
    factsPerTurn: t.factsPerTurn,
    volunteers: t.volunteers,
    vagueness: t.vagueness,
    emotion: t.emotion,
    distractors: t.distractors,
    hints: t.hints,
    timeLimitMin: t.time,
  };
}

/** Rating that a level "plays at" in the adaptive model. */
export const LEVEL_RATING = [0, 1000, 1150, 1300, 1450, 1600];

/**
 * Persona twists for repeat attempts. They change mood and delivery only, so a student who
 * memorised the last transcript still has to listen, and the answer key stays valid.
 */
export const PERTURBATIONS: Perturbation[] = [
  { id: "rushed", label: "In a hurry", description: "The patient has somewhere to be and keeps answers short.", directive: "Today you are pressed for time (you need to leave soon). Keep answers short, glance at the clock, and get mildly impatient with long or repeated questions.", knobDelta: { factsPerTurn: 2 } },
  { id: "anxious", label: "More anxious", description: "The patient is visibly worried and seeks reassurance.", directive: "Today you are noticeably more anxious than usual. You ask worried questions, sometimes interrupt your own answers with fears, and need reassurance before you can focus." },
  { id: "talkative", label: "Talkative and tangential", description: "The patient wanders off topic and needs gentle redirection.", directive: "Today you are chatty and drift into unrelated stories from your background before getting to the point. A polite redirection brings you back." },
  { id: "withdrawn", label: "Withdrawn", description: "The patient is flat and gives minimal answers until engaged.", directive: "Today you are low and withdrawn. You give minimal answers and little eye contact until the student shows real interest in you as a person.", knobDelta: { rapportStart: -8 } },
  { id: "skeptical", label: "Skeptical of advice", description: "The patient pushes back and asks for reasons.", directive: "Today you are doubtful about medical advice. You ask 'why' and 'how do you know' and mention something you read or heard that contradicts the student." },
  { id: "family", label: "Family pressure", description: "A family member's opinion is weighing on the patient.", directive: "Today a close family member's strong opinion about your health is on your mind and you bring it up; it makes you hesitant to agree to plans on your own." },
  { id: "badday", label: "Having a bad day", description: "The patient is irritable for unrelated reasons.", directive: "Today you are irritable because of a frustrating morning unrelated to your health (long wait, parking, a rude phone call). You soften if the student acknowledges it.", knobDelta: { rapportStart: -6 } },
];

export function applyPerturbation(k: Knobs, p?: Perturbation | null): Knobs {
  if (!p?.knobDelta) return k;
  const out = { ...k };
  if (p.knobDelta.factsPerTurn) out.factsPerTurn = Math.min(out.factsPerTurn, p.knobDelta.factsPerTurn);
  if (p.knobDelta.rapportStart) out.rapportStart = Math.max(15, out.rapportStart + p.knobDelta.rapportStart);
  return out;
}
