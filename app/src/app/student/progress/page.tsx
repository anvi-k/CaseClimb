import Link from "next/link";
import AppShell from "@/components/AppShell";
import { ScoreSpark, SkillDots } from "@/components/courses/charts";
import RatingHistory, { type HistorySeries } from "@/components/courses/RatingHistory";
import When from "@/components/courses/When";
import { Badge, Card, CardHeader, Empty, LinkButton, PageHeader } from "@/components/ui";
import { skillProfile } from "@/lib/adaptive";
import { requireUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { feedbackUrl, heldAssignmentIds, studentCaseLabels, toDate } from "@/lib/courses";
import { LEVEL_NAMES, LEVEL_RATING } from "@/lib/engine/difficulty";
import { attemptHistory } from "@/lib/engine/feedback";
import { profession, professions } from "@/lib/professions";
import { getRubric } from "@/lib/rubrics";

const START = 1200;
const LO = 900;
const HI = 1700;
const MODE_LABEL: Record<string, string> = { practice: "Practice", adaptive: "Adaptive", homework: "Homework", exam: "Exam", journey: "Care journey" };

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-900">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{note}</div>
    </div>
  );
}

export default async function ProgressPage({ searchParams }: { searchParams: Promise<{ profession?: string }> }) {
  const user = await requireUser();
  const asked = (await searchParams).profession;
  // Ratings are kept per role, so a student who practiced in another role can switch.
  const rated = all<{ profession_id: string }>("SELECT DISTINCT profession_id FROM skill_ratings WHERE user_id = ?", user.id).map((r) => r.profession_id);
  const own = profession(user.profession_id).id;
  const professionId = asked && (rated.includes(asked) || professions().some((p) => p.id === asked)) ? asked : own;
  const role = profession(professionId);
  const roleTabs = [...new Set([own, ...rated])];

  const profile = skillProfile(user.id, professionId);
  const names = new Map((getRubric("default").domains || []).map((d) => [d.key, d.name]));
  const nameOf = (k: string) => names.get(k) || k.replace(/_/g, " ");
  const order = [...names.keys()];
  const dots = profile.domains
    .map((d) => ({ key: d.domain, name: nameOf(d.domain), rating: d.rating, n: d.n }))
    .sort((a, b) => (order.indexOf(a.key) === -1 ? 99 : order.indexOf(a.key)) - (order.indexOf(b.key) === -1 ? 99 : order.indexOf(b.key)));
  const ticks = [1, 2, 3, 4, 5].map((level) => ({ level, rating: LEVEL_RATING[level] }));

  // ----- Rating history from the event log -----
  const events = all<{ encounter_id: string; domain: string; level: number; outcome: number; before: number; after: number; created_at: string; case_id: string | null }>(
    `SELECT s.encounter_id, s.domain, s.level, s.outcome, s.before, s.after, s.created_at, e.case_id
     FROM skill_events s LEFT JOIN encounters e ON e.id = s.encounter_id
     WHERE s.user_id = ? AND s.profession_id = ? ORDER BY s.id`,
    user.id,
    professionId,
  );
  // Students never see the faculty case title; it usually names the diagnosis.
  const labels = studentCaseLabels([...events.map((e) => e.case_id || ""), ...all<{ case_id: string }>("SELECT DISTINCT case_id FROM encounters WHERE user_id = ?", user.id).map((r) => r.case_id)]);
  const visits: { id: string; level: number; date: string; title: string; after: Map<string, number> }[] = [];
  for (const ev of events) {
    let v = visits[visits.length - 1];
    if (!v || v.id !== ev.encounter_id) visits.push((v = { id: ev.encounter_id, level: ev.level, date: ev.created_at, title: labels.get(ev.case_id || "") || "Visit", after: new Map() }));
    v.after.set(ev.domain, ev.after);
  }
  const day = (s: string) => toDate(s).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const series: HistorySeries[] = [];
  if (visits.length) {
    const current = new Map<string, number>();
    const overall: HistorySeries = { key: "__all", name: "All domains (average)", points: [{ label: "Start", value: START, lines: ["Everyone starts at 1200"] }] };
    const perDomain = new Map<string, HistorySeries>();
    visits.forEach((v, i) => {
      for (const [d, r] of v.after) {
        current.set(d, r);
        if (!perDomain.has(d)) perDomain.set(d, { key: d, name: nameOf(d), points: [{ label: "Start", value: START, lines: ["Everyone starts at 1200"] }] });
        perDomain.get(d)!.points.push({ label: `Visit ${i + 1}`, value: r, lines: [v.title, `Level ${v.level} · ${day(v.date)}`] });
      }
      const avg = [...current.values()].reduce((s, x) => s + x, 0) / current.size;
      overall.points.push({ label: `Visit ${i + 1}`, value: avg, lines: [v.title, `Level ${v.level} · ${day(v.date)}`] });
    });
    series.push(overall, ...[...perDomain.values()].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key)));
  }

  // ----- Attempts per patient -----
  const held = heldAssignmentIds();
  const mine = all<{ id: string; case_id: string; assignment_id: string | null; faculty_score: number | null }>(
    "SELECT e.id, e.case_id, e.assignment_id, e.faculty_score FROM encounters e WHERE e.user_id = ? AND e.status = 'scored' AND e.parent_id IS NULL ORDER BY e.started_at DESC",
    user.id,
  );
  const meta = new Map(mine.map((m) => [m.id, m]));
  const caseIds = [...new Set(mine.map((m) => m.case_id))];
  const perCase = caseIds
    .map((caseId) => {
      // Visits whose feedback an instructor is still holding are left out until it is released.
      const attempts = attemptHistory(user.id, caseId)
        .filter((a) => !held.has(meta.get(a.id)?.assignment_id || ""))
        .map((a) => ({ ...a, percent: meta.get(a.id)?.faculty_score ?? a.percent }));
      return { caseId, title: labels.get(caseId) || "Patient", attempts };
    })
    .filter((c) => c.attempts.length);
  const heldCount = mine.filter((m) => m.assignment_id && held.has(m.assignment_id)).length;
  const weakest = profile.weakest ? nameOf(profile.weakest) : null;

  return (
    <AppShell user={user}>
      <PageHeader title="Progress" subtitle={`Your skill ratings as ${role.name}, and how each patient has gone across attempts.`} action={<LinkButton href="/student">Start an adaptive visit</LinkButton>} />

      {roleTabs.length > 1 && (
        <div className="mb-4 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-slate-500">Ratings are kept per role:</span>
          {roleTabs.map((p) => (
            <Link key={p} href={`/student/progress?profession=${p}`} aria-current={p === professionId ? "page" : undefined} className={p === professionId ? "rounded-md bg-brand-600 px-2.5 py-1 font-medium text-white" : "rounded-md border border-slate-300 bg-white px-2.5 py-1 text-slate-700 hover:bg-slate-50"}>
              {profession(p).name}
            </Link>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Next adaptive level" value={`${profile.level} ${LEVEL_NAMES[profile.level]}`} note={profile.sessions ? `Expected score about ${Math.round(profile.expectedAtLevel * 100)}%` : "Starting level for new students"} />
        <Stat label="Overall rating" value={String(Math.round(profile.overall))} note={`Level ${profile.level} plays at ${LEVEL_RATING[profile.level]}`} />
        <Stat label="Scored visits" value={String(profile.sessions)} note="In this role, counted toward your ratings" />
        <Stat label="Weakest domain" value={weakest ? weakest.split(/[,(]| and /)[0] : "–"} note={weakest || "Shown after your first scored visit"} />
      </div>

      <Card className="mt-5">
        <div className="px-4 py-3 text-sm text-slate-700">
          <span className="font-semibold text-slate-900">How the adaptive level is chosen. </span>
          After every scored visit, your rating in each rubric domain moves up if you scored better than expected for that visit's level and down if you scored worse, with bigger moves while you have few visits. Your next adaptive session is set at the level where your expected score is closest to 70%, and the patient's behaviour is tuned to exercise your weakest domain.
        </div>
      </Card>

      {profile.domains.length === 0 ? (
        <div className="mt-5">
          <Empty>
            You have no scored visits as {role.name} yet. Finish a visit from <Link href="/student" className="font-medium text-brand-700 underline">Home</Link> or <Link href="/student/practice" className="font-medium text-brand-700 underline">Practice</Link> and your ratings will appear here.
          </Empty>
        </div>
      ) : (
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader title="Skill rating by rubric domain" subtitle="Each dot is your current rating. The vertical lines mark the rating each difficulty level plays at; a dot to the right of a line means you are expected to do well at that level." />
            <div className="p-4">
              <SkillDots items={dots} ticks={ticks} lo={LO} hi={HI} />
            </div>
          </Card>
          <Card>
            <CardHeader title="Rating over time" subtitle="Your rating after each scored visit, against the same level lines." />
            <div className="p-4">{series.length > 0 ? <RatingHistory series={series} ticks={ticks} lo={950} hi={1450} /> : <p className="text-sm text-slate-500">No history yet.</p>}</div>
          </Card>
        </div>
      )}

      <h2 className="mb-2 mt-6 text-sm font-semibold text-slate-900">Attempts by patient</h2>
      {heldCount > 0 && <p className="mb-2 text-xs text-slate-500">{heldCount} submitted visit{heldCount === 1 ? " is" : "s are"} not shown because your instructor has not released the feedback yet.</p>}
      {perCase.length === 0 ? (
        <Empty>Nothing scored yet. Each patient you practice with will appear here with every attempt and what changed between them.</Empty>
      ) : (
        <div className="space-y-4">
          {perCase.map((c) => {
            const scores = c.attempts.map((a) => a.percent);
            const best = Math.max(...scores);
            const change = scores.length > 1 ? Math.round(scores[scores.length - 1] - scores[0]) : null;
            return (
              <Card key={c.caseId}>
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 px-4 py-3">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-slate-900">{c.title}</h3>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {c.attempts.length} attempt{c.attempts.length === 1 ? "" : "s"} · best {Math.round(best)}%
                      {change !== null && ` · ${change > 0 ? "up" : change < 0 ? "down" : "no change"}${change ? ` ${Math.abs(change)} points` : ""} from first to latest`}
                    </p>
                  </div>
                  {scores.length > 1 && (
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] text-slate-500">Score by attempt, 0 to 100%</span>
                      <ScoreSpark scores={scores} labels={c.attempts.map((a, i) => `Attempt ${i + 1}: ${Math.round(a.percent)}% at level ${a.level}`)} />
                    </div>
                  )}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-slate-500">
                        <th className="px-4 py-2 font-medium">Attempt</th>
                        <th className="px-3 py-2 text-right font-medium">Score</th>
                        <th className="px-3 py-2 font-medium">Setup</th>
                        <th className="px-3 py-2 font-medium">What changed from the attempt before</th>
                        <th className="px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {c.attempts.map((a, i) => {
                        const prev = i > 0 ? c.attempts[i - 1] : null;
                        const delta = prev ? Math.round(a.percent - prev.percent) : null;
                        const gained = prev ? a.elicitedIds.filter((id) => !prev.elicitedIds.includes(id)).length : 0;
                        const lost = prev ? prev.elicitedIds.filter((id) => !a.elicitedIds.includes(id)).length : 0;
                        const up = prev ? a.domains.filter((d) => { const p = prev.domains.find((x) => x.key === d.key); return p && p.score !== null && d.score !== null && d.score > p.score; }) : [];
                        const down = prev ? a.domains.filter((d) => { const p = prev.domains.find((x) => x.key === d.key); return p && p.score !== null && d.score !== null && d.score < p.score; }) : [];
                        return (
                          <tr key={a.id} className="align-top">
                            <td className="whitespace-nowrap px-4 py-2.5 text-slate-800">
                              <div className="font-medium">Attempt {i + 1}</div>
                              <div className="text-xs text-slate-500">
                                <When at={a.date} time={false} />
                              </div>
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-right">
                              <div className="font-semibold tabular-nums text-slate-900">{Math.round(a.percent)}%</div>
                              {delta !== null && <div className="text-xs tabular-nums text-slate-600">{delta > 0 ? `+${delta}` : delta === 0 ? "no change" : `−${Math.abs(delta)}`}</div>}
                            </td>
                            <td className="px-3 py-2.5 text-xs text-slate-600">
                              <div className="flex flex-wrap items-center gap-1">
                                <Badge tone="teal">Level {a.level}</Badge>
                                <Badge>{MODE_LABEL[a.mode] || a.mode}</Badge>
                              </div>
                              {a.variation && <div className="mt-1">Patient variation: {a.variation}</div>}
                            </td>
                            <td className="px-3 py-2.5 text-xs text-slate-700">
                              {!prev ? (
                                <span className="text-slate-500">First attempt. {a.elicitedIds.length} findings gathered{a.missedCritical ? `, ${a.missedCritical} critical missed` : ""}.</span>
                              ) : (
                                <ul className="space-y-0.5">
                                  {prev.level !== a.level && <li>Difficulty went from level {prev.level} to level {a.level}.</li>}
                                  <li>
                                    {gained > 0 ? `Gathered ${gained} finding${gained === 1 ? "" : "s"} you missed last time` : "No new findings gathered"}
                                    {lost > 0 && `; missed ${lost} you had found before`}.
                                  </li>
                                  <li>{a.missedCritical === 0 ? "No critical findings missed." : `${a.missedCritical} critical finding${a.missedCritical === 1 ? "" : "s"} still missed${prev.missedCritical !== a.missedCritical ? ` (was ${prev.missedCritical})` : ""}.`}</li>
                                  {up.length > 0 && <li>Higher: {up.map((d) => d.name).join(", ")}.</li>}
                                  {down.length > 0 && <li>Lower: {down.map((d) => d.name).join(", ")}.</li>}
                                </ul>
                              )}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-right">
                              <Link href={feedbackUrl(a.id)} className="text-xs font-medium text-brand-700 hover:underline">
                                Feedback
                              </Link>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
