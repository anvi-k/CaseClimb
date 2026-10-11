"use client";

import { useMemo, useState } from "react";
import { Badge, Button, Card, CardHeader, Textarea, cx } from "@/components/ui";
import { STATUS_LABEL, type Chain, type EntryStatus, type PlanItem, type RunView, type StateEntry } from "@/lib/journey/types";
import { EntryRow, post, Spinner, STATUS_COLOR, STATUS_ORDER, stageLabel } from "./shared";

const OPEN: EntryStatus[] = ["uncertain", "disputed", "open_question"];

const GROUPS: { title: string; kinds: string[] }[] = [
  { title: "Found out from the patient", kinds: ["finding", "goal"] },
  { title: "Exams, tests and records reviewed", kinds: ["result"] },
  { title: "Assessment and interpretation", kinds: ["assessment", "interpretation", "consult"] },
  { title: "Recommendations and plan", kinds: ["recommendation", "referral", "plan_item", "callout", "plan_change"] },
  { title: "Uncertainty, questions and disagreements raised", kinds: ["uncertainty", "open_question", "disagreement"] },
  { title: "Followed up on earlier information", kinds: ["follow_up"] },
];

// ---------- (b) influence chains ----------

const STEP_STYLE: Record<string, { bar: string; tag: string }> = {
  discovered: { bar: "border-l-slate-400", tag: "text-slate-600" },
  handed_off: { bar: "border-l-violet-400", tag: "text-violet-700" },
  asked: { bar: "border-l-sky-500", tag: "text-sky-700" },
  new_information: { bar: "border-l-orange-400", tag: "text-orange-700" },
  incorporated: { bar: "border-l-brand-500", tag: "text-brand-700" },
  plan: { bar: "border-l-emerald-500", tag: "text-emerald-700" },
};

function Arrow() {
  return (
    <svg width="22" height="16" viewBox="0 0 22 16" className="mx-0.5 shrink-0 self-center text-slate-400" aria-hidden>
      <path d="M1 8h17M13 3l6 5-6 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChainFlow({ chain, onOpen, stages }: { chain: Chain; onOpen: (id: string) => void; stages: number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <Badge tone="teal">Spans {chain.stagesSpanned} points in the journey</Badge>
        <span>{chain.steps.length} steps</span>
      </div>
      <div className="flex flex-wrap items-stretch gap-y-2">
        {chain.steps.map((s, i) => {
          const st = STEP_STYLE[s.kind];
          const body = (
            <>
              <div className={cx("text-[14px] font-semibold uppercase tracking-wide", st.tag)}>{s.label}</div>
              <div className="mt-0.5 line-clamp-4 text-[16px] leading-snug text-slate-800">{s.kind === "asked" ? `“${s.detail}”` : s.detail}</div>
              <div className="mt-1 text-[14px] text-slate-500">{s.who}{s.stageOrder > 0 && s.stageOrder <= stages ? ` · encounter ${s.stageOrder}` : ""}</div>
            </>
          );
          return (
            <div key={i} className="flex items-stretch">
              {i > 0 && <Arrow />}
              {s.entryId ? (
                <button onClick={() => onOpen(s.entryId!)} className={cx("w-48 shrink-0 rounded-md border border-l-4 border-slate-200 bg-white p-2 text-left hover:bg-slate-50", st.bar)}>{body}</button>
              ) : (
                <div className={cx("w-48 shrink-0 rounded-md border border-l-4 border-slate-200 bg-slate-50 p-2", st.bar)}>{body}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- (f) how the state evolved ----------

function Evolution({ view }: { view: RunView }) {
  const [hover, setHover] = useState<{ row: number; status: EntryStatus } | null>(null);
  const rows = useMemo(() => {
    const points = [{ order: 0, label: "Existing record", sub: "Before the journey" }, ...view.stages.filter((s) => view.entries.some((e) => e.stageId === s.stage.id)).map((s) => ({ order: s.stage.order, label: `After encounter ${s.stage.order}`, sub: `${s.stage.roleTitle} · ${s.stage.simTime}` }))];
    if (view.entries.some((e) => e.stageId === "huddle")) points.push({ order: view.stages.length + 1, label: "After the team huddle", sub: "Reconciliation" });
    const order = new Map(view.entries.map((e) => [e.id, e.stageOrder]));
    return points.map((p) => {
      const counts = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0])) as Record<EntryStatus, number>;
      const links = view.links.filter((l) => (order.get(l.from) ?? 99) <= p.order);
      for (const e of view.entries.filter((x) => x.stageOrder <= p.order)) {
        const inb = links.filter((l) => l.to === e.id);
        const eff: EntryStatus = inb.some((l) => l.relation === "resolves" || l.relation === "answers") ? "resolved" : inb.some((l) => l.relation === "contradicts") ? "disputed" : e.status;
        counts[eff]++;
      }
      return { ...p, counts, total: Object.values(counts).reduce((a, b) => a + b, 0) };
    });
  }, [view]);
  const max = Math.max(1, ...rows.map((r) => r.total));
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
        {STATUS_ORDER.map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: STATUS_COLOR[s] }} />{STATUS_LABEL[s]}</span>
        ))}
      </div>
      <div className="space-y-2.5">
        {rows.map((r, ri) => (
          <div key={r.order} className="grid items-center gap-x-3 sm:grid-cols-[13rem_1fr]">
            <div className="leading-tight">
              <div className="text-sm font-medium text-slate-800">{r.label}</div>
              <div className="text-[14px] text-slate-500">{r.sub}</div>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex h-5" style={{ width: `${(r.total / max) * 88}%`, gap: 2 }}>
                {STATUS_ORDER.filter((s) => r.counts[s] > 0).map((s) => (
                  <div
                    key={s}
                    onMouseEnter={() => setHover({ row: ri, status: s })}
                    onMouseLeave={() => setHover(null)}
                    className="relative flex min-w-[3px] items-center justify-center rounded-[3px] text-[14px] font-semibold text-white"
                    style={{ flexGrow: r.counts[s], flexBasis: 0, background: STATUS_COLOR[s], opacity: hover && !(hover.row === ri && hover.status === s) ? 0.55 : 1 }}
                  >
                    {r.counts[s] / r.total > 0.07 && (r.total / max) > 0.3 ? <span className="rounded-sm bg-slate-900/45 px-1 leading-4">{r.counts[s]}</span> : null}
                    {hover?.row === ri && hover.status === s && (
                      <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[14px] font-medium text-white shadow">
                        {r.counts[s]} {STATUS_LABEL[s].toLowerCase()} · {r.label.toLowerCase()}
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <span className="text-xs tabular-nums text-slate-500">{r.total}</span>
            </div>
          </div>
        ))}
      </div>
      <details className="mt-3 text-xs text-slate-600">
        <summary className="cursor-pointer text-slate-500">Show as a table</summary>
        <table className="mt-2 w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              <th className="py-1 pr-2 font-medium">Point in the journey</th>
              {STATUS_ORDER.map((s) => <th key={s} className="px-1 py-1 font-medium">{STATUS_LABEL[s]}</th>)}
              <th className="px-1 py-1 font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.order} className="border-b border-slate-100">
                <td className="py-1 pr-2">{r.label}</td>
                {STATUS_ORDER.map((s) => <td key={s} className="px-1 py-1 tabular-nums">{r.counts[s]}</td>)}
                <td className="px-1 py-1 tabular-nums">{r.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

// ---------- (d) care plan ----------

function PlanItemRow({ view, item, onOpen, refresh }: { view: RunView; item: PlanItem; onOpen: (id: string) => void; refresh: () => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const byId = new Map(view.entries.map((e) => [e.id, e]));
  const reply = [...view.messages].reverse().find((m) => m.thread === "plan" && m.meta?.itemId === item.id && m.fromIsAi);
  async function send() {
    setBusy(true);
    setErr("");
    const r = await post(`/api/journeys/runs/${view.id}/plan`, { itemId: item.id, text });
    setBusy(false);
    if (r.error) return setErr(r.error);
    setEditing(false);
    setText("");
    refresh();
  }
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 flex-1 text-sm font-medium text-slate-900">{item.action}</p>
        {item.professions.length > 1 && <Badge tone="teal">Combines {item.professions.length} professions</Badge>}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
        <span className="text-slate-500">Owner:</span>
        {item.ownerRoles.map((o) => <Badge key={o} tone="blue">{o}</Badge>)}
        {item.timeframe && <span className="text-slate-500">· {item.timeframe}</span>}
      </div>
      <p className="mt-1 text-[16px] text-slate-600">{item.rationale}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        <span className="text-[14px] text-slate-500">Rests on:</span>
        {item.restsOn.map((id) => {
          const e = byId.get(id);
          if (!e) return null;
          return (
            <button key={id} onClick={() => onOpen(id)} title={e.text} className="inline-flex max-w-[16rem] items-center gap-1 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[14px] text-slate-700 hover:bg-slate-50">
              <span className="h-1.5 w-1.5 shrink-0 rounded-sm" style={{ background: STATUS_COLOR[e.effectiveStatus] }} />
              <span className="truncate">{e.stageId === "record" ? "Record" : e.contributorRole}: {e.text}</span>
            </button>
          );
        })}
      </div>
      {item.revisions?.map((r, i) => (
        <p key={i} className="mt-1.5 rounded bg-emerald-50 px-2 py-1 text-[15px] text-emerald-900">Changed in the huddle by {r.by}. Was: &ldquo;{r.from}&rdquo;</p>
      ))}
      {reply && !editing && <p className="mt-1.5 rounded bg-slate-50 px-2 py-1 text-[15px] text-slate-700"><span className="font-semibold">{reply.fromName}:</span> {reply.text}</p>}
      {view.viewerIsOwner &&
        (editing ? (
          <div className="mt-2 space-y-2">
            <Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="What would you change about this item, and why? The colleague who owns it will answer." />
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={send} disabled={busy || !text.trim()}>Propose change</Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
              {busy && <Spinner label="The team is considering it" />}
              {err && <span className="text-xs text-rose-700">{err}</span>}
            </div>
          </div>
        ) : (
          <button onClick={() => setEditing(true)} className="mt-1.5 text-xs font-medium text-brand-700 hover:underline">Propose a change to this item</button>
        ))}
    </li>
  );
}

function Section({ id, title, subtitle, children }: { id: string; title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <Card id={id} className="scroll-mt-4">
      <CardHeader title={title} subtitle={subtitle} />
      <div className="p-4">{children}</div>
    </Card>
  );
}

/** The integrated patient representation. Every item on it opens its provenance. */
export default function FinalView({ view, onOpen, refresh }: { view: RunView; onOpen: (id: string) => void; refresh: () => void }) {
  const [showAll, setShowAll] = useState<Record<string, boolean>>({});
  const superseded = new Set(view.links.filter((l) => l.relation === "updates").map((l) => l.to));
  const board: { key: string; title: string; hint: string; items: StateEntry[] }[] = [
    { key: "est", title: "Established", hint: "On the record, from an exam or test, or stated firmly by a clinician", items: view.entries.filter((e) => e.effectiveStatus === "established" && e.kind !== "follow_up") },
    { key: "pr", title: "Patient-reported", hint: "What the patient said; not independently verified", items: view.entries.filter((e) => e.effectiveStatus === "patient_reported") },
    { key: "unc", title: "Uncertain", hint: "Provisional judgements and unverified points", items: view.entries.filter((e) => e.effectiveStatus === "uncertain") },
    { key: "dis", title: "Disputed", hint: "Accounts or interpretations that disagree", items: view.entries.filter((e) => e.effectiveStatus === "disputed") },
    { key: "open", title: "Still unanswered", hint: "Questions nobody on the team can answer yet", items: view.entries.filter((e) => e.effectiveStatus === "open_question" && !superseded.has(e.id)) },
    { key: "res", title: "Resolved", hint: "Settled by a later encounter, a consult or the huddle", items: view.entries.filter((e) => e.effectiveStatus === "resolved") },
  ];
  const unresolved = view.entries.filter((e) => OPEN.includes(e.effectiveStatus) && !superseded.has(e.id)).length;
  const syn = view.synthesis;
  const contributors = [{ id: "record", title: "Existing record", name: "Before the journey", isStudent: false }, ...view.stages.map((s) => ({ id: s.stage.id, title: s.stage.roleTitle, name: `${s.clinicianName} · ${s.stage.simTime}`, isStudent: s.isStudent })), ...(view.entries.some((e) => e.stageId === "huddle") ? [{ id: "huddle", title: "Team huddle", name: "Whole team", isStudent: false }] : [])];

  return (
    <div className="space-y-5">
      <nav className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-brand-700">
        {[["#plan", "Coordinated care plan"], ["#contrib", "Who contributed what"], ["#chains", "How information travelled"], ["#status", "Established, uncertain, disputed, unanswered"], ["#evolve", "How the state evolved"]].map(([h, l]) => (
          <a key={h} href={h} className="hover:underline">{l}</a>
        ))}
      </nav>

      <Card>
        <div className="grid gap-4 p-4 lg:grid-cols-[1fr_auto]">
          <div>
            <h2 className="text-base font-semibold text-slate-900">{view.patient.name}, {view.patient.age} · one patient, {view.stages.length} encounters, one shared state</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-700">{syn?.patientSummary || "The integrated summary and care plan are written after the team huddle. Everything below is live and grows after each encounter."}</p>
            {syn && syn.summaryCites.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                <span className="text-[14px] text-slate-500">Rests on:</span>
                {syn.summaryCites.slice(0, 8).map((id) => {
                  const e = view.entries.find((x) => x.id === id);
                  return e ? <button key={id} onClick={() => onOpen(id)} className="max-w-[14rem] truncate rounded border border-slate-200 px-1.5 py-0.5 text-[14px] text-slate-700 hover:bg-slate-50">{e.text}</button> : null;
                })}
              </div>
            )}
          </div>
          <div className="grid grid-cols-4 gap-2 self-start text-center lg:w-[22rem]">
            {[
              [view.entries.length, "entries in the shared state"],
              [view.links.length, "recorded relations"],
              [view.chains.length, "cross-encounter chains"],
              [unresolved, "still uncertain or open"],
            ].map(([n, l]) => (
              <div key={l as string} className="rounded-md border border-slate-200 px-2 py-2">
                <div className="text-xl font-semibold tabular-nums text-slate-900">{n}</div>
                <div className="text-[14px] leading-tight text-slate-500">{l}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto border-t border-slate-100 px-4 py-3">
          <table className="w-full min-w-[34rem] text-left text-sm">
            <thead>
              <tr className="text-[14px] uppercase tracking-wide text-slate-500">
                <th className="py-1 pr-3 font-semibold">Encounter</th>
                <th className="px-2 py-1 font-semibold" title="Earlier entries this professional drew on">Used</th>
                <th className="px-2 py-1 font-semibold" title="New entries this professional added">Contributed</th>
                <th className="px-2 py-1 font-semibold" title="Uncertainties, questions and disagreements raised">Identified</th>
                <th className="px-2 py-1 font-semibold" title="Handoff written to the next professional">Communicated</th>
              </tr>
            </thead>
            <tbody>
              {view.pillars.map((p, i) => (
                <tr key={p.stageId} className="border-t border-slate-100">
                  <td className="py-1.5 pr-3"><span className="font-medium text-slate-800">{i + 1}. {p.role}</span> <span className="text-slate-500">· {p.name}</span> {p.isStudent && <Badge tone="teal">Student</Badge>}</td>
                  <td className="px-2 tabular-nums text-slate-800">{p.used} earlier {p.used === 1 ? "entry" : "entries"}</td>
                  <td className="px-2 tabular-nums text-slate-800">{p.contributed} new</td>
                  <td className="px-2 tabular-nums text-slate-800">{p.identified} open {p.identified === 1 ? "point" : "points"}</td>
                  <td className="px-2 text-slate-800">{p.communicated ? "SBAR handoff" : "Not yet"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Section id="plan" title="Coordinated care plan" subtitle="Organised by the patient's problems and goals, not by profession. Every action names its owners and the entries it rests on.">
        {!syn ? (
          <p className="text-sm text-slate-500">The plan is written when the team huddle closes.</p>
        ) : (
          <div className="space-y-4">
            {syn.problems.map((p) => (
              <div key={p.id} className="rounded-lg border border-slate-200">
                <div className="border-b border-slate-100 bg-slate-50 px-4 py-2.5">
                  <h3 className="text-sm font-semibold text-slate-900">{p.title}</h3>
                  {p.patientGoal && <p className="mt-0.5 text-[16px] text-slate-700"><span className="font-medium">What the patient wants:</span> {p.patientGoal}</p>}
                  <p className="mt-0.5 text-[16px] text-slate-600">{p.summary}</p>
                </div>
                <ul className="divide-y divide-slate-100">{p.items.map((it) => <PlanItemRow key={it.id} view={view} item={it} onOpen={onOpen} refresh={refresh} />)}</ul>
              </div>
            ))}
            <p className="text-[14px] text-slate-400">
              Written by a model from the shared state only. Each action was checked: it must cite entries that exist and contain no value absent from the record{syn.droppedItems ? `; ${syn.droppedItems} proposed action${syn.droppedItems === 1 ? "" : "s"} failed that check and ${syn.droppedItems === 1 ? "was" : "were"} left out` : ""}.
            </p>
          </div>
        )}
      </Section>

      <Section id="contrib" title="What each profession contributed" subtitle="Grouped by who added it. Select any line for its full provenance.">
        <div className="grid gap-3 lg:grid-cols-2">
          {contributors.map((c) => {
            const mine = view.entries.filter((e) => e.stageId === c.id);
            if (!mine.length) return null;
            const expanded = showAll[c.id];
            return (
              <div key={c.id} className="rounded-lg border border-slate-200">
                <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{c.title}</div>
                    <div className="text-[14px] text-slate-500">{c.name} · {mine.length} entries</div>
                  </div>
                  {c.id !== "record" && c.id !== "huddle" && <Badge tone={c.isStudent ? "teal" : "slate"}>{c.isStudent ? "Student" : "AI colleague"}</Badge>}
                </div>
                <div className="p-1.5">
                  {c.id === "record" || c.id === "huddle"
                    ? mine.slice(0, expanded ? 99 : 6).map((e) => <EntryRow key={e.id} entry={e} onOpen={onOpen} showWho={false} dense />)
                    : GROUPS.map((g) => {
                        const items = mine.filter((e) => g.kinds.includes(e.kind));
                        if (!items.length) return null;
                        return (
                          <div key={g.title} className="mb-1.5">
                            <div className="px-2 pt-1 text-[14px] font-semibold uppercase tracking-wide text-slate-500">{g.title}</div>
                            {items.slice(0, expanded ? 99 : 4).map((e) => <EntryRow key={e.id} entry={e} onOpen={onOpen} showWho={false} dense />)}
                            {!expanded && items.length > 4 && <div className="px-2 text-[14px] text-slate-400">and {items.length - 4} more</div>}
                          </div>
                        );
                      })}
                  {(mine.length > 6 || c.id !== "record") && (
                    <button onClick={() => setShowAll((s) => ({ ...s, [c.id]: !expanded }))} className="px-2 py-1 text-xs font-medium text-brand-700 hover:underline">{expanded ? "Show fewer" : "Show all"}</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      <Section id="chains" title="How earlier information affected later decisions" subtitle="Built only from recorded relations: what was found, who picked it up, the question they asked because of it, what that uncovered, and who built on that.">
        {view.chains.length ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[14px] text-slate-500">
              {[["discovered", "Recorded"], ["handed_off", "Handed off"], ["asked", "Asked because of it"], ["new_information", "New information"], ["incorporated", "Built on"], ["plan", "Care plan"]].map(([k, l]) => (
                <span key={k} className="inline-flex items-center gap-1.5"><span className={cx("h-3 border-l-4", STEP_STYLE[k].bar)} />{l}</span>
              ))}
            </div>
            {view.chains.map((c) => <ChainFlow key={c.id} chain={c} onOpen={onOpen} stages={view.stages.length} />)}
          </div>
        ) : (
          <p className="text-sm text-slate-500">No later encounter has drawn on an earlier entry yet. Chains appear as soon as a professional asks about something a colleague recorded.</p>
        )}
      </Section>

      <Section id="status" title="What is established, and what is not" subtitle="The team's confidence in each piece of information. Status changes are made by adding linked entries, so the earlier view is never lost.">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {board.map((b) => {
            const expanded = showAll[b.key];
            return (
              <div key={b.key} className="rounded-lg border border-slate-200">
                <div className="border-b border-slate-100 px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-900">{b.title}</span>
                    <span className="text-sm tabular-nums text-slate-500">{b.items.length}</span>
                  </div>
                  <p className="text-[14px] text-slate-500">{b.hint}</p>
                </div>
                <div className="p-1.5">
                  {b.items.slice(0, expanded ? 200 : 5).map((e) => (
                    <div key={e.id}>
                      <EntryRow entry={e} onOpen={onOpen} dense />
                      <div className="-mt-0.5 pb-1 pl-6 text-[14px] text-slate-400">{stageLabel(view, e)}</div>
                    </div>
                  ))}
                  {!b.items.length && <p className="px-2 py-2 text-xs text-slate-400">None.</p>}
                  {b.items.length > 5 && <button onClick={() => setShowAll((s) => ({ ...s, [b.key]: !expanded }))} className="px-2 py-1 text-xs font-medium text-brand-700 hover:underline">{expanded ? "Show fewer" : `Show all ${b.items.length}`}</button>}
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      <Section id="evolve" title="How the shared state evolved" subtitle="Entries in the shared state after each encounter, by status at that point in the journey.">
        <Evolution view={view} />
      </Section>
    </div>
  );
}
