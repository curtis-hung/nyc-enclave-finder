// "Find food" suggestions (SPEC §9.9). Candidates for a cuisine, gathered by one of four modes and
// ordered by visible, user-switchable criteria — never by a hidden score, and never by quality
// (there are no ratings). Cuisine matching uses restaurant data only (§2.3); the "where the
// community lives" option uses residential enclaves solely as a location filter the user chose.

import { FLAG, type CuisineIndex, type Points } from "./cuisine";
import { bounds, miPerDegLon, pointInGeom } from "./geo";

export type FindMode = "near" | "here" | "enclave" | "outpost";
export type FindSort = "distance" | "confidence" | "shuffle";

const MI_PER_DEG_LAT = 69.055;

export interface LatLon {
  lat: number;
  lon: number;
}

export interface Suggestion {
  i: number;
  /** 4 = DOHMH primary label matches; 3/2/1 = best matching inferred tag (high/medium/low) */
  strength: number;
  dist: number | null;
  cluster: { id: string; rank: number } | null;
  /** distance to the nearest residential enclave of the paired group (community option only) */
  enclaveDist?: number;
}

export function distanceMi(a: LatLon, b: LatLon): number {
  const dx = (a.lon - b.lon) * miPerDegLon((a.lat + b.lat) / 2);
  const dy = (a.lat - b.lat) * MI_PER_DEG_LAT;
  return Math.sqrt(dx * dx + dy * dy);
}

export function pointOf(p: Points, i: number): LatLon {
  return { lat: p.lat[i] / 1e5, lon: p.lon[i] / 1e5 };
}

/** How a restaurant matches the cuisine: 4 via its DOHMH label, else its best qualifying tag, 0 = no match. */
export function matchStrength(ix: CuisineIndex, p: Points, i: number, target: number | null, floor: number): number {
  if (target === null) return 4; // "All restaurants"
  const pr = p.primary[i];
  if (!ix.isGeneric(pr) && ix.covers(target, pr)) return 4;
  let best = 0;
  for (const [t, c] of p.tags[String(i)] ?? []) if (c >= floor && c > best && ix.covers(target, t)) best = c;
  return best;
}

/** Restaurants eligible at all: independent and inspected, plus multi-location ones when shown. */
export function eligible(p: Points, i: number, multi: boolean): boolean {
  const f = p.flags[i];
  return !!(f & FLAG.analysis) || (multi && !!(f & FLAG.multi));
}

/** Shortest distance in miles from a point to a polygon (0 inside). */
export function distToGeomMi(pt: LatLon, geom: GeoJSON.Geometry): number {
  if (pointInGeom(pt.lon, pt.lat, geom)) return 0;
  const kx = miPerDegLon(pt.lat);
  const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.type === "MultiPolygon" ? geom.coordinates : [];
  let best = Infinity;
  for (const poly of polys) {
    for (const ring of poly) {
      for (let k = 1; k < ring.length; k++) {
        const ax = (ring[k - 1][0] - pt.lon) * kx, ay = (ring[k - 1][1] - pt.lat) * MI_PER_DEG_LAT;
        const bx = (ring[k][0] - pt.lon) * kx, by = (ring[k][1] - pt.lat) * MI_PER_DEG_LAT;
        const dx = bx - ax, dy = by - ay;
        const len2 = dx * dx + dy * dy;
        const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
        const cx = ax + t * dx, cy = ay + t * dy;
        best = Math.min(best, Math.sqrt(cx * cx + cy * cy));
      }
    }
  }
  return best;
}

/** Deterministic PRNG so a shuffle is reproducible in tests. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface FindInput {
  ix: CuisineIndex;
  pts: Points;
  /** cuisine node index; null = all restaurants */
  target: number | null;
  floor: number;
  multi: boolean;
  /** restaurants to consider (already restricted by the mode) */
  pool: Iterable<number>;
  /** origin for distances (the user's location or the focus centre), if known */
  origin: LatLon | null;
  /** keep only restaurants within this distance of the origin */
  maxMi?: number;
  /** cluster membership for the cuisine at the current preset */
  clusters?: Map<number, { id: string; rank: number }>;
  /** residential enclave polygons of the paired group: restaurants within `enclaveMi` of one are
   *  tagged with that distance; with `enclaveOnly`, everything farther is dropped */
  enclaves?: GeoJSON.Geometry[];
  enclaveMi?: number;
  enclaveOnly?: boolean;
}

export function findCandidates(inp: FindInput): Suggestion[] {
  const { ix, pts, target, floor, multi, origin } = inp;
  const lim = inp.enclaveMi ?? 0.5;
  // enclave bounding boxes grown by the limit, so far-away restaurants skip the polygon math
  const boxes = (inp.enclaves ?? []).map((g) => {
    const [[x0, y0], [x1, y1]] = bounds(g);
    const pad = lim / MI_PER_DEG_LAT;
    return [x0 - pad * 1.4, y0 - pad, x1 + pad * 1.4, y1 + pad];
  });
  const out: Suggestion[] = [];
  for (const i of inp.pool) {
    if (!eligible(pts, i, multi)) continue;
    const strength = matchStrength(ix, pts, i, target, floor);
    if (!strength) continue;
    const at = pointOf(pts, i);
    const dist = origin ? distanceMi(origin, at) : null;
    if (inp.maxMi !== undefined && (dist === null || dist > inp.maxMi)) continue;
    const s: Suggestion = { i, strength, dist, cluster: inp.clusters?.get(i) ?? null };
    if (inp.enclaves) {
      let d = Infinity;
      inp.enclaves.forEach((g, k) => {
        const b = boxes[k];
        if (d === 0 || at.lon < b[0] || at.lat < b[1] || at.lon > b[2] || at.lat > b[3]) return;
        d = Math.min(d, distToGeomMi(at, g));
      });
      if (d <= lim) s.enclaveDist = d;
      else if (inp.enclaveOnly) continue;
    }
    out.push(s);
  }
  return out;
}

export function sortSuggestions(list: Suggestion[], sort: FindSort, seed = 1): Suggestion[] {
  const s = [...list];
  if (sort === "shuffle") {
    const rnd = mulberry32(seed);
    for (let k = s.length - 1; k > 0; k--) {
      const j = Math.floor(rnd() * (k + 1));
      [s[k], s[j]] = [s[j], s[k]];
    }
    return s;
  }
  const byDist = (a: Suggestion, b: Suggestion) => (a.dist ?? Infinity) - (b.dist ?? Infinity);
  const byConf = (a: Suggestion, b: Suggestion) => b.strength - a.strength;
  const byCluster = (a: Suggestion, b: Suggestion) => (a.cluster?.rank ?? Infinity) - (b.cluster?.rank ?? Infinity);
  const byEnclave = (a: Suggestion, b: Suggestion) => (a.enclaveDist ?? Infinity) - (b.enclaveDist ?? Infinity);
  const chain = sort === "distance" ? [byDist, byConf, byCluster, byEnclave] : [byConf, byCluster, byEnclave, byDist];
  return s.sort((a, b) => {
    for (const f of chain) {
      const d = f(a, b);
      if (d) return d;
    }
    return a.i - b.i;
  });
}
