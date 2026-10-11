"""Turn Synthea's CSV export into the compact patient records the app reads.

Synthea (https://github.com/synthetichealth/synthea) builds synthetic patient
histories from published disease statistics and care guidelines, with no
language model involved. Generate the CSVs, then run this:

    java -jar synthea-with-dependencies.jar -s 2026 -cs 2026 -p 800 -a 18-85 \\
        --exporter.csv.export=true --exporter.fhir.export=false "New Jersey"
    python3 scripts/synthea_records.py <output/csv folder> data/synthea/records.json

It keeps 100 living adults whose records give a nutrition visit something to
work with, spread across conditions, sexes and age bands. Standard library only.
"""

import csv
import json
import re
import sys
from collections import defaultdict
from datetime import date

RECORDS = 100
SUFFIX = re.compile(r"\s*\((disorder|finding|situation|person|procedure|regime/therapy|morphologic abnormality)\)$")
NOT_PROBLEMS = {"Medication review due"}
# Findings that belong on a problem list although Synthea does not call them disorders.
CLINICAL_FINDINGS = ("prediabetes", "obesity", "chronic pain", "chronic low back pain", "chronic neck pain", "abnormal findings", "history of", "pregnancy")
SKIP_PROCEDURES = ("medication reconciliation", "assessment", "screening", "depression screen", "patient referral", "counseling", "education", "notifications", "review of systems", "brief general examination", "initial patient assessment")
LABS = {
    "Hemoglobin A1c/Hemoglobin.total in Blood": ("HbA1c", "%", "< 5.7"),
    "Glucose [Mass/volume] in Blood": ("Glucose", "mg/dL", "70-99 (fasting)"),
    "Glucose [Mass/volume] in Serum or Plasma": ("Glucose", "mg/dL", "70-99 (fasting)"),
    "Creatinine [Mass/volume] in Blood": ("Creatinine", "mg/dL", "0.6-1.3"),
    "Creatinine [Mass/volume] in Serum or Plasma": ("Creatinine", "mg/dL", "0.6-1.3"),
    "Glomerular filtration rate [Volume Rate/Area] in Serum or Plasma by Creatinine-based formula (MDRD)/1.73 sq M": ("eGFR", "mL/min/1.73m2", ">= 90"),
    "Cholesterol [Mass/volume] in Serum or Plasma": ("Total cholesterol", "mg/dL", "< 200"),
    "Low Density Lipoprotein Cholesterol": ("LDL cholesterol", "mg/dL", "< 100"),
    "Cholesterol in LDL [Mass/volume] in Serum or Plasma by Direct assay": ("LDL cholesterol", "mg/dL", "< 100"),
    "High Density Lipoprotein Cholesterol": ("HDL cholesterol", "mg/dL", ">= 40"),
    "Cholesterol in HDL [Mass/volume] in Serum or Plasma": ("HDL cholesterol", "mg/dL", ">= 40"),
    "Triglycerides": ("Triglycerides", "mg/dL", "< 150"),
    "Triglyceride [Mass/volume] in Serum or Plasma": ("Triglycerides", "mg/dL", "< 150"),
    "Hemoglobin [Mass/volume] in Blood": ("Haemoglobin", "g/dL", "12.0-17.5"),
    "MCV [Entitic volume] by Automated count": ("MCV", "fL", "80-100"),
    "Leukocytes [#/volume] in Blood by Automated count": ("White cell count", "10*3/uL", "4.0-11.0"),
    "Platelets [#/volume] in Blood by Automated count": ("Platelets", "10*3/uL", "150-450"),
    "Potassium [Moles/volume] in Blood": ("Potassium", "mmol/L", "3.5-5.1"),
    "Potassium [Moles/volume] in Serum or Plasma": ("Potassium", "mmol/L", "3.5-5.1"),
    "Sodium [Moles/volume] in Blood": ("Sodium", "mmol/L", "135-145"),
    "Sodium [Moles/volume] in Serum or Plasma": ("Sodium", "mmol/L", "135-145"),
    "Urea nitrogen [Mass/volume] in Blood": ("Urea nitrogen", "mg/dL", "7-20"),
    "Urea nitrogen [Mass/volume] in Serum or Plasma": ("Urea nitrogen", "mg/dL", "7-20"),
    "Microalbumin/Creatinine [Mass Ratio] in Urine": ("Urine albumin/creatinine", "mg/g", "< 30"),
}
VITALS = {
    "Systolic Blood Pressure": "systolic",
    "Diastolic Blood Pressure": "diastolic",
    "Heart rate": "heart_rate",
    "Respiratory rate": "respiratory_rate",
    "Body temperature": "temperature_c",
    "Oxygen saturation in Arterial blood": "spo2",
    "Body Weight": "weight_kg",
    "Body Height": "height_cm",
    "Body mass index (BMI) [Ratio]": "bmi",
}
# Answers the patient gave to the social-needs survey and the screening questionnaires.
SURVEY = {
    "Employment status - current": "employment",
    "Highest level of education": "education",
    "Primary insurance": "insurance",
    "Preferred language": "language",
    "Housing status": "housing",
    "Are you worried about losing your housing [PRAPARE]": "worried_about_housing",
    "How many people are living or staying at this address [#]": "people_in_household",
    "Has lack of transportation kept you from medical appointments  meetings  work  or from getting things needed for daily living": "transport_problem",
    "Have you or any family members you live with been unable to get any of the following when it was really needed in past 1 year [PRAPARE]": "went_without",
    "How often do you see or talk to people that you care about and feel close to [PRAPARE]": "social_contact",
    "Stress level": "stress",
    "What was your best estimate of the total income of all family members from all sources  before taxes  in last year [PhenX]": "household_income_usd",
    "Discharged from the U.S. Armed Forces": "veteran",
    "Tobacco smoking status": "smoking",
    "Total score [AUDIT-C]": "audit_c_alcohol_score",
    "Patient Health Questionnaire 2 item (PHQ-2) total score [Reported]": "phq2_mood_score",
    "Generalized anxiety disorder 7 item (GAD-7) total score [Reported.PHQ]": "gad7_anxiety_score",
}
NO_ANSWER = "I choose not to answer this question"
# What makes a record useful for a nutrition visit, most specific first.
GROUPS = [
    ("diabetes", ("diabetes mellitus type 2", "due to type 2 diabetes", "diabetic")),
    ("kidney", ("chronic kidney disease",)),
    ("heart", ("ischemic heart disease", "heart failure", "myocardial infarction", "coronary")),
    ("hypertension", ("essential hypertension",)),
    ("lipids", ("hyperlipidemia", "hypertriglyceridemia", "metabolic syndrome")),
    ("prediabetes", ("prediabetes",)),
    ("anemia", ("anemia",)),
    ("bone", ("osteoporosis", "osteopenia")),
    ("weight", ("obesity",)),
]


def clean(text: str) -> str:
    return re.sub(r"\s+", " ", SUFFIX.sub("", text)).strip()


def rows(folder: str, name: str):
    with open(f"{folder}/{name}.csv", newline="", encoding="utf-8") as f:
        yield from csv.DictReader(f)


def number(value: str, digits: int = 1) -> str:
    try:
        return f"{float(value):.{digits}f}".rstrip("0").rstrip(".") if digits else f"{float(value):.0f}"
    except ValueError:
        return value


def group_of(problems: list[dict]) -> str | None:
    names = " | ".join(p["name"].lower() for p in problems)
    return next((g for g, words in GROUPS if any(w in names for w in words)), None)


def spread(candidates: list[dict], wanted: int) -> list[dict]:
    """Take records in turn from every condition group, sex and age band so no one kind dominates."""
    cells: dict[tuple, list[dict]] = defaultdict(list)
    for r in candidates:
        band = "18-34" if r["age"] < 35 else "35-49" if r["age"] < 50 else "50-64" if r["age"] < 65 else "65+"
        cells[(r["group"], r["sex"], band)].append(r)
    order = sorted(cells)
    picked = []
    while len(picked) < wanted and any(cells.values()):
        for cell in order:
            if cells[cell] and len(picked) < wanted:
                picked.append(cells[cell].pop(0))
    return picked


def main(folder: str, out: str) -> None:
    by = lambda: defaultdict(list)
    conditions, medications, allergies, immunizations, encounters, procedures, careplans = by(), by(), by(), by(), by(), by(), by()
    latest: dict[str, dict[str, tuple[str, str]]] = defaultdict(dict)
    weights: dict[str, list[tuple[str, float]]] = defaultdict(list)
    vitals_on: dict[str, dict[str, dict[str, str]]] = defaultdict(lambda: defaultdict(dict))

    for r in rows(folder, "conditions"):
        conditions[r["PATIENT"]].append(r)
    for r in rows(folder, "medications"):
        medications[r["PATIENT"]].append(r)
    for r in rows(folder, "allergies"):
        allergies[r["PATIENT"]].append(r)
    for r in rows(folder, "immunizations"):
        immunizations[r["PATIENT"]].append(r)
    for r in rows(folder, "encounters"):
        encounters[r["PATIENT"]].append(r)
    for r in rows(folder, "procedures"):
        procedures[r["PATIENT"]].append(r)
    for r in rows(folder, "careplans"):
        careplans[r["PATIENT"]].append(r)
    for r in rows(folder, "observations"):
        name = r["DESCRIPTION"]
        if name == "Body Weight":
            weights[r["PATIENT"]].append((r["DATE"][:10], float(r["VALUE"])))
        if name in VITALS:
            vitals_on[r["PATIENT"]][r["DATE"][:10]][VITALS[name]] = r["VALUE"]
        if name in LABS or name in SURVEY:
            seen = latest[r["PATIENT"]].get(name)
            if not seen or r["DATE"] > seen[0]:
                latest[r["PATIENT"]][name] = (r["DATE"], r["VALUE"])

    last_day = max(e["START"][:10] for es in encounters.values() for e in es)
    today = date.fromisoformat(last_day)
    candidates = []
    for p in rows(folder, "patients"):
        pid = p["Id"]
        if p["DEATHDATE"]:
            continue
        born = date.fromisoformat(p["BIRTHDATE"])
        age = today.year - born.year - ((today.month, today.day) < (born.month, born.day))

        problems, social, past = [], [], []
        for c in sorted(conditions[pid], key=lambda c: c["START"]):
            name = clean(c["DESCRIPTION"])
            if name in NOT_PROBLEMS:
                continue
            disorder = c["DESCRIPTION"].endswith("(disorder)") or any(k in name.lower() for k in CLINICAL_FINDINGS)
            if c["STOP"]:
                if disorder and c["STOP"] >= f"{today.year - 5}":
                    past.append({"name": name, "from": c["START"][:7], "to": c["STOP"][:7]})
            elif disorder:
                problems.append({"name": name, "since": c["START"][:4]})
            else:
                social.append(name)
        group = group_of(problems)
        if not group:
            continue

        meds, seen_meds = [], set()
        for m in sorted(medications[pid], key=lambda m: m["START"], reverse=True):
            if m["STOP"] or m["DESCRIPTION"] in seen_meds:
                continue
            seen_meds.add(m["DESCRIPTION"])
            meds.append({"name": m["DESCRIPTION"], "started": m["START"][:7], "reason": clean(m["REASONDESCRIPTION"])})

        allergy = [
            {"substance": clean(a["DESCRIPTION"]), "reaction": clean(a["DESCRIPTION1"]), "severity": a["SEVERITY1"].lower()}
            for a in allergies[pid]
            if not a["STOP"] and clean(a["DESCRIPTION"]) != "Allergic disposition"
        ]

        seen = latest[pid]
        # One set of vital signs, all from the most recent visit that measured blood pressure and
        # weight. Mixing in the latest-ever temperature or oxygen level would import an old illness.
        one_decimal = ("weight_kg", "height_cm", "bmi", "temperature_c")
        visit_days = sorted(d for d, v in vitals_on[pid].items() if "systolic" in v and "weight_kg" in v)
        vitals = {}
        if visit_days:
            vitals = {key: number(value, 1 if key in one_decimal else 0) for key, value in vitals_on[pid][visit_days[-1]].items()}
            vitals["recorded"] = visit_days[-1]
        # Weight change over roughly the last year, from Synthea's own weight history.
        history = sorted(weights[pid])
        if len(history) >= 2:
            now_day, now_kg = history[-1]
            earlier = [(d, kg) for d, kg in history[:-1] if d <= f"{int(now_day[:4]) - 1}{now_day[4:]}"]
            if earlier and abs(now_kg - earlier[-1][1]) >= 0.5:
                vitals["weight_change"] = f"{now_kg - earlier[-1][1]:+.1f} kg since {earlier[-1][0]}"
        labs: dict[str, dict] = {}
        for name, (label, units, reference) in LABS.items():
            if name in seen and (label not in labs or seen[name][0][:10] > labs[label]["date"]):
                labs[label] = {"test": label, "value": number(seen[name][1]), "units": units, "reference": reference, "date": seen[name][0][:10]}
        survey = {}
        for name, key in SURVEY.items():
            if name in seen and seen[name][1] != NO_ANSWER:
                value = clean(seen[name][1])
                survey[key] = number(value, 0) if key.endswith(("_score", "_usd", "household")) else value

        shots: dict[str, str] = {}
        for i in immunizations[pid]:
            name = re.sub(r"\s+", " ", i["DESCRIPTION"]).strip()
            shots[name] = max(shots.get(name, ""), i["DATE"][:10])
        visits = [
            {"date": e["START"][:10], "type": e["ENCOUNTERCLASS"], "what": clean(e["DESCRIPTION"]), "reason": clean(e["REASONDESCRIPTION"])}
            for e in sorted(encounters[pid], key=lambda e: e["START"], reverse=True)[:5]
        ]
        done, seen_proc = [], set()
        for pr in sorted(procedures[pid], key=lambda pr: pr["START"], reverse=True):
            name = clean(pr["DESCRIPTION"])
            if name in seen_proc or any(k in name.lower() for k in SKIP_PROCEDURES):
                continue
            seen_proc.add(name)
            done.append({"date": pr["START"][:10], "what": name, "reason": clean(pr["REASONDESCRIPTION"])})
            if len(done) == 6:
                break
        plans = sorted({clean(c["DESCRIPTION"]) for c in careplans[pid] if not c["STOP"]})

        if not labs or "weight_kg" not in vitals:
            continue
        strip = lambda s: re.sub(r"\d+", "", s).strip()
        candidates.append(
            {
                "id": pid[:8],
                "name": f"{strip(p['FIRST'])} {strip(p['LAST'])}",
                "age": age,
                "sex": {"M": "male", "F": "female"}.get(p["GENDER"], "unknown"),
                "race": p["RACE"],
                "ethnicity": p["ETHNICITY"],
                "marital": {"M": "married", "S": "single", "D": "divorced", "W": "widowed"}.get(p["MARITAL"], ""),
                "city": f"{p['CITY']}, {p['STATE']}",
                "group": group,
                "problems": problems,
                "past": past[-5:],
                "medications": meds[:14],
                "allergies": allergy[:6],
                "vitals": vitals,
                "labs": list(labs.values()),
                "smoking": survey.pop("smoking", ""),
                "survey": survey,
                "social": sorted(set(social))[:10],
                "immunizations": [{"vaccine": k, "date": v} for k, v in sorted(shots.items(), key=lambda kv: kv[1], reverse=True)[:6]],
                "encounters": visits,
                "procedures": done,
                "careplans": plans[:6],
            }
        )

    candidates.sort(key=lambda r: r["id"])
    records = sorted(spread(candidates, RECORDS), key=lambda r: r["id"])
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"source": "Synthea (synthetichealth/synthea), seed 2026, New Jersey, adults 18-85", "generated": last_day, "records": records}, f, ensure_ascii=False, indent=1)
    print(f"{len(records)} of {len(candidates)} eligible records written to {out}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
