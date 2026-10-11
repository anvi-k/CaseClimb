import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

const BTN = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 disabled:bg-slate-300",
  secondary: "bg-white text-slate-800 border border-slate-300 hover:bg-slate-50 disabled:text-slate-400",
  danger: "bg-rose-600 text-white hover:bg-rose-700 disabled:bg-slate-300",
  ghost: "text-slate-700 hover:bg-slate-100 disabled:text-slate-400",
};
const SIZE = { sm: "px-2.5 py-1 text-xs", md: "px-3.5 py-2 text-sm", lg: "px-5 py-2.5 text-base" };
type BtnProps = { variant?: keyof typeof BTN; size?: keyof typeof SIZE };

export function Button({ variant = "primary", size = "md", className, ...p }: ComponentProps<"button"> & BtnProps) {
  return <button {...p} className={cx("inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:cursor-not-allowed", BTN[variant], SIZE[size], className)} />;
}
export function LinkButton({ variant = "primary", size = "md", className, ...p }: ComponentProps<typeof Link> & BtnProps) {
  return <Link {...p} className={cx("inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors", BTN[variant], SIZE[size], className)} />;
}
export function Card({ className, ...p }: ComponentProps<"div">) {
  return <div {...p} className={cx("rounded-lg border border-slate-200 bg-white shadow-sm", className)} />;
}
export function CardHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
const TONES = {
  slate: "bg-slate-100 text-slate-700",
  green: "bg-emerald-100 text-emerald-800",
  amber: "bg-amber-100 text-amber-800",
  red: "bg-rose-100 text-rose-800",
  blue: "bg-sky-100 text-sky-800",
  teal: "bg-brand-100 text-brand-700",
  violet: "bg-violet-100 text-violet-800",
};
export function Badge({ tone = "slate", className, ...p }: ComponentProps<"span"> & { tone?: keyof typeof TONES }) {
  return <span {...p} className={cx("inline-flex items-center rounded px-1.5 py-0.5 text-[12px] font-medium", TONES[tone], className)} />;
}
const FIELD = "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200";
export function Input({ className, ...p }: ComponentProps<"input">) {
  return <input {...p} className={cx(FIELD, className)} />;
}
export function Textarea({ className, ...p }: ComponentProps<"textarea">) {
  return <textarea {...p} className={cx(FIELD, className)} />;
}
export function Select({ className, ...p }: ComponentProps<"select">) {
  return <select {...p} className={cx(FIELD, className)} />;
}
export function Label({ className, ...p }: ComponentProps<"label">) {
  return <label {...p} className={cx("mb-1 block text-xs font-medium text-slate-600", className)} />;
}
export function PageHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-600">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-500">{children}</div>;
}
export { cx };
