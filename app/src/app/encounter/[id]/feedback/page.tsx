import Link from "next/link";
import { notFound } from "next/navigation";
import AppShell from "@/components/AppShell";
import FacultyReview from "@/components/courses/FacultyReview";
import When from "@/components/courses/When";
import { Badge, Card, CardHeader, LinkButton } from "@/components/ui";
import { FinishScoring, RetryButtons } from "@/components/visit/FeedbackActions";
import { isFaculty, requireUser } from "@/lib/auth";
import { get, parse } from "@/lib/db";
import { LEVEL_NAMES } from "@/lib/engine/difficulty";
import { loadEncounter, messagesOf } from "@/lib/engine/encounter";
import { canSeeEpisode } from "@/lib/episodes";
import { TrendChart } from "@/components/chart/ArtifactView";
import { attemptHistory } from "@/lib/engine/feedback";
import { timeline, timelineChart } from "@/lib/engine/timeline";
import { profession } from "@/lib/professions";
import type { Feedback } from "@/lib/types";

const TONE = { 4: "green", 3: "teal", 2: "amber", 1: "red" } as const;
const LABEL: Record<number, string> = { 4: "Strong", 3: "Competent", 2: "Developing", 1: "Unsafe or absent" };
const IMP = { critical: "red", important: "amber", minor: "slate" } as const;
const MET = { met: ["green", "Met"], partial: ["amber", "Partly met"], not_met: ["red", "Not met"] } as const;

function TurnLink({ turn }: { turn?: number }) {
  if (turn === undefined || turn === null) return null;
  return (
    <a href={`#t${turn}`} className="ml-1.5 whitespace-nowrap rounded bg-slate-100 px-1 text-[14px] font-medium tabular-nums text-slate-600 hover:bg-brand-100 hover:text-brand-700">
      T{turn}
    </a>
  );
}

function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const W = 220, H = 44;
  const x = (i: number) => 4 + (i * (W - 8)) / (values.length - 1);
  const y = (v: number) => H - 4 - (v / 100) * (H - 8);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-11 w-56" role="img" aria-label={`Patient comfort from ${values[0]} to ${values[values.length - 1]}`}>
      <line x1={4} x2={W - 4} y1={y(50)} y2={y(50)} stroke="#e2e8f0" strokeDasharray="3 3" />
      <polyline points={values.map((v, i) => `${x(i)},${y(v)}`).join(" ")} fill="none" stroke="#2a78d6" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r={3.5} fill="#2a78d6" stroke="#fff" strokeWidth={2} />
    </svg>
  );
}

export default async function FeedbackPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const enc = loadEncounter(id);
  if (!enc) notFound();
  const faculty = isFaculty(user);
  // Owner, a teammate on a class-shared patient, or faculty for recorded visits. Private practice stays private.
  if (enc.row.user_id !== user.id && !canSeeEpisode(user, id)) notFound();
  const { row, c, cfg, state } = enc;
  const own = row.user_id === user.id;
  const role = profession(cfg.professionId);
  const f = parse<Feedback | null>(row.feedback, null);
  const msgs = messagesOf(id);
  const wrap = parse<Record<string, string>>(row.wrapup, {});
  const student = get<{ name: string }>("SELECT name FROM users WHERE id = ?", row.user_id);
  const assignment = row.assignment_id ? get<{ title: string; type: string; feedback_released: number }>("SELECT title, type, feedback_released FROM assignments WHERE id = ?", row.assignment_id) : undefined;
  const withheld = !!assignment && !assignment.feedback_released && !faculty;
  // Columns added by the courses area; absent on a database that predates them.
  let review: { faculty_note: string | null; faculty_score: number | null } = { faculty_note: null, faculty_score: null };
  try {
    review = get("SELECT faculty_note, faculty_score FROM encounters WHERE id = ?", id) || review;
  } catch {}
  const history = attemptHistory(row.user_id, row.case_id);
  const idx = history.findIndex((h) => h.id === id);
  const prev = idx > 0 ? history[idx - 1] : null;
  const prevElicited = new Set(prev?.elicitedIds || []);

  const header = (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div>
        <div className="mb-1 flex flex-wrap items-center gap-1.5">
          <Badge tone="teal">{assignment ? assignment.title : cfg.mode === "adaptive" ? "Adaptive practice" : "Practice"}</Badge>
          <Badge>Level {cfg.knobs.level} · {LEVEL_NAMES[cfg.knobs.level]}</Badge>
          <Badge>Attempt {row.attempt}</Badge>
          {(cfg.visitNumber || 1) > 1 && <Badge tone="blue">Follow-up · visit {cfg.visitNumber}</Badge>}
          <Badge tone={row.assignment_id || row.journey_run_id ? "violet" : "slate"}>{row.assignment_id || row.journey_run_id ? "Recorded for instructor" : "Private practice"}</Badge>
          {cfg.perturbation && <Badge tone="violet">Patient variation: {cfg.perturbation.label}</Badge>}
          {row.parent_id && <Badge tone="blue">Rewound branch</Badge>}
        </div>
        <h1 className="text-xl font-semibold text-slate-900">
          Visit with {c.patient.name}
          {!own && student ? ` · ${student.name}` : ""}
        </h1>
        <p className="mt-0.5 text-sm text-slate-600">
          {role.name} · {state.turn} turns · <When at={row.ended_at} />
        </p>
      </div>
      <LinkButton href={faculty && !own ? "/faculty/courses" : "/student"} variant="secondary">
        Back
      </LinkButton>
    </div>
  );

  if (!f || withheld) {
    return (
      <AppShell user={user}>
        {header}
        <Card className="p-6">
          {withheld ? (
            <>
              <h2 className="font-semibold text-slate-900">Submitted</h2>
              <p className="mt-1 text-sm text-slate-600">Your instructor will release feedback for “{assignment!.title}” after the assessment closes.</p>
            </>
          ) : (
            <>
              <h2 className="font-semibold text-slate-900">This visit has not been scored yet</h2>
              <p className="mb-3 mt-1 text-sm text-slate-600">{row.status === "active" || row.status === "paused" ? "The visit is still in progress." : "Scoring did not finish. Your transcript and write-up are saved."}</p>
              {row.status === "submitted" ? <FinishScoring id={id} /> : own ? <LinkButton href={`/encounter/${id}`}>Return to the visit</LinkButton> : null}
            </>
          )}
        </Card>
      </AppShell>
    );
  }

  const tl = timeline(c, cfg, msgs);
  const critMissed = f.missed.filter((m) => m.importance === "critical");
  const meta = (m: (typeof msgs)[number]) => parse<{ revealed?: string[]; deflected?: string[]; rapportDelta?: number; questionType?: string }>(m.meta, {});
  const factText = (fid: string) => c.facts.find((x) => x.id === fid);

  return (
    <AppShell user={user}>
      {header}

      {f.needsReview && (
        <div className="mb-4 rounded-2xl border border-rose-300 bg-rose-50 px-6 py-5 text-rose-900">
          <p className="text-lg font-bold">Flagged for instructor review</p>
          <p className="mt-0.5 text-sm">An instructor should look at this visit whatever the total score.</p>
          <ul className="mt-3 divide-y divide-rose-200 border-t border-rose-200 text-sm">
            {f.reviewReasons.map((r, i) => {
              // "Domain 6 (Clinical reasoning and synthesis) scored 1." is shown as number, name and score.
              const d = /^Domain (\d+) \((.+)\) scored (\d+)\.?$/.exec(r.trim());
              return (
                <li key={i} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                  {d ? (
                    <>
                      <span>
                        <span className="font-semibold">Domain {d[1]}</span> · {d[2]}
                      </span>
                      <span className="rounded-full bg-rose-200 px-3 py-0.5 font-semibold">Scored {d[3]} of 4</span>
                    </>
                  ) : (
                    <span>{r.trim().replace(/\.$/, "")}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {review.faculty_note && (
        <div className="mb-4 rounded-lg border border-violet-300 bg-violet-50 px-4 py-3 text-sm text-violet-900">
          <span className="font-semibold">From your instructor{review.faculty_score !== null ? ` (adjusted score ${Math.round(review.faculty_score)}%)` : ""}:</span> {review.faculty_note}
        </div>
      )}
      {faculty && !own && (
        <div className="mb-4">
          <FacultyReview encounterId={id} note={review.faculty_note} score={review.faculty_score} />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{f.rubricType === "domain4" ? "Rubric total" : "Points"}</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-4xl font-semibold tabular-nums text-slate-900">{f.total}</span>
            <span className="text-lg text-slate-500">/ {f.max}</span>
            {prev && (
              <span className={`ml-auto text-sm font-medium ${f.percent >= prev.percent ? "text-emerald-700" : "text-rose-700"}`}>
                {f.percent >= prev.percent ? "+" : ""}
                {f.percent - prev.percent} pts vs attempt {prev.attempt}
              </span>
            )}
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-brand-500" style={{ width: `${f.percent}%` }} />
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {f.percent}%{f.domains.some((d) => d.score === null) ? `, ${f.domains.filter((d) => d.score === null).length} domain(s) not applicable` : ""}. A discussion aid, not a pass or fail grade.
          </p>
        </Card>
        <Card className="p-5 lg:col-span-2">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Summary</div>
          <p className="mt-1 text-sm leading-relaxed text-slate-800">{f.summary}</p>
          <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-600">
            <span>
              <span className="font-semibold text-slate-900">{f.elicited.length}</span> of {f.elicited.length + f.missed.length} findings elicited
            </span>
            <span>
              <span className={`font-semibold ${critMissed.length ? "text-rose-700" : "text-slate-900"}`}>{critMissed.length}</span> critical missed
            </span>
            <span>
              Questions: {state.stats.open} open · {state.stats.focused} focused · {state.stats.closed} closed · {state.stats.leading + state.stats.multiple} leading/stacked
            </span>
            {state.hintsUsed > 0 && <span>{state.hintsUsed} coach hint{state.hintsUsed === 1 ? "" : "s"} used</span>}
            <span className="flex items-center gap-2">
              Patient comfort {state.rapportHistory[0]} → {state.rapport}
              <Spark values={state.rapportHistory} />
            </span>
          </div>
        </Card>
      </div>

      {own && assignment?.type !== "exam" && (
        <Card className="mt-4">
          <CardHeader title="For your next attempt" subtitle="Start over to practice the same visit again (optionally with the patient in a different mood), or book a follow-up where the patient remembers you and this conversation." />
          <div className="p-4">
            <ol className="mb-4 list-decimal space-y-1.5 pl-5 text-sm text-slate-800">
              {f.nextAttempt.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ol>
            {cfg.mode !== "exam" && cfg.mode !== "journey" && <RetryButtons caseId={row.case_id} level={cfg.knobs.level} assignmentId={row.assignment_id} allowVariation />}
          </div>
        </Card>
      )}

      {tl.length > 1 && (
        <Card className="mt-4">
          <CardHeader title="The visit, turn by turn" subtitle="Calculated live from each turn as it happened: findings covered against a steady pace, how you communicated, and how comfortable the patient was. Hover to read a turn; the turn numbers match the transcript below." />
          <div className="grid gap-4 p-4 lg:grid-cols-[1fr_18rem]">
            <TrendChart chart={timelineChart(tl)} />
            <ul className="max-h-64 space-y-1 overflow-y-auto text-[15px] text-slate-700">
              {tl.map((p) => (
                <li key={p.turn} className="flex gap-2">
                  <a href={`#t${p.turn}`} className="w-7 shrink-0 rounded bg-slate-100 text-center text-[14px] font-medium leading-5 text-slate-600 hover:bg-brand-100">T{p.turn}</a>
                  <span className="w-8 shrink-0 tabular-nums font-medium text-slate-900">{Math.round(p.score * 100)}</span>
                  <span className="text-slate-600">{p.note || "no notable signals"}</span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      )}

      {history.length > 1 && (
        <Card className="mt-4">
          <CardHeader title="What changed across your attempts" subtitle="Same patient, same answer key. Variation changes the patient's mood, not the facts." />
          <div className="overflow-x-auto p-4">
            <table className="w-full border-collapse text-left text-[16px]">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500">
                  <th className="py-1.5 pr-3 font-medium">Domain</th>
                  {history.map((h) => (
                    <th key={h.id} className={`px-2 py-1.5 font-medium ${h.id === id ? "text-slate-900" : ""}`}>
                      <Link href={`/encounter/${h.id}/feedback`} className="hover:underline">
                        Attempt {h.attempt}
                      </Link>
                      <div className="font-normal">L{h.level}{h.variation ? ` · ${h.variation}` : ""}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {f.domains.map((d) => (
                  <tr key={d.key} className="border-b border-slate-100">
                    <td className="py-1.5 pr-3 text-slate-800">{d.name}</td>
                    {history.map((h, i) => {
                      const s = h.domains.find((x) => x.key === d.key)?.score ?? null;
                      const before = i > 0 ? history[i - 1].domains.find((x) => x.key === d.key)?.score ?? null : null;
                      const delta = s !== null && before !== null ? s - before : 0;
                      return (
                        <td key={h.id} className={`px-2 py-1.5 tabular-nums ${h.id === id ? "bg-slate-50 font-semibold" : ""}`}>
                          {s === null ? "N/A" : s}
                          {delta !== 0 && <span className={`ml-1 text-[14px] ${delta > 0 ? "text-emerald-700" : "text-rose-700"}`}>{delta > 0 ? "▲" : "▼"}{Math.abs(delta)}</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className="py-1.5 pr-3">Overall</td>
                  {history.map((h) => (
                    <td key={h.id} className={`px-2 py-1.5 tabular-nums ${h.id === id ? "bg-slate-50" : ""}`}>{h.percent}%</td>
                  ))}
                </tr>
                <tr className="text-slate-600">
                  <td className="py-1.5 pr-3">Critical findings missed</td>
                  {history.map((h) => (
                    <td key={h.id} className={`px-2 py-1.5 tabular-nums ${h.id === id ? "bg-slate-50" : ""}`}>{h.missedCritical}</td>
                  ))}
                </tr>
              </tbody>
            </table>
            {prev && (
              <p className="mt-3 text-[16px] text-slate-700">
                <span className="font-medium">New this time:</span> {f.elicited.filter((e) => !prevElicited.has(e.id)).map((e) => e.chart).join("; ") || "nothing you had not already found"}.
                {f.missed.some((m) => prevElicited.has(m.id)) && (
                  <>
                    {" "}
                    <span className="font-medium">Found last time but not this time:</span> {f.missed.filter((m) => prevElicited.has(m.id)).map((m) => m.topic).join("; ")}.
                  </>
                )}
              </p>
            )}
          </div>
        </Card>
      )}

      <Card className="mt-4">
        <CardHeader title={f.rubricType === "domain4" ? "Rubric, with the evidence for each score" : "Checklist, with the evidence for each item"} subtitle="Every score points at the turn it came from. Select a turn to jump to it in the transcript." />
        <div className="divide-y divide-slate-100">
          {f.domains.map((d) => (
            <div key={d.key} className="grid gap-3 p-4 md:grid-cols-[14rem_1fr]">
              <div>
                <div className="text-sm font-medium text-slate-900">{d.name}</div>
                <div className="mt-1">
                  {d.score === null ? <Badge>Not applicable</Badge> : f.rubricType === "domain4" ? <Badge tone={TONE[d.score as 1 | 2 | 3 | 4]}>{d.score} · {LABEL[d.score]}</Badge> : <Badge tone={d.score >= d.max * 0.8 ? "green" : d.score >= d.max * 0.5 ? "amber" : "red"}>{d.score} / {d.max}</Badge>}
                </div>
              </div>
              <div className="text-[16px]">
                <p className="text-slate-800">{d.rationale}</p>
                {d.evidence.length > 0 && (
                  <ul className="mt-2 space-y-1.5">
                    {d.evidence.map((e, i) => (
                      <li key={i} className="border-l-2 border-slate-200 pl-2.5">
                        {e.quote && <span className="italic text-slate-600">“{e.quote}”</span>}
                        <TurnLink turn={e.turn} />
                        <div className="text-slate-700">{e.note}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={`Findings you elicited (${f.elicited.length})`} subtitle="From the disclosure record, not from a model's impression." />
          <ul className="space-y-1 p-4 text-[16px]">
            {f.elicited.length === 0 && <li className="text-slate-500">None.</li>}
            {f.elicited.map((e) => (
              <li key={e.id} className="flex items-start gap-2">
                <Badge tone={IMP[e.importance]} className="mt-0.5 shrink-0">{e.importance}</Badge>
                <span className="text-slate-800">
                  {e.chart}
                  <TurnLink turn={e.turn} />
                  {prev && !prevElicited.has(e.id) && <Badge tone="green" className="ml-1.5">new</Badge>}
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title={`Findings you missed (${f.missed.length})`} subtitle="Most important first." />
          <ul className="space-y-1 p-4 text-[16px]">
            {f.missed.length === 0 && <li className="text-slate-500">Nothing missed.</li>}
            {f.missed.map((m) => (
              <li key={m.id} className="flex items-start gap-2">
                <Badge tone={IMP[m.importance]} className="mt-0.5 shrink-0">{m.importance}</Badge>
                <span className="text-slate-800">
                  <span className="font-medium">{m.topic}:</span> {m.chart}
                  {state.deflected[m.id] ? <span className="ml-1 text-amber-700">(you asked; the patient was not ready to say)</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {!!f.mismatches?.length && (
        <Card className="mt-4">
          <CardHeader title="What the patient said versus what the chart showed" subtitle="Built into the case to test whether you cross-check the record." />
          <ul className="divide-y divide-slate-100">
            {f.mismatches.map((m) => (
              <li key={m.id} className="p-4 text-[16px]">
                <Badge tone={m.noticed ? "green" : "red"}>{m.noticed ? "You caught this" : "Not picked up"}</Badge>
                <p className="mt-1.5 text-slate-800">
                  <span className="font-medium">Patient:</span> {m.patientClaim} <span className="font-medium">Chart:</span> {m.recordEvidence}
                </p>
                {m.comment && <p className="mt-1 text-slate-600">{m.comment}</p>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Learning objectives" subtitle="Set by the faculty author of this case." />
          <ul className="divide-y divide-slate-100">
            {f.objectives.map((o) => (
              <li key={o.id} className="p-4 text-[16px]">
                <div className="flex items-start gap-2">
                  <Badge tone={MET[o.met][0]} className="mt-0.5 shrink-0">{MET[o.met][1]}</Badge>
                  <span className="font-medium text-slate-900">{o.text}</span>
                </div>
                {o.comment && <p className="mt-1 text-slate-700">{o.comment}</p>}
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Exams, tests and records" />
          <div className="space-y-3 p-4 text-[16px]">
            <div>
              <div className="mb-1 text-xs font-medium text-slate-500">Requested</div>
              {f.actionsDone.length ? f.actionsDone.map((a) => <Badge key={a.id} tone="teal" className="mb-1 mr-1">{a.name}</Badge>) : <span className="text-slate-500">None.</span>}
            </div>
            <div>
              <div className="mb-1 text-xs font-medium text-slate-500">Would have helped</div>
              {f.actionsMissed.length ? f.actionsMissed.map((a) => <Badge key={a.id} tone={IMP[a.importance]} className="mb-1 mr-1">{a.name}</Badge>) : <span className="text-slate-500">Nothing important left out.</span>}
            </div>
            {f.unnecessaryOrders.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-medium text-slate-500">Requested but not part of this case</div>
                {f.unnecessaryOrders.map((u, i) => <Badge key={i} className="mb-1 mr-1">{u}</Badge>)}
              </div>
            )}
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="What went well" />
          <ul className="space-y-2 p-4 text-[16px] text-slate-800">
            {f.strengths.map((s, i) => (
              <li key={i}>{s.text}<TurnLink turn={s.turn} /></li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title="What to work on" />
          <ul className="space-y-2 p-4 text-[16px] text-slate-800">
            {f.improvements.map((s, i) => (
              <li key={i}>{s.text}<TurnLink turn={s.turn} /></li>
            ))}
          </ul>
        </Card>
      </div>

      {f.debrief && (f.debrief.questions.length > 0 || f.debrief.underProbing.length > 0) && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Questions to think through" subtitle="Before reading on, answer these for yourself. Each points at a moment in your visit." />
            <ol className="list-decimal space-y-2 p-4 pl-8 text-[16px] text-slate-800">
              {f.debrief.questions.map((q, i) => (
                <li key={i}>{q.question}<TurnLink turn={q.turn} /></li>
              ))}
            </ol>
          </Card>
          <Card>
            <CardHeader title="What you did not ask about" subtitle="Topics that were never raised, or were raised too lightly to get an answer." />
            <ul className="space-y-2 p-4 text-[16px] text-slate-800">
              {f.debrief.underProbing.map((u, i) => (
                <li key={i}><span className="font-medium">{u.topic}.</span> {u.whyItMattered}</li>
              ))}
              {f.debrief.underProbing.length === 0 && <li className="text-slate-500">Nothing stood out.</li>}
            </ul>
          </Card>
        </div>
      )}

      {(f.safetyConcerns.length > 0 || f.accuracyIssues.length > 0) && (
        <Card className="mt-4 border-rose-200">
          <CardHeader title="Safety and accuracy" subtitle="Checked against the case answer key and the faculty's knowledge sources only." />
          <ul className="space-y-2 p-4 text-[16px] text-slate-800">
            {f.safetyConcerns.map((s, i) => (
              <li key={"s" + i}><Badge tone="red" className="mr-1.5">Safety</Badge>{s.text}<TurnLink turn={s.turn} /></li>
            ))}
            {f.accuracyIssues.map((a, i) => (
              <li key={"a" + i}><Badge tone="amber" className="mr-1.5">Accuracy</Badge>You said: “{a.claim}”. {a.correction}<TurnLink turn={a.turn} /></li>
            ))}
          </ul>
        </Card>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="How the interview was built" />
          <dl className="space-y-3 p-4 text-[16px]">
            {([["Structure", f.interview.structure], ["Sequencing", f.interview.sequencing], ["Question mix", f.interview.questionMix]] as const).map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs font-medium text-slate-500">{k}</dt>
                <dd className="text-slate-800">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <Card>
          <CardHeader title={`Your ${role.noteFormat} write-up`} />
          <div className="space-y-3 p-4 text-[16px]">
            <p className="text-slate-800">{f.wrapUpReview}</p>
            {role.wrapUp.map((w) => (
              <div key={w.id}>
                <div className="text-xs font-medium text-slate-500">{w.label}</div>
                <div className="whitespace-pre-wrap rounded bg-slate-50 px-2.5 py-1.5 text-slate-700">{wrap[w.id] || "Left blank"}</div>
              </div>
            ))}
            <details className="rounded border border-slate-200 px-3 py-2">
              <summary className="cursor-pointer text-xs font-medium text-slate-600">Show the case answer key</summary>
              <div className="mt-2 space-y-1.5 text-slate-700">
                <p><span className="font-medium">Primary problem:</span> {c.answerKey.primaryProblem}</p>
                {c.answerKey.differential.length > 0 && <p><span className="font-medium">Differential:</span> {c.answerKey.differential.join("; ")}</p>}
                <p><span className="font-medium">Plan:</span> {c.answerKey.plan.join("; ")}</p>
                {c.answerKey.redFlags.length > 0 && <p><span className="font-medium">Red flags:</span> {c.answerKey.redFlags.join("; ")}</p>}
              </div>
            </details>
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="Transcript" subtitle="Annotated with what each question unlocked and how the patient's comfort moved." />
        <div className="space-y-2 p-4">
          {msgs.map((m) => {
            const x = meta(m);
            if (m.speaker === "student")
              return (
                <div key={m.id} id={`t${m.turn}`} className="flex scroll-mt-20 gap-2 target:rounded target:bg-amber-50">
                  <span className="mt-1 w-8 shrink-0 text-right text-[14px] tabular-nums text-slate-400">T{m.turn}</span>
                  <div className="text-sm"><span className="font-medium text-brand-700">{own ? "You" : "Student"}:</span> <span className="text-slate-900">{m.text}</span></div>
                </div>
              );
            if (m.speaker === "patient")
              return (
                <div key={m.id} className="flex gap-2">
                  <span className="w-8 shrink-0" />
                  <div className="text-sm">
                    <span className="font-medium text-slate-700">{c.patient.name.split(" ")[0]}:</span> <span className="text-slate-800">{m.text}</span>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[14px]">
                      {x.questionType && !["other", "greeting"].includes(x.questionType) && <span className="rounded bg-slate-100 px-1 text-slate-600">{({ open: "open question", focused: "focused question", closed: "closed question", leading: "leading question", multiple: "stacked questions", statement: "statement" } as Record<string, string>)[x.questionType] || x.questionType}</span>}
                      {!!x.rapportDelta && <span className={`rounded px-1 ${x.rapportDelta > 0 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>comfort {x.rapportDelta > 0 ? "+" : ""}{x.rapportDelta}</span>}
                      {(x.revealed || []).map((fid) => <span key={fid} className="rounded bg-brand-50 px-1 text-brand-700">unlocked: {factText(fid)?.topic}</span>)}
                      {(x.deflected || []).map((fid) => <span key={fid} className="rounded bg-amber-50 px-1 text-amber-800">deflected: {factText(fid)?.topic}</span>)}
                    </div>
                  </div>
                </div>
              );
            return (
              <div key={m.id} className="flex gap-2">
                <span className="w-8 shrink-0" />
                <div className={`whitespace-pre-wrap rounded px-2 py-1 text-[15px] ${m.speaker === "coach" ? "bg-amber-50 text-amber-900" : m.speaker === "instructor" ? "bg-violet-50 text-violet-900" : "bg-slate-50 font-mono text-slate-600"}`}>
                  <span className="mr-1 font-sans text-[14px] font-semibold uppercase">{m.speaker === "system" ? "Chart" : m.speaker}</span>
                  {m.text}
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </AppShell>
  );
}
