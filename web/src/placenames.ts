// Colloquial place names floated over restaurant clusters (display only).
// A cluster is named after a gazetteer place when the place's circle reaches the cluster footprint;
// each place names at most one cluster (the one it overlaps most deeply) and each cluster takes at
// most one name. A place is only considered when the group it is colloquially associated with (or
// a parent group) declares a pairing with the cluster's cuisine, so a Mexican cluster is never
// called "Chinatown". Display only: nothing here feeds labels, tags, clustering or any measure, and
// the gazetteer stays navigation only, never analytical ground truth (§4.2).

import { pointToPolygonDistance } from "@turf/turf";
import type { Place } from "./types";

export interface ClusterName {
  id: string;
  label: string;
  place: string;
  /** [lon, lat] anchor: top-centre of the footprint's bounding box */
  at: [number, number];
}

/** Short display label for a place: explicit `label`, else the name without its parenthetical. */
export function placeLabel(p: Place): string {
  return p.label ?? p.name.replace(/\s*\(.*\)\s*$/, "");
}

function bboxTop(g: GeoJSON.Polygon | GeoJSON.MultiPolygon): [number, number] {
  let x0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const rings = g.type === "Polygon" ? g.coordinates : g.coordinates.flat();
  for (const ring of rings) for (const [x, y] of ring) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return [(x0 + x1) / 2, y1];
}

export function nameClusters(
  fc: GeoJSON.FeatureCollection | null,
  places: Place[],
  fits: (p: Place) => boolean = () => true,
): ClusterName[] {
  places = places.filter(fits);
  if (!fc || !places.length) return [];
  const pairs: { id: string; place: Place; d: number; geom: GeoJSON.Polygon | GeoJSON.MultiPolygon }[] = [];
  for (const f of fc.features) {
    if (f.properties?.part !== "footprint") continue;
    const g = f.geometry;
    if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) continue;
    for (const p of places) {
      // signed distance (miles) from the place centre to the footprint edge; negative = inside
      const d = pointToPolygonDistance([p.lon, p.lat], g, { units: "miles" });
      if (d <= p.radius_mi) pairs.push({ id: String(f.properties.id), place: p, d, geom: g });
    }
  }
  pairs.sort((a, b) => a.d - b.d || a.place.id.localeCompare(b.place.id) || a.id.localeCompare(b.id));
  const usedC = new Set<string>(), usedP = new Set<string>();
  const out: ClusterName[] = [];
  for (const q of pairs) {
    if (usedC.has(q.id) || usedP.has(q.place.id)) continue;
    usedC.add(q.id);
    usedP.add(q.place.id);
    out.push({ id: q.id, label: placeLabel(q.place), place: q.place.name, at: bboxTop(q.geom) });
  }
  return out;
}

/** Whether a place's group, or any of its parent groups, declares a pairing with `cuisine`. */
export function placeFitsCuisine(
  p: Place,
  cuisine: string,
  groups: Record<string, { parent?: string | null; cuisines?: Record<string, string> }>,
): boolean {
  for (let g = p.group ? groups[p.group] : undefined, n = 0; g && n < 10; g = g.parent ? groups[g.parent] : undefined, n++)
    if (g.cuisines?.[cuisine]) return true;
  return false;
}
