"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Badge, Button, Empty, Input, LinkButton, PageHeader, Select } from "@/components/ui";
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
  const [status, setStatus] = useState("active");
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
      if (needle && ![c.title, c.patient, c.specialty, c.summary, c.encounterType].join(" ").toLowerCase().includes(needle)) return false;
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
        title="Patient Studio"
        subtitle="Build, review and publish simulated patients. Students only see patients you have published."
        action={<LinkButton href="/faculty/cases/new">New patient</LinkButton>}
      />
      <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by title, patient name or specialty" aria-label="Search patients" />
        <Select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Filter by learner role" className="sm:w-52">
          <option value="">All learner roles</option>
          {professions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status" className="sm:w-44">
          <option value="active">Drafts and published</option>
          <option value="draft">Drafts</option>
          <option value="published">Published</option>
          <option value="archived">Archived</option>
        </Select>
        <Select value={origin} onChange={(e) => setOrigin(e.target.value)} aria-label="Filter by origin" className="sm:w-52">
          <option value="">Any origin</option>
          <option value="mine">Created by me</option>
          <option value="sample">Samples</option>
          <option value="faculty">Faculty-written</option>
          <option value="ai_unreviewed">AI-drafted, not reviewed</option>
        </Select>
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
        <ul className="space-y-2">
          {shown.map((c) => (
            <li key={c.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-1.5">
                    <StatusBadges c={c} />
                    {c.openHigh > 0 && <Badge tone="red">{c.openHigh} high-severity issue{c.openHigh === 1 ? "" : "s"} open</Badge>}
                  </div>
                  <Link href={`/faculty/cases/${c.id}`} className="text-[15px] font-semibold text-slate-900 hover:text-brand-700">
                    {c.title}
                  </Link>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {[c.patient, c.professions.map(roleName).join(", "), c.specialty, `Difficulty ${c.difficulty} of 5`].filter(Boolean).join("  ·  ")}
                  </p>
                  {c.summary && <p className="mt-1.5 line-clamp-2 max-w-4xl text-sm text-slate-600">{c.summary}</p>}
                  <p className="mt-1.5 text-xs text-slate-400">
                    {c.counts.facts} facts, {c.counts.actions} exams and orders, {c.counts.artifacts} documents
                    {c.counts.variants ? `, ${c.counts.variants} approved variant${c.counts.variants === 1 ? "" : "s"}` : ""} · edited {when(c.updatedAt)}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
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
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy === c.id}
                    onClick={() =>
                      act(c.id, async () => {
                        const { id } = await api<{ id: string }>(`/api/cases/${c.id}/duplicate`, { json: {} });
                        router.push(`/faculty/cases/${id}`);
                      })
                    }
                  >
                    Duplicate
                  </Button>
                  {c.canEdit &&
                    (c.status === "archived" ? (
                      <Button variant="ghost" size="sm" disabled={busy === c.id} onClick={() => setStatusOf(c.id, "restore")}>
                        Restore
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy === c.id}
                        onClick={() => {
                          if (c.status !== "published" || window.confirm("This patient is published. Archiving removes it from students' lists. Archive it?")) setStatusOf(c.id, "archive");
                        }}
                      >
                        Archive
                      </Button>
                    ))}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
