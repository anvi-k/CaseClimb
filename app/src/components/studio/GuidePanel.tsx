"use client";

import { useEffect, useRef, useState } from "react";
import { Button, cx, Textarea } from "@/components/ui";
import type { CaseProfile } from "@/lib/types";
import { describeOp, type OpView, type PatchOp } from "@/lib/studio/patch";
import { api } from "./fields";
import PatchDiff from "./PatchDiff";

interface Msg {
  role: "user" | "assistant";
  text: string;
  ops?: PatchOp[];
  views?: OpView[];
  picked?: boolean[];
  state?: "pending" | "accepted" | "rejected";
  note?: string;
  error?: boolean;
}

const SUGGESTIONS = ["Make the patient more guarded about alcohol", "Add a normal chest X-ray the student can order", "Add a fact about a sister with breast cancer", "Make the opening line vaguer"];

export default function GuidePanel({ caseId, profileNow, onAccept, onClose }: { caseId: string; profileNow: () => CaseProfile; onAccept: (ops: PatchOp[], label: string) => { applied: number; errors: string[] }; onClose: () => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [secs, setSecs] = useState(0);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Braces matter: scrollIntoView can return a promise, which React would treat as a cleanup function.
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs, busy]);
  useEffect(() => {
    if (!busy) return;
    const t0 = Date.now();
    const t = setInterval(() => setSecs(Math.round((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(t);
  }, [busy]);

  async function send(text: string) {
    const ask = text.trim();
    if (!ask || busy) return;
    const history = [...msgs.filter((m) => !m.error), { role: "user" as const, text: ask }];
    setMsgs([...msgs, { role: "user", text: ask }]);
    setInput("");
    setSecs(0);
    setBusy(true);
    try {
      const profile = profileNow();
      const r = await api<{ reply: string; ops: PatchOp[]; dropped: number }>(`/api/cases/${caseId}/guide`, {
        json: {
          profile,
          // The guide is told what happened to its earlier proposals so it does not repeat or build on rejected ones.
          messages: history.map((m) => ({ role: m.role, text: m.role === "assistant" && m.ops?.length ? `${m.text}\n[Proposed ${m.ops.length} edits: ${m.state === "accepted" ? "accepted by faculty" : m.state === "rejected" ? "rejected by faculty" : "not yet decided"}]` : m.text })),
        },
      });
      setMsgs((cur) => [
        ...cur,
        {
          role: "assistant",
          text: r.reply,
          ops: r.ops,
          views: r.ops.map((op) => describeOp(profile, op)),
          picked: r.ops.map(() => true),
          state: r.ops.length ? "pending" : undefined,
          note: r.dropped ? `${r.dropped} proposed edit${r.dropped === 1 ? "" : "s"} did not fit the case and ${r.dropped === 1 ? "was" : "were"} left out.` : undefined,
        },
      ]);
    } catch (e) {
      setMsgs((cur) => [...cur, { role: "assistant", text: `The guide could not answer: ${(e as Error).message}`, error: true }]);
    } finally {
      setBusy(false);
    }
  }

  const patchMsg = (i: number, patch: Partial<Msg>) => setMsgs((cur) => cur.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  function accept(i: number) {
    const m = msgs[i];
    const ops = (m.ops || []).filter((_, k) => m.picked?.[k]);
    if (!ops.length) return;
    const ask = msgs[i - 1]?.text || "guide change";
    const r = onAccept(ops, ask);
    patchMsg(i, {
      state: "accepted",
      note: r.errors.length ? `${r.applied} of ${ops.length} edits applied. Not applied because the patient changed since the proposal: ${r.errors.join("; ")}` : `${r.applied} edit${r.applied === 1 ? "" : "s"} applied. Use Undo in the top bar to reverse.`,
    });
  }

  return (
    <aside className="flex h-full flex-col rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-2 border-b border-slate-100 px-3 py-2.5">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Guide</h2>
          <p className="text-xs leading-snug text-slate-500">Ask for a change in plain language. The guide proposes edits; nothing changes until you accept them.</p>
        </div>
        <button type="button" onClick={onClose} className="rounded px-1.5 py-0.5 text-xs text-slate-500 hover:bg-slate-100">
          Hide
        </button>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {!msgs.length && (
          <div>
            <p className="text-xs text-slate-500">For example:</p>
            <div className="mt-1.5 flex flex-col items-start gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => send(s)} className="rounded-md border border-slate-200 px-2.5 py-1.5 text-left text-xs text-slate-700 hover:border-brand-500 hover:bg-brand-50">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="ml-6 rounded-lg bg-brand-600 px-3 py-2 text-sm text-white">
              {m.text}
            </div>
          ) : (
            <div key={i} className={cx("rounded-lg border px-3 py-2", m.error ? "border-rose-200 bg-rose-50" : "border-slate-200 bg-slate-50")}>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{m.text}</p>
              {m.views && m.views.length > 0 && (
                <div className={cx("mt-2 border-t border-slate-200 pt-2", m.state !== "pending" && "opacity-70")}>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {m.state === "pending" ? `Proposed: ${m.views.length} edit${m.views.length === 1 ? "" : "s"}` : m.state === "accepted" ? "Accepted" : "Rejected, nothing changed"}
                  </p>
                  <PatchDiff views={m.views} picked={m.state === "pending" && m.views.length > 1 ? m.picked : undefined} onPick={(k, on) => patchMsg(i, { picked: m.picked!.map((x, j) => (j === k ? on : x)) })} />
                  {m.state === "pending" && (
                    <div className="mt-2 flex gap-1.5">
                      <Button size="sm" disabled={!m.picked?.some(Boolean)} onClick={() => accept(i)}>
                        {m.views.length > 1 && !m.picked?.every(Boolean) ? `Accept ${m.picked?.filter(Boolean).length} selected` : "Accept"}
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => patchMsg(i, { state: "rejected" })}>
                        Reject
                      </Button>
                    </div>
                  )}
                </div>
              )}
              {m.note && <p className="mt-1.5 text-xs text-slate-500">{m.note}</p>}
            </div>
          ),
        )}
        {busy && <p className="text-xs text-slate-500">Reading the case and drafting a proposal... {secs}s (usually 10 to 40 seconds)</p>}
        <div ref={end} />
      </div>
      <form
        className="border-t border-slate-100 p-2"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <Textarea
          rows={2}
          value={input}
          disabled={busy}
          placeholder="Describe the change you want"
          aria-label="Message to the guide"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
        />
        <div className="mt-1.5 flex items-center justify-between">
          <span className="text-[11px] text-slate-400">Enter to send, Shift+Enter for a new line</span>
          <Button size="sm" type="submit" disabled={busy || !input.trim()}>
            Ask
          </Button>
        </div>
      </form>
    </aside>
  );
}
