// "Find food" (SPEC §9.9): candidate restaurants for the selected cuisine, nearby (your location, a
// ZIP code or a point on the map), in a neighborhood or borough, in its restaurant clusters or where
// the community lives, or off the beaten path. Nothing depends on sharing a location: it is one of
// three ways to set a starting point. Every ordering is visible and switchable; there are no
// ratings, so nothing here judges quality.

import { useEffect, useMemo, useState } from "preact/hooks";
import { CONF, loadDetails, mapsLink, type ClusterFile, type CuisineIndex, type Points, type RestaurantDetail } from "../cuisine";
import { loadEnclaves, loadJSON } from "../data";
import { ContactInfo } from "./Restaurants";
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
  /** colloquial place name per restaurant-cluster id, e.g. "Thai Town" (display only) */
  clusterNames?: Record<string, string>;
  /** map-click picking for a starting point (shared with "Drop a radius pin") */
  picking: boolean;
  onPickOnMap: (mi: number) => void;
  onCancelPick: () => void;
}

const MODES: { id: FindMode; label: string; hint: string }[] = [
  { id: "near", label: "Nearby", hint: "Within a distance of a starting point: your location, a ZIP code or a point you click on the map." },
  { id: "here", label: "In a neighborhood", hint: "Inside a neighborhood or borough." },
  { id: "enclave", label: "In an enclave", hint: "In this cuisine's restaurant clusters, or near where the community lives. Needs no location." },
  { id: "outpost", label: "Off the beaten path", hint: "Places of this cuisine outside every one of its restaurant clusters. Needs no location." },
];
const NEAR_MI = [0.25, 0.5, 1, 2];
const SHOW = 20;
const NYC_CENTER: LatLon = { lat: 40.7128, lon: -74.006 };
const STRENGTH = ["", "inferred (low)", "inferred (medium)", "inferred (high)", "DOHMH category"];

type ZipFile = { zips: Record<string, [number, number, number]> };
let zipCache: Promise<ZipFile> | null = null;
const loadZips = () => (zipCache ??= loadJSON<ZipFile>("restaurants/zips.json"));

/** The group whose residential enclaves the "community" option uses for this cuisine. */
export function pairedGroup(groups: GroupsFile, ix: CuisineIndex, selected: string | null, cuisine: string): Group | null {
  const sel = selected ? groups.groups[selected] : null;
  if (sel && sel.cuisines[cuisine]) return sel;
  const owner = ix.file.exact_owner[cuisine];
  if (owner && groups.groups[owner]) return groups.groups[owner];
  return Object.values(groups.groups).find((g) => g.cuisines[cuisine] === "exact") ?? null;
}

/** Restaurants inside a neighborhood, borough or tract focus. */
function unitPool(meta: Meta, pts: Points, a: NonNullable<ViewState["area"]>): number[] {
  const keep = (t: number) =>
    a.kind === "tract" ? meta.tract_geoids[t] === (a as { id: string }).id
      : a.kind === "nta" ? meta.ntas[meta.tract_nta[t]]?.code === (a as { id: string }).id
        : meta.boroughs[meta.tract_boro[t]]?.code === (a as { id: string }).id;
  const pool: number[] = [];
  for (let i = 0; i < pts.n; i++) if (keep(pts.tract[i])) pool.push(i);
  return pool;
}

export function FindFood({ meta, groups, ix, pts, v, clusters, preset, onPick, clusterNames, picking, onPickOnMap, onCancelPick }: Props) {
  const mode = v.find;
  const [sort, setSort] = useState<FindSort | null>(null); // null = the mode's default
  const [seed, setSeed] = useState(1);
  // starting point for "Nearby": the device location (kept in memory only) or the radius pin
  const [useMe, setUseMe] = useState(false);
  const [me, setMe] = useState<LatLon | null>(null);
  const [meMi, setMeMi] = useState(1);
  const [geoMsg, setGeoMsg] = useState<string | null>(null);
  const [zip, setZip] = useState("");
  const [zipMsg, setZipMsg] = useState<string | null>(null);
  const [zipPin, setZipPin] = useState<{ zip: string; key: string } | null>(null);
  const [community, setCommunity] = useState(false);
  const [enc, setEnc] = useState<EnclaveBundle | null>(null);
  const [details, setDetails] = useState<Record<string, RestaurantDetail>>({});

  const cuisine = v.cuisine;
  const target = cuisine && cuisine !== "root" ? ix.byId.get(cuisine) ?? null : null;
  const cuisineName = cuisine === "root" ? "restaurant" : cuisine ? ix.node(cuisine)?.name ?? cuisine : null;
  const group = cuisine && cuisine !== "root" ? pairedGroup(groups, ix, v.group, cuisine) : null;

  const pin = v.area?.kind === "radius" ? v.area : null;
  const pinKey = pin ? `${pin.lat.toFixed(5)},${pin.lon.toFixed(5)}` : "";
  const fromZip = zipPin && zipPin.key === pinKey ? zipPin.zip : null; // the pin is still where the ZIP put it
  // the origin for "Nearby", and for distances in every other mode
  const origin: LatLon | null = useMe && me ? me : pin ? { lat: pin.lat, lon: pin.lon } : me;
  const nearMi = useMe && me ? meMi : pin?.mi ?? meMi;

  const locate = () => {
    setUseMe(true);
    if (!("geolocation" in navigator)) {
      setGeoMsg("This browser can't share a location. Enter a ZIP code or click the map instead.");
      return;
    }
    setGeoMsg("Finding you…");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const at = { lat: p.coords.latitude, lon: p.coords.longitude };
        setMe(at);
        setGeoMsg(distanceMi(at, NYC_CENTER) > 25 ? "You seem to be outside New York City, so there may be nothing nearby. Enter a ZIP code or click the map instead." : null);
      },
      () => {
        setUseMe(false);
        setGeoMsg("Location is off or not allowed. Enter a ZIP code or click the map instead.");
      },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 },
    );
  };

  const goZip = async (e: Event) => {
    e.preventDefault();
    const z = zip.trim();
    if (!/^\d{5}$/.test(z)) {
      setZipMsg("Enter a 5-digit ZIP code.");
      return;
    }
    const at = (await loadZips()).zips[z];
    if (!at) {
      setZipMsg(`ZIP ${z} isn't in the NYC restaurant data. Try a nearby ZIP, or click the map.`);
      return;
    }
    const [lat, lon] = [at[0] / 1e5, at[1] / 1e5];
    setZipMsg(null);
    setUseMe(false);
    setGeoMsg(null);
    setZipPin({ zip: z, key: `${lat.toFixed(5)},${lon.toFixed(5)}` });
    view.set({ area: { kind: "radius", lat, lon, mi: nearMi } });
  };

  const setRadius = (mi: number) => {
    if (useMe && me) setMeMi(mi);
    else if (pin) view.set({ area: { ...pin, mi } });
    else setMeMi(mi);
  };

  useEffect(() => {
    setEnc(null);
    if (!mode || !group) return;
    let live = true;
    loadEnclaves(group.id).then((e) => live && setEnc(e)).catch(() => undefined);
    return () => { live = false; };
  }, [!!mode, group?.id]);
  // residential enclaves of the paired group (default dimension, current preset): tag every suggestion
  const encGeoms = useMemo(() => enc && group
    ? enc.geojson.features.filter((f) => f.properties?.dim === group.default_dimension && f.properties?.preset === preset).map((f) => f.geometry)
    : [], [enc, group?.id, preset]);

  const clusterOf = useMemo(() => {
    const m = new Map<number, { id: string; rank: number }>();
    (clusters?.stats[preset] ?? []).forEach((c, k) => c.members.forEach((i) => m.set(i, { id: c.id, rank: k + 1 })));
    return m;
  }, [clusters, preset]);
  const hasClusters = !!clusters && clusters.node === cuisine;

  const result = useMemo((): { list: Suggestion[]; note: string | null } => {
    if (!mode || !cuisine) return { list: [], note: null };
    const all = () => Array.from({ length: pts.n }, (_, i) => i);
    const base = { ix, pts, target, floor: CONF[v.conf], multi: v.multi, clusters: hasClusters ? clusterOf : undefined,
      enclaves: encGeoms.length ? encGeoms : undefined, enclaveMi: 0.5 };
    if (mode === "near") {
      if (!origin) return { list: [], note: null };
      return { list: findCandidates({ ...base, pool: all(), origin, maxMi: nearMi }), note: null };
    }
    if (mode === "here") {
      const a = v.area;
      if (!a) return { list: [], note: "Pick a neighborhood or borough above." };
      if (a.kind === "radius") return { list: findCandidates({ ...base, pool: all(), origin, maxMi: a.mi }), note: "Inside the radius pin." };
      return { list: findCandidates({ ...base, pool: unitPool(meta, pts, a), origin }), note: null };
    }
    if (mode === "enclave") {
      if (community) {
        if (!group) return { list: [], note: `No group is paired with ${cuisineName}, so there are no residential enclaves to look near.` };
        if (!enc) return { list: [], note: "Loading enclaves…" };
        if (!encGeoms.length) return { list: [], note: `${group.name} has no residential enclaves under this preset.` };
        return {
          list: findCandidates({ ...base, pool: all(), origin, enclaveOnly: true }),
          note: `Within 0.5 mi of a ${group.name} residential enclave (${meta.dimensions[group.default_dimension]?.short ?? group.default_dimension}), anywhere in the city. Census residence picks where to look; the restaurants' cuisine still comes only from restaurant data.`,
        };
      }
      if (!hasClusters) return { list: [], note: `${cuisineName} has no restaurant clusters computed (only cuisines paired with a group are clustered).` };
      return { list: findCandidates({ ...base, pool: clusterOf.keys(), origin }), note: null };
    }
    // outpost
    const pool = all().filter((i) => !clusterOf.has(i));
    return {
      list: findCandidates({ ...base, pool, origin, clusters: undefined }),
      note: hasClusters ? null : `${cuisineName} has no restaurant clusters computed, so every ${cuisineName} place counts as outside one.`,
    };
  }, [mode, cuisine, target, v.conf, v.multi, v.area, origin?.lat, origin?.lon, nearMi, community, enc, encGeoms, group?.id, hasClusters, clusterOf, preset]);

  const hasDist = result.list.some((s) => s.dist !== null);
  // once there is a starting point (location, ZIP or pin), closest first is the useful default
  const defaultSort: FindSort = hasDist ? "distance" : "confidence";
  const order = sort === "distance" && !hasDist ? "confidence" : sort ?? defaultSort;
  const sorted = useMemo(() => sortSuggestions(result.list, order, seed), [result.list, order, seed]);
  const shown = sorted.slice(0, SHOW);

  const ntas = [...new Set(shown.map((s) => meta.ntas[meta.tract_nta[pts.tract[s.i]]].code))];
  useEffect(() => {
    let live = true;
    Promise.all(ntas.map(loadDetails)).then((ds) => live && setDetails((d) => Object.assign({}, d, ...ds)));
    return () => { live = false; };
  }, [ntas.join()]);

  const sortedNtas = useMemo(() => [...meta.ntas].sort((a, b) => a.boro.localeCompare(b.boro) || a.name.localeCompare(b.name)), [meta]);

  if (!mode) {
    return (
      <section class="find" role="region" aria-label="Find food">
        <button class="btn find-open" onClick={() => view.set({ find: "near" })}>Find food: suggestions nearby, in a neighborhood, in enclaves and off the beaten path</button>
      </section>
    );
  }
  const originLabel = useMe && me ? "your location" : pin ? (fromZip ? `ZIP ${fromZip}` : "the pin on the map (drag it to move)") : null;
  return (
    <section class="find" role="region" aria-label="Find food">
      <div class="whos-head">
        <h3>Find food{cuisineName && cuisine !== "root" ? `: ${cuisineName}` : ""}</h3>
        <button class="close" aria-label="Close find food" onClick={() => view.set({ find: null })}>×</button>
      </div>
      <div class="seg wrap" role="group" aria-label="Where to look">
        {MODES.map((m) => (
          <button key={m.id} aria-pressed={mode === m.id} onClick={() => { setSort(null); view.set({ find: m.id }); }}>{m.label}</button>
        ))}
      </div>
      <p class="muted small">{MODES.find((m) => m.id === mode)!.hint}</p>
      {!cuisine && <p class="notice small">Pick a cuisine under Restaurants (or "All restaurants") to get suggestions.</p>}

      {mode === "near" && (
        <div class="find-start" role="group" aria-label="Starting point">
          <div class="ctl-label">Start from</div>
          <div class="find-start-row">
            <button class={`btn small${useMe && me ? " active" : ""}`} onClick={locate}>Use my location</button>
            <form class="find-zip" onSubmit={goZip}>
              <input aria-label="ZIP code" inputMode="numeric" maxLength={5} placeholder="ZIP code" value={zip}
                onInput={(e) => setZip((e.target as HTMLInputElement).value.replace(/\D/g, ""))} />
              <button class="btn small" type="submit">Go</button>
            </form>
            {picking
              ? <button class="btn small active" onClick={onCancelPick}>Click the map… (cancel)</button>
              : <button class="btn small" onClick={() => { setUseMe(false); setGeoMsg(null); onPickOnMap(nearMi); }}>Click the map</button>}
          </div>
          {geoMsg && <p class="notice small" role="status">{geoMsg}</p>}
          {zipMsg && <p class="notice small" role="status">{zipMsg}</p>}
          <div class="ctl-row">
            <span class="ctl-label">Within</span>
            <div class="seg" role="group" aria-label="Distance">
              {NEAR_MI.map((mi) => <button key={mi} aria-pressed={nearMi === mi} onClick={() => setRadius(mi)}>{mi} mi</button>)}
            </div>
          </div>
          <p class="muted small">{originLabel ? `Starting from ${originLabel}.` : "Choose a starting point. Your location is optional: it stays on your device and is never put in the URL."}{fromZip && " ZIP centres are approximate (the middle of the ZIP's restaurants)."}</p>
        </div>
      )}
      {mode === "here" && (
        <div class="find-start" role="group" aria-label="Neighborhood or borough">
          <select aria-label="Neighborhood" value={v.area?.kind === "nta" ? v.area.id : ""}
            onChange={(e) => { const id = (e.target as HTMLSelectElement).value; if (id) view.set({ area: { kind: "nta", id } }); }}>
            <option value="">Neighborhood…</option>
            {meta.boroughs.map((b) => (
              <optgroup key={b.code} label={b.name}>
                {sortedNtas.filter((n) => n.boro === b.code).map((n) => <option key={n.code} value={n.code}>{n.name}</option>)}
              </optgroup>
            ))}
          </select>
          <div class="seg wrap" role="group" aria-label="Borough">
            {meta.boroughs.map((b) => (
              <button key={b.code} aria-pressed={v.area?.kind === "boro" && v.area.id === b.code} onClick={() => view.set({ area: { kind: "boro", id: b.code } })}>{b.name}</button>
            ))}
          </div>
        </div>
      )}
      {mode === "enclave" && (
        <div class="seg" role="group" aria-label="Which enclaves">
          <button aria-pressed={!community} onClick={() => setCommunity(false)}>Restaurant clusters</button>
          <button aria-pressed={community} onClick={() => setCommunity(true)}>Where the community lives</button>
        </div>
      )}
      {result.note && <p class="muted small">{result.note}</p>}

      {cuisine && result.list.length > 0 && (
        <>
          <div class="ctl-row find-sort">
            <label class="ctl-label" for="find-sort">Order</label>
            <select id="find-sort" value={order} onChange={(e) => setSort((e.target as HTMLSelectElement).value as FindSort)}>
              <option value="distance" disabled={!hasDist}>Closest first{hasDist ? "" : " (set a starting point under Nearby)"}</option>
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
                    {s.cluster && <span class="chip enc-cluster" title="Member of this cuisine's restaurant cluster (commercial enclave)">{clusterNames?.[s.cluster.id] ? `${clusterNames[s.cluster.id]} cluster` : `${cuisineName} cluster #${s.cluster.rank}`}</span>}
                    {s.enclaveDist !== undefined && <span class="chip enc-res" title="Distance to a residential enclave of the paired group (census residence; context, not a cuisine label)">{s.enclaveDist === 0 ? "in" : `${s.enclaveDist.toFixed(1)} mi from`} {group?.name} residential enclave</span>}
                    {d && <span class="muted small">{d.address}</span>}
                  </div>
                  {d && <ContactInfo d={d} compact />}
                </li>
              );
            })}
          </ol>
          {sorted.length > SHOW && <p class="muted small">Showing {SHOW} of {sorted.length.toLocaleString("en-US")}. Shuffle for others.</p>}
        </>
      )}
      {cuisine && !result.note && result.list.length === 0 && (mode !== "near" || origin) && (
        <p class="muted small">Nothing matches here. Try a wider distance, another mode or "All" inferred tags.</p>
      )}
      <p class="muted small">Candidates, not a ranking of quality: there are no ratings. Check reviews on Google Maps.</p>
    </section>
  );
}
