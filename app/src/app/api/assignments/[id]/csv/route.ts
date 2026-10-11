import { apiUser } from "@/lib/auth";
import { assignmentFor, gradebook } from "@/lib/courses";
import { bad } from "@/lib/http";

const cell = (v: unknown) => {
  let s = v === null || v === undefined ? "" : String(v);
  // Stop spreadsheet apps from running a student-supplied value as a formula.
  if (/^[=+\-@\t\r]/.test(s) && typeof v === "string") s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Grades for one assignment as CSV: one row per student per patient. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await apiUser("faculty");
  if (user instanceof Response) return user;
  const found = assignmentFor(user, (await ctx.params).id);
  if (!found) return bad("Assignment not found", 404);
  const g = gradebook(found.a);
  const head = ["Student", "Email", "Enrolled", "Patient", "Attempts", "Best score (%)", "Latest score (%)", "Latest rubric score (%)", "Faculty adjusted", "Needs review", "Review reasons", ...g.domainCols.map((d) => d.name)];
  const lines = [head.map(cell).join(",")];
  for (const r of g.rows) {
    const last = r.attempts[r.attempts.length - 1];
    lines.push(
      [
        r.student,
        r.email,
        r.enrolled ? "yes" : "no",
        r.caseTitle,
        r.attempts.length,
        r.best,
        r.latest,
        last?.score ?? "",
        last && last.facultyScore !== null ? "yes" : "no",
        r.attempts.some((x) => x.needsReview) ? "yes" : "no",
        [...new Set(r.attempts.flatMap((x) => x.reviewReasons))].join("; "),
        ...g.domainCols.map((d) => (r.domains[d.key]?.score === null || !r.domains[d.key] ? "" : `${r.domains[d.key].score} of ${r.domains[d.key].max}`)),
      ]
        .map(cell)
        .join(","),
    );
  }
  const name = found.a.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "grades";
  return new Response("﻿" + lines.join("\r\n") + "\r\n", {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}-grades.csv"`, "Cache-Control": "no-store" },
  });
}
