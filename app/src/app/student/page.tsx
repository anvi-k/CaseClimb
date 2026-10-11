import Link from "next/link";
import AppShell from "@/components/AppShell";
import JoinCourse from "@/components/courses/JoinCourse";
import StartVisit from "@/components/courses/StartVisit";
import { LinkButton } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { all, get, parse } from "@/lib/db";
import { feedbackUrl, studentAssignments, visitUrl } from "@/lib/courses";
import type { Feedback } from "@/lib/types";

interface Row {
  caseId: string;
  assignmentId: string;
  name: string;
  age: number | null;
  portrait: string | null;
  activeId: string | null;
  lastId: string | null;
  done: boolean;
  /** "21 of 28", or null when there is no score to show. */
  score: string | null;
}

function Portrait({ src, name, size }: { src: string | null; name: string; size: string }) {
  const initials = name.split(" ").map((w) => w[0]).slice(0, 2).join("");
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" className={`${size} flex-none rounded-full object-cover object-[50%_20%]`} />
  ) : (
    <div className={`${size} flex flex-none items-center justify-center rounded-full bg-brand-100 font-semibold text-brand-700`}>{initials}</div>
  );
}

/** The student's home: the patients their instructor assigned, worked through one at a time. */
export default async function StudentHome() {
  const user = await requireUser();
  const courses = all<{ name: string; faculty: string }>(
    "SELECT co.name, u.name AS faculty FROM courses co JOIN enrollments en ON en.course_id = co.id JOIN users u ON u.id = co.faculty_id WHERE en.user_id = ? ORDER BY en.created_at",
    user.id,
  );
  // Oldest assignment first, each patient once, in the order the instructor listed them.
  const assignments = studentAssignments(user.id)
    .filter((x) => !x.a.journey_id)
    .sort((x, y) => x.a.created_at.localeCompare(y.a.created_at));
  const rows: Row[] = [];
  for (const { a, cases, feedbackVisible } of assignments) {
    for (const c of cases) {
      if (rows.some((r) => r.caseId === c.card.id)) continue;
      const p = get<{ name: string | null; age: number | null; portrait: string | null }>(
        "SELECT json_extract(profile, '$.patient.name') AS name, json_extract(profile, '$.patient.age') AS age, json_extract(profile, '$.patient.portrait') AS portrait FROM cases WHERE id = ?",
        c.card.id,
      );
      let score: string | null = null;
      if (c.lastId && feedbackVisible) {
        const f = parse<Partial<Feedback>>(get<{ feedback: string | null }>("SELECT feedback FROM encounters WHERE id = ?", c.lastId)?.feedback, {});
        if (typeof f.total === "number" && f.max) score = `${f.total} of ${f.max}`;
      }
      rows.push({ caseId: c.card.id, assignmentId: a.id, name: p?.name || "Patient", age: p?.age ?? null, portrait: p?.portrait || null, activeId: c.activeId, lastId: c.lastId, done: c.scoredCount > 0, score });
    }
  }
  const doneCount = rows.filter((r) => r.done).length;
  const nextIndex = rows.findIndex((r) => !r.done);
  const next = nextIndex >= 0 ? rows[nextIndex] : null;
  const who = (r: Row) => (r.age === null ? r.name : `${r.name}, ${r.age}`);

  return (
    <AppShell user={user}>
      <div className="mx-auto max-w-5xl">
        <h1 className="text-[40px] font-semibold leading-tight text-slate-900">Your Patients</h1>
        {courses.length > 0 && <p className="mt-1 text-slate-600">Assigned by {courses[0].faculty} · {courses.map((c) => c.name).join(", ")}</p>}

        {courses.length === 0 ? (
          <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-8">
            <h2 className="text-[26px] font-semibold text-slate-900">Join your class</h2>
            <p className="mb-4 mt-1 text-slate-600">Enter the code your instructor gave you. Your patients appear here once you have joined.</p>
            <div className="max-w-md">
              <JoinCourse />
            </div>
          </div>
        ) : rows.length === 0 ? (
          <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-8 text-slate-600">Your instructor has not assigned any patients yet.</div>
        ) : (
          <>
            <div className="mt-6 h-2.5 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuemin={0} aria-valuemax={rows.length} aria-valuenow={doneCount}>
              <div className="h-2.5 rounded-full bg-brand-600" style={{ width: `${(100 * doneCount) / rows.length}%` }} />
            </div>
            <p className="mt-1.5 text-[15px] text-slate-600">
              {doneCount} of {rows.length} visits done
            </p>

            {next ? (
              <div className="mt-7 flex flex-wrap items-center gap-7 rounded-2xl border-2 border-brand-600 bg-white p-7">
                <Portrait src={next.portrait} name={next.name} size="h-32 w-32 !rounded-2xl text-3xl" />
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold text-brand-700">{next.activeId ? "In progress" : "Up next"}</p>
                  <p className="text-[30px] font-semibold leading-snug text-slate-900">{who(next)}</p>
                  <p className="text-slate-600">10-minute visit</p>
                </div>
                {next.activeId ? (
                  <LinkButton href={visitUrl(next.activeId)} size="lg" className="!px-7 !py-3.5 !text-[19px]">
                    Continue visit
                  </LinkButton>
                ) : (
                  <StartVisit size="lg" body={{ caseId: next.caseId, assignmentId: next.assignmentId }} />
                )}
              </div>
            ) : (
              <div className="mt-7 rounded-2xl border border-emerald-300 bg-emerald-50 p-7 text-emerald-900">
                <p className="text-[26px] font-semibold">All visits done</p>
                <p>You have seen every patient your instructor assigned. Open any visit below to read its feedback.</p>
              </div>
            )}

            <h2 className="mb-3 mt-10 text-[26px] font-semibold text-slate-900">All patients</h2>
            <ul className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
              {rows.map((r, i) => {
                const locked = !r.done && nextIndex >= 0 && i > nextIndex;
                return (
                  <li key={r.caseId} className={`flex flex-wrap items-center gap-5 px-7 py-4 ${locked ? "text-slate-500" : ""}`}>
                    {locked ? (
                      <div className="flex h-14 w-14 flex-none items-center justify-center rounded-full bg-slate-200 text-slate-600" aria-label="Locked">
                        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <rect x="5" y="11" width="14" height="9" rx="2" />
                          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
                        </svg>
                      </div>
                    ) : (
                      <Portrait src={r.portrait} name={r.name} size="h-14 w-14" />
                    )}
                    <div className={`min-w-0 flex-1 ${i === nextIndex ? "font-semibold" : ""}`}>{locked ? `Patient ${i + 1}` : who(r)}</div>
                    {r.done ? (
                      <>
                        <span className="rounded-lg bg-emerald-100 px-3 py-1 text-[15px] font-semibold text-emerald-900">{r.score ? `Done · ${r.score}` : "Done"}</span>
                        {r.lastId && (
                          <LinkButton href={feedbackUrl(r.lastId)} variant="secondary" className="!px-4 !py-2 !text-base">
                            See feedback
                          </LinkButton>
                        )}
                      </>
                    ) : (
                      <span className="text-[15px] text-slate-600">{i === nextIndex ? (r.activeId ? "In progress" : "Up next") : `Opens after ${i === nextIndex + 1 && next ? next.name.split(" ")[0] : `patient ${i}`}`}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}

        <p className="mt-9">
          <Link href="/student/practice" className="inline-flex rounded-full border border-slate-300 bg-white px-7 py-3.5 text-[19px] font-semibold text-slate-900 hover:bg-slate-50">
            Practice with an extra patient
          </Link>
        </p>
      </div>
    </AppShell>
  );
}
