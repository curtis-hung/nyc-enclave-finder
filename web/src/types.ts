// Shapes of the processed data written by `uv run pipeline build`.

export type Level = "tract" | "nta" | "boro";
export type Metric = "lq" | "share" | "count";
export type StateName = "reliable" | "caution" | "suppressed" | "unavailable" | "zero";

/** Data-state codes (§2.7); must match pipeline/analysis/stats.py. */
export const STATE = { reliable: 0, caution: 1, suppressed: 2, unavailable: 3, zero: 4 } as const;

export interface DimensionMeta {
  name: string;
  short: string;
  table: string;
  numerator_universe: string;
  denominator: string;
  share_of: string;
  summable: boolean;
  note: string | null;
  city_denominator: number;
}

export interface PresetDef {
  label: string;
  enclave: { lq_min: number; count_min: number; states: StateName[]; min_enclave_pop: number };
  cluster: { eps_ft: number; min_samples: number; min_cluster_size: number; catchment_ft: number; lq_min: number; gap_min: number };
  [k: string]: unknown;
}

export interface SourceMeta {
  name?: string;
  publisher?: string;
  vintage?: string;
  fetched_at?: string;
  source_url?: string;
  license?: string;
}

export interface Meta {
  sources: Record<string, SourceMeta>;
  acs_vintage: string;
  dimensions: Record<string, DimensionMeta>;
  states: StateName[];
  analysis: Record<string, unknown>;
  presets: { default_preset: string; presets: Record<string, PresetDef> };
  levels: Record<Level, number>;
  ntas: { i: number; code: string; name: string; boro: string; type: string }[];
  boroughs: { i: number; code: string; name: string }[];
  tract_geoids: string[];
  tract_labels: string[];
  tract_area_sqmi: number[];
  tract_nta: number[];
  tract_boro: number[];
}

export interface GroupDimMeta {
  vars: string[];
  labels: string[];
  bucket: string | null;
  derived: boolean;
  missing_from_sum: string[];
  city: { e: number; m: number | null; share: number | null };
  level: "tract" | "nta";
  usable_share_tract: number;
  sparse_citywide: boolean;
}

export interface Group {
  id: string;
  name: string;
  parent: string | null;
  children: string[];
  default_dimension: string;
  rationale: string;
  proxy: boolean;
  cuisines: Record<string, "exact" | "bucket">;
  dims: Record<string, GroupDimMeta>;
}

export interface GroupsFile {
  roots: string[];
  groups: Record<string, Group>;
}

export interface LevelValues {
  e: (number | null)[];
  m: (number | null)[];
  s: (number | null)[];
  lq: (number | null)[];
  st: number[];
}

export type DemoBundle = Record<Level, LevelValues>;

export interface EnclaveItem {
  id: string;
  units: number[];
  pop: number;
  share: number | null;
  peak_lq: number | null;
  n_units: number;
  n_tracts: number;
  area_sqmi: number;
}

export interface EnclaveBundle {
  stats: Record<string, Record<string, { level: "tract" | "nta"; items: EnclaveItem[] }>>;
  geojson: GeoJSON.FeatureCollection;
}

/** [candidate index, lq, share, count, moe, state] */
export type WhoRow = [number, number | null, number | null, number | null, number | null, number];

export interface WhoCandidate {
  id: string;
  label: string;
  kind: "group" | "language";
  city_share: number | null;
}

export interface WhosHereFile {
  columns: string[];
  candidates: Record<string, WhoCandidate[]>;
  units: Record<string, { lq: WhoRow[]; share: WhoRow[] }>[];
}

export interface Place {
  id: string;
  name: string;
  lat: number;
  lon: number;
  radius_mi: number;
  group?: string;
}
