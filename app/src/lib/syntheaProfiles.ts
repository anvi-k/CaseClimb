import type { SyntheaRecord } from "./synthea";

/**
 * Builds a patient profile in the organisers' sample format (nine sections) from a Synthea
 * record. Code fills every field the record can supply. The model fills only the rest: how the
 * person eats, thinks, feels and talks, what they hold back, and the teaching design. Each
 * patient is also given a set of traits chosen by code, so a hundred profiles do not drift
 * toward the same personality and the same diet.
 *
 * Pure: no file system and no model calls, so it can be tested without either.
 */

// ---------- The part taken from the record ----------

const title = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const dose = (name: string) => name.match(/\d+(?:\.\d+)?\s*(?:MG\/ML|MG\/ACTUAT|MCG\/ACTUAT|MG|MCG|UNT\/ML|ML|%)/i)?.[0] || "As labelled";

export interface BaseProfile {
  patient_overview: { name: string; age: number; sex: string };
  demographics: { residence: string; ethnicity: string; language: string; marital_status: string; education_level: string; insurance: string };
  clinical_profile: { active_problems: string[]; medical_history: string[]; allergies: string[]; laboratory_data: string[]; vital_signs: string[]; anthropometrics: string[] };
  medication_profile: { medications: { name: string; dose: string; purpose: string }[] };
}

export function baseProfile(r: SyntheaRecord): BaseProfile {
  const household = Number(r.survey?.people_in_household);
  const lives = household === 1 ? "lives alone" : household > 1 ? `household of ${household}` : "";
  const v = r.vitals;
  return {
    patient_overview: { name: r.name, age: r.age, sex: title(r.sex) },
    demographics: {
      residence: [r.city, lives, r.survey?.housing && r.survey.housing !== "I have housing" ? r.survey.housing : ""].filter(Boolean).join("; "),
      ethnicity: [title(r.race), r.ethnicity === "hispanic" ? "Hispanic" : ""].filter(Boolean).join(", "),
      language: r.survey?.language || "English",
      marital_status: title(r.marital) || "Not recorded",
      education_level: r.survey?.education || "Not recorded",
      insurance: r.survey?.insurance || "Not recorded",
    },
    clinical_profile: {
      active_problems: r.problems.map((p) => p.name),
      medical_history: [
        ...r.problems.map((p) => `${p.name} since ${p.since}`),
        ...r.past.map((p) => `${p.name} (${p.from} to ${p.to}, resolved)`),
        ...r.procedures.map((p) => `${p.what} (${p.date})`),
      ],
      allergies: r.allergies.length ? r.allergies.map((a) => `${a.substance}${a.reaction ? ` (${a.reaction})` : ""}`) : ["No known allergies"],
      laboratory_data: r.labs.map((l) => `${l.test}: ${l.value} ${l.units} (reference ${l.reference}; ${l.date})`),
      vital_signs: [
        v.systolic && v.diastolic ? `BP: ${v.systolic}/${v.diastolic} mmHg` : "",
        v.heart_rate ? `HR: ${v.heart_rate} bpm` : "",
        v.respiratory_rate ? `RR: ${v.respiratory_rate} breaths/min` : "",
        v.recorded ? `Recorded: ${v.recorded}` : "",
      ].filter(Boolean),
      anthropometrics: [
        v.height_cm ? `Height: ${v.height_cm} cm` : "",
        v.weight_kg ? `Weight: ${v.weight_kg} kg` : "",
        v.bmi ? `BMI: ${v.bmi} kg/m2` : "",
        v.weight_change ? `Weight change: ${v.weight_change}` : "",
      ].filter(Boolean),
    },
    medication_profile: { medications: r.medications.map((m) => ({ name: m.name, dose: dose(m.name), purpose: m.reason || "Not recorded" })) },
  };
}

// ---------- Traits assigned by code ----------

const TRAITS = {
  personality: [
    "warm and talkative, likes to be liked",
    "reserved and private, gives little away at first",
    "anxious and apologetic, expects to be told off",
    "blunt and impatient, wants the point quickly",
    "cheerful, deflects anything serious with a joke",
    "skeptical and questioning, wants reasons for everything",
    "stoic, plays every problem down",
    "overwhelmed and scattered, loses the thread",
    "proud and self-reliant, dislikes being advised",
    "agreeable to a fault, says yes to everything and changes nothing",
  ],
  communication: [
    "short answers until asked a second time",
    "long stories that wander off the question",
    "precise and factual, quotes numbers and dates",
    "changes the subject when uncomfortable",
    "answers questions with questions",
    "defers with 'whatever you think is best'",
  ],
  readiness: [
    "precontemplation: does not see a reason to change",
    "contemplation: knows something should change but is torn",
    "preparation: has decided and wants a concrete first step",
    "action: started changing in the last few weeks and it is fragile",
    "maintenance: changed a while ago and is starting to slip",
  ],
  literacy: ["low health literacy", "moderate health literacy", "high health literacy, reads a lot online"],
  eating: [
    "cooks traditional family meals for a full household and eats what everyone eats",
    "relies on convenience and ready meals because cooking for one feels pointless",
    "works shifts or long hours and eats at irregular times, often from vending machines or drive-throughs",
    "eats out or orders takeaway most days, and it is the main social life",
    "shops on a tight budget, buys what is cheap and filling, sometimes uses a food pantry",
    "someone else in the home does all the cooking and decides what is on the plate",
    "has no set meals and grazes on snacks through the day",
    "follows a self-directed diet picked up from social media or a friend",
    "skips meals during the day and then eats a very large meal late at night",
    "cooks well and enjoys it, but portions are large and food is how the family shows love",
  ],
  held_back: [
    "money worries that affect which food or medicines they buy",
    "drinks more alcohol than they first say",
    "does not take one of their medicines the way it was prescribed",
    "a fear that a relative's illness will repeat itself in them",
    "takes supplements or home remedies the clinic does not know about",
    "eats for comfort or in binges and is ashamed of it",
    "struggles to read labels or written instructions and hides it",
    "caring duties for someone else that leave no time for their own health",
  ],
  support: [
    "a partner who is supportive but anxious and hovers",
    "adult children who mean well and lecture",
    "a close friend or neighbour who is the main support",
    "a faith or community group that matters a great deal",
    "family nearby who do not take the condition seriously",
    "very little day-to-day support",
  ],
} as const;

export type Traits = { [K in keyof typeof TRAITS]: string };

/**
 * Traits for the nth patient. Each list is walked with a different stride, so combinations do
 * not repeat in step with each other and every option is used about equally often.
 */
export function traitsFor(index: number): Traits {
  const pick = <T,>(list: readonly T[], stride: number, offset: number) => list[(index * stride + offset) % list.length];
  return {
    personality: pick(TRAITS.personality, 3, 0),
    communication: pick(TRAITS.communication, 5, 1),
    readiness: pick(TRAITS.readiness, 2, 3),
    literacy: pick(TRAITS.literacy, 1, 2),
    eating: pick(TRAITS.eating, 7, 4),
    held_back: pick(TRAITS.held_back, 5, 2),
    support: pick(TRAITS.support, 1, 5),
  };
}

// ---------- What the model is asked for ----------

const str = { type: "string" };
const strs = { type: "array", items: str };
const section = (properties: Record<string, unknown>) => ({ type: "object", required: Object.keys(properties), properties });

export function gapSchema(r: SyntheaRecord) {
  return section({
    description: { type: "string", description: "3-4 sentences introducing the patient to a faculty member: who they are, what is wrong, how they come across to a student." },
    keywords: { type: "array", items: str, description: "6-10 lower-case keywords: conditions and teaching themes." },
    occupation: { type: "string", description: "A specific job (or former job) that fits the recorded employment status, age and education." },
    cultural_context: str,
    primary_diagnosis: { type: "string", enum: r.problems.map((p) => p.name), description: "The recorded problem this nutrition visit is mainly about." },
    current_symptoms: { type: "array", items: str, description: "What the patient notices day to day, consistent with the recorded problems. No new diagnoses." },
    clinical_findings: { type: "array", items: str, description: "2-4 things a clinician would see or hear on examining this patient (appearance, skin, mouth, swelling, gait, breath sounds), consistent with the recorded problems. Not laboratory values, vital signs or measurements: those are already in the record." },
    medications: {
      type: "array",
      description: "One entry for every recorded medication, in the same order.",
      items: section({ index: { type: "integer", description: "Position of the medication in the record, starting at 0." }, frequency: str, adherence: str, patient_concerns: str }),
    },
    supplements_and_otc: strs,
    nutrition_profile: section({ dietary_pattern: str, food_preferences: strs, foods_or_behaviors_to_explore: strs, meal_pattern: str, hydration: str, physical_activity: str, substance_use: str, sleep: str }),
    psychosocial_profile: section({ personality: str, communication_style: str, goals: strs, concerns: strs, beliefs: strs, motivations: strs, fears: strs, barriers: strs, strengths: strs, support_system: str, readiness_to_change: str }),
    information_disclosure: section({ initial_information: strs, discoverable_information: strs, reluctant_information: strs, hidden_information: strs }),
    learning_opportunities: {
      type: "array",
      description: "4-6 opportunities for a dietetics student.",
      items: section({ learning_objective: str, expected_discoveries: strs, possible_patient_reactions: strs }),
    },
    metadata: section({ assumptions: strs, optional_details: strs }),
  });
}

export const GAP_SYSTEM = `You complete synthetic patient profiles for a health-professions school's nutrition-education simulator. Each profile starts from a Synthea record, which supplies the medical facts. You write the human being around that record: how they eat, live, think and talk, what they hold back, and what a dietetics student should learn from meeting them.

Rules
- The record is fixed. Never change, add to or contradict its diagnoses, medications, allergies, laboratory values, vital signs or measurements. Do not introduce a new diagnosis, a new prescription medicine or a new lab value. Supplements and over-the-counter products are yours to write.
- Everything you write must be consistent with the record: a person with a household of six does not live alone; a non-smoker does not smoke; an alcohol screening score of 1 is a light drinker.
- The assigned traits are fixed too. Build the person around them. If a trait cannot fit the record, bend the trait as little as needed and keep the record.
- Make this person specific. Name actual foods, shops, routines, people and phrases. Avoid the generic patient who "eats fast food and wants to be healthier".
- Do not reuse names, foods, jobs, phrases or scenarios from the example profiles. They show the format, the level of detail and the tone, nothing else.
- Do not give the patient the foods, beliefs or family patterns conventionally associated with their race or ethnicity. Build what they eat from the assigned eating pattern, their job, budget, household, age and where they live. Cultural context is about this individual's upbringing and values, written with respect.
- Hidden and reluctant items must be concrete: name the person, the amount, the event. Never hedge with "likely", "possibly" or "something".
- Do not repeat laboratory values, vital signs or measurements in the fields you write; refer to them in words if you need to ("her cholesterol is high").
- information_disclosure sorts what the patient reveals into four tiers: initial (said unprompted at the start), discoverable (comes out with ordinary good questions), reluctant (needs trust or a careful, non-judgmental question), hidden (only with real rapport). The held-back trait belongs in reluctant or hidden. Put at least one item in each tier.
- Write patient reactions as things this patient would actually say, in their voice.
- This is synthetic educational content. No real people.`;

export function gapPrompt(r: SyntheaRecord, traits: Traits, examples: unknown[]): string {
  const s = r.survey || {};
  const survey = Object.entries(s)
    .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`)
    .join("; ");
  return `${examples.length ? `EXAMPLE PROFILES (format and depth only; do not copy their content)\n${examples.map((e) => JSON.stringify(e)).join("\n\n")}\n\n` : ""}THE RECORD (from Synthea; fixed)
${JSON.stringify(baseProfile(r), null, 1)}
Smoking status: ${r.smoking || "not recorded"}
Social survey and screening answers: ${survey || "none recorded"}
Other findings on record: ${r.social.join("; ") || "none"}
Recent encounters: ${r.encounters.map((e) => `${e.date} ${e.type}: ${e.what}${e.reason ? ` (${e.reason})` : ""}`).join("; ") || "none"}
Care plans: ${r.careplans.join("; ") || "none"}

ASSIGNED TRAITS (fixed)
- Personality: ${traits.personality}
- Way of talking: ${traits.communication}
- Readiness to change: ${traits.readiness}
- ${title(traits.literacy)}
- How they eat: ${traits.eating}
- What they hold back: ${traits.held_back}
- Support: ${traits.support}

Complete the profile for a nutrition-education visit. Return one entry in "medications" for each of the ${r.medications.length} recorded medication${r.medications.length === 1 ? "" : "s"}, using index 0 to ${Math.max(0, r.medications.length - 1)}.`;
}

// ---------- Putting the two together ----------

export interface Gap {
  description: string;
  keywords: string[];
  occupation: string;
  cultural_context: string;
  primary_diagnosis: string;
  current_symptoms: string[];
  clinical_findings: string[];
  medications: { index: number; frequency: string; adherence: string; patient_concerns: string }[];
  supplements_and_otc: string[];
  nutrition_profile: Record<string, string | string[]>;
  psychosocial_profile: Record<string, string | string[]>;
  information_disclosure: Record<string, string[]>;
  learning_opportunities: { learning_objective: string; expected_discoveries: string[]; possible_patient_reactions: string[] }[];
  metadata: { assumptions: string[]; optional_details: string[] };
}

/** The learning opportunities that are complete; the model now and then emits a stray placeholder in the list. */
const opportunities = (gap: Gap) => (Array.isArray(gap.learning_opportunities) ? gap.learning_opportunities : []).filter((o) => o && typeof o === "object" && String(o.learning_objective || "").trim() && Array.isArray(o.expected_discoveries));

/** Reasons a model reply cannot be used. Empty when it is fine. */
export function gapProblems(gap: Gap, r: SyntheaRecord): string[] {
  const out: string[] = [];
  if (!r.problems.some((p) => p.name === gap.primary_diagnosis)) out.push("primary_diagnosis is not one of the recorded problems");
  for (const tier of ["initial_information", "discoverable_information", "reluctant_information", "hidden_information"]) if (!gap.information_disclosure?.[tier]?.length) out.push(`information_disclosure.${tier} is empty`);
  for (const key of ["dietary_pattern", "meal_pattern"]) if (!String(gap.nutrition_profile?.[key] || "").trim()) out.push(`nutrition_profile.${key} is empty`);
  if (!String(gap.psychosocial_profile?.personality || "").trim()) out.push("psychosocial_profile.personality is empty");
  if (opportunities(gap).length < 3) out.push("fewer than three usable learning opportunities");
  if (/\b(likely|possibly|perhaps|probably)\b/i.test((gap.information_disclosure?.hidden_information || []).join(" "))) out.push("hidden_information hedges instead of stating what is hidden");
  return out;
}

/** The finished profile: the organisers' nine sections, plus a note of which fields came from where. */
export function mergeProfile(r: SyntheaRecord, gap: Gap, traits: Traits, model: string) {
  const base = baseProfile(r);
  const byIndex = new Map((gap.medications || []).map((m) => [m.index, m]));
  return {
    patient_overview: { ...base.patient_overview, description: gap.description, keywords: gap.keywords },
    demographics: { occupation: gap.occupation, ...base.demographics, cultural_context: gap.cultural_context },
    clinical_profile: {
      primary_diagnosis: gap.primary_diagnosis,
      secondary_diagnoses: base.clinical_profile.active_problems.filter((p) => p !== gap.primary_diagnosis),
      medical_history: base.clinical_profile.medical_history,
      current_symptoms: gap.current_symptoms,
      allergies: base.clinical_profile.allergies,
      clinical_findings: gap.clinical_findings,
      laboratory_data: base.clinical_profile.laboratory_data,
      vital_signs: base.clinical_profile.vital_signs,
      anthropometrics: base.clinical_profile.anthropometrics,
    },
    medication_profile: {
      medications: base.medication_profile.medications.map((m, i) => ({
        name: m.name,
        dose: m.dose,
        frequency: byIndex.get(i)?.frequency || "As prescribed",
        purpose: m.purpose,
        adherence: byIndex.get(i)?.adherence || "Not discussed",
        patient_concerns: byIndex.get(i)?.patient_concerns || "None raised",
      })),
      supplements_and_otc: gap.supplements_and_otc,
    },
    nutrition_profile: gap.nutrition_profile,
    psychosocial_profile: gap.psychosocial_profile,
    information_disclosure: gap.information_disclosure,
    learning_opportunities: { opportunities: opportunities(gap) },
    metadata: gap.metadata,
    source: {
      synthea_record: r.id,
      condition_group: r.group,
      written_by_model: model,
      assigned_traits: traits,
      from_synthea: [
        "patient_overview.name, age, sex",
        "demographics.residence, ethnicity, language, marital_status, education_level, insurance",
        "clinical_profile.secondary_diagnoses, medical_history, allergies, laboratory_data, vital_signs, anthropometrics",
        "clinical_profile.primary_diagnosis (chosen by the model from the recorded problems)",
        "medication_profile.medications: name, dose, purpose",
      ],
      from_model: [
        "patient_overview.description, keywords",
        "demographics.occupation, cultural_context",
        "clinical_profile.current_symptoms, clinical_findings",
        "medication_profile.medications: frequency, adherence, patient_concerns",
        "medication_profile.supplements_and_otc",
        "nutrition_profile, psychosocial_profile, information_disclosure, learning_opportunities, metadata",
      ],
    },
  };
}

export type SyntheaProfile = ReturnType<typeof mergeProfile>;
