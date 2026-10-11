import { apiUser, isFaculty } from "../auth";
import type { User } from "../types";
import { loadRun, type LoadedRun } from "./store";

/** Loads a run the caller may act on: its owner, or (when allowed) any faculty member. */
export async function runFor(runId: string, opts: { faculty?: boolean } = {}): Promise<{ user: User; run: LoadedRun } | Response> {
  const user = await apiUser();
  if (user instanceof Response) return user;
  const run = loadRun(runId);
  if (!run) return Response.json({ error: "Journey run not found" }, { status: 404 });
  if (run.row.user_id !== user.id && !(opts.faculty && isFaculty(user))) return Response.json({ error: "Not allowed" }, { status: 403 });
  return { user, run };
}
