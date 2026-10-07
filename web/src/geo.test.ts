import { describe, expect, it } from "vitest";
import { circleRing, indexFeatures, inverseMask, miPerDegLon, pointInGeom, radiusWeights } from "./geo";

function square(i: number, x0: number, y0: number, size: number): GeoJSON.Feature {
  return {
    type: "Feature",
    properties: { i },
    geometry: { type: "Polygon", coordinates: [[[x0, y0], [x0 + size, y0], [x0 + size, y0 + size], [x0, y0 + size], [x0, y0]]] },
  };
}

describe("mask geometry", () => {
  it("cuts the area out of a world polygon", () => {
    const area: GeoJSON.Polygon = { type: "Polygon", coordinates: [circleRing(-73.9, 40.7, 1)] };
    const mask = inverseMask(area);
    expect(mask.geometry.coordinates).toHaveLength(2); // world + one hole
    expect(pointInGeom(-73.9, 40.7, mask.geometry)).toBe(false); // inside the area: not masked
    expect(pointInGeom(-74.2, 40.9, mask.geometry)).toBe(true); // elsewhere: masked
  });

  it("masks every part of a multipolygon", () => {
    const mp: GeoJSON.MultiPolygon = { type: "MultiPolygon", coordinates: [[circleRing(0, 0, 1)], [circleRing(1, 1, 1)]] };
    expect(inverseMask(mp).geometry.coordinates).toHaveLength(3);
  });
});

describe("radius interpolation weights", () => {
  // Two 1x1 mile tracts side by side at the equator-ish latitude scale used by miPerDegLon.
  const lat = 40.7;
  const degX = 1 / miPerDegLon(lat);
  const degY = 1 / 69.055;
  const fc: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: [
      { ...square(0, 0, 0, 1), geometry: { type: "Polygon", coordinates: [[[0, lat], [degX, lat], [degX, lat + degY], [0, lat + degY], [0, lat]]] } },
      { ...square(1, 0, 0, 1), geometry: { type: "Polygon", coordinates: [[[degX, lat], [2 * degX, lat], [2 * degX, lat + degY], [degX, lat + degY], [degX, lat]]] } },
    ],
  };
  const idx = indexFeatures(fc);

  it("a small circle fully inside one tract weights only that tract by circle/tract area", () => {
    const w = radiusWeights(idx, [1, 1], degX * 0.5, lat + degY * 0.5, 0.2);
    expect([...w.keys()]).toEqual([0]);
    expect(w.get(0)!).toBeCloseTo(Math.PI * 0.04, 2);
  });

  it("a circle on the shared edge splits evenly", () => {
    const w = radiusWeights(idx, [1, 1], degX, lat + degY * 0.5, 0.3);
    expect(w.get(0)!).toBeCloseTo(w.get(1)!, 2);
  });

  it("a circle covering both tracts gives weight 1 each", () => {
    const w = radiusWeights(idx, [1, 1], degX, lat + degY * 0.5, 3);
    expect(w.get(0)!).toBeCloseTo(1, 1);
    expect(w.get(1)!).toBeCloseTo(1, 1);
  });
});
