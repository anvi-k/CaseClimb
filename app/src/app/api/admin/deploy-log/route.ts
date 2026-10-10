import fs from "node:fs";

/** Operator-only: tail of the deploy log, so a failed auto-deploy can be diagnosed without shell access. */
export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get("key");
  if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) return new Response("Not found", { status: 404 });
  let log = "(no log)";
  try {
    log = fs.readFileSync("/var/log/rounds-deploy.log", "utf8").slice(-6000);
  } catch {}
  return new Response(log, { headers: { "Content-Type": "text/plain" } });
}
