// Application shell: map-first layout with a collapsible control panel (§1.2, §9.8) and an area
// panel for "who's here" and area focus (§9.2, §9.3).

import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { resolveUnit, type UnitArea } from "../areas";
import { loadDemo, loadEnclaves, loadGazetteer, loadGeo, loadGroups, loadMeta } from "../data";
import { bounds, circlePolygon } from "../geo";
import { MapView, type HoverInfo } from "../map/mapview";
import { fmtCount, fmtMetric, indicesWithState, scaleFor, STATE_LABEL, unitColors, type Scale } from "../scales";
import { useView, view } from "../store";
import { STATE, type DemoBundle, type EnclaveBundle, type EnclaveItem, type GroupsFile, type Meta, type Metric, type Place } from "../types";
import type { Area } from "../url";
import { CONF, CuisineIndex, FLAG, loadClusters, loadCuisines, loadPoints, type ClusterFile, type Points } from "../cuisine";
import { AreaPanel, areaTitle } from "./AreaPanel";
import { AreaRestaurants } from "./AreaRestaurants";
import { ClusterTable, defaultCuisine, RestaurantCard, RestaurantControls } from "./Restaurants";
import { FocusControls } from "./FocusControls";
import { GroupPicker } from "./GroupPicker";
import { GroupSection } from "./GroupSection";
import { Legend, MiniLegend } from "./Legend";

type FocusGeom = GeoJSON.Polygon | GeoJSON.MultiPolygon;

async function areaGeometry(meta: Meta, a: Area): Promise<FocusGeom | null> {
  if (a.kind === "radius") return circlePolygon(a.lon, a.lat, a.mi);
  if (a.kind === "tract") return null; // tracts are selected (outlined), not masked
  const unit = resolveUnit(meta, a as UnitArea);
  if (!unit) return null;
  const fc = await loadGeo(a.kind === "nta" ? "ntas" : "boroughs");
  const f = fc.features.find((x) => Number(x.properties?.i) === unit.index);
  return (f?.geometry as FocusGeom) ?? null;
}

export function App() {
  const v = useView();
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapView | null>(null);
  const pickingRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [groups, setGroups] = useState<GroupsFile | null>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [demo, setDemo] = useState<DemoBundle | null>(null);
  const [enc, setEnc] = useState<EnclaveBundle | null>(null);
  const [scale, setScale] = useState<Scale | null>(null);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [picking, setPicking] = useState(false);
  const [areaOpen, setAreaOpen] = useState(true);
  const [ix, setIx] = useState<CuisineIndex | null>(null);
  const [pts, setPts] = useState<Points | null>(null);
  const [clusterFile, setClusterFile] = useState<ClusterFile | null>(null);
  const [selCluster, setSelCluster] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([loadMeta(), loadGroups()]).then(([m, g]) => { setMeta(m); setGroups(g); }).catch((e) => setError(String(e)));
    loadGazetteer().then(setPlaces).catch(() => setPlaces([]));
    Promise.all([loadCuisines(), loadPoints()]).then(([c, p]) => { setIx(new CuisineIndex(c)); setPts(p); }).catch((e) => setError(String(e)));
    const mv = new MapView(mapEl.current!);
    mapRef.current = mv;
    mv.whenReady().then(() => setMapReady(true));
    mv.onHover(setHover);
    mv.onRestaurant((i) => view.set({ restaurant: i }));
    mv.onClick((at, unit) => {
      if (pickingRef.current) {
        const cur = view.get().area;
        view.set({ area: { kind: "radius", lat: at.lat, lon: at.lon, mi: cur?.kind === "radius" ? cur.mi : 0.5 } });
        setPickingBoth(false);
        return;
      }
      if (!unit || unit.level === "boro") return;
      view.set({ area: unit.level === "tract" ? { kind: "tract", id: String(unit.props.geoid) } : { kind: "nta", id: String(unit.props.nta) } });
    });
    (window as unknown as { __map: MapView }).__map = mv; // for debugging and E2E
  }, []);

  const setPickingBoth = (on: boolean) => {
    pickingRef.current = on;
    setPicking(on);
    mapRef.current?.setPicking(on);
  };

  const group = groups && v.group ? groups.groups[v.group] ?? null : null;
  const dim = group ? (v.dim && group.dims[v.dim] ? v.dim : group.default_dimension) : null;
  const dimMeta = group && dim ? group.dims[dim] : null;
  const level = dimMeta ? (v.level ?? dimMeta.level) : "tract";
  const preset = meta && meta.presets.presets[v.preset] ? v.preset : meta?.presets.default_preset ?? "default";

  useEffect(() => {
    setDemo(null);
    if (!group || !dim) return;
    let live = true;
    loadDemo(group.id, dim).then((d) => live && setDemo(d)).catch((e) => setError(String(e)));
    return () => { live = false; };
  }, [group?.id, dim]);

  useEffect(() => {
    setEnc(null);
    if (!group) return;
    let live = true;
    loadEnclaves(group.id).then((d) => live && setEnc(d)).catch((e) => setError(String(e)));
    return () => { live = false; };
  }, [group?.id]);

  // choropleth
  useEffect(() => {
    const mv = mapRef.current;
    if (!mv || !mapReady) return;
    if (!demo) {
      mv.setChoropleth(level, null, { caution: [], suppressed: [], unavailable: [] });
      setScale(null);
      return;
    }
    const d = demo[level];
    const s = scaleFor(d, v.metric);
    setScale(s);
    mv.setChoropleth(level, unitColors(d, v.metric, s), {
      caution: indicesWithState(d, STATE.caution),
      suppressed: indicesWithState(d, STATE.suppressed),
      unavailable: indicesWithState(d, STATE.unavailable),
    });
  }, [demo, level, v.metric, mapReady]);

  // enclaves
  const enclaveFC = useMemo(() => {
    if (!enc || !dim) return null;
    return { type: "FeatureCollection" as const, features: enc.geojson.features.filter((f) => f.properties?.dim === dim && f.properties?.preset === preset) };
  }, [enc, dim, preset]);
  useEffect(() => {
    if (mapRef.current && mapReady) mapRef.current.setEnclaves(enclaveFC, v.enclaves);
  }, [enclaveFC, v.enclaves, mapReady]);

  // area: selection outline, mask, fit, pin
  const areaKey = v.area ? JSON.stringify(v.area) : "";
  const resolved = meta && v.area && v.area.kind !== "radius" ? resolveUnit(meta, v.area as UnitArea) : null;
  const lastFit = useRef<string>("");
  useEffect(() => setAreaOpen(true), [areaKey]);
  useEffect(() => {
    const mv = mapRef.current;
    if (!mv || !mapReady || !meta) return;
    mv.setSelection(resolved ? { level: resolved.level, index: resolved.index } : null);
    const a = v.area;
    mv.setPin(a?.kind === "radius" ? { lon: a.lon, lat: a.lat } : null, (at) => {
      const cur = view.get().area;
      if (cur?.kind === "radius") view.set({ area: { ...cur, lat: at.lat, lon: at.lon } });
    });
    let live = true;
    (a ? areaGeometry(meta, a) : Promise.resolve(null)).then((g) => {
      if (!live) return;
      mv.setFocus(g);
      // fit when the focused place changes (not on every radius-slider tick)
      const fitKey = a ? (a.kind === "radius" ? `r:${a.lat.toFixed(4)},${a.lon.toFixed(4)}` : `${a.kind}:${a.id}`) : "";
      if (g && fitKey !== lastFit.current) {
        // radius focus: show some context around the circle (at least ~1 mi each way)
        const fitGeom = a?.kind === "radius" ? circlePolygon(a.lon, a.lat, Math.max(a.mi * 2.5, 1)) : g;
        requestAnimationFrame(() => mv.fitTo(bounds(fitGeom), 30));
      }
      lastFit.current = fitKey;
    });
    return () => { live = false; };
  }, [areaKey, mapReady, meta]);

  const selectGroup = (id: string) => view.set({ group: id, dim: null, level: null, cuisine: defaultCuisine(groups?.groups[id] ?? null), restaurant: null });

  // restaurants on the map: those matching the cuisine filter (§9.5)
  const restaurantFC = useMemo(() => {
    if (!ix || !pts || !v.cuisine) return { fc: null, total: 0, viaTags: 0 };
    const target = v.cuisine === "root" ? null : ix.byId.get(v.cuisine);
    if (target === undefined) return { fc: null, total: 0, viaTags: 0 };
    const floor = CONF[v.conf];
    const feats: GeoJSON.Feature[] = [];
    let viaTags = 0;
    for (let i = 0; i < pts.n; i++) {
      const f = pts.flags[i];
      if (!(f & FLAG.analysis) && !(v.multi && f & FLAG.multi)) continue;
      const k = target === null ? 1 : ix.matchKind(pts, i, target, floor);
      if (!k) continue;
      if (k === 2) viaTags++;
      feats.push({ type: "Feature", properties: { i, k, m: f & FLAG.multi ? 1 : 0 }, geometry: { type: "Point", coordinates: [pts.lon[i] / 1e5, pts.lat[i] / 1e5] } });
    }
    return { fc: { type: "FeatureCollection" as const, features: feats }, total: feats.length, viaTags };
  }, [ix, pts, v.cuisine, v.conf, v.multi]);
  useEffect(() => {
    if (mapRef.current && mapReady) mapRef.current.setRestaurants(restaurantFC.fc, v.restaurant);
  }, [restaurantFC, v.restaurant, mapReady]);

  // clusters of the filtered cuisine (only paired cuisines are clustered)
  useEffect(() => {
    setClusterFile(null);
    setSelCluster(null);
    if (!v.cuisine || v.cuisine === "root") return;
    let live = true;
    loadClusters(v.cuisine).then((c) => live && setClusterFile(c)).catch(() => live && setClusterFile(null));
    return () => { live = false; };
  }, [v.cuisine]);
  const clusterFC = useMemo(() => clusterFile
    ? { type: "FeatureCollection" as const, features: clusterFile.geojson.features.filter((f) => f.properties?.preset === preset) }
    : null, [clusterFile, preset]);
  useEffect(() => {
    if (mapRef.current && mapReady) mapRef.current.setClusters(clusterFC, selCluster);
  }, [clusterFC, selCluster, mapReady]);
  const focusCluster = (id: string) => {
    setSelCluster(id);
    const f = clusterFile?.geojson.features.find((x) => x.properties?.id === id && x.properties?.part === "catchment");
    if (f) mapRef.current?.fitTo(bounds(f.geometry));
  };
  const zoomToEnclave = (id: string) => {
    const f = enc?.geojson.features.find((x) => x.properties?.id === id);
    if (f) mapRef.current?.fitTo(bounds(f.geometry));
  };

  const hasArea = !!v.area;
  return (
    <div class={`app${panelOpen ? "" : " panel-collapsed"}${hasArea ? " has-area" : ""}`}>
      <div ref={mapEl} id="map" role="region" aria-label="Map of New York City" />
      <aside class="panel" aria-label="Controls">
        <header class="panel-head">
          <h1>NYC Enclave Finder</h1>
          <button class="panel-toggle" aria-expanded={panelOpen} aria-controls="panel-body" onClick={() => setPanelOpen(!panelOpen)}>
            {panelOpen ? "Hide panel" : group ? `${group.name} ▴` : "Show panel"}
          </button>
        </header>
        <div id="panel-body" class="panel-body">
          <p class="lede">Where groups live, where their restaurants cluster, and how the two relate. The map measures; you draw the conclusions. Click the map to see who's here.</p>
          {error && <p class="error">Could not load data: {error}</p>}
          {groups ? <GroupPicker groups={groups} selected={group?.id ?? null} onSelect={selectGroup} /> : <p class="muted">Loading…</p>}
          {meta && (
            <FocusControls meta={meta} groups={groups} places={places} area={v.area} picking={picking} onArea={(a) => view.set({ area: a })} onPick={setPickingBoth}
              onPlace={(p) => view.set({
                area: { kind: "radius", lat: p.lat, lon: p.lon, mi: p.radius_mi },
                ...(p.group && groups?.groups[p.group]
                  ? { group: p.group, dim: null, level: null, cuisine: defaultCuisine(groups.groups[p.group]), restaurant: null }
                  : {}),
              })} />
          )}
          {group && meta && groups && dim && (
            <GroupSection meta={meta} groups={groups} group={group} dim={dim} level={level} preset={preset} v={v} enc={enc}
              onEnclave={(it: EnclaveItem) => zoomToEnclave(it.id)} />
          )}
          {ix && pts && <RestaurantControls ix={ix} pts={pts} v={v} group={group} shown={{ total: restaurantFC.total, viaTags: restaurantFC.viaTags }} />}
          {ix && meta && <ClusterTable ix={ix} file={clusterFile} preset={preset} presetLabel={meta.presets.presets[preset].label} selected={selCluster} onSelect={focusCluster} />}
          {meta && (
            <details class="advanced">
              <summary>Advanced</summary>
              <div class="ctl">
                <label class="ctl-label" for="preset">Analytical preset</label>
                <select id="preset" value={preset} onChange={(e) => view.set({ preset: (e.target as HTMLSelectElement).value })}>
                  {Object.entries(meta.presets.presets).map(([id, p]) => <option key={id} value={id}>{p.label}</option>)}
                </select>
                <p class="muted small">
                  Enclave = adjacent units with LQ ≥ {meta.presets.presets[preset].enclave.lq_min}, ≥ {meta.presets.presets[preset].enclave.count_min} residents each, data state {meta.presets.presets[preset].enclave.states.join("/")}, and ≥ {meta.presets.presets[preset].enclave.min_enclave_pop} residents in total.
                </p>
              </div>
            </details>
          )}
          <Legend level={level} metric={v.metric} scale={scale} shareOf={(meta && dim && meta.dimensions[dim].share_of) || "residents"} enclaves={v.enclaves && !!enclaveFC?.features.length} clusters={!!clusterFC?.features.length} restaurants={!!restaurantFC.total} />
          <footer class="foot muted small">
            Data: ACS {meta?.acs_vintage} 5-year (U.S. Census Bureau); NYC DCP geography. "Lives here" means census-measured residence.
          </footer>
        </div>
      </aside>
      {meta && ix && pts && v.restaurant !== null && v.restaurant < pts.n && (
        <aside class={`panel panel-right card-panel${v.area ? " stacked" : ""}`} aria-label="Restaurant details">
          <div class="panel-body">
            <RestaurantCard ix={ix} pts={pts} meta={meta} index={v.restaurant} onClose={() => view.set({ restaurant: null })} />
          </div>
        </aside>
      )}
      {meta && groups && v.area && (
        areaOpen ? (
          <aside class="panel panel-right" aria-label="Area details">
            <div class="panel-body">
              <AreaPanel meta={meta} groups={groups} area={v.area} places={places}
                selected={group && dim ? { id: group.id, name: group.name, dim, preset, enc } : null}
                onArea={(a) => view.set({ area: a })} onGroup={selectGroup} onEnclave={zoomToEnclave}
                onClose={() => view.set({ area: null })} onHide={() => setAreaOpen(false)}
                extra={(stats) => ix && pts && v.area ? (
                  <AreaRestaurants meta={meta} ix={ix} pts={pts} tracts={stats.tracts} v={v} clusters={clusterFile} preset={preset} onCluster={focusCluster}
                    level={v.area.kind === "radius" ? "radius" : v.area.kind}
                    radius={v.area.kind === "radius" ? { lat: v.area.lat, lon: v.area.lon, mi: v.area.mi } : null} />
                ) : null} />
            </div>
          </aside>
        ) : (
          <aside class="panel panel-right collapsed" aria-label="Area details">
            <div class="panel-head">
              <span class="collapsed-title">{areaTitle(meta, v.area, places)}</span>
              <div class="head-btns">
                <button class="panel-toggle" aria-label="Show area details" onClick={() => setAreaOpen(true)}>Show</button>
                <button class="close" aria-label="Close area" onClick={() => view.set({ area: null })}>×</button>
              </div>
            </div>
          </aside>
        )
      )}
      <MiniLegend metric={v.metric} scale={scale} />
      {hover && demo && meta && group && <Tooltip hover={hover} demo={demo} meta={meta} metric={v.metric} level={level} />}
    </div>
  );
}

function Tooltip({ hover, demo, meta, metric, level }: { hover: HoverInfo; demo: DemoBundle; meta: Meta; metric: Metric; level: "tract" | "nta" }) {
  const d = demo[level];
  const i = hover.index;
  const st = d.st[i];
  const name = level === "nta" ? meta.ntas[i]?.name : `Tract ${hover.props.label} · ${meta.ntas[meta.tract_nta[i]]?.name ?? ""}`;
  const val = metric === "lq" ? d.lq[i] : metric === "share" ? d.s[i] : d.e[i];
  const shown = st === STATE.reliable || st === STATE.caution || st === STATE.zero;
  return (
    <div class="tooltip" style={{ left: `${hover.point.x + 14}px`, top: `${hover.point.y + 14}px` }} role="status">
      <div class="tt-name">{name}</div>
      {shown && (
        <div>
          <strong>{fmtMetric(metric, val)}</strong>
          {metric !== "count" && <> · {fmtCount(d.e[i])}{d.m[i] !== null ? ` ± ${fmtCount(d.m[i])}` : ""} residents</>}
          {metric === "count" && d.m[i] !== null && <> ± {fmtCount(d.m[i])}</>}
        </div>
      )}
      <div class={`tt-state st-${st}`}>{STATE_LABEL[st]}</div>
    </div>
  );
}
