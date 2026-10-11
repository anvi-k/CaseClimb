"use client";
import { useState } from "react";
import { Label, Select } from "@/components/ui";
import { RatingLine, type HistoryPoint, type LevelTick } from "./charts";

export interface HistorySeries {
  key: string;
  name: string;
  points: HistoryPoint[];
}

/** Rating after each scored visit, for all domains together or one at a time, with a table of the same numbers. */
export default function RatingHistory({ series, ticks, lo, hi }: { series: HistorySeries[]; ticks: LevelTick[]; lo: number; hi: number }) {
  const [key, setKey] = useState(series[0].key);
  const [table, setTable] = useState(false);
  const s = series.find((x) => x.key === key) || series[0];
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div className="w-full max-w-xs">
          <Label htmlFor="hist-domain">Show</Label>
          <Select id="hist-domain" value={key} onChange={(e) => setKey(e.target.value)}>
            {series.map((x) => (
              <option key={x.key} value={x.key}>
                {x.name}
              </option>
            ))}
          </Select>
        </div>
        <button type="button" className="text-xs font-medium text-brand-700 hover:underline" aria-expanded={table} onClick={() => setTable(!table)}>
          {table ? "Show as chart" : "Show as table"}
        </button>
      </div>
      {table ? (
        <div className="max-h-72 overflow-y-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="py-1.5 pr-3 font-medium">Visit</th>
                <th className="py-1.5 pr-3 font-medium">Details</th>
                <th className="py-1.5 text-right font-medium">Rating after</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {s.points.map((p, i) => (
                <tr key={i}>
                  <td className="whitespace-nowrap py-1.5 pr-3 text-slate-800">{p.label}</td>
                  <td className="py-1.5 pr-3 text-xs text-slate-600">{p.lines.join(" · ")}</td>
                  <td className="py-1.5 text-right font-medium tabular-nums text-slate-900">{Math.round(p.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <RatingLine points={s.points} ticks={ticks} lo={lo} hi={hi} name={s.name} />
      )}
    </div>
  );
}
