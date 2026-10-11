import AppShell from "@/components/AppShell";
import NewCaseWizard from "@/components/studio/NewCaseWizard";
import { requireUser } from "@/lib/auth";
import { professionGroups } from "@/lib/professions";

export const dynamic = "force-dynamic";

export default async function NewCasePage() {
  const user = await requireUser("faculty");
  const groups = professionGroups().map((g) => ({ group: g.group, items: g.items.map((p) => ({ id: p.id, name: p.name, roleTitle: p.roleTitle, encounterTypes: p.encounterTypes })) }));
  return (
    <AppShell user={user}>
      <NewCaseWizard groups={groups} defaultRole={user.profession_id || groups[0]?.items[0]?.id || "medicine"} />
    </AppShell>
  );
}
