import { notFound, redirect } from "next/navigation";
import Visit from "@/components/visit/Visit";
import { isFaculty, requireUser } from "@/lib/auth";
import { loadEncounter } from "@/lib/engine/encounter";

export default async function EncounterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const enc = loadEncounter(id);
  if (!enc) notFound();
  if (enc.row.user_id !== user.id) {
    // Faculty watch other people's visits from the live console, not from the student's seat.
    if (isFaculty(user)) redirect(enc.row.status === "scored" ? `/encounter/${id}/feedback` : `/faculty/live?visit=${id}`);
    notFound();
  }
  if (enc.row.status === "scored") redirect(enc.row.journey_run_id ? `/journey/${enc.row.journey_run_id}` : `/encounter/${id}/feedback`);
  return <Visit id={id} viewerName={user.name} />;
}
