// Small geometry helpers: circles, inverse masks, point-in-polygon and radius weights.
// Radius statistics use area-weighted interpolation (§9.3): each tract contributes in proportion
// to the share of its land area inside the circle, estimated by dense point sampling.

export type Ring = [number, number][];
export type Bounds = [[number, number], [number, number]];

const MI_PER_DEG_LAT = 69.055;

export function miPerDegLon(lat: number): number {
  return MI_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
}

export function circleRing(lon: number, lat: number, mi: number, n = 96): Ring {
  const ring: Ring = [];
  for (let k = 0; k <= n; k++) {
    const t = (2 * Math.PI * k) / n;
    ring.push([lon + (mi * Math.cos(t)) / miPerDegLon(lat), lat + (mi * Math.sin(t)) / MI_PER_DEG_LAT]);
  }
  return ring;
}

export function circlePolygon(lon: number, lat: number, mi: number): GeoJSON.Polygon {
  return { type: "Polygon", coordinates: [circleRing(lon, lat, mi)] };
}

/** World-covering polygon with the area's outer rings cut out (the "inverse mask"). */
export function inverseMask(geom: GeoJSON.Polygon | GeoJSON.MultiPolygon): GeoJSON.Feature<GeoJSON.Polygon> {
  const world: Ring = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];
  const holes = geom.type === "Polygon" ? [geom.coordinates[0]] : geom.coordinates.map((p) => p[0]);
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [world, ...(holes as Ring[])] } };
}

export function bounds(geom: GeoJSON.Geometry): Bounds {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const walk = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === "number") {
      const [x, y] = c as number[];
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    } else if (Array.isArray(c)) c.forEach(walk);
  };
  if ("coordinates" in geom) walk(geom.coordinates);
  return [[x0, y0], [x1, y1]];
}

function inRing(x: number, y: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInGeom(x: number, y: number, geom: GeoJSON.Geometry): boolean {
  const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.type === "MultiPolygon" ? geom.coordinates : [];
  for (const p of polys) {
    if (inRing(x, y, p[0]) && !p.slice(1).some((h) => inRing(x, y, h))) return true;
  }
  return false;
}

export interface Indexed {
  index: number;
  geom: GeoJSON.Geometry;
  bbox: Bounds;
}

export function indexFeatures(fc: GeoJSON.FeatureCollection, key = "i"): Indexed[] {
  return fc.features.map((f) => ({ index: Number(f.properties?.[key]), geom: f.geometry, bbox: bounds(f.geometry) }));
}

/**
 * Fraction of each tract's land area inside the circle, by sampling a regular grid of points in
 * the circle. Returns tract index -> weight in (0, 1].
 */
export function radiusWeights(tracts: Indexed[], areasSqmi: number[], lon: number, lat: number, mi: number, steps = 120): Map<number, number> {
  const dx = (2 * mi) / steps; // grid spacing in miles
  const cellSqmi = dx * dx;
  const kx = miPerDegLon(lat);
  const cand = tracts.filter((t) => {
    const [[x0, y0], [x1, y1]] = t.bbox;
    return x1 >= lon - mi / kx && x0 <= lon + mi / kx && y1 >= lat - mi / MI_PER_DEG_LAT && y0 <= lat + mi / MI_PER_DEG_LAT;
  });
  const counts = new Map<number, number>();
  for (let a = 0; a < steps; a++) {
    for (let b = 0; b < steps; b++) {
      const ox = -mi + (a + 0.5) * dx;
      const oy = -mi + (b + 0.5) * dx;
      if (ox * ox + oy * oy > mi * mi) continue;
      const x = lon + ox / kx;
      const y = lat + oy / MI_PER_DEG_LAT;
      for (const t of cand) {
        const [[x0, y0], [x1, y1]] = t.bbox;
        if (x < x0 || x > x1 || y < y0 || y > y1) continue;
        if (pointInGeom(x, y, t.geom)) {
          counts.set(t.index, (counts.get(t.index) ?? 0) + 1);
          break;
        }
      }
    }
  }
  const w = new Map<number, number>();
  for (const [i, n] of counts) {
    const area = areasSqmi[i];
    if (area > 0) w.set(i, Math.min(1, (n * cellSqmi) / area));
  }
  return w;
}
