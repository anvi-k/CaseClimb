"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui";

async function post(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await res.json().catch(() => ({ error: "Request failed" }));
  if (!res.ok || j.error) throw new Error(j.error || "Request failed");
  return j;
}

/** The join code students type in, with copy and regenerate. */
export function JoinCode({ courseId, code }: { courseId: string; code: string }) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="rounded-md border border-slate-300 bg-slate-50 px-3 py-1.5 font-mono text-lg font-semibold tracking-[0.25em] text-slate-900">{code}</span>
      <Button
        variant="secondary"
        size="sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            /* clipboard unavailable: the code is on screen */
          }
        }}
      >
        {copied ? "Copied" : "Copy"}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={async () => {
          if (!confirm("Replace the join code? The current code stops working. Students already enrolled stay enrolled.")) return;
          setBusy(true);
          await post(`/api/courses/${courseId}`, "PATCH", { newCode: true }).catch((e) => alert(e.message));
          setBusy(false);
          router.refresh();
        }}
      >
        New code
      </Button>
    </div>
  );
}

export function RemoveStudent({ courseId, userId, name }: { courseId: string; userId: string; name: string }) {
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={async () => {
        if (!confirm(`Remove ${name} from this course? Their past visits are kept.`)) return;
        await post(`/api/courses/${courseId}`, "PATCH", { removeStudentId: userId }).catch((e) => alert(e.message));
        router.refresh();
      }}
    >
      Remove
    </Button>
  );
}

/** Release held feedback to students, or hold it again. */
export function ReleaseFeedback({ assignmentId, released }: { assignmentId: string; released: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant={released ? "secondary" : "primary"}
      size="sm"
      disabled={busy}
      onClick={async () => {
        if (!released && !confirm("Release feedback? Every student who has submitted will be able to see their scores and feedback.")) return;
        setBusy(true);
        await post(`/api/assignments/${assignmentId}/release`, "POST", { released: !released }).catch((e) => alert(e.message));
        setBusy(false);
        router.refresh();
      }}
    >
      {busy ? "Saving…" : released ? "Hold feedback again" : "Release feedback"}
    </Button>
  );
}

export function DeleteAssignment({ assignmentId, courseId }: { assignmentId: string; courseId: string }) {
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={async () => {
        if (!confirm("Delete this assignment?")) return;
        try {
          await post(`/api/assignments/${assignmentId}`, "DELETE");
          router.push(`/faculty/courses/${courseId}`);
        } catch (e) {
          alert((e as Error).message);
        }
      }}
    >
      Delete
    </Button>
  );
}
