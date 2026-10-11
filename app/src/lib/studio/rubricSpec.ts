// Validates a custom rubric from the builder into one of the two formats in types.ts. Pure.
import type { Rubric } from "@/lib/types";

const slug = (s: string, i: number) => (s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "item") + "_" + (i + 1);

export function cleanRubric(input: unknown): Omit<Rubric, "id"> {
  const b = (input || {}) as Partial<Rubric>;
  const name = String(b.name || "").trim();
  if (!name) throw new Error("Give the rubric a name.");
  const instructions = String(b.instructions || "").trim() || undefined;
  if (b.type === "checklist") {
    const items = (Array.isArray(b.items) ? b.items : [])
      .filter((it) => it && String(it.text || "").trim())
      .map((it, i) => ({ key: slug(String(it.text), i), section: String(it.section || "").trim() || "General", text: String(it.text).trim(), points: Math.max(0, Math.round(Number(it.points) || 0)) }));
    if (!items.length) throw new Error("Add at least one checklist item.");
    if (!items.some((it) => it.points > 0)) throw new Error("Give at least one item some points.");
    return { name, type: "checklist", instructions, items };
  }
  const domains = (Array.isArray(b.domains) ? b.domains : [])
    .filter((d) => d && String(d.name || "").trim())
    .map((d, i) => {
      const descriptors: Record<string, string> = {};
      for (const k of ["4", "3", "2", "1"]) descriptors[k] = String(d.descriptors?.[k] || "").trim();
      return { key: slug(String(d.name), i), name: String(d.name).trim(), descriptors, reviewIfOne: !!d.reviewIfOne };
    });
  if (!domains.length) throw new Error("Add at least one domain.");
  const thin = domains.find((d) => !d.descriptors["4"] || !d.descriptors["1"]);
  if (thin) throw new Error(`"${thin.name}" needs a description for at least score 4 and score 1.`);
  return { name, type: "domain4", instructions, domains };
}
