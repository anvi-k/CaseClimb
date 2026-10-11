import Link from "next/link";
import { notFound } from "next/navigation";
import AppShell from "@/components/AppShell";
import Icon from "@/components/Icon";
import { LinkButton } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { feedbackUrl, studentAssignments } from "@/lib/courses";
import { get, parse } from "@/lib/db";
import type { Feedback } from "@/lib/types";

export const dynamic = "force-dynamic";

interface Row {
  caseId: string;
  name: string;
  portrait: string | null;
  lastId: string | null;
  done: boolean;
  score: string | null;
  needsReview: boolean;
}

/** One student for their instructor: the reports from finished visits, and the patients still to be seen. */
export default async function StudentForInstructor({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("faculty");
  const { id } = await params;
  // Only a student in one of this instructor's classes.
  const student = get<{ id: string; name: string }>(
    `SELECT u.id, u.name FROM users u JOIN enrollments en ON en.user_id = u.id JOIN courses co ON co.id = en.course_id WHERE u.id = ? AND (co.faculty_id = ? OR ? = 'admin') LIMIT 1`,
    id,
    user.id,
    user.role,
  );
  if (!student) notFound();

  const rows: Row[] = [];
  for (const { cases } of studentAssignments(student.id).filter((x) => !x.a.journey_id).sort((x, y) => x.a.created_at.localeCompare(y.a.created_at))) {
    for (const c of cases) {
      if (rows.some((r) => r.caseId === c.card.id)) continue;
      const p = get<{ name: string | null; age: number | null; portrait: string | null }>(
        "SELECT json_extract(profile, '$.patient.name') AS name, json_extract(profile, '$.patient.age') AS age, json_extract(profile, '$.patient.portrait') AS portrait FROM cases WHERE id = ?",
        c.card.id,
      );
      const e = c.lastId ? get<{ feedback: string | null; faculty_note: string | null; faculty_score: number | null }>("SELECT feedback, faculty_note, faculty_score FROM encounters WHERE id = ?", c.lastId) : undefined;
      const f = parse<Partial<Feedback>>(e?.feedback, {});
      rows.push({
        caseId: c.card.id,
        name: p?.name ? (p.age === null ? p.name : `${p.name}, ${p.age}`) : "Patient",
        portrait: p?.portrait || null,
        lastId: c.lastId,
        done: c.scoredCount > 0,
        score: typeof f.total === "number" && f.max ? `${f.total} of ${f.max}` : null,
        needsReview: !!f.needsReview && !e?.faculty_note && e?.faculty_score == null,
      });
    }
  }
  const finished = rows.filter((r) => r.done);
  const todo = rows.filter((r) => !r.done);

  const face = (r: Row) =>
    r.portrait ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={r.portrait} alt="" className="h-14 w-14 flex-none rounded-full object-cover object-[50%_20%]" />
    ) : (
      <div className="flex h-14 w-14 flex-none items-center justify-center rounded-full bg-brand-100 font-semibold text-brand-700">{r.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}</div>
    );
  const heading = "mb-3 mt-10 flex items-center gap-2.5 text-[26px] font-semibold text-slate-900";
  const list = "divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white";
  const empty = "rounded-2xl border border-slate-200 bg-white px-7 py-5 text-slate-600";

  return (
    <AppShell user={user}>
      <Link href="/faculty" className="inline-flex items-center gap-1.5 text-[15px] text-brand-700 hover:underline">
        <Icon name="arrowLeft" />
        Back to my class
      </Link>
      <h1 className="mt-2 text-[40px] font-semibold leading-tight text-slate-900">{student.name}</h1>
      <p className="mt-1 text-slate-600">
        {finished.length} of {rows.length} visits done
      </p>

      <h2 className={heading}>
        <Icon name="clipboard" className="h-7 w-7 text-brand-600" />
        Reports
      </h2>
      {finished.length === 0 ? (
        <p className={empty}>No finished visits yet.</p>
      ) : (
        <ul className={list}>
          {finished.map((r) => (
            <li key={r.caseId} className="flex flex-wrap items-center gap-5 px-7 py-4">
              {face(r)}
              <div className="min-w-0 flex-1 font-semibold text-slate-900">{r.name}</div>
              {r.needsReview && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-[15px] font-semibold text-amber-900">
                  <Icon name="alert" />
                  Needs your review
                </span>
              )}
              {r.score && <span className="rounded-full bg-emerald-100 px-3 py-1 text-[15px] font-semibold text-emerald-900">{r.score}</span>}
              {r.lastId && (
                <LinkButton href={feedbackUrl(r.lastId)} variant="secondary" className="!px-4 !py-2 !text-base">
                  Open report
                </LinkButton>
              )}
            </li>
          ))}
        </ul>
      )}

      <h2 className={heading}>
        <Icon name="clock" className="h-7 w-7 text-brand-600" />
        Still to complete
      </h2>
      {todo.length === 0 ? (
        <p className={empty}>{rows.length ? "Nothing left. Every assigned visit is done." : "No patients have been assigned to this student yet."}</p>
      ) : (
        <ul className={list}>
          {todo.map((r) => (
            <li key={r.caseId} className="flex flex-wrap items-center gap-5 px-7 py-4">
              {face(r)}
              <div className="min-w-0 flex-1 text-slate-900">{r.name}</div>
              <span className="text-[15px] text-slate-600">Not done yet</span>
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
