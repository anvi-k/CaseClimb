"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Badge, Button, Empty, Input, LinkButton, PageHeader, Select } from "@/components/ui";
import Icon from "@/components/Icon";
import type { LibraryItem } from "@/lib/studio/store";
import { api, Notice, startTestVisit } from "./fields";

export function StatusBadges({ c }: { c: { status: string; origin: string; reviewed: boolean } }) {
  return (
    <>
      {c.status === "published" && <Badge tone="green">Published</Badge>}
      {c.status === "draft" && <Badge tone="slate">Draft</Badge>}
      {c.status === "archived" && <Badge tone="slate">Archived</Badge>}
      {c.origin === "ai_draft" && !c.reviewed && <Badge tone="amber">AI-drafted, not faculty-reviewed</Badge>}
      {c.origin === "ai_draft" && c.reviewed && <Badge tone="teal">AI-drafted, faculty-reviewed</Badge>}
      {c.origin === "sample" && <Badge tone="blue">Sample</Badge>}
    </>
  );
}

const when = (s: string) => {
  const d = new Date(s.replace(" ", "T") + "Z");
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

export default function CaseLibrary({ initial, professions }: { initial: LibraryItem[]; professions: { id: string; name: string }[] }) {
  const router = useRouter();
  const [cases, setCases] = useState(initial);
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const status = "active";
  const [origin, setOrigin] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const roleName = (id: string) => professions.find((p) => p.id === id)?.name || id;

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return cases.filter((c) => {
      if (status === "active" ? c.status === "archived" : status && c.status !== status) return false;
      if (role && !c.professions.includes(role)) return false;
      if (origin === "mine" && !c.mine) return false;
      if (origin === "sample" && c.origin !== "sample") return false;
      if (origin === "ai_unreviewed" && !(c.origin === "ai_draft" && !c.reviewed)) return false;
      if (origin === "faculty" && c.origin !== "faculty") return false;
      if (needle && ![c.title, c.patient, c.specialty, c.summary, c.encounterType, c.mainIssue, c.temperament].join(" ").toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [cases, q, role, status, origin]);

  async function act(id: string, fn: () => Promise<void>) {
    setBusy(id);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  const refresh = async () => setCases((await api<{ cases: LibraryItem[] }>("/api/cases")).cases);
  const setStatusOf = (id: string, action: string) =>
    act(id, async () => {
      await api(`/api/cases/${id}/status`, { json: { action } });
      await refresh();
    });

  return (
    <>
      <PageHeader
        title="Patients"
        subtitle="Every patient here can be assigned to your class."
        action={
          <LinkButton href="/faculty/cases/new">
            <Icon name="userPlus" />
            New patient
          </LinkButton>
        }
      />
      <div className="mb-4 grid gap-2 ">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by patient name or topic" aria-label="Search patients" />
      </div>
      {error && (
        <Notice tone="red" className="mb-3">
          {error}
        </Notice>
      )}
      {!shown.length ? (
        <Empty>
          {cases.length ? "No patients match these filters." : "You have no patients yet."}{" "}
          <Link href="/faculty/cases/new" className="font-medium text-brand-700 underline">
            Create a patient
          </Link>
        </Empty>
      ) : (
        <ul className="space-y-3">
          {shown.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-5 rounded-2xl border border-slate-200 bg-white px-7 py-4">
              {c.portrait ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.portrait} alt="" className="h-14 w-14 flex-none rounded-full object-cover object-[50%_20%]" />
              ) : (
                <div className="flex h-14 w-14 flex-none items-center justify-center rounded-full bg-brand-100 font-semibold text-brand-700">
                  {c.patient.split(",")[0].split(" ").map((w) => w[0]).slice(0, 2).join("")}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <Link href={`/faculty/cases/${c.id}`} className="font-semibold text-slate-900 hover:text-brand-700">
                  {c.patient || "Unnamed patient"}
                </Link>
                <div className="mt-1.5 flex flex-wrap gap-2 text-sm">
                  {c.mainIssue && (
                    <span className="inline-flex items-center gap-1.5 rounded-lg bg-sky-100 px-2.5 py-1 font-medium text-sky-800">
                      <Icon name="pulse" />
                      {c.mainIssue}
                    </span>
                  )}
                  {c.temperament && (
                    <span className="inline-flex items-center gap-1.5 rounded-lg bg-violet-100 px-2.5 py-1 font-medium text-violet-800">
                      <Icon name="mood" />
                      {c.temperament}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <LinkButton href={`/faculty/cases/${c.id}`} variant="secondary" size="sm">
                  Open
                </LinkButton>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy === c.id || c.status === "archived"}
                  title="Run the visit yourself, exactly as a student would"
                  onClick={() => act(c.id, async () => router.push(await startTestVisit(c.id)))}
                >
                  Test visit
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
