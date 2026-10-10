import hashlib
import json
import stat

import pytest

from backend.models import CaseDraft
from scripts.import_patients import build_drafts, decode_profiles, import_file, stable_matches


def profile(name="Synthetic Alpha", age=40, sex="female"):
    # Independently authored minimal fixture; no supplied patient values.
    return {"patient_overview": {"name": name, "age": age, "sex": sex, "description": "Synthetic source description."},
            "clinical_profile": {"laboratory_data": ["No source measurement supplied."], "medical_history": ["Fictional source-only detail."]},
            "nutrition_profile": {"dietary_pattern": "Synthetic nutrition context."},
            "information_disclosure": {"initial_information": ["A source-labeled initial detail."], "discoverable_information": ["A source-labeled discoverable detail."],
                                      "reluctant_information": ["A source-labeled reluctant detail."], "hidden_information": ["A source-labeled hidden detail."]},
            "learning_opportunities": {"opportunities": [{"learning_objective": "Ask about an authored concern", "expected_discoveries": ["Source-only discovery"], "possible_patient_reactions": ["Source-only reaction"]}]},
            "metadata": {"assumptions": ["An unconfirmed source assumption."], "optional_details": ["A source-only optional detail."]}}


def csv_text(rows):
    return "patient-uuid,patient-name,age,gender\n" + "".join(",".join(map(str, row)) + "\n" for row in rows)


def recover_fields(case):
    fields = {}
    for fact in case["facts"]:
        path = fact["source"].split("; path=", 1)[1].split(";", 1)[0]
        fields.setdefault(path, []).append(fact["text"])
    return {path: json.loads("".join(parts)) for path, parts in fields.items()}


def test_concatenated_pretty_json_is_parsed_without_discarding_source_records():
    originals = [profile(), profile("Synthetic Beta", 50, "male")]
    stream = "\n".join(json.dumps(p, indent=2) for p in originals)
    assert decode_profiles(stream) == originals
    assert decode_profiles(json.dumps(originals[0])) == [originals[0]]


@pytest.mark.parametrize("text", ["", '{"a":1,"a":2}', '{"a":NaN}', '{}\nBROKEN', '[]', '42'])
def test_bad_or_partial_source_never_becomes_a_partial_success(text):
    with pytest.raises((ValueError, json.JSONDecodeError)):
        decode_profiles(text)


def test_drafts_preserve_every_source_field_and_categories_without_new_clinical_content():
    original = profile()
    original["clinical_profile"]["medical_history"] = ["Long source text " * 200]
    original["metadata"]["assumptions"] = ["Long unconfirmed assumption " * 100]
    result = build_drafts([original], "a" * 64)
    assert result["review_report"]["drafts_created"] == 1
    draft = result["drafts"][0]
    case = draft["case"]
    CaseDraft.model_validate(case)
    assert draft["published"] is False and draft["review_status"] == "unreviewed"
    assert draft["review"]["structurally_publishable"] is False
    assert "Nutrition" in case["setting"] and "Emergency" not in case["setting"]
    assert "UNREVIEWED" in case["author_note"] and "a" * 64 in case["author_note"]
    recovered = recover_fields(case)
    for section, values in original.items():
        for field, value in values.items():
            assert recovered[section + "." + field] == value
    assert all(f["audience"] == "chart" and f["patient_answer"] is None and not f["initially_released"] and f["keywords"] == [] for f in case["facts"])
    assert all(o["keywords"] == [] and o["required_fact_ids"] == [] and o["opportunity_fact_ids"] == [] for o in case["objectives"])
    assert all(len(f["text"]) <= 1200 and len(f["source"]) <= 400 for f in case["facts"])
    for category in ("initial_information", "discoverable_information", "reluctant_information", "hidden_information"):
        assert any("disclosure=" + category in f["source"] for f in case["facts"])
    assert draft["review"]["faculty_reference_fact_ids"]
    assert "approval" not in draft


def test_csv_ids_only_attach_to_unique_exact_identity_matches():
    profiles = [profile(), profile("Synthetic Beta", 50, "male")]
    text = csv_text([("id-alpha", " Synthetic Alpha ", 40, "Female"), ("id-beta", "Synthetic Beta", 51, "male")])
    matches, report = stable_matches(profiles, text)
    assert matches == {1: "id-alpha"}
    assert report["matched"] == 1 and report["unmatched"] == 1
    result = build_drafts(profiles, "a" * 64, text, "b" * 64)
    assert result["drafts"][0]["source_patient_id"] == "id-alpha"
    assert result["drafts"][1]["source_patient_id"] is None
    assert all("csv_sha256=" + "b" * 64 in f["source"] for f in result["drafts"][0]["case"]["facts"])


@pytest.mark.parametrize("profiles,rows", [
    ([profile()], [("a", "Synthetic Alpha", 40, "female"), ("b", "Synthetic Alpha", 40, "female")]),
    ([profile(), profile()], [("a", "Synthetic Alpha", 40, "female")]),
    ([profile(), profile("Synthetic Beta", 50, "male")], [("same", "Synthetic Alpha", 40, "female"), ("same", "Synthetic Beta", 50, "male")]),
])
def test_ambiguous_identity_or_reused_id_is_never_guessed(profiles, rows):
    matches, report = stable_matches(profiles, csv_text(rows))
    assert matches == {} and report["ambiguous"] >= 1


def test_private_output_and_raw_copies_have_hashes_and_restrictive_permissions(tmp_path):
    source = tmp_path / "source.jsonl"
    raw = json.dumps(profile(), indent=2).encode()
    source.write_bytes(raw)
    csv_source = tmp_path / "source.csv"
    csv_raw = csv_text([("id-alpha", "Synthetic Alpha", 40, "female")]).encode()
    csv_source.write_bytes(csv_raw)
    private = tmp_path / ".private"
    result = import_file(source, csv_source, private_root=private)
    output = private / "imported-patient-drafts.json"
    assert json.loads(output.read_text()) == result
    assert result["review_report"]["source_sha256"] == hashlib.sha256(raw).hexdigest()
    assert result["review_report"]["csv_sha256"] == hashlib.sha256(csv_raw).hexdigest()
    copies = list((private / "patient-import" / "raw").iterdir())
    assert {p.read_bytes() for p in copies} == {raw, csv_raw}
    assert all(stat.S_IMODE(p.stat().st_mode) == 0o600 for p in [output, *copies])
    assert source.read_bytes() == raw


def test_output_outside_private_or_through_external_symlink_is_rejected(tmp_path):
    source = tmp_path / "source.jsonl"
    source.write_text(json.dumps(profile()))
    private = tmp_path / ".private"
    outside = tmp_path / "public.json"
    with pytest.raises(ValueError):
        import_file(source, output=outside, private_root=private)
    assert not outside.exists()
    private.mkdir()
    (private / "linked.json").symlink_to(outside)
    with pytest.raises(ValueError):
        import_file(source, output=private / "linked.json", private_root=private)
    assert not outside.exists()


def test_invalid_identity_is_reported_without_echoing_patient_values():
    original = profile()
    original["patient_overview"]["name"] = "SENSITIVE-SOURCE-TEXT" * 20
    result = build_drafts([original], "a" * 64)
    assert result["drafts"] == [] and result["review_report"]["rejected_records"] == 1
    assert "SENSITIVE-SOURCE-TEXT" not in json.dumps(result["review_report"])
