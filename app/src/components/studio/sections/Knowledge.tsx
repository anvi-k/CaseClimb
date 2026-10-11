"use client";

import { useState } from "react";
import { Button, Input } from "@/components/ui";
import type { KnowledgeSource } from "@/lib/types";
import { nextId } from "@/lib/studio/profile";
import { api, Area, Notice, Panel, RemoveButton, Text } from "../fields";
import type { SectionProps } from "./types";

/** Feedback reads this many characters of each source (src/lib/engine/feedback.ts). */
const USED_CHARS = 6000;

export function KnowledgeSection({ p, set }: SectionProps) {
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "red" | "amber"; text: string } | null>(null);
  const up = (id: string, patch: Partial<KnowledgeSource>) => set((c) => ({ ...c, knowledge: c.knowledge.map((k) => (k.id === id ? { ...k, ...patch } : k)) }));
  const add = (title: string, text: string) => {
    const id = nextId(p.knowledge, "k");
    set((c) => ({ ...c, knowledge: [...c.knowledge, { id, title, text }] }));
    setOpen(id);
  };
  async function upload(files: FileList) {
    setBusy(true);
    setMsg(null);
    try {
      for (const file of Array.from(files)) {
        if (!/\.(pdf|txt|md)$/i.test(file.name)) throw new Error(`"${file.name}" is not a PDF, TXT or MD file.`);
        const fd = new FormData();
        fd.append("file", file);
        const r = await api<{ filename: string; text: string | null; note?: string }>("/api/uploads", { method: "POST", body: fd });
        if (!r.text) {
          setMsg({ tone: "amber", text: r.note || `No text could be read from "${r.filename}".` });
          continue;
        }
        add(r.filename.replace(/\.[a-z0-9]+$/i, ""), r.text);
      }
    } catch (e) {
      setMsg({ tone: "red", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel
      title={`Knowledge sources (${p.knowledge.length})`}
      subtitle={`Papers, guidelines and protocols this case should be judged against. When a visit is scored, clinical accuracy is checked only against the answer key and these sources; anything outside them is reported as "could not be verified" rather than wrong. The first ${USED_CHARS.toLocaleString()} characters of each source are used, so put the passage that matters first or trim the text.`}
    >
      <div className="mb-4 grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Upload a PDF, TXT or MD file. The text is extracted on the server.</label>
          <Input type="file" multiple accept=".pdf,.txt,.md" disabled={busy} onChange={(e) => e.target.files?.length && upload(e.target.files).then(() => (e.target.value = ""))} />
        </div>
        <Button variant="secondary" onClick={() => add("", "")}>
          Paste text instead
        </Button>
        {busy && <p className="text-xs text-slate-500 sm:col-span-2">Uploading and extracting text...</p>}
      </div>
      {msg && (
        <Notice tone={msg.tone} className="mb-3">
          {msg.text}
        </Notice>
      )}
      {!p.knowledge.length && <p className="text-sm text-slate-500">No sources attached. Feedback will rely on the answer key alone.</p>}
      <div className="space-y-2">
        {p.knowledge.map((k) => (
          <div key={k.id} className="rounded-md border border-slate-200 p-3">
            <div className="flex items-start gap-2">
              <Text className="flex-1" value={k.title} placeholder="Title, e.g. 2022 AHA/ACC heart failure guideline, section 7.3" aria-label="Source title" onChange={(v) => up(k.id, { title: v })} />
              <Button variant="ghost" size="sm" onClick={() => setOpen(open === k.id ? null : k.id)}>
                {open === k.id ? "Hide text" : "Edit text"}
              </Button>
              <RemoveButton onClick={() => (!k.text || window.confirm(`Remove "${k.title || "this source"}" from the case?`)) && set((c) => ({ ...c, knowledge: c.knowledge.filter((x) => x.id !== k.id) }))} />
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {k.text.length.toLocaleString()} characters
              {k.text.length > USED_CHARS && <span className="text-amber-700"> · only the first {USED_CHARS.toLocaleString()} are used in feedback</span>}
              {!k.text.trim() && <span className="text-amber-700"> · empty</span>}
            </p>
            {open === k.id ? (
              <Area className="mt-2" minRows={8} value={k.text} placeholder="Paste the relevant passage here." onChange={(v) => up(k.id, { text: v })} />
            ) : (
              k.text && <p className="mt-1 line-clamp-2 text-xs text-slate-600">{k.text.slice(0, 300)}</p>
            )}
          </div>
        ))}
      </div>
    </Panel>
  );
}
