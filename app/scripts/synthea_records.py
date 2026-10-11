"""Turn Synthea's CSV export into the compact patient records the app reads.

Synthea (https://github.com/synthetichealth/synthea) builds synthetic patient
histories from published disease statistics and care guidelines, with no
language model involved. Generate the CSVs, then run this:

    java -jar synthea-with-dependencies.jar -s 2026 -cs 2026 -p 250 -a 18-85 \\
        --exporter.csv.export=true --exporter.fhir.export=false "New Jersey"
    python3 scripts/synthea_records.py <output/csv folder> data/synthea/records.json

Standard library only.
"""

import csv
import json
import re
import sys
from collections import defaultdict
from datetime import date

MAX_RECORDS = 120
SUFFIX = re.compile(r"\s*\((disorder|finding|situation|person|procedure|regime/therapy|morphologic abnormality)\)$")
NOT_PROBLEMS = {"Medication review due"}
# Findings that belong on a problem list although Synthea does not call them disorders.
CLINICAL_FINDINGS = ("prediabetes", "obesity", "chronic pain", "chronic low back pain", "chronic neck pain", "abnormal findings", "history of", "past pregnancy")
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
    "Body Weight": "weight_kg",
    "Body Height": "height_cm",
    "Body mass index (BMI) [Ratio]": "bmi",
}


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


def main(folder: str, out: str) -> None:
    by = lambda: defaultdict(list)
    conditions, medications, allergies, immunizations, encounters, procedures, careplans = by(), by(), by(), by(), by(), by(), by()
    latest: dict[str, dict[str, tuple[str, str]]] = defaultdict(dict)

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
        if name in LABS or name in VITALS or name == "Tobacco smoking status":
            seen = latest[r["PATIENT"]].get(name)
            if not seen or r["DATE"] > seen[0]:
                latest[r["PATIENT"]][name] = (r["DATE"], r["VALUE"])

    last_day = max(e["START"][:10] for es in encounters.values() for e in es)
    today = date.fromisoformat(last_day)
    records = []
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
            entry = {"name": name, "since": c["START"][:4]}
            if c["STOP"]:
                if disorder and c["STOP"] >= f"{today.year - 5}":
                    past.append({"name": name, "from": c["START"][:7], "to": c["STOP"][:7]})
            elif disorder:
                problems.append(entry)
            else:
                social.append(name)
        if not problems:
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
        vitals = {key: number(seen[name][1], 1 if key in ("weight_kg", "height_cm", "bmi") else 0) for name, key in VITALS.items() if name in seen}
        if "Systolic Blood Pressure" in seen:
            vitals["recorded"] = seen["Systolic Blood Pressure"][0][:10]
        labs: dict[str, dict] = {}
        for name, (label, units, reference) in LABS.items():
            if name in seen and (label not in labs or seen[name][0][:10] > labs[label]["date"]):
                labs[label] = {"test": label, "value": number(seen[name][1]), "units": units, "reference": reference, "date": seen[name][0][:10]}
        smoking = clean(seen["Tobacco smoking status"][1]) if "Tobacco smoking status" in seen else ""

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

        if not (meds or labs):
            continue
        strip = lambda s: re.sub(r"\d+", "", s).strip()
        records.append(
            {
                "id": pid[:8],
                "name": f"{strip(p['FIRST'])} {strip(p['LAST'])}",
                "age": age,
                "sex": {"M": "male", "F": "female"}.get(p["GENDER"], "unknown"),
                "race": p["RACE"],
                "ethnicity": p["ETHNICITY"],
                "marital": {"M": "married", "S": "single", "D": "divorced", "W": "widowed"}.get(p["MARITAL"], ""),
                "city": f"{p['CITY']}, {p['STATE']}",
                "problems": problems,
                "past": past[-5:],
                "medications": meds[:14],
                "allergies": allergy[:6],
                "vitals": vitals,
                "labs": list(labs.values()),
                "smoking": smoking,
                "social": sorted(set(social))[:10],
                "immunizations": [{"vaccine": k, "date": v} for k, v in sorted(shots.items(), key=lambda kv: kv[1], reverse=True)[:6]],
                "encounters": visits,
                "procedures": done,
                "careplans": plans[:6],
            }
        )

    records.sort(key=lambda r: r["id"])
    records = records[:MAX_RECORDS]
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"source": "Synthea (synthetichealth/synthea), seed 2026, New Jersey, adults 18-85", "generated": last_day, "records": records}, f, ensure_ascii=False, indent=1)
    print(f"{len(records)} records written to {out}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
