"use client";

import { useState } from "react";
import { Badge, Button, Select, Textarea, cx } from "@/components/ui";
import type { RunView } from "@/lib/journey/types";
import { post, Spinner } from "./shared";

const ACT_LABEL: Record<string, string> = { request: "Request", question: "Question", information: "Information", checkback: "Check-back", confirmation: "Confirmation", callout: "Call-out", readback: "Read-back", answer: "Answer", correction: "Correction", clarifying_question: "Asks for clarification" };

/** Page any colleague, earlier or later in the journey, or call something out to the whole team. */
export default function ConsultPanel({ view, refresh, compact }: { view: RunView; refresh: () => void; compact?: boolean }) {
  const colleagues = view.stages.filter((s) => !s.isStudent);
  const [to, setTo] = useState(colleagues[0]?.stage.id || "");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const target = to === "team" ? null : colleagues.find((s) => s.stage.id === to);
  const thread = view.messages.filter((m) => (to === "team" ? m.thread === "callout" : m.thread === `consult:${to}`));

  async function send() {
    if (!text.trim() || busy) return;
    setBusy(true);
    setErr("");
    const r = await post(`/api/journeys/runs/${view.id}/consult`, to === "team" ? { callout: true, text } : { toStageId: to, text });
    setBusy(false);
    if (r.error) return setErr(r.error);
    setText("");
    refresh();
  }

  if (!view.viewerIsOwner && !view.messages.some((m) => m.thread.startsWith("consult:") || m.thread === "callout")) return <p className="text-sm text-slate-500">The student did not message any colleague outside the handoff order.</p>;
  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">Who do you want to reach?</label>
        <Select value={to} onChange={(e) => setTo(e.target.value)}>
          {colleagues.map((s) => (
            <option key={s.stage.id} value={s.stage.id}>
              {s.clinicianName}, {s.stage.roleTitle} ({s.status === "complete" ? "has seen the patient" : "has not seen the patient yet"})
            </option>
          ))}
          <option value="team">Whole team (call-out)</option>
        </Select>
        <p className="mt-1 text-xs text-slate-500">
          {to === "team"
            ? "A call-out announces critical information to everyone at once. Each colleague reads it back."
            : target?.status === "complete"
              ? "Ask for clarification of something they recorded, or request a consult."
              : "They know only the shared record so far. You can tell them what to look out for when they see the patient."}
        </p>
      </div>
      {thread.length > 0 && (
        <ol className={cx("space-y-2 overflow-y-auto rounded-md border border-slate-200 bg-slate-50 p-2", compact ? "max-h-64" : "max-h-96")}>
          {thread.map((m) => (
            <li key={m.id} className={cx("max-w-[92%] rounded-lg px-3 py-2 text-sm", m.fromIsAi ? "bg-white text-slate-800" : "ml-auto bg-brand-50 text-slate-800")}>
              <div className="mb-0.5 flex flex-wrap items-center gap-1.5 text-[12px] font-semibold text-slate-500">
                {m.fromIsAi ? m.fromName : "You"}
                {m.meta?.act && ACT_LABEL[m.meta.act] && <Badge tone="slate">{ACT_LABEL[m.meta.act]}</Badge>}
                {m.meta?.loop === "closed" && <Badge tone="green">Loop closed</Badge>}
              </div>
              <div className="whitespace-pre-wrap">{m.text}</div>
            </li>
          ))}
        </ol>
      )}
      {view.viewerIsOwner && (
        <>
          <Textarea rows={compact ? 2 : 3} value={text} onChange={(e) => setText(e.target.value)} placeholder={to === "team" ? "State the critical information plainly, e.g. what you found and why everyone needs to know now." : thread.length ? "Reply. Repeating back what you understood closes the loop." : "Say what you need and why."} />
          <div className="flex items-center gap-3">
            <Button size="sm" onClick={send} disabled={busy || !text.trim()}>{to === "team" ? "Call out to the team" : thread.length ? "Send reply" : "Send"}</Button>
            {busy && <Spinner label={to === "team" ? "The team is acknowledging" : `${target?.clinicianName || "Colleague"} is replying`} />}
            {err && <span className="text-sm text-rose-700">{err}</span>}
          </div>
        </>
      )}
    </div>
  );
}
