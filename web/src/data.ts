// Static data loaders. All data is precomputed at build time; the site makes no API calls (§3.1).

import type { DemoBundle, EnclaveBundle, GroupsFile, Meta, WhosHereFile } from "./types";

const BASE = `${import.meta.env.BASE_URL}data/`;
const cache = new Map<string, Promise<unknown>>();

export function loadJSON<T>(path: string): Promise<T> {
  let p = cache.get(path);
  if (!p) {
    p = fetch(BASE + path).then((r) => {
      if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
      return r.json();
    });
    p.catch(() => cache.delete(path));
    cache.set(path, p);
  }
  return p as Promise<T>;
}

export const loadMeta = () => loadJSON<Meta>("meta.json");
export const loadGroups = () => loadJSON<GroupsFile>("groups.json");
export const loadDemo = (group: string, dim: string) => loadJSON<DemoBundle>(`demo/${group}/${dim}.json`);
export const loadEnclaves = (group: string) => loadJSON<EnclaveBundle>(`enclaves/${group}.json`);
export const geoURL = (name: "tracts" | "ntas" | "boroughs") => `${BASE}geo/${name}.json`;
export const loadWhosHere = (level: "tract" | "nta" | "boro") => loadJSON<WhosHereFile>(`whoshere/${level}.json`);
export const loadGeo = (name: "tracts" | "ntas" | "boroughs") => loadJSON<GeoJSON.FeatureCollection>(`geo/${name}.json`);
