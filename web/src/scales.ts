// Colour scales and legend logic for the residential choropleth (§1.2, §2.7).
//
// Colours come from the validated reference palette (dataviz skill): LQ uses neutral greys
// below 1 (not over-represented) and a single-hue blue ramp above 1. Share and count use the
// blue ramp on quantile breaks. Data states are carried by texture, not hue, so they stay
// distinguishable for colour-blind readers and never look like a value.

import { STATE, type LevelValues, type Metric } from "./types";

export const BLUE = ["#b7d3f6", "#86b6ef", "#5598e7", "#2a78d6", "#1c5cab", "#104281"];
export const LQ_BREAKS = [0.5, 1, 1.5, 2, 3, 5, 10];
export const LQ_COLORS = ["#ebeae6", "#d6d5cf", ...BLUE];
export const ZERO_COLOR = "#fbfaf7";
export const SUPPRESSED_BASE = "#ffffff";
export const ENCLAVE_COLOR = "#eb6834";
export const CLUSTER_COLOR = "#4a3aa7";

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
