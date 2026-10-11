import { notFound } from "next/navigation";
import AppShell from "@/components/AppShell";
import RunHub from "@/components/journey/RunHub";
import { isFaculty, requireUser } from "@/lib/auth";
import { loadRun } from "@/lib/journey/store";

export default async function JourneyRunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const user = await requireUser();
  const run = loadRun(runId);
  if (!run || (run.row.user_id !== user.id && !isFaculty(user))) notFound();
  return (
    <AppShell user={user}>
      <RunHub runId={runId} />
    </AppShell>
  );
}
