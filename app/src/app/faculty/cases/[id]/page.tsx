import { notFound, redirect } from "next/navigation";
import AppShell from "@/components/AppShell";
import CaseEditor from "@/components/studio/CaseEditor";
import { requireUser } from "@/lib/auth";
import { professions } from "@/lib/professions";
import { hashProfile } from "@/lib/studio/profile";
import { consistencyOf, getCase, metaOf, profileOf, rubricsFor } from "@/lib/studio/store";

export const dynamic = "force-dynamic";

export default async function CaseEditorPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const user = await requireUser("faculty");
  const { id } = await params;
  const row = getCase(id);
  if (!row) notFound();
  // Another faculty member's private case: send them back to their own library.
  if (user.role !== "admin" && row.owner_id && row.owner_id !== user.id) redirect("/faculty/cases");
  const profile = profileOf(row);
  return (
    <AppShell user={user} wide>
      <CaseEditor
        meta={metaOf(row, user)}
        initialProfile={profile}
        initialConsistency={consistencyOf(row)}
        initialHash={hashProfile(profile)}
        rubrics={rubricsFor(user)}
        roles={professions().map((p) => ({ id: p.id, name: p.name, roleTitle: p.roleTitle }))}
        created={(await searchParams).created === "1"}
      />
    </AppShell>
  );
}
