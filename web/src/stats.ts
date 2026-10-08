// Client-side port of the pipeline's data-state and LQ rules (pipeline/analysis/stats.py), used
// only for radius focus and drill-down, where areas are arbitrary. Tested for parity in
// stats.test.ts against the same planted cases as the Python unit tests.

import { STATE } from "./types";

export interface Rules {
  z: number;
  cv_reliable_max: number;
  cv_caution_max: number;
  min_denominator: number;
  min_city_count: number;
  cv_caution_max_tract?: number;
}

/** Tract-level display rules: a wider caution band (analysis.yaml `cv_caution_max_tract`). */
export function forTracts(r: Rules): Rules {
  return r.cv_caution_max_tract ? { ...r, cv_caution_max: r.cv_caution_max_tract } : r;
}

export function rulesFrom(analysis: Record<string, unknown>): Rules {
  return (analysis as { reliability: Rules }).reliability;
}

export function classify(est: number | null, moe: number | null, denom: number | null, r: Rules): number {
  if (est === null || Number.isNaN(est) || denom === null || Number.isNaN(denom) || denom <= 0) return STATE.unavailable;
  if (est === 0) return STATE.zero;
  if (denom < r.min_denominator) return STATE.suppressed;
  if (moe === null || Number.isNaN(moe)) return STATE.caution;
  const cv = moe / r.z / est;
  if (cv > r.cv_caution_max) return STATE.suppressed;
  if (cv > r.cv_reliable_max) return STATE.caution;
  return STATE.reliable;
}

export interface AreaValue {
  est: number;
  moe: number | null;
  share: number | null;
  lq: number | null;
  state: number;
}

export function areaValue(est: number, moe: number | null, denom: number, cityShare: number | null, cityCount: number, r: Rules): AreaValue {
  let state = classify(est, moe, denom, r);
  if (cityCount < r.min_city_count && (state === STATE.reliable || state === STATE.caution)) state = STATE.suppressed;
  if (state === STATE.zero) return { est, moe, share: 0, lq: 0, state };
  if (state === STATE.suppressed || state === STATE.unavailable) return { est, moe, share: null, lq: null, state };
  const share = est / denom;
  const lq = cityShare ? share / cityShare : null;
  return { est, moe, share, lq, state };
}

/** Weighted sum of unit estimates with an approximate MOE (weights treated as constants; only
 *  the largest zero-estimate MOE is included, as in the pipeline). */
export function weightedSum(est: (number | null)[], moe: (number | null)[], weights: Map<number, number>): { e: number; m: number | null } {
  let e = 0;
  let nz = 0;
  let zmax = 0;
  let unknown = false;
  for (const [i, w] of weights) {
    const x = est[i];
    if (x === null) continue;
    e += w * x;
    const mm = moe[i];
    if (mm === null) unknown = true;
    else if (x === 0) zmax = Math.max(zmax, w * mm);
    else nz += (w * mm) ** 2;
  }
  return { e, m: unknown ? null : Math.sqrt(nz + zmax ** 2) };
}
