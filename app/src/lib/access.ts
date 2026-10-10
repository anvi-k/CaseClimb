import { apiUser, isFaculty } from "./auth";
import { loadEncounter, type Loaded } from "./engine/encounter";
import type { User } from "./types";

/** Loads an encounter the caller may act on: its owner, or (when allowed) any faculty member. */
export async function encounterFor(id: string, opts: { faculty?: "also" | "only" } = {}): Promise<{ user: User; enc: Loaded } | Response> {
  const user = await apiUser();
  if (user instanceof Response) return user;
  const enc = loadEncounter(id);
  if (!enc) return Response.json({ error: "Visit not found" }, { status: 404 });
  const owner = enc.row.user_id === user.id;
  // Faculty reach other people's visits only when the visit is recorded (assignment or care journey).
  // Self-started practice is labelled private to the student and stays that way.
  const fac = isFaculty(user) && (owner || !!enc.row.assignment_id || !!enc.row.journey_run_id);
  if (opts.faculty === "only" ? !fac : !(owner || (opts.faculty === "also" && fac))) return Response.json({ error: "Not allowed" }, { status: 403 });
  return { user, enc };
}
