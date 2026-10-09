// Colour scales and legend logic for the residential choropleth (§1.2, §2.7).
//
// LQ scale (SPEC §1.2, user decision 2026-10-08): two neutral greys below 1 (not
// over-represented) and 8 sequential blue classes above 1, breaks 1/1.5/2/3/4/6/10/20.
// The 8 blues are evenly spaced in OKLCH lightness (L 0.76 → 0.27, hue 256°, the reference
// palette's blue); validated with the dataviz palette validator as an ordinal ramp (monotone,
// adjacent ΔL ≥ 0.06, light end ≥ 2:1 on the surface) and against the 0.5–1 grey (normal-vision
// ΔE 17.8, protan 15.6). Share and count use the same ramp on quantile breaks. Data states are
// carried by texture, not hue, so they stay distinguishable and never look like a value.

import { STATE, type LevelValues, type Metric } from "./types";

export const BLUE = ["#87b4f0", "#689de5", "#4987d9", "#2970c9", "#065bb5", "#004799", "#003479", "#002455"];
export const LQ_BREAKS = [0.5, 1, 1.5, 2, 3, 4, 6, 10, 20];
export const LQ_COLORS = ["#f1f0ee", "#e0e0dd", ...BLUE];
export const ZERO_COLOR = "#fbfaf7";
export const SUPPRESSED_BASE = "#ffffff";
export const ENCLAVE_COLOR = "#eb6834";
export const CLUSTER_COLOR = "#4a3aa7";
// Restaurants: red for contrast against the blue choropleth (validated vs the enclave orange and
// the blue ramp: all-pairs CVD dE >= 14 and normal-vision >= 15 for every pair with the red).
export const RESTAURANT_COLOR = "#c8102e";

// Diversity (§9.6): a separate single-hue teal ramp (OKLCH hue 175, L 0.75 -> 0.20, chroma up to
// 0.16), validated as an ordinal ramp (monotone, adjacent ΔL ≈ 0.11, light end 2.04:1 on the
// surface), so it is never confused with the LQ blues. Not framed as good or bad. Breaks sit where
// NYC's values are (tract 5th–95th percentile ≈ 0.26–0.70) so every class is used.
export const DIVERSITY_BREAKS = [0.3, 0.4, 0.5, 0.6, 0.7];
export const DIVERSITY_COLORS = ["#0dcaa9", "#05a388", "#007e68", "#035b4b", "#013a2f", "#001b15"];

export function diversityScale(): Scale {
  const bins: Bin[] = DIVERSITY_COLORS.map((color, i) => {
    const lo = i === 0 ? null : DIVERSITY_BREAKS[i - 1];
    const hi = i < DIVERSITY_BREAKS.length ? DIVERSITY_BREAKS[i] : null;
    return { color, lo, hi, label: lo === null ? `< ${hi}` : hi === null ? `≥ ${lo}` : `${lo}–${hi}` };
  });
  return { bins, colorOf: (v) => DIVERSITY_COLORS[binIndex(v, DIVERSITY_BREAKS)] };
}

export interface Bin {
  color: string;
  lo: number | null;
  hi: number | null;
  label: string;
}

export interface Scale {
  bins: Bin[];
  colorOf(v: number): string;
}

function binIndex(v: number, breaks: number[]): number {
  let i = 0;
  while (i < breaks.length && v >= breaks[i]) i++;
  return i;
}

export function lqScale(): Scale {
  const bins: Bin[] = LQ_COLORS.map((color, i) => {
    const lo = i === 0 ? null : LQ_BREAKS[i - 1];
    const hi = i < LQ_BREAKS.length ? LQ_BREAKS[i] : null;
    const label = lo === null ? `< ${hi}` : hi === null ? `≥ ${lo}` : `${lo}–${hi}`;
    return { color, lo, hi, label };
  });
  return { bins, colorOf: (v) => LQ_COLORS[binIndex(v, LQ_BREAKS)] };
}

/** "Nice" rounding so legend breaks read cleanly. */
export function nice(x: number): number {
  if (x <= 0) return 0;
  const p = Math.pow(10, Math.floor(Math.log10(x)));
  const m = x / p;
  const steps = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 8, 10];
  const s = steps.find((k) => m <= k) ?? 10;
  return +(s * p).toPrecision(6);
}

/** Quantile breaks over positive values, deduplicated after rounding. */
export function quantileBreaks(values: number[], classes = BLUE.length): number[] {
  const v = values.filter((x) => x > 0).sort((a, b) => a - b);
  if (v.length === 0) return [];
  const out: number[] = [];
  for (let k = 1; k < classes; k++) {
    const q = nice(v[Math.min(v.length - 1, Math.floor((k / classes) * v.length))]);
    if (q > 0 && (out.length === 0 || q > out[out.length - 1])) out.push(q);
  }
  return out;
}

export function quantileScale(values: number[], fmt: (x: number) => string): Scale {
  const breaks = quantileBreaks(values);
  const colors = BLUE.slice(BLUE.length - breaks.length - 1);
  const bins: Bin[] = colors.map((color, i) => {
    const lo = i === 0 ? null : breaks[i - 1];
    const hi = i < breaks.length ? breaks[i] : null;
    const label = lo === null ? (hi === null ? "> 0" : `< ${fmt(hi)}`) : hi === null ? `≥ ${fmt(lo)}` : `${fmt(lo)}–${fmt(hi)}`;
    return { color, lo, hi, label };
  });
  return { bins, colorOf: (x) => colors[binIndex(x, breaks)] };
}

export function metricValues(d: LevelValues, metric: Metric): (number | null)[] {
  return metric === "lq" ? d.lq : metric === "share" ? d.s : d.e;
}

export function scaleFor(d: LevelValues, metric: Metric): Scale {
  if (metric === "lq") return lqScale();
  const usable = metricValues(d, metric).filter(
    (x, i): x is number => x !== null && (d.st[i] === STATE.reliable || d.st[i] === STATE.caution),
  );
  return metric === "share" ? quantileScale(usable, fmtShare) : quantileScale(usable, fmtCount);
}

/** Fill colour per unit: value colour for reliable/caution, fixed colours for other states. */
export function unitColors(d: LevelValues, metric: Metric, scale: Scale): string[] {
  const vals = metricValues(d, metric);
  return d.st.map((st, i) => {
    if (st === STATE.zero) return ZERO_COLOR;
    if (st === STATE.suppressed) return SUPPRESSED_BASE;
    if (st === STATE.unavailable) return "rgba(0,0,0,0)";
    const v = vals[i];
    return v === null ? "rgba(0,0,0,0)" : scale.colorOf(v);
  });
}

export function indicesWithState(d: LevelValues, state: number): number[] {
  const out: number[] = [];
  d.st.forEach((s, i) => s === state && out.push(i));
  return out;
}

// --- formatting ------------------------------------------------------------------------------

export function fmtShare(x: number | null): string {
  if (x === null || x === undefined) return "—";
  const pct = x * 100;
  if (pct === 0) return "0%";
  if (pct < 0.1) return `${pct.toPrecision(1)}%`;
  if (pct < 10) return `${pct.toFixed(1)}%`;
  return `${pct.toFixed(0)}%`;
}

export function fmtCount(x: number | null): string {
  if (x === null || x === undefined) return "—";
  return Math.round(x).toLocaleString("en-US");
}

export function fmtLQ(x: number | null): string {
  if (x === null || x === undefined) return "—";
  if (x === 0) return "0";
  return x < 10 ? x.toFixed(2) : x.toFixed(1);
}

export function fmtMetric(metric: Metric, x: number | null): string {
  return metric === "lq" ? fmtLQ(x) : metric === "share" ? fmtShare(x) : fmtCount(x);
}

export const STATE_LABEL: Record<number, string> = {
  [STATE.reliable]: "reliable",
  [STATE.caution]: "caution: noisy estimate",
  [STATE.suppressed]: "suppressed: too uncertain to show",
  [STATE.unavailable]: "no data / no residents",
  [STATE.zero]: "zero estimated",
};
