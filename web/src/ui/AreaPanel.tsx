// Area panel: "Who's here?" for a clicked tract/NTA/borough (§9.2) and the stats of a focused
// area — NTA, borough or radius (§9.3).

import { Fragment, type ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { levelLabel, resolveUnit, unitName, type UnitArea } from "../areas";
import { computeAreaStats, type AreaStats } from "../focus";
import { fmtCount, fmtLQ, fmtShare, STATE_LABEL } from "../scales";
import type { EnclaveBundle, GroupsFile, Meta, Place, WhoCandidate, WhoRow } from "../types";
import type { Area } from "../url";
import { DrillDown } from "./DrillDown";
import { districtMeasures, districtOf, languageFill, type DiasporaIndex, type Measures, type PumaFile } from "../diaspora";
import { loadDenominators } from "../focus";
import { DiasporaStrip } from "./Diaspora";
import { CompareTable } from "./Compare";

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
  onHide: () => void;
  children?: ComponentChildren;
  extra?: (stats: AreaStats) => ComponentChildren;
  dia: DiasporaIndex | null;
  pinned: Area | null;
  onPin: (a: Area | null) => void;
}

export function areaTitle(meta: Meta, area: Area, places: Place[]): string {
  if (area.kind === "radius") return radiusName(area, places);
  return resolveUnit(meta, area as UnitArea)?.name ?? "Unknown area";
}

export function radiusName(a: Extract<Area, { kind: "radius" }>, places: Place[]): string {
  const p = places.find((x) => Math.abs(x.lat - a.lat) < 1e-4 && Math.abs(x.lon - a.lon) < 1e-4);
  const r = `${+a.mi.toFixed(2)} mi radius`;
  return p ? `${p.name} · ${r}` : `${r} around ${a.lat.toFixed(4)}, ${a.lon.toFixed(4)}`;
}

export function AreaPanel({ meta, groups, area, places, selected, onArea, onGroup, onEnclave, onClose, onHide, children, extra, dia, pinned, onPin }: Props) {
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

  // diaspora strips for the surrounding district (§4.6)
  const [district, setDistrict] = useState<{ label: string; byGroup: Record<string, Measures>; files: PumaFile[] } | null>(null);
  useEffect(() => {
    setDistrict(null);
    if (!dia || !stats) return;
    let live = true;
    const candidateIds = new Set<string>();
    for (const [dimId, l] of Object.entries(stats.lists)) {
      for (const r of [...l.lq, ...l.share]) {
        const c = stats.candidates[dimId][r[0]];
        if (c.kind === "group") candidateIds.add(c.id);
      }
    }
    if (area.kind === "boro") {
      const b = meta.boroughs.find((x) => x.code === area.id);
      setDistrict({ label: `${b?.name ?? area.id} (whole borough)`, byGroup: dia.boro[area.id] ?? {}, files: [] });
      return;
    }
    loadDenominators().then(async (den) => {
      const d = districtOf(dia, stats.tracts, den.race.tract);
      if (!d) return;
      const r = await districtMeasures(dia, d, [...candidateIds]);
      if (live) setDistrict({ label: d.label, byGroup: r.byGroup, files: r.files });
    });
    return () => { live = false; };
  }, [stats, dia]);

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
        <div class="head-btns">
          <button class="panel-toggle" title="Pin this area, then focus another to compare them" aria-pressed={!!pinned && JSON.stringify(pinned) === key}
            onClick={() => onPin(pinned && JSON.stringify(pinned) === key ? null : area)}>{pinned && JSON.stringify(pinned) === key ? "Pinned" : "Pin"}</button>
          <button class="panel-toggle" aria-label="Hide area details" onClick={onHide}>Hide</button>
          <button class="close" aria-label="Close area" onClick={onClose}>×</button>
        </div>
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
          {pinned && JSON.stringify(pinned) !== key && (
            <CompareTable meta={meta} here={stats} pinned={pinned} onUnpin={() => onPin(null)}
              pinnedName={pinned.kind === "radius" ? radiusName(pinned, places) : resolveUnit(meta, pinned as UnitArea)?.name ?? "pinned area"} />
          )}
          {pinned && JSON.stringify(pinned) === key && (
            <p class="notice small" role="note">Pinned. Focus another area (neighborhood, borough, radius or a map click) to compare the two.</p>
          )}
          {selected && <EnclavesInArea meta={meta} stats={stats} selected={selected} onEnclave={onEnclave} />}
          {children}
          {extra?.(stats)}
          <h3 class="whos-sub">Who's here — residents by dimension</h3>
          <p class="muted small">
            Over-represented = local share above the citywide share (LQ &gt; 1), with a usable estimate, ranked by LQ.
            Several groups can be over-represented at once. "Lives here" means census-measured residence.
            {area.kind === "tract" && " Tract estimates are noisy — the neighborhood view is steadier."}
          </p>
          {district && Object.keys(district.byGroup).length > 0 && (
            <p class="muted small dia-note">
              Strips under a group describe its residents in the surrounding district — <strong>{district.label}</strong> — from ACS microdata (PUMS), reliable values only.
              {area.kind !== "boro" && " The district is larger than this area."}
            </p>
          )}
          {Object.entries(meta.dimensions).map(([dim, d]) => {
            const cands = stats.candidates[dim];
            const rows = stats.lists?.[dim]?.lq ?? [];
            const largest = stats.lists?.[dim]?.share ?? [];
            const head = dim === "language" ? "Language" : "Group";
            return (
              <div class="whos-dim" key={dim} role="region" aria-label={`Who's here: ${d.name}`}>
                <h4>{d.name} <span class="muted small">· share of {d.share_of}</span></h4>
                {rows.length ? (
                  <RowsTable rows={rows} cands={cands} groups={groups} onGroup={onGroup} head={head}
                    strips={district?.byGroup} dia={dia} fill={dim === "language" && dia && district?.files.length ? (line) => languageFill(dia, district.files, line) : undefined} />
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

function RowsTable({ rows, cands, groups, onGroup, head, strips, dia, fill }: {
  rows: WhoRow[]; cands: WhoCandidate[]; groups: GroupsFile; onGroup: (id: string) => void; head: string;
  strips?: Record<string, Measures>; dia?: DiasporaIndex | null; fill?: (line: string) => { code: string; name: string; share: number; lq: number }[];
}) {
  return (
    <table class="tbl whos-tbl">
      <thead>
        <tr><th>{head}</th><th>LQ</th><th>Share</th><th>Residents</th></tr>
      </thead>
      <tbody>
        {rows.map(([k, lq, share, count, moe, st]) => {
          const c = cands[k];
          const isGroup = c.kind === "group" && groups.groups[c.id];
          const strip = isGroup && strips?.[c.id];
          const sub = c.kind === "language" && fill ? fill(String(Number(c.id.split("_")[1]))) : [];
          return (
            <Fragment key={c.id}>
            <tr>
              <td>
                {isGroup ? <button class="link" onClick={() => onGroup(c.id)}>{c.label}</button> : c.label}
                {st === 1 && <span class="badge caution" title={STATE_LABEL[1]}>caution</span>}
              </td>
              <td>{fmtLQ(lq)}</td>
              <td>{fmtShare(share)}</td>
              <td title={moe !== null ? `± ${fmtCount(moe)} (90% margin of error)` : ""}>{fmtCount(count)}{moe !== null && <span class="muted"> ±{fmtCount(moe)}</span>}</td>
            </tr>
            {strip && Object.keys(strip).length > 0 && (
              <tr key={`${c.id}-dia`} class="strip-row"><td colSpan={4}><DiasporaStrip m={strip} heritage={dia?.groups[c.id]?.heritage ?? []} compact /></td></tr>
            )}
            {sub.map((l) => (
              <tr key={`${c.id}-${l.code}`} class="fill-row" title="Detailed language from ACS microdata for the surrounding district (reliable values only)">
                <td>↳ {l.name} <span class="badge">district</span></td><td>{fmtLQ(l.lq)}</td><td>{fmtShare(l.share)}</td><td></td>
              </tr>
            ))}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
