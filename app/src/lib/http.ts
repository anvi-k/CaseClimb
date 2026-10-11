/**
 * For work that can take longer than a proxy's idle timeout (case generation, scoring).
 * Streams whitespace heartbeats, then the JSON result. Leading whitespace is valid JSON, so
 * callers can use `await res.json()` as usual. Failures arrive as `{ error }` with status 200.
 */
export function longJson<T>(fn: () => Promise<T>): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const beat = setInterval(() => controller.enqueue(enc.encode(" \n")), 8000);
      controller.enqueue(enc.encode(" \n"));
      try {
        controller.enqueue(enc.encode(JSON.stringify(await fn())));
      } catch (e) {
        console.error(e);
        controller.enqueue(enc.encode(JSON.stringify({ error: (e as Error).message || "Something went wrong" })));
      } finally {
        clearInterval(beat);
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}

export const bad = (message: string, status = 400) => Response.json({ error: message }, { status });
