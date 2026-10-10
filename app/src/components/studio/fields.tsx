"use client";

import { useEffect, type ReactNode } from "react";
import { Button, cx, Input, Label, Textarea } from "@/components/ui";

export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <Label>{label}</Label>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function Text({ label, hint, value, onChange, className, ...p }: { label?: ReactNode; hint?: ReactNode; value: string | number; onChange: (v: string) => void; className?: string } & Omit<React.ComponentProps<"input">, "value" | "onChange" | "className">) {
  const input = <Input {...p} value={value} onChange={(e) => onChange(e.target.value)} />;
  return label ? (
    <Field label={label} hint={hint} className={className}>
      {input}
    </Field>
  ) : (
    <div className={className}>{input}</div>
  );
}

/** Textarea that grows with its content. */
export function Area({ label, hint, value, onChange, className, minRows = 2, dense, ...p }: { label?: ReactNode; hint?: ReactNode; value: string; onChange: (v: string) => void; className?: string; minRows?: number; dense?: boolean } & Omit<React.ComponentProps<"textarea">, "value" | "onChange" | "className">) {
  const rows = Math.max(minRows, Math.min(14, value.split("\n").reduce((n, line) => n + Math.max(1, Math.ceil(line.length / 70)), 0)));
  const area = <Textarea {...p} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} className={cx("[field-sizing:content] resize-y", dense && "px-2 py-1.5 text-[13px] leading-snug")} />;
  return label ? (
    <Field label={label} hint={hint} className={className}>
      {area}
    </Field>
  ) : (
    <div className={className}>{area}</div>
  );
}

/** Editable list of short strings, one row each. */
export function StringList({ label, hint, items, onChange, placeholder, addLabel = "Add" }: { label?: ReactNode; hint?: ReactNode; items: string[]; onChange: (v: string[]) => void; placeholder?: string; addLabel?: string }) {
  return (
    <div>
      {label && <Label>{label}</Label>}
      <div className="space-y-1.5">
        {items.map((it, i) => (
          <div key={i} className="flex items-start gap-1.5">
            <Area dense minRows={1} className="flex-1" value={it} placeholder={placeholder} onChange={(v) => onChange(items.map((x, j) => (j === i ? v : x)))} />
            <RemoveButton label="Remove" onClick={() => onChange(items.filter((_, j) => j !== i))} />
          </div>
        ))}
      </div>
      <Button type="button" variant="ghost" size="sm" className="mt-1.5" onClick={() => onChange([...items, ""])}>
        + {addLabel}
      </Button>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function RemoveButton({ onClick, label = "Delete" }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label} className="mt-0.5 shrink-0 rounded px-1.5 py-1 text-xs text-slate-400 hover:bg-rose-50 hover:text-rose-700">
      {label}
    </button>
  );
}

export function Panel({ title, subtitle, action, children, className }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-lg border border-slate-200 bg-white shadow-sm", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          {subtitle && <p className="mt-0.5 max-w-3xl text-xs leading-relaxed text-slate-500">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Dialog({ title, onClose, children, footer, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-8" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" className={cx("w-full rounded-lg bg-white shadow-xl", wide ? "max-w-4xl" : "max-w-xl")}>
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button type="button" onClick={onClose} className="rounded px-2 py-1 text-sm text-slate-500 hover:bg-slate-100">
            Close
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Notice({ tone = "slate", children, className }: { tone?: "slate" | "amber" | "red" | "green" | "teal"; children: ReactNode; className?: string }) {
  const tones = {
    slate: "border-slate-200 bg-slate-50 text-slate-700",
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    red: "border-rose-200 bg-rose-50 text-rose-900",
    green: "border-emerald-200 bg-emerald-50 text-emerald-900",
    teal: "border-brand-200 bg-brand-50 text-brand-900",
  };
  return <div className={cx("rounded-md border px-3 py-2 text-sm", tones[tone], className)}>{children}</div>;
}

/** Reads `await res.json()` and throws on { error } or a non-2xx status. */
export async function api<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init || {};
  const res = await fetch(url, json === undefined ? rest : { ...rest, method: rest.method || "POST", headers: { "Content-Type": "application/json", ...(rest.headers || {}) }, body: JSON.stringify(json) });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    throw new Error(res.ok ? "The server sent an unreadable reply." : `Request failed (${res.status}).`);
  }
  const err = (data as { error?: string } | null)?.error;
  if (err || !res.ok) throw Object.assign(new Error(err || `Request failed (${res.status}).`), { status: res.status, data });
  return data as T;
}

/** Starts a visit with the case and returns the encounter URL. Faculty may start drafts. */
export async function startTestVisit(caseId: string): Promise<string> {
  const { id } = await api<{ id: string }>("/api/encounters", { json: { caseId } });
  return `/encounter/${id}`;
}
