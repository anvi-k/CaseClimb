# Poscere web app

This folder is the Poscere app itself: a Next.js 16 and React 19 app with a SQLite database. What
Poscere is, how to install and run it, and how visits are scored are described in the
[main README](../README.md).

## Run

From this folder, after `npm install` and creating `.env.local` from `.env.example`:

```bash
npm run build && npm run start
```

Open http://localhost:3000. The demo instructor and student accounts are listed on the sign-in
page. After changing code, stop the server and run the command again.

## Where things are

| Path | What it is |
|---|---|
| `src/app/student/` | The student's patient list and the practice page |
| `src/app/faculty/` | The instructor's class page, patient list, patient summary and student page |
| `src/app/encounter/` | The visit screen and the feedback page |
| `src/components/visit/` | The visit: patient panel, chart, session goals |
| `src/components/studio/` | Patient list, patient summary, new patient, the full editor |
| `src/lib/engine/` | The patient engine: disclosure, temperament, scoring hand-off |
| `src/lib/engine/evaluator.ts` | Sends a finished visit to the Python grader in `../evaluator` |
| `src/lib/synthea*.ts`, `src/lib/markers*.ts` | Writing record values from data into a patient |
| `data/seed/cases/` | The 44 patients loaded on first start |
| `data/synthea/` | The Synthea records and the profiles written from them |
| `public/portraits/` | Patient portraits |
| `scripts/` | Building Synthea patients and their portraits |

## Older documents

The files in [`docs/`](docs/) were written for an earlier, larger version of this app, with many
learner roles, care journeys across several professionals, and a detailed patient editor. Most of
that code is still here but is no longer offered from the main screens, so read those documents as
background and not as a description of the current app.
