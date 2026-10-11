import { notFound, redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import CaseEditor from "@/components/studio/CaseEditor";
import PatientSummary from "@/components/studio/PatientSummary";
import { requireUser } from "@/lib/auth";
import { professions } from "@/lib/professions";
import { hashProfile } from "@/lib/studio/profile";
import { consistencyOf, getCase, mainIssueOf, metaOf, profileOf, rubricsFor, temperamentOf } from "@/lib/studio/store";

export const dynamic = "force-dynamic";

export default async function CaseEditorPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string; edit?: string }> }) {
  const user = await requireUser("faculty");
  const { id } = await params;
  const row = getCase(id);
  if (!row) notFound();
  // Another faculty member's private case: send them back to their own library.
  if (user.role !== "admin" && row.owner_id && row.owner_id !== user.id) redirect("/faculty/cases");
  const profile = profileOf(row);
  const q = await searchParams;
  // Opening a patient shows a short summary; the full editor is behind "Edit all details" and for new drafts.
  if (q.edit !== "1" && q.created !== "1") {
    const chart = (label: RegExp) => profile.chartAtStart.find((c) => label.test(c.label))?.value || "";
    const items = (text: string) => text.split(";").map((i) => i.trim()).filter(Boolean).slice(0, 8);
    return (
      <AppShell user={user}>
        <PatientSummary
          s={{
            id: row.id,
            status: row.status,
            name: profile.patient.name || "Unnamed patient",
            age: profile.patient.age ?? null,
            about: [profile.patient.sex, profile.patient.occupation].filter(Boolean).join(" · ").replace(/^./, (ch) => ch.toUpperCase()),
            portrait: profile.patient.portrait || null,
            mainIssue: mainIssueOf(profile),
            temperament: temperamentOf(profile),
            reason: chart(/reason/i),
            problems: items(chart(/problem/i)),
            medications: items(chart(/medication/i)),
            personality: profile.persona?.personality || "",
          }}
        />
      </AppShell>
    );
  }
  return (
    <AppShell user={user} wide>
      <CaseEditor
        meta={metaOf(row, user)}
        initialProfile={profile}
        initialConsistency={consistencyOf(row)}
        initialHash={hashProfile(profile)}
        rubrics={rubricsFor(user)}
        roles={professions().map((p) => ({ id: p.id, name: p.name, roleTitle: p.roleTitle }))}
        created={q.created === "1"}
      />
    </AppShell>
  );
}
