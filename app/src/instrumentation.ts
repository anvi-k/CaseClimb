export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Seeding is best-effort: a problem here must not stop the server from starting.
    try {
      const { seed } = await import("./lib/seed");
      const added = seed();
      if (added) console.log(`[seed] loaded ${added} cases`);
    } catch (e) {
      console.error("[seed] failed", e);
    }
  }
}
