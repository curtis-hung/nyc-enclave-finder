// "Who's here?" (§9.2): every over-represented group per dimension for a tract, NTA or borough.

import { useEffect, useState } from "preact/hooks";
import { levelLabel, resolveUnit, unitName, type UnitArea } from "../areas";
import { loadWhosHere } from "../data";
import { fmtCount, fmtLQ, fmtShare, STATE_LABEL } from "../scales";
import type { GroupsFile, Meta, WhoCandidate, WhoRow, WhosHereFile } from "../types";

interface Props {
  meta: Meta;
  groups: GroupsFile;
  area: UnitArea;
  onArea: (a: UnitArea) => void;
  onGroup: (id: string) => void;
  onClose: () => void;
  children?: preact.ComponentChildren; // extra sections (e.g. cuisines) appended below
}

export function WhosHere({ meta, groups, area, onArea, onGroup, onClose, children }: Props) {
  const unit = resolveUnit(meta, area);
  const [data, setData] = useState<WhosHereFile | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!unit) return;
    let live = true;
    setData(null);
    loadWhosHere(unit.level).then((d) => live && setData(d)).catch((e) => setErr(String(e)));
    return () => { live = false; };
  }, [unit?.level]);

  if (!unit) return <p class="error">Unknown area.</p>;
  const u = data?.units[unit.index];

  return (
    <section class="whos" aria-label="Who's here">
      <div class="whos-head">
        <div>
          <div class="ctl-label">{levelLabel(unit.level)}</div>
          <h2 class="whos-title">{unit.name}</h2>
          {unit.parents.length > 0 && (
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
        <button class="close" aria-label="Close who's here" onClick={onClose}>×</button>
      </div>
      <h3 class="whos-sub">Who's here — over-represented residents</h3>
      <p class="muted small">
        Groups whose local share is above their citywide share (LQ &gt; 1), with a usable estimate. Ranked by LQ; several
        groups can be over-represented at once. "Lives here" means census-measured residence.
        {unit.level === "tract" && " Tract estimates are noisy — the neighborhood view is steadier."}
      </p>
      {err && <p class="error">{err}</p>}
      {!u && !err && <p class="muted">Loading…</p>}
      {u &&
        Object.entries(meta.dimensions).map(([dim, d]) => {
          const cands = data!.candidates[dim];
          const rows = u[dim]?.lq ?? [];
          const largest = u[dim]?.share ?? [];
          return (
            <div class="whos-dim" key={dim} role="region" aria-label={`Who's here: ${d.name}`}>
              <h4>
                {d.name} <span class="muted small">· share of {d.share_of}</span>
              </h4>
              {rows.length ? (
                <RowsTable rows={rows} cands={cands} groups={groups} onGroup={onGroup} head={dim === "language" ? "Language" : "Group"} />
              ) : (
                <p class="muted small">No category is measurably over-represented here{unit.level === "tract" ? " at tract level" : ""}.</p>
              )}
              {largest.length > 0 && (
                <details class="largest">
                  <summary>Largest by share</summary>
                  <RowsTable rows={largest} cands={cands} groups={groups} onGroup={onGroup} head={dim === "language" ? "Language" : "Group"} />
                </details>
              )}
              {dim === "language" && <p class="muted small">Language categories are broad Census buckets, not ethnic groups.</p>}
            </div>
          );
        })}
      {children}
    </section>
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
