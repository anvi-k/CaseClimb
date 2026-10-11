"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Icon, { type IconName } from "@/components/Icon";
import { Button } from "@/components/ui";
import { Notice, startTestVisit } from "./fields";

export interface Summary {
  id: string;
  status: string;
  name: string;
  age: number | null;
  about: string;
  portrait: string | null;
  mainIssue: string;
  temperament: string;
  reason: string;
  problems: string[];
  medications: string[];
  personality: string;
}

function Block({ icon, title, children }: { icon: IconName; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white px-7 py-6">
      <h2 className="mb-2 flex items-center gap-2.5 text-[22px] text-slate-900">
        <Icon name={icon} className="h-6 w-6 text-brand-600" />
        {title}
      </h2>
      {children}
    </section>
  );
}

/** What an instructor sees on opening a patient: who they are and what the visit is about. The full editor is one link away. */
export default function PatientSummary({ s }: { s: Summary }) {
  const router = useRouter();
  const status = s.status;
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const edit = `/faculty/cases/${s.id}?edit=1`;

  async function run(what: string, fn: () => Promise<void>) {
    setBusy(what);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  const list = (items: string[]) => (
    <ul className="list-disc space-y-1 pl-5 text-slate-700 marker:text-brand-600">
      {items.map((i) => (
        <li key={i}>{i}</li>
      ))}
    </ul>
  );

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/faculty/cases" className="inline-flex items-center gap-1.5 text-[15px] text-brand-700 hover:underline">
        <Icon name="arrowLeft" />
        Back to patients
      </Link>

      <div className="mt-4 flex flex-wrap items-center gap-7 rounded-2xl border border-slate-200 bg-white p-7">
        {s.portrait ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={s.portrait} alt="" className="h-32 w-32 flex-none rounded-2xl object-cover object-[50%_20%]" />
        ) : (
          <div className="flex h-32 w-32 flex-none items-center justify-center rounded-2xl bg-brand-100 text-3xl font-semibold text-brand-700">
            {s.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="text-[40px] leading-tight text-slate-900">
            {s.name}
            {s.age !== null && `, ${s.age}`}
          </h1>
          {s.about && <p className="text-slate-600">{s.about}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            {s.mainIssue && (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-sky-100 px-2.5 py-1 font-medium text-sky-800">
                <Icon name="pulse" />
                {s.mainIssue}
              </span>
            )}
            {s.temperament && (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-violet-100 px-2.5 py-1 font-medium text-violet-800">
                <Icon name="mood" />
                {s.temperament}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-none flex-col gap-2.5">
          <Button size="lg" disabled={!!busy || status === "archived"} onClick={() => run("test", async () => router.push(await startTestVisit(s.id)))}>
            <Icon name="video" />
            {busy === "test" ? "Starting…" : "Test visit"}
          </Button>
        </div>
      </div>
      {error && (
        <Notice tone="red" className="mt-3">
          {error}
        </Notice>
      )}

      <div className="mt-5 grid gap-5 md:grid-cols-2">
        {s.reason && (
          <Block icon="clipboard" title="Reason for visit">
            <p className="text-slate-700">{s.reason}</p>
          </Block>
        )}
        {s.personality && (
          <Block icon="mood" title="Personality">
            <p className="text-slate-700">{s.personality}</p>
          </Block>
        )}
        {s.problems.length > 0 && (
          <Block icon="pulse" title="Health problems">
            {list(s.problems)}
          </Block>
        )}
        {s.medications.length > 0 && (
          <Block icon="check" title="Medications">
            {list(s.medications)}
          </Block>
        )}
      </div>

      <p className="mt-7">
        <Link href={edit} className="inline-flex items-center gap-1.5 text-[15px] font-medium text-brand-700 hover:underline">
          Edit all details
          <Icon name="arrowRight" />
        </Link>
      </p>
    </div>
  );
}
