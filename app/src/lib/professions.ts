import fs from "node:fs";
import path from "node:path";
import type { Profession } from "./types";

let cache: Profession[] | null = null;

/** The role catalog is data (data/professions.json); adding a role never needs code. */
export function professions(): Profession[] {
  if (!cache || process.env.NODE_ENV !== "production") {
    cache = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "professions.json"), "utf8"));
  }
  return cache!;
}

export function profession(id: string | null | undefined): Profession {
  const list = professions();
  return list.find((p) => p.id === id) || list.find((p) => p.id === "medicine") || list[0];
}

export function professionGroups(): { group: string; items: Profession[] }[] {
  const out: { group: string; items: Profession[] }[] = [];
  for (const p of professions()) {
    let g = out.find((x) => x.group === p.group);
    if (!g) out.push((g = { group: p.group, items: [] }));
    g.items.push(p);
  }
  return out;
}
