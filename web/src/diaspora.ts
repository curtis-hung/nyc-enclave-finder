// Diaspora detail from PUMS (§4.6). Cells are [n, est, d_1..d_80] (replicate deltas); combining the
// PUMAs of a district means summing cells — from the microdata, never by averaging percentages.
// A number is shown only when it is reliable (both sides >= min_unweighted sampled people and
// CV <= cv_max); everything else is hidden silently and is never treated as zero.

import { loadJSON } from "./data";

export type Cell = number[];

export interface DiasporaIndex {
  vintage: string;
  pumas: { code: string; label: string; boro: string }[];
  tract_puma: number[];
  cells: string[];
  measures: Record<string, [string, string, string]>;
  rules: { cv_max: number; min_unweighted: number; district_min_pop_share: number };
  groups: Record<string, { families: string[]; heritage: string[]; definition: string }>;
  city: Record<string, Measures>;
  boro: Record<string, Record<string, Measures>>;
  languages: { buckets: Record<string, string[]>; names: Record<string, string>; city: Record<string, number> };
}

export interface PumaFile {
  groups: Record<string, Record<string, Cell>>;
  languages: Record<string, Cell>;
}

/** measure -> [value, se], reliable values only */
export type Measures = Record<string, [number, number]>;

export const loadDiaspora = () => loadJSON<DiasporaIndex>("diaspora/index.json");
export const loadPuma = (code: string) => loadJSON<PumaFile>(`diaspora/puma/${code}.json`);

const SDR = 4 / 80;

export function addCells(cells: Cell[]): Cell | null {
  if (!cells.length) return null;
  const out = new Array(cells[0].length).fill(0);
  for (const c of cells) for (let k = 0; k < c.length; k++) out[k] += c[k];
  return out;
}

/** Ratio with a replicate SE; null when not reliable (parity with pipeline/analysis/pums_stats.py). */
export function ratio(num: Cell | undefined, den: Cell | undefined, cvMax: number, minN: number): [number, number] | null {
  if (!num || !den || den[1] <= 0) return null;
  if (num[0] < minN || den[0] < minN) return null;
  const p = num[1] / den[1];
  if (!(p > 0)) return null;
  let ss = 0;
  for (let r = 2; r < den.length; r++) {
    const d = den[1] + den[r];
    const pr = d > 0 ? (num[1] + num[r]) / d : p;
    ss += (pr - p) ** 2;
  }
  const se = Math.sqrt(SDR * ss);
  return se / p <= cvMax ? [p, se] : null;
}

export function measuresFrom(ix: DiasporaIndex, group: string, cells: Record<string, Cell>): Measures {
  const g = ix.groups[group];
  const out: Measures = {};
  if (!g) return out;
  for (const [name, [num, den, fam]] of Object.entries(ix.measures)) {
    if (!g.families.includes(fam)) continue;
    const r = ratio(cells[num], cells[den], ix.rules.cv_max, ix.rules.min_unweighted);
    if (r) out[name] = r;
  }
  return out;
}

export interface District {
  pumas: number[]; // indices into ix.pumas
  label: string;
}

/** PUMAs holding at least `district_min_pop_share` of the area's residents (the largest always). */
export function districtOf(ix: DiasporaIndex, tractWeights: Map<number, number>, tractPop: number[]): District | null {
  const byPuma = new Map<number, number>();
  let total = 0;
  for (const [t, w] of tractWeights) {
    const pop = w * (tractPop[t] ?? 0);
    total += pop;
    byPuma.set(ix.tract_puma[t], (byPuma.get(ix.tract_puma[t]) ?? 0) + pop);
  }
  if (!byPuma.size) return null;
  const sorted = [...byPuma.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const keep = sorted.filter(([, v], k) => k === 0 || (total > 0 && v / total >= ix.rules.district_min_pop_share)).map(([p]) => p);
  return { pumas: keep, label: keep.map((p) => ix.pumas[p].label).join(" + ") };
}

export async function districtMeasures(ix: DiasporaIndex, d: District, groups: string[]): Promise<{ byGroup: Record<string, Measures>; files: PumaFile[] }> {
  const files = await Promise.all(d.pumas.map((p) => loadPuma(ix.pumas[p].code)));
  const byGroup: Record<string, Measures> = {};
  for (const g of groups) {
    if (!ix.groups[g]) continue;
    const parts = files.map((f) => f.groups[g]).filter(Boolean);
    if (!parts.length) continue;
    const cells: Record<string, Cell> = {};
    for (const name of ix.cells) {
      const cs = parts.map((p) => p[name]).filter(Boolean) as Cell[];
      const sum = addCells(cs);
      if (sum) cells[name] = sum;
    }
    const m = measuresFrom(ix, g, cells);
    if (Object.keys(m).length) byGroup[g] = m;
  }
  return { byGroup, files };
}

export interface LanguageRow {
  code: string;
  name: string;
  share: number;
  lq: number;
}

/** Detailed languages under one tract-level bucket for a district: reliable values only. */
export function languageFill(ix: DiasporaIndex, files: PumaFile[], bucketLine: string): LanguageRow[] {
  const codes = ix.languages.buckets[bucketLine] ?? [];
  if (codes.length <= 1) return []; // a single-language category (Spanish, Korean…) is not a bucket
  const l5 = addCells(files.map((f) => f.languages.L5).filter(Boolean));
  if (!l5) return [];
  const out: LanguageRow[] = [];
  for (const code of codes) {
    const c = addCells(files.map((f) => f.languages[code]).filter(Boolean) as Cell[]);
    const r = ratio(c ?? undefined, l5, ix.rules.cv_max, ix.rules.min_unweighted);
    if (!r) continue;
    const cityShare = (ix.languages.city[code] ?? 0) / (ix.languages.city.L5 || 1);
    out.push({ code, name: ix.languages.names[code] ?? code, share: r[0], lq: cityShare > 0 ? r[0] / cityShare : 0 });
  }
  return out.sort((a, b) => b.lq - a.lq);
}
