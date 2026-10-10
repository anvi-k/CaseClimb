# Sample data

One patient, three students. All three episodes run against `patient_record.json` (Maria Alvarez, 58, type 2 diabetes, hides that she skips her metformin), so the only thing that varies is how the student behaves. These are hand-written, not recorded from the encounter engine.

| File | Student | What happens | Lie about metformin | Critical facts missed |
|---|---|---|---|---|
| `episode.json` (ep.0001) | Sam | Good open questions, but accepts the lie and talks past her fear | Accepted, refill history never opened | Family history, refill history, reason for skipped doses |
| `episode_strong.json` (ep.0002) | Priya | Checks the refill history, asks without judgment, responds to her fear, closes with a shared plan and an SBAR handoff | Uncovered | None |
| `episode_confrontational.json` (ep.0003) | Jordan | Finds the contradiction in the refill history, then confronts her; she gets defensive and stops volunteering | Challenged, never resolved | Sweet tea, reason for skipped doses |

Each patient turn has an `avatar` block with the emotion shown, and each episode has a `disclosures` log saying which fact was released on which turn and what triggered it. Fact ids match `clinical_facts` in the record.

`grader_response.json` is a saved grader output for ep.0001 only, used by the tests and by `--replay`.
