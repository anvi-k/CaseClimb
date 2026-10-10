import Link from "next/link";
import { notFound } from "next/navigation";
import AppShell from "@/components/AppShell";
import { BarList } from "@/components/courses/charts";
import { DeleteAssignment, ReleaseFeedback } from "@/components/courses/CourseTools";
import When from "@/components/courses/When";
import { Badge, Card, CardHeader, LinkButton, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { get } from "@/lib/db";
import { assignmentFor, describeSettings, feedbackUrl, gradebook, TYPE_LABEL } from "@/lib/courses";

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-900">{value}</div>
      {note && <div className="mt-1 text-xs text-slate-500">{note}</div>}
    </div>
  );
}

export default async function AssignmentPage({ params }: { params: Promise<{ id: string; aid: string }> }) {
  const user = await requireUser("faculty");
  const { id, aid } = await params;
  const found = assignmentFor(user, aid);
  if (!found || found.course.id !== id) notFound();
  const { a, course } = found;
  const g = gradebook(a);
  const { insights } = g;
  const journey = a.journey_id ? get<{ title: string }>("SELECT title FROM journeys WHERE id = ?", a.journey_id) : null;
  const enrolledRows = g.rows.filter((r) => r.enrolled);
  const students = new Set(enrolledRows.map((r) => r.userId)).size;
  const studentsDone = new Set(enrolledRows.filter((r) => r.attempts.length).map((r) => r.userId)).size;
  const bests = g.rows.map((r) => r.best).filter((x): x is number => x !== null);
  const avg = bests.length ? Math.round(bests.reduce((s, x) => s + x, 0) / bests.length) : null;
  const held = !a.feedback_released;
  const started = g.rows.some((r) => r.attempts.length || r.inProgress);
  const multiCase = new Set(g.rows.map((r) => r.caseId)).size > 1;

  return (
    <AppShell user={user}>
      <div className="mb-2 text-xs text-slate-500">
        <Link href="/faculty/courses" className="hover:text-brand-700">
          Courses
        </Link>{" "}
        /{" "}
        <Link href={`/faculty/courses/${course.id}`} className="hover:text-brand-700">
          {course.name}
        </Link>{" "}
        / {a.title}
      </div>
      <PageHeader
        title={a.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge tone={a.type === "exam" ? "violet" : a.type === "practice" ? "slate" : "blue"}>{TYPE_LABEL[a.type]}</Badge>
            {journey && <Badge tone="teal">Care journey: {journey.title}</Badge>}
            <span>{describeSettings(a.settings)}</span>
            <span>
              ·{" "}
              {a.due_at ? (
                <>
                  Due <When at={a.due_at} />
                </>
              ) : (
                "No due date"
              )}
            </span>
          </span>
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            {!started && <DeleteAssignment assignmentId={a.id} courseId={course.id} />}
            <LinkButton href={`/faculty/courses/${course.id}/assignments/${a.id}/edit`} variant="secondary" size="sm">
              Edit
            </LinkButton>
            <a href={`/api/assignments/${a.id}/csv`} download className="inline-flex items-center rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 hover:bg-slate-50">
              Export grades (CSV)
            </a>
            {(a.settings.feedbackRelease === "manual" || held) && <ReleaseFeedback assignmentId={a.id} released={!held} />}
          </div>
        }
      />

      {held && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          Feedback is held. Students can submit, but they cannot see scores or feedback until you press Release feedback.
        </div>
      )}
      {a.instructions && <p className="mb-4 max-w-3xl whitespace-pre-line text-sm text-slate-700">{a.instructions}</p>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Students submitted" value={`${studentsDone} of ${students}`} note={students === 0 ? "No students enrolled yet" : undefined} />
        <Stat label="Average best score" value={avg === null ? "–" : `${avg}%`} note={bests.length ? `Across ${bests.length} scored ${bests.length === 1 ? "submission" : "submissions"}` : "Nothing scored yet"} />
        <Stat label="Needs your review" value={String(g.needsReview)} note="Flagged by the rubric, no note yet" />
        <Stat label="Feedback" value={held ? "Held" : "Released"} note={a.settings.feedbackRelease === "manual" ? "Released by you" : "Shown as soon as a visit is scored"} />
      </div>

      <h2 className="mb-2 mt-6 text-sm font-semibold text-slate-900">What to reteach</h2>
      {insights.scored === 0 ? (
        <Card>
          <p className="px-4 py-6 text-sm text-slate-500">The class summary appears once the first visit has been scored. It shows which rubric domains are weakest and which findings students most often miss.</p>
        </Card>
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader title="Rubric domains, weakest first" subtitle={`Class average for each domain as a percentage of full marks, from each student's latest scored visit (${insights.scored} in total).`} />
            <div className="p-2">
              <BarList
                unit="Class average by rubric domain"
                items={insights.domains.map((d) => ({
                  key: d.key,
                  label: d.name,
                  sub: d.low ? `${d.low} of ${d.n} scored in the bottom half` : undefined,
                  value: d.avgPct,
                  display: `${d.avgPct}%`,
                  detail: `Average of ${d.n} scored visit${d.n === 1 ? "" : "s"}`,
                }))}
              />
            </div>
          </Card>
          <Card>
            <CardHeader title="Findings most often missed" subtitle="Critical and important findings the patient never disclosed, by share of scored students. Taken from the disclosure record, not from a model's judgement." />
            <div className="p-2">
              {insights.missed.length === 0 ? (
                <p className="px-2 py-4 text-sm text-slate-500">No critical or important finding was missed.</p>
              ) : (
                <BarList
                  unit="Share of students who missed each finding"
                  items={insights.missed.slice(0, 6).map((m) => ({
                    key: m.key,
                    label: m.chart,
                    sub: multiCase ? m.caseTitle : `Topic: ${m.topic}`,
                    tag: { text: m.importance === "critical" ? "Critical" : "Important", tone: m.importance === "critical" ? "red" : "amber" },
                    value: (m.count / m.of) * 100,
                    display: `${m.count} of ${m.of}`,
                    detail: `Missed by ${Math.round((m.count / m.of) * 100)}% of students scored on this patient`,
                  }))}
                />
              )}
              {insights.missed.length > 6 && <p className="px-2 pb-1 pt-2 text-xs text-slate-500">{insights.missed.length - 6} more findings were missed by fewer students.</p>}
            </div>
            {insights.actionsMissed.length > 0 && (
              <div className="border-t border-slate-100 p-2">
                <div className="px-2 pb-1 pt-2 text-xs font-medium text-slate-600">Exams and orders most often skipped</div>
                <BarList
                  unit="Share of students who skipped each exam or order"
                  items={insights.actionsMissed.slice(0, 4).map((m) => ({
                    key: m.key,
                    label: m.name,
                    sub: multiCase ? m.caseTitle : undefined,
                    tag: { text: m.importance === "critical" ? "Critical" : "Important", tone: m.importance === "critical" ? "red" : "amber" },
                    value: (m.count / m.of) * 100,
                    display: `${m.count} of ${m.of}`,
                  }))}
                />
              </div>
            )}
          </Card>
        </div>
      )}

      <h2 className="mb-2 mt-6 text-sm font-semibold text-slate-900">Gradebook</h2>
      <Card>
        {g.rows.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate-500">No students are enrolled in this course yet. Share the join code from the course page.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left align-bottom text-xs text-slate-500">
                  <th className="px-4 py-2 font-medium">Student</th>
                  {multiCase && <th className="px-3 py-2 font-medium">Patient</th>}
                  <th className="px-3 py-2 font-medium">Attempts</th>
                  <th className="px-3 py-2 text-right font-medium">Best</th>
                  <th className="px-3 py-2 text-right font-medium">Latest</th>
                  {g.domainCols.map((d) => (
                    <th key={d.key} className="min-w-[6.5rem] px-2 py-2 text-right font-medium leading-tight">
                      {d.name}
                    </th>
                  ))}
                  <th className="px-3 py-2 font-medium">Review</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {g.rows.map((r) => {
                  const last = r.attempts[r.attempts.length - 1];
                  const reasons = [...new Set(r.attempts.flatMap((x) => x.reviewReasons))];
                  return (
                    <tr key={r.userId + r.caseId} className="align-top">
                      <td className="px-4 py-2.5">
                        <div className="whitespace-nowrap font-medium text-slate-900">{r.student}</div>
                        {!r.enrolled && <div className="text-xs text-slate-500">Not on the roster</div>}
                      </td>
                      {multiCase && <td className="max-w-[14rem] px-3 py-2.5 text-xs text-slate-600">{r.caseTitle}</td>}
                      <td className="px-3 py-2.5">
                        {r.attempts.length === 0 && r.inProgress === 0 && <span className="text-xs text-slate-400">Not started</span>}
                        <div className="flex flex-wrap gap-1">
                          {r.attempts.map((x, i) => (
                            <Link
                              key={x.id}
                              href={feedbackUrl(x.id)}
                              title={`Attempt ${i + 1}: level ${x.level}${x.variation ? `, patient variation: ${x.variation}` : ""}${x.facultyScore !== null ? `, adjusted from ${Math.round(x.score ?? 0)}%` : ""}. Open feedback.`}
                              className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-xs tabular-nums text-slate-700 hover:border-brand-500 hover:text-brand-700"
                            >
                              <span className="text-slate-400">{i + 1}</span>
                              {x.final === null ? "scoring" : `${Math.round(x.final)}%`}
                              {x.facultyScore !== null && <span className="text-slate-400">adj.</span>}
                            </Link>
                          ))}
                          {r.inProgress > 0 && <Badge tone="blue">In progress</Badge>}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right font-medium tabular-nums text-slate-900">{r.best === null ? <span className="font-normal text-slate-400">–</span> : `${Math.round(r.best)}%`}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{r.latest === null ? <span className="text-slate-400">–</span> : `${Math.round(r.latest)}%`}</td>
                      {g.domainCols.map((d) => {
                        const s = r.domains[d.key];
                        return (
                          <td key={d.key} className="px-2 py-2.5 text-right tabular-nums text-slate-700">
                            {!s ? <span className="text-slate-300">–</span> : s.score === null ? <span className="text-xs text-slate-400">N/A</span> : (
                              <>
                                {s.score}
                                <span className="text-slate-400">/{s.max}</span>
                              </>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-3 py-2.5">
                        {reasons.length > 0 ? (
                          <div className="space-y-1">
                            {r.needsReview ? <Badge tone="red">Needs review</Badge> : <Badge tone="green">Reviewed</Badge>}
                            <div className="max-w-[12rem] text-xs text-slate-500">{reasons.join("; ")}</div>
                          </div>
                        ) : last?.hasNote || last?.facultyScore != null ? (
                          <Badge tone="green">Reviewed</Badge>
                        ) : null}
                        {last && (
                          <Link href={feedbackUrl(last.id)} className="mt-1 block text-xs font-medium text-brand-700 hover:underline">
                            Open feedback
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
          Domain columns show the latest scored attempt. Scores are a percentage of rubric marks; when you set an adjusted score on a visit it replaces the rubric score here and in the export.
        </p>
      </Card>
    </AppShell>
  );
}
