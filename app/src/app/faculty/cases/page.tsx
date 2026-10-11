import AppShell from "@/components/AppShell";
import CaseLibrary from "@/components/studio/CaseLibrary";
import { requireUser } from "@/lib/auth";
import { professions } from "@/lib/professions";
import { listCases } from "@/lib/studio/store";

export const dynamic = "force-dynamic";

export default async function CasesPage() {
  const user = await requireUser("faculty");
  return (
    <AppShell user={user}>
      <CaseLibrary initial={listCases(user)} professions={professions().map((p) => ({ id: p.id, name: p.name }))} />
    </AppShell>
  );
}
