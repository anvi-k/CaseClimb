import { userFromKey } from "@/lib/apikeys";
import { getEpisode, getPatientRecord, listPatients, searchEpisodes } from "@/lib/episodes";
import type { User } from "@/lib/types";

/**
 * Model Context Protocol endpoint (Streamable HTTP, stateless JSON responses) so an assistant can
 * search past episodes and patient records. Auth: `Authorization: Bearer <personal key>`; every
 * tool applies the same visibility rules as the Episodes page.
 */
const TOOLS = [
  {
    name: "search_episodes",
    description: "Search stored simulation visits (episodes). Filter by patient name, by the student or professional who took part, by professional role, or by words in the transcript or write-up. Returns newest first.",
    inputSchema: {
      type: "object",
      properties: {
        patient: { type: "string", description: "Patient name contains" },
        participant: { type: "string", description: "Student/professional name or email contains" },
        role: { type: "string", description: "Profession, e.g. nursing, cardiology, physical-therapy" },
        text: { type: "string", description: "Words to find in the transcript or write-up" },
        case_id: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 100 },
      },
    },
  },
  {
    name: "get_episode",
    description: "One episode in full: transcript by turn, what the patient disclosed, exam/test results, the written wrap-up and the rubric feedback.",
    inputSchema: { type: "object", required: ["episode_id"], properties: { episode_id: { type: "string" } } },
  },
  {
    name: "list_patients",
    description: "List virtual patients in the library, optionally filtered by name.",
    inputSchema: { type: "object", properties: { name: { type: "string" } } },
  },
  {
    name: "get_patient_record",
    description: "A patient's record. Faculty receive the full case (history, disclosure rules, documents, answer key); students receive only the chart as it stands before a visit.",
    inputSchema: { type: "object", required: ["case_id"], properties: { case_id: { type: "string" } } },
  },
];

function call(user: User, name: string, a: Record<string, unknown>): unknown {
  const s = (k: string) => (typeof a[k] === "string" ? (a[k] as string) : undefined);
  switch (name) {
    case "search_episodes":
      return searchEpisodes(user, { patient: s("patient"), participant: s("participant"), role: s("role"), text: s("text"), caseId: s("case_id"), limit: typeof a.limit === "number" ? a.limit : undefined });
    case "get_episode":
      return getEpisode(user, s("episode_id") || "") || { error: "Episode not found or not visible to you" };
    case "list_patients":
      return listPatients(user, s("name"));
    case "get_patient_record":
      return getPatientRecord(user, s("case_id") || "") || { error: "Patient not found or not visible to you" };
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

type Rpc = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };

function handle(user: User, m: Rpc): object | null {
  const ok = (result: unknown) => ({ jsonrpc: "2.0", id: m.id, result });
  const err = (code: number, message: string) => ({ jsonrpc: "2.0", id: m.id ?? null, error: { code, message } });
  if (m.id === undefined) return null; // notification
  switch (m.method) {
    case "initialize":
      return ok({ protocolVersion: (m.params?.protocolVersion as string) || "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "poscere-episodes", version: "1.0.0" }, instructions: "Search and read simulation episodes and patient records from Poscere. Results respect the key owner's permissions." });
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: TOOLS });
    case "tools/call": {
      try {
        const out = call(user, String(m.params?.name), (m.params?.arguments as Record<string, unknown>) || {});
        return ok({ content: [{ type: "text", text: JSON.stringify(out, null, 1) }] });
      } catch (e) {
        return ok({ content: [{ type: "text", text: (e as Error).message }], isError: true });
      }
    }
    default:
      return err(-32601, `Method not found: ${m.method}`);
  }
}

export async function POST(req: Request) {
  const user = userFromKey(req);
  if (!user) return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Missing or invalid key. Create one on the Episodes page and send it as Authorization: Bearer <key>." } }, { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
  let body: Rpc | Rpc[];
  try {
    body = await req.json();
  } catch {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }
  if (Array.isArray(body)) {
    const out = body.map((m) => handle(user, m)).filter(Boolean);
    return out.length ? Response.json(out) : new Response(null, { status: 202 });
  }
  const out = handle(user, body);
  return out ? Response.json(out) : new Response(null, { status: 202 });
}

// This server does not push messages, so there is no event stream to open.
export async function GET() {
  return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
}
