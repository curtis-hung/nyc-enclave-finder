// Restaurant controls, cluster table and restaurant card (§4.4, §7, §9.5).

import { useEffect, useMemo, useState } from "preact/hooks";
import { FLAG, loadDetails, mapsLink, type ClusterFile, type CuisineIndex, type Points, type RestaurantDetail } from "../cuisine";
import { fmtLQ, fmtShare } from "../scales";
import { view } from "../store";
import type { Group, Meta } from "../types";
import type { ViewState } from "../url";
import type { Measures } from "../diaspora";
import { DiasporaStrip } from "./Diaspora";

export const CONF_LABEL = { low: "all tags (incl. name keywords)", medium: "medium+ confidence", high: "high confidence only" } as const;

/** Cuisine nodes in tree order (first parent), excluding generic/root. */
export function cuisineOptions(ix: CuisineIndex): { i: number; depth: number }[] {
  const nodes = ix.file.nodes;
  const children = new Map<number, number[]>();
  nodes.forEach((n, i) => {
    const p = n.parents[0];
    if (p === undefined) return;
    children.set(p, [...(children.get(p) ?? []), i]);
  });
  const out: { i: number; depth: number }[] = [];
  const seen = new Set<number>();
  const walk = (i: number, depth: number) => {
    for (const c of (children.get(i) ?? []).sort((a, b) => nodes[a].name.localeCompare(nodes[b].name))) {
      if (seen.has(c)) continue;
      seen.add(c);
      if (nodes[c].kind !== "generic") out.push({ i: c, depth });
      walk(c, depth + 1);
    }
  };
  walk(ix.byId.get("root") ?? 0, 0);
  return out;
}

/** Default cuisine for a group: its first exact pairing, else its first bucket pairing. */
export function defaultCuisine(g: Group | null): string | null {
  if (!g) return null;
  const e = Object.entries(g.cuisines);
  return e.find(([, k]) => k === "exact")?.[0] ?? e[0]?.[0] ?? null;
}

interface ControlsProps {
  ix: CuisineIndex;
  pts: Points;
  v: ViewState;
  group: Group | null;
  shown: { total: number; viaTags: number };
}

export function RestaurantControls({ ix, v, group, shown }: ControlsProps) {
  const opts = useMemo(() => cuisineOptions(ix), [ix]);
  const pairs = group ? Object.entries(group.cuisines) : [];
  return (
    <section class="rest-ctl" role="region" aria-label="Restaurants">
      <h3>Restaurants</h3>
      {pairs.length > 0 && (
        <div class="chips" role="group" aria-label="Paired cuisines">
          {pairs.map(([c, kind]) => (
            <button key={c} class={`chip${v.cuisine === c ? " on" : ""}`} aria-pressed={v.cuisine === c} onClick={() => view.set({ cuisine: c, restaurant: null })}
              title={kind === "exact" ? "Exact pairing: this cuisine names the group" : "Bucket pairing: this cuisine covers the group among others"}>
              {ix.node(c)?.name ?? c} <span class="muted">{kind}</span>
            </button>
          ))}
        </div>
      )}
      <div class="ctl-row">
        <div class="ctl grow">
          <label class="ctl-label" for="cuisine-select">Cuisine</label>
          <select id="cuisine-select" value={v.cuisine ?? ""} onChange={(e) => view.set({ cuisine: (e.target as HTMLSelectElement).value || null, restaurant: null })}>
            <option value="">— none —</option>
            <option value="root">All restaurants</option>
            {opts.map(({ i, depth }) => (
              <option key={i} value={ix.file.nodes[i].id}>{"  ".repeat(depth)}{ix.file.nodes[i].name}</option>
            ))}
          </select>
        </div>
        <div class="ctl">
          <label class="ctl-label" for="conf-select">Inferred tags</label>
          <select id="conf-select" value={v.conf} onChange={(e) => view.set({ conf: (e.target as HTMLSelectElement).value as ViewState["conf"] })}>
            <option value="low">All</option>
            <option value="medium">Medium+</option>
            <option value="high">High only</option>
          </select>
        </div>
      </div>
      <div class="ctl-row">
        <label class="check"><input type="checkbox" checked={v.restOverlay} onChange={(e) => view.set({ restOverlay: (e.target as HTMLInputElement).checked })} /> Show restaurants on map</label>
        <label class="check"><input type="checkbox" checked={v.multi} onChange={(e) => view.set({ multi: (e.target as HTMLInputElement).checked })} /> Show multi-location businesses</label>
      </div>
      {v.cuisine && (
        <p class="muted small">
          {shown.total.toLocaleString("en-US")} restaurants{v.restOverlay ? " on the map" : " match (hidden from the map)"}{shown.viaTags ? `, ${shown.viaTags.toLocaleString("en-US")} of them only via an inferred tag (hollow dots)` : ""}. Labels come only from restaurant data: DOHMH's category, plus tags inferred from OpenStreetMap, Overture and name keywords ({CONF_LABEL[v.conf]}).
        </p>
      )}
    </section>
  );
}

interface ClusterProps {
  ix: CuisineIndex;
  file: ClusterFile | null;
  preset: string;
  presetLabel: string;
  selected: string | null;
  onSelect: (id: string) => void;
  onContext?: (node: string, cluster: string) => void;
  lqMin: number;
  gapMin: number;
  residents?: { group: string; label: string; m: Measures; heritage: string[] } | null;
}

export function ClusterTable({ ix, file, preset, presetLabel, selected, onSelect, onContext, lqMin, gapMin, residents }: ClusterProps) {
  if (!file) return null;
  const items = file.stats[preset] ?? [];
  const name = ix.node(file.node)?.name ?? file.node;
  const anyCluster = Object.values(file.stats).flat()[0];
  const refShare = anyCluster?.ref_share ?? null;
  return (
    <section class="clusters" role="region" aria-label="Restaurant clusters">
      <h3>{name} restaurant clusters{ix.node(file.node)?.kind === "bucket" && <span class="badge" title="This cuisine covers several groups">bucket-level</span>}</h3>
      <p class="muted small">
        {items.length} cluster{items.length === 1 ? "" : "s"} under the {presetLabel.toLowerCase()} preset.{" "}
        {file.basis === "tag"
          ? `Tag-based: built from inferred tags (${ix.file.tag_confidence}+), so coverage varies with how well OpenStreetMap/Overture cover the area.`
          : "Built from DOHMH labels plus inferred tags under this cuisine."}{" "}
        Cuisine LQ compares the cuisine's share of all restaurants in the cluster's catchment with its citywide share.
      </p>
      {refShare !== null && refShare > 0.1 && (
        <details class="notice small ceiling">
          <summary>Common cuisine: LQ ceiling {(1 / refShare).toFixed(1)}</summary>
          {name} restaurants are {Math.round(refShare * 100)}% of all restaurants citywide, so the highest possible cuisine LQ is {(1 / refShare).toFixed(1)}.
          A cluster qualifies at LQ {lqMin}, or when the cuisine closes {Math.round(gapMin * 100)}% of the gap between its citywide share and 100% of the catchment
          (whichever is easier; marked "share gap"). For rare cuisines the LQ test is always the easier one.
        </details>
      )}
      {items.length > 0 && (
        <table class="tbl">
          <thead>
            <tr><th>#</th><th>Restaurants</th><th title="Not multi-location">Indep.</th><th>Cuisine LQ</th>{file.basis === "tag" ? <th title="Share of the catchment's parent-bucket restaurants that carry any medium+ tag">Tag cov.</th> : <th>Via tags</th>}</tr>
          </thead>
          <tbody>
            {items.slice(0, 15).map((c, k) => (
              <tr key={c.id} class={`clickable${selected === c.id ? " sel" : ""}`} tabIndex={0} onClick={() => onSelect(c.id)} onKeyDown={(e) => e.key === "Enter" && onSelect(c.id)}>
                <td>{k + 1}</td>
                <td>{c.restaurants}</td>
                <td>{c.independent}</td>
                <td>{fmtLQ(c.lq)}{c.qualified_by === "share_gap" && <span class="badge" title={`Qualified by share gap: ${Math.round((c.share_gap ?? 0) * 100)}% of the gap to 100%`}>share gap</span>}</td>
                {file.basis === "tag" ? <td>{c.tag_coverage === null || c.tag_coverage === undefined ? "—" : fmtShare(c.tag_coverage)}</td> : <td>{c.via_tags}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {selected && residents && Object.keys(residents.m).length > 0 && items.some((c) => c.id === selected) && (
        <div class="cluster-residents" role="region" aria-label="Cluster residential context">
          <div class="ctl-label">Residential context — who lives nearby. This is not evidence of what these restaurants serve.</div>
          <DiasporaStrip m={residents.m} heritage={residents.heritage} label={`${residents.group} residents of the surrounding district: ${residents.label}`} compact />
        </div>
      )}
      {selected && onContext && ix.node(file.node)?.kind === "bucket" && items.some((c) => c.id === selected) && (
        <button class="btn" onClick={() => onContext(file.node, selected)}>Residential context for this cluster</button>
      )}
    </section>
  );
}

// --- restaurant card ------------------------------------------------------------------------------

export function RestaurantCard({ ix, pts, meta, index, onClose }: { ix: CuisineIndex; pts: Points; meta: Meta; index: number; onClose: () => void }) {
  const nta = meta.ntas[meta.tract_nta[pts.tract[index]]];
  const [d, setD] = useState<RestaurantDetail | null>(null);
  useEffect(() => {
    let live = true;
    setD(null);
    loadDetails(nta.code).then((x) => live && setD(x[String(index)] ?? null));
    return () => { live = false; };
  }, [index]);
  const primary = ix.file.nodes[pts.primary[index]];
  const flags = pts.flags[index];
  return (
    <section class="card" role="region" aria-label="Restaurant">
      <div class="whos-head">
        <div>
          <div class="ctl-label">Restaurant · {nta.name}</div>
          <h2 class="whos-title">{d?.name ?? "…"}</h2>
        </div>
        <button class="close" aria-label="Close restaurant" onClick={onClose}>×</button>
      </div>
      <div class="primary-label" title="Primary label: DOHMH cuisine category (source of truth)">
        <span class="ctl-label">DOHMH category</span>
        <strong>{d?.cuisine_dohmh ?? (flags & FLAG.uninspected ? "Not yet inspected — no category" : "Not listed")}</strong>
        {primary.kind === "generic" ? <span class="muted small"> (a format, not a cuisine)</span> : primary.name !== d?.cuisine_dohmh && <span class="muted small"> → {primary.name}</span>}
      </div>
      {d && d.tags.length > 0 && (
        <div class="tags">
          <span class="ctl-label">Inferred tags</span>
          <ul class="chips">
            {d.tags.map((t) => (
              <li key={t.label} class={`chip tag conf-${t.confidence}`}>
                <span class="inferred" aria-label="inferred">≈</span> {ix.node(t.label)?.name ?? t.label} <span class="muted">· {t.confidence}</span>
                <details>
                  <summary>sources</summary>
                  <ul>{t.sources.map((s, k) => <li key={k}>{s.source}: {s.evidence}</li>)}</ul>
                </details>
              </li>
            ))}
          </ul>
        </div>
      )}
      {d && d.conflicts.length > 0 && (
        <details class="conflicts">
          <summary>Other sources say… ({d.conflicts.length})</summary>
          <p class="muted small">Labels that do not fit under the DOHMH category. They are shown for transparency and never used for filtering, clustering or LQ.</p>
          <ul>{d.conflicts.map((c, k) => <li key={k}>{ix.node(c.label)?.name ?? c.label} — {c.source}: {c.evidence}</li>)}</ul>
        </details>
      )}
      {d && (
        <dl class="kv">
          <dt>Address</dt><dd>{d.address}, {d.boro} {d.zip}</dd>
          <dt>Last inspection</dt><dd>{d.last_inspection ?? "not yet inspected"}{d.grade ? ` · grade ${d.grade}` : ""}</dd>
          {d.locations > 1 && <><dt>Locations</dt><dd>{d.locations} active locations share this name{flags & FLAG.multi ? " (flagged multi-location; a name heuristic, not proof of a chain)" : ""}</dd></>}
        </dl>
      )}
      {d && <a class="btn" href={mapsLink(d)} target="_blank" rel="noopener noreferrer">Search on Google Maps ↗</a>}
      <p class="muted small">Not a review product: no ratings. Data: NYC DOHMH inspections.</p>
    </section>
  );
}
