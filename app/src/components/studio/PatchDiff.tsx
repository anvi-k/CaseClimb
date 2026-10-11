"use client";

import { useMemo } from "react";
import { cx } from "@/components/ui";
import type { OpView } from "@/lib/studio/patch";

/** Word-level diff of two short texts. Returns the words of each side marked as kept or changed. */
function wordDiff(a: string, b: string): { before: { t: string; ch: boolean }[]; after: { t: string; ch: boolean }[] } | null {
  const A = a.split(/(\s+)/);
  const B = b.split(/(\s+)/);
  if (A.length * B.length > 250000) return null;
  const m = A.length;
  const n = B.length;
  const dp: Uint16Array[] = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const before: { t: string; ch: boolean }[] = [];
  const after: { t: string; ch: boolean }[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (A[i] === B[j]) {
      before.push({ t: A[i++], ch: false });
      after.push({ t: B[j++], ch: false });
    } else if (dp[i + 1][j] >= dp[i][j + 1]) before.push({ t: A[i++], ch: true });
    else after.push({ t: B[j++], ch: true });
  }
  while (i < m) before.push({ t: A[i++], ch: true });
  while (j < n) after.push({ t: B[j++], ch: true });
  // When most of the text is new, word marks are noise; show the two versions plainly instead.
  const words = (xs: { t: string; ch: boolean }[], ch?: boolean) => xs.filter((w) => w.t.trim() && (ch === undefined || w.ch === ch)).length;
  if (words(before, true) + words(after, true) > 0.6 * (words(before) + words(after))) return null;
  return { before, after };
}

function Change({ v }: { v: OpView }) {
  const d = useMemo(() => (v.verb === "Change" && v.before && v.after ? wordDiff(v.before, v.after) : null), [v]);
  const box = "whitespace-pre-wrap break-words rounded border px-2 py-1.5 text-[15px] leading-snug";
  return (
    <div className="space-y-1">
      {v.verb !== "Add" && (
        <div className={cx(box, "border-rose-200 bg-rose-50 text-slate-800")}>
          <span className="mr-1.5 text-[14px] font-semibold uppercase tracking-wide text-rose-700">{v.verb === "Remove" ? "Removed" : "Now"}</span>
          {d ? d.before.map((w, k) => (w.ch && w.t.trim() ? <del key={k} className="bg-rose-200 decoration-rose-700">{w.t}</del> : <span key={k}>{w.t}</span>)) : v.before || <em className="text-slate-400">empty</em>}
        </div>
      )}
      {v.verb !== "Remove" && (
        <div className={cx(box, "border-emerald-200 bg-emerald-50 text-slate-800")}>
          <span className="mr-1.5 text-[14px] font-semibold uppercase tracking-wide text-emerald-700">{v.verb === "Add" ? "Added" : "Proposed"}</span>
          {d ? d.after.map((w, k) => (w.ch && w.t.trim() ? <ins key={k} className="bg-emerald-200 no-underline">{w.t}</ins> : <span key={k}>{w.t}</span>)) : v.after || <em className="text-slate-400">empty</em>}
        </div>
      )}
    </div>
  );
}

/** A reviewable list of proposed edits. With `picked`, each edit gets a checkbox. */
export default function PatchDiff({ views, picked, onPick }: { views: OpView[]; picked?: boolean[]; onPick?: (i: number, on: boolean) => void }) {
  return (
    <ol className="space-y-2.5">
      {views.map((v, i) => (
        <li key={i}>
          <label className="mb-1 flex items-start gap-1.5 text-xs font-medium text-slate-700">
            {picked && onPick && <input type="checkbox" className="mt-0.5" checked={picked[i]} onChange={(e) => onPick(i, e.target.checked)} aria-label={`Include change ${i + 1}`} />}
            <span>
              <span className={cx("mr-1", v.verb === "Add" ? "text-emerald-700" : v.verb === "Remove" ? "text-rose-700" : "text-slate-500")}>{v.verb}</span>
              {v.where}
            </span>
          </label>
          <Change v={v} />
        </li>
      ))}
    </ol>
  );
}
