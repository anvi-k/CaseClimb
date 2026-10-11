import Link from "next/link";
import AppShell from "@/components/AppShell";
import Icon from "@/components/Icon";
import JoinCourse from "@/components/courses/JoinCourse";
import StartVisit from "@/components/courses/StartVisit";
import { LinkButton } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { all, get, parse } from "@/lib/db";
import { feedbackUrl, studentAssignments, visitUrl } from "@/lib/courses";
import { TEMPERAMENTS } from "@/lib/engine/difficulty";
import { mainIssueOf } from "@/lib/studio/store";
import type { CaseProfile, Feedback } from "@/lib/types";

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
  /** 1 to 5, the temperament the instructor chose (or the patient's own). */
  temperament: number;
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
  // Oldest assignment first, each patient once. Students may see them in any order.
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
      rows.push({ caseId: c.card.id, assignmentId: a.id, name: p?.name || "Patient", age: p?.age ?? null, portrait: p?.portrait || null, activeId: c.activeId, lastId: c.lastId, done: c.scoredCount > 0, score, temperament: a.settings.level || c.card.difficulty || 3 });
    }
  }
  const doneCount = rows.filter((r) => r.done).length;
  const who = (r: Row) => (r.age === null ? r.name : `${r.name}, ${r.age}`);

  // The patient shown large at the top: a visit already begun, else the first one not yet done.
  const next = rows.find((r) => !r.done && r.activeId) || rows.find((r) => !r.done) || null;
  const nextIssue = next ? mainIssueOf(parse<Partial<CaseProfile>>(get<{ profile: string }>("SELECT profile FROM cases WHERE id = ?", next.caseId)?.profile, {})) : "";
  const todo = rows.filter((r) => !r.done && r !== next);
  const finished = rows.filter((r) => r.done);
  const card = (r: Row) => (
    <li key={r.caseId} className="flex flex-wrap items-center gap-6 rounded-2xl border border-slate-200 bg-white px-7 py-5">
      <Portrait src={r.portrait} name={r.name} size="h-20 w-20 text-xl" />
      <div className="min-w-0 flex-1">
        <p className="text-[24px] font-semibold leading-snug text-slate-900">{who(r)}</p>
        <p className="flex items-center gap-2 text-slate-600">
          <Icon name="clock" />
          10-minute visit
        </p>
      </div>
      {r.done ? (
        <>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-[15px] font-semibold text-emerald-900">
            <Icon name="check" />
            {r.score ? `Done · ${r.score}` : "Done"}
          </span>
          {r.lastId && (
            <LinkButton href={feedbackUrl(r.lastId)} variant="secondary" className="!px-4 !py-2 !text-base">
              See feedback
            </LinkButton>
          )}
        </>
      ) : r.activeId ? (
        <LinkButton href={visitUrl(r.activeId)} size="lg">
          <Icon name="video" />
          Continue visit
        </LinkButton>
      ) : (
        <StartVisit size="lg" body={{ caseId: r.caseId, assignmentId: r.assignmentId }} />
      )}
    </li>
  );

  return (
    <AppShell user={user}>
      <div className="mx-auto max-w-5xl">
        <h1 className="text-[40px] font-semibold leading-tight text-slate-900">Welcome, {user.name.split(" ")[0]}</h1>
        {courses.length > 0 && <p className="mt-1 text-slate-600">Your patients from {courses[0].faculty} · {courses.map((c) => c.name).join(", ")}</p>}

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

            {doneCount === rows.length && (
              <div className="mt-7 rounded-2xl border border-emerald-300 bg-emerald-50 p-7 text-emerald-900">
                <p className="flex items-center gap-2.5 text-[26px] font-semibold">
                  <Icon name="check" />
                  All visits done
                </p>
                <p>You have seen every patient your instructor assigned. Open any visit below to read its feedback.</p>
              </div>
            )}

            {next && (
              <div className="mt-7 grid overflow-hidden rounded-3xl border border-slate-200 bg-white md:grid-cols-[2fr_3fr]">
                {next.portrait ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={next.portrait} alt="" className="h-72 w-full object-cover object-[50%_20%] md:h-full md:min-h-[26rem]" />
                ) : (
                  <div className="flex h-72 items-center justify-center bg-brand-100 text-6xl font-semibold text-brand-700 md:h-full md:min-h-[26rem]">{next.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}</div>
                )}
                <div className="flex flex-col justify-center p-9">
                  <p className="text-sm font-bold uppercase tracking-[0.14em] text-brand-700">{next.activeId ? "Visit in progress" : "Your next step"}</p>
                  <h2 className="mt-1 text-[34px] leading-tight text-slate-900">{next.activeId ? "Pick up where you left off" : "Ready for your next patient?"}</h2>
                  <p className="mt-4 text-[26px] text-slate-900">{who(next)}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-600">
                    {nextIssue && (
                      <span className="inline-flex items-center gap-1.5">
                        <Icon name="pulse" />
                        {nextIssue}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1.5">
                      <Icon name="clock" />
                      10-minute visit
                    </span>
                  </p>
                  <div className="mt-5 flex items-center gap-3" aria-label={`Temperament: ${TEMPERAMENTS[next.temperament]}`}>
                    <span className="flex gap-1.5" aria-hidden="true">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <span key={n} className={`h-2.5 w-7 rounded-full ${n <= next.temperament ? "bg-brand-600" : "bg-slate-200"}`} />
                      ))}
                    </span>
                    <span className="text-slate-700">{TEMPERAMENTS[next.temperament]}</span>
                  </div>
                  <div className="mt-7">
                    {next.activeId ? (
                      <LinkButton href={visitUrl(next.activeId)} size="lg" className="!px-8 !py-4 !text-[20px]">
                        Continue visit
                        <Icon name="arrowRight" />
                      </LinkButton>
                    ) : (
                      <StartVisit size="lg" label="Meet your patient" body={{ caseId: next.caseId, assignmentId: next.assignmentId }} />
                    )}
                  </div>
                </div>
              </div>
            )}

            {todo.length > 0 && (
              <>
                <h2 className="mb-3 mt-10 flex items-center gap-2.5 text-[26px] font-semibold text-slate-900">
                  <Icon name="users" className="h-7 w-7 text-brand-600" />
                  More patients
                </h2>
                <ul className="space-y-3">{todo.map(card)}</ul>
              </>
            )}

            {finished.length > 0 && (
              <>
                <h2 className="mb-3 mt-10 flex items-center gap-2.5 text-[26px] font-semibold text-slate-900">
                  <Icon name="check" className="h-7 w-7 text-brand-600" />
                  Completed
                </h2>
                <ul className="space-y-3">{finished.map(card)}</ul>
              </>
            )}
          </>
        )}

        <p className="mt-9">
          <Link href="/student/practice" className="inline-flex items-center gap-2.5 rounded-full border border-slate-300 bg-white px-7 py-3.5 text-[19px] font-semibold text-slate-900 hover:bg-slate-50">
            <Icon name="chat" />
            Practice with an extra patient
          </Link>
        </p>
      </div>
    </AppShell>
  );
}
