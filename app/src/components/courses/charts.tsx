"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";

// Chart tokens. One series colour throughout (checked with the dataviz palette validator against a
// white surface); text always uses ink tokens, never the series colour.
const SERIES = "#2a78d6";
const SERIES_TRACK = "#dbe9fa";
const GRID = "#e2e8f0";
const AXIS = "#cbd5e1";
const INK = "#0f172a";
const MUTED = "#64748b";

function Tip({ children }: { children: ReactNode }) {
  return (
    <span
      role="tooltip"
      className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 hidden w-max max-w-[18rem] -translate-x-1/2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-left text-xs font-normal text-slate-700 shadow-md group-hover:block group-focus-visible:block"
    >
      {children}
    </span>
  );
}

// ---------- Bar list: compare one measure across named items ----------

export interface BarItem {
  key: string;
  label: string;
  /** Second line under the label. */
  sub?: string;
  tag?: { text: string; tone: "red" | "amber" | "slate" };
  /** 0..max */
  value: number;
  /** Text at the bar's tip, e.g. "62%" or "6 of 9". */
  display: string;
  /** Extra line in the hover tooltip. */
  detail?: string;
}
const TAG = { red: "bg-rose-100 text-rose-800", amber: "bg-amber-100 text-amber-800", slate: "bg-slate-100 text-slate-700" };

export function BarList({ items, max = 100, unit }: { items: BarItem[]; max?: number; unit: string }) {
  return (
    <ul className="space-y-0.5" aria-label={unit}>
      {items.map((it) => {
        const pct = Math.max(0, Math.min(100, (it.value / max) * 100));
        return (
          <li key={it.key} tabIndex={0} className="group grid grid-cols-1 gap-x-4 gap-y-1 rounded-md px-2 py-2 outline-none hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:ring-2 focus-visible:ring-brand-200 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-center">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5 text-sm text-slate-900">
                {it.tag && <span className={`rounded px-1.5 py-0.5 text-[14px] font-medium ${TAG[it.tag.tone]}`}>{it.tag.text}</span>}
                <span>{it.label}</span>
              </div>
              {it.sub && <div className="mt-0.5 text-xs text-slate-500">{it.sub}</div>}
            </div>
            <div className="relative flex items-center gap-2">
              <div className="h-3 flex-1 border-l" style={{ borderColor: AXIS }}>
                <div className="h-3 rounded-r transition-opacity group-hover:opacity-80" style={{ width: `${pct}%`, minWidth: it.value > 0 ? 2 : 0, background: SERIES }} />
              </div>
              <span className="w-16 shrink-0 text-right text-xs font-medium tabular-nums text-slate-800">{it.display}</span>
              <Tip>
                <span className="block font-semibold text-slate-900">{it.display}</span>
                <span className="block">{it.label}</span>
                {it.detail && <span className="block text-slate-500">{it.detail}</span>}
              </Tip>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ---------- Meter: one ratio against a limit ----------

/** Patient comfort 0-100. The fill colour carries severity and always comes with a word. */
export function ComfortMeter({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const state = v < 30 ? { word: "Very low", fill: "#d03b3b", track: "#f6dada" } : v < 45 ? { word: "Low", fill: "#c98500", track: "#f6e7c4" } : { word: v >= 70 ? "High" : "Steady", fill: SERIES, track: SERIES_TRACK };
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-slate-500">Patient comfort</span>
        <span className="font-medium text-slate-800">
          {v} <span className="font-normal text-slate-500">· {state.word}</span>
        </span>
      </div>
      <div className="mt-1 h-2 rounded-full" style={{ background: state.track }} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={v} aria-label={`Patient comfort ${v} of 100, ${state.word}`}>
        <div className="h-2 rounded-full" style={{ width: `${v}%`, background: state.fill }} />
      </div>
    </div>
  );
}

// ---------- Skill ratings: one dot per rubric domain on the level scale ----------

export interface LevelTick {
  level: number;
  rating: number;
}
export interface SkillDot {
  key: string;
  name: string;
  rating: number;
  n: number;
}

const scale = (lo: number, hi: number) => (v: number) => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));

export function SkillDots({ items, ticks, lo, hi }: { items: SkillDot[]; ticks: LevelTick[]; lo: number; hi: number }) {
  const x = scale(lo, hi);
  const cols = "grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)_3rem] items-center gap-x-3 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)_3rem]";
  return (
    <div>
      <div className={`${cols} pb-1`}>
        <span className="text-[14px] text-slate-500">Rubric domain</span>
        <div className="relative h-4">
          {ticks.map((t) => (
            <span key={t.level} className="absolute -translate-x-1/2 whitespace-nowrap text-[14px] tabular-nums text-slate-500" style={{ left: `${x(t.rating)}%` }}>
              Level {t.level}
            </span>
          ))}
        </div>
        <span className="text-right text-[14px] text-slate-500">Rating</span>
      </div>
      <ul>
        {items.map((it) => (
          <li key={it.key} tabIndex={0} className={`${cols} group rounded-md py-1.5 outline-none hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:ring-2 focus-visible:ring-brand-200`}>
            <span className="pl-1 text-sm leading-tight text-slate-800">{it.name}</span>
            <div className="relative h-6">
              {ticks.map((t) => (
                <span key={t.level} className="absolute inset-y-0 w-px" style={{ left: `${x(t.rating)}%`, background: GRID }} />
              ))}
              <span className="absolute top-1/2 h-px w-full" style={{ background: GRID }} />
              <span className="absolute top-1/2 -ml-[7px] -mt-[7px] h-3.5 w-3.5 rounded-full ring-2 ring-white" style={{ left: `${x(it.rating)}%`, background: SERIES }}>
                <Tip>
                  <span className="block font-semibold text-slate-900">Rating {Math.round(it.rating)}</span>
                  <span className="block">{it.name}</span>
                  <span className="block text-slate-500">
                    From {it.n} scored visit{it.n === 1 ? "" : "s"}
                  </span>
                </Tip>
              </span>
            </div>
            <span className="pr-1 text-right text-sm font-medium tabular-nums text-slate-900">{Math.round(it.rating)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- Rating history: line over visits ----------

export interface HistoryPoint {
  /** Short x label, e.g. "Start" or "Visit 3". */
  label: string;
  value: number;
  /** Tooltip lines under the value. */
  lines: string[];
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export function RatingLine({ points, ticks, lo, hi, name }: { points: HistoryPoint[]; ticks: LevelTick[]; lo: number; hi: number; name: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = 240;
  const m = { top: 14, right: 52, bottom: 26, left: 56 };
  const W = Math.max(width, 280);
  const iw = W - m.left - m.right;
  const ih = H - m.top - m.bottom;
  const vals = points.map((p) => p.value);
  const yLo = Math.min(lo, Math.floor((Math.min(...vals) - 20) / 50) * 50);
  const yHi = Math.max(hi, Math.ceil((Math.max(...vals) + 20) / 50) * 50);
  const xAt = (i: number) => m.left + (points.length <= 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const yAt = (v: number) => m.top + ih - ((v - yLo) / (yHi - yLo)) * ih;
  const path = points.map((p, i) => `${i ? "L" : "M"}${xAt(i).toFixed(1)},${yAt(p.value).toFixed(1)}`).join(" ");
  const last = points.length - 1;
  // Label at most ~8 x positions so they never collide.
  const step = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(iw / 70))));
  const active = hover ?? null;

  function move(e: React.PointerEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(xAt(i) - px) < Math.abs(xAt(best) - px)) best = i;
    setHover(best);
  }
  function key(e: React.KeyboardEvent) {
    if (e.key === "ArrowRight") setHover((h) => Math.min(last, (h ?? -1) + 1));
    else if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? points.length) - 1));
    else if (e.key === "Escape") setHover(null);
    else return;
    e.preventDefault();
  }

  return (
    <div ref={ref} className="relative">
      {width > 0 && (
        <svg
          width={W}
          height={H}
          role="img"
          aria-label={`${name} rating after each scored visit. Latest ${Math.round(points[last].value)}. Use the arrow keys to read each visit.`}
          tabIndex={0}
          className="block touch-none rounded outline-none focus-visible:ring-2 focus-visible:ring-brand-200"
          onPointerMove={move}
          onPointerLeave={() => setHover(null)}
          onKeyDown={key}
          onBlur={() => setHover(null)}
        >
          {ticks
            .filter((t) => t.rating >= yLo && t.rating <= yHi)
            .map((t) => (
              <g key={t.level}>
                <line x1={m.left} x2={W - m.right} y1={yAt(t.rating)} y2={yAt(t.rating)} stroke={GRID} strokeWidth={1} />
                <text x={m.left - 8} y={yAt(t.rating)} dy="0.32em" textAnchor="end" fontSize={11} fill={MUTED}>
                  Level {t.level}
                </text>
              </g>
            ))}
          <line x1={m.left} x2={W - m.right} y1={m.top + ih} y2={m.top + ih} stroke={AXIS} strokeWidth={1} />
          {points.map((p, i) =>
            i % step === 0 || i === last ? (
              i !== last && last - i < step * 0.6 ? null : (
                <text key={i} x={xAt(i)} y={H - 8} textAnchor="middle" fontSize={11} fill={MUTED}>
                  {p.label}
                </text>
              )
            ) : null,
          )}
          {active !== null && <line x1={xAt(active)} x2={xAt(active)} y1={m.top} y2={m.top + ih} stroke={AXIS} strokeWidth={1} />}
          {points.length > 1 && <path d={path} fill="none" stroke={SERIES} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
          {points.map((p, i) =>
            i === last || i === active || points.length <= 12 ? <circle key={i} cx={xAt(i)} cy={yAt(p.value)} r={i === last || i === active ? 5 : 4} fill={SERIES} stroke="#fff" strokeWidth={2} /> : null,
          )}
          <text x={xAt(last) + 10} y={yAt(points[last].value)} dy="0.32em" fontSize={12} fontWeight={600} fill={INK}>
            {Math.round(points[last].value)}
          </text>
        </svg>
      )}
      {width === 0 && <div style={{ height: H }} />}
      {active !== null && width > 0 && (
        <div
          className="pointer-events-none absolute z-10 w-max max-w-[16rem] rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 shadow-md"
          style={{ top: Math.max(0, yAt(points[active].value) - 12), ...(xAt(active) > W / 2 ? { right: W - xAt(active) + 12 } : { left: xAt(active) + 12 }) }}
        >
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-3 rounded" style={{ background: SERIES }} />
            <span className="text-sm font-semibold text-slate-900">{Math.round(points[active].value)}</span>
            <span className="text-slate-500">{name}</span>
          </div>
          <div className="mt-0.5 font-medium text-slate-800">{points[active].label}</div>
          {points[active].lines.map((l, i) => (
            <div key={i} className="text-slate-500">
              {l}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Score trend for one patient: a small line of attempts ----------

export function ScoreSpark({ scores, labels }: { scores: number[]; labels: string[] }) {
  const W = 132;
  const H = 40;
  const pad = 7;
  const x = (i: number) => (scores.length <= 1 ? W / 2 : pad + (i / (scores.length - 1)) * (W - pad * 2));
  const y = (v: number) => H - pad - (Math.max(0, Math.min(100, v)) / 100) * (H - pad * 2);
  return (
    <svg width={W} height={H} role="img" aria-label={`Score by attempt: ${scores.map((s) => `${Math.round(s)}%`).join(", ")}`} className="block">
      <line x1={0} x2={W} y1={H - pad} y2={H - pad} stroke={AXIS} strokeWidth={1} />
      <line x1={0} x2={W} y1={pad} y2={pad} stroke={GRID} strokeWidth={1} />
      {scores.length > 1 && <path d={scores.map((s, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(s).toFixed(1)}`).join(" ")} fill="none" stroke={SERIES} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
      {scores.map((s, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(s)} r={4} fill={SERIES} stroke="#fff" strokeWidth={2} />
          {/* Larger invisible target so the dot is easy to hover. */}
          <circle cx={x(i)} cy={y(s)} r={12} fill="transparent">
            <title>{labels[i]}</title>
          </circle>
        </g>
      ))}
    </svg>
  );
}
