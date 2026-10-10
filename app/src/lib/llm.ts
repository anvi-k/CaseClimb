import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
  type Message,
  type Tool,
} from "@aws-sdk/client-bedrock-runtime";

// Credentials come from the default chain: env vars locally, the instance role when deployed.
const g = globalThis as unknown as { __bedrock?: BedrockRuntimeClient };
function client() {
  if (!g.__bedrock) {
    g.__bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION || "us-west-2", maxAttempts: 4 });
  }
  return g.__bedrock;
}

export const MODELS = {
  /** Per-turn classification. */
  fast: process.env.MODEL_FAST || "us.anthropic.claude-haiku-4-5-20251001-v1:0",
  /** Patient / clinician voice. */
  chat: process.env.MODEL_CHAT || "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
  /** Case generation, consistency checks, feedback. */
  smart: process.env.MODEL_SMART || "us.anthropic.claude-sonnet-5",
};

export interface Turn {
  role: "user" | "assistant";
  text: string;
}

interface CallOpts {
  model?: string;
  system: string;
  messages: Turn[];
  maxTokens?: number;
  temperature?: number;
}

function toMessages(turns: Turn[]): Message[] {
  // Bedrock requires alternating roles starting with user; merge consecutive same-role turns.
  const out: Message[] = [];
  for (const t of turns) {
    const last = out[out.length - 1];
    if (last && last.role === t.role) {
      last.content!.push({ text: t.text });
    } else {
      out.push({ role: t.role, content: [{ text: t.text }] });
    }
  }
  if (out.length && out[0].role !== "user") out.unshift({ role: "user", content: [{ text: "(begin)" }] });
  return out;
}

async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const name = (e as { name?: string }).name || "";
      if (!/Throttl|ServiceUnavailable|ModelTimeout|InternalServer|ModelStreamError/i.test(name)) throw e;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw lastErr;
}

export async function chatText(o: CallOpts): Promise<string> {
  const res = await withRetry(() =>
    client().send(
      new ConverseCommand({
        modelId: o.model || MODELS.chat,
        system: [{ text: o.system }],
        messages: toMessages(o.messages),
        inferenceConfig: { maxTokens: o.maxTokens ?? 1024, temperature: o.temperature },
      }),
    ),
  );
  return (res.output?.message?.content || []).map((c) => c.text || "").join("");
}

export async function* chatStream(o: CallOpts): AsyncGenerator<string> {
  const res = await withRetry(() =>
    client().send(
      new ConverseStreamCommand({
        modelId: o.model || MODELS.chat,
        system: [{ text: o.system }],
        messages: toMessages(o.messages),
        inferenceConfig: { maxTokens: o.maxTokens ?? 1024, temperature: o.temperature },
      }),
    ),
  );
  for await (const ev of res.stream || []) {
    const t = ev.contentBlockDelta?.delta?.text;
    if (t) yield t;
  }
}

/**
 * Structured output: forces the model to call a single tool whose input matches `schema` (JSON Schema).
 * Returns the parsed tool input.
 */
export async function chatJSON<T>(o: CallOpts & { schema: Record<string, unknown>; name?: string }): Promise<T> {
  const tool: Tool = {
    toolSpec: {
      name: o.name || "respond",
      description: "Return the structured result.",
      inputSchema: { json: o.schema as never },
    },
  };
  const res = await withRetry(() =>
    client().send(
      new ConverseCommand({
        modelId: o.model || MODELS.smart,
        system: [{ text: o.system }],
        messages: toMessages(o.messages),
        inferenceConfig: { maxTokens: o.maxTokens ?? 4096, temperature: o.temperature },
        toolConfig: { tools: [tool], toolChoice: { tool: { name: tool.toolSpec!.name! } } },
      }),
    ),
  );
  if (res.stopReason === "max_tokens") throw new Error("Model output was cut off (max_tokens).");
  const block = (res.output?.message?.content || []).find((c) => c.toolUse);
  if (!block?.toolUse) throw new Error("Model did not return structured output.");
  return block.toolUse.input as T;
}
