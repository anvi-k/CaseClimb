/** Prints a session cookie for a demo user, for driving the API with curl during development. */
import { SignJWT } from "jose";
process.env.DB_PATH ||= "data/app.db";
(async () => {
  const { get } = await import("../src/lib/db");
  const u = get<{ id: string }>("SELECT id FROM users WHERE email = ?", process.argv[2] || "dietetics@poscere.demo");
  if (!u) throw new Error("no such user");
  const secret = new TextEncoder().encode(process.env.SESSION_SECRET || "dev-secret-change-me-please-32chars!!");
  const t = await new SignJWT({ sub: u.id }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("14d").sign(secret);
  process.stdout.write("rounds_session=" + t);
})();
