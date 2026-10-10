"""Create private, unpublished CaseDraft suggestions from local source data.

No provider, network, API, approval, or publication operation is performed.
Run from the repository with `uv run python scripts/import_patients.py --source
<local JSON stream> [--csv <local CSV>]`. Output is restricted to .private.
"""

import argparse
import csv
import hashlib
import io
import json
import os
import sys
import tempfile
from collections import Counter, defaultdict
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pydantic import ValidationError

from backend.engine import validate_case
from backend.models import CaseDraft, Fact, Objective

ROOT = Path(__file__).resolve().parents[1]
MAX_SOURCE_BYTES = 5_000_000
MAX_RECORDS = 100
MAX_REPORT_ISSUES = 30
DISCLOSURES = {"initial_information", "discoverable_information", "reluctant_information", "hidden_information"}


def decode_profiles(text):
    def unique_pairs(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("Duplicate JSON field")
            result[key] = value
        return result

    def invalid_constant(_):
        raise ValueError("Invalid JSON numeric constant")

    decoder = json.JSONDecoder(object_pairs_hook=unique_pairs, parse_constant=invalid_constant)
    offset, profiles = 0, []
    while offset < len(text):
        while offset < len(text) and text[offset].isspace():
            offset += 1
        if offset == len(text):
            break
        value, offset = decoder.raw_decode(text, offset)
        if not isinstance(value, dict):
            raise ValueError("Each complete source record must be a JSON object")
        profiles.append(value)
        if len(profiles) > MAX_RECORDS:
            raise ValueError("Source record limit exceeded")
    if not profiles:
        raise ValueError("Source contains no patient profiles")
    return profiles


def _identity(name, age, sex):
    if not isinstance(name, str) or not isinstance(sex, str) or not name.strip() or not sex.strip():
        return None
    if isinstance(age, bool):
        return None
    try:
        age = int(age)
    except (TypeError, ValueError):
        return None
    return name.strip().casefold(), age, sex.strip().casefold()


def _profile_identity(profile):
    overview = profile.get("patient_overview", {})
    return _identity(overview.get("name"), overview.get("age"), overview.get("sex")) if isinstance(overview, dict) else None


def stable_matches(profiles, csv_text):
    """Attach a supplied ID only for a one-to-one exact normalized identity."""
    if csv_text is None:
        return {}, {"matched": 0, "unmatched": len(profiles), "csv_rows": 0, "ambiguous": 0}
    rows = list(csv.DictReader(io.StringIO(csv_text)))
    required = {"patient-uuid", "patient-name", "age", "gender"}
    if not rows or not required <= set(rows[0]):
        raise ValueError("CSV requires patient-uuid, patient-name, age, gender columns")
    if len(rows) > MAX_RECORDS:
        raise ValueError("CSV record limit exceeded")
    by_identity = defaultdict(list)
    id_counts = Counter(row["patient-uuid"].strip() for row in rows)
    profile_counts = Counter(_profile_identity(p) for p in profiles)
    for row in rows:
        key = _identity(row["patient-name"], row["age"], row["gender"])
        if key is not None:
            by_identity[key].append(row)
    matches, ambiguous = {}, 0
    for index, profile in enumerate(profiles, 1):
        key = _profile_identity(profile)
        candidates = by_identity.get(key, [])
        if key is not None and len(candidates) == 1 and profile_counts[key] == 1:
            supplied_id = candidates[0]["patient-uuid"].strip()
            if supplied_id and id_counts[supplied_id] == 1:
                matches[index] = supplied_id
                continue
        if candidates:
            ambiguous += 1
    return matches, {"matched": len(matches), "unmatched": len(profiles) - len(matches), "csv_rows": len(rows), "ambiguous": ambiguous}


def _source_facts(profile, source_hash, csv_hash, record_index):
    facts = []
    for section_number, (section, value) in enumerate(profile.items(), 1):
        fields = value.items() if isinstance(value, dict) else [("value", value)]
        for field_number, (field, value) in enumerate(fields, 1):
            serialized = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
            chunks = [serialized[i:i + 1200] for i in range(0, len(serialized), 1200)]
            category = field if section == "information_disclosure" and field in DISCLOSURES else "not_specified"
            faculty_reference = section in {"metadata", "learning_opportunities"}
            for part, chunk in enumerate(chunks, 1):
                path = section + "." + field
                label = ("Faculty reference; remove/move before publish: " if faculty_reference else "Source: ") + path
                label = label[:130] + (f" [{part}/{len(chunks)}]" if len(chunks) > 1 else "")
                source = f"UNREVIEWED source_sha256={source_hash}; record={record_index}; path={path}; part={part}/{len(chunks)}; disclosure={category}"
                if csv_hash:
                    source += f"; csv_sha256={csv_hash}"
                if len(source) > 400:
                    raise ValueError("Source field path exceeds provenance limit")
                facts.append(Fact(id=f"src_{section_number}_{field_number}_{part}", label=label, text=chunk,
                                  state="unknown" if value is None else "known", audience="chart", initially_released=False,
                                  keywords=[], requires=[], patient_answer=None, source=source))
    return facts


def build_drafts(profiles, source_hash, csv_text=None, csv_hash=None):
    matches, match_report = stable_matches(profiles, csv_text)
    drafts, issues = [], []
    for index, profile in enumerate(profiles, 1):
        try:
            overview = profile.get("patient_overview", {})
            if not isinstance(overview, dict) or not isinstance(overview.get("age"), int) or isinstance(overview.get("age"), bool):
                raise ValueError("Source patient overview requires an integer age")
            name = overview.get("name")
            if not isinstance(name, str):
                raise ValueError("Source patient overview requires a name")
            facts = _source_facts(profile, source_hash, csv_hash, index)
            objectives = []
            learning = profile.get("learning_opportunities", {})
            opportunities = learning.get("opportunities", []) if isinstance(learning, dict) else []
            if not isinstance(opportunities, list):
                raise ValueError("Learning opportunities must be a list")
            for number, item in enumerate(opportunities, 1):
                if not isinstance(item, dict) or not isinstance(item.get("learning_objective"), str) or not item["learning_objective"].strip():
                    continue
                label = item["learning_objective"]
                objectives.append(Objective(id=f"source_objective_{number}", label=label[:160], keywords=[], required_fact_ids=[],
                                            opportunity_fact_ids=[], guidance="Unreviewed source learning objective: " + label[:900],
                                            next_question="[Faculty must author an appropriate next question.]"))
            metadata = profile.get("metadata", {})
            assumptions = metadata.get("assumptions", []) if isinstance(metadata, dict) else []
            note = (f"UNREVIEWED. No approval, patient speech or reveal rules inferred. Runtime behavior defaults are placeholders. "
                    f"source_sha256={source_hash}; csv_sha256={csv_hash or 'not_supplied'}; "
                    f"unconfirmed_assumptions={json.dumps(assumptions, ensure_ascii=False, separators=(',', ':'))}")
            if len(note) > 1000:
                note = note[:910] + " [Full assumptions retained in metadata.assumptions source facts; review all parts.]"
            case = CaseDraft(title="Unreviewed synthetic nutrition draft: " + name, patient_name=name, age=overview["age"],
                             setting="Nutrition encounter (source context; unreviewed)" if "nutrition_profile" in profile else "Source context unspecified; faculty must set",
                             summary="Unreviewed synthetic teaching draft. Source values and disclosure categories require faculty review before publication.",
                             opening="[Faculty must author the patient's opening before publication.]", facts=facts, objectives=objectives,
                             author_note=note)
            report = validate_case(case)
            drafts.append({"import_id": hashlib.sha256(f"{source_hash}:{index}".encode()).hexdigest()[:24], "source_record": index,
                           "source_patient_id": matches.get(index), "source_sha256": source_hash, "csv_sha256": csv_hash,
                           "published": False, "review_status": "unreviewed", "case": case.model_dump(),
                           "review": {"structurally_publishable": report["valid"], "missing_reveal_rules": len(facts),
                                      "source_assumption_count": len(assumptions) if isinstance(assumptions, list) else 1,
                                      "faculty_reference_fact_ids": [f.id for f in facts if f.label.startswith("Faculty reference")],
                                      "actions": ["Review every source value and assumption; remove/correct unverified details.",
                                                  "Move/remove faculty-reference metadata and learning-opportunity facts before publication.",
                                                  "Author patient speech, opening, reveal rules, behavior and observable objective criteria.",
                                                  "Review the public summary and context; do not infer an ED case."]}})
        except ValidationError as exc:
            issues.append({"source_record": index, "error": "CaseDraft bounds or types need faculty correction",
                           "fields": [{"location": list(e["loc"]), "type": e["type"]} for e in exc.errors(include_input=False, include_context=False, include_url=False)[:5]]})
        except (ValueError, TypeError) as exc:
            # Our fixed messages contain no source values; do not print arbitrary errors.
            issues.append({"source_record": index, "error": "Source shape or provenance needs correction"})
    return {"drafts": drafts, "review_report": {"source_records": len(profiles), "drafts_created": len(drafts),
                                               "unpublished": True, "source_sha256": source_hash, "csv_sha256": csv_hash,
                                               "identity_matching": match_report, "rejected_records": len(issues),
                                               "issues": issues[:MAX_REPORT_ISSUES], "issues_truncated": len(issues) > MAX_REPORT_ISSUES,
                                               "notice": "Private draft suggestions only. No clinical validity, speech, reveal logic or approval established."}}


def _private_write(path, content, private_root):
    path, private_root = Path(path).resolve(), Path(private_root).resolve()
    if not path.is_relative_to(private_root):
        raise ValueError("Output must remain in the private directory")
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix=".patient-import-")
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb") as stream:
            stream.write(content)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def import_file(source, csv_source=None, output=None, private_root=None):
    private_root = Path(private_root or ROOT / ".private").resolve()
    output = Path(output or private_root / "imported-patient-drafts.json")
    if not output.resolve().is_relative_to(private_root):
        raise ValueError("Output must remain in the private directory")
    source = Path(source)
    if source.stat().st_size > MAX_SOURCE_BYTES:
        raise ValueError("Source file exceeds importer size limit")
    raw = source.read_bytes()
    source_hash = hashlib.sha256(raw).hexdigest()
    profiles = decode_profiles(raw.decode("utf-8-sig"))
    csv_raw, csv_hash = None, None
    if csv_source:
        csv_source = Path(csv_source)
        if csv_source.stat().st_size > MAX_SOURCE_BYTES:
            raise ValueError("CSV exceeds importer size limit")
        csv_raw = csv_source.read_bytes()
        csv_hash = hashlib.sha256(csv_raw).hexdigest()
    result = build_drafts(profiles, source_hash, csv_raw.decode("utf-8-sig") if csv_raw is not None else None, csv_hash)
    raw_dir = private_root / "patient-import" / "raw"
    _private_write(raw_dir / f"patients-{source_hash}.jsondata", raw, private_root)
    if csv_raw is not None:
        _private_write(raw_dir / f"faculty-{csv_hash}.csv", csv_raw, private_root)
    _private_write(output, (json.dumps(result, ensure_ascii=False, indent=2) + "\n").encode(), private_root)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True)
    parser.add_argument("--csv")
    parser.add_argument("--output", default=str(ROOT / ".private" / "imported-patient-drafts.json"))
    args = parser.parse_args()
    try:
        result = import_file(args.source, args.csv, args.output)
    except (OSError, ValueError, UnicodeError, RecursionError):
        parser.exit(1, "Import failed: check local input format, bounds and private output path. No patient values printed.\n")
    print(json.dumps(result["review_report"], ensure_ascii=True, indent=2))
    if result["review_report"]["rejected_records"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
