import AppShell from "@/components/AppShell";
import JourneyBuilder from "@/components/journey/JourneyBuilder";
import { LinkButton, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { builderOptions } from "@/lib/journey/facultyData";

export default async function NewJourney() {
  const user = await requireUser("faculty");
  return (
    <AppShell user={user}>
      <PageHeader title="New care journey" subtitle="Pick a published patient, let the guide propose who sees them and in what order, then edit and publish." action={<LinkButton href="/faculty/journeys" variant="secondary" size="sm">All care journeys</LinkButton>} />
      <JourneyBuilder {...builderOptions()} />
    </AppShell>
  );
}
