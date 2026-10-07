// Area panel: "Who's here?" for a clicked tract/NTA/borough (§9.2) and the stats of a focused
// area — NTA, borough or radius (§9.3).

import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { levelLabel, resolveUnit, unitName, type UnitArea } from "../areas";
import { computeAreaStats, type AreaStats } from "../focus";
import { fmtCount, fmtLQ, fmtShare, STATE_LABEL } from "../scales";
import type { EnclaveBundle, GroupsFile, Meta, Place, WhoCandidate, WhoRow } from "../types";
import type { Area } from "../url";
import { DrillDown } from "./DrillDown";

interface Props {
  meta: Meta;
  groups: GroupsFile;
  area: Area;
  places: Place[];
  selected: { id: string; name: string; dim: string; preset: string; enc: EnclaveBundle | null } | null;
  onArea: (a: Area) => void;
  onGroup: (id: string) => void;
  onEnclave: (id: string) => void;
  onClose: () => void;
  children?: ComponentChildren;
}

export function radiusName(a: Extract<Area, { kind: "radius" }>, places: Place[]): string {
  const p = places.find((x) => Math.abs(x.lat - a.lat) < 1e-4 && Math.abs(x.lon - a.lon) < 1e-4);
  const r = `${+a.mi.toFixed(2)} mi radius`;
  return p ? `${p.name} · ${r}` : `${r} around ${a.lat.toFixed(4)}, ${a.lon.toFixed(4)}`;
}

export function AreaPanel({ meta, groups, area, places, selected, onArea, onGroup, onEnclave, onClose, children }: Props) {
  const [stats, setStats] = useState<AreaStats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const key = JSON.stringify(area);

  useEffect(() => {
    let live = true;
    setStats(null);
    setErr(null);
    computeAreaStats(meta, area).then((s) => live && setStats(s)).catch((e) => live && setErr(String(e)));
    return () => { live = false; };
  }, [key]);

  const unit = area.kind !== "radius" ? resolveUnit(meta, area as UnitArea) : null;
  const focused = area.kind !== "tract";
  const title = area.kind === "radius" ? radiusName(area, places) : unit?.name ?? "Unknown area";
  const kindLabel = area.kind === "radius" ? "Radius focus" : levelLabel(unit?.level ?? "tract");

  return (
    <section class="whos" aria-label="Who's here">
      <div class="whos-head">
        <div>
          <div class="ctl-label">{kindLabel}{focused && " · focused"}</div>
          <h2 class="whos-title">{title}</h2>
          {unit && unit.parents.length > 0 && (
            <nav class="crumbs" aria-label="Larger areas">
              Within{" "}
              {unit.parents.map((p, k) => (
                <span key={p.id}>
                  {k > 0 && " · "}
                  <button class="link" onClick={() => onArea(p)}>{unitName(meta, p)}</button>
                </span>
              ))}
            </nav>
          )}
        </div>
        <button class="close" aria-label="Close area" onClick={onClose}>×</button>
      </div>
      {area.kind === "radius" && (
        <p class="notice" role="note">
          <strong>Approximate.</strong> Radius values are area-weighted from the census tracts the circle overlaps
          (each tract counts in proportion to its land area inside the circle); margins of error are approximate too.
        </p>
      )}
      {area.kind !== "radius" && area.kind !== "tract" && (
        <p class="muted small">Exact sums of the {stats ? stats.tracts.size : "…"} census tracts in this {area.kind === "nta" ? "neighborhood" : "borough"}.</p>
      )}
      {err && <p class="error">{err}</p>}
      {!stats && !err && <p class="muted">Loading…</p>}
      {stats && (
        <>
          {selected && <EnclavesInArea meta={meta} stats={stats} selected={selected} onEnclave={onEnclave} />}
          {children}
          <h3 class="whos-sub">Who's here — residents by dimension</h3>
          <p class="muted small">
            Over-represented = local share above the citywide share (LQ &gt; 1), with a usable estimate, ranked by LQ.
            Several groups can be over-represented at once. "Lives here" means census-measured residence.
            {area.kind === "tract" && " Tract estimates are noisy — the neighborhood view is steadier."}
          </p>
          {Object.entries(meta.dimensions).map(([dim, d]) => {
            const cands = stats.candidates[dim];
            const rows = stats.lists?.[dim]?.lq ?? [];
            const largest = stats.lists?.[dim]?.share ?? [];
            const head = dim === "language" ? "Language" : "Group";
            return (
              <div class="whos-dim" key={dim} role="region" aria-label={`Who's here: ${d.name}`}>
                <h4>{d.name} <span class="muted small">· share of {d.share_of}</span></h4>
                {rows.length ? (
                  <RowsTable rows={rows} cands={cands} groups={groups} onGroup={onGroup} head={head} />
                ) : (
                  <p class="muted small">No category is measurably over-represented here{area.kind === "tract" ? " at tract level" : ""}.</p>
                )}
                {largest.length > 0 && (
                  <details class="largest" open={focused}>
                    <summary>Largest by share</summary>
                    <RowsTable rows={largest} cands={cands} groups={groups} onGroup={onGroup} head={head} />
                  </details>
                )}
                {dim === "language" && <p class="muted small">Language categories are broad Census buckets, not ethnic groups.</p>}
              </div>
            );
          })}
          {focused && <DrillDown meta={meta} stats={stats} selected={selected ? { id: selected.id, name: selected.name, dim: selected.dim } : null} />}
        </>
      )}
    </section>
  );
}

function EnclavesInArea({ meta, stats, selected, onEnclave }: { meta: Meta; stats: AreaStats; selected: NonNullable<Props["selected"]>; onEnclave: (id: string) => void }) {
  const set = selected.enc?.stats[selected.dim]?.[selected.preset];
  if (!set) return null;
  const ntas = new Set([...stats.tracts.keys()].map((i) => meta.tract_nta[i]));
  const hits = set.items
    .map((it, k) => ({ it, k }))
    .filter(({ it }) => it.units.some((u) => (set.level === "tract" ? stats.tracts.has(u) : ntas.has(u))));
  return (
    <div class="in-area" role="region" aria-label="Intersecting enclaves">
      <h3 class="whos-sub">{selected.name} enclaves intersecting this area</h3>
      {hits.length ? (
        <table class="tbl">
          <thead><tr><th>#</th><th>Residents</th><th>Of citywide</th><th>Peak LQ</th></tr></thead>
          <tbody>
            {hits.map(({ it, k }) => (
              <tr key={it.id} class="clickable" tabIndex={0} onClick={() => onEnclave(it.id)} onKeyDown={(e) => e.key === "Enter" && onEnclave(it.id)}>
                <td>{k + 1}</td><td>{fmtCount(it.pop)}</td><td>{fmtShare(it.share)}</td><td>{fmtLQ(it.peak_lq)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p class="muted small">None of the {set.items.length} {selected.name} enclaves (this dimension and preset) intersects this area.</p>
      )}
    </div>
  );
}

function RowsTable({ rows, cands, groups, onGroup, head }: { rows: WhoRow[]; cands: WhoCandidate[]; groups: GroupsFile; onGroup: (id: string) => void; head: string }) {
  return (
    <table class="tbl whos-tbl">
      <thead>
        <tr><th>{head}</th><th>LQ</th><th>Share</th><th>Residents</th></tr>
      </thead>
      <tbody>
        {rows.map(([k, lq, share, count, moe, st]) => {
          const c = cands[k];
          const isGroup = c.kind === "group" && groups.groups[c.id];
          return (
            <tr key={c.id}>
              <td>
                {isGroup ? <button class="link" onClick={() => onGroup(c.id)}>{c.label}</button> : c.label}
                {st === 1 && <span class="badge caution" title={STATE_LABEL[1]}>caution</span>}
              </td>
              <td>{fmtLQ(lq)}</td>
              <td>{fmtShare(share)}</td>
              <td title={moe !== null ? `± ${fmtCount(moe)} (90% margin of error)` : ""}>{fmtCount(count)}{moe !== null && <span class="muted"> ±{fmtCount(moe)}</span>}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
