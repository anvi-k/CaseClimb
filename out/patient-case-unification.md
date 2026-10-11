# Patient case unification — October 10, 2026

The main screen now lists patient cases. The separate practice-chat launcher and profile selection flow have been removed. New standalone chat requests return HTTP 410 without reserving session quota; preexisting conversation snapshots remain readable.

Patient Studio offers a clinical history starter and communication starters for Alex, Maya, Jordan, and Evelyn. Starters load editable drafts, preserve unsaved edits unless replacement is confirmed, and do not automatically save, review, publish, or launch. Communication drafts contain authored patient facts and three observable learning objectives. Unauthored medical details stay explicitly unknown. All published cases use the normal student code, versioned encounter, chart, transcript, and formative feedback workflow. Spoken controls are initialized for all cases and require microphone consent.

Verification: 184 backend tests and 64 frontend tests passed. After the final template mood and encounter-label adjustments, 12 relevant backend tests and 10 relevant frontend tests passed again. `git diff --check` passed. A real in-app browser verified template selection, draft creation, patient case library, student code entry, keyboard question submission, chart disclosure, and case feedback. Mobile template scrolling and absence of horizontal overflow were checked; browser error logs were empty.

Browser QA used a separate localhost service and temporary synthetic data. A local automated publication fixture was used to test the student flow; it is not actual faculty approval or production publication. Provider keys were unset, so physical microphone and live provider playback were not exercised. At implementation closeout, no deployment, commit, or push had been performed.

Screenshots: `screenshots/patient-case-templates.png` and `screenshots/patient-case-templates-mobile.png`.

Push preparation: the patient-case changes were staged independently of ongoing streaming and presentation work. A checkout of the exact staged tree passed 147 backend tests and 47 frontend tests. The staged diff passed whitespace and secret-pattern checks.

Integration verification: after a concurrent streaming commit reached `origin/main`, the patient-case commit was replayed on that version in an isolated checkout. UI and documentation conflicts were resolved to retain streaming and use the unified patient-case flow. Streaming API fixtures now launch reviewed communication cases. The combined tree passed 187 backend tests and 67 frontend tests.
