// Resolving a focused area (URL `a=`) to units, names and geometry.

import type { Area } from "./url";
import type { Meta } from "./types";

export type UnitArea = Exclude<Area, { kind: "radius" }>;

export interface ResolvedUnit {
  level: "tract" | "nta" | "boro";
  index: number;
  name: string;
  /** Larger units containing this one, for breadcrumbs (tract -> NTA -> borough). */
  parents: UnitArea[];
}

export function resolveUnit(meta: Meta, a: UnitArea): ResolvedUnit | null {
  if (a.kind === "tract") {
    const i = meta.tract_geoids.indexOf(a.id);
    if (i < 0) return null;
    const nta = meta.ntas[meta.tract_nta[i]];
    const boro = meta.boroughs[meta.tract_boro[i]];
    return {
      level: "tract",
      index: i,
      name: `Tract ${meta.tract_labels[i]}, ${boro.name}`,
      parents: [{ kind: "nta", id: nta.code }, { kind: "boro", id: boro.code }],
    };
  }
  if (a.kind === "nta") {
    const n = meta.ntas.find((x) => x.code === a.id);
    if (!n) return null;
    return { level: "nta", index: n.i, name: n.name, parents: [{ kind: "boro", id: n.boro }] };
  }
  const b = meta.boroughs.find((x) => x.code === a.id);
  if (!b) return null;
  return { level: "boro", index: b.i, name: b.name, parents: [] };
}

export function unitName(meta: Meta, a: UnitArea): string {
  return resolveUnit(meta, a)?.name ?? a.id;
}

export function levelLabel(level: "tract" | "nta" | "boro"): string {
  return level === "tract" ? "Census tract" : level === "nta" ? "Neighborhood (NTA)" : "Borough";
}
