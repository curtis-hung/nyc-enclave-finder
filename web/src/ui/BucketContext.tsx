// Bucket context panel (§8.3): who lives near a bucket-level cluster. Display only — it never
// feeds labels, tags or clustering (§2.3).

import { useEffect, useState } from "preact/hooks";
import { loadJSON } from "../data";
import { fmtCount, fmtLQ } from "../scales";
import type { CuisineIndex } from "../cuisine";
import type { GroupsFile, Meta } from "../types";

export interface ContextRow {
  group: string;
  dim: string;
  count: number;
  moe: number | null;
  lq: number | null;
  state: string;
}

export const CONTEXT_LABEL = "Residential context — who lives nearby. This is not evidence of what these restaurants serve.";
export const loadContext = (node: string) => loadJSON<Record<string, ContextRow[]>>(`context/${node}.json`);

export function hasContext(ix: CuisineIndex, node: string): boolean {
  return ix.node(node)?.kind === "bucket";
}

export function BucketContext({ meta, groups, ix, node, cluster, onClose }: { meta: Meta; groups: GroupsFile; ix: CuisineIndex; node: string; cluster: string; onClose: () => void }) {
  const [rows, setRows] = useState<ContextRow[] | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let live = true;
    setRows(null);
    setMissing(false);
    loadContext(node).then((d) => live && (d[cluster] ? setRows(d[cluster]) : setMissing(true))).catch(() => live && setMissing(true));
    return () => { live = false; };
  }, [node, cluster]);
  return (
    <section class="card" role="region" aria-label="Bucket context">
      <div class="whos-head">
        <div>
          <div class="ctl-label">{ix.node(node)?.name} cluster #{Number(cluster.split(".").pop()) + 1} · bucket-level</div>
          <h2 class="whos-title">{CONTEXT_LABEL}</h2>
        </div>
        <button class="close" aria-label="Close context" onClick={onClose}>×</button>
      </div>
      <p class="muted small">
        Residents of the groups under this bucket inside the cluster's catchment, area-weighted from census tracts
        (each group in its default dimension). Listed by LQ; restaurant labels are never inferred from this.
      </p>
      {missing && <p class="muted small">No residential context is available for this cluster.</p>}
      {rows && (
        <table class="tbl">
          <thead><tr><th>Group</th><th>LQ</th><th>Residents</th><th>Data</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.group}>
                <td>{groups.groups[r.group]?.name ?? r.group} <span class="muted small">· {meta.dimensions[r.dim].short}</span></td>
                <td>{fmtLQ(r.lq)}</td>
                <td>{fmtCount(r.count)}{r.moe !== null && <span class="muted"> ±{fmtCount(r.moe)}</span>}</td>
                <td class={r.state === "reliable" ? "" : "muted"}>{r.state}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
