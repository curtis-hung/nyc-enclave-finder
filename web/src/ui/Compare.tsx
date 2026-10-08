// Compare mode (§9.3, SHOULD): the focused area side by side with a pinned area.

import { useEffect, useState } from "preact/hooks";
import { computeAreaStats, type AreaStats } from "../focus";
import { fmtLQ } from "../scales";
import type { Meta } from "../types";
import type { Area } from "../url";

const TOP = 5;

export function CompareTable({ meta, here, pinned, pinnedName, onUnpin }: { meta: Meta; here: AreaStats; pinned: Area; pinnedName: string; onUnpin: () => void }) {
  const [other, setOther] = useState<AreaStats | null>(null);
  const key = JSON.stringify(pinned);
  useEffect(() => {
    let live = true;
    setOther(null);
    computeAreaStats(meta, pinned).then((s) => live && setOther(s));
    return () => { live = false; };
  }, [key]);
  return (
    <section class="compare" role="region" aria-label="Comparison">
      <div class="sec-head">
        <h3 class="whos-sub">Compared with {pinnedName}</h3>
        <button class="link" onClick={onUnpin}>Unpin</button>
      </div>
      <p class="muted small">LQ of the groups most over-represented in either area (top {TOP} per dimension). "—" = not over-represented there or no usable estimate.{(here.approximate || other?.approximate) && " Radius values are approximate."}</p>
      {!other && <p class="muted small">Loading…</p>}
      {other && Object.entries(meta.dimensions).map(([dim, d]) => {
        const cands = here.candidates[dim];
        const lqOf = (s: AreaStats, k: number) => [...s.lists[dim].lq, ...s.lists[dim].share].find((r) => r[0] === k)?.[1] ?? null;
        const ks = [...new Set([...here.lists[dim].lq.slice(0, TOP), ...other.lists[dim].lq.slice(0, TOP)].map((r) => r[0]))];
        if (!ks.length) return null;
        ks.sort((a, b) => Math.max(lqOf(here, b) ?? 0, lqOf(other, b) ?? 0) - Math.max(lqOf(here, a) ?? 0, lqOf(other, a) ?? 0));
        return (
          <div key={dim} class="whos-dim">
            <h4>{d.name}</h4>
            <table class="tbl">
              <thead><tr><th>{dim === "language" ? "Language" : "Group"}</th><th>This area</th><th>Pinned</th></tr></thead>
              <tbody>
                {ks.map((k) => (
                  <tr key={k}><td>{cands[k].label}</td><td>{fmtLQ(lqOf(here, k))}</td><td>{fmtLQ(lqOf(other, k))}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </section>
  );
}
