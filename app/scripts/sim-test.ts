/** Smoke test of the encounter engine against one seed case, using a throwaway DB. */
import fs from "node:fs";
process.env.DB_PATH = "/tmp/rounds-simtest.db";
for (const f of [process.env.DB_PATH, process.env.DB_PATH + "-wal", process.env.DB_PATH + "-shm"]) if (fs.existsSync(f)) fs.rmSync(f);

(async () => {
  const { run } = await import("../src/lib/db");
  const { createEncounter, runTurn, runAction, hint, loadEncounter } = await import("../src/lib/engine/encounter");
  const { scoreEncounter } = await import("../src/lib/engine/feedback");
  const seed = JSON.parse(fs.readFileSync(process.argv[2] || "data/seed/cases/sample-omar-sinclair.json", "utf8"));
  run("INSERT INTO cases (id, status, origin, title, profile, professions, difficulty) VALUES ('c1','published','sample',?,?,?,?)", seed.profile.title, JSON.stringify(seed.profile), JSON.stringify(seed.profile.professions), seed.profile.difficulty);
  const id = createEncounter({ userId: "u1", caseId: "c1", professionId: seed.profile.professions[0], mode: "practice", level: 3 });
  const say = async (t: string) => {
    const t0 = Date.now();
    let first = 0;
    process.stdout.write(`\nSTUDENT: ${t}\nPATIENT: `);
    for await (const ev of runTurn(id, t)) {
      if (ev.type === "delta") { if (!first) first = Date.now() - t0; process.stdout.write(ev.text); }
      if (ev.type === "done") console.log(`\n   [first token ${first}ms, new facts: ${ev.newFactIds.join(",") || "-"}, deflected: ${ev.deflected}, rapport ${ev.chart.rapport} (${ev.rapportDelta >= 0 ? "+" : ""}${ev.rapportDelta})]`);
      if (ev.type === "error") console.log("ERROR", ev.message);
    }
  };
  await say("Hi Mr. Sinclair, I'm Alex, a dietetics student working with your care team. Thanks for joining the video visit. What would you like to get out of today?");
  await say("What have you been told about your cholesterol numbers?");
  await say("Do you drink alcohol? How much?");
  await say("Have you ever had a heart attack or a stroke? And what's your blood type?");
  await say("That sounds really frustrating, and it makes sense you'd be wary of pills. Lots of people feel that way. Would it be okay if I asked a bit about what a normal day of eating looks like for you?");
  console.log("\nACTION:", JSON.stringify((await runAction(id, "lipid panel and a brain MRI")).done.map((d) => d.name)), JSON.stringify(loadEncounter(id)!.state.unmatchedOrders));
  console.log("HINT:", hint(id));
  run("UPDATE encounters SET wrapup = ?, status='submitted' WHERE id = ?", JSON.stringify({ assessment: "Dyslipidemia with high LDL, low HDL, central adiposity.", diagnosis: "Excessive fat intake related to food choices as evidenced by LDL 195.", plan: "Reduce saturated fat, add fibre, follow up in 4 weeks." }), id);
  const t0 = Date.now();
  const f = await scoreEncounter(id);
  console.log(`\nFEEDBACK (${Math.round((Date.now() - t0) / 1000)}s): ${f.total}/${f.max} = ${f.percent}% review=${f.needsReview}`);
  for (const d of f.domains) console.log(` ${d.score ?? "N/A"}  ${d.name} — ${d.rationale}  [evidence: ${d.evidence.map((e) => "T" + e.turn + (e.quote ? "✓" : "∅")).join(" ")}]`);
  console.log("missed critical:", f.missed.filter((m) => m.importance === "critical").map((m) => m.topic).join(", "));
  console.log("objectives:", f.objectives.map((o) => o.met).join(", "));
  console.log("next:", f.nextAttempt.join(" | "));
  console.log("summary:", f.summary);
})();
