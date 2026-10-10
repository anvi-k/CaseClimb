"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui";
import { visitUrl } from "@/lib/courses/settings";

/** Starts a visit through POST /api/encounters and opens it. `body` is sent as-is. */
export default function StartVisit({
  body,
  label = "Start visit",
  variant = "primary",
  size = "md",
}: {
  body: Record<string, unknown>;
  label?: string;
  variant?: "primary" | "secondary";
  size?: "sm" | "md" | "lg";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function start() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/encounters", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json();
      if (!res.ok || j.error) throw new Error(j.error || "Could not start the visit");
      router.push(visitUrl(j.id));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button variant={variant} size={size} onClick={start} disabled={busy}>
        {busy ? "Starting…" : label}
      </Button>
      {error && <span className="max-w-xs text-right text-xs text-rose-700">{error}</span>}
    </span>
  );
}
