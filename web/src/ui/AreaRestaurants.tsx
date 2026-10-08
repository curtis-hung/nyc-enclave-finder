// Restaurants in a focused area (§9.2, §9.3): over-represented cuisines, the filtered restaurant
// list and the selected cuisine's clusters that intersect the area.

import { useEffect, useMemo, useState } from "preact/hooks";
import { CONF, cuisineLQs, FLAG, loadDetails, type ClusterFile, type CuisineIndex, type Points, type RestaurantDetail } from "../cuisine";
import { fmtLQ, fmtShare } from "../scales";
import { view } from "../store";
import type { Meta } from "../types";
import type { ViewState } from "../url";

interface Props {
  meta: Meta;
  ix: CuisineIndex;
  pts: Points;
  tracts: Map<number, number>;
  level: "tract" | "nta" | "boro" | "radius";
  radius: { lat: number; lon: number; mi: number } | null;
  v: ViewState;
  clusters: ClusterFile | null;
  preset: string;
  onCluster: (id: string) => void;
}

const MI_PER_DEG_LAT = 69.055;

export function AreaRestaurants({ meta, ix, pts, tracts, level, radius, v, clusters, preset, onCluster }: Props) {
  // restaurants in the area: tracts of the unit, or inside the circle for a radius
  const inArea = useMemo(() => {
    const out: number[] = [];
    const kx = radius ? MI_PER_DEG_LAT * Math.cos((radius.lat * Math.PI) / 180) : 0;
    for (let i = 0; i < pts.n; i++) {
      if (!tracts.has(pts.tract[i])) continue;
      if (radius) {
        const dx = (pts.lon[i] / 1e5 - radius.lon) * kx;
        const dy = (pts.lat[i] / 1e5 - radius.lat) * MI_PER_DEG_LAT;
        if (dx * dx + dy * dy > radius.mi * radius.mi) continue;
      }
      out.push(i);
    }
    return out;
  }, [tracts, radius?.lat, radius?.lon, radius?.mi]);

  const floor = CONF[v.conf];
  const lqs = useMemo(() => cuisineLQs(ix, pts, inArea, floor, level === "tract" ? 3 : 5).slice(0, 10), [inArea, floor]);
  const target = v.cuisine ? ix.byId.get(v.cuisine) : undefined;
  const listed = useMemo(() => {
    const show = (i: number) => (pts.flags[i] & FLAG.analysis) || (v.multi && pts.flags[i] & FLAG.multi);
    return inArea
      .filter((i) => show(i) && (target === undefined || v.cuisine === "root" || ix.matchKind(pts, i, target, floor) > 0))
      .slice(0, 400);
  }, [inArea, target, floor, v.multi]);

  // names for the list: detail files of the NTAs involved
  const ntas = useMemo(() => [...new Set(listed.map((i) => meta.ntas[meta.tract_nta[pts.tract[i]]].code))], [listed]);
  const [details, setDetails] = useState<Record<string, RestaurantDetail>>({});
  useEffect(() => {
    let live = true;
    Promise.all(ntas.slice(0, 40).map(loadDetails)).then((ds) => live && setDetails(Object.assign({}, ...ds)));
    return () => { live = false; };
  }, [ntas.join()]);

  const totalAnalysis = inArea.filter((i) => pts.flags[i] & FLAG.analysis).length;
  const inSet = useMemo(() => new Set(inArea), [inArea]);
  const areaClusters = clusters ? (clusters.stats[preset] ?? []).filter((c) => c.members.some((m) => inSet.has(m))) : [];
  const cuisineName = v.cuisine && v.cuisine !== "root" ? ix.node(v.cuisine)?.name : null;

  return (
    <>
      <section class="whos-dim" role="region" aria-label="Over-represented cuisines">
        <h3 class="whos-sub">Over-represented cuisines — "eats here"</h3>
        <p class="muted small">
          Share of this area's {totalAnalysis.toLocaleString("en-US")} restaurants (independent and small multi-location, inspected) vs. the citywide share; labels from restaurant data only ({v.conf === "low" ? "all" : v.conf + "+"} tags).
          {level === "tract" && " Approximate: tract restaurant counts are small."}
          {level === "radius" && " Restaurants inside the circle."}
        </p>
        {lqs.length ? (
          <table class="tbl">
            <thead><tr><th>Cuisine</th><th>LQ</th><th>Share</th><th>Restaurants</th></tr></thead>
            <tbody>
              {lqs.map((c) => (
                <tr key={c.node}>
                  <td><button class="link" onClick={() => view.set({ cuisine: ix.file.nodes[c.node].id, restaurant: null })}>{ix.file.nodes[c.node].name}</button></td>
                  <td>{fmtLQ(c.lq)}</td><td>{fmtShare(c.share)}</td><td>{c.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p class="muted small">No cuisine is over-represented here with enough restaurants to show.</p>}
      </section>

      {clusters && (
        <section class="whos-dim" role="region" aria-label="Clusters in this area">
          <h3 class="whos-sub">{ix.node(clusters.node)?.name} clusters with restaurants in this area</h3>
          {areaClusters.length ? (
            <table class="tbl">
              <thead><tr><th>Cluster</th><th>Restaurants</th><th>Cuisine LQ</th></tr></thead>
              <tbody>
                {areaClusters.map((c) => (
                  <tr key={c.id} class="clickable" tabIndex={0} onClick={() => onCluster(c.id)} onKeyDown={(e) => e.key === "Enter" && onCluster(c.id)}>
                    <td>#{(clusters.stats[preset] ?? []).indexOf(c) + 1}</td><td>{c.restaurants}</td><td>{fmtLQ(c.lq)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p class="muted small">None under this preset.</p>}
        </section>
      )}

      <section class="whos-dim" role="region" aria-label="Restaurant list">
        <h3 class="whos-sub">{cuisineName ? `${cuisineName} restaurants here` : "Restaurants here"} <span class="muted small">({listed.length}{listed.length === 400 ? "+" : ""})</span></h3>
        {!v.cuisine && <p class="muted small">Pick a cuisine (or "All restaurants") to filter this list and the map.</p>}
        <ul class="rest-list">
          {listed.slice(0, 150).map((i) => {
            const d = details[String(i)];
            const kind = target !== undefined && v.cuisine !== "root" ? ix.matchKind(pts, i, target, floor) : 1;
            return (
              <li key={i}>
                <button class="link" onClick={() => view.set({ restaurant: i })}>{d?.name ?? "…"}</button>
                <span class="muted small"> · {d?.cuisine_dohmh ?? ix.file.nodes[pts.primary[i]].name}{kind === 2 && <span class="badge" title="Matches only through an inferred tag">inferred</span>}{pts.flags[i] & FLAG.multi ? <span class="badge">multi-location</span> : null}</span>
              </li>
            );
          })}
        </ul>
        {listed.length > 150 && <p class="muted small">Showing 150 of {listed.length}{listed.length === 400 ? "+" : ""}; zoom in on the map to see the rest.</p>}
      </section>
    </>
  );
}
