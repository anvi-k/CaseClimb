# Sample data

One patient, three students. All three episodes run against `patient_record.json` (Maria Alvarez, 58, type 2 diabetes, hides that she skips her metformin), so the only thing that varies is how the student behaves. These are hand-written, not recorded from the encounter engine.

| File | Student | What happens | Lie about metformin | Critical facts missed |
|---|---|---|---|---|
| `episode.json` (ep.0001) | Sam | Good open questions, but accepts the lie and talks past her fear | Accepted, refill history never opened | Family history, refill history, reason for skipped doses |
| `episode_strong.json` (ep.0002) | Priya | Checks the refill history, asks without judgment, responds to her fear, closes with a shared plan and an SBAR handoff | Uncovered | None |
| `episode_confrontational.json` (ep.0003) | Jordan | Finds the contradiction in the refill history, then confronts her; she gets defensive and stops volunteering | Challenged, never resolved | Sweet tea, reason for skipped doses |

Each patient turn has an `avatar` block with the emotion shown, and each episode has a `disclosures` log saying which fact was released on which turn and what triggered it. Fact ids match `clinical_facts` in the record.

## Debrief results (for the UI)

`output/ep.000N.debrief_result.json` is what the debrief screen renders, one file per episode. The format is `schemas/debrief_result.schema.json`.

| File | Rubric | Teacher review | Lie |
|---|---|---|---|
| `output/ep.0001.debrief_result.json` | 15 / 28 | Yes (domain 6 scored 1) | `accepted_without_challenge` |
| `output/ep.0002.debrief_result.json` | 27 / 28 | No | `uncovered` |
| `output/ep.0003.debrief_result.json` | 14 / 28 | No | `challenged_unresolved` |

Reading one:

- `rubric.domains` always has all seven. `score` is 1 to 4, or `null` for N/A; show `label` in that case.
- `written_evidence` holds the strength, the important gap, and the safety or accuracy concern (check `present`).
- Every point has an `evidence` list. Each item gives `turn_id`, `turn_index`, `speaker`, and usually a `quote` that is guaranteed to appear in that turn. The list can be empty when the point is that something never happened.
- `transcript` is the whole conversation. `speaker` is `patient` or `learner`. `referenced_by` lists which sections cite that turn, for highlighting.
- `facts.missed` and `lies` say what the learner did not find; `debrief_questions` are the conversation openers.

The scores and feedback in these three files were written by hand, not by the model, so that the UI has realistic data before Bedrock is connected. The saved grader answers they are built from are `grader_response*.json`; the one for ep.0001 deliberately contains a misquote and a citation of a turn that does not exist, to exercise the checks. Regenerate with `python scripts/build_sample_outputs.py`.
