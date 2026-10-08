// Drill-down (§9.3, SHOULD): tract-level mini choropleths inside the focused area — the selected
// group plus small multiples of the area's most over-represented groups.

import { useEffect, useState } from "preact/hooks";
import { loadDenominators, loadMatrix, loadTractIndex, tractValues, type AreaStats, type Denominators, type Matrix } from "../focus";
import { miPerDegLon, type Indexed } from "../geo";
import { fmtLQ, lqScale, ZERO_COLOR } from "../scales";
import type { AreaValue } from "../stats";
import { STATE, type Meta } from "../types";

interface Panel {
  key: string;
  title: string;
  sub: string;
  dim: string;
  k: number;
  areaLq: number | null;
}

const W = 168;
const H = 130;

export function DrillDown({ meta, stats, selected }: { meta: Meta; stats: AreaStats; selected: { id: string; name: string; dim: string } | null }) {
  const [tracts, setTracts] = useState<Indexed[] | null>(null);
  const [den, setDen] = useState<Denominators | null>(null);
  const [mats, setMats] = useState<Record<string, Matrix>>({});

  // panels: selected group (if it is a ranked candidate in its dimension) + top over-represented
  const panels: Panel[] = [];
  const seen = new Set<string>();
  if (selected) {
    const k = stats.candidates[selected.dim]?.findIndex((c) => c.id === selected.id) ?? -1;
    if (k >= 0) {
      const row = [...stats.lists[selected.dim].lq, ...stats.lists[selected.dim].share].find((r) => r[0] === k);
      panels.push({ key: `${selected.dim}:${selected.id}`, title: selected.name, sub: `${meta.dimensions[selected.dim].short} · selected group`, dim: selected.dim, k, areaLq: row?.[1] ?? null });
      seen.add(selected.id);
    }
  }
  const pool = Object.entries(stats.lists)
    .filter(([dim]) => dim !== "language")
    .flatMap(([dim, l]) => l.lq.map((r) => ({ dim, r })))
    .sort((a, b) => (b.r[1] ?? 0) - (a.r[1] ?? 0));
  for (const { dim, r } of pool) {
    const c = stats.candidates[dim][r[0]];
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    panels.push({ key: `${dim}:${c.id}`, title: c.label, sub: meta.dimensions[dim].short, dim, k: r[0], areaLq: r[1] });
    if (panels.length >= (selected ? 7 : 6)) break;
  }

  const dims = [...new Set(panels.map((p) => p.dim))].sort();
  useEffect(() => {
    let live = true;
    Promise.all([loadTractIndex(), loadDenominators(), ...dims.map(loadMatrix)]).then(([t, d, ...ms]) => {
      if (!live) return;
      setTracts(t as Indexed[]);
      setDen(d as Denominators);
      setMats(Object.fromEntries(dims.map((dim, j) => [dim, ms[j] as Matrix])));
    });
    return () => { live = false; };
  }, [dims.join()]);

  if (stats.tracts.size < 2) return null;
  if (!tracts || !den || dims.some((d) => !mats[d])) return <p class="muted small">Loading drill-down…</p>;

  const ids = [...stats.tracts.keys()];
  const shapes = tracts.filter((t) => stats.tracts.has(t.index));
  const x0 = Math.min(...shapes.map((t) => t.bbox[0][0]));
  const y0 = Math.min(...shapes.map((t) => t.bbox[0][1]));
  const x1 = Math.max(...shapes.map((t) => t.bbox[1][0]));
  const y1 = Math.max(...shapes.map((t) => t.bbox[1][1]));
  const kx = miPerDegLon((y0 + y1) / 2) / 69.055;
  const sx = (W - 4) / Math.max((x1 - x0) * kx, 1e-9);
  const sy = (H - 4) / Math.max(y1 - y0, 1e-9);
  const s = Math.min(sx, sy);
  const ox = (W - (x1 - x0) * kx * s) / 2;
  const oy = (H - (y1 - y0) * s) / 2;
  const path = (g: GeoJSON.Geometry) => {
    const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
    return polys
      .map((p) => p.map((ring) => "M" + ring.map(([x, y]) => `${(ox + (x - x0) * kx * s).toFixed(1)},${(oy + (y1 - y) * s).toFixed(1)}`).join("L") + "Z").join(""))
      .join("");
  };
  const paths = shapes.map((t) => ({ i: t.index, d: path(t.geom) }));
  const scale = lqScale();
  const fillOf = (v: AreaValue | undefined) => {
    if (!v || v.state === STATE.unavailable) return "url(#dd-cross)";
    if (v.state === STATE.suppressed) return "url(#dd-hatch)";
    if (v.state === STATE.zero) return ZERO_COLOR;
    return scale.colorOf(v.lq ?? 0);
  };

  return (
    <section class="drill" aria-label="Drill-down">
      <h3>Drill-down: tracts in this area</h3>
      <p class="muted small">Tract-level LQ for the selected group and the area's most over-represented groups (same colour scale as the map; hatching = too uncertain to show; dots = caution, including very noisy tract estimates up to CV 0.8). Tract data is sparse: treat these as rough.</p>
      <svg width="0" height="0" aria-hidden="true" style={{ position: "absolute" }}>
        <defs>
          <pattern id="dd-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="5" height="5" fill="#fff" /><line x1="0" y1="0" x2="0" y2="5" stroke="#adaca6" stroke-width="1.2" />
          </pattern>
          <pattern id="dd-cross" width="5" height="5" patternUnits="userSpaceOnUse">
            <rect width="5" height="5" fill="#f4f3ef" /><path d="M0,0L5,5M5,0L0,5" stroke="#c9c8c2" stroke-width=".6" />
          </pattern>
          <pattern id="dd-dots" width="4" height="4" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r=".9" fill="#fff" /></pattern>
        </defs>
      </svg>
      <div class="multiples">
        {panels.map((p) => {
          const vals = tractValues(meta, p.dim, mats[p.dim], den, stats.candidates[p.dim][p.k], p.k, ids);
          return (
            <figure key={p.key} class="mini">
              <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${p.title}: tract LQ map`}>
                {paths.map(({ i, d }) => {
                  const v = vals.get(i);
                  return (
                    <g key={i}>
                      <path d={d} fill={fillOf(v)} stroke="#fff" stroke-width=".4" />
                      {v?.state === STATE.caution && <path d={d} fill="url(#dd-dots)" />}
                    </g>
                  );
                })}
              </svg>
              <figcaption><strong>{p.title}</strong> <span class="muted">· {p.sub}{p.areaLq !== null ? ` · area LQ ${fmtLQ(p.areaLq)}` : ""}</span></figcaption>
            </figure>
          );
        })}
      </div>
    </section>
  );
}
