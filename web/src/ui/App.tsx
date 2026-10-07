// Application shell: map-first layout with a collapsible control panel (§1.2, §9.8).

import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { loadDemo, loadEnclaves, loadGroups, loadMeta } from "../data";
import { bboxOf, MapView, type HoverInfo } from "../map/mapview";
import { fmtCount, fmtLQ, fmtMetric, fmtShare, indicesWithState, scaleFor, STATE_LABEL, unitColors, type Scale } from "../scales";
import { useView, view } from "../store";
import { STATE, type DemoBundle, type EnclaveBundle, type EnclaveItem, type GroupsFile, type Meta, type Metric } from "../types";
import { resolveUnit, type UnitArea } from "../areas";
import { GroupPicker } from "./GroupPicker";
import { WhosHere } from "./WhosHere";
import { Legend, MiniLegend } from "./Legend";

const METRICS: { id: Metric; label: string }[] = [
  { id: "lq", label: "LQ" },
  { id: "share", label: "% share" },
  { id: "count", label: "Count" },
];

export function App() {
  const v = useView();
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapView | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [groups, setGroups] = useState<GroupsFile | null>(null);
  const [demo, setDemo] = useState<DemoBundle | null>(null);
  const [enc, setEnc] = useState<EnclaveBundle | null>(null);
  const [scale, setScale] = useState<Scale | null>(null);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([loadMeta(), loadGroups()]).then(([m, g]) => { setMeta(m); setGroups(g); }).catch((e) => setError(String(e)));
    const mv = new MapView(mapEl.current!);
    mapRef.current = mv;
    mv.whenReady().then(() => setMapReady(true));
    mv.onHover(setHover);
    mv.onClick((h) => {
      if (h.level === "boro") return;
      const area: UnitArea = h.level === "tract"
        ? { kind: "tract", id: String(h.props.geoid) }
        : { kind: "nta", id: String(h.props.nta) };
      view.set({ area });
    });
    (window as unknown as { __map: MapView }).__map = mv; // for debugging and E2E
  }, []);

  const group = groups && v.group ? groups.groups[v.group] ?? null : null;
  const dim = group ? (v.dim && group.dims[v.dim] ? v.dim : group.default_dimension) : null;
  const dimMeta = group && dim ? group.dims[dim] : null;
  const level = dimMeta ? (v.level ?? dimMeta.level) : "tract";
  const preset = meta && meta.presets.presets[v.preset] ? v.preset : meta?.presets.default_preset ?? "default";

  // load the group x dimension bundle and enclaves
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

  // paint the choropleth
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

  const enclaveSet = enc && dim ? enc.stats[dim]?.[preset] ?? null : null;
  const enclaveFC = useMemo(() => {
    if (!enc || !dim) return null;
    return {
      type: "FeatureCollection" as const,
      features: enc.geojson.features.filter((f) => f.properties?.dim === dim && f.properties?.preset === preset),
    };
  }, [enc, dim, preset]);

  useEffect(() => {
    const mv = mapRef.current;
    if (!mv || !mapReady) return;
    mv.setEnclaves(enclaveFC, v.enclaves);
  }, [enclaveFC, v.enclaves, mapReady]);

  const selectGroup = (id: string) => view.set({ group: id, dim: null, level: null });

  const unitArea = v.area && v.area.kind !== "radius" ? (v.area as UnitArea) : null;
  const resolved = meta && unitArea ? resolveUnit(meta, unitArea) : null;
  useEffect(() => {
    const mv = mapRef.current;
    if (!mv || !mapReady) return;
    mv.setSelection(resolved ? { level: resolved.level, index: resolved.index } : null);
  }, [resolved?.level, resolved?.index, mapReady]);

  const zoomToEnclave = (item: EnclaveItem) => {
    const f = enc?.geojson.features.find((x) => x.properties?.id === item.id);
    if (f) mapRef.current?.fitTo(bboxOf(f.geometry));
  };

  const dimDef = meta && dim ? meta.dimensions[dim] : null;

  return (
    <div class={`app${panelOpen ? "" : " panel-collapsed"}${unitArea ? " has-area" : ""}`}>
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
          <div class="ctl">
            <span class="ctl-label" id="boro-label">Boroughs</span>
            <div class="seg wrap" role="group" aria-labelledby="boro-label">
              {meta?.boroughs.map((b) => (
                <button key={b.code} aria-pressed={unitArea?.kind === "boro" && unitArea.id === b.code}
                  onClick={() => view.set({ area: { kind: "boro", id: b.code } })}>{b.name}</button>
              ))}
            </div>
          </div>
          {error && <p class="error">Could not load data: {error}</p>}
          {groups ? <GroupPicker groups={groups} selected={group?.id ?? null} onSelect={selectGroup} /> : <p class="muted">Loading…</p>}

          {group && meta && dim && dimMeta && (
            <>
              {group.proxy && (
                <p class="notice proxy" role="note"><strong>Proxy measure.</strong> {group.rationale}</p>
              )}
              <div class="ctl">
                <span class="ctl-label" id="dim-label">Dimension</span>
                <div class="seg wrap" role="group" aria-labelledby="dim-label">
                  {Object.entries(meta.dimensions).map(([id, d]) => {
                    const has = !!group.dims[id];
                    return (
                      <button key={id} aria-pressed={id === dim} disabled={!has} title={has ? d.name : `No data: ${group.name} is not a category in ${d.name}`}
                        onClick={() => view.set({ dim: id, level: null })}>
                        {d.short}{!has && <span class="nodata"> · no data</span>}
                        {has && group.dims[id].bucket && <span class="badge">bucket</span>}
                        {id === group.default_dimension && <span class="dot" title="Default dimension">•</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div class="ctl-row">
                <div class="ctl">
                  <span class="ctl-label" id="metric-label">Show</span>
                  <div class="seg" role="group" aria-labelledby="metric-label">
                    {METRICS.map((m) => (
                      <button key={m.id} aria-pressed={v.metric === m.id} onClick={() => view.set({ metric: m.id })}>{m.label}</button>
                    ))}
                  </div>
                </div>
                <div class="ctl">
                  <span class="ctl-label" id="level-label">Units</span>
                  <div class="seg" role="group" aria-labelledby="level-label">
                    <button aria-pressed={level === "tract"} onClick={() => view.set({ level: "tract" })}>Tracts</button>
                    <button aria-pressed={level === "nta"} onClick={() => view.set({ level: "nta" })}>Neighborhoods</button>
                  </div>
                </div>
              </div>
              {dimMeta.level === "nta" && (
                <p class="notice" role="note">
                  Too sparse at tract level: only {Math.round(dimMeta.usable_share_tract * 100)}% of {group.name} residents in this dimension live in tracts with a usable estimate, so the map defaults to neighborhoods (NTAs).
                </p>
              )}

              <section class="summary" aria-label="Group summary" role="region">
                <h2>{group.name} <span class="muted">· {dimDef!.name}</span></h2>
                <p class="def">
                  Shares are of <strong>{dimDef!.share_of}</strong>. Counted: {dimDef!.numerator_universe}.
                  {dimMeta.bucket && <> <span class="badge">bucket</span> Source category: {dimMeta.bucket}.</>}
                  {dimMeta.derived && <> Summed from {dimMeta.labels.length} categories{dimMeta.missing_from_sum.length ? ` (not included: ${dimMeta.missing_from_sum.map((c) => groups!.groups[c]?.name ?? c).join(", ")})` : ""}.</>}
                </p>
                <dl class="kv">
                  <dt>Citywide</dt>
                  <dd>{fmtCount(dimMeta.city.e)}{dimMeta.city.m ? ` ± ${fmtCount(dimMeta.city.m)}` : ""} ({fmtShare(dimMeta.city.share)})</dd>
                  <dt>Default dimension</dt>
                  <dd>{meta.dimensions[group.default_dimension].name}. {group.rationale}</dd>
                </dl>
              </section>

              <section class="enclaves" aria-label="Residential enclaves" role="region">
                <div class="sec-head">
                  <h3>Residential enclaves</h3>
                  <label class="check"><input type="checkbox" checked={v.enclaves} onChange={(e) => view.set({ enclaves: (e.target as HTMLInputElement).checked })} /> Show</label>
                </div>
                {enclaveSet ? (
                  enclaveSet.items.length ? (
                    <>
                      <p class="muted small">{enclaveSet.items.length} enclave{enclaveSet.items.length > 1 ? "s" : ""} under the {meta.presets.presets[preset].label.toLowerCase()} preset ({enclaveSet.level === "nta" ? "neighborhood" : "tract"} level). Click to zoom.</p>
                      <table class="tbl">
                        <thead><tr><th>#</th><th>Residents</th><th>Of citywide</th><th>Peak LQ</th><th>{enclaveSet.level === "nta" ? "NTAs" : "Tracts"}</th></tr></thead>
                        <tbody>
                          {enclaveSet.items.slice(0, 12).map((it, k) => (
                            <tr key={it.id} tabIndex={0} class="clickable" onClick={() => zoomToEnclave(it)} onKeyDown={(e) => e.key === "Enter" && zoomToEnclave(it)}>
                              <td>{k + 1}</td><td>{fmtCount(it.pop)}</td><td>{fmtShare(it.share)}</td><td>{fmtLQ(it.peak_lq)}</td><td>{it.n_units}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {enclaveSet.items.length > 12 && <p class="muted small">+ {enclaveSet.items.length - 12} smaller enclaves on the map.</p>}
                    </>
                  ) : (
                    <p class="muted small">No area meets the {meta.presets.presets[preset].label.toLowerCase()} enclave thresholds for this dimension.</p>
                  )
                ) : (
                  enc && <p class="muted small">Enclaves for non-default dimensions are computed under the default preset only.</p>
                )}
              </section>
            </>
          )}

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
          <Legend metric={v.metric} scale={scale} shareOf={dimDef?.share_of ?? "residents"} enclaves={v.enclaves && !!enclaveFC?.features.length} clusters={false} />
          <footer class="foot muted small">
            Data: ACS {meta?.acs_vintage} 5-year (U.S. Census Bureau); NYC DCP geography. "Lives here" means census-measured residence.
          </footer>
        </div>
      </aside>
      {meta && groups && unitArea && (
        <aside class="panel panel-right" aria-label="Area details">
          <div class="panel-body">
            <WhosHere meta={meta} groups={groups} area={unitArea} onArea={(a) => view.set({ area: a })}
              onGroup={selectGroup} onClose={() => view.set({ area: null })} />
          </div>
        </aside>
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
      {shown ? (
        <div>
          <strong>{fmtMetric(metric, val)}</strong>
          {metric !== "count" && <> · {fmtCount(d.e[i])}{d.m[i] !== null ? ` ± ${fmtCount(d.m[i])}` : ""} residents</>}
          {metric === "count" && d.m[i] !== null && <> ± {fmtCount(d.m[i])}</>}
        </div>
      ) : null}
      <div class={`tt-state st-${st}`}>{STATE_LABEL[st]}</div>
    </div>
  );
}
