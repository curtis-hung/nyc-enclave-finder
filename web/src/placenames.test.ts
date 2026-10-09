import { describe, expect, it } from "vitest";
import { nameClusters, placeFitsCuisine, placeLabel } from "./placenames";
import type { Place } from "./types";

// Synthetic squares ~0.7 mi wide; no real data.
const sq = (id: string, x: number, y: number, s = 0.01): GeoJSON.Feature => ({
  type: "Feature",
  properties: { id, part: "footprint" },
  geometry: { type: "Polygon", coordinates: [[[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]] },
});
const place = (id: string, lon: number, lat: number, radius_mi: number, extra: Partial<Place> = {}): Place =>
  ({ id, name: `${id} (detail)`, lon, lat, radius_mi, ...extra });
const fc = (...f: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: "FeatureCollection", features: f });

describe("placeLabel", () => {
  it("prefers the explicit label, else strips the parenthetical", () => {
    expect(placeLabel(place("a", 0, 0, 1))).toBe("a");
    expect(placeLabel(place("a", 0, 0, 1, { label: "Alpha Town" }))).toBe("Alpha Town");
  });
});

describe("nameClusters", () => {
  it("names a cluster whose footprint contains the place centre, anchored at the footprint top", () => {
    const r = nameClusters(fc(sq("c1", -74, 40.7)), [place("p", -73.995, 40.705, 0.1)]);
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe("c1");
    expect(r[0].at[0]).toBeCloseTo(-73.995, 6);
    expect(r[0].at[1]).toBeCloseTo(40.71, 6);
  });

  it("names a cluster the place circle reaches, but not one beyond the radius", () => {
    // place ~0.26 mi east of the square's edge
    const p = place("p", -73.985, 40.705, 0.3);
    expect(nameClusters(fc(sq("c1", -74, 40.7)), [p])).toHaveLength(1);
    expect(nameClusters(fc(sq("c1", -74, 40.7)), [{ ...p, radius_mi: 0.2 }])).toHaveLength(0);
  });

  it("assigns each place to one cluster and each cluster one name, deepest overlap first", () => {
    const a = sq("A", -74, 40.7), b = sq("B", -73.98, 40.7);
    const pa = place("pa", -73.995, 40.705, 0.1); // inside A
    const pb = place("pb", -73.975, 40.705, 0.1); // inside B
    const wide = place("wide", -73.985, 40.705, 1); // reaches both, inside neither
    const r = nameClusters(fc(a, b), [wide, pa, pb]);
    expect(Object.fromEntries(r.map((n) => [n.id, n.label]))).toEqual({ A: "pa", B: "pb" });
  });

  it("ignores catchment parts and empty inputs", () => {
    const c = { ...sq("c1", -74, 40.7), properties: { id: "c1", part: "catchment" } };
    expect(nameClusters(fc(c), [place("p", -73.995, 40.705, 0.1)])).toEqual([]);
    expect(nameClusters(null, [place("p", 0, 0, 1)])).toEqual([]);
    expect(nameClusters(fc(sq("c1", -74, 40.7)), [])).toEqual([]);
  });
});

describe("cuisine fit", () => {
  const groups = {
    broad: { parent: null, cuisines: { bucket_c: "exact" } },
    leaf: { parent: "broad", cuisines: { leaf_c: "exact" } },
    other: { parent: null, cuisines: { other_c: "exact" } },
  };
  it("matches the place group's own pairings and its ancestors'", () => {
    const p = place("p", 0, 0, 1, { group: "leaf" });
    expect(placeFitsCuisine(p, "leaf_c", groups)).toBe(true);
    expect(placeFitsCuisine(p, "bucket_c", groups)).toBe(true);
    expect(placeFitsCuisine(p, "other_c", groups)).toBe(false);
    expect(placeFitsCuisine(place("q", 0, 0, 1), "leaf_c", groups)).toBe(false);
  });
  it("only fitting places name clusters", () => {
    const p = place("p", -73.995, 40.705, 0.1);
    expect(nameClusters(fc(sq("c1", -74, 40.7)), [p], () => false)).toEqual([]);
    expect(nameClusters(fc(sq("c1", -74, 40.7)), [p], () => true)).toHaveLength(1);
  });
});
