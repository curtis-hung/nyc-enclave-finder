// Gaps panel / experiment view (§9.4): every cluster of the group's paired cuisines with continuous
// measures of its relationship to residential enclaves. No categorical labels (§2.4).

import { useEffect, useMemo, useState } from "preact/hooks";
import { loadJSON } from "../data";
import { fmtCount, fmtLQ, fmtShare } from "../scales";
import type { Group, GroupsFile, Meta } from "../types";
import type { CuisineIndex } from "../cuisine";

export interface GapRow {
  cluster: string;
  node: string;
  kind: "exact" | "bucket";
  enclave_group: string;
  restaurants: number;
  cuisine_lq: number | null;
  d: (number | null)[];
  edge: number | null; // signed: negative = cluster center inside the enclave by that many miles
  edge_enclave: string | null;
  nearest: string[];
  inter_sqmi: number;
  pct_cluster_in_enclaves: number | null;
  pct_nearest_enclave_in_cluster: number | null;
  catch_count: number;
  catch_moe: number | null;
  catch_lq: number | null;
  catch_state: string;
  within: (number | null)[];
}

export interface GapsFile {
  pairings: { node: string; kind: "exact" | "bucket"; enclave_group: string; owner_found: boolean }[];
  bands_mi: number[];
  rows: Record<string, Record<string, GapRow[]>>;
}

export const loadGaps = (gid: string) => loadJSON<GapsFile>(`gaps/${gid}.json`);

type SortKey = "edge" | "d0" | "d1" | "d2" | "cuisine_lq" | "restaurants" | "catch_lq" | "overlap" | "within1";

const VAL: Record<SortKey, (r: GapRow) => number | null> = {
  edge: (r) => r.edge,
  d0: (r) => r.d[0],
  d1: (r) => r.d[1],
  d2: (r) => r.d[2],
  cuisine_lq: (r) => r.cuisine_lq,
  restaurants: (r) => r.restaurants,
  catch_lq: (r) => r.catch_lq,
  overlap: (r) => r.pct_cluster_in_enclaves,
  within1: (r) => r.within[1],
};

function clusterNo(id: string): string {
  return `#${Number(id.split(".").pop()) + 1}`;
}

function fmtMi(x: number | null): string {
  return x === null ? "—" : x === 0 ? "0" : x < 0.1 ? x.toFixed(2) : x.toFixed(1);
}

function fmtEdge(x: number | null): string {
  if (x === null) return "—";
  const a = Math.abs(x);
  const v = a < 0.1 ? a.toFixed(2) : a.toFixed(1);
  return x < 0 ? `${v} in` : x > 0 ? `${v} out` : "on edge";
}

function Spark({ within, bands }: { within: (number | null)[]; bands: number[] }) {
  const W = 64, H = 20;
  const xs = bands.map((b) => (Math.log(b / bands[0]) / Math.log(bands[bands.length - 1] / bands[0])) * (W - 4) + 2);
  const pts = within.map((v, k) => `${xs[k].toFixed(1)},${(H - 2 - (v ?? 0) * (H - 4)).toFixed(1)}`).join(" ");
  const title = bands.map((b, k) => `${b} mi: ${fmtShare(within[k])}`).join(" · ");
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Share of the group's residents within distance: ${title}`}>
      <title>{title}</title>
      <line x1="2" x2={W - 2} y1={H - 2} y2={H - 2} stroke="#d6d5cf" stroke-width="1" />
      <polyline points={pts} fill="none" stroke="#2a78d6" stroke-width="1.6" />
      {within.map((v, k) => <circle key={k} cx={xs[k]} cy={H - 2 - (v ?? 0) * (H - 4)} r="1.6" fill="#2a78d6" />)}
    </svg>
  );
}

interface Props {
  meta: Meta;
  groups: GroupsFile;
  group: Group;
  ix: CuisineIndex;
  preset: string;
  dim: string;
  onFocusRow: (row: GapRow) => void;
  onHoverRow: (row: GapRow | null) => void;
  onContext: (node: string, cluster: string) => void;
  onClose: () => void;
}

export function GapsPanel({ meta, groups, group, ix, preset, dim, onFocusRow, onHoverRow, onContext, onClose }: Props) {
  const [file, setFile] = useState<GapsFile | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: "edge", asc: true });
  const [focused, setFocused] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setFile(null);
    loadGaps(group.id).then((f) => live && setFile(f));
    return () => { live = false; };
  }, [group.id]);

  // rows for the selected preset; dimension = the enclave group's dimension shown
  const rows = useMemo(() => {
    if (!file) return [];
    const byDim = file.rows[preset] ?? {};
    const out: GapRow[] = [];
    for (const p of file.pairings) {
      const target = groups.groups[p.enclave_group];
      // the selected group's dimension for exact pairings; the broad group's default for buckets
      const d = p.kind === "exact" && byDim[dim] ? dim : target.default_dimension;
      for (const r of byDim[d] ?? []) if (r.node === p.node) out.push(r);
    }
    const f = VAL[sort.key];
    return out.sort((a, b) => {
      const x = f(a), y = f(b);
      if (x === null && y === null) return 0;
      if (x === null) return 1; // nulls (no enclave) always last
      if (y === null) return -1;
      return sort.asc ? x - y : y - x;
    });
  }, [file, preset, dim, sort]);

  const head = (key: SortKey, label: string, title?: string) => (
    <th aria-sort={sort.key === key ? (sort.asc ? "ascending" : "descending") : "none"}>
      <button class="sort" title={title} onClick={() => setSort({ key, asc: sort.key === key ? !sort.asc : true })}>
        {label}{sort.key === key ? (sort.asc ? " ▲" : " ▼") : ""}
      </button>
    </th>
  );

  const focus = (r: GapRow) => {
    setFocused(r.cluster);
    onFocusRow(r);
  };
  const hover = (r: GapRow | null) => {
    setHovered(r?.cluster ?? null);
    onHoverRow(r);
  };

  return (
    <section class="gaps" role="region" aria-label="Gaps panel">
      <div class="gaps-head">
        <div>
          <h2>Experiment view: {group.name} — restaurants vs. residences</h2>
          <p class="muted small">
            Each row is a restaurant cluster of a cuisine paired with {group.name}, measured against residential enclaves under the {meta.presets.presets[preset].label.toLowerCase()} preset.
            "Edge" is the signed distance from the cluster's center to the nearest enclave edge (in = inside the enclave by that much, out = outside). The 1st/2nd/3rd columns are polygon-to-polygon distances (0 = touching or overlapping). Bucket rows are measured against the broad group named in the row. Proximity does not show a causal or cultural relationship.
          </p>
        </div>
        <button class="close" aria-label="Close gaps panel" onClick={onClose}>×</button>
      </div>
      {!file && <p class="muted">Loading…</p>}
      {file && rows.length === 0 && <p class="muted small">No restaurant clusters of {group.name}'s paired cuisines under this preset.</p>}
      {file && rows.length > 0 && (
        <div class="gaps-body">
          <div class="gaps-table-wrap">
            <table class="tbl gaps-tbl">
              <thead>
                <tr>
                  <th>Cuisine · cluster</th>
                  {head("restaurants", "Rest.", "Restaurants in the cluster")}
                  {head("cuisine_lq", "Cuisine LQ")}
                  {head("edge", "Edge (mi)", "Signed distance from the cluster center to the nearest enclave edge: inside (in) or outside (out)")}
                  {head("d0", "Nearest enclave (mi)")}
                  {head("d1", "2nd")}
                  {head("d2", "3rd")}
                  {head("overlap", "Overlap", "Share of the cluster footprint inside any enclave")}
                  {head("catch_lq", "Residential LQ in catchment", "The enclave group's LQ (and count) inside the cluster's catchment")}
                  {head("within1", "Residents within 0.5·1·2·5 mi", "Share of the group's citywide residents living within each distance of the cluster")}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.cluster}:${r.enclave_group}`} class={`clickable${focused === r.cluster ? " sel" : ""}${hovered === r.cluster ? " hov" : ""}`} tabIndex={0}
                    onClick={() => focus(r)} onKeyDown={(e) => e.key === "Enter" && focus(r)}
                    onMouseEnter={() => hover(r)} onMouseLeave={() => hover(null)}>
                    <td>
                      {ix.node(r.node)?.name ?? r.node} {clusterNo(r.cluster)}
                      {r.kind === "bucket" && <span class="badge" title={`Bucket pairing, measured against ${groups.groups[r.enclave_group]?.name} enclaves`}>bucket · vs {groups.groups[r.enclave_group]?.name}</span>}
                      {r.kind === "bucket" && ix.node(r.node)?.kind === "bucket" && (
                        <button class="link small" onClick={(e) => { e.stopPropagation(); onContext(r.node, r.cluster); }}>context</button>
                      )}
                    </td>
                    <td>{r.restaurants}</td>
                    <td>{fmtLQ(r.cuisine_lq)}</td>
                    <td>{r.edge === null ? <span class="muted" title="The group has no qualifying enclave under this preset">no enclave</span> : fmtEdge(r.edge)}</td>
                    <td>{r.d[0] === null ? "—" : fmtMi(r.d[0])}</td>
                    <td>{fmtMi(r.d[1])}</td>
                    <td>{fmtMi(r.d[2])}</td>
                    <td>{fmtShare(r.pct_cluster_in_enclaves)}</td>
                    <td>{r.catch_lq === null ? <span class="muted">{r.catch_state}</span> : <>{fmtLQ(r.catch_lq)} <span class="muted small">({fmtCount(r.catch_count)}{r.catch_state === "caution" ? ", caution" : ""})</span></>}</td>
                    <td><Spark within={r.within} bands={file.bands_mi} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Scatter rows={rows} ix={ix} focused={focused} hovered={hovered} onFocus={focus} onHover={hover} />
        </div>
      )}
    </section>
  );
}

// --- scatter: x = distance to nearest enclave, y = residential LQ in catchment, size = restaurants

function Scatter({ rows, ix, focused, hovered, onFocus, onHover }: { rows: GapRow[]; ix: CuisineIndex; focused: string | null; hovered: string | null; onFocus: (r: GapRow) => void; onHover: (r: GapRow | null) => void }) {
  const W = 360, H = 230, L = 40, B = 30, T = 10, STRIP = 46;
  const plotW = W - L - STRIP - 12;
  const withD = rows.filter((r) => r.edge !== null && r.catch_lq !== null);
  const noEnclave = rows.filter((r) => r.edge === null);
  const minD = Math.min(-0.25, ...withD.map((r) => r.edge!));
  const maxD = Math.max(0.25, ...withD.map((r) => r.edge!));
  const maxLq = Math.max(2, ...rows.map((r) => r.catch_lq ?? 0));
  const ly = (v: number) => Math.log10(Math.max(v, 0.05));
  const y = (v: number) => T + (H - T - B) * (1 - (ly(v) - ly(0.05)) / (ly(maxLq) - ly(0.05)));
  const x = (v: number) => L + ((v - minD) / (maxD - minD)) * plotW;
  const maxN = Math.max(...rows.map((r) => r.restaurants), 1);
  const rad = (n: number) => 2.5 + 7 * Math.sqrt(n / maxN);
  const ticksY = [0.1, 0.5, 1, 2, 5, 10, 20, 50].filter((t) => t <= maxLq * 1.05);
  const ticksX = [minD, minD / 2, 0, maxD / 2, maxD];
  const dot = (r: GapRow, cx: number, cy: number) => {
    const on = focused === r.cluster || hovered === r.cluster;
    return (
      <circle key={r.cluster + r.enclave_group} cx={cx} cy={cy} r={rad(r.restaurants)} class={`pt${on ? " on" : ""}${r.kind === "bucket" ? " bucket" : ""}`}
        tabIndex={0} role="button" aria-label={`${ix.node(r.node)?.name} cluster ${clusterNo(r.cluster)}`}
        onClick={() => onFocus(r)} onMouseEnter={() => onHover(r)} onMouseLeave={() => onHover(null)}
        onKeyDown={(e) => e.key === "Enter" && onFocus(r)}>
        <title>{`${ix.node(r.node)?.name} ${clusterNo(r.cluster)} · ${r.restaurants} restaurants · ${fmtEdge(r.edge)} (edge) · residential LQ ${fmtLQ(r.catch_lq)}`}</title>
      </circle>
    );
  };
  return (
    <figure class="scatter" role="group" aria-label="Scatter plot">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        {ticksY.map((t) => (
          <g key={t}>
            <line x1={L} x2={L + plotW} y1={y(t)} y2={y(t)} stroke={t === 1 ? "#a9a8a2" : "#ecebe6"} stroke-dasharray={t === 1 ? "3 3" : undefined} />
            <text x={L - 4} y={y(t) + 3} text-anchor="end" class="ax">{t}</text>
          </g>
        ))}
        {ticksX.map((t) => <text key={t} x={x(t)} y={H - B + 14} text-anchor="middle" class="ax">{t === 0 ? "edge" : fmtMi(Math.abs(t))}</text>)}
        <line x1={x(0)} x2={x(0)} y1={T} y2={H - B} stroke="#a9a8a2" stroke-dasharray="3 3" />
        <text x={L + plotW / 2} y={H - 3} text-anchor="middle" class="ax-title">← inside enclave · distance to edge (mi) · outside →</text>
        <text x={10} y={T + (H - T - B) / 2} transform={`rotate(-90 10 ${T + (H - T - B) / 2})`} text-anchor="middle" class="ax-title">residential LQ in catchment</text>
        <rect x={L + plotW + 10} y={T} width={STRIP} height={H - T - B} fill="#f4f3ef" />
        <text x={L + plotW + 10 + STRIP / 2} y={H - B + 14} text-anchor="middle" class="ax">no enclave</text>
        {withD.map((r) => dot(r, x(r.edge!), y(r.catch_lq!)))}
        {noEnclave.map((r, k) => dot(r, L + plotW + 10 + STRIP / 2, r.catch_lq !== null ? y(r.catch_lq) : T + 10 + (k * 14) % (H - T - B - 20)))}
      </svg>
      <figcaption class="muted small">Dot size = restaurants. Rows without a usable residential LQ in the catchment are listed in the table only.</figcaption>
    </figure>
  );
}
