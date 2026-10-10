import Link from "next/link";
import AppShell from "@/components/AppShell";
import JoinCourse from "@/components/courses/JoinCourse";
import StartVisit from "@/components/courses/StartVisit";
import When from "@/components/courses/When";
import { Badge, Card, CardHeader, LinkButton, PageHeader } from "@/components/ui";
import { recommend } from "@/lib/adaptive";
import { requireUser } from "@/lib/auth";
import { all, parse } from "@/lib/db";
import { decodeEntities } from "@/lib/courses/save";
import { describeSettings, feedbackUrl, heldAssignmentIds, publishedCaseCards, studentAssignments, studentCaseLabels, toDate, TYPE_LABEL, visitUrl } from "@/lib/courses";
import { LEVEL_NAMES } from "@/lib/engine/difficulty";
import { profession } from "@/lib/professions";
import type { EncounterConfig, EncounterState } from "@/lib/types";

const MODE_LABEL: Record<string, string> = { practice: "Practice", adaptive: "Adaptive", homework: "Homework", exam: "Exam", journey: "Care journey" };

export default async function StudentHome() {
  const user = await requireUser();
  const role = profession(user.profession_id);
  const rec = recommend(user.id, role.id);
  const recCard = rec.caseId ? publishedCaseCards().find((c) => c.id === rec.caseId) : null;
  const assignments = studentAssignments(user.id);
  const courses = all<{ id: string; name: string }>("SELECT co.id, co.name FROM courses co JOIN enrollments en ON en.course_id = co.id WHERE en.user_id = ? ORDER BY co.name", user.id);
  const held = heldAssignmentIds();
  const now = Date.now();

  const active = all<{ id: string; case_id: string; config: string; state: string; status: string; started_at: string; assignment: string | null; journey_run_id: string | null }>(
    `SELECT e.id, e.case_id, e.config, e.state, e.status, e.started_at, a.title AS assignment, e.journey_run_id
     FROM encounters e JOIN cases c ON c.id = e.case_id LEFT JOIN assignments a ON a.id = e.assignment_id
     WHERE e.user_id = ? AND e.status IN ('active','paused') AND e.started_at > datetime('now','-14 days') ORDER BY e.started_at DESC LIMIT 6`,
    user.id,
  );
  const recent = all<{ id: string; case_id: string; config: string; score: number | null; faculty_score: number | null; ended_at: string | null; attempt: number; assignment_id: string | null; assignment: string | null; faculty_note: string | null }>(
    `SELECT e.id, e.case_id, e.config, e.score, e.faculty_score, e.ended_at, e.attempt, e.assignment_id, a.title AS assignment, e.faculty_note
     FROM encounters e JOIN cases c ON c.id = e.case_id LEFT JOIN assignments a ON a.id = e.assignment_id
     WHERE e.user_id = ? AND e.status = 'scored' ORDER BY e.ended_at DESC LIMIT 6`,
    user.id,
  );
  // Case titles are faculty-facing and name the diagnosis; students get a neutral label.
  const labels = studentCaseLabels([...active, ...recent].map((e) => e.case_id));
  const open = assignments.filter((x) => x.status !== "submitted");
  const doneAssignments = assignments.filter((x) => x.status === "submitted");

  return (
    <AppShell user={user}>
      <PageHeader title={`Welcome, ${user.name.split(" ")[0]}`} subtitle={`You are practising as ${role.name}.`} action={<LinkButton href="/student/practice" variant="secondary">Browse all patients</LinkButton>} />

      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-5">
          {/* ---------- Adaptive session ---------- */}
          <Card className="border-brand-200">
            <CardHeader title="Adaptive session" subtitle="The next patient and difficulty are chosen from your results so far. No language model is involved in the choice." />
            <div className="grid gap-4 p-4 sm:grid-cols-[auto_1fr_auto] sm:items-center">
              <div className="rounded-lg bg-brand-50 px-4 py-3 text-center">
                <div className="text-xs text-slate-600">Level chosen for you</div>
                <div className="text-3xl font-semibold text-brand-700">{rec.level}</div>
                <div className="text-xs font-medium text-slate-700">{LEVEL_NAMES[rec.level]}</div>
              </div>
              <div className="min-w-0">
                <p className="text-sm text-slate-800">{rec.reason}</p>
                {recCard ? (
                  <p className="mt-2 text-sm text-slate-600">
                    <span className="text-slate-500">Patient picked: </span>
                    <span className="font-medium text-slate-900">{recCard.label}</span>
                    {recCard.aiDraft && (
                      <Badge tone="amber" className="ml-1.5">
                        AI draft, not faculty-reviewed
                      </Badge>
                    )}
                  </p>
                ) : (
                  <p className="mt-2 text-sm text-slate-600">
                    There are no published patients for {role.name} yet, so there is nothing to recommend. You can still practise with patients written for other roles in the{" "}
                    <Link href="/student/practice" className="font-medium text-brand-700 underline">
                      practice library
                    </Link>
                    .
                  </p>
                )}
              </div>
              {rec.caseId && <StartVisit size="lg" label="Start adaptive visit" body={{ caseId: rec.caseId, mode: "adaptive", level: rec.level, knobs: rec.knobs, perturb: true }} />}
            </div>
            <div className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
              {rec.profile.sessions > 0 ? `Based on ${rec.profile.sessions} scored visit${rec.profile.sessions === 1 ? "" : "s"}. ` : ""}
              <Link href="/student/progress" className="font-medium text-brand-700 hover:underline">
                See your skill ratings and how the level is chosen
              </Link>
            </div>
          </Card>

          {/* ---------- Assignments ---------- */}
          <Card>
            <CardHeader title="Assignments" subtitle={assignments.length ? `${open.length} to do, ${doneAssignments.length} submitted` : undefined} />
            {assignments.length === 0 ? (
              <p className="px-4 py-6 text-sm text-slate-500">{courses.length ? "Your instructor has not set any assignments yet." : "Join a course with the code from your instructor to see your assignments here."}</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {[...open, ...doneAssignments].map(({ a, course, cases, status, feedbackVisible, journeyTitle }) => {
                  const pastDue = a.due_at && toDate(a.due_at).getTime() < now && status !== "submitted";
                  const max = a.settings.maxAttempts;
                  return (
                    <li key={a.id} className="px-4 py-3.5">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-slate-900">{a.title}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                            <Badge tone={a.type === "exam" ? "violet" : a.type === "practice" ? "slate" : "blue"}>{TYPE_LABEL[a.type]}</Badge>
                            <span>{course}</span>
                            {a.due_at && (
                              <span>
                                · Due <When at={a.due_at} />
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {pastDue && <Badge tone="red">Past due</Badge>}
                          <Badge tone={status === "submitted" ? "green" : status === "in_progress" ? "amber" : "slate"}>{status === "submitted" ? "Submitted" : status === "in_progress" ? "In progress" : "Not started"}</Badge>
                        </div>
                      </div>
                      {a.instructions && <p className="mt-2 whitespace-pre-line text-sm text-slate-700">{a.instructions}</p>}
                      <p className="mt-1.5 text-xs text-slate-500">
                        {describeSettings(a.settings)}
                        {a.settings.liveAssist && ". Your instructor can watch these visits live and may pause to help"}
                        {!feedbackVisible && ". Feedback is released by your instructor"}
                      </p>
                      {a.journey_id ? (
                        <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2">
                          <div className="text-sm text-slate-800">
                            <span className="text-slate-500">Care journey: </span>
                            {journeyTitle}
                          </div>
                          <LinkButton href={`/student/journeys/${a.journey_id}?assignment=${a.id}`} size="sm">
                            {status === "not_started" ? "Open journey" : "Continue journey"}
                          </LinkButton>
                        </div>
                      ) : (
                        <ul className="mt-3 space-y-2">
                          {cases.map((c) => {
                            const left = max ? Math.max(0, max - c.attemptsUsed) : null;
                            return (
                              <li key={c.card.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2">
                                <div className="min-w-0 flex-1">
                                  <div className="text-sm text-slate-900">
                                    <span className="font-medium">{c.card.label}</span>
                                  </div>
                                  <div className="mt-0.5 text-xs text-slate-500">
                                    {max ? `${c.attemptsUsed} of ${max} attempt${max === 1 ? "" : "s"} used` : `${c.attemptsUsed} attempt${c.attemptsUsed === 1 ? "" : "s"} so far`}
                                    {c.best !== null && (
                                      <>
                                        {" "}
                                        · best <span className="font-semibold text-slate-800">{Math.round(c.best)}%</span>
                                      </>
                                    )}
                                    {c.scoredCount > 0 && !feedbackVisible && " · submitted, feedback not released yet"}
                                    {c.card.aiDraft && " · AI draft, not faculty-reviewed"}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  {c.lastId && feedbackVisible && (
                                    <LinkButton href={feedbackUrl(c.lastId)} variant="ghost" size="sm">
                                      Feedback
                                    </LinkButton>
                                  )}
                                  {c.activeId ? (
                                    <LinkButton href={visitUrl(c.activeId)} size="sm">
                                      Resume visit
                                    </LinkButton>
                                  ) : left === 0 ? (
                                    <span className="text-xs text-slate-500">No attempts left</span>
                                  ) : (
                                    <StartVisit size="sm" variant={c.scoredCount ? "secondary" : "primary"} label={c.scoredCount ? "Try again" : "Start visit"} body={{ caseId: c.card.id, assignmentId: a.id }} />
                                  )}
                                </div>
                              </li>
                            );
                          })}
                          {cases.length === 0 && <li className="text-xs text-slate-500">The patients for this assignment are not available right now.</li>}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          {active.length > 0 && (
            <Card>
              <CardHeader title="Visits in progress" subtitle="Pick up where you left off." />
              <ul className="divide-y divide-slate-100">
                {active.map((e) => {
                  const cfg = parse<Partial<EncounterConfig>>(e.config, {});
                  const st = parse<Partial<EncounterState>>(e.state, {});
                  return (
                    <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-slate-900">{labels.get(e.case_id) || "Visit"}</div>
                        <div className="text-xs text-slate-500">
                          {(e.assignment && decodeEntities(e.assignment)) || MODE_LABEL[cfg.mode || "practice"]} · turn {st.turn ?? 0} · started <When at={e.started_at} />
                          {e.status === "paused" && " · paused by your instructor"}
                        </div>
                      </div>
                      <LinkButton href={visitUrl(e.id)} size="sm" variant="secondary">
                        Resume
                      </LinkButton>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}

          <Card>
            <CardHeader title="Recent results" action={<LinkButton href="/student/progress" variant="ghost" size="sm">Progress</LinkButton>} />
            {recent.length === 0 ? (
              <p className="px-4 py-6 text-sm text-slate-500">Finish a visit to see your score and feedback here.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {recent.map((e) => {
                  const cfg = parse<Partial<EncounterConfig>>(e.config, {});
                  const hidden = !!e.assignment_id && held.has(e.assignment_id);
                  const body = (
                    <>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-slate-900">{labels.get(e.case_id) || "Visit"}</div>
                        <div className="text-xs text-slate-500">
                          {(e.assignment && decodeEntities(e.assignment)) || MODE_LABEL[cfg.mode || "practice"]} · attempt {e.attempt} · level {cfg.knobs?.level ?? "?"} · <When at={e.ended_at} />
                          {!hidden && e.faculty_note && " · instructor note"}
                        </div>
                      </div>
                      {hidden ? <span className="shrink-0 text-xs text-slate-500">Feedback held</span> : <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">{Math.round(e.faculty_score ?? e.score ?? 0)}%</span>}
                    </>
                  );
                  return (
                    <li key={e.id}>
                      {hidden ? (
                        <div className="flex items-center justify-between gap-3 px-4 py-2.5">{body}</div>
                      ) : (
                        <Link href={feedbackUrl(e.id)} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-slate-50">
                          {body}
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Your courses" subtitle="Enter the join code your instructor gave you." />
            <div className="p-4">
              <JoinCourse />
              {courses.length > 0 && (
                <ul className="mt-3 space-y-1 text-sm text-slate-800">
                  {courses.map((c) => (
                    <li key={c.id} className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
                      {c.name}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
