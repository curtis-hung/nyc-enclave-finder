// Citywide / borough reference (§9.3, SHOULD): LQ = local share ÷ the group's share in the unit's
// own borough instead of citywide. Same data, same states; only the denominator of the LQ changes.

import { STATE, type DemoBundle, type LevelValues, type Meta } from "./types";

export function boroughOfUnits(meta: Meta, level: "tract" | "nta"): number[] {
  if (level === "tract") return meta.tract_boro;
  const idx = new Map(meta.boroughs.map((b) => [b.code, b.i]));
  return meta.ntas.map((n) => idx.get(n.boro) ?? -1);
}

/** Level values with LQ recomputed against each unit's borough share. Units whose borough share is
 *  unusable keep their state but lose the LQ (never shown as 0 unless the estimate is a true 0). */
export function withBoroughReference(meta: Meta, demo: DemoBundle, level: "tract" | "nta"): LevelValues {
  const d = demo[level];
  const boro = demo.boro;
  const ofUnit = boroughOfUnits(meta, level);
  const lq = d.s.map((s, i) => {
    const st = d.st[i];
    if (st === STATE.zero) return 0;
    const b = ofUnit[i];
    const ref = b >= 0 ? boro.s[b] : null;
    if (s === null || ref === null || ref === 0 || (st !== STATE.reliable && st !== STATE.caution)) return null;
    return s / ref;
  });
  return { ...d, lq };
}
