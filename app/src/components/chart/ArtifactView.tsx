"use client";

import { useState } from "react";
import type { Artifact, ArtifactChart } from "@/lib/types";

const TYPE_LABEL: Record<Artifact["type"], string> = {
  lab_report: "Lab report",
  ecg: "ECG",
  imaging: "Imaging",
  note: "Note",
  medication_list: "Medications",
  flowsheet: "Flowsheet",
  chart: "Trend",
  form: "Form",
  other: "Document",
};
export const artifactTypeLabel = (t: Artifact["type"]) => TYPE_LABEL[t] || "Document";

// Categorical series colours in fixed order (validated for colour-vision deficiency on a light surface).
const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"];
const FLAG: Record<string, string> = { H: "text-rose-700 font-semibold", L: "text-sky-700 font-semibold", A: "text-amber-700 font-semibold" };

function DataTable({ table }: { table: NonNullable<Artifact["table"]> }) {
  // Some tables already carry their own flag column; do not add a second one.
  const ownFlag = table.columns.some((c) => /flag|status/i.test(c));
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-[14px]">
        <thead>
          <tr className="border-b border-slate-200 text-xs text-slate-500">
            {table.columns.map((c, i) => (
              <th key={i} className="px-2 py-1.5 font-medium">
                {c}
              </th>
            ))}
            {!ownFlag && <th className="w-8 px-2 py-1.5 font-medium">Flag</th>}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((r, i) => (
            <tr key={i} className={`border-b border-slate-100 ${r.flag ? "bg-amber-50/50" : ""}`}>
              {r.cells.map((c, j) => (
                <td key={j} className={`px-2 py-1.5 tabular-nums ${r.flag && (j === 1 || (ownFlag && /flag|status/i.test(table.columns[j] || ""))) ? FLAG[r.flag] : "text-slate-800"}`}>
                  {c}
                </td>
              ))}
              {!ownFlag && <td className={`px-2 py-1.5 ${r.flag ? FLAG[r.flag] : ""}`}>{r.flag === "H" ? "High" : r.flag === "L" ? "Low" : r.flag === "A" ? "Abnormal" : ""}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function niceTicks(min: number, max: number, n = 4) {
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const raw = (max - min) / n;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toFixed(6)));
  return { lo, hi, ticks };
}

export function TrendChart({ chart }: { chart: ArtifactChart }) {
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const series = chart.series.filter((s) => s.points?.length).slice(0, SERIES.length);
  // x is categorical and ordered as first seen across series.
  const xs: string[] = [];
  for (const s of series) for (const p of s.points) if (!xs.includes(p.x)) xs.push(p.x);
  if (!series.length || !xs.length) return <p className="text-sm text-slate-500">No data to plot.</p>;

  const ys = series.flatMap((s) => s.points.map((p) => p.y));
  if (chart.refLow !== undefined) ys.push(chart.refLow);
  if (chart.refHigh !== undefined) ys.push(chart.refHigh);
  const { lo, hi, ticks } = niceTicks(Math.min(...ys), Math.max(...ys));
  const W = 560, H = 240, L = 44, R = 14, T = 12, B = 34;
  const px = (i: number) => (xs.length === 1 ? L + (W - L - R) / 2 : L + (i * (W - L - R)) / (xs.length - 1));
  const py = (v: number) => {
    const t = (v - lo) / (hi - lo);
    return chart.invertY ? T + t * (H - T - B) : H - B - t * (H - T - B);
  };
  const isAudio = chart.kind === "audiogram";
  const barW = Math.min(28, (W - L - R) / xs.length / (series.length + 0.6));

  if (asTable) {
    return (
      <div>
        <DataTable table={{ columns: [chart.xLabel, ...series.map((s) => s.name)], rows: xs.map((x) => ({ cells: [x, ...series.map((s) => String(s.points.find((p) => p.x === x)?.y ?? ""))] })) }} />
        <button onClick={() => setAsTable(false)} className="mt-2 text-xs text-brand-600 hover:underline">
          Show as chart
        </button>
      </div>
    );
  }

  return (
    <div>
      {series.length > 1 && (
        <div className="mb-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
          {series.map((s, i) => (
            <span key={s.name} className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: SERIES[i] }} />
              {s.name}
              {isAudio ? (i === 0 ? " (O)" : " (X)") : ""}
            </span>
          ))}
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${chart.yLabel} by ${chart.xLabel}`} onMouseLeave={() => setHover(null)}>
        {chart.refLow !== undefined && chart.refHigh !== undefined && (
          <rect x={L} width={W - L - R} y={Math.min(py(chart.refLow), py(chart.refHigh))} height={Math.abs(py(chart.refHigh) - py(chart.refLow))} fill="#e8eef3" opacity={0.7} />
        )}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={py(t)} y2={py(t)} stroke="#e5e9ee" strokeWidth={1} />
            <text x={L - 6} y={py(t) + 3.5} textAnchor="end" fontSize={10} fill="#64748b">
              {t}
            </text>
          </g>
        ))}
        {xs.map((x, i) =>
          xs.length <= 12 || i % Math.ceil(xs.length / 12) === 0 ? (
            <text key={x + i} x={px(i)} y={H - B + 14} textAnchor="middle" fontSize={10} fill="#64748b">
              {x.length > 12 ? x.slice(0, 11) + "…" : x}
            </text>
          ) : null,
        )}
        <text x={L} y={H - 4} fontSize={10} fill="#94a3b8">
          {chart.xLabel}
        </text>
        <text x={W - R} y={H - 4} fontSize={10} fill="#94a3b8" textAnchor="end">
          {chart.yLabel}
          {chart.refLow !== undefined && chart.refHigh !== undefined ? ` · shaded: reference ${chart.refLow}–${chart.refHigh}` : ""}
        </text>
        {hover !== null && <line x1={px(hover)} x2={px(hover)} y1={T} y2={H - B} stroke="#94a3b8" strokeWidth={1} strokeDasharray="3 3" />}
        {series.map((s, si) => {
          const pts = s.points.map((p) => ({ x: px(xs.indexOf(p.x)), y: py(p.y), v: p.y }));
          if (chart.kind === "bar") {
            const base = chart.invertY ? T : H - B;
            return pts.map((p, i) => {
              const x = p.x + (si - (series.length - 1) / 2) * (barW + 2) - barW / 2;
              return <rect key={si + "-" + i} x={x} width={barW} y={Math.min(p.y, base)} height={Math.max(1, Math.abs(base - p.y))} rx={3} fill={SERIES[si]} />;
            });
          }
          return (
            <g key={s.name}>
              <polyline points={pts.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke={SERIES[si]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {pts.map((p, i) =>
                isAudio && si === 1 ? (
                  <g key={i} stroke={SERIES[si]} strokeWidth={2} strokeLinecap="round">
                    <line x1={p.x - 4} y1={p.y - 4} x2={p.x + 4} y2={p.y + 4} />
                    <line x1={p.x - 4} y1={p.y + 4} x2={p.x + 4} y2={p.y - 4} />
                  </g>
                ) : (
                  <circle key={i} cx={p.x} cy={p.y} r={4} fill={isAudio ? "#fff" : SERIES[si]} stroke={isAudio ? SERIES[si] : "#fff"} strokeWidth={2} />
                ),
              )}
            </g>
          );
        })}
        {/* Hit areas wider than the marks */}
        {xs.map((x, i) => (
          <rect key={"hit" + i} x={px(i) - (W - L - R) / xs.length / 2} width={(W - L - R) / xs.length} y={T} height={H - T - B} fill="transparent" onMouseEnter={() => setHover(i)} />
        ))}
      </svg>
      <div className="flex min-h-5 items-center justify-between text-xs text-slate-600">
        <span>
          {hover !== null && (
            <>
              <span className="font-medium text-slate-900">{xs[hover]}</span>
              {series.map((s, i) => {
                const p = s.points.find((q) => q.x === xs[hover]);
                return p ? (
                  <span key={s.name} className="ml-3 inline-flex items-center gap-1">
                    <span className="inline-block h-2 w-2 rounded-full" style={{ background: SERIES[i] }} />
                    {series.length > 1 ? s.name + ": " : ""}
                    <span className="font-medium tabular-nums text-slate-900">{p.y}</span>
                  </span>
                ) : null;
              })}
            </>
          )}
        </span>
        <button onClick={() => setAsTable(true)} className="text-brand-600 hover:underline">
          Show as table
        </button>
      </div>
    </div>
  );
}

/** Renders one EHR document: header, uploaded file, report text, result table and trend chart. */
export default function ArtifactView({ artifact: a }: { artifact: Artifact }) {
  const isImage = a.fileUrl && !/\.pdf($|\?)/i.test(a.fileUrl);
  return (
    <article className="text-sm">
      <header className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 border-b border-slate-200 pb-2">
        <div>
          <div className="text-[12px] font-medium uppercase tracking-wide text-slate-500">{artifactTypeLabel(a.type)}</div>
          <h3 className="font-semibold text-slate-900">{a.title}</h3>
        </div>
        <div className="text-right text-xs text-slate-500">
          {a.date && <div>{a.date}</div>}
          {a.author && <div>{a.author}</div>}
        </div>
      </header>
      {a.fileUrl &&
        (isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={a.fileUrl} alt={a.title} className="mb-3 max-h-[28rem] w-full rounded border border-slate-200 bg-black object-contain" />
        ) : (
          <a href={a.fileUrl} target="_blank" rel="noreferrer" className="mb-3 inline-block rounded border border-slate-300 px-3 py-1.5 text-brand-600 hover:bg-slate-50">
            Open attached file
          </a>
        ))}
      {a.chart && (
        <div className="mb-3">
          <TrendChart chart={a.chart} />
        </div>
      )}
      {a.table && (
        <div className="mb-3">
          <DataTable table={a.table} />
        </div>
      )}
      {a.body && <div className={`whitespace-pre-wrap leading-relaxed text-slate-800 ${a.type === "ecg" || a.type === "imaging" ? "font-mono text-[13.5px]" : ""}`}>{a.body}</div>}
    </article>
  );
}
