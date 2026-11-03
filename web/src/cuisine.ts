// Client-side cuisine model (§4.4): restaurant points, the cuisine DAG and the filtering rule.
// A restaurant matches a cuisine if the cuisine equals its primary label or one of its tags, or
// is an ancestor of one; tags below the confidence floor are ignored; generic primaries
// (formats like "Coffee/Tea") never match a specific cuisine.

import { loadJSON } from "./data";

export interface CuisineNode {
  id: string;
  name: string;
  kind: "cuisine" | "bucket" | "food_type" | "generic";
  parents: number[];
  anc: number[];
  dohmh: string[];
}

export interface CuisineFile {
  nodes: CuisineNode[];
  exact_owner: Record<string, string>;
  tag_confidence: "low" | "medium" | "high";
}

export interface Points {
  n: number;
  lon: number[];
  lat: number[];
  tract: number[];
  primary: number[];
  flags: number[];
  tags: Record<string, [number, number][]>;
}

export interface TagDetail {
  label: string;
  confidence: "low" | "medium" | "high";
  sources: { source: string; evidence: string }[];
}

export interface RestaurantDetail {
  name: string;
  address: string;
  boro: string;
  zip: string;
  cuisine_dohmh: string | null;
  last_inspection: string | null;
  grade: string | null;
  locations: number;
  camis: string;
  tags: TagDetail[];
  conflicts: { label: string; source: string; evidence: string }[];
  /** DOHMH phone (10 digits); website, Instagram handle and opening hours from the matched OSM place */
  phone?: string;
  website?: string;
  instagram?: string;
  hours?: string;
}

export interface ClusterStats {
  id: string;
  members: number[];
  restaurants: number;
  independent: number;
  catchment_restaurants: number;
  cuisine_in_catchment: number;
  share: number | null;
  ref_share: number | null;
  lq: number | null;
  share_gap?: number | null;
  qualified_by?: "lq" | "share_gap";
  via_primary: number;
  via_tags: number;
  tag_confidence: Record<string, number>;
  footprint_sqmi: number;
  tag_coverage?: number | null;
  tag_coverage_n?: [number, number];
  parent_buckets?: string[];
}

export interface ClusterFile {
  node: string;
  basis: "primary" | "tag";
  stats: Record<string, ClusterStats[]>;
  geojson: GeoJSON.FeatureCollection;
}

export const FLAG = { multi: 1, uninspected: 2, analysis: 4 } as const;
export const CONF = { low: 1, medium: 2, high: 3 } as const;
export type ConfName = keyof typeof CONF;

export const loadCuisines = () => loadJSON<CuisineFile>("cuisines.json");
export const loadPoints = () => loadJSON<Points>("restaurants/points.json");
export const loadDetails = (nta: string) => loadJSON<Record<string, RestaurantDetail>>(`restaurants/details/${nta}.json`);
export const loadClusters = (node: string) => loadJSON<ClusterFile>(`clusters/${node}.json`);

export class CuisineIndex {
  readonly byId = new Map<string, number>();
  private anc: Set<number>[];

  constructor(readonly file: CuisineFile) {
    file.nodes.forEach((n, i) => this.byId.set(n.id, i));
    this.anc = file.nodes.map((n) => new Set(n.anc));
  }

  node(id: string): CuisineNode | undefined {
    const i = this.byId.get(id);
    return i === undefined ? undefined : this.file.nodes[i];
  }

  isGeneric(i: number): boolean {
    const k = this.file.nodes[i].kind;
    return k === "generic";
  }

  /** node `target` is `i` or one of its ancestors */
  covers(target: number, i: number): boolean {
    return i === target || this.anc[i].has(target);
  }

  /** 0 = no match, 1 = matches via the primary label, 2 = via an inferred tag only */
  matchKind(p: Points, i: number, target: number, floor: number): 0 | 1 | 2 {
    const pr = p.primary[i];
    if (!this.isGeneric(pr) && this.covers(target, pr)) return 1;
    const tg = p.tags[String(i)];
    if (tg) for (const [t, c] of tg) if (c >= floor && this.covers(target, t)) return 2;
    return 0;
  }

  /** Every cuisine node a restaurant counts toward (each restaurant once per node). */
  closure(p: Points, i: number, floor: number): Set<number> {
    const out = new Set<number>();
    const add = (n: number) => {
      if (this.isGeneric(n)) return;
      out.add(n);
      this.anc[n].forEach((a) => out.add(a));
    };
    add(p.primary[i]);
    const tg = p.tags[String(i)];
    if (tg) for (const [t, c] of tg) if (c >= floor) add(t);
    const root = this.byId.get("root");
    if (root !== undefined) out.delete(root);
    return out;
  }
}

export interface CuisineLQ {
  node: number;
  count: number;
  total: number;
  share: number;
  lq: number;
}

/** Cuisine over-representation in a set of restaurants vs. the analysis population citywide. */
export function cuisineLQs(ix: CuisineIndex, p: Points, area: number[], floor: number, minCount: number): CuisineLQ[] {
  const city = new Map<number, number>();
  let cityTotal = 0;
  for (let i = 0; i < p.n; i++) {
    if (!(p.flags[i] & FLAG.analysis)) continue;
    cityTotal++;
    ix.closure(p, i, floor).forEach((n) => city.set(n, (city.get(n) ?? 0) + 1));
  }
  const local = new Map<number, number>();
  let total = 0;
  for (const i of area) {
    if (!(p.flags[i] & FLAG.analysis)) continue;
    total++;
    ix.closure(p, i, floor).forEach((n) => local.set(n, (local.get(n) ?? 0) + 1));
  }
  const out: CuisineLQ[] = [];
  for (const [n, c] of local) {
    const kind = ix.file.nodes[n].kind;
    if (kind === "food_type" || c < minCount || !total) continue;
    const share = c / total;
    const lq = share / ((city.get(n) ?? 0) / cityTotal);
    if (lq > 1) out.push({ node: n, count: c, total, share, lq });
  }
  return out.sort((a, b) => b.lq - a.lq || a.node - b.node);
}

export function mapsLink(d: RestaurantDetail): string {
  const q = [d.name, d.address, d.boro, "NY", d.zip].filter(Boolean).join(" ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}
