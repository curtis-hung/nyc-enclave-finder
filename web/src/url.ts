// URL hash state (§9.7): a shared URL recreates the same view.
//
//   #g=thai&d=asian&m=lq&l=nta&p=default&r=city&a=n:QN0401
//
// Unknown or malformed keys are ignored; missing keys fall back to defaults.

import type { Level, Metric } from "./types";

export type Area =
  | { kind: "tract"; id: string }
  | { kind: "nta"; id: string }
  | { kind: "boro"; id: string }
  | { kind: "radius"; lat: number; lon: number; mi: number };

export interface ViewState {
  group: string | null;
  dim: string | null;
  metric: Metric;
  level: Exclude<Level, "boro"> | null; // null = the group's recommended level
  preset: string;
  reference: "city" | "boro";
  area: Area | null;
  enclaves: boolean;
}

export const DEFAULT_VIEW: ViewState = {
  group: null,
  dim: null,
  metric: "lq",
  level: null,
  preset: "default",
  reference: "city",
  area: null,
  enclaves: true,
};

const METRICS: Metric[] = ["lq", "share", "count"];

export function areaToString(a: Area): string {
  if (a.kind === "radius") return `r:${a.lat.toFixed(5)},${a.lon.toFixed(5)},${+a.mi.toFixed(2)}`;
  return `${a.kind === "tract" ? "t" : a.kind === "nta" ? "n" : "b"}:${a.id}`;
}

export function parseArea(s: string | null): Area | null {
  if (!s) return null;
  const [k, rest] = [s.slice(0, 1), s.slice(2)];
  if (s[1] !== ":" || !rest) return null;
  if (k === "t") return /^\d{11}$/.test(rest) ? { kind: "tract", id: rest } : null;
  if (k === "n") return /^[A-Z]{2}\d{4}$/.test(rest) ? { kind: "nta", id: rest } : null;
  if (k === "b") return /^[1-5]$/.test(rest) ? { kind: "boro", id: rest } : null;
  if (k === "r") {
    const [lat, lon, mi] = rest.split(",").map(Number);
    if ([lat, lon, mi].some((x) => !Number.isFinite(x))) return null;
    if (mi < 0.1 || mi > 3) return null;
    return { kind: "radius", lat, lon, mi };
  }
  return null;
}

export function serialize(v: ViewState): string {
  const p = new URLSearchParams();
  if (v.group) p.set("g", v.group);
  if (v.dim) p.set("d", v.dim);
  if (v.metric !== DEFAULT_VIEW.metric) p.set("m", v.metric);
  if (v.level) p.set("l", v.level);
  if (v.preset !== DEFAULT_VIEW.preset) p.set("p", v.preset);
  if (v.reference !== DEFAULT_VIEW.reference) p.set("r", v.reference);
  if (v.area) p.set("a", areaToString(v.area));
  if (!v.enclaves) p.set("e", "0");
  // URLSearchParams escapes ":" and ","; keep the hash readable
  return p.toString().replace(/%3A/g, ":").replace(/%2C/g, ",");
}

export function parse(hash: string): ViewState {
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  const metric = p.get("m") as Metric | null;
  const level = p.get("l");
  const ref = p.get("r");
  return {
    group: p.get("g") || null,
    dim: p.get("d") || null,
    metric: metric && METRICS.includes(metric) ? metric : DEFAULT_VIEW.metric,
    level: level === "tract" || level === "nta" ? level : null,
    preset: p.get("p") || DEFAULT_VIEW.preset,
    reference: ref === "boro" ? "boro" : "city",
    area: parseArea(p.get("a")),
    enclaves: p.get("e") !== "0",
  };
}
