import { headers } from "next/headers";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import When from "@/components/courses/When";
import AccessKeys from "@/components/episodes/AccessKeys";
import { Badge, Button, Card, CardHeader, Empty, Input, PageHeader } from "@/components/ui";
import { isFaculty, requireUser } from "@/lib/auth";
import { searchEpisodes } from "@/lib/episodes";

export default async function EpisodesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const q = await searchParams;
  const faculty = isFaculty(user);
  const episodes = searchEpisodes(user, { patient: q.patient, participant: q.participant, role: q.role, text: q.text, limit: 60 });
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") || "https"}://${h.get("x-forwarded-host") || h.get("host")}`;
  return (
    <AppShell user={user}>
      <PageHeader
        title={faculty ? "Episodes" : "My visits"}
        subtitle={faculty ? "Every recorded visit (assignments and care journeys): search by patient, by who took part, by role, or by what was said. Students' private practice is not listed." : "Every visit you have taken part in, plus your teammates' visits with a patient your class shares."}
      />
      <Card className="mb-4 p-4">
        <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Input name="patient" defaultValue={q.patient} placeholder="Patient name" />
          <Input name="participant" defaultValue={q.participant} placeholder={faculty ? "Student or professional" : "Teammate"} />
          <Input name="role" defaultValue={q.role} placeholder="Role, e.g. nursing" />
          <Input name="text" defaultValue={q.text} placeholder="Said in the visit, e.g. alcohol" />
          <div className="flex gap-2">
            <Button type="submit">Search</Button>
            <Link href="/episodes" className="self-center text-sm text-slate-500 hover:underline">
              Clear
            </Link>
          </div>
        </form>
      </Card>
      {episodes.length === 0 ? (
        <Empty>No episodes match.</Empty>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-[16px]">
            <thead>
              <tr className="border-b border-slate-200 text-xs text-slate-500">
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Patient</th>
                <th className="px-3 py-2 font-medium">Professional</th>
                <th className="px-3 py-2 font-medium">Role</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Turns</th>
                <th className="px-3 py-2 font-medium">Score</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {episodes.map((e) => (
                <tr key={e.id} className="border-b border-slate-100 align-top">
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                    <When at={e.startedAt} />
                  </td>
                  <td className="px-3 py-2">
                    <Link href={`/episodes?patient=${encodeURIComponent(e.patient)}`} className="font-medium text-slate-900 hover:underline">
                      {e.patient}
                    </Link>
                    {e.visitNumber > 1 && <Badge tone="blue" className="ml-1.5">visit {e.visitNumber}</Badge>}
                    {faculty && <div className="text-xs text-slate-500">{e.caseTitle}</div>}
                    {e.match && <div className="mt-1 rounded bg-amber-50 px-1.5 py-0.5 text-xs text-slate-700">{e.match}</div>}
                  </td>
                  <td className="px-3 py-2">
                    <Link href={`/episodes?participant=${encodeURIComponent(e.participant)}`} className="text-slate-800 hover:underline">
                      {e.participant}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-slate-700">{e.role}</td>
                  <td className="px-3 py-2">
                    <Badge tone={e.recorded ? "violet" : "slate"}>{e.mode}</Badge>
                  </td>
                  <td className="px-3 py-2 tabular-nums text-slate-700">{e.turns}</td>
                  <td className="px-3 py-2 tabular-nums text-slate-900">{e.status === "scored" && e.score !== null ? `${Math.round(e.score)}%` : <span className="text-slate-500">{e.status === "active" ? "in progress" : e.status}</span>}</td>
                  <td className="px-3 py-2 text-right">
                    <Link href={e.status === "active" && e.participantId === user.id ? `/encounter/${e.id}` : `/encounter/${e.id}/feedback`} className="font-medium text-brand-600 hover:underline">
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <Card className="mt-4">
        <CardHeader title="Connect an assistant" subtitle="Search these episodes from an AI assistant over MCP, or from a script." />
        <div className="p-4">
          <AccessKeys origin={origin} />
        </div>
      </Card>
    </AppShell>
  );
}
