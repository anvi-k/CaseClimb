import { spawn } from "node:child_process";
import path from "node:path";
import { get, parse } from "../db";
import { profession } from "../professions";
import { getRubric } from "../rubrics";
import type { Feedback } from "../types";
import { loadEncounter, messagesOf } from "./encounter";

// Rubric scoring is done by the Python evaluator that lives beside this app
// (../evaluator, entry point evaluator/poscere.py). It reads one JSON bundle on
// standard input and prints `{ feedback, debrief_result }`.
const ROOT = process.env.EVALUATOR_ROOT || path.join(process.cwd(), "..");
const PYTHON = process.env.EVALUATOR_PYTHON || path.join(ROOT, ".venv", "bin", "python");
const TIMEOUT_MS = 10 * 60 * 1000;

/** Everything the evaluator needs about one visit, in the shapes this app already stores. */
export function visitBundle(encId: string) {
  const enc = loadEncounter(encId);
  if (!enc) throw new Error("Encounter not found");
  const { row, c, cfg, state } = enc;
  const who = get<{ name: string }>("SELECT name FROM users WHERE id = ?", row.user_id);
  return {
    encounter: { id: row.id, user_id: row.user_id, case_id: row.case_id, status: row.status, started_at: row.started_at, ended_at: row.ended_at },
    case: c,
    config: cfg,
    state,
    messages: messagesOf(encId).map((m) => ({ id: m.id, turn: m.turn, speaker: m.speaker, text: m.text, meta: m.meta, created_at: m.created_at })),
    write_up: parse<Record<string, string>>(row.wrapup, {}),
    student: { name: who?.name || "Student" },
    profession: profession(cfg.professionId),
    rubric: getRubric(c.rubricId),
  };
}

function runEvaluator(input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ["-m", "evaluator.poscere"];
    // Lets the app be exercised without Bedrock by replaying a saved grader response.
    if (process.env.EVALUATOR_REPLAY) args.push("--replay", process.env.EVALUATOR_REPLAY);
    const child = spawn(/*turbopackIgnore: true*/ PYTHON, args, {
      cwd: ROOT,
      env: { ...process.env, AWS_REGION: process.env.AWS_REGION || "us-west-2" },
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill(), TIMEOUT_MS);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`Could not start the evaluator (${PYTHON}): ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve(out);
      const reason = err.trim().split("\n").pop() || `exit code ${code}`;
      reject(new Error(`The evaluator could not score this visit: ${reason}`));
    });
    child.stdin.end(input);
  });
}

/** Scores a submitted visit with the Python evaluator and returns it as this app's Feedback. */
export async function gradeWithEvaluator(encId: string): Promise<Feedback> {
  const started = Date.now();
  const printed = await runEvaluator(JSON.stringify(visitBundle(encId)));
  console.log(`evaluator: scored ${encId} in ${Math.round((Date.now() - started) / 1000)}s`);
  const result = JSON.parse(printed) as { feedback: Feedback };
  if (!Array.isArray(result.feedback?.domains)) throw new Error("The evaluator returned no rubric scores. Your visit is saved; select Score this visit to try again.");
  return result.feedback;
}
