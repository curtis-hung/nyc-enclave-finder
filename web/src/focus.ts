// Area-focus statistics (§9.3). NTA and borough values are the pipeline's exact tract sums
// (whoshere files); radius values are area-weighted interpolations of tract values computed here
// and are always labelled approximate.

import { loadGeo, loadJSON, loadWhosHere } from "./data";
import { indexFeatures, radiusWeights, type Indexed } from "./geo";
import { areaValue, forTracts, rulesFrom, weightedSum, type AreaValue } from "./stats";
import { STATE, type Meta, type WhoCandidate, type WhoRow, type WhosHereFile } from "./types";
import type { Area } from "./url";

export interface Matrix {
  ids: string[];
  e: (number | null)[][];
  m: (number | null)[][];
}

export type Denominators = Record<string, Record<"tract" | "nta" | "boro", number[]>>;

export const loadMatrix = (dim: string) => loadJSON<Matrix>(`matrix/${dim}.json`);
export const loadDenominators = () => loadJSON<Denominators>("denominators.json");

let tractIndex: Promise<Indexed[]> | null = null;
export function loadTractIndex(): Promise<Indexed[]> {
  tractIndex ??= loadGeo("tracts").then((fc) => indexFeatures(fc));
  return tractIndex;
}

export interface UnitLists {
  [dim: string]: { lq: WhoRow[]; share: WhoRow[] };
}

export interface AreaStats {
  kind: Area["kind"];
  approximate: boolean;
  candidates: Record<string, WhoCandidate[]>;
  lists: UnitLists;
  /** tract index -> weight (1 for whole tracts; fraction inside the circle for radius) */
  tracts: Map<number, number>;
}

export function tractsOfUnit(meta: Meta, level: "tract" | "nta" | "boro", index: number): Map<number, number> {
  const w = new Map<number, number>();
  if (level === "tract") w.set(index, 1);
  else {
    const arr = level === "nta" ? meta.tract_nta : meta.tract_boro;
    arr.forEach((u, i) => u === index && w.set(i, 1));
  }
  return w;
}

const TOP_N = 10;
const TOP_SHARE_N = 6;

function rankLists(values: AreaValue[]): { lq: WhoRow[]; share: WhoRow[] } {
  const usable = values
    .map((v, k) => ({ v, k }))
    .filter(({ v }) => v.state === STATE.reliable || v.state === STATE.caution);
  const row = ({ v, k }: { v: AreaValue; k: number }): WhoRow => [k, v.lq, v.share, Math.round(v.est), v.moe === null ? null : Math.round(v.moe), v.state];
  const lq = usable.filter(({ v }) => v.lq !== null && v.lq > 1).sort((a, b) => b.v.lq! - a.v.lq! || a.k - b.k).slice(0, TOP_N).map(row);
  const share = usable.filter(({ v }) => v.share !== null).sort((a, b) => b.v.share! - a.v.share! || a.k - b.k).slice(0, TOP_SHARE_N).map(row);
  return { lq, share };
}

/** Values of every candidate in one dimension for a weighted set of tracts. */
export function weightedValues(meta: Meta, dim: string, mat: Matrix, den: Denominators, cands: WhoCandidate[], weights: Map<number, number>): AreaValue[] {
  const rules = rulesFrom(meta.analysis);
  const denTract = den[dim].tract;
  let d = 0;
  for (const [i, w] of weights) d += w * (denTract[i] ?? 0);
  const cityDen = meta.dimensions[dim].city_denominator;
  return mat.ids.map((_, k) => {
    const { e, m } = weightedSum(mat.e[k], mat.m[k], weights);
    const cs = cands[k].city_share;
    return areaValue(e, m, d, cs, (cs ?? 0) * cityDen, rules);
  });
}

export async function computeAreaStats(meta: Meta, area: Area): Promise<AreaStats> {
  const boroFile = await loadWhosHere("boro"); // smallest file; carries the candidate lists
  if (area.kind !== "radius") {
    const level = area.kind;
    const file: WhosHereFile = level === "boro" ? boroFile : await loadWhosHere(level);
    const index =
      level === "tract" ? meta.tract_geoids.indexOf(area.id)
        : level === "nta" ? meta.ntas.findIndex((n) => n.code === area.id)
          : meta.boroughs.findIndex((b) => b.code === area.id);
    return { kind: area.kind, approximate: false, candidates: file.candidates, lists: file.units[index], tracts: tractsOfUnit(meta, level, index) };
  }
  const [tracts, den] = await Promise.all([loadTractIndex(), loadDenominators()]);
  const weights = radiusWeights(tracts, meta.tract_area_sqmi, area.lon, area.lat, area.mi);
  const lists: UnitLists = {};
  const dims = Object.keys(meta.dimensions);
  const mats = await Promise.all(dims.map(loadMatrix));
  dims.forEach((dim, j) => {
    lists[dim] = rankLists(weightedValues(meta, dim, mats[j], den, boroFile.candidates[dim], weights));
  });
  return { kind: "radius", approximate: true, candidates: boroFile.candidates, lists, tracts: weights };
}

/** Per-tract values of one candidate (for drill-down small multiples). */
export function tractValues(meta: Meta, dim: string, mat: Matrix, den: Denominators, cand: WhoCandidate, k: number, tracts: number[]): Map<number, AreaValue> {
  const rules = forTracts(rulesFrom(meta.analysis));
  const cityDen = meta.dimensions[dim].city_denominator;
  const out = new Map<number, AreaValue>();
  for (const i of tracts) {
    const e = mat.e[k][i];
    out.set(i, e === null
      ? { est: 0, moe: null, share: null, lq: null, state: STATE.unavailable }
      : areaValue(e, mat.m[k][i], den[dim].tract[i], cand.city_share, (cand.city_share ?? 0) * cityDen, rules));
  }
  return out;
}
