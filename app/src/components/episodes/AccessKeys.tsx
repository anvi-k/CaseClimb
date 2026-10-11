"use client";

import { useEffect, useState } from "react";
import { Button, Input } from "@/components/ui";

interface Key {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/** Personal keys for the episode API and the MCP endpoint. A new key is shown once. */
export default function AccessKeys({ origin }: { origin: string }) {
  const [keys, setKeys] = useState<Key[]>([]);
  const [label, setLabel] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const load = () =>
    fetch("/api/keys")
      .then((r) => r.json())
      .then((j) => setKeys(j.keys || []));
  useEffect(() => {
    load();
  }, []);
  async function create() {
    const j = await (await fetch("/api/keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label: label || "Assistant" }) })).json();
    setFresh(j.key);
    setLabel("");
    load();
  }
  async function revoke(id: string) {
    await fetch("/api/keys", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    load();
  }
  const cfg = JSON.stringify({ mcpServers: { poscere: { type: "http", url: `${origin}/api/mcp`, headers: { Authorization: `Bearer ${fresh || "<your key>"}` } } } }, null, 2);
  return (
    <div className="space-y-3 text-sm">
      <p className="text-slate-600">
        Connect an AI assistant or a script to your episodes. The MCP endpoint offers four tools (search episodes, read an episode, list patients, read a patient record) and returns only what your account is allowed to see.
      </p>
      <div className="flex gap-2">
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="What is this key for? e.g. Claude Desktop" className="max-w-xs" />
        <Button onClick={create} variant="secondary">
          Create key
        </Button>
      </div>
      {fresh && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
          <div className="text-xs font-medium text-amber-900">Copy this key now. It is not shown again.</div>
          <code className="mt-1 block break-all text-[14px] text-slate-900">{fresh}</code>
        </div>
      )}
      {keys.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
          {keys.map((k) => (
            <li key={k.id} className="flex items-center justify-between px-3 py-2">
              <span>
                <span className="font-medium text-slate-900">{k.label}</span> <span className="text-xs text-slate-500">{k.id}… · {k.lastUsedAt ? "last used " + k.lastUsedAt + " UTC" : "never used"}</span>
              </span>
              <button onClick={() => revoke(k.id)} className="text-xs text-rose-700 hover:underline">
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
      <details className="rounded-md border border-slate-200 px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium text-slate-700">Connection details</summary>
        <div className="mt-2 space-y-2 text-xs text-slate-700">
          <p>
            MCP (Streamable HTTP): <code className="rounded bg-slate-100 px-1">{origin}/api/mcp</code> with header <code className="rounded bg-slate-100 px-1">Authorization: Bearer &lt;key&gt;</code>
          </p>
          <pre className="overflow-x-auto rounded bg-slate-900 p-3 text-[13px] text-slate-100">{cfg}</pre>
          <p>
            REST: <code className="rounded bg-slate-100 px-1">GET {origin}/api/episodes?patient=&amp;participant=&amp;role=&amp;text=</code> and <code className="rounded bg-slate-100 px-1">?id=&lt;episode&gt;</code>, same header.
          </p>
        </div>
      </details>
    </div>
  );
}
