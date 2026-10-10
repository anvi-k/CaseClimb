"use client";
import { toDate } from "@/lib/courses/settings";

/** A timestamp shown in the viewer's own time zone. */
export default function When({ at, time = true }: { at: string | null | undefined; time?: boolean }) {
  if (!at) return null;
  const d = toDate(at);
  if (Number.isNaN(d.getTime())) return null;
  const text = d.toLocaleString(undefined, time ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric", year: "numeric" });
  return (
    <time dateTime={d.toISOString()} suppressHydrationWarning>
      {text}
    </time>
  );
}
