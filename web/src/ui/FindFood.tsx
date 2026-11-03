// "Find food" (SPEC §9.9): candidate restaurants for the selected cuisine, near you, around the
// focused area, in its restaurant clusters or where the community lives, or off the beaten path.
// Every ordering is visible and switchable; there are no ratings, so nothing here judges quality.

import { useEffect, useMemo, useState } from "preact/hooks";
import { CONF, loadDetails, mapsLink, type ClusterFile, type CuisineIndex, type Points, type RestaurantDetail } from "../cuisine";
import { loadEnclaves } from "../data";
import { view } from "../store";
import { distanceMi, findCandidates, sortSuggestions, type FindMode, type FindSort, type LatLon, type Suggestion } from "../suggest";
import type { EnclaveBundle, Group, GroupsFile, Meta } from "../types";
import type { ViewState } from "../url";

interface Props {
  meta: Meta;
  groups: GroupsFile;
  ix: CuisineIndex;
  pts: Points;
  v: ViewState;
  clusters: ClusterFile | null;
  preset: string;
  onPick: (i: number) => void;
}

const MODES: { id: FindMode; label: string; hint: string }[] = [
  { id: "near", label: "Near me", hint: "Uses your device's location (asked once; never stored or put in the URL)." },
  { id: "here", label: "Around here", hint: "The neighborhood, borough or radius you have focused." },
  { id: "enclave", label: "In an enclave", hint: "In this cuisine's restaurant clusters, or near where the community lives." },
  { id: "outpost", label: "Off the beaten path", hint: "Places of this cuisine outside every one of its restaurant clusters." },
];
const NEAR_MI = [0.25, 0.5, 1, 2];
const SHOW = 20;
const NYC_CENTER: LatLon = { lat: 40.7128, lon: -74.006 };
const STRENGTH = ["", "inferred (low)", "inferred (medium)", "inferred (high)", "DOHMH category"];

/** The group whose residential enclaves the "community" option uses for this cuisine. */
export function pairedGroup(groups: GroupsFile, ix: CuisineIndex, selected: string | null, cuisine: string): Group | null {
  const sel = selected ? groups.groups[selected] : null;
  if (sel && sel.cuisines[cuisine]) return sel;
  const owner = ix.file.exact_owner[cuisine];
  if (owner && groups.groups[owner]) return groups.groups[owner];
  return Object.values(groups.groups).find((g) => g.cuisines[cuisine] === "exact") ?? null;
}

function areaPool(meta: Meta, pts: Points, v: ViewState): { pool: number[]; origin: LatLon | null; maxMi?: number } | null {
  const a = v.area;
  if (!a) return null;
  if (a.kind === "radius") return { pool: Array.from({ length: pts.n }, (_, i) => i), origin: { lat: a.lat, lon: a.lon }, maxMi: a.mi };
  const keep = (t: number) =>
    a.kind === "tract" ? meta.tract_geoids[t] === a.id
      : a.kind === "nta" ? meta.ntas[meta.tract_nta[t]]?.code === a.id
        : meta.boroughs[meta.tract_boro[t]]?.code === a.id;
  const pool: number[] = [];
  for (let i = 0; i < pts.n; i++) if (keep(pts.tract[i])) pool.push(i);
  return { pool, origin: null };
}

export function FindFood({ meta, groups, ix, pts, v, clusters, preset, onPick }: Props) {
  const mode = v.find;
  const [sort, setSort] = useState<FindSort | null>(null); // null = the mode's default
  const [seed, setSeed] = useState(1);
  const [nearMi, setNearMi] = useState(1);
  const [me, setMe] = useState<LatLon | null>(null);
  const [geoMsg, setGeoMsg] = useState<string | null>(null);
  const [community, setCommunity] = useState(false);
  const [enc, setEnc] = useState<EnclaveBundle | null>(null);
  const [details, setDetails] = useState<Record<string, RestaurantDetail>>({});

  const cuisine = v.cuisine;
  const target = cuisine && cuisine !== "root" ? ix.byId.get(cuisine) ?? null : null;
  const cuisineName = cuisine === "root" ? "restaurant" : cuisine ? ix.node(cuisine)?.name ?? cuisine : null;
  const group = cuisine && cuisine !== "root" ? pairedGroup(groups, ix, v.group, cuisine) : null;

  const locate = () => {
    if (!("geolocation" in navigator)) {
      setGeoMsg("This browser can't share a location. Try \"Around here\" with a radius pin instead.");
      return;
    }
    setGeoMsg("Finding you…");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const at = { lat: p.coords.latitude, lon: p.coords.longitude };
        setMe(at);
        setGeoMsg(distanceMi(at, NYC_CENTER) > 25 ? "You seem to be outside New York City, so there may be nothing nearby." : null);
      },
      () => setGeoMsg("Location unavailable or not allowed. Try \"Around here\" with a radius pin instead."),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 },
    );
  };
  useEffect(() => {
    if (mode === "near" && !me) locate();
  }, [mode]);

  useEffect(() => {
    setEnc(null);
    if (mode !== "enclave" || !community || !group) return;
    let live = true;
    loadEnclaves(group.id).then((e) => live && setEnc(e)).catch(() => undefined);
    return () => { live = false; };
  }, [mode, community, group?.id]);

  const clusterOf = useMemo(() => {
    const m = new Map<number, { id: string; rank: number }>();
    (clusters?.stats[preset] ?? []).forEach((c, k) => c.members.forEach((i) => m.set(i, { id: c.id, rank: k + 1 })));
    return m;
  }, [clusters, preset]);
  const hasClusters = !!clusters && clusters.node === cuisine;

  const result = useMemo((): { list: Suggestion[]; note: string | null } => {
    if (!mode || !cuisine) return { list: [], note: null };
    const all = () => Array.from({ length: pts.n }, (_, i) => i);
    const base = { ix, pts, target, floor: CONF[v.conf], multi: v.multi, clusters: hasClusters ? clusterOf : undefined };
    if (mode === "near") {
      if (!me) return { list: [], note: null };
      return { list: findCandidates({ ...base, pool: all(), origin: me, maxMi: nearMi }), note: null };
    }
    if (mode === "here") {
      const ap = areaPool(meta, pts, v);
      if (!ap) return { list: [], note: "Focus an area first: pick a neighborhood or borough, or drop a radius pin." };
      return { list: findCandidates({ ...base, ...ap, origin: me ?? ap.origin }), note: null };
    }
    if (mode === "enclave") {
      if (community) {
        if (!group) return { list: [], note: `No group is paired with ${cuisineName}, so there are no residential enclaves to look near.` };
        if (!enc) return { list: [], note: "Loading enclaves…" };
        const feats = enc.geojson.features.filter((f) => f.properties?.dim === group.default_dimension && f.properties?.preset === preset);
        if (!feats.length) return { list: [], note: `${group.name} has no residential enclaves under this preset.` };
        return {
          list: findCandidates({ ...base, pool: all(), origin: me, enclaves: feats.map((f) => f.geometry), enclaveMi: 0.5 }),
          note: `Within 0.5 mi of a ${group.name} residential enclave (${meta.dimensions[group.default_dimension]?.short ?? group.default_dimension}). Census residence picks where to look; the restaurants' cuisine still comes only from restaurant data.`,
        };
      }
      if (!hasClusters) return { list: [], note: `${cuisineName} has no restaurant clusters computed (only cuisines paired with a group are clustered).` };
      return { list: findCandidates({ ...base, pool: clusterOf.keys(), origin: me }), note: null };
    }
    // outpost
    const pool = all().filter((i) => !clusterOf.has(i));
    return {
      list: findCandidates({ ...base, pool, origin: me, clusters: undefined }),
      note: hasClusters ? null : `${cuisineName} has no restaurant clusters computed, so every ${cuisineName} place counts as outside one.`,
    };
  }, [mode, cuisine, target, v.conf, v.multi, v.area, me, nearMi, community, enc, group?.id, hasClusters, clusterOf, preset]);

  const defaultSort: FindSort = mode === "near" || (mode === "here" && v.area?.kind === "radius") ? "distance" : "confidence";
  const order = sort ?? defaultSort;
  const sorted = useMemo(() => sortSuggestions(result.list, order, seed), [result.list, order, seed]);
  const shown = sorted.slice(0, SHOW);

  const ntas = [...new Set(shown.map((s) => meta.ntas[meta.tract_nta[pts.tract[s.i]]].code))];
  useEffect(() => {
    let live = true;
    Promise.all(ntas.map(loadDetails)).then((ds) => live && setDetails((d) => Object.assign({}, d, ...ds)));
    return () => { live = false; };
  }, [ntas.join()]);

  if (!mode) {
    return (
      <section class="find" role="region" aria-label="Find food">
        <button class="btn find-open" onClick={() => view.set({ find: "near" })}>Find food: suggestions near you, in enclaves and off the beaten path</button>
      </section>
    );
  }
  return (
    <section class="find" role="region" aria-label="Find food">
      <div class="whos-head">
        <h3>Find food{cuisineName && cuisine !== "root" ? `: ${cuisineName}` : ""}</h3>
        <button class="close" aria-label="Close find food" onClick={() => view.set({ find: null })}>×</button>
      </div>
      <div class="seg wrap" role="group" aria-label="Where to look">
        {MODES.map((m) => (
          <button key={m.id} aria-pressed={mode === m.id} title={m.hint} onClick={() => { setSort(null); view.set({ find: m.id }); }}>{m.label}</button>
        ))}
      </div>
      <p class="muted small">{MODES.find((m) => m.id === mode)!.hint}</p>
      {!cuisine && <p class="notice small">Pick a cuisine under Restaurants (or "All restaurants") to get suggestions.</p>}

      {mode === "near" && (
        <div class="ctl-row">
          <div class="seg" role="group" aria-label="Distance">
            {NEAR_MI.map((mi) => <button key={mi} aria-pressed={nearMi === mi} onClick={() => setNearMi(mi)}>{mi} mi</button>)}
          </div>
          <button class="link small" onClick={locate}>Update my location</button>
        </div>
      )}
      {mode === "enclave" && (
        <div class="seg" role="group" aria-label="Which enclaves">
          <button aria-pressed={!community} onClick={() => setCommunity(false)}>Restaurant clusters</button>
          <button aria-pressed={community} onClick={() => setCommunity(true)}>Where the community lives</button>
        </div>
      )}
      {geoMsg && <p class="notice small" role="status">{geoMsg}</p>}
      {result.note && <p class="muted small">{result.note}</p>}

      {cuisine && result.list.length > 0 && (
        <>
          <div class="ctl-row find-sort">
            <label class="ctl-label" for="find-sort">Order</label>
            <select id="find-sort" value={order} onChange={(e) => setSort((e.target as HTMLSelectElement).value as FindSort)}>
              <option value="distance" disabled={!result.list.some((s) => s.dist !== null)}>Closest first</option>
              <option value="confidence">Surest cuisine match first</option>
              <option value="shuffle">Shuffled</option>
            </select>
            <button class="btn small" onClick={() => { setSort("shuffle"); setSeed((s) => s + 1); }}>Shuffle</button>
            <span class="muted small">{result.list.length.toLocaleString("en-US")} candidates</span>
          </div>
          <ol class="find-list">
            {shown.map((s) => {
              const d = details[String(s.i)];
              return (
                <li key={s.i}>
                  <button class="link find-name" onClick={() => onPick(s.i)}>{d?.name ?? "…"}</button>
                  {d && <a class="small" href={mapsLink(d)} target="_blank" rel="noopener noreferrer" aria-label={`Search ${d.name} on Google Maps`}>Maps ↗</a>}
                  <div class="why">
                    {s.dist !== null && <span class="chip">{s.dist < 0.1 ? "< 0.1" : s.dist.toFixed(1)} mi</span>}
                    <span class="chip" title="How the cuisine match was established">{STRENGTH[s.strength]}</span>
                    {pts.flags[s.i] & 1 ? <span class="chip">multi-location</span> : <span class="chip">independent</span>}
                    {s.cluster && <span class="chip">cluster #{s.cluster.rank}</span>}
                    {s.enclaveDist !== undefined && <span class="chip">{s.enclaveDist === 0 ? "in" : `${s.enclaveDist.toFixed(1)} mi from`} {group?.name} enclave</span>}
                    {d && <span class="muted small">{d.address}</span>}
                  </div>
                </li>
              );
            })}
          </ol>
          {sorted.length > SHOW && <p class="muted small">Showing {SHOW} of {sorted.length.toLocaleString("en-US")}. Shuffle for others.</p>}
        </>
      )}
      {cuisine && mode && !result.note && result.list.length === 0 && (mode !== "near" || me) && (
        <p class="muted small">Nothing matches here. Try a wider distance, another mode or "All" inferred tags.</p>
      )}
      <p class="muted small">Candidates, not a ranking of quality: there are no ratings. Check reviews on Google Maps.</p>
    </section>
  );
}
