"use client";

import { useState } from "react";
import ArtifactView from "@/components/chart/ArtifactView";
import { Badge, Button, cx, Input, Label, Select } from "@/components/ui";
import type { Artifact, ArtifactChart, ArtifactTable } from "@/lib/types";
import { ARTIFACT_TYPES, deleteArtifact, nextId, releaseLabel, setRelease } from "@/lib/studio/profile";
import { api, Area, Field, Notice, Panel, Text } from "../fields";
import type { SectionProps } from "./types";

const typeLabel = (t: string) => ARTIFACT_TYPES.find((x) => x.id === t)?.label || t;

function template(type: Artifact["type"]): Partial<Artifact> {
  switch (type) {
    case "lab_report":
      return { title: "Lab report", table: { columns: ["Test", "Result", "Reference range"], rows: [{ cells: ["", "", ""], flag: "" }] } };
    case "medication_list":
      return { title: "Medication list", table: { columns: ["Medication", "Dose", "Frequency", "Indication"], rows: [{ cells: ["", "", "", ""], flag: "" }] } };
    case "flowsheet":
      return { title: "Vitals flowsheet", table: { columns: ["Date", "BP", "HR", "Weight"], rows: [{ cells: ["", "", "", ""], flag: "" }] } };
    case "ecg":
      return { title: "12-lead ECG", body: "Rate: \nRhythm: \nAxis: \nIntervals: PR  ms, QRS  ms, QTc  ms\nST-T changes: \n\nInterpretation: " };
    case "imaging":
      return { title: "Imaging report", body: "EXAM: \nINDICATION: \nCOMPARISON: \n\nFINDINGS:\n\nIMPRESSION:\n" };
    case "note":
      return { title: "Prior visit note", body: "" };
    case "chart":
      return { title: "Trend", chart: { kind: "line", xLabel: "Date", yLabel: "", series: [{ name: "", points: [] }] } };
    default:
      return { title: type === "form" ? "Form" : "Document", body: "" };
  }
}

function TableEditor({ table, onChange }: { table: ArtifactTable; onChange: (t: ArtifactTable | undefined) => void }) {
  const cell = "w-full min-w-[6rem] rounded border border-slate-300 bg-white px-1.5 py-1 text-xs focus:border-brand-500 focus:outline-none";
  const setCols = (columns: string[]) => onChange({ ...table, columns });
  const setRow = (i: number, row: ArtifactTable["rows"][number]) => onChange({ ...table, rows: table.rows.map((r, j) => (j === i ? row : r)) });
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="border-collapse text-left">
          <thead>
            <tr>
              {table.columns.map((c, i) => (
                <th key={i} className="p-0.5">
                  <div className="flex items-center gap-0.5">
                    <input className={cx(cell, "font-semibold")} value={c} aria-label={`Column ${i + 1}`} placeholder="Column" onChange={(e) => setCols(table.columns.map((x, j) => (j === i ? e.target.value : x)))} />
                    {table.columns.length > 1 && (
                      <button
                        type="button"
                        title="Delete this column"
                        aria-label={`Delete column ${c || i + 1}`}
                        className="px-1 text-xs text-slate-400 hover:text-rose-700"
                        onClick={() => onChange({ columns: table.columns.filter((_, j) => j !== i), rows: table.rows.map((r) => ({ ...r, cells: r.cells.filter((_, j) => j !== i) })) })}
                      >
                        x
                      </button>
                    )}
                  </div>
                </th>
              ))}
              <th className="p-0.5 text-[11px] font-medium text-slate-500" title="H = high, L = low, A = abnormal">
                Flag
              </th>
              <th />
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r, i) => (
              <tr key={i}>
                {table.columns.map((_, j) => (
                  <td key={j} className="p-0.5">
                    <input className={cell} value={r.cells[j] ?? ""} aria-label={`Row ${i + 1}, ${table.columns[j]}`} onChange={(e) => setRow(i, { ...r, cells: table.columns.map((__, k) => (k === j ? e.target.value : (r.cells[k] ?? ""))) })} />
                  </td>
                ))}
                <td className="p-0.5">
                  <select className={cx(cell, "!min-w-[3.25rem]")} value={r.flag || ""} aria-label={`Row ${i + 1} flag`} onChange={(e) => setRow(i, { ...r, flag: e.target.value as "H" | "L" | "A" | "" })}>
                    <option value="">-</option>
                    <option value="H">H</option>
                    <option value="L">L</option>
                    <option value="A">A</option>
                  </select>
                </td>
                <td className="p-0.5">
                  <button type="button" title="Delete this row" aria-label={`Delete row ${i + 1}`} className="px-1 text-xs text-slate-400 hover:text-rose-700" onClick={() => onChange({ ...table, rows: table.rows.filter((_, j) => j !== i) })}>
                    x
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <Button variant="ghost" size="sm" onClick={() => onChange({ ...table, rows: [...table.rows, { cells: table.columns.map(() => ""), flag: "" }] })}>
          + Row
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onChange({ columns: [...table.columns, ""], rows: table.rows.map((r) => ({ ...r, cells: [...table.columns.map((_, k) => r.cells[k] ?? ""), ""] })) })}>
          + Column
        </Button>
        <Button variant="ghost" size="sm" className="text-rose-700" onClick={() => window.confirm("Remove the whole table from this document?") && onChange(undefined)}>
          Remove table
        </Button>
      </div>
    </div>
  );
}

const pointsToText = (pts: { x: string; y: number }[]) => pts.map((pt) => `${pt.x}, ${pt.y}`).join("\n");
function textToPoints(text: string): { x: string; y: number }[] {
  const out: { x: string; y: number }[] = [];
  for (const line of text.split("\n")) {
    const i = line.lastIndexOf(",");
    if (i < 0) continue;
    const y = Number(line.slice(i + 1).trim());
    const x = line.slice(0, i).trim();
    if (x && Number.isFinite(y) && line.slice(i + 1).trim() !== "") out.push({ x, y });
  }
  return out;
}

/** One series as plain text, a point per line. Keeps what was typed while it is not yet a valid point. */
function PointsEditor({ points, onChange }: { points: { x: string; y: number }[]; onChange: (pts: { x: string; y: number }[]) => void }) {
  const [text, setText] = useState(() => pointsToText(points));
  const incoming = pointsToText(points);
  // Re-sync when the points change from outside (guide patch, undo), but not while the user is mid-line.
  const [seen, setSeen] = useState(incoming);
  if (seen !== incoming) {
    setSeen(incoming);
    if (pointsToText(textToPoints(text)) !== incoming) setText(incoming);
  }
  const lines = text.split("\n").filter((l) => l.trim()).length;
  const valid = textToPoints(text).length;
  return (
    <div>
      <textarea
        className="w-full rounded border border-slate-300 px-2 py-1.5 font-mono text-xs focus:border-brand-500 focus:outline-none"
        rows={Math.max(4, Math.min(12, text.split("\n").length + 1))}
        value={text}
        placeholder={"Jan, 142\nFeb, 138\nMar, 131"}
        aria-label="Data points, one per line as label, value"
        onChange={(e) => {
          setText(e.target.value);
          onChange(textToPoints(e.target.value));
        }}
      />
      <p className={cx("text-[11px]", lines > valid ? "text-amber-700" : "text-slate-500")}>
        One point per line as: label, number. {valid} point{valid === 1 ? "" : "s"} read{lines > valid ? `, ${lines - valid} line${lines - valid === 1 ? "" : "s"} not understood yet` : ""}.
      </p>
    </div>
  );
}

function ChartEditor({ chart, onChange }: { chart: ArtifactChart; onChange: (c: ArtifactChart | undefined) => void }) {
  const up = (patch: Partial<ArtifactChart>) => onChange({ ...chart, ...patch });
  const num = (v: string) => (v.trim() === "" || !Number.isFinite(Number(v)) ? undefined : Number(v));
  const setRef = (key: "refLow" | "refHigh", v: string) => {
    const next = { ...chart };
    const n = num(v);
    if (n === undefined) delete next[key];
    else next[key] = n;
    onChange(next);
  };
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-5">
        <Field label="Chart type">
          <Select value={chart.kind} onChange={(e) => up({ kind: e.target.value as ArtifactChart["kind"], invertY: e.target.value === "audiogram" ? true : chart.invertY })}>
            <option value="line">Line</option>
            <option value="bar">Bar</option>
            <option value="audiogram">Audiogram</option>
          </Select>
        </Field>
        <Text label="X axis label" value={chart.xLabel} onChange={(v) => up({ xLabel: v })} />
        <Text label="Y axis label" value={chart.yLabel} onChange={(v) => up({ yLabel: v })} />
        <Text label="Reference low" value={chart.refLow ?? ""} onChange={(v) => setRef("refLow", v)} placeholder="none" />
        <Text label="Reference high" value={chart.refHigh ?? ""} onChange={(v) => setRef("refHigh", v)} placeholder="none" />
      </div>
      <label className="flex items-center gap-1.5 text-sm text-slate-700">
        <input type="checkbox" checked={!!chart.invertY} onChange={(e) => up({ invertY: e.target.checked || undefined })} />
        Draw the Y axis downwards (audiograms)
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        {chart.series.map((s, i) => (
          <div key={i} className="rounded border border-slate-200 p-2">
            <div className="mb-1.5 flex items-center gap-1.5">
              <Input value={s.name} placeholder="Series name, e.g. Systolic BP" aria-label="Series name" onChange={(e) => up({ series: chart.series.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
              {chart.series.length > 1 && (
                <button type="button" className="px-1 text-xs text-slate-400 hover:text-rose-700" onClick={() => up({ series: chart.series.filter((_, j) => j !== i) })}>
                  Delete
                </button>
              )}
            </div>
            <PointsEditor points={s.points} onChange={(pts) => up({ series: chart.series.map((x, j) => (j === i ? { ...x, points: pts } : x)) })} />
          </div>
        ))}
      </div>
      <div className="flex gap-1.5">
        <Button variant="ghost" size="sm" onClick={() => up({ series: [...chart.series, { name: "", points: [] }] })}>
          + Series
        </Button>
        <Button variant="ghost" size="sm" className="text-rose-700" onClick={() => window.confirm("Remove the chart data from this document?") && onChange(undefined)}>
          Remove chart
        </Button>
      </div>
    </div>
  );
}

export function ArtifactsSection({ p, set }: SectionProps) {
  const [sel, setSel] = useState<string | null>(p.artifacts[0]?.id || null);
  const [newType, setNewType] = useState<Artifact["type"]>("lab_report");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const d = p.artifacts.find((x) => x.id === sel) || p.artifacts[0];

  const up = (patch: Partial<Artifact>, drop: (keyof Artifact)[] = []) =>
    d &&
    set((c) => ({
      ...c,
      artifacts: c.artifacts.map((x) => {
        if (x.id !== d.id) return x;
        const next = { ...x, ...patch };
        for (const k of drop) delete next[k];
        return next;
      }),
    }));
  const add = () => {
    const id = nextId(p.artifacts, "d");
    set((c) => ({ ...c, artifacts: [...c.artifacts, { id, type: newType, title: "", date: "", author: "", release: { when: "start" }, ...template(newType) }] }));
    setSel(id);
  };
  const remove = () => {
    if (!d) return;
    const acts = p.actions.filter((a) => a.artifactIds?.includes(d.id)).length;
    const ms = (p.mismatches || []).filter((m) => m.artifactId === d.id).length;
    const uses = [acts ? `${acts} exam or order` : "", ms ? `${ms} patient-vs-chart mismatch${ms === 1 ? "" : "es"}` : ""].filter(Boolean).join(" and ");
    if (!window.confirm(uses ? `"${d.title}" is linked from ${uses}. Deleting it removes those links. Delete it?` : `Delete "${d.title || "this document"}"?`)) return;
    set((c) => deleteArtifact(c, d.id));
    setSel(null);
  };
  async function upload(file: File) {
    setUploading(true);
    setError(null);
    try {
      if (!/\.(png|jpe?g|gif|webp|pdf)$/i.test(file.name)) throw new Error("Attach an image (PNG, JPG, GIF, WebP) or a PDF.");
      const fd = new FormData();
      fd.append("file", file);
      const r = await api<{ url: string }>("/api/uploads", { method: "POST", body: fd });
      up({ fileUrl: r.url });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <Panel
      title={`Documents (${p.artifacts.length})`}
      subtitle="The patient's electronic record: lab reports, ECGs, imaging, prior notes, medication lists, flowsheets and trend charts. Each document has a release rule that decides when it appears in the student's chart. Values here must match the facts and the action results."
      action={
        <div className="flex items-center gap-1.5">
          <Select value={newType} onChange={(e) => setNewType(e.target.value as Artifact["type"])} aria-label="Type of the new document" className="w-52 py-1 text-xs">
            {ARTIFACT_TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </Select>
          <Button size="sm" className="whitespace-nowrap" onClick={add}>
            Add document
          </Button>
        </div>
      }
    >
      {!d ? (
        <p className="text-sm text-slate-500">No documents yet. Choose a type above and add one.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
          <ul className="space-y-1">
            {p.artifacts.map((x) => (
              <li key={x.id}>
                <button type="button" onClick={() => setSel(x.id)} className={cx("w-full rounded-md border px-2.5 py-2 text-left", x.id === d.id ? "border-brand-600 bg-brand-50" : "border-slate-200 hover:bg-slate-50")}>
                  <span className="block text-sm font-medium leading-snug text-slate-900">{x.title || "Untitled document"}</span>
                  <span className="mt-0.5 block text-[11px] text-slate-500">{typeLabel(x.type).split(" (")[0]}</span>
                  <span className={cx("mt-0.5 block text-[11px]", x.release.when === "start" ? "text-emerald-700" : "text-amber-700")}>{releaseLabel(p, x)}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="min-w-0 space-y-4">
            <div className="grid gap-3 sm:grid-cols-4">
              <Field label="Type">
                <Select value={d.type} onChange={(e) => up({ type: e.target.value as Artifact["type"] })}>
                  {ARTIFACT_TYPES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Text className="sm:col-span-3" label="Title" value={d.title} onChange={(v) => up({ title: v })} />
              <Text className="sm:col-span-2" label="Date shown in the record" value={d.date || ""} placeholder="e.g. 3 weeks ago, or 2026-09-18" onChange={(v) => up({ date: v })} />
              <Text className="sm:col-span-2" label="Author or performing service" value={d.author || ""} placeholder="e.g. Dr. Narang, Internal Medicine" onChange={(v) => up({ author: v })} />
            </div>

            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <Label>When does this document appear in the student&apos;s chart?</Label>
              <div className="grid gap-2 sm:grid-cols-[16rem_1fr]">
                <Select
                  value={d.release.when}
                  onChange={(e) => {
                    const when = e.target.value as Artifact["release"]["when"];
                    set((c) => setRelease(c, d.id, when === "start" ? { when } : { when, ref: when === "action" ? c.actions[0]?.id || "" : c.facts[0]?.id || "" }));
                  }}
                >
                  <option value="start">From the start of the visit</option>
                  <option value="action">When the student does an exam or order</option>
                  <option value="fact">When the patient discloses a fact</option>
                </Select>
                {d.release.when === "action" && (
                  <Select value={d.release.ref || ""} aria-label="Releasing action" onChange={(e) => set((c) => setRelease(c, d.id, { when: "action", ref: e.target.value }))}>
                    {!p.actions.some((a) => a.id === d.release.ref) && <option value={d.release.ref || ""}>Choose an exam or order</option>}
                    {p.actions.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.id} · {a.name}
                      </option>
                    ))}
                  </Select>
                )}
                {d.release.when === "fact" && (
                  <Select value={d.release.ref || ""} aria-label="Releasing fact" onChange={(e) => set((c) => setRelease(c, d.id, { when: "fact", ref: e.target.value }))}>
                    {!p.facts.some((f) => f.id === d.release.ref) && <option value={d.release.ref || ""}>Choose a fact</option>}
                    {p.facts.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.id} · {f.topic}
                      </option>
                    ))}
                  </Select>
                )}
              </div>
              <p className="mt-1.5 text-xs text-slate-500">
                {d.release.when === "start" && "Students can open it before asking anything."}
                {d.release.when === "action" && "It is added to the chart the moment the student performs or orders this. Use it for results the student has to ask for."}
                {d.release.when === "fact" && "It is added to the chart when the patient shares this fact, for example a home blood pressure log the patient mentions."}
              </p>
            </div>

            <Area label="Report text" hint="Free text body: note, narrative report, interpretation." minRows={4} value={d.body || ""} onChange={(v) => (v ? up({ body: v }) : up({}, ["body"]))} />

            <div>
              <Label>Table</Label>
              {d.table ? (
                <TableEditor table={d.table} onChange={(t) => (t ? up({ table: t }) : up({}, ["table"]))} />
              ) : (
                <Button variant="secondary" size="sm" onClick={() => up({ table: template(d.type).table || { columns: ["Item", "Value"], rows: [{ cells: ["", ""], flag: "" }] } })}>
                  Add a table
                </Button>
              )}
            </div>

            <div>
              <Label>Chart data</Label>
              {d.chart ? (
                <ChartEditor chart={d.chart} onChange={(c) => (c ? up({ chart: c }) : up({}, ["chart"]))} />
              ) : (
                <Button variant="secondary" size="sm" onClick={() => up({ chart: { kind: "line", xLabel: "Date", yLabel: "", series: [{ name: "", points: [] }] } })}>
                  Add a trend chart
                </Button>
              )}
            </div>

            <div>
              <Label>Attached image or PDF</Label>
              {d.fileUrl ? (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <a href={d.fileUrl} target="_blank" rel="noreferrer" className="text-brand-700 underline">
                    Open the attached file
                  </a>
                  <Button variant="ghost" size="sm" className="text-rose-700" onClick={() => up({}, ["fileUrl"])}>
                    Remove attachment
                  </Button>
                </div>
              ) : (
                <Input type="file" accept=".png,.jpg,.jpeg,.gif,.webp,.pdf" disabled={uploading} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
              )}
              <p className="mt-1 text-xs text-slate-500">
                {uploading ? "Uploading..." : "For an ECG tracing, X-ray, CT image or scanned report. Students see the file as attached; the simulator cannot read images, so put the findings in the report text as well."}
              </p>
              {error && (
                <Notice tone="red" className="mt-2">
                  {error}
                </Notice>
              )}
            </div>

            <div>
              <div className="mb-1.5 flex items-center gap-2">
                <Label className="mb-0">How students see it</Label>
                <Badge tone={d.release.when === "start" ? "green" : "amber"}>{releaseLabel(p, d)}</Badge>
              </div>
              <div className="rounded-md border border-slate-200 bg-white p-3">
                <ArtifactView artifact={d} />
              </div>
            </div>

            <div className="border-t border-slate-100 pt-3">
              <Button variant="ghost" size="sm" className="text-rose-700" onClick={remove}>
                Delete this document
              </Button>
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}
